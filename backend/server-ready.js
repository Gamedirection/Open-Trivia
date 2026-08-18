const { Pool } = require('pg');
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const os = require('os');
const initSharePlay = require('./shareplay');
require('dotenv').config();

// ── Scoring ───────────────────────────────────────────────────────────────────
const SCORE_MIN_POINTS = parseInt(process.env.SCORE_MIN_POINTS || '5', 10);
const SCORE_MAX_EASY = parseInt(process.env.SCORE_MAX_EASY || '10', 10);
const SCORE_MAX_MED = parseInt(process.env.SCORE_MAX_MED || '15', 10);
const SCORE_MAX_HARD = parseInt(process.env.SCORE_MAX_HARD || '20', 10);
const DISCORD_SCORE_EASY = parseInt(process.env.DISCORD_SCORE_EASY || '5', 10);
const DISCORD_SCORE_MED = parseInt(process.env.DISCORD_SCORE_MED || '10', 10);
const DISCORD_SCORE_HARD = parseInt(process.env.DISCORD_SCORE_HARD || '15', 10);
const SCORE_FAST_MS = parseInt(process.env.SCORE_FAST_MS || '2000', 10);
const SCORE_SLOW_MS = parseInt(process.env.SCORE_SLOW_MS || '20000', 10);
const DIFF_MIN_ATTEMPTS = parseInt(process.env.DIFF_MIN_ATTEMPTS || '25', 10);
const DIFF_UP_THRESHOLD = parseFloat(process.env.DIFF_UP_THRESHOLD || '0.4');
const DIFF_DOWN_THRESHOLD = parseFloat(process.env.DIFF_DOWN_THRESHOLD || '0.8');

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function maskEmail(email) {
    if (!email) return 'Player';
    const parts = String(email).split('@');
    if (!parts[0]) return email;
    return parts[0];
}

function gravatarHash(email) {
    if (!email) return null;
    return crypto.createHash('md5').update(String(email).trim().toLowerCase()).digest('hex');
}

function base64UrlEncode(value) {
    return Buffer.from(String(value), 'utf8').toString('base64url');
}

function normalizeExternalBaseUrl(url, fallback = 'http://localhost:3000') {
    const trimmed = String(url || '').trim();
    const source = trimmed || fallback;
    if (/^https?:\/\//i.test(source)) {
        return source.replace(/\/+$/, '');
    }
    return `https://${source.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function buildAppUrl(pathname = '/') {
    const base = normalizeExternalBaseUrl(process.env.APP_URL || 'http://localhost:3000');
    const nextPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${base}${nextPath}`;
}

function resolveDiscordRedirectUri(redirectUri) {
    const explicit = String(redirectUri || '').trim();
    if (explicit) return normalizeExternalBaseUrl(explicit);
    return buildAppUrl('/api/auth/discord/callback');
}

function normalizeBotBaseUrl(url) {
    return normalizeExternalBaseUrl(url, 'http://localhost:3000');
}

function normalizeInviteUrl(url) {
    return normalizeExternalBaseUrl(
        url || 'https://discord.com/oauth2/authorize?client_id=1485851351366766755'
    );
}

function buildPublicAppUrl(pathname = '/') {
    const explicit = normalizeBotBaseUrl(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000');
    const nextPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${explicit}${nextPath}`;
}

function signAuthToken(user) {
    return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function makeFallbackPassword() {
    return crypto.randomBytes(32).toString('hex');
}

function normalizeUserRow(row, privacySettings = null) {
    if (!row) return null;
    const displayName = row.display_name || maskEmail(row.email);
    const showEmail = privacySettings
        ? resolveShowEmail(row.show_email, privacySettings)
        : (row.show_email ?? true);
    const { password_hash, ...user } = row;
    return { ...user, display_name: displayName, show_email: showEmail };
}

function buildDiscordAvatarUrl(discordId, avatarHash) {
    if (!discordId || !avatarHash) return null;
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}`;
}

function buildDiscordState(targetPath = '/', extra = {}) {
    return jwt.sign(
        { provider: 'discord', targetPath, nonce: crypto.randomBytes(12).toString('hex'), ...extra },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
    );
}

function isDiscordOnlyEmail(email) {
    return /@users\.open-trivia\.invalid$/i.test(String(email || '').trim());
}

function buildDiscordLinkUrl(targetPath = '/') {
    const target = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    return buildPublicAppUrl(`/api/auth/discord/start?target=${encodeURIComponent(target)}`);
}

function normalizeQuestionTextForSimilarity(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&[^;\s]+;/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function computeQuestionSimilarity(a, b) {
    const left = normalizeQuestionTextForSimilarity(a);
    const right = normalizeQuestionTextForSimilarity(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.92;
    const leftTokens = new Set(left.split(' ').filter((token) => token.length > 2));
    const rightTokens = new Set(right.split(' ').filter((token) => token.length > 2));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let overlap = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) overlap += 1;
    }
    return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function verifyDiscordState(state) {
    return jwt.verify(state, process.env.JWT_SECRET);
}

async function exchangeDiscordCodeForToken(code, settings) {
    const body = new URLSearchParams({
        client_id: settings.client_id,
        client_secret: settings.client_secret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: resolveDiscordRedirectUri(settings.redirect_uri),
    });
    const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.error_description || data.error || 'Discord token exchange failed';
        throw new Error(message);
    }
    return data;
}

async function fetchDiscordUser(accessToken) {
    const response = await fetch('https://discord.com/api/users/@me', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.message || 'Discord profile lookup failed';
        throw new Error(message);
    }
    return data;
}

function resolveDiscordDisplayName(profile) {
    const preferred = [
        profile.global_name,
        profile.username,
        profile.email ? maskEmail(profile.email) : null,
        'Discord Player',
    ];
    const value = preferred.find(Boolean);
    return String(value).slice(0, 60);
}

async function upsertDiscordUser(profile) {
    const email = String(profile.email || '').trim().toLowerCase();
    if (!email) throw new Error('Discord account did not provide an email address');
    if (!profile.verified) throw new Error('Discord email must be verified');

    const privacy = await getPrivacySettings();
    const showEmail = !privacy.hide_emails_by_default;
    const displayName = resolveDiscordDisplayName(profile);
    const discordId = String(profile.id);
    const discordUsername = String(profile.username || '').trim() || null;
    const discordAvatarUrl = buildDiscordAvatarUrl(discordId, profile.avatar);
    const countRes = await pool.query('SELECT COUNT(*) FROM users WHERE is_anonymous=FALSE');
    const defaultRole = parseInt(countRes.rows[0].count, 10) === 0 ? 'admin' : 'player';

    const existing = await pool.query(
        'SELECT * FROM users WHERE discord_id=$1 OR email=$2 ORDER BY CASE WHEN discord_id=$1 THEN 0 ELSE 1 END LIMIT 1',
        [discordId, email]
    );

    if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.discord_id && row.discord_id !== discordId) {
            throw new Error('This account is already linked to a different Discord profile');
        }
        if (row.email !== email && row.discord_id === discordId) {
            throw new Error('Discord account is already linked to another email');
        }
        const nextDisplayName = row.display_name || displayName;
        const nextShowEmail = row.show_email === null || row.show_email === undefined ? showEmail : row.show_email;
        const updated = await pool.query(
            `UPDATE users
             SET email=$1,
                 discord_id=$2,
                 discord_username=$3,
                 discord_avatar_url=$4,
                 display_name=$5,
                 show_email=$6
             WHERE id=$7
             RETURNING *`,
            [email, discordId, discordUsername, discordAvatarUrl, nextDisplayName, nextShowEmail, row.id]
        );
        return normalizeUserRow(updated.rows[0], privacy);
    }

    const inserted = await pool.query(
        `INSERT INTO users (
            email, password_hash, role, display_name, show_email, discord_id, discord_username, discord_avatar_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [email, await bcrypt.hash(makeFallbackPassword(), 10), defaultRole, displayName, showEmail, discordId, discordUsername, discordAvatarUrl]
    );
    return normalizeUserRow(inserted.rows[0], privacy);
}

function buildDiscordOnlyEmail(discordId) {
    return `discord-${String(discordId).trim()}@users.open-trivia.invalid`;
}

function resolveDiscordOnlyDisplayName(discordUsername, discordId) {
    const value = String(discordUsername || '').trim() || `Discord Player ${String(discordId).trim()}`;
    return value.slice(0, 60);
}

async function ensureDiscordTriviaUser({ discordUserId, discordUsername, discordAvatarUrl = null }) {
    const discordId = String(discordUserId || '').trim();
    if (!discordId) throw new Error('Discord user id is required');
    const existing = await pool.query(
        'SELECT id, role, blocked_until FROM users WHERE discord_id=$1 LIMIT 1',
        [discordId]
    );
    if (existing.rows.length) {
        if (discordAvatarUrl) {
            await pool.query(
                'UPDATE users SET discord_username=$1, discord_avatar_url=COALESCE($2, discord_avatar_url) WHERE discord_id=$3',
                [String(discordUsername || '').trim() || null, discordAvatarUrl, discordId]
            );
        }
        return existing.rows[0];
    }

    try {
        const inserted = await pool.query(
            `INSERT INTO users (
                email, password_hash, role, display_name, show_email, discord_id, discord_username, discord_avatar_url
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, role, blocked_until`,
            [
                buildDiscordOnlyEmail(discordId),
                await bcrypt.hash(makeFallbackPassword(), 10),
                'player',
                resolveDiscordOnlyDisplayName(discordUsername, discordId),
                false,
                discordId,
                String(discordUsername || '').trim() || null,
                discordAvatarUrl,
            ]
        );
        return inserted.rows[0];
    } catch (err) {
        if (err.code === '23505') {
            const retry = await pool.query(
                'SELECT id, role, blocked_until FROM users WHERE discord_id=$1 LIMIT 1',
                [discordId]
            );
            if (retry.rows.length) return retry.rows[0];
        }
        throw err;
    }
}

async function linkDiscordProfileToUser(profile, userId) {
    const discordId = String(profile.id || '').trim();
    if (!discordId) throw new Error('Discord account id missing');
    const discordUsername = String(profile.username || '').trim() || null;
    const discordAvatarUrl = buildDiscordAvatarUrl(discordId, profile.avatar);
    const current = await pool.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [userId]);
    if (!current.rows.length) throw new Error('User not found');
    const row = current.rows[0];
    if (row.discord_id && row.discord_id !== discordId) {
        throw new Error('This account already has a Discord profile linked');
    }
    const existingDiscord = await pool.query('SELECT id FROM users WHERE discord_id=$1 AND id<>$2 LIMIT 1', [discordId, userId]);
    if (existingDiscord.rows.length) {
        throw new Error('That Discord account is already linked to another Open-Trivia account');
    }
    const updated = await pool.query(
        `UPDATE users
         SET discord_id=$1,
             discord_username=$2,
             discord_avatar_url=COALESCE($3, discord_avatar_url)
         WHERE id=$4
         RETURNING *`,
        [discordId, discordUsername, discordAvatarUrl, userId]
    );
    const privacy = await getPrivacySettings();
    return normalizeUserRow(updated.rows[0], privacy);
}

function resolveShowEmail(userShowEmail, privacySettings) {
    if (userShowEmail === null || userShowEmail === undefined) {
        return !privacySettings.hide_emails_by_default;
    }
    return !!userShowEmail;
}

function getClientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    if (Array.isArray(xf) && xf.length) return String(xf[0]);
    return req.socket?.remoteAddress || 'unknown';
}

function normalizeImageUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return null;
    return trimmed;
}

function compactQuestionOptions(options) {
    return (Array.isArray(options) ? options : [])
        .map((option) => ({
            char: String(option?.char || '').trim().toUpperCase(),
            text: String(option?.text || '').trim(),
        }))
        .filter((option) => option.char && option.text);
}

function parseIdList(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(raw
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n) && n > 0))];
}

function categoryFilterSql(includeIds, excludeIds, startIndex = 1) {
    const clauses = [];
    const params = [];
    let idx = startIndex;
    if (includeIds.length) {
        clauses.push(`q.category_id = ANY($${idx++}::int[])`);
        params.push(includeIds);
    }
    if (excludeIds.length) {
        clauses.push(`NOT (q.category_id = ANY($${idx++}::int[]))`);
        params.push(excludeIds);
    }
    return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

function normalizeSubmittedQuestionOptions(options, correctAnswer) {
    const normalized = {
        a: String(options?.a || '').trim(),
        b: String(options?.b || '').trim(),
        c: String(options?.c || '').trim(),
        d: String(options?.d || '').trim(),
    };
    if (!normalized.a || !normalized.b) {
        return { error: 'Option A and Option B are required' };
    }
    const hasC = !!normalized.c;
    const hasD = !!normalized.d;
    if (hasC !== hasD) {
        return { error: 'Use either 2 options or 4 options. Option C and Option D must both be filled or both be blank.' };
    }
    const allowedAnswers = hasC && hasD ? ['A', 'B', 'C', 'D'] : ['A', 'B'];
    const normalizedCorrectAnswer = String(correctAnswer || '').trim().toUpperCase().slice(0, 1);
    if (!allowedAnswers.includes(normalizedCorrectAnswer)) {
        return { error: `Correct answer must be one of: ${allowedAnswers.join(', ')}` };
    }
    return {
        options: normalized,
        correctAnswer: normalizedCorrectAnswer,
    };
}

function isAllowedImageUrl(url) {
    if (!url) return false;
    const isHttp = /^https?:\/\//i.test(url);
    const isLocal = url.startsWith('/uploads/') || url.startsWith('/api/uploads/');
    if (!isHttp && !isLocal) return false;
    return /\.(png|jpe?g|svg|webp|gif)(\?.*)?$/i.test(url);
}

async function fetchImageHead(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    try {
        const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        const type = r.headers.get('content-type') || '';
        const len = r.headers.get('content-length');
        const bytes = Number(len);
        return { ok: r.ok, type, bytes: Number.isFinite(bytes) ? bytes : null };
    } finally {
        clearTimeout(t);
    }
}

async function validateImageUrl(url, maxKb) {
    if (!url) return { ok: true };
    const isHttp = /^https?:\/\//i.test(url);
    const isLocal = url.startsWith('/uploads/') || url.startsWith('/api/uploads/');
    if (!isHttp && !isLocal) {
        return { ok: false, error: 'Image URL must be http(s) or a local upload path' };
    }
    if (isLocal) {
        if (!isAllowedImageUrl(url)) {
            return { ok: false, error: 'Image URL must end with png, jpg, jpeg, svg, webp, or gif' };
        }
        return { ok: true };
    }
    if (isAllowedImageUrl(url)) {
        if (maxKb > 0) {
            const head = await fetchImageHead(url);
            if (head.bytes !== null && head.bytes > maxKb * 1024) {
                return { ok: false, error: `Image exceeds ${maxKb} KB limit` };
            }
        }
        return { ok: true };
    }
    try {
        const head = await fetchImageHead(url);
        const type = String(head.type || '').toLowerCase();
        const okType = [
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/svg+xml',
            'image/gif'
        ];
        if (!okType.includes(type)) {
            return { ok: false, error: 'Image URL must be an image (png, jpg, jpeg, svg, webp, gif)' };
        }
        if (maxKb > 0 && head.bytes !== null && head.bytes > maxKb * 1024) {
            return { ok: false, error: `Image exceeds ${maxKb} KB limit` };
        }
        return { ok: true };
    } catch {
        return { ok: false, error: 'Unable to verify image URL' };
    }
}

function isAllowedImageUpload(file) {
    if (!file) return false;
    const okMime = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
    const ext = String(path.extname(file.originalname || '')).toLowerCase();
    const okExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
    return okMime.includes(file.mimetype) && okExt.includes(ext);
}

function slugifyName(name) {
    return String(name || 'category')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'category';
}

function csvEscape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLines(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!lines.length) return { header: [], rows: [] };
    const parseLine = (line) => {
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                out.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        out.push(cur);
        return out;
    };
    const header = parseLine(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseLine(lines[i]);
        const obj = {};
        header.forEach((h, idx) => { obj[h] = (row[idx] || '').trim(); });
        rows.push(obj);
    }
    return { header, rows };
}

function decodeHtmlEntities(input) {
    const s = String(input || '');
    return s
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&eacute;/g, 'e')
        .replace(/&#(\d+);/g, (_m, n) => {
            const code = parseInt(n, 10);
            return Number.isFinite(code) ? String.fromCharCode(code) : '';
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => {
            const code = parseInt(h, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : '';
        });
}

function mapOpenTdbDifficulty(diff) {
    const d = String(diff || '').toLowerCase();
    if (d === 'easy' || d === 'medium' || d === 'hard') return d;
    return 'medium';
}

function shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

async function uniqueCategoryName(base, existing) {
    let name = String(base || 'Category').trim() || 'Category';
    const lower = (s) => s.toLowerCase();
    if (!existing.has(lower(name))) {
        existing.add(lower(name));
        return name;
    }
    let i = 2;
    while (existing.has(lower(`${name} ${i}`))) i++;
    const next = `${name} ${i}`;
    existing.add(lower(next));
    return next;
}

function isLocalImageUrl(url) {
    return url && (url.startsWith('/uploads/') || url.startsWith('/api/uploads/'));
}

function extractRelativeImagePath(url) {
    if (!url) return null;
    if (url.startsWith('/api/uploads/')) return url.replace('/api/uploads/', '');
    if (url.startsWith('/uploads/')) return url.replace('/uploads/', '');
    return null;
}

async function enforceRateLimit(action, key, opts) {
    const {
        minIntervalMs = 0,
        burstWindowMs = 0,
        burstMax = 0,
        cooldownMs = 0,
    } = opts || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await client.query(
            'SELECT * FROM action_limits WHERE action=$1 AND key=$2 FOR UPDATE',
            [action, key]
        );
        const now = new Date();
        let row = r.rows[0];
        if (!row) {
            row = {
                action,
                key,
                count: 0,
                window_start: null,
                last_action_at: null,
                blocked_until: null,
            };
            await client.query(
                `INSERT INTO action_limits (action, key, count, window_start, last_action_at, blocked_until)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [action, key, 0, null, null, null]
            );
        }

        if (row.blocked_until && new Date(row.blocked_until) > now) {
            await client.query('COMMIT');
            return { allowed: false, retryAfterMs: new Date(row.blocked_until) - now };
        }

        if (row.last_action_at && minIntervalMs > 0) {
            const since = now - new Date(row.last_action_at);
            if (since < minIntervalMs) {
                await client.query('COMMIT');
                return { allowed: false, retryAfterMs: minIntervalMs - since };
            }
        }

        let nextCount = row.count || 0;
        let nextWindowStart = row.window_start ? new Date(row.window_start) : null;
        if (burstWindowMs > 0 && burstMax > 0) {
            if (!nextWindowStart || (now - nextWindowStart) > burstWindowMs) {
                nextWindowStart = now;
                nextCount = 1;
            } else {
                nextCount += 1;
            }
            if (nextCount > burstMax) {
                const blockedUntil = new Date(now.getTime() + cooldownMs);
                await client.query(
                    `UPDATE action_limits
                     SET blocked_until=$3, last_action_at=$4, count=$5, window_start=$6
                     WHERE action=$1 AND key=$2`,
                    [action, key, blockedUntil, now, nextCount, nextWindowStart]
                );
                await client.query('COMMIT');
                return { allowed: false, retryAfterMs: cooldownMs };
            }
        }

        await client.query(
            `UPDATE action_limits
             SET last_action_at=$3, count=$4, window_start=$5, blocked_until=NULL
             WHERE action=$1 AND key=$2`,
            [action, key, now, nextCount, nextWindowStart]
        );
        await client.query('COMMIT');
        return { allowed: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

function computePoints(elapsedMs, complexity, settings) {
    const s = settings || {};
    const maxByDifficulty = {
        easy: Number(s.max_easy ?? SCORE_MAX_EASY),
        medium: Number(s.max_med ?? SCORE_MAX_MED),
        hard: Number(s.max_hard ?? SCORE_MAX_HARD),
    };
    const maxPoints = maxByDifficulty[String(complexity || '').toLowerCase()] ?? Number(s.max_med ?? SCORE_MAX_MED);
    const minPoints = Math.min(Number(s.min_points ?? SCORE_MIN_POINTS), maxPoints);
    const ms = Number.isFinite(elapsedMs) ? elapsedMs : SCORE_SLOW_MS;
    const fastMs = Number(s.fast_ms ?? SCORE_FAST_MS);
    const slowMs = Number(s.slow_ms ?? SCORE_SLOW_MS);
    if (ms <= fastMs) return maxPoints;
    if (ms >= slowMs) return minPoints;
    const t = (ms - fastMs) / (slowMs - fastMs);
    return Math.round(maxPoints + (minPoints - maxPoints) * t);
}

function getDifficultyMaxPoints(complexity, settings) {
    const s = settings || {};
    const maxByDifficulty = {
        easy: Number(s.max_easy ?? SCORE_MAX_EASY),
        medium: Number(s.max_med ?? SCORE_MAX_MED),
        hard: Number(s.max_hard ?? SCORE_MAX_HARD),
    };
    return maxByDifficulty[String(complexity || '').toLowerCase()] ?? Number(s.max_med ?? SCORE_MAX_MED);
}

function computeDiscordPoints(complexity, settings) {
    const s = settings || {};
    const discordByDifficulty = {
        easy: Number(s.discord_easy ?? DISCORD_SCORE_EASY),
        medium: Number(s.discord_med ?? DISCORD_SCORE_MED),
        hard: Number(s.discord_hard ?? DISCORD_SCORE_HARD),
    };
    return discordByDifficulty[String(complexity || '').toLowerCase()] ?? Number(s.discord_med ?? DISCORD_SCORE_MED);
}

async function adjustQuestionDifficulty(questionId, settings) {
    const stats = await pool.query(`
        SELECT q.complexity,
               COUNT(gs.id)::int AS total,
               COUNT(gs.id) FILTER (WHERE gs.is_correct = TRUE)::int AS correct
        FROM questions q
        LEFT JOIN game_sessions gs ON gs.question_id = q.id
        WHERE q.id = $1
        GROUP BY q.id
    `, [questionId]);
    if (!stats.rows.length) return;
    const { complexity, total, correct } = stats.rows[0];
    const s = settings || {};
    const minAttempts = Number(s.diff_min_attempts ?? DIFF_MIN_ATTEMPTS);
    const upThreshold = Number(s.diff_up_threshold ?? DIFF_UP_THRESHOLD);
    const downThreshold = Number(s.diff_down_threshold ?? DIFF_DOWN_THRESHOLD);
    if (total < minAttempts) return;
    const ratio = total > 0 ? (correct / total) : 0;

    const order = ['easy', 'medium', 'hard'];
    const idx = order.indexOf(String(complexity || '').toLowerCase());
    if (idx === -1) return;

    let nextIdx = idx;
    if (ratio <= upThreshold && idx < order.length - 1) nextIdx = idx + 1;
    if (ratio >= downThreshold && idx > 0) nextIdx = idx - 1;
    if (nextIdx === idx) return;

    await runQuery('UPDATE questions SET complexity=$1 WHERE id=$2', [order[nextIdx], questionId]);
}

// ── Mailer ─────────────────────────────────────────────────────────────────────
// All SMTP settings come from environment variables. If SMTP_HOST is not set,
// the mailer falls back to logging the token to stdout (dev/no-email mode).
function buildTransport() {
    if (!process.env.SMTP_HOST) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true', // true = 465, false = STARTTLS
        auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });
}

async function sendResetEmail(toEmail, resetToken) {
    const appUrl   = (process.env.APP_URL || 'http://localhost:3009').replace(/\/$/, '');
    const fromAddr = process.env.SMTP_FROM || `Open-Trivia <noreply@${process.env.SMTP_HOST || 'trivia.local'}>`;
    const resetUrl = `${appUrl}/reset-password?reset_token=${resetToken}`;
    const expiryHr = '1 hour';

    const transport = buildTransport();

    if (!transport) {
        // No SMTP configured - log token so dev environments still work
        console.warn('⚠️  SMTP not configured. Reset token (dev only):');
        console.warn(`    Email : ${toEmail}`);
        console.warn(`    Token : ${resetToken}`);
        console.warn(`    URL   : ${resetUrl}`);
        return { devMode: true, token: resetToken, url: resetUrl };
    }

    const html = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#007bff">🏆 Open-Trivia - Password Reset</h2>
            <p>A password reset was requested for <strong>${toEmail}</strong>.</p>
            <p>Click the button below to set a new password. This link expires in <strong>${expiryHr}</strong>.</p>
            <p style="text-align:center;margin:30px 0">
                <a href="${resetUrl}"
                   style="background:#007bff;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
                   Reset My Password
                </a>
            </p>
            <p style="font-size:12px;color:#888">
                If the button doesn't work, copy this link into your browser:<br>
                <a href="${resetUrl}">${resetUrl}</a>
            </p>
            <p style="font-size:12px;color:#888">If you didn't request this, you can safely ignore this email.</p>
        </div>`;

    await transport.sendMail({
        from: fromAddr,
        to: toEmail,
        subject: 'Open-Trivia - Reset your password',
        html,
        text: `Reset your Open-Trivia password by visiting: ${resetUrl}\n\nThis link expires in ${expiryHr}. If you didn't request this, ignore this email.`,
    });

    console.log(`📧 Password reset email sent to ${toEmail}`);
    return { devMode: false };
}

if (!process.env.JWT_SECRET) { console.error('❌ FATAL: JWT_SECRET not set'); process.exit(1); }

const pool = new Pool({
    user: process.env.PG_USER, host: process.env.PG_HOST,
    database: process.env.PG_DB, password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});
pool.on('connect', () => console.log('✅ DB connected'));
pool.on('error', (err) => console.error('❌ DB error:', err));

async function runQuery(query, params = []) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(query, params);
        await client.query('COMMIT');
        return result;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
}

// ── Auth helpers ───────────────────────────────────────────────────────────────
function getTokenUser(req) {
    try {
        const h = req.headers['authorization'];
        if (!h) return null;
        return jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    } catch { return null; }
}

function redirectDiscordResult(res, payload) {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    res.redirect(buildAppUrl(`/auth/discord/callback#${params.toString()}`));
}
async function isUserBlocked(userId) {
    const r = await pool.query('SELECT role, blocked_until FROM users WHERE id=$1', [userId]);
    if (!r.rows.length) return false;
    const row = r.rows[0];
    if (row.role === 'admin') return false;
    return !!(row.blocked_until && new Date(row.blocked_until) > new Date());
}
async function requireAuth(req, res) {
    const u = getTokenUser(req);
    if (!u) { res.status(401).json({ error: 'Authentication required' }); return null; }
    try {
        if (await isUserBlocked(u.id)) {
            const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [u.id]);
            return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
        }
    } catch {
        return res.status(500).json({ error: 'Auth check failed' });
    }
    return u;
}
function requireAdmin(req, res) {
    const u = getTokenUser(req);
    if (!u) { res.status(401).json({ error: 'Not authenticated' }); return null; }
    if (u.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return null; }
    return u;
}

async function getDiscordBotSettings() {
    const envSettings = {
        enabled: false,
        api_token: String(process.env.DISCORD_BOT_API_TOKEN || '').trim(),
        public_app_url: normalizeBotBaseUrl(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000'),
        service_url: normalizeBotBaseUrl(process.env.DISCORD_BOT_SERVICE_URL || ''),
        invite_url: normalizeInviteUrl(process.env.DISCORD_BOT_INVITE_URL || 'https://discord.com/oauth2/authorize?client_id=1485851351366766755'),
    };
    const r = await pool.query('SELECT * FROM discord_bot_settings ORDER BY id DESC LIMIT 1');
    const row = r.rows[0] || {};
    const merged = {
        enabled: row.enabled ?? envSettings.enabled,
        api_token: String(row.api_token || envSettings.api_token || '').trim(),
        public_app_url: normalizeBotBaseUrl(row.public_app_url || envSettings.public_app_url),
        service_url: normalizeBotBaseUrl(row.service_url || envSettings.service_url),
        invite_url: normalizeInviteUrl(row.invite_url || envSettings.invite_url),
        updated_at: row.updated_at || null,
    };
    merged.configured = !!merged.api_token;
    merged.active = !!(merged.enabled && merged.configured);
    return merged;
}

async function requireBot(req, res) {
    try {
        const settings = await getDiscordBotSettings();
        const auth = String(req.headers['authorization'] || '');
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (!settings.active || !token || token !== settings.api_token) {
            res.status(401).json({ error: 'Bot authentication required' });
            return null;
        }
        return settings;
    } catch {
        res.status(500).json({ error: 'Bot auth check failed' });
        return null;
    }
}

// ── Audit log helper ───────────────────────────────────────────────────────────
async function auditLog(adminId, action, details = '') {
    try {
        await pool.query(
            'INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [adminId, action, details]
        );
    } catch (err) { console.error('Audit log failed:', err.message); }
}

async function initDatabase() {
    const client = await pool.connect();
    try {
        console.log('📄 Initialising tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'player',
                score INTEGER DEFAULT 0,
                is_anonymous BOOLEAN DEFAULT FALSE,
                blocked_until TIMESTAMP,
                blocked_reason TEXT,
                display_name VARCHAR(60),
                show_email BOOLEAN,
                discord_id VARCHAR(50) UNIQUE,
                discord_username VARCHAR(255),
                discord_avatar_url TEXT,
                animations_enabled BOOLEAN DEFAULT TRUE,
                shareplay_banned BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                disabled BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS questions (
                id SERIAL PRIMARY KEY,
                category_id INT REFERENCES categories(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                option_a TEXT NOT NULL,
                option_b TEXT NOT NULL,
                option_c TEXT NOT NULL,
                option_d TEXT NOT NULL,
                correct_answer CHAR(1) NOT NULL,
                complexity VARCHAR(20) NOT NULL,
                disabled BOOLEAN DEFAULT FALSE,
                image_url TEXT
            );
            CREATE TABLE IF NOT EXISTS pending_questions (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                submitted_by_email VARCHAR(255) DEFAULT 'anonymous',
                submitted_via VARCHAR(32) DEFAULT 'site',
                category_name VARCHAR(100) NOT NULL,
                text TEXT NOT NULL,
                option_a TEXT NOT NULL,
                option_b TEXT NOT NULL,
                option_c TEXT NOT NULL,
                option_d TEXT NOT NULL,
                correct_answer CHAR(1) NOT NULL,
                complexity VARCHAR(20) NOT NULL,
                image_url TEXT,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending'
            );
            CREATE TABLE IF NOT EXISTS game_sessions (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                question_id INT REFERENCES questions(id),
                category_id INT REFERENCES categories(id),
                selected_answer CHAR(1),
                is_correct BOOLEAN,
                points INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS question_reports (
                id SERIAL PRIMARY KEY,
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                reason TEXT,
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS score_resets (
                id SERIAL PRIMARY KEY,
                scope VARCHAR(20) NOT NULL, -- user|global
                user_id INT REFERENCES users(id),
                category_id INT REFERENCES categories(id),
                reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reset_by_admin_id INT REFERENCES users(id),
                reason TEXT
            );
            CREATE TABLE IF NOT EXISTS leaderboard_schedules (
                id SERIAL PRIMARY KEY,
                period VARCHAR(20) UNIQUE NOT NULL, -- daily|weekly|monthly|yearly
                enabled BOOLEAN DEFAULT FALSE,
                next_run TIMESTAMP,
                last_run TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS backup_snapshots (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                note TEXT,
                data JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scoring_settings (
                id SERIAL PRIMARY KEY,
                min_points INT DEFAULT 5,
                max_easy INT DEFAULT 10,
                max_med INT DEFAULT 15,
                max_hard INT DEFAULT 20,
                discord_easy INT DEFAULT 5,
                discord_med INT DEFAULT 10,
                discord_hard INT DEFAULT 15,
                fast_ms INT DEFAULT 2000,
                slow_ms INT DEFAULT 20000,
                diff_min_attempts INT DEFAULT 25,
                diff_up_threshold NUMERIC DEFAULT 0.4,
                diff_down_threshold NUMERIC DEFAULT 0.8,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS privacy_settings (
                id SERIAL PRIMARY KEY,
                hide_emails_globally BOOLEAN DEFAULT FALSE,
                hide_emails_by_default BOOLEAN DEFAULT TRUE,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS rate_limit_settings (
                id SERIAL PRIMARY KEY,
                guest_min_interval_ms INT DEFAULT 300000,
                user_burst_window_ms INT DEFAULT 300000,
                user_burst_max INT DEFAULT 3,
                user_cooldown_ms INT DEFAULT 300000,
                open_trivia_db_enabled BOOLEAN DEFAULT TRUE,
                skip_per_hour INT DEFAULT 3,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS image_settings (
                id SERIAL PRIMARY KEY,
                max_image_kb INT DEFAULT 512,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS discord_sso_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                client_id TEXT,
                client_secret TEXT,
                redirect_uri TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS discord_bot_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                api_token TEXT,
                public_app_url TEXT,
                service_url TEXT,
                invite_url TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS discord_trivia_schedules (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(64) NOT NULL,
                channel_id VARCHAR(64) NOT NULL,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                question_count INT DEFAULT 1,
                schedule_kind VARCHAR(20) NOT NULL,
                interval_minutes INT,
                interval_min_minutes INT,
                interval_max_minutes INT,
                daily_time VARCHAR(5),
                comment_min_count INT,
                comment_max_count INT,
                current_comment_count INT DEFAULT 0,
                next_comment_target INT,
                enabled BOOLEAN DEFAULT TRUE,
                next_run TIMESTAMP,
                last_run TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS discord_trivia_sessions (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(64),
                channel_id VARCHAR(64),
                message_id VARCHAR(64),
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                mode VARCHAR(20) NOT NULL,
                prompt_user_discord_id VARCHAR(64),
                close_after_seconds INT DEFAULT 45,
                closes_at TIMESTAMP,
                closed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS discord_trivia_answers (
                id SERIAL PRIMARY KEY,
                session_id INT REFERENCES discord_trivia_sessions(id) ON DELETE CASCADE,
                guild_id VARCHAR(64),
                channel_id VARCHAR(64),
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                discord_user_id VARCHAR(64) NOT NULL,
                discord_username VARCHAR(255),
                user_id INT REFERENCES users(id) ON DELETE SET NULL,
                selected_answer CHAR(1) NOT NULL,
                is_correct BOOLEAN DEFAULT FALSE,
                points_awarded INT DEFAULT 0,
                answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (session_id, discord_user_id)
            );
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                token VARCHAR(255) UNIQUE NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS action_limits (
                id SERIAL PRIMARY KEY,
                action VARCHAR(60) NOT NULL,
                key VARCHAR(120) NOT NULL,
                count INT DEFAULT 0,
                window_start TIMESTAMP,
                last_action_at TIMESTAMP,
                blocked_until TIMESTAMP,
                UNIQUE (action, key)
            );
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INT REFERENCES users(id),
                action VARCHAR(255) NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Safe migrations for existing databases
        const migrations = [
            `ALTER TABLE questions ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT`,
            `ALTER TABLE categories ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS submitted_by_email VARCHAR(255) DEFAULT 'anonymous'`,
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS submitted_via VARCHAR(32) DEFAULT 'site'`,
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS image_url TEXT`,
            `ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(60)`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_email BOOLEAN`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(50)`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username VARCHAR(255)`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_avatar_url TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS animations_enabled BOOLEAN DEFAULT TRUE`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id) WHERE discord_id IS NOT NULL`,
            `ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id)`,
            `ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`,
            `ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `CREATE INDEX IF NOT EXISTS idx_game_sessions_user_created ON game_sessions(user_id, created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_game_sessions_category_created ON game_sessions(category_id, created_at)`,
            `CREATE TABLE IF NOT EXISTS score_resets (
                id SERIAL PRIMARY KEY,
                scope VARCHAR(20) NOT NULL,
                user_id INT REFERENCES users(id),
                category_id INT REFERENCES categories(id),
                reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reset_by_admin_id INT REFERENCES users(id),
                reason TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS custom_category_groups (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                include_category_ids INT[] DEFAULT '{}',
                exclude_category_ids INT[] DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS leaderboard_schedules (
                id SERIAL PRIMARY KEY,
                period VARCHAR(20) UNIQUE NOT NULL,
                enabled BOOLEAN DEFAULT FALSE,
                next_run TIMESTAMP,
                last_run TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS backup_snapshots (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                note TEXT,
                data JSONB NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS scoring_settings (
                id SERIAL PRIMARY KEY,
                min_points INT DEFAULT 5,
                max_easy INT DEFAULT 10,
                max_med INT DEFAULT 15,
                max_hard INT DEFAULT 20,
                discord_easy INT DEFAULT 5,
                discord_med INT DEFAULT 10,
                discord_hard INT DEFAULT 15,
                fast_ms INT DEFAULT 2000,
                slow_ms INT DEFAULT 20000,
                diff_min_attempts INT DEFAULT 25,
                diff_up_threshold NUMERIC DEFAULT 0.4,
                diff_down_threshold NUMERIC DEFAULT 0.8,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS privacy_settings (
                id SERIAL PRIMARY KEY,
                hide_emails_globally BOOLEAN DEFAULT FALSE,
                hide_emails_by_default BOOLEAN DEFAULT TRUE,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS rate_limit_settings (
                id SERIAL PRIMARY KEY,
                guest_min_interval_ms INT DEFAULT 300000,
                user_burst_window_ms INT DEFAULT 300000,
                user_burst_max INT DEFAULT 3,
                user_cooldown_ms INT DEFAULT 300000,
                open_trivia_db_enabled BOOLEAN DEFAULT TRUE,
                skip_per_hour INT DEFAULT 3,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `ALTER TABLE rate_limit_settings ADD COLUMN IF NOT EXISTS open_trivia_db_enabled BOOLEAN DEFAULT TRUE`,
            `ALTER TABLE rate_limit_settings ADD COLUMN IF NOT EXISTS skip_per_hour INT DEFAULT 3`,
            `CREATE TABLE IF NOT EXISTS image_settings (
                id SERIAL PRIMARY KEY,
                max_image_kb INT DEFAULT 512,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS discord_sso_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                client_id TEXT,
                client_secret TEXT,
                redirect_uri TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS discord_bot_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                api_token TEXT,
                public_app_url TEXT,
                service_url TEXT,
                invite_url TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `ALTER TABLE discord_bot_settings ADD COLUMN IF NOT EXISTS invite_url TEXT`,
            `CREATE TABLE IF NOT EXISTS discord_trivia_schedules (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(64) NOT NULL,
                channel_id VARCHAR(64) NOT NULL,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                question_count INT DEFAULT 1,
                schedule_kind VARCHAR(20) NOT NULL,
                interval_minutes INT,
                interval_min_minutes INT,
                interval_max_minutes INT,
                daily_time VARCHAR(5),
                comment_min_count INT,
                comment_max_count INT,
                current_comment_count INT DEFAULT 0,
                next_comment_target INT,
                enabled BOOLEAN DEFAULT TRUE,
                next_run TIMESTAMP,
                last_run TIMESTAMP,
                last_status VARCHAR(20),
                last_error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS interval_min_minutes INT`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS interval_max_minutes INT`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS comment_min_count INT`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS comment_max_count INT`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS current_comment_count INT DEFAULT 0`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS next_comment_target INT`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS last_status VARCHAR(20)`,
            `ALTER TABLE discord_trivia_schedules ADD COLUMN IF NOT EXISTS last_error TEXT`,
            `CREATE TABLE IF NOT EXISTS discord_trivia_sessions (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(64),
                channel_id VARCHAR(64),
                message_id VARCHAR(64),
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                mode VARCHAR(20) NOT NULL,
                prompt_user_discord_id VARCHAR(64),
                close_after_seconds INT DEFAULT 45,
                closes_at TIMESTAMP,
                closed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS discord_trivia_answers (
                id SERIAL PRIMARY KEY,
                session_id INT REFERENCES discord_trivia_sessions(id) ON DELETE CASCADE,
                guild_id VARCHAR(64),
                channel_id VARCHAR(64),
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                category_id INT REFERENCES categories(id) ON DELETE SET NULL,
                discord_user_id VARCHAR(64) NOT NULL,
                discord_username VARCHAR(255),
                user_id INT REFERENCES users(id) ON DELETE SET NULL,
                selected_answer CHAR(1) NOT NULL,
                is_correct BOOLEAN DEFAULT FALSE,
                points_awarded INT DEFAULT 0,
                answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (session_id, discord_user_id)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_discord_answers_guild_time ON discord_trivia_answers(guild_id, answered_at)`,
            `CREATE INDEX IF NOT EXISTS idx_discord_schedules_next_run ON discord_trivia_schedules(enabled, next_run)`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_min_attempts INT DEFAULT 25`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_up_threshold NUMERIC DEFAULT 0.4`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_down_threshold NUMERIC DEFAULT 0.8`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS discord_easy INT DEFAULT 5`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS discord_med INT DEFAULT 10`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS discord_hard INT DEFAULT 15`,
            `UPDATE users SET display_name = split_part(email, '@', 1)
             WHERE (display_name IS NULL OR display_name = '') AND position('@' in email) > 0`,
            `UPDATE users SET show_email = FALSE WHERE show_email IS NULL`,
            `CREATE TABLE IF NOT EXISTS action_limits (
                id SERIAL PRIMARY KEY,
                action VARCHAR(60) NOT NULL,
                key VARCHAR(120) NOT NULL,
                count INT DEFAULT 0,
                window_start TIMESTAMP,
                last_action_at TIMESTAMP,
                blocked_until TIMESTAMP,
                UNIQUE (action, key)
            )`,
            `CREATE TABLE IF NOT EXISTS shareplay_rounds (
                id SERIAL PRIMARY KEY,
                room_code VARCHAR(10) NOT NULL,
                question_id INT REFERENCES questions(id) ON DELETE SET NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP,
                ended_at TIMESTAMP,
                correct_answer CHAR(1),
                timer_seconds INT DEFAULT 15
            )`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS shareplay_banned BOOLEAN DEFAULT FALSE`,
            `CREATE TABLE IF NOT EXISTS shareplay_kick_strikes (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                strike_count INT DEFAULT 0,
                last_kick_at TIMESTAMP,
                UNIQUE(user_id)
            )`,
            `CREATE TABLE IF NOT EXISTS shareplay_bans (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                ban_type VARCHAR(20) NOT NULL DEFAULT 'shareplay',
                banned_until TIMESTAMP,
                reason TEXT,
                admin_id INT REFERENCES users(id),
                is_permanent BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                unbanned_at TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS shareplay_appeals (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                admin_response TEXT,
                admin_id INT REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS shareplay_kick_history (
                id SERIAL PRIMARY KEY,
                target_user_id INT REFERENCES users(id) ON DELETE CASCADE,
                room_code VARCHAR(10),
                initiated_by_user_id INT REFERENCES users(id),
                voters JSONB DEFAULT '[]',
                kicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
        ];
        for (const m of migrations) {
            try { await client.query(m); } catch(e) { console.log('Migration skipped:', e.message); }
        }

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@trivia.com';
        const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'admin123';
        const check = await client.query('SELECT COUNT(*) FROM users WHERE email=$1', [adminEmail]);
        if (parseInt(check.rows[0].count) === 0) {
            const hash = await bcrypt.hash(adminPassword, 10);
            await client.query(
                'INSERT INTO users (email,password_hash,role,score,display_name,show_email) VALUES ($1,$2,$3,0,$4,TRUE)',
                [adminEmail, hash, 'admin', maskEmail(adminEmail)]
            );
            console.log(`
╔══════════════════════════════════════════════════════════╗
║   🆕 ADMIN ACCOUNT CREATED - SAVE THESE CREDENTIALS     ║
║                                                          ║
║   Email    : ${adminEmail.padEnd(42)}║
║   Password : ${adminPassword.padEnd(42)}║
║                                                          ║
║   Change this password immediately after first login.    ║
║   These credentials will NOT be shown again.             ║
╚══════════════════════════════════════════════════════════╝

💡 Forgot your admin password? Reset it directly in the database:

   docker compose exec db psql -U $PG_USER -d $PG_DB \\
     -c "UPDATE users SET password_hash='\\$(node -e \\"
          const b=require('bcryptjs');
          b.hash('NEW_PASSWORD',10).then(h=>process.stdout.write(h))
        \\")' WHERE email='${adminEmail}';"

   Or use the one-liner reset script in ./backend/reset-admin-password.sh
`);
        }
        console.log('✅ Database ready');
    } finally { client.release(); }
}

const app = express();
const corsOrigins = [
    'http://localhost:3009',
    'http://localhost:3000',
    String(process.env.APP_URL || '').trim(),
].filter(Boolean);
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use((req, _res, next) => { console.log(`📨 ${req.method} ${req.path}`); next(); });
const uploadsRoot = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsRoot));
app.use('/api/uploads', express.static(uploadsRoot));

// ── Leaderboard Scheduler ─────────────────────────────────────────────────────
function computeNextRun(period, fromDate = new Date()) {
    const d = new Date(fromDate);
    if (period === 'daily') {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (period === 'weekly') {
        const day = d.getDay(); // 0=Sun
        const daysUntilMonday = (8 - (day || 7));
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (period === 'monthly') {
        return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    if (period === 'yearly') {
        return new Date(d.getFullYear() + 1, 0, 1);
    }
    return null;
}

async function runScheduledResets() {
    try {
        const due = await pool.query(
            `SELECT id, period FROM leaderboard_schedules
             WHERE enabled=TRUE AND next_run IS NOT NULL AND next_run <= NOW()`
        );
        for (const row of due.rows) {
            await runQuery(
                `INSERT INTO score_resets (scope, reason)
                 VALUES ('global', $1)`,
                [`scheduled_${row.period}`]
            );
            await runQuery(
                `UPDATE leaderboard_schedules
                 SET last_run = NOW(), next_run = $2
                 WHERE id = $1`,
                [row.id, computeNextRun(row.period, new Date())]
            );
            await runQuery(
                `INSERT INTO audit_logs (admin_id, action, details)
                 VALUES ($1, $2, $3)`,
                [null, 'LEADERBOARD_RESET_SCHEDULED', `Scheduled ${row.period} reset executed`]
            );
        }
    } catch (err) {
        console.error('❌ Scheduled reset check failed:', err.message);
    }
}

async function getScoringSettings() {
    const r = await pool.query('SELECT * FROM scoring_settings ORDER BY id DESC LIMIT 1');
    if (r.rows.length) return r.rows[0];
    const inserted = await pool.query(`
        INSERT INTO scoring_settings (min_points, max_easy, max_med, max_hard, discord_easy, discord_med, discord_hard, fast_ms, slow_ms, diff_min_attempts, diff_up_threshold, diff_down_threshold)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *`,
        [
            SCORE_MIN_POINTS,
            SCORE_MAX_EASY,
            SCORE_MAX_MED,
            SCORE_MAX_HARD,
            DISCORD_SCORE_EASY,
            DISCORD_SCORE_MED,
            DISCORD_SCORE_HARD,
            SCORE_FAST_MS,
            SCORE_SLOW_MS,
            DIFF_MIN_ATTEMPTS,
            DIFF_UP_THRESHOLD,
            DIFF_DOWN_THRESHOLD,
        ]
    );
    return inserted.rows[0];
}

async function getPrivacySettings() {
    const r = await pool.query('SELECT * FROM privacy_settings ORDER BY id DESC LIMIT 1');
    if (r.rows.length) return r.rows[0];
    const inserted = await pool.query(`
        INSERT INTO privacy_settings (hide_emails_globally, hide_emails_by_default)
        VALUES (FALSE, TRUE)
        RETURNING *`
    );
    return inserted.rows[0];
}

async function getRateLimitSettings() {
    const r = await pool.query('SELECT * FROM rate_limit_settings ORDER BY id DESC LIMIT 1');
    if (r.rows.length) {
        const row = r.rows[0];
        return {
            ...row,
            open_trivia_db_enabled: row.open_trivia_db_enabled !== false,
            skip_per_hour: Number.isFinite(Number(row.skip_per_hour)) ? Number(row.skip_per_hour) : 3,
        };
    }
    const inserted = await pool.query(`
        INSERT INTO rate_limit_settings (
            guest_min_interval_ms,
            user_burst_window_ms,
            user_burst_max,
            user_cooldown_ms,
            open_trivia_db_enabled,
            skip_per_hour
        )
        VALUES (300000, 300000, 3, 300000, TRUE, 3)
        RETURNING *`
    );
    return inserted.rows[0];
}

async function getImageSettings() {
    const r = await pool.query('SELECT * FROM image_settings ORDER BY id DESC LIMIT 1');
    if (r.rows.length) return r.rows[0];
    const inserted = await pool.query(`
        INSERT INTO image_settings (max_image_kb)
        VALUES (512)
        RETURNING *`
    );
    return inserted.rows[0];
}

async function getDiscordSsoSettings() {
    const envSettings = {
        enabled: false,
        client_id: String(process.env.DISCORD_CLIENT_ID || '').trim(),
        client_secret: String(process.env.DISCORD_CLIENT_SECRET || '').trim(),
        redirect_uri: String(process.env.DISCORD_REDIRECT_URI || '').trim(),
    };
    const r = await pool.query('SELECT * FROM discord_sso_settings ORDER BY id DESC LIMIT 1');
    const row = r.rows[0] || {};
    const merged = {
        enabled: row.enabled ?? envSettings.enabled,
        client_id: String(row.client_id || envSettings.client_id || '').trim(),
        client_secret: String(row.client_secret || envSettings.client_secret || '').trim(),
        redirect_uri: String(row.redirect_uri || envSettings.redirect_uri || '').trim(),
        updated_at: row.updated_at || null,
    };
    merged.redirect_uri = resolveDiscordRedirectUri(merged.redirect_uri);
    merged.configured = !!(merged.client_id && merged.client_secret && process.env.JWT_SECRET);
    merged.active = !!(merged.enabled && merged.configured);
    return merged;
}

async function getDiscordBotSettingsSnapshot() {
    const settings = await getDiscordBotSettings();
    return {
        enabled: settings.enabled,
        api_token: settings.api_token,
        public_app_url: settings.public_app_url,
        service_url: settings.service_url,
        updated_at: settings.updated_at,
        configured: settings.configured,
        active: settings.active,
    };
}

function computeDiscordScheduleNextRun(schedule, fromDate = new Date()) {
    const kind = String(schedule?.schedule_kind || '').toLowerCase();
    const from = new Date(fromDate);
    if (kind === 'random_interval') {
        const minMinutes = Math.max(1, Number(schedule?.interval_min_minutes) || 0);
        const maxMinutes = Math.max(minMinutes, Number(schedule?.interval_max_minutes) || minMinutes);
        const selectedMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
        return new Date(from.getTime() + selectedMinutes * 60 * 1000);
    }
    if (kind === 'interval') {
        const mins = Math.max(1, Number(schedule?.interval_minutes) || 0);
        return new Date(from.getTime() + mins * 60 * 1000);
    }
    if (kind === 'daily') {
        const daily = String(schedule?.daily_time || '09:00');
        const [hh, mm] = daily.split(':').map(v => parseInt(v, 10));
        const next = new Date(from);
        next.setSeconds(0, 0);
        next.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
        if (next <= from) next.setDate(next.getDate() + 1);
        return next;
    }
    if (kind === 'comment_range') {
        return null;
    }
    return null;
}

function randomIntInclusive(min, max) {
    const safeMin = Math.min(min, max);
    const safeMax = Math.max(min, max);
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function computeDiscordCommentTarget(schedule) {
    const minCount = Math.max(1, Number(schedule?.comment_min_count) || 1);
    const maxCount = Math.max(minCount, Number(schedule?.comment_max_count) || minCount);
    return randomIntInclusive(minCount, maxCount);
}

async function collectSnapshot() {
    const tables = [
        'users',
        'categories',
        'questions',
        'pending_questions',
        'game_sessions',
        'question_reports',
        'score_resets',
        'leaderboard_schedules',
        'scoring_settings',
        'privacy_settings',
        'rate_limit_settings',
        'image_settings',
        'discord_sso_settings',
        'discord_bot_settings',
        'discord_trivia_schedules',
        'discord_trivia_sessions',
        'discord_trivia_answers',
        'audit_logs',
        'password_reset_tokens',
    ];
    const data = {};
    for (const t of tables) {
        const r = await pool.query(`SELECT * FROM ${t}`);
        data[t] = r.rows;
    }
    return data;
}

async function applySnapshot(snapshot, mode = 'replace') {
    const data = snapshot || {};
    if (!data.users || !data.categories) {
        throw new Error('Invalid snapshot data');
    }
    const tables = {
        users: ['id','email','password_hash','role','score','is_anonymous','blocked_until','blocked_reason','display_name','show_email','discord_id','discord_username','discord_avatar_url'],
        categories: ['id','name'],
        questions: ['id','category_id','text','option_a','option_b','option_c','option_d','correct_answer','complexity','disabled','image_url'],
        pending_questions: ['id','user_id','submitted_by_email','submitted_via','category_name','text','option_a','option_b','option_c','option_d','correct_answer','complexity','image_url','submitted_at','status'],
        game_sessions: ['id','user_id','question_id','category_id','selected_answer','is_correct','points','created_at'],
        question_reports: ['id','question_id','reason','reported_at'],
        score_resets: ['id','scope','user_id','category_id','reset_at','reset_by_admin_id','reason'],
        leaderboard_schedules: ['id','period','enabled','next_run','last_run'],
        scoring_settings: ['id','min_points','max_easy','max_med','max_hard','discord_easy','discord_med','discord_hard','fast_ms','slow_ms','diff_min_attempts','diff_up_threshold','diff_down_threshold','updated_at'],
        privacy_settings: ['id','hide_emails_globally','hide_emails_by_default','updated_at'],
        rate_limit_settings: ['id','guest_min_interval_ms','user_burst_window_ms','user_burst_max','user_cooldown_ms','open_trivia_db_enabled','skip_per_hour','updated_at'],
        image_settings: ['id','max_image_kb','updated_at'],
        discord_sso_settings: ['id','enabled','client_id','client_secret','redirect_uri','updated_at'],
        discord_bot_settings: ['id','enabled','api_token','public_app_url','service_url','invite_url','updated_at'],
        discord_trivia_schedules: ['id','guild_id','channel_id','category_id','question_count','schedule_kind','interval_minutes','interval_min_minutes','interval_max_minutes','daily_time','comment_min_count','comment_max_count','current_comment_count','next_comment_target','enabled','next_run','last_run','last_status','last_error','created_at'],
        discord_trivia_sessions: ['id','guild_id','channel_id','message_id','question_id','category_id','mode','prompt_user_discord_id','close_after_seconds','closes_at','closed_at','created_at'],
        discord_trivia_answers: ['id','session_id','guild_id','channel_id','question_id','category_id','discord_user_id','discord_username','user_id','selected_answer','is_correct','points_awarded','answered_at'],
        audit_logs: ['id','admin_id','action','details','created_at'],
        password_reset_tokens: ['id','user_id','token','expires_at','used','created_at'],
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (mode === 'replace') {
            await client.query('TRUNCATE TABLE password_reset_tokens, audit_logs, discord_trivia_answers, discord_trivia_sessions, discord_trivia_schedules, question_reports, pending_questions, game_sessions, score_resets, leaderboard_schedules, scoring_settings, privacy_settings, rate_limit_settings, image_settings, discord_sso_settings, discord_bot_settings, questions, categories, users RESTART IDENTITY CASCADE');
        }

        for (const [table, cols] of Object.entries(tables)) {
            const rows = data[table] || [];
            if (!rows.length) continue;
            const values = [];
            const params = [];
            let idx = 1;
            for (const row of rows) {
                const rowParams = [];
                for (const c of cols) {
                    rowParams.push(`$${idx++}`);
                    params.push(row[c] === undefined ? null : row[c]);
                }
                values.push(`(${rowParams.join(',')})`);
            }
            const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}` +
                (mode === 'merge' ? ` ON CONFLICT (id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`).join(',')}` : '');
            await client.query(sql, params);
        }

        const seqs = [
            'users_id_seq',
            'categories_id_seq',
            'questions_id_seq',
            'pending_questions_id_seq',
            'game_sessions_id_seq',
            'question_reports_id_seq',
            'score_resets_id_seq',
            'leaderboard_schedules_id_seq',
            'scoring_settings_id_seq',
            'privacy_settings_id_seq',
            'rate_limit_settings_id_seq',
            'image_settings_id_seq',
            'discord_sso_settings_id_seq',
            'discord_bot_settings_id_seq',
            'discord_trivia_schedules_id_seq',
            'discord_trivia_sessions_id_seq',
            'discord_trivia_answers_id_seq',
            'audit_logs_id_seq',
            'password_reset_tokens_id_seq',
            'backup_snapshots_id_seq',
        ];
        for (const s of seqs) {
            try {
                const table = s.replace('_id_seq', '');
                await client.query(`SELECT setval('${s}', COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
            } catch {
                // ignore missing sequences
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ── AUTH ───────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hashed = await bcrypt.hash(password, 10);
        const privacy = await getPrivacySettings();
        const showEmail = !privacy.hide_emails_by_default;
        const displayName = maskEmail(email);
        // Only count non-anonymous real users to decide first-user-gets-admin
        const countRes = await pool.query('SELECT COUNT(*) FROM users WHERE is_anonymous=FALSE');
        const role = parseInt(countRes.rows[0].count) === 0 ? 'admin' : 'player';
        const r = await runQuery(
            'INSERT INTO users (email,password_hash,role,display_name,show_email) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [email, hashed, role, displayName, showEmail]
        );
        const user = normalizeUserRow(r.rows[0], privacy);
        const token = signAuthToken(user);
        res.json({ user, token });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'User already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const r = await pool.query('SELECT * FROM users WHERE email=$1 AND is_anonymous=FALSE', [email]);
        if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
        const valid = await bcrypt.compare(password, r.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Wrong password' });
        if (r.rows[0].blocked_until && new Date(r.rows[0].blocked_until) > new Date()) {
            return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0].blocked_until });
        }
        let displayName = r.rows[0].display_name;
        let showEmail = r.rows[0].show_email;
        let needsUpdate = false;
        if (!displayName) {
            displayName = maskEmail(r.rows[0].email);
            needsUpdate = true;
        }
        if (showEmail === null || showEmail === undefined) {
            showEmail = true;
            needsUpdate = true;
        }
        if (needsUpdate) {
            await runQuery(
                'UPDATE users SET display_name=$1, show_email=$2 WHERE id=$3',
                [displayName, showEmail, r.rows[0].id]
            );
        }
        const user = normalizeUserRow({ ...r.rows[0], display_name: displayName, show_email: showEmail });
        const token = signAuthToken(user);
        res.json({ user, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/auth/providers', async (_req, res) => {
    try {
        const settings = await getDiscordSsoSettings();
        res.json({
            discord: {
                enabled: settings.active,
                configured: settings.configured,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/auth/discord/start', async (req, res) => {
    const settings = await getDiscordSsoSettings();
    if (!settings.active) {
        return res.status(503).json({ error: 'Discord SSO is not configured' });
    }
    try {
        const targetPath = String(req.query.target || '/').trim() || '/';
        const state = buildDiscordState(targetPath.startsWith('/') ? targetPath : '/');
        const url = new URL('https://discord.com/oauth2/authorize');
        url.searchParams.set('client_id', settings.client_id);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', settings.redirect_uri);
        url.searchParams.set('scope', 'identify email');
        url.searchParams.set('state', state);
        res.redirect(url.toString());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/me/profile/discord/link-url', async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const settings = await getDiscordSsoSettings();
    if (!settings.active) {
        return res.status(503).json({ error: 'Discord SSO is not configured' });
    }
    try {
        const state = buildDiscordState('/dashboard', { mode: 'link', linkUserId: user.id });
        const url = new URL('https://discord.com/oauth2/authorize');
        url.searchParams.set('client_id', settings.client_id);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', settings.redirect_uri);
        url.searchParams.set('scope', 'identify email');
        url.searchParams.set('state', state);
        res.json({ url: url.toString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
        return redirectDiscordResult(res, { error: `Discord authorization failed: ${error}` });
    }
    if (!code || !state) {
        return redirectDiscordResult(res, { error: 'Missing Discord OAuth callback parameters' });
    }
    try {
        const settings = await getDiscordSsoSettings();
        if (!settings.active) {
            return redirectDiscordResult(res, { error: 'Discord SSO is not configured' });
        }
        const verifiedState = verifyDiscordState(String(state));
        const tokenData = await exchangeDiscordCodeForToken(String(code), settings);
        const profile = await fetchDiscordUser(tokenData.access_token);
        const user = verifiedState.mode === 'link' && verifiedState.linkUserId
            ? await linkDiscordProfileToUser(profile, verifiedState.linkUserId)
            : await upsertDiscordUser(profile);
        if (user.blocked_until && new Date(user.blocked_until) > new Date() && user.role !== 'admin') {
            return redirectDiscordResult(res, {
                error: 'Account is blocked',
                blocked_until: user.blocked_until,
            });
        }
        redirectDiscordResult(res, {
            token: signAuthToken(user),
            user: base64UrlEncode(JSON.stringify(user)),
            target: verifiedState.targetPath || '/',
        });
    } catch (err) {
        redirectDiscordResult(res, { error: err.message || 'Discord sign-in failed' });
    }
});

// ── PASSWORD RESET ─────────────────────────────────────────────────────────────
// Request a password reset. Sends an email with a one-time link.
// If SMTP is not configured, the token is logged to stdout and also returned
// in the response body so dev environments work without a mail server.
app.post('/auth/request-reset', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
        const r = await pool.query('SELECT id FROM users WHERE email=$1 AND is_anonymous=FALSE', [email]);
        if (!r.rows.length) {
            // Always return success to prevent email enumeration
            return res.json({ success: true, emailSent: false, message: 'If that account exists, a reset link has been sent.' });
        }

        const userId = r.rows[0].id;
        // Invalidate any existing active tokens for this user
        await pool.query('UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1 AND used=FALSE', [userId]);

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await runQuery(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [userId, token, expiresAt]
        );

        const result = await sendResetEmail(email, token);

        // In dev mode (no SMTP), surface the token so the UI can still pre-fill the reset form
        res.json({
            success: true,
            emailSent: !result.devMode,
            message: result.devMode
                ? 'No email server configured - token returned for development use.'
                : 'Reset link sent! Check your inbox.',
            // Only populated in dev mode; undefined (omitted) when email was sent
            ...(result.devMode ? { token: result.token, resetUrl: result.url } : {}),
        });
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reset password using a token
app.post('/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const r = await pool.query(
            'SELECT * FROM password_reset_tokens WHERE token=$1 AND used=FALSE AND expires_at > NOW()',
            [token]
        );
        if (!r.rows.length) return res.status(400).json({ error: 'Invalid or expired reset token' });

        const resetRecord = r.rows[0];
        const hashed = await bcrypt.hash(newPassword, 10);
        await runQuery('UPDATE users SET password_hash=$1 WHERE id=$2', [hashed, resetRecord.user_id]);
        await runQuery('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [resetRecord.id]);

        res.json({ success: true, message: 'Password updated. You can now log in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────────
app.get('/categories', async (_req, res) => {
    const includeDisabled = ['1', 'true'].includes(String(_req.query.includeDisabled || '').trim().toLowerCase());
    const viewer = getTokenUser(_req);
    const canIncludeDisabled = includeDisabled && viewer?.role === 'admin';
    try {
        const r = await pool.query(
            `SELECT * FROM categories
             ${canIncludeDisabled ? '' : 'WHERE disabled=FALSE'}
             ORDER BY disabled ASC, name ASC`
        );
        res.json(r.rows);
    }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/categories', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    try {
        const r = await runQuery('INSERT INTO categories (name) VALUES ($1) RETURNING *', [name.trim()]);
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/categories/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const catRow = await pool.query('SELECT id, name FROM categories WHERE id=$1', [req.params.id]);
        if (!catRow.rows.length) return res.status(404).json({ error: 'Category not found' });
        const snapshot = await collectSnapshot();
        await runQuery('INSERT INTO backup_snapshots (note, data) VALUES ($1, $2)', [
            `Pre-delete backup for category ${catRow.rows[0].name} (id:${catRow.rows[0].id})`,
            snapshot
        ]);
        await auditLog(getTokenUser(req)?.id || null, 'CATEGORY_DELETE_BACKUP', `Backup created before deleting category ${catRow.rows[0].id}`);
        await runQuery('DELETE FROM categories WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/categories/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { disabled, name } = req.body || {};
    const updates = [];
    const params = [];
    if (typeof disabled === 'boolean') {
        params.push(disabled);
        updates.push(`disabled=$${params.length}`);
    }
    if (name !== undefined) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return res.status(400).json({ error: 'Name required' });
        params.push(trimmed.slice(0, 100));
        updates.push(`name=$${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No category updates provided' });
    try {
        params.push(req.params.id);
        const r = await runQuery(`UPDATE categories SET ${updates.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
        if (!r.rows.length) return res.status(404).json({ error: 'Category not found' });
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CATEGORY MERGE ─────────────────────────────────────────────────────────────
app.post('/admin/categories/merge', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { sourceCategoryId, targetCategoryId } = req.body || {};
    if (!sourceCategoryId || !targetCategoryId)
        return res.status(400).json({ error: 'sourceCategoryId and targetCategoryId required' });
    if (Number(sourceCategoryId) === Number(targetCategoryId))
        return res.status(400).json({ error: 'Source and target must be different categories' });
    try {
        const src = await pool.query('SELECT id, name FROM categories WHERE id=$1', [sourceCategoryId]);
        const tgt = await pool.query('SELECT id, name FROM categories WHERE id=$1', [targetCategoryId]);
        if (!src.rows.length) return res.status(404).json({ error: 'Source category not found' });
        if (!tgt.rows.length) return res.status(404).json({ error: 'Target category not found' });
        const srcName = src.rows[0].name;
        const tgtName = tgt.rows[0].name;

        const snapshot = await collectSnapshot();
        await runQuery('INSERT INTO backup_snapshots (note, data) VALUES ($1, $2)', [
            `Pre-merge backup: merging category "${srcName}" (id:${sourceCategoryId}) into "${tgtName}" (id:${targetCategoryId})`,
            snapshot
        ]);
        await auditLog(getTokenUser(req)?.id || null, 'CATEGORY_MERGE_BACKUP',
            `Backup created before merging category ${sourceCategoryId} into ${targetCategoryId}`);

        const qResult = await pool.query('UPDATE questions SET category_id=$1 WHERE category_id=$2', [targetCategoryId, sourceCategoryId]);
        await pool.query('UPDATE game_sessions SET category_id=NULL WHERE category_id=$1', [sourceCategoryId]);
        await pool.query('UPDATE score_resets SET category_id=NULL WHERE category_id=$1', [sourceCategoryId]);
        await pool.query('UPDATE custom_category_groups SET include_category_ids = array_replace(include_category_ids, $1::int, $2::int) WHERE $1::int = ANY(include_category_ids)', [sourceCategoryId, targetCategoryId]);
        await pool.query('UPDATE custom_category_groups SET exclude_category_ids = array_replace(exclude_category_ids, $1::int, $2::int) WHERE $1::int = ANY(exclude_category_ids)', [sourceCategoryId, targetCategoryId]);
        await pool.query('UPDATE discord_trivia_schedules SET category_id=NULL WHERE category_id=$1', [sourceCategoryId]);
        await pool.query('UPDATE discord_trivia_sessions SET category_id=NULL WHERE category_id=$1', [sourceCategoryId]);
        await pool.query('UPDATE discord_trivia_answers SET category_id=NULL WHERE category_id=$1', [sourceCategoryId]);
        await runQuery('DELETE FROM categories WHERE id=$1', [sourceCategoryId]);
        await auditLog(getTokenUser(req)?.id || null, 'CATEGORY_MERGE',
            `Merged category ${sourceCategoryId} ("${srcName}") into ${targetCategoryId} ("${tgtName}") - ${qResult.rowCount} questions moved`);

        res.json({ success: true, questionsMoved: qResult.rowCount, sourceCategory: srcName, targetCategory: tgtName });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── QUESTIONS ──────────────────────────────────────────────────────────────────
app.get('/categories/:catId/questions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const r = await pool.query(
            `SELECT q.*,
                    COUNT(gs.id)::int AS total_attempts,
                    COUNT(gs.id) FILTER (WHERE gs.is_correct = TRUE)::int AS correct_attempts
             FROM questions q
             LEFT JOIN game_sessions gs ON gs.question_id = q.id
             WHERE q.category_id=$1
             GROUP BY q.id
             ORDER BY q.id DESC`,
            [req.params.catId]
        );
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/questions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { categoryId, text, options, correctAnswer, complexity, imageUrl } = req.body;
    if (!categoryId || !text || !options || !correctAnswer || !complexity)
        return res.status(400).json({ error: 'All fields required' });
    try {
        const normalizedQuestion = normalizeSubmittedQuestionOptions(options, correctAnswer);
        if (normalizedQuestion.error) return res.status(400).json({ error: normalizedQuestion.error });
        const catCheck = await pool.query('SELECT id FROM categories WHERE id=$1 AND disabled=FALSE', [categoryId]);
        if (!catCheck.rows.length) return res.status(400).json({ error: `Category ${categoryId} not found` });
        const normalizedImageUrl = normalizeImageUrl(imageUrl);
        if (normalizedImageUrl) {
            const imgSettings = await getImageSettings();
            const maxKb = Number(imgSettings.max_image_kb) || 0;
            const chk = await validateImageUrl(normalizedImageUrl, maxKb);
            if (!chk.ok) return res.status(400).json({ error: chk.error });
        }
        const r = await runQuery(
            `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [categoryId, text, normalizedQuestion.options.a, normalizedQuestion.options.b, normalizedQuestion.options.c, normalizedQuestion.options.d, normalizedQuestion.correctAnswer, complexity, normalizedImageUrl]
        );
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/questions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { categoryId, text, options, correctAnswer, complexity, imageUrl } = req.body;
    try {
        const normalizedQuestion = normalizeSubmittedQuestionOptions(options, correctAnswer);
        if (normalizedQuestion.error) return res.status(400).json({ error: normalizedQuestion.error });
        const normalizedImageUrl = normalizeImageUrl(imageUrl);
        if (normalizedImageUrl) {
            const imgSettings = await getImageSettings();
            const maxKb = Number(imgSettings.max_image_kb) || 0;
            const chk = await validateImageUrl(normalizedImageUrl, maxKb);
            if (!chk.ok) return res.status(400).json({ error: chk.error });
        }
        const r = await runQuery(
            `UPDATE questions SET category_id=$1,text=$2,option_a=$3,option_b=$4,option_c=$5,
             option_d=$6,correct_answer=$7,complexity=$8,image_url=$9 WHERE id=$10 RETURNING *`,
            [categoryId, text, normalizedQuestion.options.a, normalizedQuestion.options.b, normalizedQuestion.options.c, normalizedQuestion.options.d, normalizedQuestion.correctAnswer, complexity, normalizedImageUrl, req.params.id]
        );
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/questions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { disabled } = req.body;
    try {
        const r = await runQuery('UPDATE questions SET disabled=$1 WHERE id=$2 RETURNING *', [disabled, req.params.id]);
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/questions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        await runQuery('DELETE FROM questions WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GAME ───────────────────────────────────────────────────────────────────────
app.get('/game/settings', async (_req, res) => {
    try {
        const settings = await getRateLimitSettings();
        res.json({
            open_trivia_db_enabled: settings.open_trivia_db_enabled !== false,
            skip_per_hour: Math.max(0, Number(settings.skip_per_hour) || 0),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/game/opentdb/next-batch', async (req, res) => {
    const amountParsed = parseInt(req.query.amount, 10);
    const amount = Number.isFinite(amountParsed) ? clamp(amountParsed, 1, 50) : 10;
    try {
        const settings = await getRateLimitSettings();
        if (settings.open_trivia_db_enabled === false) {
            return res.status(403).json({ error: 'OpenTriviaDB is disabled by admin' });
        }
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 7000);
        let r;
        try {
            r = await fetch(`https://opentdb.com/api.php?amount=${amount}&type=multiple`, {
                signal: controller.signal
            });
        } finally {
            clearTimeout(t);
        }
        if (!r.ok) return res.status(502).json({ error: `OpenTriviaDB request failed (${r.status})` });
        const data = await r.json();
        if (!Array.isArray(data?.results)) return res.status(502).json({ error: 'Invalid OpenTriviaDB response' });
        const questions = data.results.map((item, idx) => {
            const correctText = decodeHtmlEntities(item.correct_answer);
            const incorrect = Array.isArray(item.incorrect_answers)
                ? item.incorrect_answers.map(v => decodeHtmlEntities(v))
                : [];
            const shuffled = shuffleArray([correctText, ...incorrect]).slice(0, 4);
            const letters = ['A', 'B', 'C', 'D'];
            const options = shuffled.map((txt, i) => ({ char: letters[i], text: txt }));
            const correctIdx = shuffled.findIndex(v => v === correctText);
            const correctAnswer = correctIdx >= 0 ? letters[correctIdx] : 'A';
            return {
                id: `opentdb-${Date.now()}-${idx}-${crypto.randomBytes(4).toString('hex')}`,
                category: decodeHtmlEntities(item.category) || 'OpenTriviaDB',
                text: decodeHtmlEntities(item.question),
                options,
                complexity: mapOpenTdbDifficulty(item.difficulty),
                image_url: null,
                correctAnswer,
                source: 'OpenTriviaDB'
            };
        }).filter(q => q.text && q.options.length === 4);
        res.json({ source: 'OpenTriviaDB', questions });
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch from OpenTriviaDB' });
    }
});

app.post('/game/skip', async (req, res) => {
    const authUser = getTokenUser(req);
    const { anonymousId } = req.body || {};
    try {
        const settings = await getRateLimitSettings();
        const skipPerHour = Math.max(0, Number(settings.skip_per_hour) || 0);
        if (skipPerHour <= 0) {
            return res.status(403).json({ error: 'Skip is disabled by admin' });
        }

        let rateKey;
        if (authUser) {
            if (await isUserBlocked(authUser.id)) {
                const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [authUser.id]);
                return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
            }
            rateKey = `user:${authUser.id}`;
        } else if (anonymousId) {
            const anon = await pool.query('SELECT id FROM users WHERE id=$1 AND is_anonymous=TRUE', [anonymousId]);
            if (anon.rows.length) {
                rateKey = `anon:${anonymousId}`;
            } else {
                rateKey = `ip:${getClientIp(req)}`;
            }
        } else {
            rateKey = `ip:${getClientIp(req)}`;
        }

        const limit = await enforceRateLimit('skip', rateKey, {
            burstWindowMs: 60 * 60 * 1000,
            burstMax: skipPerHour,
            cooldownMs: 60 * 60 * 1000,
        });
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'Skip limit reached. Please wait before skipping again.',
                retry_after_ms: Math.ceil(limit.retryAfterMs || 0),
            });
        }

        const usage = await pool.query(
            'SELECT count, window_start FROM action_limits WHERE action=$1 AND key=$2',
            ['skip', rateKey]
        );
        const countUsed = usage.rows[0] ? Number(usage.rows[0].count) || 0 : 0;
        const remaining = Math.max(0, skipPerHour - countUsed);
        const resetAt = usage.rows[0]?.window_start
            ? new Date(new Date(usage.rows[0].window_start).getTime() + 60 * 60 * 1000)
            : null;

        res.json({
            success: true,
            remaining,
            reset_at: resetAt ? resetAt.toISOString() : null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/game/opentdb/submit', async (req, res) => {
    const authUser = getTokenUser(req);
    const { selectedAnswer, correctAnswer, anonymousId, elapsedMs, complexity } = req.body || {};
    if (!selectedAnswer || !correctAnswer) {
        return res.status(400).json({ error: 'selectedAnswer and correctAnswer required' });
    }
    const selected = String(selectedAnswer).trim().toUpperCase().slice(0, 1);
    const correct = String(correctAnswer).trim().toUpperCase().slice(0, 1);
    if (!['A', 'B', 'C', 'D'].includes(selected) || !['A', 'B', 'C', 'D'].includes(correct)) {
        return res.status(400).json({ error: 'Answers must be A, B, C, or D' });
    }
    try {
        if (authUser && await isUserBlocked(authUser.id)) {
            const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [authUser.id]);
            return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
        }
        const isCorrect = selected === correct;
        const scoring = await getScoringSettings();
        const points = isCorrect ? computePoints(Number(elapsedMs), complexity, scoring) : 0;

        if (points > 0) {
            if (authUser) {
                await pool.query('UPDATE users SET score=score+$1 WHERE id=$2', [points, authUser.id]);
            } else if (anonymousId) {
                const anonUser = await pool.query('SELECT id FROM users WHERE id=$1 AND is_anonymous=TRUE', [anonymousId]);
                if (anonUser.rows.length) {
                    await pool.query('UPDATE users SET score=score+$1 WHERE id=$2', [points, anonUser.rows[0].id]);
                }
            }
        }

        res.json({ isCorrect, correctAnswer: correct, pointsAwarded: points });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/game/next', async (req, res) => {
    const catParsed = req.query.categoryId ? parseInt(req.query.categoryId, 10) : NaN;
    const catId = Number.isNaN(catParsed) ? null : catParsed;
    const includeIds = catId ? [catId] : parseIdList(req.query.includeCategoryIds || req.query.includeCategories);
    const excludeIds = parseIdList(req.query.excludeCategoryIds || req.query.excludeCategories);
    const filter = categoryFilterSql(includeIds, excludeIds, 1);
    try {
        const count = await pool.query(
            `SELECT COUNT(*)
             FROM questions q
             JOIN categories c ON c.id = q.category_id
             WHERE q.disabled=FALSE AND c.disabled=FALSE ${filter.clause}`,
            filter.params
        );
        if (parseInt(count.rows[0].count) === 0) return res.json({ message: 'No questions available' });
        const qr = await pool.query(
            `SELECT q.*
             FROM questions q
             JOIN categories c ON c.id = q.category_id
             WHERE q.disabled=FALSE AND c.disabled=FALSE ${filter.clause}
             ORDER BY RANDOM()
             LIMIT 1`,
            filter.params
        );
        const q = qr.rows[0];
        const cat = await pool.query('SELECT name FROM categories WHERE id=$1', [q.category_id]);
        const options = compactQuestionOptions([
            { char: 'A', text: q.option_a }, { char: 'B', text: q.option_b },
            { char: 'C', text: q.option_c }, { char: 'D', text: q.option_d }
        ]);
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        res.json({
            id: q.id,
            category: cat.rows[0]?.name || 'General',
            text: q.text,
            options,
            complexity: q.complexity,
            image_url: q.image_url || null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/game/submit', async (req, res) => {
    const authUser = getTokenUser(req);
    const { questionId, selectedAnswer, anonymousId, elapsedMs } = req.body;
    if (!questionId || !selectedAnswer) return res.status(400).json({ error: 'questionId and selectedAnswer required' });
    try {
        if (authUser && await isUserBlocked(authUser.id)) {
            const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [authUser.id]);
            return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
        }
        const qr = await pool.query('SELECT correct_answer, category_id, complexity FROM questions WHERE id=$1', [questionId]);
        if (!qr.rows.length) return res.status(404).json({ error: 'Question not found' });
        const correctAnswer = qr.rows[0].correct_answer.trim().toUpperCase();
        const categoryId = qr.rows[0].category_id;
        const complexity = qr.rows[0].complexity;
        const isCorrect = selectedAnswer.toUpperCase() === correctAnswer;
        const scoring = await getScoringSettings();
        const points = isCorrect ? computePoints(Number(elapsedMs), complexity, scoring) : 0;
        const u = authUser;

        if (u) {
            // Authenticated user - track normally
            await pool.query(
                'INSERT INTO game_sessions (user_id,question_id,category_id,selected_answer,is_correct,points) VALUES ($1,$2,$3,$4,$5,$6)',
                [u.id, questionId, categoryId, selectedAnswer, isCorrect, points]
            );
            if (points > 0) await pool.query('UPDATE users SET score=score+$1 WHERE id=$2', [points, u.id]);
            adjustQuestionDifficulty(questionId, scoring).catch(() => {});
        } else if (anonymousId) {
            // Track under existing anonymous user record
            const anonUser = await pool.query('SELECT id FROM users WHERE id=$1 AND is_anonymous=TRUE', [anonymousId]);
            if (anonUser.rows.length) {
                await pool.query(
                    'INSERT INTO game_sessions (user_id,question_id,category_id,selected_answer,is_correct,points) VALUES ($1,$2,$3,$4,$5,$6)',
                    [anonUser.rows[0].id, questionId, categoryId, selectedAnswer, isCorrect, points]
                );
                if (points > 0) await pool.query('UPDATE users SET score=score+$1 WHERE id=$2', [points, anonUser.rows[0].id]);
                adjustQuestionDifficulty(questionId, scoring).catch(() => {});
            }
        }

        res.json({ isCorrect, correctAnswer, pointsAwarded: points });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create an anonymous tracking record for a guest player
app.post('/game/anonymous-session', async (req, res) => {
    try {
        const anonEmail = `anon_${crypto.randomBytes(8).toString('hex')}@anonymous.local`;
        const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        const r = await runQuery(
            'INSERT INTO users (email,password_hash,role,is_anonymous,display_name,show_email) VALUES ($1,$2,$3,TRUE,$4,FALSE) RETURNING id',
            [anonEmail, hash, 'player', maskEmail(anonEmail)]
        );
        res.json({ anonymousId: r.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Report a question - rate-limited for guests and users
app.post('/game/report', async (req, res) => {
    const u = getTokenUser(req);
    const { questionId, reason } = req.body;
    if (!questionId) return res.status(400).json({ error: 'questionId required' });
    try {
        const limits = await getRateLimitSettings();
        if (u) {
            if (await isUserBlocked(u.id)) {
                const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [u.id]);
                return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
            }
            if (Number(limits.user_burst_max) > 0 && Number(limits.user_burst_window_ms) > 0 && Number(limits.user_cooldown_ms) > 0) {
                const limit = await enforceRateLimit('report', `user:${u.id}`, {
                    burstWindowMs: Number(limits.user_burst_window_ms),
                    burstMax: Number(limits.user_burst_max),
                    cooldownMs: Number(limits.user_cooldown_ms),
                });
                if (!limit.allowed) {
                    return res.status(429).json({ error: 'Too many reports. Please wait.', retry_after_ms: Math.ceil(limit.retryAfterMs) });
                }
            }
        } else {
            const ip = getClientIp(req);
            if (Number(limits.guest_min_interval_ms) > 0) {
                const limit = await enforceRateLimit('report', `ip:${ip}`, {
                    minIntervalMs: Number(limits.guest_min_interval_ms),
                });
                if (!limit.allowed) {
                    return res.status(429).json({ error: 'Please wait before reporting again.', retry_after_ms: Math.ceil(limit.retryAfterMs) });
                }
            }
        }
        const exists = await pool.query('SELECT id FROM questions WHERE id=$1', [questionId]);
        if (!exists.rows.length) return res.status(404).json({ error: 'Question not found' });
        await runQuery('INSERT INTO question_reports (question_id,reason) VALUES ($1,$2)', [questionId, reason || 'Reported by user']);
        console.log(`🚩 Question ${questionId} reported by ${u ? `user ${u.id}` : 'guest'}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LEADERBOARD - excludes anonymous users and admins ──────────────────────────
app.get('/leaderboard', async (req, res) => {
    const { categoryId, timeframe, includeAnonymous } = req.query;
    const catParsed = categoryId ? parseInt(categoryId, 10) : NaN;
    const catId = Number.isNaN(catParsed) ? null : catParsed;
    const now = new Date();
    const viewer = getTokenUser(req);
    const includeAnon = includeAnonymous === '1' || includeAnonymous === 'true';
    let start = new Date(0);
    if (timeframe === 'day') {
        start = new Date(now); start.setHours(0, 0, 0, 0);
    } else if (timeframe === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeframe === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
    }
    try {
        const privacy = await getPrivacySettings();
        const r = await pool.query(`
            WITH global_reset AS (
                SELECT MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='global'
                  AND ($1::int IS NULL OR category_id = $1)
            ),
            user_reset AS (
                SELECT user_id, MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='user'
                  AND ($1::int IS NULL OR category_id = $1)
                GROUP BY user_id
            ),
            scores AS (
                SELECT
                    gs.user_id,
                    SUM(gs.points)::int AS score,
                    COUNT(gs.id)::int AS total_answered,
                    COUNT(gs.id) FILTER (WHERE gs.is_correct = TRUE)::int AS correct_answered
                FROM game_sessions gs
                JOIN users u ON u.id = gs.user_id
                LEFT JOIN user_reset ur ON ur.user_id = gs.user_id
                CROSS JOIN global_reset gr
                WHERE u.role != 'admin'
                  AND (u.blocked_until IS NULL OR u.blocked_until <= NOW())
                  AND ($3::boolean OR u.is_anonymous = FALSE)
                  AND ($1::int IS NULL OR gs.category_id = $1)
                  AND gs.created_at >= GREATEST(
                        COALESCE(gr.ts, '1970-01-01'),
                        COALESCE(ur.ts, '1970-01-01'),
                        $2::timestamp
                  )
                GROUP BY gs.user_id
            )
            SELECT
                u.id,
                u.email,
                u.display_name,
                u.show_email,
                u.discord_avatar_url,
                COALESCE(s.score, 0) AS score,
                COALESCE(s.correct_answered, 0) AS correct_answered,
                COALESCE(s.total_answered, 0) AS total_answered,
                u.role
            FROM users u
            LEFT JOIN scores s ON s.user_id = u.id
            WHERE ($3::boolean OR u.is_anonymous = FALSE)
              AND u.role != 'admin'
              AND (u.blocked_until IS NULL OR u.blocked_until <= NOW())
            ORDER BY score DESC, u.email ASC
            LIMIT 50
        `, [catId, start, includeAnon]);
        const isLoggedIn = !!viewer;
        const rows = r.rows.map((row) => {
            const displayName = row.display_name || maskEmail(row.email);
            const canShowEmail = isLoggedIn && !privacy.hide_emails_globally && resolveShowEmail(row.show_email, privacy);
            return {
                id: row.id,
                email: canShowEmail ? row.email : null,
                gravatar_hash: gravatarHash(row.email),
                discord_avatar_url: row.discord_avatar_url || null,
                display_name: displayName,
                score: row.score,
                correct_answered: row.correct_answered,
                total_answered: row.total_answered,
                role: row.role,
            };
        });
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DISCORD BOT INTEGRATION ──────────────────────────────────────────────────
app.get('/bot/config', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    try {
        const settings = await getDiscordBotSettingsSnapshot();
        res.json({
            public_app_url: settings.public_app_url,
            service_url: settings.service_url,
            discord_link_url: buildDiscordLinkUrl('/'),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bot/categories', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    try {
        const r = await pool.query('SELECT id, name FROM categories WHERE disabled=FALSE ORDER BY name ASC');
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/pending-questions', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const body = req.body || {};
    const categoryName = String(body.categoryName || '').trim();
    const text = String(body.text || '').trim();
    const complexity = String(body.complexity || 'medium').trim().toLowerCase();
    const submittedBy = String(body.submittedBy || '').trim() || 'discord-bot';
    const imageUrl = normalizeImageUrl(body.imageUrl);
    try {
        const normalizedQuestion = normalizeSubmittedQuestionOptions(body.options || {}, body.correctAnswer);
        if (!categoryName || !text || !complexity) {
            return res.status(400).json({ error: 'categoryName, text, and complexity are required' });
        }
        if (normalizedQuestion.error) return res.status(400).json({ error: normalizedQuestion.error });
        if (!['easy', 'medium', 'hard'].includes(complexity)) {
            return res.status(400).json({ error: 'complexity must be easy, medium, or hard' });
        }
        if (imageUrl) {
            const imgSettings = await getImageSettings();
            const maxKb = Number(imgSettings.max_image_kb) || 0;
            const chk = await validateImageUrl(imageUrl, maxKb);
            if (!chk.ok) return res.status(400).json({ error: chk.error });
        }
        const inserted = await runQuery(
            `INSERT INTO pending_questions
             (user_id, submitted_by_email, submitted_via, category_name, text, option_a, option_b, option_c, option_d, correct_answer, complexity, image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [null, submittedBy, 'discord_bot', categoryName, text, normalizedQuestion.options.a, normalizedQuestion.options.b, normalizedQuestion.options.c, normalizedQuestion.options.d, normalizedQuestion.correctAnswer, complexity, imageUrl]
        );
        res.json(inserted.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bot/schedules', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    try {
        const guildId = String(req.query.guildId || '').trim();
        const dueOnly = String(req.query.dueOnly || '').trim() === '1';
        const params = [];
        let where = 'WHERE 1=1';
        if (guildId) {
            params.push(guildId);
            where += ` AND guild_id=$${params.length}`;
        }
        if (dueOnly) {
            where += ' AND enabled=TRUE AND next_run IS NOT NULL AND next_run <= NOW()';
        }
        const r = await pool.query(
            `SELECT s.*, c.name AS category_name
             FROM discord_trivia_schedules s
             LEFT JOIN categories c ON c.id = s.category_id
             ${where}
             ORDER BY s.guild_id ASC, s.channel_id ASC, s.id ASC`,
            params
        );
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/schedules', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const body = req.body || {};
    const guildId = String(body.guildId || '').trim();
    const channelId = String(body.channelId || '').trim();
    let categoryId = body.categoryId ? parseInt(body.categoryId, 10) : null;
    const categoryName = String(body.categoryName || '').trim();
    const questionCount = Math.max(1, Math.min(20, parseInt(body.questionCount, 10) || 1));
    const scheduleKind = String(body.scheduleKind || '').trim().toLowerCase();
    const intervalMinutes = Math.max(1, parseInt(body.intervalMinutes, 10) || 0);
    const intervalMinMinutes = Math.max(1, parseInt(body.intervalMinMinutes, 10) || 0);
    const intervalMaxMinutes = Math.max(1, parseInt(body.intervalMaxMinutes, 10) || 0);
    const dailyTime = String(body.dailyTime || '').trim();
    const commentMinCount = Math.max(1, parseInt(body.commentMinCount, 10) || 0);
    const commentMaxCount = Math.max(1, parseInt(body.commentMaxCount, 10) || 0);
    if (!guildId || !channelId) return res.status(400).json({ error: 'guildId and channelId required' });
    if (!['daily', 'interval', 'random_interval', 'comment_range'].includes(scheduleKind)) return res.status(400).json({ error: 'Invalid scheduleKind' });
    if (scheduleKind === 'daily' && !/^\d{2}:\d{2}$/.test(dailyTime)) return res.status(400).json({ error: 'dailyTime must be HH:MM' });
    if (scheduleKind === 'interval' && intervalMinutes <= 0) return res.status(400).json({ error: 'intervalMinutes must be > 0' });
    if (scheduleKind === 'random_interval' && (intervalMinMinutes <= 0 || intervalMaxMinutes <= 0)) return res.status(400).json({ error: 'intervalMinMinutes and intervalMaxMinutes must be > 0' });
    if (scheduleKind === 'comment_range' && (commentMinCount <= 0 || commentMaxCount <= 0)) return res.status(400).json({ error: 'commentMinCount and commentMaxCount must be > 0' });
    try {
        if (!Number.isFinite(categoryId) && categoryName) {
            const cat = await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND disabled=FALSE LIMIT 1', [categoryName]);
            if (!cat.rows.length) return res.status(400).json({ error: 'Category not found' });
            categoryId = cat.rows[0].id;
        }
        const normalizedIntervalMin = scheduleKind === 'random_interval' ? Math.min(intervalMinMinutes, intervalMaxMinutes) : null;
        const normalizedIntervalMax = scheduleKind === 'random_interval' ? Math.max(intervalMinMinutes, intervalMaxMinutes) : null;
        const normalizedCommentMin = scheduleKind === 'comment_range' ? Math.min(commentMinCount, commentMaxCount) : null;
        const normalizedCommentMax = scheduleKind === 'comment_range' ? Math.max(commentMinCount, commentMaxCount) : null;
        const nextCommentTarget = scheduleKind === 'comment_range'
            ? computeDiscordCommentTarget({ comment_min_count: normalizedCommentMin, comment_max_count: normalizedCommentMax })
            : null;
        const nextRun = computeDiscordScheduleNextRun({
            schedule_kind: scheduleKind,
            interval_minutes: intervalMinutes,
            interval_min_minutes: normalizedIntervalMin,
            interval_max_minutes: normalizedIntervalMax,
            daily_time: dailyTime
        });
        const r = await pool.query(
            `INSERT INTO discord_trivia_schedules (
                guild_id, channel_id, category_id, question_count, schedule_kind, interval_minutes, interval_min_minutes, interval_max_minutes, daily_time, comment_min_count, comment_max_count, current_comment_count, next_comment_target, enabled, next_run
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [
                guildId,
                channelId,
                categoryId,
                questionCount,
                scheduleKind,
                scheduleKind === 'interval' ? intervalMinutes : null,
                normalizedIntervalMin,
                normalizedIntervalMax,
                scheduleKind === 'daily' ? dailyTime : null,
                normalizedCommentMin,
                normalizedCommentMax,
                scheduleKind === 'comment_range' ? 0 : null,
                nextCommentTarget,
                true,
                nextRun
            ]
        );
        const created = await pool.query(
            `SELECT s.*, c.name AS category_name
             FROM discord_trivia_schedules s
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id=$1`,
            [r.rows[0].id]
        );
        res.json(created.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/bot/schedules/:id', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body || {};
    const guildId = String(body.guildId || '').trim() || null;
    try {
        const current = guildId
            ? await pool.query('SELECT * FROM discord_trivia_schedules WHERE id=$1 AND guild_id=$2', [id, guildId])
            : await pool.query('SELECT * FROM discord_trivia_schedules WHERE id=$1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Schedule not found' });
        const row = current.rows[0];
        let nextCategoryId = body.categoryId === null ? null : (body.categoryId !== undefined ? parseInt(body.categoryId, 10) : row.category_id);
        const categoryName = String(body.categoryName || '').trim();
        if (!Number.isFinite(nextCategoryId) && categoryName) {
            const cat = await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND disabled=FALSE LIMIT 1', [categoryName]);
            if (!cat.rows.length) return res.status(400).json({ error: 'Category not found' });
            nextCategoryId = cat.rows[0].id;
        }
        const next = {
            channel_id: body.channelId !== undefined ? String(body.channelId || '').trim() : row.channel_id,
            category_id: nextCategoryId,
            question_count: body.questionCount !== undefined ? Math.max(1, Math.min(20, parseInt(body.questionCount, 10) || row.question_count)) : row.question_count,
            schedule_kind: body.scheduleKind ? String(body.scheduleKind).trim().toLowerCase() : row.schedule_kind,
            interval_minutes: body.intervalMinutes !== undefined ? Math.max(1, parseInt(body.intervalMinutes, 10) || row.interval_minutes || 1) : row.interval_minutes,
            interval_min_minutes: body.intervalMinMinutes !== undefined ? Math.max(1, parseInt(body.intervalMinMinutes, 10) || row.interval_min_minutes || 1) : row.interval_min_minutes,
            interval_max_minutes: body.intervalMaxMinutes !== undefined ? Math.max(1, parseInt(body.intervalMaxMinutes, 10) || row.interval_max_minutes || 1) : row.interval_max_minutes,
            daily_time: body.dailyTime !== undefined ? String(body.dailyTime || '').trim() : row.daily_time,
            comment_min_count: body.commentMinCount !== undefined ? Math.max(1, parseInt(body.commentMinCount, 10) || row.comment_min_count || 1) : row.comment_min_count,
            comment_max_count: body.commentMaxCount !== undefined ? Math.max(1, parseInt(body.commentMaxCount, 10) || row.comment_max_count || 1) : row.comment_max_count,
            current_comment_count: row.current_comment_count,
            next_comment_target: row.next_comment_target,
            enabled: typeof body.enabled === 'boolean' ? body.enabled : row.enabled,
        };
        if (!next.channel_id) return res.status(400).json({ error: 'channelId is required' });
        if (!['daily', 'interval', 'random_interval', 'comment_range'].includes(next.schedule_kind)) return res.status(400).json({ error: 'Invalid scheduleKind' });
        if (next.schedule_kind === 'daily' && !/^\d{2}:\d{2}$/.test(String(next.daily_time || ''))) return res.status(400).json({ error: 'dailyTime must be HH:MM' });
        if (next.schedule_kind === 'interval' && (!Number.isFinite(Number(next.interval_minutes)) || Number(next.interval_minutes) <= 0)) {
            return res.status(400).json({ error: 'intervalMinutes must be > 0' });
        }
        if (next.schedule_kind === 'random_interval' && (!Number.isFinite(Number(next.interval_min_minutes)) || !Number.isFinite(Number(next.interval_max_minutes)) || Number(next.interval_min_minutes) <= 0 || Number(next.interval_max_minutes) <= 0)) {
            return res.status(400).json({ error: 'intervalMinMinutes and intervalMaxMinutes must be > 0' });
        }
        if (next.schedule_kind === 'comment_range' && (!Number.isFinite(Number(next.comment_min_count)) || !Number.isFinite(Number(next.comment_max_count)) || Number(next.comment_min_count) <= 0 || Number(next.comment_max_count) <= 0)) {
            return res.status(400).json({ error: 'commentMinCount and commentMaxCount must be > 0' });
        }
        if (next.schedule_kind === 'random_interval') {
            const normalizedMin = Math.min(Number(next.interval_min_minutes), Number(next.interval_max_minutes));
            const normalizedMax = Math.max(Number(next.interval_min_minutes), Number(next.interval_max_minutes));
            next.interval_min_minutes = normalizedMin;
            next.interval_max_minutes = normalizedMax;
        }
        if (next.schedule_kind === 'comment_range') {
            const normalizedMin = Math.min(Number(next.comment_min_count), Number(next.comment_max_count));
            const normalizedMax = Math.max(Number(next.comment_min_count), Number(next.comment_max_count));
            next.comment_min_count = normalizedMin;
            next.comment_max_count = normalizedMax;
            next.current_comment_count = 0;
            next.next_comment_target = computeDiscordCommentTarget(next);
        }
        const nextRun = next.enabled ? computeDiscordScheduleNextRun(next) : null;
        const r = await pool.query(
            `UPDATE discord_trivia_schedules
             SET channel_id=$2, category_id=$3, question_count=$4, schedule_kind=$5, interval_minutes=$6, interval_min_minutes=$7, interval_max_minutes=$8, daily_time=$9, comment_min_count=$10, comment_max_count=$11, current_comment_count=$12, next_comment_target=$13, enabled=$14, next_run=$15
             WHERE id=$1
             RETURNING *`,
            [
                id,
                next.channel_id,
                next.category_id,
                next.question_count,
                next.schedule_kind,
                next.schedule_kind === 'interval' ? next.interval_minutes : null,
                next.schedule_kind === 'random_interval' ? next.interval_min_minutes : null,
                next.schedule_kind === 'random_interval' ? next.interval_max_minutes : null,
                next.schedule_kind === 'daily' ? next.daily_time : null,
                next.schedule_kind === 'comment_range' ? next.comment_min_count : null,
                next.schedule_kind === 'comment_range' ? next.comment_max_count : null,
                next.schedule_kind === 'comment_range' ? next.current_comment_count : null,
                next.schedule_kind === 'comment_range' ? next.next_comment_target : null,
                next.enabled,
                nextRun
            ]
        );
        const updated = await pool.query(
            `SELECT s.*, c.name AS category_name
             FROM discord_trivia_schedules s
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id=$1`,
            [r.rows[0].id]
        );
        res.json(updated.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/bot/schedules/:id', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const id = parseInt(req.params.id, 10);
    const guildId = String(req.query.guildId || '').trim() || null;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const result = guildId
            ? await pool.query('DELETE FROM discord_trivia_schedules WHERE id=$1 AND guild_id=$2', [id, guildId])
            : await pool.query('DELETE FROM discord_trivia_schedules WHERE id=$1', [id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Schedule not found' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/schedules/:id/mark-run', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body || {};
    const status = String(body.status || 'success').trim().toLowerCase();
    const errorMessage = String(body.error || '').trim() || null;
    try {
        const current = await pool.query('SELECT * FROM discord_trivia_schedules WHERE id=$1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Schedule not found' });
        const row = current.rows[0];
        const nextRun = row.enabled ? computeDiscordScheduleNextRun(row, new Date()) : null;
        const nextCommentTarget = row.enabled && row.schedule_kind === 'comment_range'
            ? computeDiscordCommentTarget(row)
            : row.next_comment_target;
        const r = await pool.query(
            `UPDATE discord_trivia_schedules
             SET last_run=NOW(), next_run=$2, current_comment_count=$3, next_comment_target=$4, last_status=$5, last_error=$6
             WHERE id=$1
             RETURNING *`,
            [
                id,
                nextRun,
                row.schedule_kind === 'comment_range' ? 0 : row.current_comment_count,
                nextCommentTarget,
                status === 'failed' ? 'failed' : 'success',
                status === 'failed' ? errorMessage : null
            ]
        );
        const updated = await pool.query(
            `SELECT s.*, c.name AS category_name
             FROM discord_trivia_schedules s
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id=$1`,
            [r.rows[0].id]
        );
        res.json(updated.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/schedules/comment-event', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const body = req.body || {};
    const guildId = String(body.guildId || '').trim();
    const channelId = String(body.channelId || '').trim();
    if (!guildId || !channelId) return res.status(400).json({ error: 'guildId and channelId required' });
    try {
        const current = await pool.query(
            `SELECT * FROM discord_trivia_schedules
             WHERE guild_id=$1
               AND channel_id=$2
               AND enabled=TRUE
               AND schedule_kind='comment_range'
             ORDER BY id ASC`,
            [guildId, channelId]
        );
        if (!current.rows.length) {
            res.json([]);
            return;
        }
        const dueIds = [];
        for (const row of current.rows) {
            const target = Number.isFinite(Number(row.next_comment_target))
                ? Number(row.next_comment_target)
                : computeDiscordCommentTarget(row);
            const nextCount = Number(row.current_comment_count || 0) + 1;
            await pool.query(
                `UPDATE discord_trivia_schedules
                 SET current_comment_count=$2, next_comment_target=$3
                 WHERE id=$1`,
                [row.id, nextCount, target]
            );
            if (nextCount >= target) dueIds.push(row.id);
        }
        if (!dueIds.length) {
            res.json([]);
            return;
        }
        const due = await pool.query(
            `SELECT s.*, c.name AS category_name
             FROM discord_trivia_schedules s
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id = ANY($1::int[])
             ORDER BY s.id ASC`,
            [dueIds]
        );
        res.json(due.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/trivia/questions', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const body = req.body || {};
    const guildId = String(body.guildId || '').trim() || null;
    const channelId = String(body.channelId || '').trim() || null;
    const messageId = String(body.messageId || '').trim() || null;
    const mode = String(body.mode || 'public').trim().toLowerCase();
    const promptUserDiscordId = String(body.promptUserDiscordId || '').trim() || null;
    const count = Math.max(1, Math.min(20, parseInt(body.count, 10) || 1));
    const closeAfterSeconds = Math.max(15, Math.min(604800, parseInt(body.closeAfterSeconds, 10) || 86400));
    let categoryId = body.categoryId ? parseInt(body.categoryId, 10) : null;
    const categoryName = String(body.categoryName || '').trim();
    try {
        if (!categoryId && categoryName) {
            const cat = await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND disabled=FALSE LIMIT 1', [categoryName]);
            if (cat.rows.length) categoryId = cat.rows[0].id;
        }
        const r = await pool.query(
            `SELECT q.*, c.name AS category_name
             FROM questions q
             JOIN categories c ON c.id = q.category_id
             WHERE q.disabled=FALSE AND c.disabled=FALSE AND ($1::int IS NULL OR q.category_id=$1)
             ORDER BY RANDOM()
             LIMIT $2`,
            [categoryId, count]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'No questions available' });

        const sessions = [];
        for (const row of r.rows) {
            const closesAt = new Date(Date.now() + closeAfterSeconds * 1000);
            const session = await pool.query(
                `INSERT INTO discord_trivia_sessions (
                    guild_id, channel_id, message_id, question_id, category_id, mode, prompt_user_discord_id, close_after_seconds, closes_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING *`,
                [guildId, channelId, messageId, row.id, row.category_id, mode, promptUserDiscordId, closeAfterSeconds, closesAt]
            );
            const options = shuffleArray(compactQuestionOptions([
                { char: 'A', text: row.option_a },
                { char: 'B', text: row.option_b },
                { char: 'C', text: row.option_c },
                { char: 'D', text: row.option_d },
            ]));
            sessions.push({
                session_id: session.rows[0].id,
                closes_at: closesAt.toISOString(),
                question: {
                    id: row.id,
                    category_id: row.category_id,
                    category: row.category_name,
                    text: row.text,
                    options,
                    complexity: row.complexity,
                    image_url: row.image_url || null,
                }
            });
        }
        res.json({ sessions });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bot/trivia/sessions/open', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    try {
        const r = await pool.query(
            `SELECT s.*
             FROM discord_trivia_sessions s
             WHERE s.closed_at IS NULL AND s.closes_at > NOW()
             ORDER BY s.closes_at ASC`
        );
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/trivia/sessions/:id/answer', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const discordUserId = String(body.discordUserId || '').trim();
    const discordUsername = String(body.discordUsername || '').trim() || null;
    const discordAvatarUrl = normalizeImageUrl(body.discordAvatarUrl);
    const selectedAnswer = String(body.selectedAnswer || '').trim().toUpperCase().slice(0, 1);
    const elapsedMs = Number(body.elapsedMs) || 0;
    if (!Number.isFinite(id) || !discordUserId || !['A', 'B', 'C', 'D'].includes(selectedAnswer)) {
        return res.status(400).json({ error: 'session id, discordUserId, and selectedAnswer are required' });
    }
    try {
        const sessionRes = await pool.query(
            `SELECT s.*, q.correct_answer, q.complexity, q.category_id, q.option_a, q.option_b, q.option_c, q.option_d
             FROM discord_trivia_sessions s
             JOIN questions q ON q.id = s.question_id
             WHERE s.id=$1`,
            [id]
        );
        if (!sessionRes.rows.length) return res.status(404).json({ error: 'Session not found' });
        const session = sessionRes.rows[0];
        if (session.closed_at || (session.closes_at && new Date(session.closes_at) <= new Date())) {
            return res.status(409).json({ error: 'Session is closed' });
        }
        if (session.mode === 'direct' && session.prompt_user_discord_id && session.prompt_user_discord_id !== discordUserId) {
            return res.status(403).json({ error: 'This session is limited to a single user' });
        }

        const existing = await pool.query('SELECT id FROM discord_trivia_answers WHERE session_id=$1 AND discord_user_id=$2', [id, discordUserId]);
        if (existing.rows.length) return res.status(409).json({ error: 'User already answered' });

        const linkedUser = await ensureDiscordTriviaUser({
            discordUserId,
            discordUsername,
            discordAvatarUrl,
        });
        if (linkedUser?.blocked_until && new Date(linkedUser.blocked_until) > new Date() && linkedUser.role !== 'admin') {
            return res.status(403).json({ error: 'Account is blocked', blocked_until: linkedUser.blocked_until });
        }

        const isCorrect = selectedAnswer === String(session.correct_answer || '').trim().toUpperCase();
        const scoring = await getScoringSettings();
        const points = isCorrect ? computeDiscordPoints(session.complexity, scoring) : 0;
        const optionLookup = {
            A: session.option_a,
            B: session.option_b,
            C: session.option_c,
            D: session.option_d,
        };
        const correctAnswer = String(session.correct_answer || '').trim().toUpperCase();
        const correctAnswerText = String(optionLookup[correctAnswer] || '').trim();
        const correctAnswerLabel = correctAnswerText ? `${correctAnswer}: ${correctAnswerText}` : correctAnswer;
        const insert = await pool.query(
            `INSERT INTO discord_trivia_answers (
                session_id, guild_id, channel_id, question_id, category_id, discord_user_id, discord_username, user_id, selected_answer, is_correct, points_awarded
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [id, session.guild_id, session.channel_id, session.question_id, session.category_id, discordUserId, discordUsername, linkedUser?.id || null, selectedAnswer, isCorrect, points]
        );
        await pool.query(
            'INSERT INTO game_sessions (user_id,question_id,category_id,selected_answer,is_correct,points,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
            [linkedUser.id, session.question_id, session.category_id, selectedAnswer, isCorrect, points]
        );
        if (points > 0) {
            await pool.query('UPDATE users SET score=score+$1 WHERE id=$2', [points, linkedUser.id]);
        }
        adjustQuestionDifficulty(session.question_id, scoring).catch(() => {});
        const countRes = await pool.query('SELECT COUNT(*) FROM discord_trivia_answers WHERE session_id=$1', [id]);
        res.json({
            accepted: true,
            answer: insert.rows[0],
            linked: true,
            link_url: null,
            is_correct: isCorrect,
            points_awarded: points,
            difficulty: String(session.complexity || '').trim().toLowerCase() || 'medium',
            answered_count: parseInt(countRes.rows[0].count, 10) || 0,
            correct_answer: correctAnswer,
            correct_answer_text: correctAnswerText,
            correct_answer_label: correctAnswerLabel,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bot/trivia/sessions/:id/close', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const sessionRes = await pool.query(
            `SELECT s.*, q.correct_answer, q.option_a, q.option_b, q.option_c, q.option_d, c.name AS category_name
             FROM discord_trivia_sessions s
             JOIN questions q ON q.id = s.question_id
             LEFT JOIN categories c ON c.id = s.category_id
             WHERE s.id=$1`,
            [id]
        );
        if (!sessionRes.rows.length) return res.status(404).json({ error: 'Session not found' });
        const session = sessionRes.rows[0];
        if (!session.closed_at) {
            await pool.query('UPDATE discord_trivia_sessions SET closed_at=NOW() WHERE id=$1', [id]);
        }
        const answers = await pool.query(
            `SELECT selected_answer,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE is_correct=TRUE)::int AS correct_total
             FROM discord_trivia_answers
             WHERE session_id=$1
             GROUP BY selected_answer
             ORDER BY selected_answer ASC`,
            [id]
        );
        res.json({
            session_id: session.id,
            question_id: session.question_id,
            category: session.category_name || 'General',
            correct_answer: String(session.correct_answer).trim().toUpperCase(),
            answer_counts: answers.rows,
            total_answers: answers.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
            options: {
                A: session.option_a,
                B: session.option_b,
                C: session.option_c,
                D: session.option_d,
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bot/leaderboard', async (req, res) => {
    const bot = await requireBot(req, res);
    if (!bot) return;
    const guildId = String(req.query.guildId || '').trim();
    let categoryId = req.query.categoryId ? parseInt(req.query.categoryId, 10) : null;
    const categoryName = String(req.query.categoryName || '').trim();
    const timeframe = String(req.query.timeframe || 'all').trim().toLowerCase();
    const now = new Date();
    let start = new Date(0);
    if (timeframe === 'today' || timeframe === 'day') {
        start = new Date(now); start.setHours(0, 0, 0, 0);
    } else if (timeframe === 'this month' || timeframe === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeframe === 'this year' || timeframe === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
    }
    try {
        if (!categoryId && categoryName) {
            const cat = await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1) LIMIT 1', [categoryName]);
            if (cat.rows.length) categoryId = cat.rows[0].id;
        }
        const globalRows = await pool.query(
            `SELECT u.id, u.display_name, u.email, u.discord_avatar_url, u.role,
                    COALESCE(SUM(dta.points_awarded), 0)::int AS score,
                    COUNT(dta.id)::int AS total_answered,
                    COUNT(dta.id) FILTER (WHERE dta.is_correct=TRUE)::int AS correct_answered
             FROM discord_trivia_answers dta
             LEFT JOIN users u ON u.id = dta.user_id
             WHERE dta.user_id IS NOT NULL
               AND dta.answered_at >= $1
               AND ($2::int IS NULL OR dta.category_id = $2)
             GROUP BY u.id
             ORDER BY score DESC, u.email ASC
             LIMIT 25`,
            [start, categoryId]
        );
        let serverRows = [];
        if (guildId) {
            const serverRes = await pool.query(
                `SELECT u.id, u.display_name, u.email, u.discord_avatar_url, u.role,
                        COALESCE(SUM(dta.points_awarded), 0)::int AS score,
                        COUNT(dta.id)::int AS total_answered,
                        COUNT(dta.id) FILTER (WHERE dta.is_correct=TRUE)::int AS correct_answered
                 FROM discord_trivia_answers dta
                 LEFT JOIN users u ON u.id = dta.user_id
                 WHERE dta.user_id IS NOT NULL
                   AND dta.guild_id = $1
                   AND dta.answered_at >= $2
                   AND ($3::int IS NULL OR dta.category_id = $3)
                 GROUP BY u.id
                 ORDER BY score DESC, u.email ASC
                 LIMIT 25`,
                [guildId, start, categoryId]
            );
            serverRows = serverRes.rows;
        }
        res.json({ server: serverRows, global: globalRows.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── USER: RESET SCORE ─────────────────────────────────────────────────────────-
app.post('/me/reset-score', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { categoryId } = req.body || {};
    const catParsed = categoryId ? parseInt(categoryId, 10) : NaN;
    const catId = Number.isNaN(catParsed) ? null : catParsed;
    try {
        await runQuery(
            `INSERT INTO score_resets (scope, user_id, category_id, reason)
             VALUES ('user', $1, $2, $3)`,
            [u.id, catId, 'user_reset']
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── USER: STATS DASHBOARD ─────────────────────────────────────────────────────
app.get('/me/stats', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { timeframe } = req.query;
    const now = new Date();
    let start = new Date(0);
    if (timeframe === 'day') {
        start = new Date(now); start.setHours(0, 0, 0, 0);
    } else if (timeframe === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeframe === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
    }
    try {
        const base = await pool.query(`
            WITH global_reset AS (
                SELECT MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='global'
            ),
            user_reset AS (
                SELECT MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='user' AND user_id=$1
            ),
            filtered AS (
                SELECT *
                FROM game_sessions
                WHERE user_id=$1
                  AND created_at >= GREATEST(
                        COALESCE((SELECT ts FROM global_reset), '1970-01-01'),
                        COALESCE((SELECT ts FROM user_reset), '1970-01-01'),
                        $2::timestamp
                  )
            )
            SELECT
                COALESCE(SUM(points), 0)::int AS total_points,
                COUNT(*)::int AS total_answered,
                COUNT(*) FILTER (WHERE is_correct = TRUE)::int AS correct_answered
            FROM filtered
        `, [u.id, start]);

        const byCat = await pool.query(`
            WITH global_reset AS (
                SELECT MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='global'
            ),
            user_reset AS (
                SELECT MAX(reset_at) AS ts
                FROM score_resets
                WHERE scope='user' AND user_id=$1
            ),
            filtered AS (
                SELECT *
                FROM game_sessions
                WHERE user_id=$1
                  AND created_at >= GREATEST(
                        COALESCE((SELECT ts FROM global_reset), '1970-01-01'),
                        COALESCE((SELECT ts FROM user_reset), '1970-01-01'),
                        $2::timestamp
                  )
            )
            SELECT c.id AS category_id, c.name AS category_name,
                   COALESCE(SUM(f.points), 0)::int AS points,
                   COUNT(f.id)::int AS total_answered,
                   COUNT(f.id) FILTER (WHERE f.is_correct = TRUE)::int AS correct_answered
            FROM filtered f
            JOIN categories c ON c.id = f.category_id
            GROUP BY c.id
            ORDER BY points DESC
        `, [u.id, start]);

        const recent = await pool.query(`
            SELECT gs.id, gs.is_correct, gs.points, gs.created_at,
                   q.text AS question_text, q.complexity,
                   c.name AS category_name
            FROM game_sessions gs
            JOIN questions q ON q.id = gs.question_id
            JOIN categories c ON c.id = gs.category_id
            WHERE gs.user_id=$1
            ORDER BY gs.created_at DESC
            LIMIT 10
        `, [u.id]);

        res.json({
            totals: base.rows[0],
            byCategory: byCat.rows,
            recent: recent.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── USER: CUSTOM CATEGORY GROUPS ─────────────────────────────────────────────
function normalizeCustomGroupRow(row) {
    return {
        id: row.id,
        name: row.name,
        include_category_ids: row.include_category_ids || [],
        exclude_category_ids: row.exclude_category_ids || [],
        categories: row.categories || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

app.get('/me/category-groups', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    try {
        const r = await pool.query(`
            SELECT g.*,
                   COALESCE(
                       json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                       FILTER (WHERE c.id IS NOT NULL),
                       '[]'
                   ) AS categories
            FROM custom_category_groups g
            LEFT JOIN categories c
              ON c.id = ANY(g.include_category_ids)
             AND c.disabled = FALSE
            WHERE g.user_id=$1
            GROUP BY g.id
            ORDER BY g.updated_at DESC, g.name ASC
        `, [u.id]);
        res.json(r.rows.map(normalizeCustomGroupRow));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/me/category-groups', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const includeIds = parseIdList(req.body?.includeCategoryIds || req.body?.include_category_ids);
    const excludeIds = parseIdList(req.body?.excludeCategoryIds || req.body?.exclude_category_ids);
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!includeIds.length && !excludeIds.length) return res.status(400).json({ error: 'Select at least one category' });
    try {
        const r = await runQuery(
            `INSERT INTO custom_category_groups (user_id, name, include_category_ids, exclude_category_ids)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [u.id, name, includeIds, excludeIds]
        );
        res.json(normalizeCustomGroupRow(r.rows[0]));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/me/category-groups/:id', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    try {
        const r = await runQuery(
            'DELETE FROM custom_category_groups WHERE id=$1 AND user_id=$2 RETURNING id',
            [req.params.id, u.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Group not found' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── USER: PROFILE / PRIVACY ───────────────────────────────────────────────────
app.get('/me/profile', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    try {
        const r = await pool.query(
            'SELECT email, display_name, show_email, discord_id, discord_username, animations_enabled FROM users WHERE id=$1',
            [u.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
        const privacy = await getPrivacySettings();
        let displayName = r.rows[0].display_name;
        if (!displayName) {
            displayName = maskEmail(r.rows[0].email);
            await runQuery('UPDATE users SET display_name=$1 WHERE id=$2', [displayName, u.id]);
        }
        const showEmailResolved = resolveShowEmail(r.rows[0].show_email, privacy);
        const effectiveShowEmail = !privacy.hide_emails_globally && showEmailResolved;
        res.json({
            email: r.rows[0].email,
            display_name: displayName,
            show_email: showEmailResolved,
            effective_show_email: effectiveShowEmail,
            hide_emails_globally: privacy.hide_emails_globally,
            hide_emails_by_default: privacy.hide_emails_by_default,
            discord_linked: !!r.rows[0].discord_id,
            discord_username: r.rows[0].discord_username,
            can_link_discord: !r.rows[0].discord_id,
            uses_discord_email_only: isDiscordOnlyEmail(r.rows[0].email),
            animations_enabled: r.rows[0].animations_enabled !== false,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/me/profile', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { displayName, showEmail, animationsEnabled } = req.body || {};
    try {
        const r = await pool.query('SELECT email FROM users WHERE id=$1', [u.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
        const email = r.rows[0].email;
        const updates = [];
        const params = [];
        if (displayName !== undefined) {
            let nextName = String(displayName || '').trim();
            if (!nextName) nextName = maskEmail(email);
            if (nextName.length > 60) nextName = nextName.slice(0, 60);
            params.push(nextName);
            updates.push(`display_name=$${params.length}`);
        }
        if (typeof showEmail === 'boolean') {
            params.push(showEmail);
            updates.push(`show_email=$${params.length}`);
        }
        if (typeof animationsEnabled === 'boolean') {
            params.push(animationsEnabled);
            updates.push(`animations_enabled=$${params.length}`);
        }
        if (updates.length) {
            params.push(u.id);
            await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id=$${params.length}`, params);
        }
        const privacy = await getPrivacySettings();
        const updated = await pool.query('SELECT email, display_name, show_email, discord_id, discord_username, animations_enabled FROM users WHERE id=$1', [u.id]);
        const displayNameFinal = updated.rows[0].display_name || maskEmail(updated.rows[0].email);
        const showEmailResolved = resolveShowEmail(updated.rows[0].show_email, privacy);
        const effectiveShowEmail = !privacy.hide_emails_globally && showEmailResolved;
        res.json({
            email: updated.rows[0].email,
            display_name: displayNameFinal,
            show_email: showEmailResolved,
            effective_show_email: effectiveShowEmail,
            hide_emails_globally: privacy.hide_emails_globally,
            hide_emails_by_default: privacy.hide_emails_by_default,
            discord_linked: !!updated.rows[0].discord_id,
            discord_username: updated.rows[0].discord_username,
            can_link_discord: !updated.rows[0].discord_id,
            uses_discord_email_only: isDiscordOnlyEmail(updated.rows[0].email),
            animations_enabled: updated.rows[0].animations_enabled !== false,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/me/profile/add-email', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    try {
        const current = await pool.query('SELECT * FROM users WHERE id=$1', [u.id]);
        if (!current.rows.length) return res.status(404).json({ error: 'User not found' });
        if (!isDiscordOnlyEmail(current.rows[0].email)) {
            return res.status(400).json({ error: 'This account already has a normal email address' });
        }
        const existing = await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1', [normalizedEmail, u.id]);
        if (existing.rows.length) {
            return res.status(400).json({ error: 'That email address is already in use' });
        }
        const hashed = await bcrypt.hash(password, 10);
        const updated = await pool.query(
            'UPDATE users SET email=$1, password_hash=$2 WHERE id=$3 RETURNING *',
            [normalizedEmail, hashed, u.id]
        );
        const privacy = await getPrivacySettings();
        const user = normalizeUserRow(updated.rows[0], privacy);
        res.json({ user, token: signAuthToken(user) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PENDING QUESTIONS - rate-limited for guests and users ─────────────────────
app.post('/pending-questions', async (req, res) => {
    const u = getTokenUser(req);
    const { categoryName, text, options, correctAnswer, complexity, imageUrl } = req.body;
    if (!categoryName || !text || !options || !correctAnswer || !complexity)
        return res.status(400).json({ error: 'All fields required' });
    try {
        const normalizedQuestion = normalizeSubmittedQuestionOptions(options, correctAnswer);
        if (normalizedQuestion.error) return res.status(400).json({ error: normalizedQuestion.error });
        const limits = await getRateLimitSettings();
        let email = 'anonymous';
        let userId = null;
        if (u) {
            if (await isUserBlocked(u.id)) {
                const r = await pool.query('SELECT blocked_until FROM users WHERE id=$1', [u.id]);
                return res.status(403).json({ error: 'Account is blocked', blocked_until: r.rows[0]?.blocked_until });
            }
            if (Number(limits.user_burst_max) > 0 && Number(limits.user_burst_window_ms) > 0 && Number(limits.user_cooldown_ms) > 0) {
                const limit = await enforceRateLimit('suggest', `user:${u.id}`, {
                    burstWindowMs: Number(limits.user_burst_window_ms),
                    burstMax: Number(limits.user_burst_max),
                    cooldownMs: Number(limits.user_cooldown_ms),
                });
                if (!limit.allowed) {
                    return res.status(429).json({ error: 'Too many suggestions. Please wait.', retry_after_ms: Math.ceil(limit.retryAfterMs) });
                }
            }
            const userRow = await pool.query('SELECT email FROM users WHERE id=$1', [u.id]);
            email = userRow.rows.length ? userRow.rows[0].email : 'unknown';
            userId = u.id;
        } else {
            const ip = getClientIp(req);
            if (Number(limits.guest_min_interval_ms) > 0) {
                const limit = await enforceRateLimit('suggest', `ip:${ip}`, {
                    minIntervalMs: Number(limits.guest_min_interval_ms),
                });
                if (!limit.allowed) {
                    return res.status(429).json({ error: 'Please wait before suggesting again.', retry_after_ms: Math.ceil(limit.retryAfterMs) });
                }
            }
        }
        const normalizedImageUrl = normalizeImageUrl(imageUrl);
        if (normalizedImageUrl) {
            const imgSettings = await getImageSettings();
            const maxKb = Number(imgSettings.max_image_kb) || 0;
            const chk = await validateImageUrl(normalizedImageUrl, maxKb);
            if (!chk.ok) return res.status(400).json({ error: chk.error });
        }
        await runQuery(
            `INSERT INTO pending_questions
             (user_id,submitted_by_email,submitted_via,category_name,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [userId, email, 'site', categoryName, text, normalizedQuestion.options.a, normalizedQuestion.options.b, normalizedQuestion.options.c, normalizedQuestion.options.d, normalizedQuestion.correctAnswer, complexity, normalizedImageUrl]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: USERS ───────────────────────────────────────────────────────────────
app.get('/admin/users', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query(`
            SELECT u.id, u.email, u.role, u.is_anonymous, u.blocked_until, u.blocked_reason, u.display_name, u.show_email,
                   u.discord_id, u.discord_username, u.discord_avatar_url,
                   COALESCE(SUM(gs.points), 0)::int AS score,
                   COUNT(gs.id)::int AS games_played,
                   COUNT(gs.id) FILTER (WHERE gs.is_correct = TRUE)::int AS correct_answers
            FROM users u
            LEFT JOIN game_sessions gs ON gs.user_id = u.id
            GROUP BY u.id
            ORDER BY u.is_anonymous ASC, score DESC
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: LEADERBOARD RESET & SCHEDULER ───────────────────────────────────────
app.post('/admin/leaderboard/reset', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { categoryId, reason } = req.body || {};
    const catParsed = categoryId ? parseInt(categoryId, 10) : NaN;
    const catId = Number.isNaN(catParsed) ? null : catParsed;
    try {
        await runQuery(
            `INSERT INTO score_resets (scope, category_id, reset_by_admin_id, reason)
             VALUES ('global', $1, $2, $3)`,
            [catId, admin.id, reason || 'admin_reset']
        );
        await auditLog(admin.id, 'LEADERBOARD_RESET', `Global reset${catId ? ` for category ${catId}` : ''}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/leaderboard/schedule', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query('SELECT period, enabled, next_run, last_run FROM leaderboard_schedules ORDER BY period');
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/leaderboard/schedule', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { period, enabled } = req.body || {};
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) {
        return res.status(400).json({ error: 'Invalid period' });
    }
    try {
        const nextRun = enabled ? computeNextRun(period, new Date()) : null;
        await runQuery(
            `INSERT INTO leaderboard_schedules (period, enabled, next_run)
             VALUES ($1, $2, $3)
             ON CONFLICT (period)
             DO UPDATE SET enabled = EXCLUDED.enabled, next_run = EXCLUDED.next_run`,
            [period, !!enabled, nextRun]
        );
        await auditLog(admin.id, 'LEADERBOARD_SCHEDULE_UPDATE', `${period} schedule ${enabled ? 'enabled' : 'disabled'}`);
        res.json({ success: true, nextRun });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: PRIVACY SETTINGS ───────────────────────────────────────────────────
app.get('/admin/privacy-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getPrivacySettings();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/privacy-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { hide_emails_globally, hide_emails_by_default } = req.body || {};
    try {
        const current = await getPrivacySettings();
        const next = {
            hide_emails_globally: (typeof hide_emails_globally === 'boolean')
                ? hide_emails_globally
                : current.hide_emails_globally,
            hide_emails_by_default: (typeof hide_emails_by_default === 'boolean')
                ? hide_emails_by_default
                : current.hide_emails_by_default,
        };
        const r = await pool.query(
            `INSERT INTO privacy_settings (hide_emails_globally, hide_emails_by_default)
             VALUES ($1, $2) RETURNING *`,
            [next.hide_emails_globally, next.hide_emails_by_default]
        );
        await auditLog(admin.id, 'PRIVACY_SETTINGS_UPDATE', `global=${next.hide_emails_globally}, default_hide=${next.hide_emails_by_default}`);
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: RATE LIMIT SETTINGS ────────────────────────────────────────────────
app.get('/admin/rate-limit-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getRateLimitSettings();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/rate-limit-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
        guest_min_interval_ms,
        user_burst_window_ms,
        user_burst_max,
        user_cooldown_ms,
        open_trivia_db_enabled,
        skip_per_hour,
    } = req.body || {};
    try {
        const current = await getRateLimitSettings();
        const next = {
            guest_min_interval_ms: Number.isFinite(Number(guest_min_interval_ms))
                ? Math.max(0, Number(guest_min_interval_ms))
                : current.guest_min_interval_ms,
            user_burst_window_ms: Number.isFinite(Number(user_burst_window_ms))
                ? Math.max(0, Number(user_burst_window_ms))
                : current.user_burst_window_ms,
            user_burst_max: Number.isFinite(Number(user_burst_max))
                ? Math.max(0, Number(user_burst_max))
                : current.user_burst_max,
            user_cooldown_ms: Number.isFinite(Number(user_cooldown_ms))
                ? Math.max(0, Number(user_cooldown_ms))
                : current.user_cooldown_ms,
            open_trivia_db_enabled: (typeof open_trivia_db_enabled === 'boolean')
                ? open_trivia_db_enabled
                : (current.open_trivia_db_enabled !== false),
            skip_per_hour: Number.isFinite(Number(skip_per_hour))
                ? Math.max(0, Number(skip_per_hour))
                : (Number(current.skip_per_hour) || 0),
        };
        const r = await pool.query(
            `INSERT INTO rate_limit_settings (
                guest_min_interval_ms, user_burst_window_ms, user_burst_max, user_cooldown_ms,
                open_trivia_db_enabled, skip_per_hour
             )
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [
                next.guest_min_interval_ms,
                next.user_burst_window_ms,
                next.user_burst_max,
                next.user_cooldown_ms,
                next.open_trivia_db_enabled,
                next.skip_per_hour,
            ]
        );
        await auditLog(
            admin.id,
            'RATE_LIMIT_SETTINGS_UPDATE',
            `guest_interval=${next.guest_min_interval_ms} user_window=${next.user_burst_window_ms} user_burst=${next.user_burst_max} user_cooldown=${next.user_cooldown_ms} opentdb=${next.open_trivia_db_enabled} skip_per_hour=${next.skip_per_hour}`
        );
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: IMAGE SETTINGS ─────────────────────────────────────────────────────
app.get('/admin/image-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getImageSettings();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/image-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { max_image_kb } = req.body || {};
    try {
        const current = await getImageSettings();
        const next = {
            max_image_kb: Number.isFinite(Number(max_image_kb))
                ? Math.max(0, Number(max_image_kb))
                : current.max_image_kb,
        };
        const r = await pool.query(
            `INSERT INTO image_settings (max_image_kb)
             VALUES ($1) RETURNING *`,
            [next.max_image_kb]
        );
        await auditLog(admin.id, 'IMAGE_SETTINGS_UPDATE', `max_kb=${next.max_image_kb}`);
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/discord-sso-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getDiscordSsoSettings();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/discord-sso-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = req.body || {};
    try {
        const current = await getDiscordSsoSettings();
        const next = {
            enabled: typeof body.enabled === 'boolean' ? body.enabled : !!current.enabled,
            client_id: String(body.client_id ?? current.client_id ?? '').trim(),
            client_secret: String(body.client_secret ?? current.client_secret ?? '').trim(),
            redirect_uri: String(body.redirect_uri ?? current.redirect_uri ?? '').trim(),
        };
        const redirectUri = resolveDiscordRedirectUri(next.redirect_uri);
        const inserted = await pool.query(
            `INSERT INTO discord_sso_settings (enabled, client_id, client_secret, redirect_uri)
             VALUES ($1,$2,$3,$4)
             RETURNING *`,
            [next.enabled, next.client_id || null, next.client_secret || null, redirectUri]
        );
        const effective = await getDiscordSsoSettings();
        await auditLog(admin.id, 'DISCORD_SSO_SETTINGS_UPDATE', `enabled=${effective.enabled} configured=${effective.configured}`);
        res.json({ ...inserted.rows[0], ...effective });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/discord-bot-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getDiscordBotSettingsSnapshot();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/discord-bot-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = req.body || {};
    try {
        const current = await getDiscordBotSettings();
        const next = {
            enabled: typeof body.enabled === 'boolean' ? body.enabled : !!current.enabled,
            api_token: String(body.api_token ?? current.api_token ?? '').trim(),
            public_app_url: normalizeBotBaseUrl(body.public_app_url ?? current.public_app_url ?? buildPublicAppUrl('/')),
            service_url: normalizeBotBaseUrl(body.service_url ?? current.service_url ?? ''),
            invite_url: normalizeInviteUrl(body.invite_url ?? current.invite_url ?? 'https://discord.com/oauth2/authorize?client_id=1485851351366766755'),
        };
        const inserted = await pool.query(
            `INSERT INTO discord_bot_settings (enabled, api_token, public_app_url, service_url, invite_url)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
            [next.enabled, next.api_token || null, next.public_app_url || null, next.service_url || null, next.invite_url || null]
        );
        const effective = await getDiscordBotSettingsSnapshot();
        await auditLog(admin.id, 'DISCORD_BOT_SETTINGS_UPDATE', `enabled=${effective.enabled} configured=${effective.configured}`);
        res.json({ ...inserted.rows[0], ...effective });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: IMAGE UPLOADS ──────────────────────────────────────────────────────
app.post('/admin/images/upload', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const upload = multer({ storage: multer.memoryStorage() }).single('image');
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: 'Upload failed' });
        if (!req.file) return res.status(400).json({ error: 'No image provided' });
        if (!isAllowedImageUpload(req.file)) {
            return res.status(400).json({ error: 'Only png, jpg, jpeg, svg, webp, gif allowed' });
        }
        const settings = await getImageSettings();
        const maxKb = Number(settings.max_image_kb) || 0;
        if (maxKb > 0 && req.file.size > maxKb * 1024) {
            return res.status(400).json({ error: `Image exceeds ${maxKb} KB limit` });
        }
        const ext = String(path.extname(req.file.originalname || '')).toLowerCase();
        const safeExt = ext || '.png';
        const name = `q_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
        const dir = path.join(uploadsRoot, 'questions');
        fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, name);
        fs.writeFileSync(full, req.file.buffer);
        const url = `/api/uploads/questions/${name}`;
        res.json({ url });
    });
});

// ── ADMIN: CATEGORY PACK EXPORT/IMPORT ───────────────────────────────────────
app.post('/admin/categories/export-zip', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { categoryIds } = req.body || {};
    const ids = Array.isArray(categoryIds) ? categoryIds.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'categoryIds required' });
    try {
        const cats = await pool.query('SELECT id, name FROM categories WHERE id = ANY($1)', [ids]);
        if (!cats.rows.length) return res.status(404).json({ error: 'No categories found' });
        const mainZip = new AdmZip();
        const imgSettings = await getImageSettings();
        const maxKb = Number(imgSettings.max_image_kb) || 0;
        const usedNames = new Set();

        for (const cat of cats.rows) {
            const q = await pool.query(
                `SELECT q.*
                 FROM questions q
                 WHERE q.category_id=$1
                 ORDER BY q.id ASC`,
                [cat.id]
            );
            const header = ['category_name','question_text','option_a','option_b','option_c','option_d','correct_answer','complexity','disabled','image_url'];
            const rows = [];
            const catZip = new AdmZip();
            for (const row of q.rows) {
                let imageUrl = row.image_url || '';
                if (imageUrl && isLocalImageUrl(imageUrl)) {
                    const rel = extractRelativeImagePath(imageUrl);
                    if (rel) {
                        const full = path.join(uploadsRoot, rel);
                        if (fs.existsSync(full)) {
                            const baseName = path.basename(full);
                            const imageBytes = fs.readFileSync(full);
                            if (maxKb === 0 || imageBytes.length <= maxKb * 1024) {
                                catZip.addFile(`images/${baseName}`, imageBytes);
                                imageUrl = `images/${baseName}`;
                            }
                        }
                    }
                }
                rows.push([
                    cat.name,
                    row.text,
                    row.option_a,
                    row.option_b,
                    row.option_c,
                    row.option_d,
                    row.correct_answer,
                    row.complexity,
                    row.disabled,
                    imageUrl
                ]);
            }
            const csv = [
                header.join(','),
                ...rows.map(r => r.map(csvEscape).join(','))
            ].join(os.EOL);
            catZip.addFile('questions.csv', Buffer.from(csv, 'utf8'));
            let safeName = slugifyName(cat.name);
            let candidate = safeName;
            let i = 2;
            while (usedNames.has(candidate)) {
                candidate = `${safeName}-${i++}`;
            }
            usedNames.add(candidate);
            mainZip.addFile(`${candidate}.zip`, catZip.toBuffer());
        }

        const out = mainZip.toBuffer();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="category_packs.zip"');
        res.send(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/categories/template-zip', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const zip = new AdmZip();
        const header = ['category_name','question_text','option_a','option_b','option_c','option_d','correct_answer','complexity','disabled','image_url'];
        const example = [
            'General',
            'What is the capital of France?',
            'Paris',
            'Rome',
            'Berlin',
            'Madrid',
            'A',
            'easy',
            'false',
            ''
        ];
        const csv = [header.join(','), example.map(csvEscape).join(',')].join(os.EOL);
        zip.addFile('questions.csv', Buffer.from(csv, 'utf8'));
        zip.addFile('images/README.txt', Buffer.from('Place local images in this folder and reference them as images/filename.ext in image_url.', 'utf8'));
        const out = zip.toBuffer();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="category_pack_template.zip"');
        res.send(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function importCategoryZipBuffer(buf) {
    const imgSettings = await getImageSettings();
    const maxKb = Number(imgSettings.max_image_kb) || 0;
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const groups = new Map();
    const nestedZips = [];
    for (const e of entries) {
        if (e.isDirectory) continue;
        if (e.entryName.toLowerCase().endsWith('.zip')) {
            nestedZips.push(e);
            continue;
        }
        const parts = e.entryName.split('/');
        const group = parts.length > 1 ? parts[0] : '_root';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(e);
    }

    const existingRows = await pool.query('SELECT name FROM categories');
    const existing = new Set(existingRows.rows.map(r => r.name.toLowerCase()));
    let inserted = 0;

    for (const [group, files] of groups.entries()) {
        const csvEntry = files.find(f => f.entryName.toLowerCase().endsWith('.csv'));
        if (!csvEntry) continue;
        const { rows } = parseCsvLines(csvEntry.getData().toString('utf8'));
        if (!rows.length) continue;

        const catMap = new Map();
        const imgFiles = new Map();
        for (const f of files) {
            if (f.entryName.toLowerCase().includes('/images/')) {
                imgFiles.set(f.entryName.split('/images/')[1], f);
            }
        }

        for (const row of rows) {
            const baseName = row.category_name || (group !== '_root' ? group : 'Category');
            let catId = catMap.get(baseName.toLowerCase());
            if (!catId) {
                const catName = await uniqueCategoryName(baseName, existing);
                let cat = (await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1)', [catName])).rows[0];
                if (!cat) cat = (await runQuery('INSERT INTO categories (name) VALUES ($1) RETURNING *', [catName])).rows[0];
                catId = cat.id;
                catMap.set(baseName.toLowerCase(), catId);
            }

            let imageUrl = normalizeImageUrl(row.image_url);
            if (imageUrl && imageUrl.startsWith('images/')) {
                const imageKey = imageUrl.replace(/^images\//, '');
                const file = imgFiles.get(imageKey);
                if (file) {
                    const ext = path.extname(file.entryName).toLowerCase();
                    if (['.png','.jpg','.jpeg','.svg','.webp','.gif'].includes(ext)) {
                        if (maxKb === 0 || file.header.size <= maxKb * 1024) {
                            const name = `q_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
                            const dir = path.join(uploadsRoot, 'questions');
                            fs.mkdirSync(dir, { recursive: true });
                            fs.writeFileSync(path.join(dir, name), file.getData());
                            imageUrl = `/api/uploads/questions/${name}`;
                        }
                    }
                }
            }
            if (imageUrl && !imageUrl.startsWith('/api/uploads/')) {
                const chk = await validateImageUrl(imageUrl, maxKb);
                if (!chk.ok) imageUrl = null;
            }

            await runQuery(
                `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url,disabled)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [
                    catId,
                    row.question_text,
                    row.option_a,
                    row.option_b,
                    row.option_c,
                    row.option_d,
                    String(row.correct_answer || 'A').trim().toUpperCase().slice(0,1),
                    (row.complexity || 'medium').trim().toLowerCase(),
                    imageUrl || null,
                    String(row.disabled || '').toLowerCase() === 'true'
                ]
            );
            inserted++;
        }
    }
    for (const nz of nestedZips) {
        inserted += await importCategoryZipBuffer(nz.getData());
    }
    return inserted;
}

async function importCategoryCsvBuffer(buf, fallbackCategoryName = 'Category') {
    const { rows } = parseCsvLines(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || ''));
    if (!rows.length) return 0;

    const imgSettings = await getImageSettings();
    const maxKb = Number(imgSettings.max_image_kb) || 0;
    const existingRows = await pool.query('SELECT name FROM categories');
    const existing = new Set(existingRows.rows.map(r => r.name.toLowerCase()));
    const catMap = new Map();
    let inserted = 0;

    for (const row of rows) {
        const baseName = row.category_name || fallbackCategoryName || 'Category';
        let catId = catMap.get(baseName.toLowerCase());
        if (!catId) {
            const catName = await uniqueCategoryName(baseName, existing);
            let cat = (await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1)', [catName])).rows[0];
            if (!cat) cat = (await runQuery('INSERT INTO categories (name) VALUES ($1) RETURNING *', [catName])).rows[0];
            catId = cat.id;
            catMap.set(baseName.toLowerCase(), catId);
        }

        let imageUrl = normalizeImageUrl(row.image_url);
        if (imageUrl) {
            const chk = await validateImageUrl(imageUrl, maxKb);
            if (!chk.ok) imageUrl = null;
        }

        await runQuery(
            `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url,disabled)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                catId,
                row.question_text,
                row.option_a,
                row.option_b,
                row.option_c,
                row.option_d,
                String(row.correct_answer || 'A').trim().toUpperCase().slice(0,1),
                (row.complexity || 'medium').trim().toLowerCase(),
                imageUrl || null,
                String(row.disabled || '').toLowerCase() === 'true'
            ]
        );
        inserted++;
    }
    return inserted;
}

function normalizeCategoryImportUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (/docs\.google\.com$/i.test(url.hostname) && url.pathname.includes('/spreadsheets/')) {
            const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
            if (match) {
                const gid = url.searchParams.get('gid') || (url.hash.match(/gid=(\d+)/)?.[1]) || '0';
                return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
            }
        }
    } catch {}
    return raw;
}

function looksLikeCsvImport(url, contentType = '') {
    return /\.csv($|\?)/i.test(url) || /text\/csv|application\/csv|spreadsheet/i.test(contentType);
}

app.post('/admin/categories/import-zip', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const upload = multer({ storage: multer.memoryStorage() }).single('file');
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: 'Upload failed' });
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        try {
            const original = String(req.file.originalname || '').toLowerCase();
            const inserted = original.endsWith('.csv')
                ? await importCategoryCsvBuffer(req.file.buffer, path.basename(original, '.csv'))
                : await importCategoryZipBuffer(req.file.buffer);
            res.json({ success: true, inserted });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

app.post('/admin/categories/import-github', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { repoUrl } = req.body || {};
    if (!repoUrl) return res.status(400).json({ error: 'repoUrl required' });
    try {
        let importUrl = normalizeCategoryImportUrl(repoUrl);
        const isCsvUrl = /\.csv($|\?)/i.test(importUrl);
        const isZipUrl = /\.zip($|\?)/i.test(importUrl) || /releases\/download\//i.test(importUrl);
        if (!isCsvUrl && !isZipUrl && /github\.com\/[^/]+\/[^/]+/i.test(importUrl)) {
            const parts = importUrl.replace(/\/$/, '').split('/');
            const owner = parts[parts.length - 2];
            const repo = parts[parts.length - 1].replace(/\.git$/, '');
            importUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
        }
        const r = await fetch(importUrl);
        if (!r.ok) return res.status(400).json({ error: `Failed to fetch import (${r.status})` });
        const contentType = r.headers.get('content-type') || '';
        const buf = Buffer.from(await r.arrayBuffer());
        const inserted = looksLikeCsvImport(importUrl, contentType)
            ? await importCategoryCsvBuffer(buf, 'Imported')
            : await importCategoryZipBuffer(buf);
        res.json({ success: true, inserted });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: SCORING SETTINGS ───────────────────────────────────────────────────
app.get('/admin/scoring-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const settings = await getScoringSettings();
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/scoring-settings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const {
        min_points,
        max_easy,
        max_med,
        max_hard,
        discord_easy,
        discord_med,
        discord_hard,
        fast_ms,
        slow_ms,
        diff_min_attempts,
        diff_up_threshold,
        diff_down_threshold,
    } = req.body || {};
    try {
        const vals = [
            Number(min_points ?? SCORE_MIN_POINTS),
            Number(max_easy ?? SCORE_MAX_EASY),
            Number(max_med ?? SCORE_MAX_MED),
            Number(max_hard ?? SCORE_MAX_HARD),
            Number(discord_easy ?? DISCORD_SCORE_EASY),
            Number(discord_med ?? DISCORD_SCORE_MED),
            Number(discord_hard ?? DISCORD_SCORE_HARD),
            Number(fast_ms ?? SCORE_FAST_MS),
            Number(slow_ms ?? SCORE_SLOW_MS),
            Number(diff_min_attempts ?? DIFF_MIN_ATTEMPTS),
            Number(diff_up_threshold ?? DIFF_UP_THRESHOLD),
            Number(diff_down_threshold ?? DIFF_DOWN_THRESHOLD),
        ];
        await runQuery(
            `INSERT INTO scoring_settings (min_points, max_easy, max_med, max_hard, discord_easy, discord_med, discord_hard, fast_ms, slow_ms, diff_min_attempts, diff_up_threshold, diff_down_threshold, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
            vals
        );
        await auditLog(admin.id, 'SCORING_SETTINGS_UPDATE', `min=${vals[0]}, easy=${vals[1]}, med=${vals[2]}, hard=${vals[3]}, discordEasy=${vals[4]}, discordMed=${vals[5]}, discordHard=${vals[6]}, fastMs=${vals[7]}, slowMs=${vals[8]}, diffMinAttempts=${vals[9]}, diffUp=${vals[10]}, diffDown=${vals[11]}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: DATA MANAGEMENT ────────────────────────────────────────────────────
app.post('/admin/backup', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { note } = req.body || {};
    try {
        const data = await collectSnapshot();
        const r = await pool.query(
            'INSERT INTO backup_snapshots (note, data) VALUES ($1, $2) RETURNING id, created_at, note',
            [note || null, data]
        );
        await auditLog(admin.id, 'BACKUP_CREATE', `Backup ${r.rows[0].id} created`);
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/backup', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query('SELECT id, created_at, note FROM backup_snapshots ORDER BY created_at DESC');
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/backup/:id', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query('SELECT id, created_at, note, data FROM backup_snapshots WHERE id=$1', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Backup not found' });
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: QUESTIONS CSV ──────────────────────────────────────────────────────
app.get('/admin/questions/csv', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query(`
            SELECT q.id, c.name AS category_name, q.text AS question_text,
                   q.option_a, q.option_b, q.option_c, q.option_d,
                   q.correct_answer, q.complexity, q.disabled, q.image_url
            FROM questions q
            JOIN categories c ON c.id = q.category_id
            ORDER BY q.id ASC
        `);
        const header = ['id','category_name','question_text','option_a','option_b','option_c','option_d','correct_answer','complexity','disabled','image_url'];
        const rows = r.rows.map(row => header.map(h => {
            const v = row[h];
            const s = v === null || v === undefined ? '' : String(v);
            const needsQuotes = /[",\n]/.test(s);
            return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','));
        const csv = [header.join(','), ...rows].join(os.EOL);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="questions_export.csv"');
        res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/questions/template', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const templatePath = path.join(__dirname, 'exports', 'questions_template.csv');
    try {
        const raw = fs.readFileSync(templatePath, 'utf8');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="questions_template.csv"');
        res.send(raw);
    } catch {
        res.status(404).json({ error: 'Template not found' });
    }
});

app.post('/admin/questions/import-csv', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'Missing csv' });
    try {
        const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV is empty' });
        const header = lines[0].split(',').map(h => h.trim());
        const required = ['category_name','question_text','option_a','option_b','option_c','option_d','correct_answer','complexity'];
        for (const reqCol of required) {
            if (!header.includes(reqCol)) return res.status(400).json({ error: `Missing column: ${reqCol}` });
        }

        const parseLine = (line) => {
            const out = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
                    if (inQuotes && line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (ch === ',' && !inQuotes) {
                    out.push(cur);
                    cur = '';
                } else {
                    cur += ch;
                }
            }
            out.push(cur);
            return out;
        };

        let inserted = 0;
        for (let i = 1; i < lines.length; i++) {
            const row = parseLine(lines[i]);
            const obj = {};
            header.forEach((h, idx) => { obj[h] = (row[idx] || '').trim(); });
            if (!obj.question_text) continue;
            const catName = obj.category_name || 'General';
            let cat = (await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1)', [catName])).rows[0];
            if (!cat) cat = (await runQuery('INSERT INTO categories (name) VALUES ($1) RETURNING *', [catName])).rows[0];
            const normalizedImageUrl = normalizeImageUrl(obj.image_url);
            if (normalizedImageUrl) {
                const imgSettings = await getImageSettings();
                const maxKb = Number(imgSettings.max_image_kb) || 0;
                const chk = await validateImageUrl(normalizedImageUrl, maxKb);
                if (!chk.ok) continue;
            }
            await runQuery(
                `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    cat.id,
                    obj.question_text,
                    obj.option_a,
                    obj.option_b,
                    obj.option_c,
                    obj.option_d,
                    String(obj.correct_answer || 'A').trim().toUpperCase().slice(0,1),
                    (obj.complexity || 'medium').trim().toLowerCase(),
                    normalizedImageUrl
                ]
            );
            inserted++;
        }
        await auditLog(admin.id, 'QUESTIONS_IMPORT_CSV', `Imported ${inserted} questions`);
        res.json({ success: true, inserted });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/export', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const data = await collectSnapshot();
        res.json({ exported_at: new Date().toISOString(), data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/import', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { data, mode } = req.body || {};
    if (!data) return res.status(400).json({ error: 'Missing data' });
    if (mode && !['replace', 'merge'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
    try {
        await applySnapshot(data, mode || 'replace');
        await auditLog(admin.id, 'DATA_IMPORT', `Import completed (${mode || 'replace'})`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/backup/restore-user', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { userId } = req.body || {};
    const uid = parseInt(userId, 10);
    if (!uid) return res.status(400).json({ error: 'Invalid userId' });
    try {
        const snap = await pool.query('SELECT data FROM backup_snapshots ORDER BY created_at DESC LIMIT 1');
        if (!snap.rows.length) return res.status(404).json({ error: 'No backups available' });
        const data = snap.rows[0].data || {};
        const userRow = (data.users || []).find(u => u.id === uid);
        if (!userRow) return res.status(404).json({ error: 'User not found in latest backup' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM game_sessions WHERE user_id=$1', [uid]);
            await client.query('DELETE FROM score_resets WHERE user_id=$1', [uid]);
            await client.query('DELETE FROM pending_questions WHERE user_id=$1', [uid]);
            await client.query('DELETE FROM users WHERE id=$1', [uid]);
            await client.query(
                `INSERT INTO users (id,email,password_hash,role,score,is_anonymous,blocked_until,blocked_reason,display_name,show_email,discord_id,discord_username,discord_avatar_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [userRow.id, userRow.email, userRow.password_hash, userRow.role, userRow.score, userRow.is_anonymous, userRow.blocked_until, userRow.blocked_reason, userRow.display_name, userRow.show_email, userRow.discord_id, userRow.discord_username, userRow.discord_avatar_url]
            );

            const restoreRows = async (table, cols, rows) => {
                if (!rows.length) return;
                const values = [];
                const params = [];
                let idx = 1;
                for (const row of rows) {
                    const rowParams = [];
                    for (const c of cols) {
                        rowParams.push(`$${idx++}`);
                        params.push(row[c] === undefined ? null : row[c]);
                    }
                    values.push(`(${rowParams.join(',')})`);
                }
                await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
            };

            const games = (data.game_sessions || []).filter(r => r.user_id === uid);
            const resets = (data.score_resets || []).filter(r => r.user_id === uid);
            const pending = (data.pending_questions || []).filter(r => r.user_id === uid);

            await restoreRows('game_sessions', ['id','user_id','question_id','category_id','selected_answer','is_correct','points','created_at'], games);
            await restoreRows('score_resets', ['id','scope','user_id','category_id','reset_at','reset_by_admin_id','reason'], resets);
            await restoreRows('pending_questions', ['id','user_id','submitted_by_email','submitted_via','category_name','text','option_a','option_b','option_c','option_d','correct_answer','complexity','image_url','submitted_at','status'], pending);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await auditLog(admin.id, 'USER_RESTORE', `Restored user ${uid} from latest backup`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin resets a user's password directly
app.post('/admin/users/:id/reset-password', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const userCheck = await pool.query('SELECT id, email FROM users WHERE id=$1 AND is_anonymous=FALSE', [req.params.id]);
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });
        const hashed = await bcrypt.hash(newPassword, 10);
        await runQuery('UPDATE users SET password_hash=$1 WHERE id=$2', [hashed, req.params.id]);
        await auditLog(admin.id, 'ADMIN_RESET_PASSWORD', `Reset password for user ${userCheck.rows[0].email} (id:${req.params.id})`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin changes a user's role
app.patch('/admin/users/:id/role', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { role } = req.body;
    if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (parseInt(req.params.id) === admin.id) return res.status(400).json({ error: 'Cannot change your own role' });
    try {
        const userCheck = await pool.query('SELECT id, email FROM users WHERE id=$1 AND is_anonymous=FALSE', [req.params.id]);
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });
        await runQuery('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
        await auditLog(admin.id, 'ADMIN_CHANGE_ROLE', `Changed role to '${role}' for user ${userCheck.rows[0].email}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin blocks/unblocks a user
app.post('/admin/users/:id/block', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const userId = parseInt(req.params.id, 10);
    const { minutes, reason } = req.body || {};
    const mins = Number(minutes ?? 0);
    if (!Number.isFinite(mins) || mins < 0) return res.status(400).json({ error: 'Invalid minutes' });
    try {
        const userCheck = await pool.query('SELECT role FROM users WHERE id=$1', [userId]);
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });
        if (userCheck.rows[0].role === 'admin') return res.status(400).json({ error: 'Cannot block an admin' });
        const blockedUntil = mins === 0
            ? new Date('9999-12-31T23:59:59Z')
            : new Date(Date.now() + mins * 60 * 1000);
        await runQuery(
            'UPDATE users SET blocked_until=$1, blocked_reason=$2 WHERE id=$3',
            [blockedUntil, reason || null, userId]
        );
        await auditLog(admin.id, 'USER_BLOCK', `Blocked user ${userId} for ${mins === 0 ? 'forever' : mins + ' minutes'}`);
        res.json({ success: true, blocked_until: blockedUntil });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/users/:id/unblock', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const userId = parseInt(req.params.id, 10);
    try {
        await runQuery('UPDATE users SET blocked_until=NULL, blocked_reason=NULL WHERE id=$1', [userId]);
        await auditLog(admin.id, 'USER_UNBLOCK', `Unblocked user ${userId}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: REVIEW QUEUE ────────────────────────────────────────────────────────
app.get('/admin/queue', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const pendingRes = await pool.query(`SELECT * FROM pending_questions WHERE status='pending' ORDER BY submitted_at DESC`);
        const existingRes = await pool.query(`
            SELECT q.id, q.text, c.name AS category_name
            FROM questions q
            LEFT JOIN categories c ON c.id = q.category_id
        `);
        const pendingRows = pendingRes.rows;
        const existingRows = existingRes.rows;
        const enriched = pendingRows.map((row) => {
            const matches = [];
            for (const existing of existingRows) {
                const score = computeQuestionSimilarity(row.text, existing.text);
                if (score >= 0.55) {
                    matches.push({
                        kind: 'existing',
                        id: existing.id,
                        text: existing.text,
                        category_name: existing.category_name,
                        similarity: Number(score.toFixed(2)),
                    });
                }
            }
            for (const other of pendingRows) {
                if (other.id === row.id) continue;
                const score = computeQuestionSimilarity(row.text, other.text);
                if (score >= 0.55) {
                    matches.push({
                        kind: 'pending',
                        id: other.id,
                        text: other.text,
                        category_name: other.category_name,
                        similarity: Number(score.toFixed(2)),
                    });
                }
            }
            matches.sort((a, b) => b.similarity - a.similarity);
            return {
                ...row,
                duplicate_matches: matches.slice(0, 5),
            };
        });
        res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/approve/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const pq = (await pool.query('SELECT * FROM pending_questions WHERE id=$1', [req.params.id])).rows[0];
        if (!pq) return res.status(404).json({ error: 'Not found' });
        let cat = (await pool.query('SELECT id FROM categories WHERE LOWER(name)=LOWER($1)', [pq.category_name])).rows[0];
        if (!cat) cat = (await runQuery('INSERT INTO categories (name) VALUES ($1) RETURNING *', [pq.category_name])).rows[0];
        const normalizedImageUrl = normalizeImageUrl(pq.image_url);
        if (normalizedImageUrl) {
            const imgSettings = await getImageSettings();
            const maxKb = Number(imgSettings.max_image_kb) || 0;
            const chk = await validateImageUrl(normalizedImageUrl, maxKb);
            if (!chk.ok) return res.status(400).json({ error: chk.error });
        }
        await runQuery(
            `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [cat.id, pq.text, pq.option_a, pq.option_b, pq.option_c, pq.option_d, pq.correct_answer, pq.complexity, normalizedImageUrl]
        );
        await runQuery(`UPDATE pending_questions SET status='approved' WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/deny/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        await runQuery(`UPDATE pending_questions SET status='denied' WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: REPORTED QUESTIONS ──────────────────────────────────────────────────
app.get('/admin/reported', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const r = await pool.query(`
            SELECT qr.id AS report_id, qr.reason, qr.reported_at,
                   q.id, q.text, q.option_a, q.option_b, q.option_c, q.option_d,
                   q.correct_answer, q.complexity, q.disabled,
                   c.name AS category_name
            FROM question_reports qr
            JOIN questions q ON q.id = qr.question_id
            JOIN categories c ON c.id = q.category_id
            ORDER BY qr.reported_at DESC
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/reports/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        await runQuery('DELETE FROM question_reports WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: AUDIT LOG ───────────────────────────────────────────────────────────
app.get('/admin/audit-log', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const r = await pool.query(`
            SELECT al.id, al.action, al.details, al.created_at,
                   u.email AS admin_email
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.admin_id
            ORDER BY al.created_at DESC
            LIMIT 100
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: SHAREPLAY KICK/VOTE MANAGEMENT ─────────────────────────────────────
app.post('/admin/users/:id/clear-leaderboard', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.params;
    const { reason } = req.body || {};
    try {
        await pool.query('UPDATE users SET score = 0 WHERE id = $1', [id]);
        await pool.query('INSERT INTO score_resets (scope, user_id, reset_by_admin_id, reason) VALUES ($1, $2, $3, $4)',
            ['user', id, admin.id, reason || 'Admin cleared leaderboard']);
        await pool.query('INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [admin.id, 'clear_leaderboard', `Cleared leaderboard for user #${id}`]);
        res.json({ message: 'Leaderboard cleared.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/users/:id', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.params;
    if (Number(id) === admin.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
    try {
        const user = await pool.query('SELECT email FROM users WHERE id = $1', [id]);
        if (!user.rows.length) return res.status(404).json({ error: 'User not found.' });
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        await pool.query('INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [admin.id, 'delete_user', `Deleted user ${user.rows[0].email} (#${id})`]);
        res.json({ message: 'User deleted.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/shareplay/bans', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const { rows } = await pool.query(`
            SELECT b.*, u.email, u.display_name,
                   a.email AS admin_email
            FROM shareplay_bans b
            JOIN users u ON u.id = b.user_id
            LEFT JOIN users a ON a.id = b.admin_id
            ORDER BY b.created_at DESC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/shareplay/unblock/:userId', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { userId } = req.params;
    try {
        await pool.query("UPDATE shareplay_bans SET unbanned_at = NOW(), is_permanent = FALSE WHERE user_id = $1 AND unbanned_at IS NULL", [userId]);
        await pool.query('UPDATE users SET shareplay_banned = FALSE WHERE id = $1', [userId]);
        await pool.query('INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [admin.id, 'shareplay_unblock', `Unblocked user #${userId} from SharePlay`]);
        res.json({ message: 'User unblocked.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/shareplay/block/:userId', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { userId } = req.params;
    const { minutes, reason } = req.body || {};
    try {
        const blockedUntil = minutes === 0 ? null : new Date(Date.now() + (minutes || 1440) * 60000);
        await pool.query('UPDATE users SET blocked_until = $1, blocked_reason = $2 WHERE id = $3',
            [blockedUntil, reason || 'Blocked by admin', userId]);
        await pool.query('INSERT INTO shareplay_bans (user_id, ban_type, reason, admin_id, is_permanent, banned_until) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, 'server', reason || 'Blocked by admin', admin.id, minutes === 0, blockedUntil]);
        await pool.query('INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [admin.id, 'server_block', `Blocked user #${userId} from server`]);
        res.json({ message: 'User blocked.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/shareplay/kick-warnings', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const { rows } = await pool.query(`
            SELECT ks.*, u.email, u.display_name, u.shareplay_banned,
                   (SELECT COUNT(*) FROM shareplay_kick_history WHERE target_user_id = ks.user_id) AS total_kicks
            FROM shareplay_kick_strikes ks
            JOIN users u ON u.id = ks.user_id
            ORDER BY ks.strike_count DESC, ks.last_kick_at DESC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/shareplay/appeals', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
        const { rows } = await pool.query(`
            SELECT a.*, u.email, u.display_name
            FROM shareplay_appeals a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/shareplay/appeals/:id/resolve', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { id } = req.params;
    const { status, admin_response } = req.body || {};
    if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    try {
        const appeal = await pool.query('SELECT * FROM shareplay_appeals WHERE id = $1', [id]);
        if (!appeal.rows.length) return res.status(404).json({ error: 'Appeal not found.' });
        await pool.query('UPDATE shareplay_appeals SET status = $1, admin_response = $2, admin_id = $3, resolved_at = NOW() WHERE id = $4',
            [status, admin_response || '', admin.id, id]);
        if (status === 'approved') {
            await pool.query('UPDATE users SET shareplay_banned = FALSE WHERE id = $1', [appeal.rows[0].user_id]);
            await pool.query("UPDATE shareplay_bans SET unbanned_at = NOW(), is_permanent = FALSE WHERE user_id = $1 AND unbanned_at IS NULL", [appeal.rows[0].user_id]);
            await pool.query('UPDATE shareplay_kick_strikes SET strike_count = 0 WHERE user_id = $1', [appeal.rows[0].user_id]);
        }
        await pool.query('INSERT INTO audit_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [admin.id, 'appeal_resolve', `${status} appeal #${id} for user #${appeal.rows[0].user_id}`]);
        res.json({ message: `Appeal ${status}.` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/me/shareplay/appeal', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { message } = req.body || {};
    if (!message || message.trim().length < 10) return res.status(400).json({ error: 'Please provide a detailed message (min 10 characters).' });
    try {
        const existing = await pool.query("SELECT id FROM shareplay_appeals WHERE user_id = $1 AND status = 'pending'", [u.id]);
        if (existing.rows.length) return res.status(400).json({ error: 'You already have a pending appeal.' });
        await pool.query('INSERT INTO shareplay_appeals (user_id, message) VALUES ($1, $2)', [u.id, message.trim()]);
        res.json({ message: 'Appeal submitted. An admin will review it.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/me/shareplay/status', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    try {
        const user = await pool.query('SELECT shareplay_banned FROM users WHERE id = $1', [u.id]);
        const strikes = await pool.query('SELECT strike_count FROM shareplay_kick_strikes WHERE user_id = $1', [u.id]);
        const pendingAppeal = await pool.query("SELECT id FROM shareplay_appeals WHERE user_id = $1 AND status = 'pending'", [u.id]);
        const ban = await pool.query("SELECT banned_until, reason FROM shareplay_bans WHERE user_id = $1 AND unbanned_at IS NULL ORDER BY created_at DESC LIMIT 1", [u.id]);
        res.json({
            banned: user.rows[0]?.shareplay_banned || false,
            strikeCount: strikes.rows[0]?.strike_count || 0,
            hasPendingAppeal: pendingAppeal.rows.length > 0,
            banReason: ban.rows[0]?.reason || null,
            bannedUntil: ban.rows[0]?.banned_until || null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HEALTH ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/openapi.json', (_req, res) => {
    const specPath = path.join(__dirname, '..', 'docs', 'openapi.json');
    try {
        const raw = fs.readFileSync(specPath, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(raw);
    } catch {
        res.status(404).json({ error: 'OpenAPI spec not found' });
    }
});

const PORT = process.env.PORT || 5000;
initDatabase().then(() => {
    setInterval(runScheduledResets, 60 * 1000);
    const httpServer = http.createServer(app);
    initSharePlay(httpServer, pool, process.env.JWT_SECRET);
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════╗
║   ✅ Backend running on port ${PORT}       ║
║   📡 Listening on 0.0.0.0:${PORT}          ║
║   🔐 JWT: ENABLED                          ║
║   🎮 Share Play: ENABLED                   ║
╚════════════════════════════════════════════╝`);
    });
}).catch(err => { console.error('❌ Init failed:', err); process.exit(1); });

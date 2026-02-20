const { Pool } = require('pg');
const express = require('express');
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
require('dotenv').config();

// ── Scoring ───────────────────────────────────────────────────────────────────
const SCORE_MIN_POINTS = parseInt(process.env.SCORE_MIN_POINTS || '5', 10);
const SCORE_MAX_EASY = parseInt(process.env.SCORE_MAX_EASY || '10', 10);
const SCORE_MAX_MED = parseInt(process.env.SCORE_MAX_MED || '15', 10);
const SCORE_MAX_HARD = parseInt(process.env.SCORE_MAX_HARD || '20', 10);
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
        // No SMTP configured — log token so dev environments still work
        console.warn('⚠️  SMTP not configured. Reset token (dev only):');
        console.warn(`    Email : ${toEmail}`);
        console.warn(`    Token : ${resetToken}`);
        console.warn(`    URL   : ${resetUrl}`);
        return { devMode: true, token: resetToken, url: resetUrl };
    }

    const html = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#007bff">🏆 Open-Trivia — Password Reset</h2>
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
        subject: 'Open-Trivia — Reset your password',
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
                show_email BOOLEAN
            );
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS image_settings (
                id SERIAL PRIMARY KEY,
                max_image_kb INT DEFAULT 512,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS submitted_by_email VARCHAR(255) DEFAULT 'anonymous'`,
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS image_url TEXT`,
            `ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(60)`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_email BOOLEAN`,
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS image_settings (
                id SERIAL PRIMARY KEY,
                max_image_kb INT DEFAULT 512,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_min_attempts INT DEFAULT 25`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_up_threshold NUMERIC DEFAULT 0.4`,
            `ALTER TABLE scoring_settings ADD COLUMN IF NOT EXISTS diff_down_threshold NUMERIC DEFAULT 0.8`,
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
║   🆕 ADMIN ACCOUNT CREATED — SAVE THESE CREDENTIALS     ║
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
app.use(cors({ origin: ['http://localhost:3009','http://localhost:3000'], credentials: true }));
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
        INSERT INTO scoring_settings (min_points, max_easy, max_med, max_hard, fast_ms, slow_ms, diff_min_attempts, diff_up_threshold, diff_down_threshold)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *`,
        [
            SCORE_MIN_POINTS,
            SCORE_MAX_EASY,
            SCORE_MAX_MED,
            SCORE_MAX_HARD,
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
    if (r.rows.length) return r.rows[0];
    const inserted = await pool.query(`
        INSERT INTO rate_limit_settings (
            guest_min_interval_ms,
            user_burst_window_ms,
            user_burst_max,
            user_cooldown_ms
        )
        VALUES (300000, 300000, 3, 300000)
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
        users: ['id','email','password_hash','role','score','is_anonymous','blocked_until','blocked_reason','display_name','show_email'],
        categories: ['id','name'],
        questions: ['id','category_id','text','option_a','option_b','option_c','option_d','correct_answer','complexity','disabled','image_url'],
        pending_questions: ['id','user_id','submitted_by_email','category_name','text','option_a','option_b','option_c','option_d','correct_answer','complexity','image_url','submitted_at','status'],
        game_sessions: ['id','user_id','question_id','category_id','selected_answer','is_correct','points','created_at'],
        question_reports: ['id','question_id','reason','reported_at'],
        score_resets: ['id','scope','user_id','category_id','reset_at','reset_by_admin_id','reason'],
        leaderboard_schedules: ['id','period','enabled','next_run','last_run'],
        scoring_settings: ['id','min_points','max_easy','max_med','max_hard','fast_ms','slow_ms','diff_min_attempts','diff_up_threshold','diff_down_threshold','updated_at'],
        privacy_settings: ['id','hide_emails_globally','hide_emails_by_default','updated_at'],
        rate_limit_settings: ['id','guest_min_interval_ms','user_burst_window_ms','user_burst_max','user_cooldown_ms','updated_at'],
        image_settings: ['id','max_image_kb','updated_at'],
        audit_logs: ['id','admin_id','action','details','created_at'],
        password_reset_tokens: ['id','user_id','token','expires_at','used','created_at'],
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (mode === 'replace') {
            await client.query('TRUNCATE TABLE password_reset_tokens, audit_logs, question_reports, pending_questions, game_sessions, score_resets, leaderboard_schedules, scoring_settings, privacy_settings, rate_limit_settings, image_settings, questions, categories, users RESTART IDENTITY CASCADE');
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
            'INSERT INTO users (email,password_hash,role,display_name,show_email) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,role,score,display_name,show_email',
            [email, hashed, role, displayName, showEmail]
        );
        const token = jwt.sign({ id: r.rows[0].id, role: r.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ user: r.rows[0], token });
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
        const token = jwt.sign({ id: r.rows[0].id, role: r.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        const { password_hash, ...user } = { ...r.rows[0], display_name: displayName, show_email: showEmail };
        res.json({ user, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
                ? 'No email server configured — token returned for development use.'
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
    try { res.json((await pool.query('SELECT * FROM categories ORDER BY name')).rows); }
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
        const catCheck = await pool.query('SELECT id FROM categories WHERE id=$1', [categoryId]);
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
            [categoryId, text, options.a, options.b, options.c, options.d, correctAnswer, complexity, normalizedImageUrl]
        );
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/questions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { categoryId, text, options, correctAnswer, complexity, imageUrl } = req.body;
    try {
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
            [categoryId, text, options.a, options.b, options.c, options.d, correctAnswer, complexity, normalizedImageUrl, req.params.id]
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
app.get('/game/next', async (req, res) => {
    const catParsed = req.query.categoryId ? parseInt(req.query.categoryId, 10) : NaN;
    const catId = Number.isNaN(catParsed) ? null : catParsed;
    try {
        const count = await pool.query(
            'SELECT COUNT(*) FROM questions WHERE disabled=FALSE AND ($1::int IS NULL OR category_id=$1)',
            [catId]
        );
        if (parseInt(count.rows[0].count) === 0) return res.json({ message: 'No questions available' });
        const qr = await pool.query(
            'SELECT * FROM questions WHERE disabled=FALSE AND ($1::int IS NULL OR category_id=$1) ORDER BY RANDOM() LIMIT 1',
            [catId]
        );
        const q = qr.rows[0];
        const cat = await pool.query('SELECT name FROM categories WHERE id=$1', [q.category_id]);
        const options = [
            { char: 'A', text: q.option_a }, { char: 'B', text: q.option_b },
            { char: 'C', text: q.option_c }, { char: 'D', text: q.option_d }
        ];
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
            // Authenticated user — track normally
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

// Report a question — rate-limited for guests and users
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

// ── LEADERBOARD — excludes anonymous users and admins ──────────────────────────
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

// ── USER: PROFILE / PRIVACY ───────────────────────────────────────────────────
app.get('/me/profile', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    try {
        const r = await pool.query('SELECT email, display_name, show_email FROM users WHERE id=$1', [u.id]);
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
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/me/profile', async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    const { displayName, showEmail } = req.body || {};
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
        if (updates.length) {
            params.push(u.id);
            await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id=$${params.length}`, params);
        }
        const privacy = await getPrivacySettings();
        const updated = await pool.query('SELECT email, display_name, show_email FROM users WHERE id=$1', [u.id]);
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
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PENDING QUESTIONS — rate-limited for guests and users ─────────────────────
app.post('/pending-questions', async (req, res) => {
    const u = getTokenUser(req);
    const { categoryName, text, options, correctAnswer, complexity, imageUrl } = req.body;
    if (!categoryName || !text || !options || !correctAnswer || !complexity)
        return res.status(400).json({ error: 'All fields required' });
    try {
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
             (user_id,submitted_by_email,category_name,text,option_a,option_b,option_c,option_d,correct_answer,complexity,image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [userId, email, categoryName, text, options.a, options.b, options.c, options.d, correctAnswer, complexity, normalizedImageUrl]
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
        };
        const r = await pool.query(
            `INSERT INTO rate_limit_settings (guest_min_interval_ms, user_burst_window_ms, user_burst_max, user_cooldown_ms)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [next.guest_min_interval_ms, next.user_burst_window_ms, next.user_burst_max, next.user_cooldown_ms]
        );
        await auditLog(admin.id, 'RATE_LIMIT_SETTINGS_UPDATE', `guest_interval=${next.guest_min_interval_ms} user_window=${next.user_burst_window_ms} user_burst=${next.user_burst_max} user_cooldown=${next.user_cooldown_ms}`);
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

app.post('/admin/categories/import-zip', async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const upload = multer({ storage: multer.memoryStorage() }).single('file');
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: 'Upload failed' });
        if (!req.file) return res.status(400).json({ error: 'No zip provided' });
        try {
            const inserted = await importCategoryZipBuffer(req.file.buffer);
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
        let zipUrl = repoUrl;
        if (/github\.com\/[^/]+\/[^/]+/i.test(repoUrl)) {
            const parts = repoUrl.replace(/\/$/, '').split('/');
            const owner = parts[parts.length - 2];
            const repo = parts[parts.length - 1].replace(/\.git$/, '');
            zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
        }
        const r = await fetch(zipUrl);
        if (!r.ok) return res.status(400).json({ error: 'Failed to fetch repo zip' });
        const buf = Buffer.from(await r.arrayBuffer());
        const inserted = await importCategoryZipBuffer(buf);
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
            Number(fast_ms ?? SCORE_FAST_MS),
            Number(slow_ms ?? SCORE_SLOW_MS),
            Number(diff_min_attempts ?? DIFF_MIN_ATTEMPTS),
            Number(diff_up_threshold ?? DIFF_UP_THRESHOLD),
            Number(diff_down_threshold ?? DIFF_DOWN_THRESHOLD),
        ];
        await runQuery(
            `INSERT INTO scoring_settings (min_points, max_easy, max_med, max_hard, fast_ms, slow_ms, diff_min_attempts, diff_up_threshold, diff_down_threshold, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            vals
        );
        await auditLog(admin.id, 'SCORING_SETTINGS_UPDATE', `min=${vals[0]}, easy=${vals[1]}, med=${vals[2]}, hard=${vals[3]}, fastMs=${vals[4]}, slowMs=${vals[5]}, diffMinAttempts=${vals[6]}, diffUp=${vals[7]}, diffDown=${vals[8]}`);
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
                `INSERT INTO users (id,email,password_hash,role,score,is_anonymous,blocked_until,blocked_reason,display_name,show_email)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [userRow.id, userRow.email, userRow.password_hash, userRow.role, userRow.score, userRow.is_anonymous, userRow.blocked_until, userRow.blocked_reason, userRow.display_name, userRow.show_email]
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
            await restoreRows('pending_questions', ['id','user_id','submitted_by_email','category_name','text','option_a','option_b','option_c','option_d','correct_answer','complexity','image_url','submitted_at','status'], pending);

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
        const r = await pool.query(`SELECT * FROM pending_questions WHERE status='pending' ORDER BY submitted_at DESC`);
        res.json(r.rows);
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════╗
║   ✅ Backend running on port ${PORT}       ║
║   📡 Listening on 0.0.0.0:${PORT}          ║
║   🔐 JWT: ENABLED                          ║
╚════════════════════════════════════════════╝`);
    });
}).catch(err => { console.error('❌ Init failed:', err); process.exit(1); });

'use strict';
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const LIVE_CODE = 'LIVE';
const SESSION_RESET_MS  = 30 * 60 * 1000;  // 30 min idle → reset session score
const RESULTS_DISPLAY_MS = 5000;            // results shown for 5 s
const EMPTY_ROOM_TTL_MS  = 5 * 60 * 1000;  // private room auto-deletes after 5 min empty

const rooms = new Map();  // code → roomState

// ── Room factory ──────────────────────────────────────────────────────────────

function makeRoom(code, isLive = false) {
    return {
        code,
        isLive,
        isPublic: isLive,           // live room is always public; custom rooms default private
        hostSocketId: null,
        hostUserId: null,
        // ── Game settings ──────────────────────────────────────────────────────
        timerSeconds: 15,
        allowChangeGuess: true,
        showOtherGuesses: false,    // reveal each player's chosen option vs just counts
        showLiveVotes: false,       // show per-option vote breakdown during round
        showVoteCount: true,        // show total voter count (X/Y voted)
        showPlayerStats: true,      // show answered/correct counts in scoreboard
        showQualityRating: false,   // show A–F accuracy rating
        pointsCorrect: 5,           // base pts for a correct answer
        pointsIncorrect: 1,         // pts for a wrong answer
        timeBonus: 0.25,            // extra pts per second remaining at vote time
        goldBonus: 5,               // 1st to vote bonus pts
        silverBonus: 3,             // 2nd to vote bonus pts
        bronzeBonus: 1,             // 3rd to vote bonus pts
        categoryIds: [],
        // ── Round state ────────────────────────────────────────────────────────
        players: new Map(),         // socketId → playerObj
        phase: 'waiting',           // 'waiting' | 'question' | 'results'
        currentQuestion: null,
        currentRoundId: null,
        roundStartTime: null,
        votes: new Map(),           // socketId → 'A'|'B'|'C'|'D'
        answerOrder: [],            // socketIds in first-vote order (for speed medals)
        roundTimer: null,
        earlyEndTimer: null,        // fires when all players voted + allowChangeGuess is on
        lastActivity: Date.now(),
        lastEmptyAt: null,          // timestamp when last player left (for auto-delete)
        usedQuestionIds: new Set(),
    };
}

// ── Player helpers ────────────────────────────────────────────────────────────

function calcRating(p) {
    if ((p.totalAnswered || 0) < 3) return null;
    const pct = (p.correctCount || 0) / p.totalAnswered;
    if (pct >= 0.9) return 'A';
    if (pct >= 0.8) return 'B';
    if (pct >= 0.7) return 'C';
    if (pct >= 0.6) return 'D';
    return 'F';
}

function playerList(room) {
    return [...room.players.values()]
        .sort((a, b) => b.sessionScore - a.sessionScore)
        .slice(0, 10)
        .map(p => ({
            displayName: p.displayName,
            sessionScore: p.sessionScore,
            userId: p.userId || null,
            isHost: !!p.isHost,
            ...(room.showPlayerStats ? {
                totalAnswered: p.totalAnswered || 0,
                correctCount: p.correctCount || 0,
            } : {}),
            ...(room.showPlayerStats && room.showQualityRating ? { rating: calcRating(p) } : {}),
        }));
}

// ── Vote helpers ──────────────────────────────────────────────────────────────

function voteCounts(room) {
    const c = { A: 0, B: 0, C: 0, D: 0 };
    for (const a of room.votes.values()) if (a in c) c[a]++;
    return c;
}

function voteDetails(room) {
    // Per-option list of display names (used when showOtherGuesses is on)
    const d = { A: [], B: [], C: [], D: [] };
    for (const [sid, ans] of room.votes) {
        const p = room.players.get(sid);
        if (p && ans in d) d[ans].push(p.displayName);
    }
    return d;
}

function speedMedal(room, sid) {
    const idx = room.answerOrder.indexOf(sid);
    if (idx === 0) return { medal: 'gold',   bonus: room.goldBonus };
    if (idx === 1) return { medal: 'silver', bonus: room.silverBonus };
    if (idx === 2) return { medal: 'bronze', bonus: room.bronzeBonus };
    return { medal: null, bonus: 0 };
}

// ── Room list ─────────────────────────────────────────────────────────────────

function publicRooms() {
    const list = [];
    for (const [, room] of rooms) {
        if (room.isPublic) {
            list.push({
                code: room.code,
                isLive: room.isLive,
                playerCount: room.players.size,
                timerSeconds: room.timerSeconds,
                phase: room.phase,
                categoryIds: room.categoryIds,
            });
        }
    }
    return list.sort((a, b) => b.playerCount - a.playerCount);
}

// ── Code generator ────────────────────────────────────────────────────────────

function generateCode() {
    let code;
    do { code = String(Math.floor(1000 + Math.random() * 9000)); }
    while (rooms.has(code));
    return code;
}

// ── Question helpers ──────────────────────────────────────────────────────────

function shuffleOptions(row) {
    const opts = [
        { key: 'A', text: row.option_a },
        { key: 'B', text: row.option_b },
        { key: 'C', text: row.option_c },
        { key: 'D', text: row.option_d },
    ].filter(o => String(o.text || '').trim());
    for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return opts;
}

async function fetchQuestion(room, pool) {
    const used = [...room.usedQuestionIds];
    const params = [];
    const clauses = [];

    if (used.length) {
        clauses.push(`q.id NOT IN (${used.map((_, i) => `$${params.length + i + 1}`).join(',')})`);
        params.push(...used);
    }
    if (room.categoryIds.length) {
        clauses.push(`q.category_id IN (${room.categoryIds.map((_, i) => `$${params.length + i + 1}`).join(',')})`);
        params.push(...room.categoryIds);
    }

    const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    const sql = `
        SELECT q.*, c.name AS category_name
        FROM questions q JOIN categories c ON c.id = q.category_id
        WHERE q.disabled = FALSE AND c.disabled = FALSE ${where}
        ORDER BY RANDOM() LIMIT 1
    `;

    let result = await pool.query(sql, params);
    if (!result.rows.length) {
        room.usedQuestionIds.clear();
        const baseParams = room.categoryIds.length ? room.categoryIds : [];
        const baseSql = sql.replace(where, room.categoryIds.length
            ? `AND q.category_id IN (${room.categoryIds.map((_, i) => `$${i + 1}`).join(',')})`
            : '');
        result = await pool.query(baseSql, baseParams);
        if (!result.rows.length) return null;
    }

    const row = result.rows[0];
    room.usedQuestionIds.add(row.id);
    return {
        id: row.id,
        text: row.text,
        options: shuffleOptions(row),
        correctAnswer: row.correct_answer,
        complexity: row.complexity,
        categoryName: row.category_name,
        imageUrl: row.image_url || null,
    };
}

function publicQuestion(q) {
    if (!q) return null;
    return { id: q.id, text: q.text, options: q.options, categoryName: q.categoryName, imageUrl: q.imageUrl, complexity: q.complexity };
}

// ── Game loop ─────────────────────────────────────────────────────────────────

async function startRound(code, pool, io) {
    const room = rooms.get(code);
    if (!room) return;

    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }

    let q;
    try { q = await fetchQuestion(room, pool); }
    catch (err) { console.error('[SharePlay] fetchQuestion error:', err.message); }

    if (!q) {
        room.phase = 'waiting';
        io.to(code).emit('room_status', { phase: 'waiting', message: 'No questions available.' });
        return;
    }

    room.currentQuestion = q;
    room.votes = new Map();
    room.answerOrder = [];
    if (room.earlyEndTimer) { clearTimeout(room.earlyEndTimer); room.earlyEndTimer = null; }
    room.phase = 'question';
    room.roundStartTime = Date.now();
    room.lastActivity = Date.now();

    const endsAt = room.roundStartTime + room.timerSeconds * 1000;

    try {
        const r = await pool.query(
            `INSERT INTO shareplay_rounds (room_code, question_id, started_at, ends_at, timer_seconds)
             VALUES ($1, $2, NOW(), $3, $4) RETURNING id`,
            [code, q.id, new Date(endsAt), room.timerSeconds]
        );
        room.currentRoundId = r.rows[0].id;
    } catch { room.currentRoundId = null; }

    io.to(code).emit('question_start', {
        question: publicQuestion(q),
        endsAt,
        timerSeconds: room.timerSeconds,
        settings: roomSettings(room),
    });

    room.roundTimer = setTimeout(() => endRound(code, pool, io), room.timerSeconds * 1000);
}

async function endRound(code, pool, io) {
    const room = rooms.get(code);
    if (!room || room.phase !== 'question') return;

    room.phase = 'results';
    if (room.roundTimer)    { clearTimeout(room.roundTimer);    room.roundTimer    = null; }
    if (room.earlyEndTimer) { clearTimeout(room.earlyEndTimer); room.earlyEndTimer = null; }

    const { currentQuestion: q, roundStartTime, timerSeconds } = room;
    const correctAnswer = q.correctAnswer;
    const counts = voteCounts(room);
    const details = room.showOtherGuesses ? voteDetails(room) : null;
    const now = Date.now();

    const scored = [];
    for (const [sid, answer] of room.votes) {
        const p = room.players.get(sid);
        if (!p) continue;

        const isCorrect = answer === correctAnswer;
        const voteMs = Math.max(0, (p.voteTimestamp || now) - roundStartTime);
        const secsRemaining = Math.max(0, timerSeconds - voteMs / 1000);
        const { medal, bonus } = speedMedal(room, sid);

        const pts = isCorrect
            ? Math.round((room.pointsCorrect + room.timeBonus * secsRemaining + bonus) * 100) / 100
            : room.pointsIncorrect;

        if (p.lastActive && (now - p.lastActive) > SESSION_RESET_MS) p.sessionScore = 0;
        p.sessionScore = Math.round((p.sessionScore + pts) * 100) / 100;
        p.lastActive = now;
        p.totalAnswered = (p.totalAnswered || 0) + 1;
        if (isCorrect) p.correctCount = (p.correctCount || 0) + 1;

        scored.push({ sid, displayName: p.displayName, answer, isCorrect, points: pts, medal, userId: p.userId || null });

        if (p.userId) {
            try {
                await pool.query(
                    `INSERT INTO game_sessions (user_id, question_id, category_id, selected_answer, is_correct, points)
                     SELECT $1, $2, category_id, $3, $4, $5 FROM questions WHERE id = $2`,
                    [p.userId, q.id, answer, isCorrect, Math.round(pts)]
                );
                await pool.query(`UPDATE users SET score = score + $1 WHERE id = $2`, [Math.round(pts), p.userId]);
            } catch (err) { console.error('[SharePlay] persist score error:', err.message); }
        }
    }

    if (room.currentRoundId) {
        try { await pool.query(`UPDATE shareplay_rounds SET ended_at = NOW(), correct_answer = $1 WHERE id = $2`, [correctAnswer, room.currentRoundId]); }
        catch {}
    }

    const tp = playerList(room);

    for (const [sid] of room.players) {
        const mine = scored.find(s => s.sid === sid);
        const sock = io.sockets.sockets.get(sid);
        if (!sock) continue;
        sock.emit('round_end', {
            correctAnswer,
            counts,
            details,            // null if showOtherGuesses is off
            totalVoters: room.votes.size,
            myResult: mine ? { answer: mine.answer, isCorrect: mine.isCorrect, points: mine.points, medal: mine.medal } : null,
            topPlayers: tp,
        });
    }

    room.roundTimer = setTimeout(() => {
        if (!rooms.has(code)) return;
        const r = rooms.get(code);
        if (r.players.size > 0 || r.isLive) startRound(code, pool, io);
        else r.phase = 'waiting';
    }, RESULTS_DISPLAY_MS);
}

// ── Settings snapshot sent to clients ────────────────────────────────────────

function roomSettings(room) {
    return {
        timerSeconds: room.timerSeconds,
        allowChangeGuess: room.allowChangeGuess,
        showOtherGuesses: room.showOtherGuesses,
        showLiveVotes: room.showLiveVotes,
        showVoteCount: room.showVoteCount,
        showPlayerStats: room.showPlayerStats,
        showQualityRating: room.showQualityRating,
        pointsCorrect: room.pointsCorrect,
        pointsIncorrect: room.pointsIncorrect,
        timeBonus: room.timeBonus,
        goldBonus: room.goldBonus,
        silverBonus: room.silverBonus,
        bronzeBonus: room.bronzeBonus,
        categoryIds: room.categoryIds,
        isPublic: room.isPublic,
    };
}

// Apply a settings patch to a room (shared by host_settings and admin_live_settings)
function applySettings(room, data) {
    if (data.timerSeconds !== undefined)   room.timerSeconds     = Math.max(5, Math.min(120, Number(data.timerSeconds)));
    if (data.allowChangeGuess !== undefined) room.allowChangeGuess = !!data.allowChangeGuess;
    if (data.showOtherGuesses !== undefined) room.showOtherGuesses = !!data.showOtherGuesses;
    if (data.showLiveVotes    !== undefined) room.showLiveVotes    = !!data.showLiveVotes;
    if (data.showVoteCount    !== undefined) room.showVoteCount    = !!data.showVoteCount;
    if (data.showPlayerStats  !== undefined) room.showPlayerStats  = !!data.showPlayerStats;
    if (data.showQualityRating !== undefined) room.showQualityRating = !!data.showQualityRating;
    if (data.pointsCorrect    !== undefined) room.pointsCorrect   = Math.max(1, Math.min(100, Number(data.pointsCorrect)));
    if (data.pointsIncorrect  !== undefined) room.pointsIncorrect = Math.max(0, Math.min(50,  Number(data.pointsIncorrect)));
    if (data.timeBonus        !== undefined) room.timeBonus       = Math.max(0, Math.min(5,   Number(data.timeBonus)));
    if (data.goldBonus        !== undefined) room.goldBonus       = Math.max(0, Math.min(50,  Number(data.goldBonus)));
    if (data.silverBonus      !== undefined) room.silverBonus     = Math.max(0, Math.min(50,  Number(data.silverBonus)));
    if (data.bronzeBonus      !== undefined) room.bronzeBonus     = Math.max(0, Math.min(50,  Number(data.bronzeBonus)));
    if (Array.isArray(data.categoryIds))     room.categoryIds     = data.categoryIds.map(Number);
    if (data.isPublic !== undefined)         room.isPublic        = !!data.isPublic;
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = function initSharePlay(server, pool, jwtSecret) {
    const io = new Server(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    rooms.set(LIVE_CODE, makeRoom(LIVE_CODE, true));
    setTimeout(() => startRound(LIVE_CODE, pool, io), 1500);

    // Auto-delete empty private rooms after 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [code, room] of rooms) {
            if (!room.isLive && room.players.size === 0 && room.lastEmptyAt && (now - room.lastEmptyAt) > EMPTY_ROOM_TTL_MS) {
                if (room.roundTimer) clearTimeout(room.roundTimer);
                rooms.delete(code);
                console.log(`[SharePlay] Auto-deleted empty room ${code}`);
            }
        }
    }, 60_000);

    io.roomsMap = rooms;
    io.publicRooms = publicRooms;

    io.on('connection', (socket) => {
        let currentCode = null;

        function decoded() {
            const tok = socket.handshake.auth?.token;
            if (!tok) return null;
            try { return jwt.verify(tok, jwtSecret); } catch { return null; }
        }

        function getProfile() {
            const d = decoded();
            if (d) return { userId: d.id, displayName: d.display_name || d.email?.split('@')[0] || 'Player', role: d.role || 'player', isLoggedIn: true };
            return { userId: null, displayName: `Guest${socket.id.slice(-4)}`, role: 'guest', isLoggedIn: false };
        }

        function isAppAdmin() { return getProfile().role === 'admin'; }

        function addToRoom(code) {
            const room = rooms.get(code);
            if (!room) return false;
            if (currentCode && currentCode !== code) dropFromRoom();

            const profile = getProfile();
            const now = Date.now();
            let sessionScore = 0, totalAnswered = 0, correctCount = 0;

            // Reconnect: preserve stats for logged-in users
            if (profile.userId) {
                for (const [sid, p] of room.players) {
                    if (p.userId === profile.userId && sid !== socket.id) {
                        const expired = (now - (p.lastActive || 0)) > SESSION_RESET_MS;
                        sessionScore   = expired ? 0 : p.sessionScore;
                        totalAnswered  = p.totalAnswered || 0;
                        correctCount   = p.correctCount  || 0;
                        room.players.delete(sid);
                        room.votes.delete(sid);
                        const idx = room.answerOrder.indexOf(sid);
                        if (idx !== -1) room.answerOrder[idx] = socket.id;
                        break;
                    }
                }
            }

            const isHost = !room.isLive && (
                room.hostSocketId === socket.id ||
                (profile.userId && profile.userId === room.hostUserId)
            );
            if (isHost) room.hostSocketId = socket.id;

            room.players.set(socket.id, {
                ...profile, sessionScore, totalAnswered, correctCount,
                lastActive: now, voteTimestamp: null, isHost,
            });
            socket.join(code);
            currentCode = code;
            return true;
        }

        function promoteNextHost(room) {
            // Highest session score remaining player becomes host
            let best = null;
            for (const [sid, p] of room.players) {
                if (!best || p.sessionScore > best.score) best = { sid, score: p.sessionScore };
            }
            if (!best) return;
            room.hostSocketId = best.sid;
            const p = room.players.get(best.sid);
            if (p) {
                p.isHost = true;
                room.hostUserId = p.userId || null;
            }
            const sock = io.sockets.sockets.get(best.sid);
            if (sock) sock.emit('promoted_host', { message: 'You are now the room host.' });
            io.to(room.code).emit('players_update', { players: playerList(room) });
        }

        function dropFromRoom() {
            if (!currentCode) return;
            const room = rooms.get(currentCode);
            if (room) {
                const wasHost = !room.isLive && room.hostSocketId === socket.id;
                room.players.delete(socket.id);
                room.votes.delete(socket.id);
                const orderIdx = room.answerOrder.indexOf(socket.id);
                if (orderIdx !== -1) room.answerOrder.splice(orderIdx, 1);

                if (room.players.size === 0) {
                    room.lastEmptyAt = Date.now();
                    if (!room.isLive) {
                        // Give it a moment then check - it'll be cleaned by the interval
                        io.to(currentCode).emit('players_update', { players: [] });
                    }
                } else {
                    if (wasHost) promoteNextHost(room);
                    io.to(currentCode).emit('players_update', { players: playerList(room) });
                }
            }
            socket.leave(currentCode);
            currentCode = null;
        }

        // ── Send current live vote state to new joiner ─────────────────────────
        function sendRoomJoined(code, room, isHost) {
            const myVote = room.phase === 'question' ? (room.votes.get(socket.id) || null) : null;
            socket.emit('room_joined', {
                roomCode: code,
                isHost,
                isLive: room.isLive,
                players: playerList(room),
                phase: room.phase,
                currentQuestion: room.phase === 'question' ? publicQuestion(room.currentQuestion) : null,
                endsAt: room.phase === 'question' ? room.roundStartTime + room.timerSeconds * 1000 : null,
                myVote,
                settings: roomSettings(room),
            });
        }

        // ── Events ─────────────────────────────────────────────────────────────

        socket.on('get_rooms', () => {
            socket.emit('rooms_list', { rooms: publicRooms() });
        });

        socket.on('join_live_room', () => {
            if (!addToRoom(LIVE_CODE)) { socket.emit('room_error', { message: 'Live room unavailable.' }); return; }
            const room = rooms.get(LIVE_CODE);
            sendRoomJoined(LIVE_CODE, room, false);
            io.to(LIVE_CODE).emit('players_update', { players: playerList(room) });
            if (room.phase === 'waiting') startRound(LIVE_CODE, pool, io);
        });

        socket.on('create_room', (data) => {
            const code = generateCode();
            const room = makeRoom(code, false);
            const profile = getProfile();
            room.hostSocketId = socket.id;
            room.hostUserId = profile.userId;
            applySettings(room, data || {});
            if (data?.isPublic !== undefined) room.isPublic = !!data.isPublic;
            rooms.set(code, room);

            addToRoom(code);
            const p = room.players.get(socket.id);
            if (p) p.isHost = true;
            sendRoomJoined(code, room, true);
        });

        socket.on('join_room', (data) => {
            const code = String(data?.code || '').trim();
            if (!rooms.has(code)) { socket.emit('room_error', { message: 'Room not found. Check the code and try again.' }); return; }
            if (!addToRoom(code)) return;
            const room = rooms.get(code);
            const profile = getProfile();
            const isHost = room.hostSocketId === socket.id || (profile.userId && profile.userId === room.hostUserId);
            sendRoomJoined(code, room, isHost);
            io.to(code).emit('players_update', { players: playerList(room) });
        });

        socket.on('submit_vote', (data) => {
            const answer = String(data?.answer || '').toUpperCase();
            if (!currentCode || !['A', 'B', 'C', 'D'].includes(answer)) return;
            const room = rooms.get(currentCode);
            if (!room || room.phase !== 'question') return;
            const p = room.players.get(socket.id);
            if (!p) return;
            const alreadyVoted = room.votes.has(socket.id);
            if (alreadyVoted && !room.allowChangeGuess) return;

            // Track order for speed medals (first vote only)
            if (!alreadyVoted) room.answerOrder.push(socket.id);

            room.votes.set(socket.id, answer);
            p.voteTimestamp = Date.now();
            p.lastActive = Date.now();

            const update = {
                counts: voteCounts(room),
                totalVoters: room.votes.size,
                ...(room.showOtherGuesses ? { details: voteDetails(room) } : {}),
            };
            io.to(currentCode).emit('vote_update', update);
            socket.emit('vote_confirmed', { answer });

            // ── Early-end logic ─────────────────────────────────────────────
            const allVoted = room.votes.size >= room.players.size && room.players.size > 0;
            if (allVoted) {
                if (!room.allowChangeGuess) {
                    // End immediately - nobody can change anyway
                    if (room.roundTimer)    { clearTimeout(room.roundTimer);    room.roundTimer = null; }
                    if (room.earlyEndTimer) { clearTimeout(room.earlyEndTimer); room.earlyEndTimer = null; }
                    endRound(currentCode, pool, io);
                } else {
                    // Give 5 s in case someone changes their mind; reset timer on each change
                    if (room.earlyEndTimer) clearTimeout(room.earlyEndTimer);
                    io.to(currentCode).emit('early_end_warning', { secondsLeft: 5 });
                    room.earlyEndTimer = setTimeout(() => {
                        room.earlyEndTimer = null;
                        if (room.phase === 'question') {
                            if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
                            endRound(currentCode, pool, io);
                        }
                    }, 5000);
                }
            }
        });

        socket.on('host_start', () => {
            if (!currentCode) return;
            const room = rooms.get(currentCode);
            if (!room || room.isLive || room.hostSocketId !== socket.id || room.phase !== 'waiting') return;
            startRound(currentCode, pool, io);
        });

        // Host of any private room can adjust settings
        socket.on('host_settings', (data) => {
            if (!currentCode) return;
            const room = rooms.get(currentCode);
            if (!room || room.isLive || room.hostSocketId !== socket.id) return;
            applySettings(room, data);
            io.to(currentCode).emit('room_settings', roomSettings(room));
        });

        // App admin can adjust settings on the live room (or any room)
        socket.on('admin_live_settings', (data) => {
            if (!isAppAdmin()) { socket.emit('room_error', { message: 'Admin access required.' }); return; }
            const targetCode = data?.roomCode || LIVE_CODE;
            const room = rooms.get(targetCode);
            if (!room) { socket.emit('room_error', { message: 'Room not found.' }); return; }
            applySettings(room, data);
            io.to(targetCode).emit('room_settings', roomSettings(room));
        });

        socket.on('leave_room', () => dropFromRoom());
        socket.on('disconnect', () => dropFromRoom());
    });

    return io;
};

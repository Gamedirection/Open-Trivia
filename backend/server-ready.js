const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

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
function requireAuth(req, res) {
    const u = getTokenUser(req);
    if (!u) { res.status(401).json({ error: 'Authentication required' }); return null; }
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
                is_anonymous BOOLEAN DEFAULT FALSE
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
                disabled BOOLEAN DEFAULT FALSE
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
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending'
            );
            CREATE TABLE IF NOT EXISTS game_sessions (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                question_id INT REFERENCES questions(id),
                selected_answer CHAR(1),
                is_correct BOOLEAN
            );
            CREATE TABLE IF NOT EXISTS question_reports (
                id SERIAL PRIMARY KEY,
                question_id INT REFERENCES questions(id) ON DELETE CASCADE,
                reason TEXT,
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                token VARCHAR(255) UNIQUE NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            `ALTER TABLE pending_questions ADD COLUMN IF NOT EXISTS submitted_by_email VARCHAR(255) DEFAULT 'anonymous'`,
            `ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE`,
        ];
        for (const m of migrations) {
            try { await client.query(m); } catch(e) { console.log('Migration skipped:', e.message); }
        }

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@trivia.com';
        const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'admin123';
        const check = await client.query('SELECT COUNT(*) FROM users WHERE email=$1', [adminEmail]);
        if (parseInt(check.rows[0].count) === 0) {
            const hash = await bcrypt.hash(adminPassword, 10);
            await client.query('INSERT INTO users (email,password_hash,role,score) VALUES ($1,$2,$3,0)', [adminEmail, hash, 'admin']);
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

// ── AUTH ───────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hashed = await bcrypt.hash(password, 10);
        // Only count non-anonymous real users to decide first-user-gets-admin
        const countRes = await pool.query('SELECT COUNT(*) FROM users WHERE is_anonymous=FALSE');
        const role = parseInt(countRes.rows[0].count) === 0 ? 'admin' : 'player';
        const r = await runQuery(
            'INSERT INTO users (email,password_hash,role) VALUES ($1,$2,$3) RETURNING id,email,role,score',
            [email, hashed, role]
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
        const token = jwt.sign({ id: r.rows[0].id, role: r.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        const { password_hash, ...user } = r.rows[0];
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
        await runQuery('DELETE FROM categories WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── QUESTIONS ──────────────────────────────────────────────────────────────────
app.get('/categories/:catId/questions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const r = await pool.query(
            'SELECT * FROM questions WHERE category_id=$1 ORDER BY id DESC',
            [req.params.catId]
        );
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/questions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { categoryId, text, options, correctAnswer, complexity } = req.body;
    if (!categoryId || !text || !options || !correctAnswer || !complexity)
        return res.status(400).json({ error: 'All fields required' });
    try {
        const catCheck = await pool.query('SELECT id FROM categories WHERE id=$1', [categoryId]);
        if (!catCheck.rows.length) return res.status(400).json({ error: `Category ${categoryId} not found` });
        const r = await runQuery(
            `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [categoryId, text, options.a, options.b, options.c, options.d, correctAnswer, complexity]
        );
        res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/questions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { categoryId, text, options, correctAnswer, complexity } = req.body;
    try {
        const r = await runQuery(
            `UPDATE questions SET category_id=$1,text=$2,option_a=$3,option_b=$4,option_c=$5,
             option_d=$6,correct_answer=$7,complexity=$8 WHERE id=$9 RETURNING *`,
            [categoryId, text, options.a, options.b, options.c, options.d, correctAnswer, complexity, req.params.id]
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
app.get('/game/next', async (_req, res) => {
    try {
        const count = await pool.query('SELECT COUNT(*) FROM questions WHERE disabled=FALSE');
        if (parseInt(count.rows[0].count) === 0) return res.json({ message: 'No questions available' });
        const qr = await pool.query('SELECT * FROM questions WHERE disabled=FALSE ORDER BY RANDOM() LIMIT 1');
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
        res.json({ id: q.id, category: cat.rows[0]?.name || 'General', text: q.text, options, complexity: q.complexity });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/game/submit', async (req, res) => {
    const { questionId, selectedAnswer, anonymousId } = req.body;
    if (!questionId || !selectedAnswer) return res.status(400).json({ error: 'questionId and selectedAnswer required' });
    try {
        const qr = await pool.query('SELECT correct_answer FROM questions WHERE id=$1', [questionId]);
        if (!qr.rows.length) return res.status(404).json({ error: 'Question not found' });
        const correctAnswer = qr.rows[0].correct_answer.trim().toUpperCase();
        const isCorrect = selectedAnswer.toUpperCase() === correctAnswer;
        const u = getTokenUser(req);

        if (u) {
            // Authenticated user — track normally
            await pool.query(
                'INSERT INTO game_sessions (user_id,question_id,selected_answer,is_correct) VALUES ($1,$2,$3,$4)',
                [u.id, questionId, selectedAnswer, isCorrect]
            );
            if (isCorrect) await pool.query('UPDATE users SET score=score+10 WHERE id=$1', [u.id]);
        } else if (anonymousId) {
            // Track under existing anonymous user record
            const anonUser = await pool.query('SELECT id FROM users WHERE id=$1 AND is_anonymous=TRUE', [anonymousId]);
            if (anonUser.rows.length) {
                await pool.query(
                    'INSERT INTO game_sessions (user_id,question_id,selected_answer,is_correct) VALUES ($1,$2,$3,$4)',
                    [anonUser.rows[0].id, questionId, selectedAnswer, isCorrect]
                );
                if (isCorrect) await pool.query('UPDATE users SET score=score+10 WHERE id=$1', [anonUser.rows[0].id]);
            }
        }

        res.json({ isCorrect, correctAnswer });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create an anonymous tracking record for a guest player
app.post('/game/anonymous-session', async (req, res) => {
    try {
        const anonEmail = `anon_${crypto.randomBytes(8).toString('hex')}@anonymous.local`;
        const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        const r = await runQuery(
            'INSERT INTO users (email,password_hash,role,is_anonymous) VALUES ($1,$2,$3,TRUE) RETURNING id',
            [anonEmail, hash, 'player']
        );
        res.json({ anonymousId: r.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Report a question — requires authentication
app.post('/game/report', async (req, res) => {
    const u = requireAuth(req, res);
    if (!u) return;
    const { questionId, reason } = req.body;
    if (!questionId) return res.status(400).json({ error: 'questionId required' });
    try {
        const exists = await pool.query('SELECT id FROM questions WHERE id=$1', [questionId]);
        if (!exists.rows.length) return res.status(404).json({ error: 'Question not found' });
        await runQuery('INSERT INTO question_reports (question_id,reason) VALUES ($1,$2)', [questionId, reason || 'Reported by user']);
        console.log(`🚩 Question ${questionId} reported by user ${u.id}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LEADERBOARD — excludes anonymous users ─────────────────────────────────────
app.get('/leaderboard', async (_req, res) => {
    try {
        res.json((await pool.query(
            'SELECT id,email,score,role FROM users WHERE is_anonymous=FALSE ORDER BY score DESC LIMIT 50'
        )).rows);
    }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PENDING QUESTIONS — requires authentication ────────────────────────────────
app.post('/pending-questions', async (req, res) => {
    const u = requireAuth(req, res);
    if (!u) return;
    const { categoryName, text, options, correctAnswer, complexity } = req.body;
    if (!categoryName || !text || !options || !correctAnswer || !complexity)
        return res.status(400).json({ error: 'All fields required' });
    try {
        const userRow = await pool.query('SELECT email FROM users WHERE id=$1', [u.id]);
        const email = userRow.rows.length ? userRow.rows[0].email : 'unknown';
        await runQuery(
            `INSERT INTO pending_questions
             (user_id,submitted_by_email,category_name,text,option_a,option_b,option_c,option_d,correct_answer,complexity)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [u.id, email, categoryName, text, options.a, options.b, options.c, options.d, correctAnswer, complexity]
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
            SELECT u.id, u.email, u.role, u.score, u.is_anonymous,
                   COUNT(gs.id)::int AS games_played,
                   COUNT(gs.id) FILTER (WHERE gs.is_correct = TRUE)::int AS correct_answers
            FROM users u
            LEFT JOIN game_sessions gs ON gs.user_id = u.id
            GROUP BY u.id
            ORDER BY u.is_anonymous ASC, u.score DESC
        `);
        res.json(r.rows);
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
        await runQuery(
            `INSERT INTO questions (category_id,text,option_a,option_b,option_c,option_d,correct_answer,complexity)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [cat.id, pq.text, pq.option_a, pq.option_b, pq.option_c, pq.option_d, pq.correct_answer, pq.complexity]
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

const PORT = process.env.PORT || 5000;
initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════╗
║   ✅ Backend running on port ${PORT}       ║
║   📡 Listening on 0.0.0.0:${PORT}          ║
║   🔐 JWT: ENABLED                          ║
╚════════════════════════════════════════════╝`);
    });
}).catch(err => { console.error('❌ Init failed:', err); process.exit(1); });

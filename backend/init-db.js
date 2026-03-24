const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});

async function initDB() {
    const client = await pool.connect();
    try {
        console.log("Initializing database tables...");
        
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
                discord_avatar_url TEXT
            );
            
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS questions (
                id SERIAL PRIMARY KEY,
                category_id INT REFERENCES categories(id),
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
                question_id INT REFERENCES questions(id),
                reason TEXT,
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS score_resets (
                id SERIAL PRIMARY KEY,
                scope VARCHAR(20) NOT NULL,
                user_id INT REFERENCES users(id),
                category_id INT REFERENCES categories(id),
                reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reset_by_admin_id INT REFERENCES users(id),
                reason TEXT
            );

            CREATE TABLE IF NOT EXISTS leaderboard_schedules (
                id SERIAL PRIMARY KEY,
                period VARCHAR(20) UNIQUE NOT NULL,
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
                daily_time VARCHAR(5),
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

            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INT REFERENCES users(id),
                action VARCHAR(255) NOT NULL,
                details TEXT,
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
            
            -- Create Admin User if none exists
            DO $$
            DECLARE
                user_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO user_count FROM users;
                IF user_count = 0 THEN
                    INSERT INTO users (email, password_hash, role, score, display_name, show_email)
                    VALUES (
                        'asierputowski@ctmsit.com',
                        '\$2a\$06\$RSlUWkudtmDFVSUy94ktluvq/HQGAxE46XbfqeAoVBZdaaOzAcTMK',
                        'admin',
                        0,
                        split_part('asierputowski@ctmsit.com', '@', 1),
                        TRUE
                    );
                END IF;
            END $$;
        `);
        console.log("✅ Database initialized successfully.");
    } catch (err) {
        console.error("❌ Database initialization failed:", err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

initDB();

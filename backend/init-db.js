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
                blocked_reason TEXT
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

            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INT REFERENCES users(id),
                action VARCHAR(255) NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Create Admin User if none exists
            DO $$
            DECLARE
                user_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO user_count FROM users;
                IF user_count = 0 THEN
                    INSERT INTO users (email, password_hash, role, score)
                    VALUES ('asierputowski@ctmsit.com', '\$2a\$06\$RSlUWkudtmDFVSUy94ktluvq/HQGAxE46XbfqeAoVBZdaaOzAcTMK', 'admin', 0);
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

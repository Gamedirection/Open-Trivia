const { spawn } = require('child_process');
const { Client } = require('pg');
require('dotenv').config();

async function waitForDatabase() {
    const host = process.env.PG_HOST || 'db';
    const port = process.env.PG_PORT || 5432;

    console.log(`⏳ Waiting for PostgreSQL at ${host}:${port}...`);

    while (true) {
        try {
            const client = new Client({
                host: host,
                port: port,
                user: process.env.PG_USER,
                password: process.env.PG_PASSWORD,
                database: process.env.PG_DB,
            });
            
            await client.connect();
            console.log(`✅ PostgreSQL at ${host} is ready!`);
            client.end();
            break;
        } catch (err) {
            console.log(`❌ PostgreSQL is unavailable, retrying in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.log("🚀 Starting the backend API using spawn...");
    // Use spawn and explicitly inherit stdio to see logs in Docker
    const child = spawn('node', ['server-ready.js'], {
        stdio: 'inherit',
        env: process.env // Pass environment variables
    });

    child.on('close', code => {
        if (code !== 0) {
            console.error('❌ Server-ready.js exited with code', code);
            process.exit(1);
        }
    });

    child.on('error', (error) => {
        console.error('Failed to start server:', error);
    });
}

waitForDatabase();

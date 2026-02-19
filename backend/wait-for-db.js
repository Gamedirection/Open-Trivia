const { Client } = require('pg');
require('dotenv').config();

async function waitForDatabase() {
  const host = process.env.PG_HOST || 'db';
  const port = process.env.PG_PORT || 5432;

  console.log(`⏳ Waiting for PostgreSQL at ${host}:${port}...`);

  while (true) {
    try {
      // Create a NEW client for each attempt
      const client = new Client({
        host: host,
        port: port,
        user: process.env.PG_USER || 'trivia_user',
        password: process.env.PG_PASSWORD || 'trivia_pass',
        database: process.env.PG_DB || 'trivia_db',
      });

      await client.connect();
      console.log(`✅ PostgreSQL at ${host} is ready!`);
      client.end();
      break; // Exit the loop on success
    } catch (err) {
      console.log(`❌ PostgreSQL is unavailable (${err.message}), retrying in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Start the server after a brief pause
  console.log("🚀 Starting the backend server...");
  require('child_process').exec('npm start');
}

waitForDatabase();

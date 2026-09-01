#!/usr/bin/env node
/**
 * CloudPort database migration runner.
 *
 * Usage:
 *   node migrate.js up       -- apply all pending migrations, in filename order
 *   node migrate.js down     -- no-op placeholder (CloudPort migrations are additive-only;
 *                                use a new forward migration to reverse a change)
 *   node migrate.js status   -- print applied vs pending migrations
 *
 * Requires DATABASE_URL (or PG* env vars) to point at a reachable PostgreSQL instance.
 * This script performs no destructive operations and never drops tables.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function withClient(fn) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureBookkeeping(client) {
  const bookkeeping = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '0000_migrations_table.sql'),
    'utf8'
  );
  await client.query(bookkeeping);
}

async function getApplied(client) {
  const res = await client.query('SELECT filename FROM schema_migrations ORDER BY id ASC');
  return new Set(res.rows.map((r) => r.filename));
}

async function up() {
  await withClient(async (client) => {
    await ensureBookkeeping(client);
    const applied = await getApplied(client);
    const files = loadMigrationFiles().filter((f) => f !== '0000_migrations_table.sql');

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`SKIP (already applied): ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`APPLYING: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`APPLIED: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`FAILED: ${file}`);
        throw err;
      }
    }
    console.log('Migration run complete.');
  });
}

async function status() {
  await withClient(async (client) => {
    await ensureBookkeeping(client);
    const applied = await getApplied(client);
    const files = loadMigrationFiles().filter((f) => f !== '0000_migrations_table.sql');
    console.log('Migration status:');
    for (const file of files) {
      console.log(`  [${applied.has(file) ? 'x' : ' '}] ${file}`);
    }
  });
}

async function down() {
  console.log(
    'CloudPort migrations are forward-only by design (safety principle: never silently ' +
      'destroy experimental data). To reverse a change, write and apply a new migration.'
  );
}

async function main() {
  const cmd = process.argv[2];
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL connection details.'
    );
    process.exitCode = 1;
    return;
  }
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'down') await down();
    else if (cmd === 'status') await status();
    else {
      console.error('Usage: node migrate.js <up|down|status>');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadMigrationFiles };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'application', 'database', 'migrations');

const REQUIRED_TABLES = [
  'users',
  'experiments',
  'experiment_trials',
  'infrastructure_snapshots',
  'infrastructure_differences',
  'telemetry',
  'telemetry_trials',
  'behaviour_comparisons',
  'leakage_findings',
  'replication_analysis',
  'evidence_artifacts',
  'fault_events',
  'recovery_events',
];

test('migration SQL defines every table required by the spec', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
  for (const table of REQUIRED_TABLES) {
    const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i');
    assert.ok(pattern.test(sql), `expected migration to define table "${table}"`);
  }
});

test('all tables use UUID primary keys (except the migrations bookkeeping table)', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
  const idDeclarations = sql.match(/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/g) || [];
  assert.equal(idDeclarations.length, REQUIRED_TABLES.length);
});

test('every table carries a created_at timestamp column', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
  const createdAtCount = (sql.match(/created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/g) || []).length;
  assert.ok(createdAtCount >= REQUIRED_TABLES.length);
});

test(
  'live database persistence (skipped unless DATABASE_URL is set)',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const res = await client.query(
        `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`test-${Date.now()}@cloudport.local`, 'Test User']
      );
      assert.ok(res.rows[0].id);
    } finally {
      await client.end();
    }
  }
);

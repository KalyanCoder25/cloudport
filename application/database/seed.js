#!/usr/bin/env node
/**
 * CloudPort database seed script.
 *
 * Seeds a minimal, clearly-fake baseline so the platform has something to
 * display before any real experiment has been executed. Does NOT create
 * synthetic telemetry, infrastructure snapshots, or leakage findings --
 * fabricating experimental evidence is explicitly disallowed by CloudPort's
 * scientific safety rules (see docs/architecture/safety.md).
 */
'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { canonicalChecksum } = require('../../analyzer/evidence/checksum');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exitCode = 1;
    return;
  }

  const manifestPath = path.join(__dirname, '..', '..', 'experiments', 'storage-isolation-replicated-v1.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const checksum = canonicalChecksum(manifest.invariants);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `INSERT INTO users (email, display_name, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      ['operator@cloudport.local', 'CloudPort Operator']
    );
    const userId = userRes.rows[0].id;

    const existing = await client.query('SELECT id FROM experiments WHERE name = $1', [manifest.name]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO experiments (
            name, manifest_path, manifest, manifest_checksum, application_version,
            workload, controlled_variable, target_dimension, excluded_dimensions,
            replication_count, status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11)`,
        [
          manifest.name,
          'experiments/storage-isolation-replicated-v1.json',
          manifest,
          checksum,
          manifest.application.version,
          manifest.workload.type,
          manifest.controlledVariable,
          manifest.targetDimension,
          JSON.stringify(manifest.excludedDimensions),
          manifest.replication.pairedTrials,
          userId,
        ]
      );
      console.log(`Seeded experiment "${manifest.name}" in DRAFT status.`);
    } else {
      console.log(`Experiment "${manifest.name}" already present; skipping.`);
    }

    await client.query('COMMIT');
    console.log('Seed complete. No telemetry or infrastructure snapshots were fabricated.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}

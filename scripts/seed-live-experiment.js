'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { canonicalChecksum } = require('../analyzer/evidence/checksum');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const userRes = await client.query('SELECT id FROM users LIMIT 1');
    const userId = userRes.rows[0].id;

    const name = 'live-korifi-storage-v1';
    const existing = await client.query('SELECT id, status FROM experiments WHERE name = $1', [name]);
    if (existing.rowCount > 0) {
      console.log('Experiment already exists:', JSON.stringify(existing.rows[0]));
      return;
    }

    const manifest = {
      name,
      description: 'Controlled live comparison of application behavior under Infrastructure A vs Infrastructure B on live kind-korifi cluster.',
      application: { name: 'cloudport-app', version: 'cloudport:1.0.0' },
      targetDimension: 'STORAGE',
      controlledVariable: 'STORAGE',
      excludedDimensions: ['APPLICATION', 'CPU', 'MEMORY', 'NETWORK', 'WORKLOAD'],
      resourceEnvelope: { cpu: '2.0', memory: '4Gi' },
      workload: { type: 'STORAGE', prngSeed: 554433, concurrency: 2, operationCount: 25 },
      replication: { pairedTrials: 2 },
      safety: {
        requireParityValidation: true,
        requireInfrastructureAHealthy: true,
        requireInfrastructureBHealthy: true,
        minimumTrialsForReplicationClaim: 2,
      },
      invariants: {
        applicationVersion: 'cloudport:1.0.0',
        workloadType: 'STORAGE',
        controlledVariable: 'STORAGE',
        targetDimension: 'STORAGE',
        excludedDimensions: ['APPLICATION', 'CPU', 'MEMORY', 'NETWORK', 'WORKLOAD'],
        prngSeed: 554433,
        concurrency: 2,
        operationCount: 25,
      },
    };

    const manifestFile = path.join(__dirname, '..', 'experiments', `${name}.json`);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const checksum = canonicalChecksum(manifest.invariants);

    const insertRes = await client.query(
      `INSERT INTO experiments (
          name, manifest_path, manifest, manifest_checksum, application_version,
          workload, controlled_variable, target_dimension, excluded_dimensions,
          replication_count, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11)
       RETURNING id, name, status`,
      [
        name,
        `experiments/${name}.json`,
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
    console.log('Created experiment:', JSON.stringify(insertRes.rows[0]));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

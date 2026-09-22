'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createExperimentRunner } = require('../application/backend/src/experimentRunner');
const { createLiveInspector } = require('../analyzer/infrastructure/inspector');
const { canonicalChecksum } = require('../analyzer/evidence/checksum');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  console.log('=== Step 1: Loading Experiment Manifest ===');
  const manifestPath = path.join(__dirname, '..', 'experiments', 'cpu-resource-isolation-v1.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const checksum = canonicalChecksum(manifest.invariants || manifest);
  const name = manifest.name;

  // Fetch or create user
  const userRes = await pool.query('SELECT id FROM users LIMIT 1');
  const userId = userRes.rows[0].id;

  // Check if experiment already exists
  let expRes = await pool.query('SELECT * FROM experiments WHERE name = $1', [name]);
  let experimentId;

  if (expRes.rowCount > 0) {
    experimentId = expRes.rows[0].id;
    console.log(`Experiment ${name} already exists with ID: ${experimentId}, status: ${expRes.rows[0].status}`);
    // Update manifest if draft or update status if needed
    await pool.query(
      `UPDATE experiments SET
         manifest = $1,
         manifest_checksum = $2,
         target_dimension = $3,
         controlled_variable = $4,
         excluded_dimensions = $5,
         replication_count = $6,
         status = 'DRAFT',
         updated_at = now()
       WHERE id = $7`,
      [
        manifest,
        checksum,
        manifest.targetDimension,
        manifest.controlledVariable,
        JSON.stringify(manifest.excludedDimensions),
        manifest.replication.pairedTrials,
        experimentId,
      ]
    );
  } else {
    const insertRes = await pool.query(
      `INSERT INTO experiments (
         name, manifest_path, manifest, manifest_checksum, application_version,
         workload, controlled_variable, target_dimension, excluded_dimensions,
         replication_count, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11)
       RETURNING *`,
      [
        name,
        'experiments/cpu-resource-isolation-v1.json',
        manifest,
        checksum,
        manifest.applicationVersion || 'cloudport:1.0.0',
        manifest.workload.type,
        manifest.controlledVariable,
        manifest.targetDimension,
        JSON.stringify(manifest.excludedDimensions),
        manifest.replication.pairedTrials,
        userId,
      ]
    );
    experimentId = insertRes.rows[0].id;
    console.log(`Created experiment ${name} with ID: ${experimentId}`);
  }

  console.log('\n=== Step 2: Initializing ExperimentRunner with Live Inspector ===');
  const inspector = createLiveInspector();
  const runner = createExperimentRunner({
    query: (sql, params) => pool.query(sql, params),
    inspector,
    executionMode: 'KUBERNETES',
  });

  console.log('\n=== Step 3: Validating Parity ===');
  const valResult = await runner.validateParity(experimentId);
  console.log('Parity validation result:', JSON.stringify(valResult, null, 2));

  if (!valResult.parityValidated || valResult.status !== 'READY_FOR_EXECUTION') {
    throw new Error(`Parity validation failed: ${valResult.reason || 'Unknown reason'}`);
  }

  console.log('\n=== Step 4: Executing Live Experiment (5 Paired Trials in Pods) ===');
  console.log('Workloads will be dispatched directly to pods via kubectl exec...\n');

  const execResult = await runner.executeExperiment(experimentId);
  console.log('\n=== Step 5: Execution Completed ===');
  console.log('Result:', JSON.stringify(execResult, null, 2));

  // Verify provenance and trials in DB
  console.log('\n=== Step 6: Verifying DB Evidence & Pod Provenance ===');
  const trialsRes = await pool.query(
    `SELECT t.trial_index, t.infrastructure, t.execution_mode, t.status,
            tel.p50_ms, tel.p95_ms, tel.throughput_ops_per_sec,
            tel.execution_provenance
     FROM experiment_trials t
     LEFT JOIN telemetry tel ON tel.trial_id = t.id
     WHERE t.experiment_id = $1
     ORDER BY t.trial_index ASC, t.infrastructure ASC`,
    [experimentId]
  );

  console.log(`Total trials recorded: ${trialsRes.rowCount}`);
  for (const row of trialsRes.rows) {
    const prov = typeof row.execution_provenance === 'string'
      ? JSON.parse(row.execution_provenance)
      : row.execution_provenance;
    console.log(
      `Trial #${row.trial_index} Infra ${row.infrastructure}: ` +
      `mode=${row.execution_mode} status=${row.status} ` +
      `p50=${row.p50_ms}ms p95=${row.p95_ms}ms throughput=${row.throughput_ops_per_sec} ops/s ` +
      `pod=${prov?.podName || 'NONE'} source=${prov?.measurementSource || 'NONE'}`
    );
  }

  // Statistical comparisons
  console.log('\n=== Step 7: Statistical Comparisons & Significance ===');
  const behRes = await pool.query(
    'SELECT metric, mean_a, mean_b, delta, percent_change, direction, significance FROM behaviour_comparisons WHERE experiment_id = $1',
    [experimentId]
  );
  for (const row of behRes.rows) {
    const sig = typeof row.significance === 'string' ? JSON.parse(row.significance) : row.significance;
    console.log(
      `Metric: ${row.metric} | Mean A: ${row.mean_a?.toFixed(2)}ms | Mean B: ${row.mean_b?.toFixed(2)}ms | ` +
      `Delta: ${row.delta > 0 ? '+' : ''}${row.delta?.toFixed(2)}ms (${row.percent_change?.toFixed(1)}%) | ` +
      `Significance: ${sig?.interpretation || 'N/A'} (p=${sig?.pValue !== null && sig?.pValue !== undefined ? sig.pValue.toFixed(4) : 'N/A'})`
    );
  }

  // Leakage finding
  console.log('\n=== Step 8: Leakage Finding ===');
  const leakRes = await pool.query(
    'SELECT score, rubric, classification, rationale FROM leakage_findings WHERE experiment_id = $1',
    [experimentId]
  );
  console.log(JSON.stringify(leakRes.rows[0], null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error during live experiment execution:', err);
  pool.end();
  process.exit(1);
});

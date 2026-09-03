'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ExperimentRunner, createExperimentRunner } = require('../../application/backend/src/experimentRunner');
const { InfrastructureInspector, notVerifiedProfile } = require('../../analyzer/infrastructure/inspector');
const { canonicalChecksum } = require('../../analyzer/evidence/checksum');

function createInMemoryDb(initialData = {}) {
  const tables = {
    experiments: initialData.experiments ? [...initialData.experiments] : [],
    experiment_trials: initialData.experiment_trials ? [...initialData.experiment_trials] : [],
    infrastructure_snapshots: initialData.infrastructure_snapshots ? [...initialData.infrastructure_snapshots] : [],
    infrastructure_differences: initialData.infrastructure_differences ? [...initialData.infrastructure_differences] : [],
    telemetry: initialData.telemetry ? [...initialData.telemetry] : [],
    telemetry_trials: initialData.telemetry_trials ? [...initialData.telemetry_trials] : [],
    behaviour_comparisons: initialData.behaviour_comparisons ? [...initialData.behaviour_comparisons] : [],
    leakage_findings: initialData.leakage_findings ? [...initialData.leakage_findings] : [],
    replication_analysis: initialData.replication_analysis ? [...initialData.replication_analysis] : [],
    evidence_artifacts: initialData.evidence_artifacts ? [...initialData.evidence_artifacts] : [],
  };

  let uuidCounter = 1;
  function nextUuid(prefix = 'id') {
    return `${prefix}-${uuidCounter++}`;
  }

  async function query(sql, params = []) {
    const s = sql.trim();

    // SELECT * FROM experiments WHERE id = $1
    if (/^SELECT \* FROM experiments WHERE id = \$1/i.test(s)) {
      const id = params[0];
      const rows = tables.experiments.filter((e) => e.id === id);
      return { rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length };
    }

    // UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2
    if (/^UPDATE experiments SET status = \$1/i.test(s)) {
      const [status, id] = params;
      const exp = tables.experiments.find((e) => e.id === id);
      if (exp) {
        exp.status = status;
        exp.updated_at = new Date().toISOString();
        return { rows: [exp], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // INSERT INTO infrastructure_snapshots
    if (/^INSERT INTO infrastructure_snapshots/i.test(s)) {
      const [experiment_id, infrastructure, source, profile] = params;
      const id = nextUuid('snap');
      const row = {
        id,
        experiment_id,
        infrastructure,
        source,
        profile: typeof profile === 'string' ? JSON.parse(profile) : profile,
        captured_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      tables.infrastructure_snapshots.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO infrastructure_differences
    if (/^INSERT INTO infrastructure_differences/i.test(s)) {
      const [experiment_id, snapshot_a_id, snapshot_b_id, dimension, difference_found, detail] = params;
      const id = nextUuid('diff');
      const row = {
        id,
        experiment_id,
        snapshot_a_id,
        snapshot_b_id,
        dimension,
        difference_found,
        detail: typeof detail === 'string' ? JSON.parse(detail) : detail,
        created_at: new Date().toISOString(),
      };
      tables.infrastructure_differences.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // SELECT * FROM infrastructure_differences WHERE experiment_id = $1
    if (/^SELECT \* FROM infrastructure_differences WHERE experiment_id = \$1/i.test(s)) {
      const id = params[0];
      const rows = tables.infrastructure_differences.filter((d) => d.experiment_id === id);
      return { rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length };
    }

    // SELECT * FROM infrastructure_snapshots WHERE experiment_id = $1
    if (/^SELECT \* FROM infrastructure_snapshots WHERE experiment_id = \$1/i.test(s)) {
      const id = params[0];
      const rows = tables.infrastructure_snapshots.filter((snap) => snap.experiment_id === id);
      return { rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length };
    }

    // INSERT INTO experiment_trials
    if (/^INSERT INTO experiment_trials/i.test(s)) {
      const [experiment_id, trial_index, infrastructure, seed, status, checksum] = params;
      const id = nextUuid('trial');
      const row = {
        id,
        experiment_id,
        trial_index,
        infrastructure,
        seed,
        status,
        checksum,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      tables.experiment_trials.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // UPDATE experiment_trials SET status = $1, finished_at = now() WHERE id = $2
    if (/^UPDATE experiment_trials SET status = \$1/i.test(s)) {
      const [status, id] = params;
      const tr = tables.experiment_trials.find((t) => t.id === id);
      if (tr) {
        tr.status = status;
        tr.finished_at = new Date().toISOString();
        return { rows: [tr], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // INSERT INTO telemetry
    if (/^INSERT INTO telemetry\s*\(/i.test(s)) {
      const [
        trial_id, request_count, success_count, failure_count,
        latencies_ms, throughput_ops_per_sec, errors,
        p50_ms, p90_ms, p95_ms, p99_ms, max_ms,
      ] = params;
      const id = nextUuid('tel');
      const row = {
        id,
        trial_id,
        request_count,
        success_count,
        failure_count,
        latencies_ms: typeof latencies_ms === 'string' ? JSON.parse(latencies_ms) : latencies_ms,
        throughput_ops_per_sec,
        errors: typeof errors === 'string' ? JSON.parse(errors) : errors,
        p50_ms,
        p90_ms,
        p95_ms,
        p99_ms,
        max_ms,
        recorded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      tables.telemetry.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO telemetry_trials
    if (/^INSERT INTO telemetry_trials/i.test(s)) {
      const [experiment_id, infrastructure, telemetry_id, trial_index] = params;
      const id = nextUuid('tel-tr');
      const row = {
        id,
        experiment_id,
        infrastructure,
        telemetry_id,
        trial_index,
        created_at: new Date().toISOString(),
      };
      tables.telemetry_trials.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO replication_analysis
    if (/^INSERT INTO replication_analysis/i.test(s)) {
      const [
        experiment_id, metric, trial_count, meanVal, medianVal, varianceVal, stddevVal,
        coefficient_of_variation, paired_deltas, directional_consistency, classification,
      ] = params;
      const id = nextUuid('repl');
      const row = {
        id,
        experiment_id,
        metric,
        trial_count,
        mean: meanVal,
        median: medianVal,
        variance: varianceVal,
        stddev: stddevVal,
        coefficient_of_variation,
        paired_deltas: typeof paired_deltas === 'string' ? JSON.parse(paired_deltas) : paired_deltas,
        directional_consistency,
        classification,
        created_at: new Date().toISOString(),
      };
      tables.replication_analysis.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO behaviour_comparisons
    if (/^INSERT INTO behaviour_comparisons/i.test(s)) {
      const [
        experiment_id, metric, mean_a, mean_b, median_a, median_b,
        delta, percent_change, direction, significance,
      ] = params;
      const id = nextUuid('beh');
      const row = {
        id,
        experiment_id,
        metric,
        mean_a,
        mean_b,
        median_a,
        median_b,
        delta,
        percent_change,
        direction,
        significance: significance ? (typeof significance === 'string' ? JSON.parse(significance) : significance) : null,
        created_at: new Date().toISOString(),
      };
      tables.behaviour_comparisons.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO leakage_findings
    if (/^INSERT INTO leakage_findings/i.test(s)) {
      const [experiment_id, score, rubric, classification, rationale] = params;
      const id = nextUuid('leak');
      const row = {
        id,
        experiment_id,
        score,
        rubric: typeof rubric === 'string' ? JSON.parse(rubric) : rubric,
        classification,
        rationale,
        created_at: new Date().toISOString(),
      };
      tables.leakage_findings.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // INSERT INTO evidence_artifacts
    if (/^INSERT INTO evidence_artifacts/i.test(s)) {
      const [experiment_id, artifact_type, file_name, content, checksum] = params;
      const id = nextUuid('art');
      const row = {
        id,
        experiment_id,
        artifact_type,
        file_name,
        content: typeof content === 'string' ? JSON.parse(content) : content,
        checksum,
        created_at: new Date().toISOString(),
      };
      tables.evidence_artifacts.push(row);
      return { rows: [row], rowCount: 1 };
    }

    throw new Error(`Unhandled mock query: ${sql}`);
  }

  return { query, tables };
}

function createSampleExperiment(overrides = {}) {
  const manifest = {
    name: 'storage-isolation-test',
    description: 'Controlled comparison',
    application: { version: 'cloudport:1.0.0' },
    workload: {
      type: 'STORAGE',
      concurrency: 2,
      operationCount: 10,
      prngSeed: 42000,
    },
    controlledVariable: 'STORAGE',
    targetDimension: 'STORAGE',
    excludedDimensions: ['APPLICATION', 'CPU', 'MEMORY', 'NETWORK', 'WORKLOAD'],
    replication: { pairedTrials: 3 },
    invariants: {
      applicationVersion: 'cloudport:1.0.0',
      workloadType: 'STORAGE',
      concurrency: 2,
      operationCount: 10,
      prngSeed: 42000,
      targetDimension: 'STORAGE',
      excludedDimensions: ['APPLICATION', 'CPU', 'MEMORY', 'NETWORK', 'WORKLOAD'],
    },
  };

  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'storage-isolation-test',
    manifest_path: 'experiments/storage-isolation-replicated-v1.json',
    manifest,
    manifest_checksum: canonicalChecksum(manifest.invariants),
    application_version: 'cloudport:1.0.0',
    workload: 'STORAGE',
    controlled_variable: 'STORAGE',
    target_dimension: 'STORAGE',
    excluded_dimensions: ['APPLICATION', 'CPU', 'MEMORY', 'NETWORK', 'WORKLOAD'],
    replication_count: 3,
    status: 'DRAFT',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createFakeInspector(profileAOverrides = {}, profileBOverrides = {}) {
  const baseA = {
    kubernetesVersion: 'v1.29.2',
    nodes: [{ name: 'node-1', cpuCapacity: '4', memoryCapacity: '8Gi' }],
    storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }],
    networkPolicies: [],
    services: [],
    ingressClasses: [],
    resourceQuotas: [],
    limitRanges: [],
    availability: 'AVAILABLE',
    source: 'LIVE',
  };

  const baseB = {
    kubernetesVersion: 'v1.29.2',
    nodes: [{ name: 'node-1', cpuCapacity: '4', memoryCapacity: '8Gi' }],
    storageClasses: [{ name: 'standard-throttled', provisioner: 'rancher.io/local-path' }], // Intended Storage difference
    networkPolicies: [],
    services: [],
    ingressClasses: [],
    resourceQuotas: [],
    limitRanges: [],
    availability: 'AVAILABLE',
    source: 'LIVE',
  };

  return {
    captureSnapshot: async (infra) => {
      if (infra === 'A') return { ...baseA, ...profileAOverrides };
      if (infra === 'B') return { ...baseB, ...profileBOverrides };
      throw new Error(`Unknown infrastructure: ${infra}`);
    },
  };
}

test('parity passes when A/B non-target invariants are identical and transitions DRAFT -> PARITY_VALIDATED -> READY_FOR_EXECUTION', async () => {
  const exp = createSampleExperiment();
  const db = createInMemoryDb({ experiments: [exp] });
  const inspector = createFakeInspector();

  const runner = createExperimentRunner({
    query: db.query,
    inspector,
  });

  const result = await runner.validateParity(exp.id);

  assert.equal(result.status, 'READY_FOR_EXECUTION');
  assert.equal(result.parityValidated, true);

  const updatedExp = db.tables.experiments.find((e) => e.id === exp.id);
  assert.equal(updatedExp.status, 'READY_FOR_EXECUTION');

  // Verify snapshots persisted
  assert.equal(db.tables.infrastructure_snapshots.length, 2);
  const snapA = db.tables.infrastructure_snapshots.find((s) => s.infrastructure === 'A');
  const snapB = db.tables.infrastructure_snapshots.find((s) => s.infrastructure === 'B');
  assert.ok(snapA);
  assert.ok(snapB);

  // Verify differences persisted
  assert.equal(db.tables.infrastructure_differences.length, 7);
  const storageDiff = db.tables.infrastructure_differences.find((d) => d.dimension === 'Storage');
  assert.equal(storageDiff.difference_found, true);

  // Non-target dimensions have no differences
  const nonTargetDiffs = db.tables.infrastructure_differences.filter((d) => d.dimension !== 'Storage');
  for (const nd of nonTargetDiffs) {
    assert.equal(nd.difference_found, false, `expected non-target ${nd.dimension} to have difference_found=false`);
  }
});

test('parity fails when a non-target dimension differs (e.g. Platform) and sets FAILED_VALIDATION', async () => {
  const exp = createSampleExperiment();
  const db = createInMemoryDb({ experiments: [exp] });
  // Infrastructure B has unexpected different Kubernetes version (Platform dimension)
  const inspector = createFakeInspector({}, { kubernetesVersion: 'v1.30.0' });

  const runner = createExperimentRunner({
    query: db.query,
    inspector,
  });

  const result = await runner.validateParity(exp.id);

  assert.equal(result.status, 'FAILED_VALIDATION');
  assert.equal(result.parityValidated, false);
  assert.ok(/Platform/i.test(result.reason) || /Checksum mismatch/i.test(result.reason));

  const updatedExp = db.tables.experiments.find((e) => e.id === exp.id);
  assert.equal(updatedExp.status, 'FAILED_VALIDATION');
});

test('parity failure prevents execution', async () => {
  const exp = createSampleExperiment({ status: 'FAILED_VALIDATION' });
  const db = createInMemoryDb({ experiments: [exp] });
  const runner = createExperimentRunner({ query: db.query });

  await assert.rejects(
    async () => {
      await runner.executeExperiment(exp.id);
    },
    /not ready for execution/i
  );
});

test('executes correct number of paired A/B trials with identical deterministic seeds per pair', async () => {
  const exp = createSampleExperiment({ replication_count: 3, status: 'READY_FOR_EXECUTION' });
  const db = createInMemoryDb({ experiments: [exp] });
  const inspector = createFakeInspector();

  // Validate parity first to create snapshots and differences
  const runner = createExperimentRunner({
    query: db.query,
    inspector,
  });
  await runner.validateParity(exp.id);

  const seedsUsed = [];
  const workloadCalls = [];

  const customRunner = createExperimentRunner({
    query: db.query,
    inspector,
    runWorkload: async (config) => {
      seedsUsed.push(config.seed);
      workloadCalls.push(config);
      return {
        requestCount: config.operationCount,
        successCount: config.operationCount,
        failureCount: 0,
        latenciesMs: [5.2, 4.8, 6.1, 5.0],
        throughputOpsPerSec: 100,
        errors: [],
      };
    },
  });

  const result = await customRunner.executeExperiment(exp.id);

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.trialsExecuted, 6); // 3 paired trials * 2 = 6 trials

  // 6 trials persisted
  assert.equal(db.tables.experiment_trials.length, 6);

  // For each paired trial i in [1, 2, 3], A and B must receive the exact same seed
  for (let i = 1; i <= 3; i += 1) {
    const trialA = db.tables.experiment_trials.find((t) => t.trial_index === i && t.infrastructure === 'A');
    const trialB = db.tables.experiment_trials.find((t) => t.trial_index === i && t.infrastructure === 'B');
    assert.ok(trialA);
    assert.ok(trialB);
    assert.equal(trialA.seed, trialB.seed, `Trial pair ${i} must have identical seeds`);
    assert.equal(trialA.status, 'SUCCEEDED');
    assert.equal(trialB.status, 'SUCCEEDED');
    assert.ok(trialA.checksum);
    assert.ok(trialB.checksum);
  }
});

test('workload uses getStorageMountPath() as scratchDir', async () => {
  const exp = createSampleExperiment({ replication_count: 1, status: 'READY_FOR_EXECUTION' });
  const db = createInMemoryDb({ experiments: [exp] });
  const customMount = '/custom/data/mount';

  let receivedScratchDir = null;
  const runner = createExperimentRunner({
    query: db.query,
    inspector: createFakeInspector(),
    getStorageMountPath: () => customMount,
    runWorkload: async (config) => {
      receivedScratchDir = config.scratchDir;
      return {
        requestCount: 1,
        successCount: 1,
        failureCount: 0,
        latenciesMs: [10],
        throughputOpsPerSec: 10,
        errors: [],
      };
    },
  });

  await runner.validateParity(exp.id);
  await runner.executeExperiment(exp.id);

  assert.equal(receivedScratchDir, customMount);
});

test('persists complete telemetry, replication analysis, behaviour comparisons, leakage finding, and evidence artifacts', async () => {
  const exp = createSampleExperiment({ replication_count: 2, status: 'READY_FOR_EXECUTION' });
  const db = createInMemoryDb({ experiments: [exp] });

  const runner = createExperimentRunner({
    query: db.query,
    inspector: createFakeInspector(),
    runWorkload: async (config) => ({
      requestCount: 10,
      successCount: 10,
      failureCount: 0,
      latenciesMs: [12.0, 15.0, 11.5, 14.2],
      throughputOpsPerSec: 50.0,
      errors: [],
    }),
  });

  await runner.validateParity(exp.id);
  const execResult = await runner.executeExperiment(exp.id);

  assert.equal(execResult.status, 'COMPLETED');

  // Telemetry persisted
  assert.equal(db.tables.telemetry.length, 4);
  assert.equal(db.tables.telemetry_trials.length, 4);
  for (const tel of db.tables.telemetry) {
    assert.equal(tel.request_count, 10);
    assert.equal(tel.success_count, 10);
    assert.equal(tel.failure_count, 0);
    assert.ok(tel.p50_ms !== null);
    assert.ok(tel.p95_ms !== null);
  }

  // Replication analysis persisted
  assert.equal(db.tables.replication_analysis.length, 1);
  const rep = db.tables.replication_analysis[0];
  assert.equal(rep.metric, 'p95_ms');
  assert.equal(rep.trial_count, 2);
  assert.ok(rep.classification);

  // Behaviour comparisons persisted
  assert.ok(db.tables.behaviour_comparisons.length > 0);
  const p95Comp = db.tables.behaviour_comparisons.find((c) => c.metric === 'p95_ms');
  assert.ok(p95Comp);
  assert.ok(p95Comp.direction);

  // Leakage finding persisted
  assert.equal(db.tables.leakage_findings.length, 1);
  const leak = db.tables.leakage_findings[0];
  assert.ok(leak.score >= 0 && leak.score <= 100);
  assert.ok(leak.rubric);
  assert.ok(leak.classification);

  // Evidence artifacts persisted
  assert.equal(db.tables.evidence_artifacts.length, 13);
  const requiredArtifactFiles = [
    'experiment-manifest.json',
    'infrastructure-a.json',
    'infrastructure-b.json',
    'infrastructure-differences.json',
    'telemetry-a.json',
    'telemetry-b.json',
    'telemetry-a-trials.json',
    'telemetry-b-trials.json',
    'behaviour-comparison.json',
    'leakage-analysis.json',
    'replication-analysis.json',
    'evidence-graph.json',
    'runtime-provenance.json',
  ];
  for (const f of requiredArtifactFiles) {
    const art = db.tables.evidence_artifacts.find((a) => a.file_name === f);
    assert.ok(art, `Expected artifact file ${f}`);
    assert.ok(art.checksum, `Artifact ${f} must have a checksum`);
    assert.equal(art.checksum, canonicalChecksum(art.content));
  }

  // Status in db is COMPLETED
  const finalExp = db.tables.experiments.find((e) => e.id === exp.id);
  assert.equal(finalExp.status, 'COMPLETED');
});

test('failed workload trial updates trial to FAILED and experiment to ABORTED', async () => {
  const exp = createSampleExperiment({ replication_count: 2, status: 'READY_FOR_EXECUTION' });
  const db = createInMemoryDb({ experiments: [exp] });

  let callCount = 0;
  const runner = createExperimentRunner({
    query: db.query,
    inspector: createFakeInspector(),
    runWorkload: async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('Storage disk I/O error');
      }
      return {
        requestCount: 5,
        successCount: 5,
        failureCount: 0,
        latenciesMs: [5, 5],
        throughputOpsPerSec: 20,
        errors: [],
      };
    },
  });

  await runner.validateParity(exp.id);

  await assert.rejects(
    async () => {
      await runner.executeExperiment(exp.id);
    },
    /Storage disk I\/O error/
  );

  const finalExp = db.tables.experiments.find((e) => e.id === exp.id);
  assert.equal(finalExp.status, 'ABORTED');

  const failedTrial = db.tables.experiment_trials.find((t) => t.status === 'FAILED');
  assert.ok(failedTrial, 'Failing trial must be marked FAILED in experiment_trials');
});

test('handles notVerifiedProfile gracefully when live cluster is unreachable', async () => {
  const exp = createSampleExperiment();
  const db = createInMemoryDb({ experiments: [exp] });
  const defaultInspector = new InfrastructureInspector(); // throws because no live k8s client is configured

  const runner = createExperimentRunner({
    query: db.query,
    inspector: defaultInspector,
  });

  // Captures notVerifiedProfile without throwing
  const result = await runner.validateParity(exp.id);
  assert.ok(result);
  assert.equal(db.tables.infrastructure_snapshots.length, 2);
  const snapA = db.tables.infrastructure_snapshots.find((s) => s.infrastructure === 'A');
  assert.equal(snapA.source, 'NOT_VERIFIED');
});

test('parity passes when target_dimension is COMPUTE and only compute differs', async () => {
  const exp = createSampleExperiment({
    target_dimension: 'COMPUTE',
    controlled_variable: 'COMPUTE',
  });
  const db = createInMemoryDb({ experiments: [exp] });
  // Nodes differ (Compute dimension), but storageClasses are identical
  const inspector = createFakeInspector(
    { storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }] },
    {
      nodes: [{ name: 'node-2', cpuCapacity: '8', memoryCapacity: '16Gi' }],
      storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }],
    }
  );

  const runner = createExperimentRunner({
    query: db.query,
    inspector,
  });

  const result = await runner.validateParity(exp.id);
  assert.equal(result.status, 'READY_FOR_EXECUTION');
  assert.equal(result.parityValidated, true);
});

test('parity fails when target_dimension is COMPUTE but non-target Platform also differs', async () => {
  const exp = createSampleExperiment({
    target_dimension: 'COMPUTE',
    controlled_variable: 'COMPUTE',
  });
  const db = createInMemoryDb({ experiments: [exp] });
  const inspector = createFakeInspector(
    { storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }] },
    {
      nodes: [{ name: 'node-2', cpuCapacity: '8', memoryCapacity: '16Gi' }],
      storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }],
      kubernetesVersion: 'v1.30.0', // Non-target difference!
    }
  );

  const runner = createExperimentRunner({
    query: db.query,
    inspector,
  });

  const result = await runner.validateParity(exp.id);
  assert.equal(result.status, 'FAILED_VALIDATION');
  assert.equal(result.parityValidated, false);
});

test('handles invalid/zero replication count by falling back to at least 1 trial', async () => {
  const exp = createSampleExperiment({
    replication_count: 0,
    manifest: { replication: { pairedTrials: 0 } },
    status: 'READY_FOR_EXECUTION',
  });
  const db = createInMemoryDb({ experiments: [exp] });
  const runner = createExperimentRunner({
    query: db.query,
    inspector: createFakeInspector(),
    runWorkload: async () => ({
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
      latenciesMs: [5],
      throughputOpsPerSec: 10,
      errors: [],
    }),
  });

  await runner.validateParity(exp.id);
  const result = await runner.executeExperiment(exp.id);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.trialsExecuted, 2); // 1 paired trial * 2
});

test('handles missing or empty manifest fields gracefully during execution', async () => {
  const exp = createSampleExperiment({
    manifest: null,
    replication_count: 1,
    status: 'READY_FOR_EXECUTION',
  });
  const db = createInMemoryDb({ experiments: [exp] });
  const runner = createExperimentRunner({
    query: db.query,
    inspector: createFakeInspector(),
    runWorkload: async () => ({
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
      latenciesMs: [8],
      throughputOpsPerSec: 10,
      errors: [],
    }),
  });

  await runner.validateParity(exp.id);
  const result = await runner.executeExperiment(exp.id);
  assert.equal(result.status, 'COMPLETED');
});

test('pipeline persistence failure updates experiment status to ABORTED and throws', async () => {
  const exp = createSampleExperiment({ replication_count: 1, status: 'READY_FOR_EXECUTION' });
  const db = createInMemoryDb({ experiments: [exp] });

  // Wrap query to throw when inserting replication_analysis
  const originalQuery = db.query;
  const failingQuery = async (sql, params) => {
    if (/INSERT INTO replication_analysis/i.test(sql)) {
      throw new Error('Database disk full on replication_analysis');
    }
    return originalQuery(sql, params);
  };

  const runner = createExperimentRunner({
    query: failingQuery,
    inspector: createFakeInspector(),
    runWorkload: async () => ({
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
      latenciesMs: [5],
      throughputOpsPerSec: 10,
      errors: [],
    }),
  });

  await runner.validateParity(exp.id);
  await assert.rejects(
    async () => {
      await runner.executeExperiment(exp.id);
    },
    /Database disk full on replication_analysis/
  );

  const finalExp = db.tables.experiments.find((e) => e.id === exp.id);
  assert.equal(finalExp.status, 'ABORTED');
});

test('validateParity throws 404 error when experiment does not exist', async () => {
  const db = createInMemoryDb();
  const runner = createExperimentRunner({ query: db.query });

  await assert.rejects(
    async () => {
      await runner.validateParity('non-existent-id');
    },
    /Experiment non-existent-id not found/
  );
});

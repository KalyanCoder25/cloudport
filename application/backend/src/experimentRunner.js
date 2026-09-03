/**
 * CloudPort Experiment Orchestrator / Runner
 *
 * Orchestrates the full lifecycle of an experiment:
 *   DRAFT
 *     -> parity validation
 *     -> PARITY_VALIDATED
 *     -> READY_FOR_EXECUTION
 *     -> explicit operator execution (POST .../run with confirm: true)
 *     -> RUNNING
 *     -> paired A/B deterministic trials
 *     -> telemetry persistence
 *     -> replication analysis, behaviour comparison, leakage scoring, causal governance
 *     -> evidence graph & artifact generation
 *     -> COMPLETED
 *
 * Parity is strictly mandatory: if Infrastructure A and B differ in any non-target
 * experimental dimension, validation fails and transitions to FAILED_VALIDATION.
 * Workload execution is strictly prohibited when parity validation fails.
 */
'use strict';

const { canonicalChecksum, verifyParity } = require('../../../analyzer/evidence/checksum');
const { analyzeRepeatedTrials } = require('../../../analyzer/behaviour/repeatedTrials');
const { compareTelemetrySummaries } = require('../../../analyzer/behaviour/behaviourComparison');
const { detectDifferences } = require('../../../analyzer/infrastructure/differenceDetector');
const { detectApplicationVisibleDifferences } = require('../../../analyzer/behaviour/applicationVisibleDetector');
const { computeLeakageScore } = require('../../../analyzer/leakage/leakageScore');
const { classifyCausalGovernance } = require('../../../analyzer/evidence/causalGovernance');
const { buildEvidenceGraph } = require('../../../analyzer/evidence/evidenceGraph');
const { generateEvidenceArtifacts } = require('../../../analyzer/evidence/artifactGenerator');
const { InfrastructureInspector, notVerifiedProfile } = require('../../../analyzer/infrastructure/inspector');
const { latencySummary, mean, median, variance, stddev, coefficientOfVariation } = require('../../../analyzer/telemetry/stats');
const { runStorageWorkload } = require('./workload');
const { getStorageMountPath } = require('./config');

class ExperimentRunner {
  /**
   * @param {object} [deps]
   * @param {(sql: string, params?: any[]) => Promise<{ rows: any[], rowCount: number }>} deps.query
   * @param {InfrastructureInspector} [deps.inspector]
   * @param {(config: object) => Promise<object>} [deps.runWorkload]
   * @param {() => string|null} [deps.getStorageMountPath]
   */
  constructor(deps = {}) {
    if (!deps.query) {
      throw new Error('ExperimentRunner requires a database query function');
    }
    this.query = deps.query;
    this.inspector = deps.inspector || new InfrastructureInspector();
    this.runWorkload = deps.runWorkload || runStorageWorkload;
    this.getStorageMountPath = deps.getStorageMountPath || getStorageMountPath;
  }

  /**
   * Capture infrastructure snapshot safely.
   * If live inspection fails or no live cluster exists, use notVerifiedProfile
   * without fabricating live measurements.
   *
   * @param {'A'|'B'} infrastructure
   * @returns {Promise<object>} normalized profile
   */
  async captureProfile(infrastructure) {
    try {
      return await this.inspector.captureSnapshot(infrastructure);
    } catch {
      return notVerifiedProfile(infrastructure);
    }
  }

  /**
   * Validate Parity for an experiment.
   * Transitions DRAFT -> PARITY_VALIDATED -> READY_FOR_EXECUTION (on pass)
   * or -> FAILED_VALIDATION (on failure).
   *
   * @param {string} experimentId
   * @returns {Promise<object>} validation outcome
   */
  async validateParity(experimentId) {
    const expRes = await this.query('SELECT * FROM experiments WHERE id = $1', [experimentId]);
    if (expRes.rowCount === 0) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    const experiment = expRes.rows[0];

    // 1 & 2: Capture snapshots for Infrastructure A and B
    const profileA = await this.captureProfile('A');
    const profileB = await this.captureProfile('B');

    // 3: Persist snapshots into infrastructure_snapshots
    const snapARes = await this.query(
      `INSERT INTO infrastructure_snapshots (experiment_id, infrastructure, source, profile)
       VALUES ($1, $2, $3, $4)
       RETURNING id, profile, source, captured_at`,
      [experiment.id, 'A', profileA.source || 'LIVE', JSON.stringify(profileA)]
    );
    const snapBRes = await this.query(
      `INSERT INTO infrastructure_snapshots (experiment_id, infrastructure, source, profile)
       VALUES ($1, $2, $3, $4)
       RETURNING id, profile, source, captured_at`,
      [experiment.id, 'B', profileB.source || 'LIVE', JSON.stringify(profileB)]
    );

    const snapshotAId = snapARes.rows[0].id;
    const snapshotBId = snapBRes.rows[0].id;

    // 4: Detect differences across all 7 dimensions
    const diffs = detectDifferences(profileA, profileB);

    // 5: Persist differences into infrastructure_differences
    for (const diff of diffs) {
      await this.query(
        `INSERT INTO infrastructure_differences (experiment_id, snapshot_a_id, snapshot_b_id, dimension, difference_found, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [experiment.id, snapshotAId, snapshotBId, diff.dimension, diff.differenceFound, JSON.stringify(diff.detail || {})]
      );
    }

    // 6, 7, 8, 9, 10: Non-target invariant parity evaluation
    const normalizeDim = (dim) => String(dim || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const targetDim = normalizeDim(experiment.target_dimension);

    // Check every non-target dimension from detectDifferences
    const nonTargetDiffsFound = diffs.filter((d) => {
      const dimName = normalizeDim(d.dimension);
      return dimName !== targetDim && d.differenceFound;
    });

    // Build non-target invariant objects for checksum verification
    const buildNonTargetInvariants = (profile) => {
      const invariants = {
        applicationVersion: experiment.application_version,
        workload: experiment.workload,
        controlledVariable: experiment.controlled_variable,
        excludedDimensions: experiment.excluded_dimensions,
      };
      if (targetDim !== 'PLATFORM') invariants.platform = profile.kubernetesVersion;
      if (targetDim !== 'COMPUTE') invariants.compute = profile.nodes;
      if (targetDim !== 'STORAGE') invariants.storage = profile.storageClasses;
      if (targetDim !== 'NETWORK') {
        invariants.network = {
          networkPolicies: profile.networkPolicies,
          services: profile.services,
          ingressClasses: profile.ingressClasses,
        };
      }
      if (targetDim !== 'RESOURCEQUOTAS') invariants.resourceQuotas = profile.resourceQuotas;
      if (targetDim !== 'LIMITRANGES') invariants.limitRanges = profile.limitRanges;
      if (targetDim !== 'AVAILABILITY') invariants.availability = profile.availability;
      return invariants;
    };

    const nonTargetInvariantsA = buildNonTargetInvariants(profileA);
    const nonTargetInvariantsB = buildNonTargetInvariants(profileB);

    const parityResult = verifyParity(nonTargetInvariantsA, nonTargetInvariantsB);
    const parityPassed = parityResult.match && nonTargetDiffsFound.length === 0;

    if (!parityPassed) {
      const reasons = [];
      if (!parityResult.match) {
        reasons.push(`Checksum mismatch between Infrastructure A and B non-target invariants (${parityResult.checksumA} vs ${parityResult.checksumB})`);
      }
      for (const d of nonTargetDiffsFound) {
        reasons.push(`Unexpected difference in non-target dimension: ${d.dimension}`);
      }
      const failureReason = reasons.join('; ');

      await this.query(
        'UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2',
        ['FAILED_VALIDATION', experiment.id]
      );

      return {
        status: 'FAILED_VALIDATION',
        parityValidated: false,
        reason: failureReason,
        differences: diffs,
        nonTargetDifferences: nonTargetDiffsFound,
        checksums: parityResult,
      };
    }

    // Parity passed: transition DRAFT -> PARITY_VALIDATED -> READY_FOR_EXECUTION
    await this.query(
      'UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2',
      ['PARITY_VALIDATED', experiment.id]
    );

    await this.query(
      'UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2',
      ['READY_FOR_EXECUTION', experiment.id]
    );

    return {
      status: 'READY_FOR_EXECUTION',
      parityValidated: true,
      differences: diffs,
      checksums: parityResult,
    };
  }

  /**
   * Execute an experiment through paired A/B trials, telemetry gathering,
   * statistical analysis, evidence graph construction, artifact generation,
   * and final COMPLETED transition.
   *
   * @param {string} experimentId
   * @returns {Promise<object>} execution summary
   */
  async executeExperiment(experimentId) {
    const expRes = await this.query('SELECT * FROM experiments WHERE id = $1', [experimentId]);
    if (expRes.rowCount === 0) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    const experiment = expRes.rows[0];

    if (experiment.status !== 'READY_FOR_EXECUTION' && experiment.status !== 'RUNNING') {
      throw new Error(`Experiment is not ready for execution (status: ${experiment.status})`);
    }

    await this.query('UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2', ['RUNNING', experiment.id]);

    const manifest = experiment.manifest || {};
    const workloadSpec = manifest.workload || {};

    let rawReplication = Number(experiment.replication_count);
    if (!Number.isInteger(rawReplication) || rawReplication < 1) {
      rawReplication = Number(manifest.replication?.pairedTrials);
    }
    const replicationCount = Number.isInteger(rawReplication) && rawReplication >= 1 ? rawReplication : 1;

    const rawConcurrency = Number(workloadSpec.concurrency);
    const concurrency = Number.isInteger(rawConcurrency) && rawConcurrency >= 1 ? rawConcurrency : 5;

    const rawOpCount = Number(workloadSpec.operationCount);
    const operationCount = Number.isInteger(rawOpCount) && rawOpCount >= 1 ? rawOpCount : 50;

    const rawSeed = Number(workloadSpec.prngSeed);
    const baseSeed = Number.isInteger(rawSeed) ? rawSeed : 987654;

    const trialsA = [];
    const trialsB = [];
    const allTrialRecords = [];
    const allTelemetryRecords = [];

    try {
      // Execute N paired trials: trial 1 (A + B), trial 2 (A + B), ... trial N (A + B)
      for (let trialIndex = 1; trialIndex <= replicationCount; trialIndex += 1) {
        // Deterministic seed: equivalent between A and B for the same logical trial
        const trialSeed = baseSeed + (trialIndex - 1) * 1000;

        for (const infra of ['A', 'B']) {
          const trialChecksum = canonicalChecksum({
            experimentId: experiment.id,
            trialIndex,
            infrastructure: infra,
            seed: trialSeed,
            concurrency,
            operationCount,
          });

          const trialInsertRes = await this.query(
            `INSERT INTO experiment_trials (experiment_id, trial_index, infrastructure, seed, status, checksum, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             RETURNING id, experiment_id, trial_index, infrastructure, seed, status, checksum, started_at`,
            [experiment.id, trialIndex, infra, trialSeed, 'RUNNING', trialChecksum]
          );
          const trial = trialInsertRes.rows[0];

          let workloadResult;
          try {
            const scratchDir = this.getStorageMountPath() || undefined;
            workloadResult = await this.runWorkload({
              seed: trialSeed,
              concurrency,
              operationCount,
              scratchDir,
            });

            await this.query(
              'UPDATE experiment_trials SET status = $1, finished_at = now() WHERE id = $2',
              ['SUCCEEDED', trial.id]
            );
            trial.status = 'SUCCEEDED';
          } catch (workloadErr) {
            await this.query(
              'UPDATE experiment_trials SET status = $1, finished_at = now() WHERE id = $2',
              ['FAILED', trial.id]
            );
            trial.status = 'FAILED';
            throw workloadErr;
          }

          const latencies = workloadResult.latenciesMs || [];
          const stats = latencySummary(latencies);

          const telemetryInsertRes = await this.query(
            `INSERT INTO telemetry (
               trial_id, request_count, success_count, failure_count,
               latencies_ms, throughput_ops_per_sec, errors,
               p50_ms, p90_ms, p95_ms, p99_ms, max_ms, recorded_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
             RETURNING id, trial_id, request_count, success_count, failure_count,
                       latencies_ms, throughput_ops_per_sec, errors,
                       p50_ms, p90_ms, p95_ms, p99_ms, max_ms, recorded_at`,
            [
              trial.id,
              workloadResult.requestCount,
              workloadResult.successCount,
              workloadResult.failureCount,
              JSON.stringify(latencies),
              workloadResult.throughputOpsPerSec,
              JSON.stringify(workloadResult.errors || []),
              stats.p50,
              stats.p90,
              stats.p95,
              stats.p99,
              stats.max,
            ]
          );
          const telemetryRecord = telemetryInsertRes.rows[0];

          await this.query(
            `INSERT INTO telemetry_trials (experiment_id, infrastructure, telemetry_id, trial_index)
             VALUES ($1, $2, $3, $4)`,
            [experiment.id, infra, telemetryRecord.id, trialIndex]
          );

          const fullTrial = {
            ...trial,
            telemetry: {
              ...telemetryRecord,
              mean_ms: stats.mean,
            },
          };

          if (infra === 'A') {
            trialsA.push(fullTrial);
          } else {
            trialsB.push(fullTrial);
          }
          allTrialRecords.push(fullTrial);
          allTelemetryRecords.push(telemetryRecord);
        }
      }

      // -----------------------------------------------------------------
      // Evidence & Analysis Pipeline
      // -----------------------------------------------------------------

      // 1. Replication Analysis across paired trials
      const p95A = trialsA.map((t) => t.telemetry.p95_ms ?? 0);
      const p95B = trialsB.map((t) => t.telemetry.p95_ms ?? 0);
      const repResult = analyzeRepeatedTrials(p95A, p95B);

      const deltas = repResult.pairedDeltas || [];
      const deltaMean = mean(deltas);
      const deltaMedian = median(deltas);
      const deltaVariance = variance(deltas);
      const deltaStddev = stddev(deltas);
      const deltaCV =
        repResult.deltaCoefficientOfVariation !== undefined && repResult.deltaCoefficientOfVariation !== null
          ? repResult.deltaCoefficientOfVariation
          : coefficientOfVariation(deltas);

      await this.query(
        `INSERT INTO replication_analysis (
           experiment_id, metric, trial_count, mean, median, variance, stddev,
           coefficient_of_variation, paired_deltas, directional_consistency, classification
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          experiment.id,
          'p95_ms',
          repResult.trialCount,
          deltaMean,
          deltaMedian,
          deltaVariance,
          deltaStddev,
          deltaCV,
          JSON.stringify(deltas),
          repResult.directionalConsistency,
          repResult.classification,
        ]
      );

      // 2. Behaviour Comparison
      const summaryA = {
        p50_ms: trialsA.map((t) => t.telemetry.p50_ms).filter((v) => v !== null),
        p90_ms: trialsA.map((t) => t.telemetry.p90_ms).filter((v) => v !== null),
        p95_ms: trialsA.map((t) => t.telemetry.p95_ms).filter((v) => v !== null),
        p99_ms: trialsA.map((t) => t.telemetry.p99_ms).filter((v) => v !== null),
        max_ms: trialsA.map((t) => t.telemetry.max_ms).filter((v) => v !== null),
        throughput_ops_per_sec: trialsA.map((t) => t.telemetry.throughput_ops_per_sec).filter((v) => v !== null),
      };

      const summaryB = {
        p50_ms: trialsB.map((t) => t.telemetry.p50_ms).filter((v) => v !== null),
        p90_ms: trialsB.map((t) => t.telemetry.p90_ms).filter((v) => v !== null),
        p95_ms: trialsB.map((t) => t.telemetry.p95_ms).filter((v) => v !== null),
        p99_ms: trialsB.map((t) => t.telemetry.p99_ms).filter((v) => v !== null),
        max_ms: trialsB.map((t) => t.telemetry.max_ms).filter((v) => v !== null),
        throughput_ops_per_sec: trialsB.map((t) => t.telemetry.throughput_ops_per_sec).filter((v) => v !== null),
      };

      const behaviourComparisons = compareTelemetrySummaries(summaryA, summaryB);

      for (const comp of behaviourComparisons) {
        await this.query(
          `INSERT INTO behaviour_comparisons (
             experiment_id, metric, mean_a, mean_b, median_a, median_b,
             delta, percent_change, direction, significance
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            experiment.id,
            comp.metric,
            comp.meanA,
            comp.meanB,
            comp.medianA,
            comp.medianB,
            comp.delta,
            comp.percentChange,
            comp.direction,
            comp.significance ? JSON.stringify(comp.significance) : null,
          ]
        );
      }

      // 3. Application-Visible Difference Detection
      const diffsRes = await this.query(
        'SELECT * FROM infrastructure_differences WHERE experiment_id = $1 ORDER BY dimension ASC',
        [experiment.id]
      );
      const infrastructureDifferences = diffsRes.rows.map((r) => ({
        dimension: r.dimension,
        differenceFound: r.difference_found,
        detail: r.detail,
      }));

      const appVisibleResult = detectApplicationVisibleDifferences(infrastructureDifferences, behaviourComparisons);

      // 4. Leakage Score
      const anyInfraDiff = infrastructureDifferences.some((d) => d.differenceFound);
      const largestShift = appVisibleResult.meaningfulMetricShifts.length > 0
        ? Math.max(...appVisibleResult.meaningfulMetricShifts.map((s) => Math.abs(s.percentChange || 0)))
        : 0;

      const leakageFinding = computeLeakageScore({
        infrastructureDifferenceDetected: anyInfraDiff,
        applicationVisibleCorrelation: appVisibleResult.applicationVisible,
        largestMeaningfulPercentChange: largestShift,
        replicationClassification: repResult.classification,
      });

      await this.query(
        `INSERT INTO leakage_findings (experiment_id, score, rubric, classification, rationale)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          experiment.id,
          leakageFinding.score,
          JSON.stringify(leakageFinding.rubric),
          leakageFinding.band,
          `Leakage score ${leakageFinding.score} (${leakageFinding.band}) calculated via documented rubric.`,
        ]
      );

      // 5. Causal Governance
      const causalGovernanceResult = classifyCausalGovernance({
        parityValidated: true,
        telemetryComplete: allTelemetryRecords.length === replicationCount * 2,
        applicationVisibleResult: appVisibleResult,
        replicationResult: repResult,
        leakageResult: leakageFinding,
        excludedDimensionsVerifiedInvariant: true,
      });

      // 6. Evidence Graph
      const snapsRes = await this.query(
        'SELECT * FROM infrastructure_snapshots WHERE experiment_id = $1 ORDER BY infrastructure ASC',
        [experiment.id]
      );
      const snapshots = snapsRes.rows;

      const evidenceGraph = buildEvidenceGraph({
        experiment: {
          id: experiment.id,
          name: experiment.name,
          applicationVersion: experiment.application_version,
          manifestChecksum: experiment.manifest_checksum,
        },
        trials: allTrialRecords,
        infrastructureSnapshots: snapshots,
        infrastructureDifferences,
        telemetryRecords: allTelemetryRecords,
        behaviourComparisons,
        leakageFinding,
        replicationAnalysis: repResult,
        causalGovernanceResult,
      });

      // 7. Evidence Artifacts
      const snapshotA = snapshots.find((s) => s.infrastructure === 'A') || { profile: {} };
      const snapshotB = snapshots.find((s) => s.infrastructure === 'B') || { profile: {} };

      const artifactsMap = generateEvidenceArtifacts({
        manifest: experiment.manifest,
        infrastructureA: snapshotA.profile,
        infrastructureB: snapshotB.profile,
        infrastructureDifferences,
        telemetryA: summaryA,
        telemetryB: summaryB,
        telemetryATrials: trialsA.map((t) => t.telemetry),
        telemetryBTrials: trialsB.map((t) => t.telemetry),
        behaviourComparison: behaviourComparisons,
        leakageAnalysis: leakageFinding,
        replicationAnalysis: repResult,
        evidenceGraph,
        runtimeProvenance: {
          applicationVersion: experiment.application_version,
          executedAt: new Date().toISOString(),
          targetDimension: experiment.target_dimension,
          replicationCount,
        },
      });

      for (const [fileName, content] of Object.entries(artifactsMap)) {
        const artifactChecksum = canonicalChecksum(content ?? {});
        const artifactType = fileName.replace(/\.json$/, '').replace(/-/g, '_').toUpperCase();

        await this.query(
          `INSERT INTO evidence_artifacts (experiment_id, artifact_type, file_name, content, checksum)
           VALUES ($1, $2, $3, $4, $5)`,
          [experiment.id, artifactType, fileName, JSON.stringify(content), artifactChecksum]
        );
      }

      // 8. Experiment completion
      await this.query('UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2', ['COMPLETED', experiment.id]);

      return {
        status: 'COMPLETED',
        experimentId: experiment.id,
        trialsExecuted: allTrialRecords.length,
        replicationClassification: repResult.classification,
        causalGovernance: causalGovernanceResult,
      };
    } catch (err) {
      await this.query('UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2', ['ABORTED', experiment.id]);
      throw err;
    }
  }

  /**
   * Run the complete experiment lifecycle:
   * validate parity -> (if pass) execute experiment.
   *
   * @param {string} experimentId
   * @returns {Promise<object>} result of execution or validation failure
   */
  async runFullLifecycle(experimentId) {
    const valResult = await this.validateParity(experimentId);
    if (!valResult.parityValidated || valResult.status !== 'READY_FOR_EXECUTION') {
      return valResult;
    }
    return this.executeExperiment(experimentId);
  }
}

function createExperimentRunner(deps = {}) {
  return new ExperimentRunner(deps);
}

module.exports = {
  ExperimentRunner,
  createExperimentRunner,
};

/**
 * Express application factory.
 *
 * Accepts injectable dependencies (`db.query`, an `InfrastructureInspector`
 * instance) so tests can exercise routes against fakes without a live
 * PostgreSQL instance or a live Kubernetes cluster. `server.js` wires up the
 * real dependencies for production/dev use.
 *
 * ROUTING SAFETY CONTRACT: GET /api/analyzer/experiments/:id/differences
 * must read only from persisted evidence (infrastructure_differences table)
 * and must NEVER call deps.inspector.captureSnapshot(). This is enforced by
 * tests/safety/no-live-k8s-on-differences.test.js.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { canonicalChecksum, verifyParity } = require('../../../analyzer/evidence/checksum');
const { analyzeRepeatedTrials } = require('../../../analyzer/behaviour/repeatedTrials');
const { compareTelemetrySummaries } = require('../../../analyzer/behaviour/behaviourComparison');
const { detectDifferences } = require('../../../analyzer/infrastructure/differenceDetector');
const { detectApplicationVisibleDifferences } = require('../../../analyzer/behaviour/applicationVisibleDetector');
const { computeLeakageScore } = require('../../../analyzer/leakage/leakageScore');
const { classifyCausalGovernance } = require('../../../analyzer/evidence/causalGovernance');
const { buildEvidenceGraph } = require('../../../analyzer/evidence/evidenceGraph');
const { generateEvidenceArtifacts } = require('../../../analyzer/evidence/artifactGenerator');
const { generateReport } = require('../../../analyzer/evidence/reportGenerator');
const { runStorageWorkload } = require('./workload');
const { getStorageMountPath } = require('./config');
const { createExperimentRunner, ExperimentRunner } = require('./experimentRunner');

function createApp(deps = {}) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const query = deps.query || (() => { throw new Error('No database query function configured'); });
  const runner =
    deps.experimentRunner ||
    deps.runner ||
    createExperimentRunner({
      query,
      inspector: deps.inspector,
      runWorkload: deps.runWorkload,
      getStorageMountPath: deps.getStorageMountPath,
    });

  app.get('/', (req, res) => {
    res.json({
      service: 'cloudport-backend',
      version: process.env.APP_VERSION || 'cloudport:1.0.0',
      health: '/health',
      api: '/api/analyzer/experiments',
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'cloudport-backend', version: process.env.APP_VERSION || 'cloudport:1.0.0' });
  });

  app.get('/ready', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', reason: err.message });
    }
  });

  app.get('/api/version', (req, res) => {
    res.json({
      applicationVersion: process.env.APP_VERSION || 'cloudport:1.0.0',
      infrastructureIdentity: process.env.INFRA_IDENTITY || 'unset',
    });
  });

  // -------------------------------------------------------------------
  // Deterministic workload execution (the actual application under test).
  // Behavior must depend ONLY on seed/concurrency/operationCount, never on
  // infrastructure identity -- see analyzer/../workload-determinism tests.
  //
  // STORAGE MOUNT: the workload must operate against the infrastructure's
  // actual mounted storage (Infrastructure A/B both mount their PVC at
  // /data in Kubernetes; see platform/infrastructure-a/02-deployment.yaml
  // and platform/infrastructure-b/03-deployment.yaml, both of which set
  // CLOUDPORT_STORAGE_MOUNT=/data). getStorageMountPath() is the single,
  // explicit place that reads that configuration -- this route must never
  // hard-code a path itself, and workload.js must never know or care which
  // infrastructure /data belongs to. If CLOUDPORT_STORAGE_MOUNT is unset
  // (e.g. plain local development with no PVC mounted anywhere),
  // runStorageWorkload falls back to its own OS-temp-directory default,
  // which is NOT a valid substitute for a real storage-isolation experiment.
  // -------------------------------------------------------------------
  app.post('/api/workload/run', async (req, res, next) => {
    try {
      const { seed, concurrency, operationCount } = req.body || {};
      if (!Number.isInteger(seed) || !Number.isInteger(concurrency) || !Number.isInteger(operationCount)) {
        return res.status(400).json({ error: 'seed, concurrency, and operationCount must all be integers' });
      }
      const scratchDir = getStorageMountPath() || undefined;
      const result = await runStorageWorkload({ seed, concurrency, operationCount, scratchDir });
      res.json({
        ...result,
        applicationVersion: process.env.APP_VERSION || 'cloudport:1.0.0',
        infrastructureIdentity: process.env.INFRA_IDENTITY || 'unset',
        storageMountConfigured: Boolean(getStorageMountPath()),
      });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------
  // Experiments
  // -------------------------------------------------------------------
  app.get('/api/analyzer/experiments', async (req, res, next) => {
    try {
      const result = await query('SELECT * FROM experiments ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id', async (req, res, next) => {
    try {
      const result = await query('SELECT * FROM experiments WHERE id = $1', [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: 'experiment not found' });
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/analyzer/experiments/:id/validate', async (req, res, next) => {
    try {
      const result = await runner.validateParity(req.params.id);
      if (result.status === 'FAILED_VALIDATION') {
        return res.status(422).json(result);
      }
      res.json(result);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/analyzer/experiments/:id/run', async (req, res, next) => {
    try {
      const expResult = await query('SELECT * FROM experiments WHERE id = $1', [req.params.id]);
      if (expResult.rowCount === 0) return res.status(404).json({ error: 'experiment not found' });
      const experiment = expResult.rows[0];

      // Explicit-operator-action gate: execution must be requested via this
      // route with an explicit confirmation flag; it must never happen
      // automatically as a side effect of provisioning or of GET requests.
      if (req.body?.confirm !== true) {
        return res.status(428).json({
          error: 'Execution requires explicit confirmation.',
          hint: 'POST { "confirm": true } to execute this experiment.',
        });
      }

      if (experiment.status !== 'READY_FOR_EXECUTION') {
        return res.status(409).json({
          error: `Experiment is not READY_FOR_EXECUTION (current status: ${experiment.status}).`,
        });
      }

      await query('UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2', ['RUNNING', experiment.id]);

      // Execute paired trials and analysis pipeline asynchronously in the runner.
      // Catches background errors so they don't produce uncaught promise rejections.
      runner.executeExperiment(experiment.id).catch((_err) => {
        // Background failure is recorded in the database (experiment status set to ABORTED)
        // by the runner itself.
      });

      res.status(202).json({ status: 'RUNNING', experimentId: experiment.id });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------
  // Infrastructure differences -- PERSISTED EVIDENCE ONLY. Never touches
  // deps.inspector. This is intentional and load-bearing (see safety test).
  // -------------------------------------------------------------------
  app.get('/api/analyzer/experiments/:id/differences', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM infrastructure_differences WHERE experiment_id = $1 ORDER BY dimension ASC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/behaviour', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM behaviour_comparisons WHERE experiment_id = $1 ORDER BY metric ASC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/leakage', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM leakage_findings WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'no leakage finding recorded for this experiment' });
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/evidence', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM evidence_artifacts WHERE experiment_id = $1 ORDER BY artifact_type ASC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/report', async (req, res, next) => {
    try {
      const expResult = await query('SELECT * FROM experiments WHERE id = $1', [req.params.id]);
      if (expResult.rowCount === 0) return res.status(404).json({ error: 'experiment not found' });
      const experiment = expResult.rows[0];
      const executed = experiment.status === 'COMPLETED';

      let reportContext = {
        experiment: {
          name: experiment.name,
          description: experiment.manifest?.description,
          targetDimension: experiment.target_dimension,
          replicationCount: experiment.replication_count,
          controlledVariable: experiment.controlled_variable,
          excludedDimensions: experiment.excluded_dimensions,
          applicationVersion: experiment.application_version,
          workload: experiment.manifest?.workload,
        },
        executed,
      };

      if (executed) {
        const snapsRes = await query(
          'SELECT * FROM infrastructure_snapshots WHERE experiment_id = $1 ORDER BY infrastructure ASC',
          [experiment.id]
        );
        const diffsRes = await query(
          'SELECT * FROM infrastructure_differences WHERE experiment_id = $1 ORDER BY dimension ASC',
          [experiment.id]
        );
        const behRes = await query(
          'SELECT * FROM behaviour_comparisons WHERE experiment_id = $1 ORDER BY metric ASC',
          [experiment.id]
        );
        const replRes = await query(
          'SELECT * FROM replication_analysis WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 1',
          [experiment.id]
        );
        const leakRes = await query(
          'SELECT * FROM leakage_findings WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 1',
          [experiment.id]
        );
        const snapA = snapsRes.rows.find((s) => s.infrastructure === 'A');
        const snapB = snapsRes.rows.find((s) => s.infrastructure === 'B');

        reportContext = {
          ...reportContext,
          infrastructureA: snapA?.profile,
          infrastructureB: snapB?.profile,
          infrastructureDifferences: diffsRes.rows.map((r) => ({
            dimension: r.dimension,
            differenceFound: r.difference_found,
            detail: r.detail,
          })),
          behaviourComparison: behRes.rows,
          replicationAnalysis: replRes.rows[0],
          leakageAnalysis: leakRes.rows[0],
          causalGovernance: {
            classification: replRes.rows[0]?.classification || 'INSUFFICIENT_DATA',
            rationale: leakRes.rows[0]?.rationale || 'Report generated from persisted evidence.',
          },
        };
      }

      const report = generateReport(reportContext);
      res.type('text/markdown').send(report);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------
  // Trials / telemetry / snapshots / replication / recovery
  // -------------------------------------------------------------------
  app.get('/api/analyzer/experiments/:id/trials', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM experiment_trials WHERE experiment_id = $1 ORDER BY trial_index ASC, infrastructure ASC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/trials/:trialId/telemetry', async (req, res, next) => {
    try {
      const result = await query('SELECT * FROM telemetry WHERE trial_id = $1', [req.params.trialId]);
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/telemetry', async (req, res, next) => {
    try {
      const result = await query(
        `SELECT t.*, et.trial_index, et.infrastructure
         FROM telemetry t
         JOIN experiment_trials et ON t.trial_id = et.id
         WHERE et.experiment_id = $1
         ORDER BY et.trial_index ASC, et.infrastructure ASC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/snapshots', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM infrastructure_snapshots WHERE experiment_id = $1 ORDER BY captured_at DESC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/replication', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM replication_analysis WHERE experiment_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/analyzer/experiments/:id/recovery', async (req, res, next) => {
    try {
      const result = await query(
        `SELECT re.* FROM recovery_events re
         JOIN fault_events fe ON re.fault_event_id = fe.id
         WHERE fe.experiment_id = $1
         ORDER BY re.created_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  // Not found + error handling
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

module.exports = {
  createApp,
  createExperimentRunner,
  ExperimentRunner,
  // Re-exported for convenience so other modules/tests can reach the analyzer
  // pipeline through the same surface as the HTTP layer.
  analyzer: {
    canonicalChecksum,
    verifyParity,
    analyzeRepeatedTrials,
    compareTelemetrySummaries,
    detectDifferences,
    detectApplicationVisibleDifferences,
    computeLeakageScore,
    classifyCausalGovernance,
    buildEvidenceGraph,
    generateEvidenceArtifacts,
    generateReport,
  },
};

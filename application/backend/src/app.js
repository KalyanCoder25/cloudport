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

function createApp(deps = {}) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const query = deps.query || (() => { throw new Error('No database query function configured'); });

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
      // NOTE (integration contract): this route currently only transitions
      // experiment status to RUNNING; the paired-trial orchestration loop
      // that will actually invoke runStorageWorkload() for each A/B trial is
      // a separate, not-yet-built component. When that loop is implemented,
      // it MUST obtain its storage path via getStorageMountPath() from
      // ./config.js -- the exact same accessor used by POST /api/workload/run
      // -- so the path exercised by a real experiment trial and the path
      // exercised by an ad-hoc workload run are never allowed to diverge.
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

      const report = generateReport({
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
      });
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

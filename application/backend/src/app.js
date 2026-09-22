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
const {
  hashPassword,
  verifyPassword,
  signToken,
  sanitizeUser,
  createAuthMiddleware,
  requireAuth,
} = require('./auth');
const { createDeploymentService } = require('./deployments/deploymentService');
const {
  AwsEksProvider,
  GcpGkeProvider,
  LocalKubernetesProvider,
} = require('./deployments/deploymentProviders');
const {
  detectTechnologyFromRepo,
  detectFromFiles,
  normalizeTechnology,
} = require('./deployments/technologyDetector');


function createApp(deps = {}) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const query = deps.query || (() => { throw new Error('No database query function configured'); });
  app.use(createAuthMiddleware(query));
  const runner =
    deps.experimentRunner ||
    deps.runner ||
    createExperimentRunner({
      query,
      inspector: deps.inspector,
      runWorkload: deps.runWorkload,
      getStorageMountPath: deps.getStorageMountPath,
    });

  const deploymentProviders = deps.deploymentProviders || {
    aws_eks: new AwsEksProvider(),
    gcp_gke: new GcpGkeProvider(),
    local_k8s: new LocalKubernetesProvider(),
  };

  const deploymentService =
    deps.deploymentService ||
    createDeploymentService({
      query,
      providers: deploymentProviders,
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
  // Authentication routes
  // -------------------------------------------------------------------
  app.post('/api/auth/signup', async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body || {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }
      const cleanName = (displayName && typeof displayName === 'string' && displayName.trim()) || email.split('@')[0];

      const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const { hash, salt } = hashPassword(password);
      const insertUser = await query(
        `INSERT INTO users (email, display_name, password_hash, salt, role)
         VALUES ($1, $2, $3, $4, 'operator')
         RETURNING id, email, display_name, role, created_at`,
        [email.toLowerCase().trim(), cleanName, hash, salt]
      );
      const newUser = insertUser.rows[0];

      // Auto-provision initial sandbox application for the new user
      await query(
        `INSERT INTO applications (name, description, framework, owner_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, name) DO NOTHING`,
        [
          'My First Application',
          'Initial sandbox application for testing portability across infrastructure.',
          'Node.js / Express',
          newUser.id,
        ]
      );

      const token = signToken(newUser);
      res.status(201).json({ token, user: sanitizeUser(newUser) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];
      if (!user.password_hash || !user.salt) {
        return res.status(401).json({ error: 'Password authentication not initialized for this account' });
      }

      const valid = verifyPassword(password, user.password_hash, user.salt);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken(user);
      res.json({ token, user: sanitizeUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: sanitizeUser(req.user) });
  });

  // -------------------------------------------------------------------
  // Application ownership routes
  // -------------------------------------------------------------------
  app.get('/api/applications', async (req, res, next) => {
    try {
      const statusParam = req.query.status ? String(req.query.status).toUpperCase() : null;
      let statusClause = '';
      if (statusParam === 'ACTIVE') {
        statusClause = " AND (a.status = 'ACTIVE' OR a.status IS NULL)";
      } else if (statusParam === 'ARCHIVED') {
        statusClause = " AND a.status = 'ARCHIVED'";
      }

      if (req.user) {
        if (req.user.role === 'admin') {
          const result = await query(
            `SELECT a.*, COUNT(e.id)::int AS experiment_count
             FROM applications a
             LEFT JOIN experiments e ON e.application_id = a.id
             WHERE 1=1 ${statusClause}
             GROUP BY a.id
             ORDER BY a.created_at DESC`
          );
          return res.json(result.rows);
        }
        const result = await query(
          `SELECT a.*, COUNT(e.id)::int AS experiment_count
           FROM applications a
           LEFT JOIN experiments e ON e.application_id = a.id
           WHERE (a.owner_id = $1 OR a.name = 'CloudPort Core Research Suite') ${statusClause}
           GROUP BY a.id
           ORDER BY a.created_at DESC`,
          [req.user.id]
        );
        res.json(result.rows);
      } else {
        // Unauthenticated callers only see the public system baseline application
        const result = await query(
          `SELECT a.*, COUNT(e.id)::int AS experiment_count
           FROM applications a
           LEFT JOIN experiments e ON e.application_id = a.id
           WHERE a.name = 'CloudPort Core Research Suite' ${statusClause}
           GROUP BY a.id
           ORDER BY a.created_at DESC`
        );
        res.json(result.rows);
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/applications', requireAuth, async (req, res, next) => {
    try {
      const {
        name,
        description,
        repository_url,
        framework,
        technology,
        build_command,
        start_command,
        port,
        dockerfile_path,
      } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Application name is required' });
      }

      const cleanName = name.trim();
      if (cleanName.toLowerCase() === 'cloudport core research suite') {
        return res.status(400).json({ error: 'Application name is reserved for system baselines' });
      }

      const existing = await query(
        'SELECT id FROM applications WHERE owner_id = $1 AND name = $2',
        [req.user.id, cleanName]
      );
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: 'An application with this name already exists' });
      }

      const normTech = normalizeTechnology(technology || framework);

      const result = await query(
        `INSERT INTO applications (
           name, description, repository_url, framework, owner_id,
           technology, build_command, start_command, port, dockerfile_path
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          cleanName,
          description ? description.trim() : null,
          repository_url ? repository_url.trim() : null,
          framework ? framework.trim() : 'Node.js',
          req.user.id,
          normTech,
          build_command || null,
          start_command || null,
          port ? parseInt(port, 10) : 8080,
          dockerfile_path || null,
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/applications/:id', async (req, res, next) => {
    try {
      const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'application not found' });
      }
      const application = appResult.rows[0];
      const isBaseline = application.name === 'CloudPort Core Research Suite';

      // Authorization guard: private applications require authenticated ownership
      if (!isBaseline) {
        if (!req.user) {
          return res.status(401).json({ error: 'Unauthorized: authentication required to access this application' });
        }
        if (req.user.id !== application.owner_id && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Forbidden: you do not have permission to access this application' });
        }
      }

      const expResult = await query(
        'SELECT * FROM experiments WHERE application_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );
      const depResult = await query(
        "SELECT * FROM deployments WHERE application_id = $1 AND status != 'DELETED' AND deleted_at IS NULL ORDER BY created_at DESC",
        [req.params.id]
      );
      res.json({
        application,
        experiments: expResult.rows,
        deployments: depResult.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  const updateApplicationHandler = async (req, res, next) => {
    try {
      const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'application not found' });
      }
      const app = appResult.rows[0];

      // Protect system baseline: cannot be modified or renamed
      if (app.name === 'CloudPort Core Research Suite') {
        return res.status(403).json({ error: 'Forbidden: protected system baseline application cannot be modified or renamed' });
      }

      // Check ownership
      if (req.user.id !== app.owner_id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: you do not have permission to modify this application' });
      }

      const {
        name,
        description,
        repository_url,
        framework,
        technology,
        build_command,
        start_command,
        port,
        dockerfile_path,
      } = req.body || {};

      let newName = app.name;
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ error: 'Application name cannot be empty' });
        }
        const cleanName = name.trim();
        if (cleanName.toLowerCase() === 'cloudport core research suite') {
          return res.status(400).json({ error: 'Application name is reserved for system baselines' });
        }

        if (cleanName !== app.name) {
          const duplicate = await query(
            'SELECT id FROM applications WHERE owner_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
            [app.owner_id, cleanName, app.id]
          );
          if (duplicate.rowCount > 0) {
            return res.status(409).json({ error: `You already have an application named "${cleanName}"` });
          }
          newName = cleanName;
        }
      }

      const newDesc = description !== undefined ? (description ? description.trim() : null) : app.description;
      const newRepo = repository_url !== undefined ? (repository_url ? repository_url.trim() : null) : app.repository_url;
      const newFramework = framework !== undefined ? (framework ? framework.trim() : 'Node.js') : app.framework;
      const newTech = technology !== undefined ? normalizeTechnology(technology) : (app.technology || normalizeTechnology(newFramework));
      const newBuild = build_command !== undefined ? build_command : app.build_command;
      const newStart = start_command !== undefined ? start_command : app.start_command;
      const newPort = port !== undefined ? (port ? parseInt(port, 10) : 8080) : app.port;
      const newDockerfile = dockerfile_path !== undefined ? dockerfile_path : app.dockerfile_path;

      const updateResult = await query(
        `UPDATE applications
         SET name = $1, description = $2, repository_url = $3, framework = $4,
             technology = $5, build_command = $6, start_command = $7, port = $8,
             dockerfile_path = $9, updated_at = now()
         WHERE id = $10
         RETURNING *`,
        [newName, newDesc, newRepo, newFramework, newTech, newBuild, newStart, newPort, newDockerfile, app.id]
      );

      res.json(updateResult.rows[0]);
    } catch (err) {
      next(err);
    }
  };

  app.patch('/api/applications/:id', requireAuth, updateApplicationHandler);
  app.put('/api/applications/:id', requireAuth, updateApplicationHandler);

  app.post('/api/applications/:id/archive', requireAuth, async (req, res, next) => {
    try {
      const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'application not found' });
      }
      const app = appResult.rows[0];

      // Protect system baseline: cannot be archived
      if (app.name === 'CloudPort Core Research Suite') {
        return res.status(403).json({ error: 'Forbidden: protected system baseline application cannot be archived' });
      }

      // Check ownership
      if (req.user.id !== app.owner_id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: you do not have permission to archive this application' });
      }

      // Deployment safety guard: verify no active deployments
      const activeDeps = await query(
        `SELECT id, target_provider, status FROM deployments
         WHERE application_id = $1
           AND status IN ('RUNNING', 'DEPLOYING', 'QUEUED', 'STOPPING', 'DELETING')
           AND deleted_at IS NULL`,
        [app.id]
      );
      if (activeDeps.rowCount > 0) {
        return res.status(409).json({
          error: 'Application cannot be archived while an active deployment exists. Stop or delete the deployment first.',
          activeDeployments: activeDeps.rows,
        });
      }

      const updateResult = await query(
        `UPDATE applications
         SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [app.id]
      );
      res.json(updateResult.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/applications/:id/restore', requireAuth, async (req, res, next) => {
    try {
      const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'application not found' });
      }
      const app = appResult.rows[0];

      // Protect system baseline
      if (app.name === 'CloudPort Core Research Suite') {
        return res.status(403).json({ error: 'Forbidden: protected system baseline application cannot be modified' });
      }

      // Check ownership
      if (req.user.id !== app.owner_id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: you do not have permission to restore this application' });
      }

      const updateResult = await query(
        `UPDATE applications
         SET status = 'ACTIVE', archived_at = NULL, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [app.id]
      );
      res.json(updateResult.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/applications/:id', requireAuth, async (req, res, next) => {
    try {
      const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
      if (appResult.rowCount === 0) {
        return res.status(404).json({ error: 'application not found' });
      }
      const app = appResult.rows[0];

      // Protect system baseline
      if (app.name === 'CloudPort Core Research Suite') {
        return res.status(403).json({ error: 'Forbidden: protected system baseline application cannot be deleted' });
      }

      // Check ownership
      if (req.user.id !== app.owner_id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: you do not have permission to delete this application' });
      }

      // Check research and deployment history
      const expCount = await query('SELECT COUNT(*)::int AS count FROM experiments WHERE application_id = $1', [app.id]);
      const depCount = await query('SELECT COUNT(*)::int AS count FROM deployments WHERE application_id = $1', [app.id]);

      if (expCount.rows[0].count > 0 || depCount.rows[0].count > 0) {
        return res.status(409).json({
          error: 'This application contains research history and cannot be permanently deleted. Archive it instead.',
          experimentCount: expCount.rows[0].count,
          deploymentCount: depCount.rows[0].count,
        });
      }

      await query('DELETE FROM applications WHERE id = $1', [app.id]);
      res.json({ message: 'Application successfully deleted', id: app.id });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------
  // User Application Deployment routes
  // -------------------------------------------------------------------
  app.get('/api/deployments', requireAuth, async (req, res, next) => {
    try {
      const { application_id } = req.query;
      const deployments = await deploymentService.listDeployments({
        user: req.user,
        applicationId: application_id,
      });
      res.json(deployments);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments', requireAuth, async (req, res, next) => {
    try {
      const { application_id, source_type, source_reference, target_providers, metadata } = req.body || {};
      const deployments = await deploymentService.createDeployments({
        applicationId: application_id,
        user: req.user,
        sourceType: source_type,
        sourceReference: source_reference,
        targetProviders: target_providers,
        metadata,
      });
      res.status(201).json(deployments);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.get('/api/deployments/:id', requireAuth, async (req, res, next) => {
    try {
      const deployment = await deploymentService.getDeployment({
        id: req.params.id,
        user: req.user,
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments/:id/confirm', requireAuth, async (req, res, next) => {
    try {
      const { confirmed } = req.body || {};
      const deployment = await deploymentService.confirmDeployment({
        id: req.params.id,
        user: req.user,
        confirmed: confirmed !== undefined ? confirmed : true,
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments/:id/start', requireAuth, async (req, res, next) => {
    try {
      const deployment = await deploymentService.startDeployment({
        id: req.params.id,
        user: req.user,
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments/:id/stop', requireAuth, async (req, res, next) => {
    try {
      const deployment = await deploymentService.stopDeployment({
        id: req.params.id,
        user: req.user,
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments/:id/delete', requireAuth, async (req, res, next) => {
    try {
      const { confirmation, confirm } = req.body || {};
      const deployment = await deploymentService.deleteDeployment({
        id: req.params.id,
        user: req.user,
        confirmation: confirmation !== undefined ? confirmation : confirm,
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.delete('/api/deployments/:id', requireAuth, async (req, res, next) => {
    try {
      const { confirmation, confirm } = req.body || {};
      const deployment = await deploymentService.deleteDeployment({
        id: req.params.id,
        user: req.user,
        confirmation: confirmation !== undefined ? confirmation : (confirm !== undefined ? confirm : true),
      });
      res.json(deployment);
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/deployments/detect-technology', requireAuth, async (req, res, next) => {
    try {
      const { repository_url, file_list, file_contents } = req.body || {};
      if (Array.isArray(file_list)) {
        const result = detectFromFiles(file_list, file_contents || {});
        return res.json(result);
      }
      if (!repository_url || typeof repository_url !== 'string') {
        return res.status(400).json({ error: 'repository_url or file_list is required' });
      }
      const cleanRepoUrl = repository_url.trim();
      const githubRegex = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/i;
      if (!githubRegex.test(cleanRepoUrl)) {
        return res.status(400).json({ error: 'Invalid GitHub repository URL. Must be https://github.com/owner/repo' });
      }
      const result = await detectTechnologyFromRepo(cleanRepoUrl);
      res.json(result);
    } catch (err) {
      next(err);
    }
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
      const { application_id, scope } = req.query || {};
      if (application_id) {
        const appCheck = await query('SELECT id, name, owner_id FROM applications WHERE id = $1', [application_id]);
        if (appCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Application not found' });
        }
        const targetApp = appCheck.rows[0];
        const isBaseline = targetApp.name === 'CloudPort Core Research Suite';
        if (!isBaseline) {
          if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized: authentication required' });
          }
          if (req.user.id !== targetApp.owner_id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: you do not have access to this application\'s experiments' });
          }
        }
        const result = await query(
          'SELECT * FROM experiments WHERE application_id = $1 ORDER BY created_at DESC',
          [application_id]
        );
        return res.json(result.rows);
      }
      if (scope === 'mine' && req.user) {
        const result = await query(
          'SELECT * FROM experiments WHERE created_by = $1 ORDER BY created_at DESC',
          [req.user.id]
        );
        return res.json(result.rows);
      }
      const result = await query('SELECT * FROM experiments ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/analyzer/experiments', requireAuth, async (req, res, next) => {
    try {
      const { name, manifest, applicationId } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Experiment name is required' });
      }
      if (!manifest || typeof manifest !== 'object') {
        return res.status(400).json({ error: 'Valid experiment manifest is required' });
      }

      // Authorization guard: verify application ownership before attaching experiment
      if (applicationId) {
        const appCheck = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
        if (appCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Target application not found' });
        }
        const targetApp = appCheck.rows[0];
        if (targetApp.name === 'CloudPort Core Research Suite' && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Forbidden: cannot attach experiments to the system baseline application' });
        }
        if (targetApp.owner_id !== req.user.id && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Forbidden: cannot attach experiments to an application you do not own' });
        }
        if (targetApp.status === 'ARCHIVED') {
          return res.status(409).json({ error: 'Cannot attach experiments to an archived application. Restore the application first.' });
        }
      }

      const checksum = canonicalChecksum(manifest.invariants || {});
      const appVersion = manifest.application?.version || process.env.APP_VERSION || 'cloudport:1.0.0';
      const workloadType = manifest.workload?.type || 'storage';
      const controlledVar = manifest.controlledVariable || 'storage';
      const targetDim = manifest.targetDimension || 'Storage';
      const excludedDims = JSON.stringify(manifest.excludedDimensions || []);
      const replicationCount = manifest.replicationCount || 1;

      const result = await query(
        `INSERT INTO experiments (
          name, manifest_path, manifest, manifest_checksum,
          application_version, workload, controlled_variable,
          target_dimension, excluded_dimensions, replication_count,
          status, created_by, application_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11, $12)
        RETURNING *`,
        [
          name.trim(),
          `experiments/${name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')}.json`,
          manifest,
          checksum,
          appVersion,
          workloadType,
          controlledVar,
          targetDim,
          excludedDims,
          replicationCount,
          req.user.id,
          applicationId || null,
        ]
      );
      res.status(201).json(result.rows[0]);
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

  const recoveryRunner = deps.recoveryRunner || null;

  app.post('/api/analyzer/experiments/:id/recovery/run', async (req, res, next) => {
    try {
      if (!recoveryRunner) {
        return res.status(501).json({ error: 'No recovery runner configured' });
      }
      const outcome = await recoveryRunner.runControlledRecovery(req.params.id);
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------
  // Multi-Cloud Experiment API (multicloud-portability-v1)
  //
  // These routes wire the MultiCloudExperimentRunner into the HTTP layer.
  // They operate on the multicloud_trial_results and
  // multicloud_experiment_results tables (migration 0003_multicloud.sql).
  //
  // SAFETY CONTRACT:
  //   - None of these routes modifies kind-korifi or Korifi resources.
  //   - Trial ingestion validates cloud_provider + measurement_source.
  //   - Run endpoint requires explicit { "confirm": true } body.
  //   - All reads are against persisted evidence tables only.
  // -------------------------------------------------------------------
  const { MultiCloudExperimentRunner, MULTICLOUD_MEASUREMENT_SOURCE } = require('./multiCloudExperimentRunner');
  const fs = require('fs');
  const path = require('path');

  const mcRunner = deps.multiCloudRunner || new MultiCloudExperimentRunner({ query });

  /**
   * POST /api/multicloud/trials
   *
   * Ingest a Locust trial result (from locustfile.py provenance JSON).
   * Called after each Locust run completes — by the experiment orchestrator
   * collecting results from the cluster pod.
   *
   * Body: trial provenance JSON (as produced by locustfile.py on_test_stop).
   */
  app.post('/api/multicloud/trials', async (req, res, next) => {
    try {
      const body = req.body || {};
      const required = [
        'experiment_id', 'trial_id', 'target_context', 'cloud_provider',
        'start_timestamp', 'end_timestamp', 'duration_seconds',
        'request_count', 'success_count', 'failure_count',
        'error_rate', 'requests_per_second',
        'latency_p50_ms', 'latency_p95_ms', 'latency_p99_ms',
        'locustfile_version',
      ];
      const missing = required.filter((k) => body[k] == null);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }

      // Validate cloud_provider
      if (!['AWS', 'GCP'].includes(body.cloud_provider)) {
        return res.status(400).json({ error: 'cloud_provider must be AWS or GCP' });
      }

      // Validate measurement_source if present
      const ms = body.measurement_source || MULTICLOUD_MEASUREMENT_SOURCE;
      if (ms !== MULTICLOUD_MEASUREMENT_SOURCE) {
        return res.status(400).json({
          error: `measurement_source must be "${MULTICLOUD_MEASUREMENT_SOURCE}". Got: "${ms}"`,
        });
      }

      // Validate context is authorized for multi-cloud (not kind-korifi)
      try {
        mcRunner.validateCloudContext(body.target_context);
      } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
      }

      // Determine trial_index: next available index for this experiment + provider
      const existingRes = await query(
        'SELECT COUNT(*) AS cnt FROM multicloud_trial_results WHERE experiment_id = $1 AND cloud_provider = $2',
        [body.experiment_id, body.cloud_provider]
      );
      const trialIndex = parseInt(existingRes.rows[0]?.cnt ?? 0, 10);

      const provenance = {
        experiment_id: body.experiment_id,
        trial_id: body.trial_id,
        target_context: body.target_context,
        cloud_provider: body.cloud_provider,
        start_timestamp: body.start_timestamp,
        end_timestamp: body.end_timestamp,
        locust_users: body.locust_users || 50,
        locust_spawn_rate: body.locust_spawn_rate || 5,
        locustfile_version: body.locustfile_version,
        measurement_source: MULTICLOUD_MEASUREMENT_SOURCE,
      };

      await query(
        `INSERT INTO multicloud_trial_results
           (experiment_id, trial_id, trial_index, target_context, cloud_provider,
            start_timestamp, end_timestamp, duration_seconds,
            locust_users, locust_spawn_rate, locustfile_version,
            request_count, success_count, failure_count,
            error_rate, requests_per_second,
            latency_p50_ms, latency_p95_ms, latency_p99_ms,
            measurement_source, provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (experiment_id, trial_index, cloud_provider) DO UPDATE SET
           request_count = EXCLUDED.request_count,
           success_count = EXCLUDED.success_count,
           failure_count = EXCLUDED.failure_count,
           error_rate = EXCLUDED.error_rate,
           requests_per_second = EXCLUDED.requests_per_second,
           latency_p50_ms = EXCLUDED.latency_p50_ms,
           latency_p95_ms = EXCLUDED.latency_p95_ms,
           latency_p99_ms = EXCLUDED.latency_p99_ms,
           provenance = EXCLUDED.provenance`,
        [
          body.experiment_id, body.trial_id, trialIndex, body.target_context, body.cloud_provider,
          body.start_timestamp, body.end_timestamp, body.duration_seconds,
          body.locust_users || 50, body.locust_spawn_rate || 5, body.locustfile_version,
          body.request_count, body.success_count, body.failure_count,
          body.error_rate, body.requests_per_second,
          body.latency_p50_ms, body.latency_p95_ms, body.latency_p99_ms,
          MULTICLOUD_MEASUREMENT_SOURCE, JSON.stringify(provenance),
        ]
      );

      res.status(201).json({
        status: 'ingested',
        experimentId: body.experiment_id,
        trialId: body.trial_id,
        trialIndex,
        cloudProvider: body.cloud_provider,
        measurementSource: MULTICLOUD_MEASUREMENT_SOURCE,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/multicloud/trials/:experimentId
   *
   * List all ingested trial results for an experiment (ordered by trial_index).
   */
  app.get('/api/multicloud/trials/:experimentId', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM multicloud_trial_results WHERE experiment_id = $1 ORDER BY cloud_provider ASC, trial_index ASC',
        [req.params.experimentId]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/multicloud/experiments/:experimentId/run
   *
   * Trigger the paired analysis pipeline (statistical + leakage + evidence)
   * for an experiment that has ingested trial results.
   *
   * Requires { "confirm": true } body — explicit operator gate.
   */
  app.post('/api/multicloud/experiments/:experimentId/run', async (req, res, next) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(428).json({
          error: 'Multi-cloud analysis requires explicit confirmation.',
          hint: 'POST { "confirm": true } to run analysis.',
        });
      }

      // Load experiment definition from JSON file
      const expDefPath = path.resolve(__dirname, '../../../experiments/multicloud-portability-v1.json');
      let experimentDef;
      try {
        experimentDef = JSON.parse(fs.readFileSync(expDefPath, 'utf8'));
      } catch (readErr) {
        return res.status(500).json({
          error: 'Could not load experiment definition.',
          detail: readErr.message,
          expectedPath: expDefPath,
        });
      }

      const result = await mcRunner.runPairedExperiment(
        req.params.experimentId,
        experimentDef
      );

      const statusCode = result.status === 'AWAITING_TRIALS' ? 202 : 200;
      res.status(statusCode).json(result);
    } catch (err) {
      if (err.message && err.message.includes('Safety violation')) {
        return res.status(403).json({ error: err.message });
      }
      next(err);
    }
  });

  /**
   * GET /api/multicloud/experiments/:experimentId/result
   *
   * Retrieve the most recent persisted multi-cloud experiment result.
   */
  app.get('/api/multicloud/experiments/:experimentId/result', async (req, res, next) => {
    try {
      const result = await query(
        'SELECT * FROM multicloud_experiment_results WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.params.experimentId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({
          error: 'No result found for this experiment. Run analysis first.',
          hint: 'POST /api/multicloud/experiments/:experimentId/run with { "confirm": true }',
        });
      }
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/multicloud/experiments/:experimentId/status
   *
   * Quick status check: how many trials have been ingested, and whether
   * analysis has been run. Safe to poll — read-only.
   */
  app.get('/api/multicloud/experiments/:experimentId/status', async (req, res, next) => {
    try {
      const trialsRes = await query(
        `SELECT cloud_provider, COUNT(*) AS trial_count
         FROM multicloud_trial_results WHERE experiment_id = $1
         GROUP BY cloud_provider`,
        [req.params.experimentId]
      );
      const resultRes = await query(
        'SELECT experiment_id, leakage_score, leakage_band, causal_classification, statistical_significance, experiment_completed_at FROM multicloud_experiment_results WHERE experiment_id = $1',
        [req.params.experimentId]
      );

      const trialCounts = {};
      for (const row of trialsRes.rows) {
        trialCounts[row.cloud_provider] = parseInt(row.trial_count, 10);
      }
      const totalTrials = Object.values(trialCounts).reduce((a, b) => a + b, 0);
      const awsTrials = trialCounts['AWS'] || 0;
      const gcpTrials = trialCounts['GCP'] || 0;
      const minimumPairedTrials = 5;
      const hasAnalysis = resultRes.rowCount > 0;

      res.json({
        experimentId: req.params.experimentId,
        awsTrials,
        gcpTrials,
        totalTrials,
        minimumPairedTrials,
        readyForAnalysis: awsTrials >= minimumPairedTrials && gcpTrials >= minimumPairedTrials,
        analysisRun: hasAnalysis,
        latestResult: hasAnalysis ? resultRes.rows[0] : null,
      });
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

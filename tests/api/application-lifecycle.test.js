'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../application/backend/src/app');
const { signToken } = require('../../application/backend/src/auth');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function request(server, method, path, body, token) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = respBody ? JSON.parse(respBody) : null;
          } catch {
            parsed = respBody;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createMockDb() {
  const users = [
    { id: 'user-alice', email: 'alice@cloudport.test', display_name: 'Alice', role: 'operator' },
    { id: 'user-bob', email: 'bob@cloudport.test', display_name: 'Bob', role: 'operator' },
  ];

  const applications = [
    {
      id: 'app-baseline',
      name: 'CloudPort Core Research Suite',
      description: 'System research baseline',
      framework: 'Research / Baseline',
      technology: 'CUSTOM',
      owner_id: null,
      status: 'ACTIVE',
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-active',
      name: 'Alice Active App',
      description: 'Active application',
      framework: 'Node.js / Express',
      technology: 'NODE',
      owner_id: 'user-alice',
      status: 'ACTIVE',
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-with-dep',
      name: 'Alice App With Running Deployment',
      description: 'App with active deployment',
      framework: 'Python / Flask',
      technology: 'PYTHON',
      owner_id: 'user-alice',
      status: 'ACTIVE',
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-archived',
      name: 'Alice Archived App',
      description: 'Archived application',
      framework: 'Go / Fiber',
      technology: 'GO',
      owner_id: 'user-alice',
      status: 'ARCHIVED',
      archived_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-empty',
      name: 'Alice Empty App',
      description: 'Empty application for deletion test',
      framework: 'Rust / Axum',
      technology: 'CUSTOM',
      owner_id: 'user-alice',
      status: 'ACTIVE',
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const experiments = [
    {
      id: 'exp-hist-1',
      application_id: 'app-alice-archived',
      name: 'Historical Storage Trial',
      status: 'COMPLETED',
      workload: 'STORAGE',
      controlled_variable: 'storage',
      target_dimension: 'Storage',
      created_at: new Date().toISOString(),
    },
    {
      id: 'exp-hist-2',
      application_id: 'app-alice-active',
      name: 'Active App Experiment',
      status: 'COMPLETED',
      workload: 'CPU',
      controlled_variable: 'cpu',
      target_dimension: 'Compute',
      created_at: new Date().toISOString(),
    },
  ];

  const deployments = [
    {
      id: 'dep-running-1',
      application_id: 'app-alice-with-dep',
      target_provider: 'aws_eks',
      status: 'RUNNING',
      deleted_at: null,
    },
    {
      id: 'dep-stopped-1',
      application_id: 'app-alice-archived',
      target_provider: 'local_k8s',
      status: 'STOPPED',
      deleted_at: null,
    },
  ];

  const query = async (sql, params = []) => {
    // Auth middleware user lookup
    if (sql.includes('FROM users WHERE id = $1')) {
      const u = users.find((x) => x.id === params[0]);
      return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
    }

    // Lookup applications by id (SELECT * FROM applications WHERE id = $1)
    if (sql.includes('SELECT * FROM applications WHERE id = $1') || sql.includes('SELECT id, name, owner_id, status FROM applications WHERE id = $1') || sql.includes('SELECT id, status FROM applications WHERE id = $1')) {
      const app = applications.find((a) => a.id === params[0]);
      return { rowCount: app ? 1 : 0, rows: app ? [app] : [] };
    }

    // Active deployments check during archival
    if (sql.includes('FROM deployments') && sql.includes('RUNNING') && sql.includes('application_id = $1')) {
      const active = deployments.filter(
        (d) =>
          d.application_id === params[0] &&
          ['RUNNING', 'DEPLOYING', 'QUEUED', 'STOPPING', 'DELETING'].includes(d.status) &&
          !d.deleted_at
      );
      return { rowCount: active.length, rows: active };
    }

    // Experiments count for an application
    if (sql.includes('SELECT COUNT(*)::int AS count FROM experiments WHERE application_id = $1')) {
      const exps = experiments.filter((e) => e.application_id === params[0]);
      return { rowCount: 1, rows: [{ count: exps.length }] };
    }

    // Deployments count for an application
    if (sql.includes('SELECT COUNT(*)::int AS count FROM deployments WHERE application_id = $1')) {
      const deps = deployments.filter((d) => d.application_id === params[0]);
      return { rowCount: 1, rows: [{ count: deps.length }] };
    }

    // UPDATE applications SET status = 'ARCHIVED'
    if (sql.includes("UPDATE applications") && sql.includes("status = 'ARCHIVED'")) {
      const app = applications.find((a) => a.id === params[0]);
      if (app) {
        app.status = 'ARCHIVED';
        app.archived_at = new Date().toISOString();
        app.updated_at = new Date().toISOString();
      }
      return { rowCount: app ? 1 : 0, rows: app ? [app] : [] };
    }

    // UPDATE applications SET status = 'ACTIVE'
    if (sql.includes("UPDATE applications") && sql.includes("status = 'ACTIVE'")) {
      const app = applications.find((a) => a.id === params[0]);
      if (app) {
        app.status = 'ACTIVE';
        app.archived_at = null;
        app.updated_at = new Date().toISOString();
      }
      return { rowCount: app ? 1 : 0, rows: app ? [app] : [] };
    }

    // DELETE FROM applications WHERE id = $1
    if (sql.includes('DELETE FROM applications WHERE id = $1')) {
      const idx = applications.findIndex((a) => a.id === params[0]);
      if (idx !== -1) {
        applications.splice(idx, 1);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    // INSERT INTO experiments
    if (sql.includes('INSERT INTO experiments')) {
      const newExp = {
        id: `exp-${Date.now()}`,
        name: params[0],
        application_id: params[11],
        status: 'DRAFT',
      };
      experiments.push(newExp);
      return { rowCount: 1, rows: [newExp] };
    }

    return { rowCount: 0, rows: [] };
  };

  return { query, applications, experiments, deployments };
}

test('1. Application Lifecycle: Owner can archive own application', async (t) => {
  const { query, applications } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-alice-active/archive', {}, aliceToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ARCHIVED');
  assert.ok(res.body.archived_at);

  const stored = applications.find((a) => a.id === 'app-alice-active');
  assert.equal(stored.status, 'ARCHIVED');
});

test('2. Application Lifecycle: Non-owner receives 403 on archive attempt', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const bobToken = signToken({ id: 'user-bob', email: 'bob@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-alice-active/archive', {}, bobToken);

  assert.equal(res.status, 403);
  assert.match(res.body.error, /permission/i);
});

test('3. Application Lifecycle: Unauthenticated request receives 401', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const res = await request(server, 'POST', '/api/applications/app-alice-active/archive', {});
  assert.equal(res.status, 401);
});

test('4. Application Lifecycle: Baseline application cannot be archived (403)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-baseline/archive', {}, aliceToken);

  assert.equal(res.status, 403);
  assert.match(res.body.error, /baseline/i);
});

test('5. Application Lifecycle: Archived application cannot create deployment (409)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-archived',
      source_type: 'github_repo',
      source_reference: 'https://github.com/cloudport/sample-app',
      target_providers: ['local_k8s'],
    },
    aliceToken
  );

  assert.equal(res.status, 409);
  assert.match(res.body.error, /archived/i);
});

test('6. Application Lifecycle: Archived application cannot create experiment (409)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(
    server,
    'POST',
    '/api/analyzer/experiments',
    {
      name: 'Experiment on Archived App',
      applicationId: 'app-alice-archived',
      manifest: {
        application: { name: 'Alice App', version: '1.0.0' },
        workload: { type: 'storage' },
      },
    },
    aliceToken
  );

  assert.equal(res.status, 409);
  assert.match(res.body.error, /archived/i);
});

test('7. Application Lifecycle: Active deployment blocks archival with 409', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-alice-with-dep/archive', {}, aliceToken);

  assert.equal(res.status, 409);
  assert.match(res.body.error, /active deployment exists/i);
  assert.ok(Array.isArray(res.body.activeDeployments));
});

test('8. Application Lifecycle: Research history remains intact after archive', async (t) => {
  const { query, experiments, deployments } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const initialExpCount = experiments.length;
  const initialDepCount = deployments.length;

  const res = await request(server, 'POST', '/api/applications/app-alice-active/archive', {}, aliceToken);
  assert.equal(res.status, 200);

  // Verify no research or deployment records were deleted or altered
  assert.equal(experiments.length, initialExpCount);
  assert.equal(deployments.length, initialDepCount);
  const exp = experiments.find((e) => e.application_id === 'app-alice-active');
  assert.ok(exp, 'Research experiment history remained preserved');
});

test('9. Application Lifecycle: Owner can restore archived application', async (t) => {
  const { query, applications } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-alice-archived/restore', {}, aliceToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ACTIVE');
  assert.equal(res.body.archived_at, null);

  const stored = applications.find((a) => a.id === 'app-alice-archived');
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(stored.archived_at, null);
});

test('10. Application Lifecycle: Non-owner cannot restore archived application (403)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const bobToken = signToken({ id: 'user-bob', email: 'bob@cloudport.test', role: 'operator' });
  const res = await request(server, 'POST', '/api/applications/app-alice-archived/restore', {}, bobToken);

  assert.equal(res.status, 403);
  assert.match(res.body.error, /permission/i);
});

test('11. Application Lifecycle: Restoring does not alter historical experiments', async (t) => {
  const { query, experiments } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const expBefore = JSON.parse(JSON.stringify(experiments.find((e) => e.application_id === 'app-alice-archived')));

  const res = await request(server, 'POST', '/api/applications/app-alice-archived/restore', {}, aliceToken);
  assert.equal(res.status, 200);

  const expAfter = experiments.find((e) => e.application_id === 'app-alice-archived');
  assert.deepEqual(expBefore, expAfter, 'Historical experiments remained completely unaltered after restore');
});

test('12. Application Lifecycle: Hard deletion cannot destroy research applications (409), but empty applications can be deleted', async (t) => {
  const { query, applications } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // App with experiments cannot be permanently deleted
  const failRes = await request(server, 'DELETE', '/api/applications/app-alice-active', {}, aliceToken);
  assert.equal(failRes.status, 409);
  assert.match(failRes.body.error, /research history and cannot be permanently deleted/i);

  // App with deployments cannot be permanently deleted
  const depFailRes = await request(server, 'DELETE', '/api/applications/app-alice-with-dep', {}, aliceToken);
  assert.equal(depFailRes.status, 409);
  assert.match(depFailRes.body.error, /research history and cannot be permanently deleted/i);

  // App with no experiments or deployments CAN be deleted safely
  const okRes = await request(server, 'DELETE', '/api/applications/app-alice-empty', {}, aliceToken);
  assert.equal(okRes.status, 200);
  assert.match(okRes.body.message, /successfully deleted/i);
  assert.equal(applications.some((a) => a.id === 'app-alice-empty'), false);
});

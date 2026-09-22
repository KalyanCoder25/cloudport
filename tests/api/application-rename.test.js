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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-1',
      name: 'Alice Storefront',
      description: 'Alice app',
      framework: 'Node.js / Express',
      technology: 'NODE',
      owner_id: 'user-alice',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-2',
      name: 'Alice Payments',
      description: 'Alice payments service',
      framework: 'Go / Fiber',
      technology: 'GO',
      owner_id: 'user-alice',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'app-bob-1',
      name: 'Bob Analytics',
      description: 'Bob app',
      framework: 'Python / Flask',
      technology: 'PYTHON',
      owner_id: 'user-bob',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const experiments = [
    { id: 'exp-1', application_id: 'app-alice-1', name: 'Historical Experiment' },
  ];

  const deployments = [
    { id: 'dep-1', application_id: 'app-alice-1', target_provider: 'local_k8s', status: 'READY' },
  ];

  const query = async (sql, params = []) => {
    // User lookup for auth middleware
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      const u = users.find((x) => x.id === params[0]);
      return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
    }

    // Application lookup by id
    if (sql.includes('FROM applications WHERE id = $1')) {
      const app = applications.find((a) => a.id === params[0]);
      return { rowCount: app ? 1 : 0, rows: app ? [app] : [] };
    }

    // Check duplicate name for same owner
    if (sql.includes('SELECT id FROM applications WHERE owner_id = $1 AND LOWER(name) = LOWER($2) AND id != $3')) {
      const conflict = applications.find(
        (a) => a.owner_id === params[0] && a.name.toLowerCase() === params[1].toLowerCase() && a.id !== params[2]
      );
      return { rowCount: conflict ? 1 : 0, rows: conflict ? [conflict] : [] };
    }

    // Dynamic UPDATE applications
    if (sql.includes('UPDATE applications')) {
      const idParam = params[params.length - 1];
      const app = applications.find((a) => a.id === idParam);
      if (!app) return { rowCount: 0, rows: [] };

      // Parse update fields from SQL and params
      const setMatches = sql.match(/(\w+)\s*=\s*\$(\d+)/g);
      if (setMatches) {
        setMatches.forEach((m) => {
          const [col, pIdx] = m.split('=').map((s) => s.trim());
          const idx = parseInt(pIdx.replace('$', ''), 10) - 1;
          app[col] = params[idx];
        });
      }
      app.updated_at = new Date().toISOString();
      return { rowCount: 1, rows: [app] };
    }

    return { rowCount: 0, rows: [] };
  };

  return { query, applications, experiments, deployments };
}

test('Application Rename: Authentication & Input Validation', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // 1. Unauthenticated request rejected
  const unauthRes = await request(server, 'PATCH', '/api/applications/app-alice-1', { name: 'New Name' });
  assert.equal(unauthRes.status, 401);

  // 2. Empty name rejected
  const emptyNameRes = await request(server, 'PATCH', '/api/applications/app-alice-1', { name: '   ' }, aliceToken);
  assert.equal(emptyNameRes.status, 400);
  assert.match(emptyNameRes.body.error, /cannot be empty/i);
});

test('Application Rename: Baseline Application is Protected', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // Baseline application cannot be renamed
  const res = await request(
    server,
    'PATCH',
    '/api/applications/app-baseline',
    { name: 'Hacked Baseline' },
    aliceToken
  );
  assert.equal(res.status, 403);
  assert.match(res.body.error, /protected system baseline/i);
});

test('Application Rename: Authorization & Non-Owner Rejection (IDOR)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const bobToken = signToken({ id: 'user-bob', email: 'bob@cloudport.test', role: 'operator' });

  // Bob attempts to rename Alice's application
  const res = await request(
    server,
    'PATCH',
    '/api/applications/app-alice-1',
    { name: 'Bobs Stolen Storefront' },
    bobToken
  );
  assert.equal(res.status, 403);
  assert.match(res.body.error, /permission/i);
});

test('Application Rename: Owner successfully renames application while preserving ID & history', async (t) => {
  const { query, applications, experiments, deployments } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  const res = await request(
    server,
    'PATCH',
    '/api/applications/app-alice-1',
    { name: 'Alice Global Retail API', technology: 'NODE' },
    aliceToken
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'app-alice-1');
  assert.equal(res.body.name, 'Alice Global Retail API');

  // Verify application in DB is updated
  const updated = applications.find((a) => a.id === 'app-alice-1');
  assert.equal(updated.name, 'Alice Global Retail API');

  // Verify experiments and deployments history are preserved and unaffected
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0].application_id, 'app-alice-1');
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0].application_id, 'app-alice-1');
});

test('Application Rename: Duplicate name conflict for same owner is rejected', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // Alice tries to rename app-alice-1 to 'Alice Payments', which already exists for her
  const res = await request(
    server,
    'PATCH',
    '/api/applications/app-alice-1',
    { name: 'Alice Payments' },
    aliceToken
  );
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already have an application named/i);
});

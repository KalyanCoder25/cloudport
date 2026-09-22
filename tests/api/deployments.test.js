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
    { id: 'user-admin', email: 'admin@cloudport.test', display_name: 'Admin', role: 'admin' },
  ];

  const applications = [
    {
      id: 'app-baseline',
      name: 'CloudPort Core Research Suite',
      description: 'System baseline',
      framework: 'Research / Baseline',
      owner_id: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'app-alice-1',
      name: 'Alice Storefront',
      description: 'Alice app',
      framework: 'Node.js / Express',
      owner_id: 'user-alice',
      created_at: new Date().toISOString(),
    },
    {
      id: 'app-bob-1',
      name: 'Bob Analytics',
      description: 'Bob app',
      framework: 'Go / Fiber',
      owner_id: 'user-bob',
      created_at: new Date().toISOString(),
    },
  ];

  const deployments = [
    {
      id: 'dep-baseline-1',
      application_id: 'app-baseline',
      owner_id: 'user-admin',
      target_provider: 'local_k8s',
      target_environment: 'local',
      status: 'READY',
      source_type: 'GITHUB',
      source_reference: 'https://github.com/cloudport/cloudport',
      metadata: {},
      endpoint_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const query = async (sql, params = []) => {
    // User lookup for auth middleware
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      const u = users.find((x) => x.id === params[0]);
      return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
    }

    // Application lookup
    if (sql.includes('FROM applications WHERE id = $1')) {
      const app = applications.find((a) => a.id === params[0]);
      return { rowCount: app ? 1 : 0, rows: app ? [app] : [] };
    }

    // Applications list
    if (sql.includes('FROM applications a')) {
      return { rowCount: applications.length, rows: applications };
    }

    // Experiments lookup for app detail
    if (sql.includes('SELECT * FROM experiments WHERE application_id = $1')) {
      return { rowCount: 0, rows: [] };
    }

    // Insert deployment
    if (sql.includes('INSERT INTO deployments')) {
      const dep = {
        id: `dep-${deployments.length + 1}-${Date.now()}`,
        application_id: params[0],
        owner_id: params[1],
        target_provider: params[2],
        target_environment: params[3],
        status: 'DRAFT',
        source_type: params[4],
        source_reference: params[5],
        image_reference: params[6],
        metadata: JSON.parse(params[7] || '{}'),
        endpoint_url: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      deployments.push(dep);
      return { rowCount: 1, rows: [dep] };
    }

    // Select deployments for application
    if (sql.includes('SELECT * FROM deployments WHERE application_id = $1')) {
      const filtered = deployments.filter((d) => d.application_id === params[0]);
      return { rowCount: filtered.length, rows: filtered };
    }

    // Select deployment by id
    if (sql.includes('FROM deployments') && (sql.includes('WHERE d.id = $1') || sql.includes('WHERE id = $1'))) {
      const dep = deployments.find((d) => d.id === params[0]);
      if (!dep) return { rowCount: 0, rows: [] };
      const app = applications.find((a) => a.id === dep.application_id);
      return { rowCount: 1, rows: [{ ...dep, application_name: app ? app.name : null }] };
    }

    // List deployments
    if (sql.includes('FROM deployments d') && sql.includes('SELECT d.*')) {
      let filtered = [...deployments];
      if (sql.includes('d.owner_id = $1')) {
        filtered = filtered.filter((d) => d.owner_id === params[0]);
        if (params[1]) {
          filtered = filtered.filter((d) => d.application_id === params[1]);
        }
      } else if (params[0]) {
        filtered = filtered.filter((d) => d.application_id === params[0]);
      }
      return { rowCount: filtered.length, rows: filtered };
    }

    // Update deployment
    if (sql.includes('UPDATE deployments')) {
      const idParam = params[params.length - 1];
      const dep = deployments.find((d) => d.id === idParam);
      if (!dep) return { rowCount: 0, rows: [] };

      // Update fields
      if (sql.includes('status = $1')) {
        dep.status = params[0];
      }
      if (sql.includes("status = 'READY'")) {
        dep.status = 'READY';
      }
      if (sql.includes("status = 'STOPPED'")) {
        dep.status = 'STOPPED';
        dep.stopped_at = new Date().toISOString();
      }
      if (sql.includes("status = 'DELETED'")) {
        dep.status = 'DELETED';
        dep.deleted_at = new Date().toISOString();
        dep.endpoint_url = null;
      }
      if (sql.includes('endpoint_url = $2')) {
        dep.endpoint_url = params[1];
        dep.error_message = params[2];
      }
      dep.updated_at = new Date().toISOString();
      return { rowCount: 1, rows: [dep] };
    }

    return { rowCount: 0, rows: [] };
  };

  return { query, deployments, applications };
}

test('Deployments API: Authentication & Authorization Requirements', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  // 1. Unauthenticated requests must return 401
  const unauthList = await request(server, 'GET', '/api/deployments');
  assert.equal(unauthList.status, 401);

  const unauthCreate = await request(server, 'POST', '/api/deployments', {
    application_id: 'app-alice-1',
    target_providers: ['aws_eks'],
  });
  assert.equal(unauthCreate.status, 401);

  const unauthGet = await request(server, 'GET', '/api/deployments/dep-123');
  assert.equal(unauthGet.status, 401);
});

test('Deployments API: Baseline Protection & Input Validation', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // Baseline application protection: Cannot create deployments against baseline
  const baselineAttempt = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-baseline',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['aws_eks'],
    },
    aliceToken
  );
  assert.equal(baselineAttempt.status, 403);
  assert.match(baselineAttempt.body.error, /protected system baseline/i);

  // Invalid GitHub URL format rejected
  const invalidUrlAttempt = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://malicious.com/repo;rm -rf /',
      target_providers: ['aws_eks'],
    },
    aliceToken
  );
  assert.equal(invalidUrlAttempt.status, 400);
  assert.match(invalidUrlAttempt.body.error, /valid HTTPS GitHub repository URL/i);

  // Missing target providers rejected
  const missingTargetsAttempt = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: [],
    },
    aliceToken
  );
  assert.equal(missingTargetsAttempt.status, 400);
  assert.match(missingTargetsAttempt.body.error, /At least one target provider/i);
});

test('Deployments API: IDOR & Application Ownership Protection', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const bobToken = signToken({ id: 'user-bob', email: 'bob@cloudport.test', role: 'operator' });

  // Bob attempts to create deployment against Alice's application -> 403
  const idorCreate = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['aws_eks', 'gcp_gke'],
    },
    bobToken
  );
  assert.equal(idorCreate.status, 403);
  assert.match(idorCreate.body.error, /permission/i);

  // Alice successfully creates deployments for her application
  const aliceCreate = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['aws_eks', 'gcp_gke'],
    },
    aliceToken
  );
  assert.equal(aliceCreate.status, 201);
  assert.equal(aliceCreate.body.length, 2);
  const awsDep = aliceCreate.body.find((d) => d.target_provider === 'aws_eks');
  const gcpDep = aliceCreate.body.find((d) => d.target_provider === 'gcp_gke');
  assert.ok(awsDep);
  assert.ok(gcpDep);
  assert.equal(awsDep.status, 'DRAFT');
  assert.equal(gcpDep.status, 'DRAFT');

  // Bob attempts to view Alice's deployment via GET /api/deployments/:id -> 403
  const idorGet = await request(server, 'GET', `/api/deployments/${awsDep.id}`, null, bobToken);
  assert.equal(idorGet.status, 403);

  // Bob attempts to confirm or start Alice's deployment -> 403
  const idorConfirm = await request(server, 'POST', `/api/deployments/${awsDep.id}/confirm`, {}, bobToken);
  assert.equal(idorConfirm.status, 403);

  const idorStart = await request(server, 'POST', `/api/deployments/${awsDep.id}/start`, {}, bobToken);
  assert.equal(idorStart.status, 403);
});

test('Deployments API: Explicit Confirmation Lifecycle & Truthful Missing Credentials Block', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // 1. Create deployment
  const createRes = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['aws_eks'],
    },
    aliceToken
  );
  assert.equal(createRes.status, 201);
  const dep = createRes.body[0];
  assert.equal(dep.status, 'DRAFT');

  // 2. Starting unconfirmed deployment must fail
  const prematureStart = await request(server, 'POST', `/api/deployments/${dep.id}/start`, {}, aliceToken);
  assert.equal(prematureStart.status, 400);
  assert.match(prematureStart.body.error, /must be confirmed before starting/i);

  // 3. Confirm deployment
  const confirmRes = await request(
    server,
    'POST',
    `/api/deployments/${dep.id}/confirm`,
    { confirmed: true },
    aliceToken
  );
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.status, 'READY');

  // 4. Start deployment: because real AWS credentials and cluster are not provisioned,
  // provider must truthfully transition to BLOCKED_CREDENTIALS or BLOCKED_CONFIGURATION
  // and NEVER claim fake RUNNING.
  const startRes = await request(server, 'POST', `/api/deployments/${dep.id}/start`, {}, aliceToken);
  assert.equal(startRes.status, 200);
  assert.ok(
    startRes.body.status === 'BLOCKED_CREDENTIALS' ||
    startRes.body.status === 'BLOCKED_CONFIGURATION',
    `Expected blocked status but got ${startRes.body.status}`
  );
  assert.ok(startRes.body.error_message, 'Error message must explain blocked reason');
  assert.equal(startRes.body.endpoint_url, null, 'Must NOT fabricate endpoint URL');
});

test('Deployments API: Local Kubernetes Provider Execution', async (t) => {
  const { query } = createMockDb();

  // Mock local provider that simulates isolated namespace deployment
  const mockLocalProvider = {
    checkPrerequisites: async () => ({ ok: true, details: 'kind-korifi ready' }),
    deploy: async ({ deployment }) => ({
      status: 'RUNNING',
      endpointUrl: `http://storefront.cloudport.local:30080`,
      metadata: { namespace: 'cloudport', replicaCount: 1 },
    }),
    stop: async () => ({ status: 'STOPPED' }),
  };

  const app = createApp({
    query,
    deploymentProviders: {
      local_k8s: mockLocalProvider,
    },
  });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // Create local k8s deployment
  const createRes = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['local_k8s'],
    },
    aliceToken
  );
  assert.equal(createRes.status, 201);
  const dep = createRes.body[0];

  // Confirm
  await request(server, 'POST', `/api/deployments/${dep.id}/confirm`, { confirmed: true }, aliceToken);

  // Start
  const startRes = await request(server, 'POST', `/api/deployments/${dep.id}/start`, {}, aliceToken);
  assert.equal(startRes.status, 200);
  assert.equal(startRes.body.status, 'RUNNING');
  assert.equal(startRes.body.endpoint_url, 'http://storefront.cloudport.local:30080');

  // Stop
  const stopRes = await request(server, 'POST', `/api/deployments/${dep.id}/stop`, {}, aliceToken);
  assert.equal(stopRes.status, 200);
  assert.equal(stopRes.body.status, 'STOPPED');
});

test('Deployments API: Technology Detection Endpoint', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });

  // 1. Unauthenticated request rejected
  const unauth = await request(server, 'POST', '/api/deployments/detect-technology', {
    repository_url: 'https://github.com/expressjs/express',
  });
  assert.equal(unauth.status, 401);

  // 2. Missing repository_url rejected
  const missing = await request(server, 'POST', '/api/deployments/detect-technology', {}, aliceToken);
  assert.equal(missing.status, 400);

  // 3. Invalid repository URL rejected
  const invalid = await request(
    server,
    'POST',
    '/api/deployments/detect-technology',
    { repository_url: 'https://evil.com/not-github' },
    aliceToken
  );
  assert.equal(invalid.status, 400);
});

test('Deployments API: Delete Deployment with Provider Abstraction & History Preservation', async (t) => {
  const { query, applications } = createMockDb();
  let providerDeleted = false;

  const mockLocalProvider = {
    checkPrerequisites: async () => ({ ok: true, details: 'kind-korifi ready' }),
    deploy: async () => ({
      status: 'RUNNING',
      endpointUrl: 'http://storefront.cloudport.local:30080',
      metadata: { namespace: 'cloudport', replicaCount: 1 },
    }),
    stop: async () => ({ status: 'STOPPED' }),
    delete: async () => {
      providerDeleted = true;
      return { status: 'DELETED' };
    },
  };

  const app = createApp({
    query,
    deploymentProviders: {
      local_k8s: mockLocalProvider,
    },
  });
  const server = await startServer(app);
  t.after(() => server.close());

  const aliceToken = signToken({ id: 'user-alice', email: 'alice@cloudport.test', role: 'operator' });
  const bobToken = signToken({ id: 'user-bob', email: 'bob@cloudport.test', role: 'operator' });

  // Alice creates deployment
  const createRes = await request(
    server,
    'POST',
    '/api/deployments',
    {
      application_id: 'app-alice-1',
      source_type: 'github_repo',
      source_reference: 'https://github.com/GoogleCloudPlatform/microservices-demo',
      target_providers: ['local_k8s'],
    },
    aliceToken
  );
  assert.equal(createRes.status, 201);
  const dep = createRes.body[0];

  // Bob attempts to delete Alice's deployment -> 403 Forbidden
  const bobDelete = await request(
    server,
    'POST',
    `/api/deployments/${dep.id}/delete`,
    { confirm: true },
    bobToken
  );
  assert.equal(bobDelete.status, 403);
  assert.match(bobDelete.body.error, /permission/i);

  // Alice tries to delete without confirmation -> 400
  const unconfirmedDelete = await request(
    server,
    'POST',
    `/api/deployments/${dep.id}/delete`,
    { confirm: false },
    aliceToken
  );
  assert.equal(unconfirmedDelete.status, 400);
  assert.match(unconfirmedDelete.body.error, /confirmation/i);

  // Alice deletes with confirmation
  const aliceDelete = await request(
    server,
    'POST',
    `/api/deployments/${dep.id}/delete`,
    { confirm: true },
    aliceToken
  );
  assert.equal(aliceDelete.status, 200);
  assert.equal(aliceDelete.body.status, 'DELETED');
  assert.equal(providerDeleted, true, 'Provider delete() must have been called');

  // Verify application itself is NOT deleted
  const parentApp = applications.find((a) => a.id === 'app-alice-1');
  assert.ok(parentApp, 'Application must be preserved when deployment is deleted');
});

test('Deployments API: Baseline Deployment cannot be deleted (Forbidden 403)', async (t) => {
  const { query } = createMockDb();
  const app = createApp({ query });
  const server = await startServer(app);
  t.after(() => server.close());

  const adminToken = signToken({ id: 'user-admin', email: 'admin@cloudport.test', role: 'admin' });

  const res = await request(
    server,
    'POST',
    '/api/deployments/dep-baseline-1/delete',
    { confirm: true },
    adminToken
  );
  assert.equal(res.status, 403);
  assert.match(res.body.error, /baseline application/i);
});

test('Deployments API: Local Kubernetes Provider refuses to claim RUNNING or return backend port 4000 when workload unverified', async () => {
  const { LocalKubernetesProvider } = require('../../application/backend/src/deployments/deploymentProviders');
  const provider = new LocalKubernetesProvider();
  const child_process = require('child_process');
  const https = require('https');
  const EventEmitter = require('events');
  const originalExecSync = child_process.execSync;
  const originalHttpsGet = https.get;

  try {
    // Korifi reports the app as STARTED, but its route never answers.
    child_process.execSync = (cmd) => {
      if (cmd.includes('/v3/apps')) {
        return Buffer.from(JSON.stringify({ resources: [{ guid: 'a1', state: 'STARTED' }] }));
      }
      if (cmd.includes('kubectl config get-contexts')) return Buffer.from('kind-korifi');
      return Buffer.from('');
    };
    https.get = (_url, _opts, _cb) => {
      const req = new EventEmitter();
      req.destroy = () => {};
      setImmediate(() => req.emit('error', new Error('unreachable')));
      return req;
    };

    const deployment = {
      id: 'unverified-1111',
      source_reference: 'https://github.com/test/repo',
      metadata: { appName: 'unverified-app' },
    };

    const result = await provider.getStatus(deployment);

    assert.notEqual(result.status, 'RUNNING');
    assert.equal(result.ready, false);
    assert.equal(result.endpointUrl, null);
    assert.notEqual(result.endpointUrl, 'http://localhost:4000');
  } finally {
    child_process.execSync = originalExecSync;
    https.get = originalHttpsGet;
  }
});



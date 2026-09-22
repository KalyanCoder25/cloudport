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

// Mock fixtures
const userA = { id: 'user-a-uuid', email: 'alice@example.com', display_name: 'Alice', role: 'operator' };
const userB = { id: 'user-b-uuid', email: 'bob@example.com', display_name: 'Bob', role: 'operator' };
const adminUser = { id: 'admin-uuid', email: 'operator@cloudport.local', display_name: 'Operator', role: 'admin' };

const appA = { id: 'app-a-uuid', name: 'Alice Service', owner_id: userA.id, framework: 'Node.js' };
const appB = { id: 'app-b-uuid', name: 'Bob Service', owner_id: userB.id, framework: 'Go' };
const appBaseline = { id: 'app-baseline-uuid', name: 'CloudPort Core Research Suite', owner_id: adminUser.id, framework: 'Node.js' };

const expA = { id: 'exp-a-uuid', name: 'Alice Exp', created_by: userA.id, application_id: appA.id };
const expBaseline = { id: 'exp-base-uuid', name: 'Baseline Exp', created_by: adminUser.id, application_id: appBaseline.id };

function createMockQuery() {
  const users = [userA, userB, adminUser];
  const applications = [appA, appB, appBaseline];
  const experiments = [expA, expBaseline];

  return async (sql, params = []) => {
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      const u = users.find((x) => x.id === params[0]);
      return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
    }
    if (sql.includes('SELECT * FROM applications WHERE id = $1') || sql.includes('SELECT id, name, owner_id FROM applications WHERE id = $1')) {
      const a = applications.find((x) => x.id === params[0]);
      return { rowCount: a ? 1 : 0, rows: a ? [a] : [] };
    }
    if (sql.includes('SELECT * FROM experiments WHERE application_id = $1')) {
      const rows = experiments.filter((e) => e.application_id === params[0]);
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('SELECT id FROM applications WHERE owner_id = $1 AND name = $2')) {
      const found = applications.find((x) => x.owner_id === params[0] && x.name === params[1]);
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }
    if (sql.includes('INSERT INTO applications')) {
      const created = { id: 'new-app-id', name: params[0], description: params[1], framework: params[3], owner_id: params[4] };
      applications.push(created);
      return { rowCount: 1, rows: [created] };
    }
    if (sql.includes('INSERT INTO experiments')) {
      const created = { id: 'new-exp-id', name: params[0], application_id: params[11], created_by: params[10] };
      experiments.push(created);
      return { rowCount: 1, rows: [created] };
    }
    return { rowCount: 0, rows: [] };
  };
}

test('Security Audit: Unauthenticated access to protected endpoints is rejected', async () => {
  const app = createApp({ query: createMockQuery() });
  const server = await startServer(app);
  try {
    // 1. GET /api/auth/me without token -> 401
    const meRes = await request(server, 'GET', '/api/auth/me');
    assert.equal(meRes.status, 401);

    // 2. POST /api/applications without token -> 401
    const appCreateRes = await request(server, 'POST', '/api/applications', { name: 'Rogue App' });
    assert.equal(appCreateRes.status, 401);

    // 3. POST /api/analyzer/experiments without token -> 401
    const expCreateRes = await request(server, 'POST', '/api/analyzer/experiments', {
      name: 'Rogue Exp',
      manifest: { invariants: {} },
    });
    assert.equal(expCreateRes.status, 401);

    // 4. GET /api/applications/:id for private app without token -> 401
    const privateAppRes = await request(server, 'GET', `/api/applications/${appA.id}`);
    assert.equal(privateAppRes.status, 401);
  } finally {
    server.close();
  }
});

test('Security Audit: Invalid, tampered, or expired tokens are rejected', async () => {
  const app = createApp({ query: createMockQuery() });
  const server = await startServer(app);
  try {
    // 1. Malformed token
    const malformed = await request(server, 'GET', '/api/auth/me', null, 'not.a.valid.jwt.token');
    assert.equal(malformed.status, 401);

    // 2. Valid token signed by different secret or tampered
    const validToken = signToken(userA);
    const parts = validToken.split('.');
    // Tamper payload to change user ID to admin
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: adminUser.id, role: 'admin', exp: Date.now() + 10000 })).toString('base64url');
    const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const forgedRes = await request(server, 'GET', '/api/auth/me', null, forgedToken);
    assert.equal(forgedRes.status, 401);

    // 3. Expired token
    const expiredPayload = Buffer.from(JSON.stringify({ sub: userA.id, role: 'operator', exp: Date.now() - 1000 })).toString('base64url');
    const crypto = require('crypto');
    const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'cloudport-deterministic-secret-key-for-local-dev';
    const expiredSig = crypto.createHmac('sha256', secret).update(`${parts[0]}.${expiredPayload}`).digest('base64url');
    const expiredToken = `${parts[0]}.${expiredPayload}.${expiredSig}`;

    const expiredRes = await request(server, 'GET', '/api/auth/me', null, expiredToken);
    assert.equal(expiredRes.status, 401);
  } finally {
    server.close();
  }
});

test('Security Audit: IDOR Prevention - User B cannot access User A private application or experiments', async () => {
  const app = createApp({ query: createMockQuery() });
  const server = await startServer(app);
  try {
    const tokenA = signToken(userA);
    const tokenB = signToken(userB);

    // User A can access own application
    const resA = await request(server, 'GET', `/api/applications/${appA.id}`, null, tokenA);
    assert.equal(resA.status, 200);
    assert.equal(resA.body.application.id, appA.id);

    // User B CANNOT access User A's private application -> 403 Forbidden
    const resB = await request(server, 'GET', `/api/applications/${appA.id}`, null, tokenB);
    assert.equal(resB.status, 403);
    assert.match(resB.body.error, /Forbidden/);

    // User B CANNOT query experiments of User A's private application -> 403 Forbidden
    const expQueryB = await request(server, 'GET', `/api/analyzer/experiments?application_id=${appA.id}`, null, tokenB);
    assert.equal(expQueryB.status, 403);
    assert.match(expQueryB.body.error, /Forbidden/);
  } finally {
    server.close();
  }
});

test('Security Audit: Cross-User Experiment Attachment Prevention', async () => {
  const app = createApp({ query: createMockQuery() });
  const server = await startServer(app);
  try {
    const tokenB = signToken(userB);

    // User B attempts to attach an experiment to User A's application -> 403 Forbidden
    const crossAttach = await request(
      server,
      'POST',
      '/api/analyzer/experiments',
      {
        name: 'Malicious Injected Experiment',
        applicationId: appA.id,
        manifest: { invariants: {} },
      },
      tokenB
    );
    assert.equal(crossAttach.status, 403);
    assert.match(crossAttach.body.error, /cannot attach experiments to an application you do not own/);

    // User B attempts to attach an experiment to the system baseline application -> 403 Forbidden
    const baselineAttach = await request(
      server,
      'POST',
      '/api/analyzer/experiments',
      {
        name: 'Unauthorized Baseline Mod',
        applicationId: appBaseline.id,
        manifest: { invariants: {} },
      },
      tokenB
    );
    assert.equal(baselineAttach.status, 403);
    assert.match(baselineAttach.body.error, /cannot attach experiments to the system baseline application/);
  } finally {
    server.close();
  }
});

test('Security Audit: System Baseline Protection and Public Access', async () => {
  const app = createApp({ query: createMockQuery() });
  const server = await startServer(app);
  try {
    const tokenA = signToken(userA);
    const tokenB = signToken(userB);

    // Both User A and User B can access the system baseline application
    const resA = await request(server, 'GET', `/api/applications/${appBaseline.id}`, null, tokenA);
    assert.equal(resA.status, 200);
    assert.equal(resA.body.application.name, 'CloudPort Core Research Suite');

    const resB = await request(server, 'GET', `/api/applications/${appBaseline.id}`, null, tokenB);
    assert.equal(resB.status, 200);

    // Unauthenticated user can view the public baseline application
    const unauthBase = await request(server, 'GET', `/api/applications/${appBaseline.id}`);
    assert.equal(unauthBase.status, 200);

    // Non-admin user cannot register an application named 'CloudPort Core Research Suite'
    const spoofRes = await request(
      server,
      'POST',
      '/api/applications',
      { name: 'CloudPort Core Research Suite' },
      tokenA
    );
    assert.equal(spoofRes.status, 400);
    assert.match(spoofRes.body.error, /reserved for system baselines/);
  } finally {
    server.close();
  }
});

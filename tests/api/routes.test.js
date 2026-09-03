'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../application/backend/src/app');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function request(server, method, path, body) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
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

test('GET / returns backend service descriptor without touching the database', async () => {
  const app = createApp({ query: async () => { throw new Error('should not be called'); } });
  const server = await startServer(app);
  try {
    const res = await request(server, 'GET', '/');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      service: 'cloudport-backend',
      version: 'cloudport:1.0.0',
      health: '/health',
      api: '/api/analyzer/experiments',
    });
  } finally {
    server.close();
  }
});

test('GET /health returns ok without touching the database', async () => {
  const app = createApp({ query: async () => { throw new Error('should not be called'); } });
  const server = await startServer(app);
  try {
    const res = await request(server, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  } finally {
    server.close();
  }
});

test('GET /api/analyzer/experiments/:id returns 404 for unknown id', async () => {
  const app = createApp({ query: async () => ({ rows: [], rowCount: 0 }) });
  const server = await startServer(app);
  try {
    const res = await request(server, 'GET', '/api/analyzer/experiments/00000000-0000-0000-0000-000000000000');
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('POST /run without confirm=true returns 428 and does not mutate status', async () => {
  const experiment = { id: 'exp-1', status: 'READY_FOR_EXECUTION' };
  let updateCalled = false;
  const app = createApp({
    query: async (sql) => {
      if (/SELECT \* FROM experiments WHERE id/.test(sql)) return { rows: [experiment], rowCount: 1 };
      if (/UPDATE experiments/.test(sql)) {
        updateCalled = true;
        return { rowCount: 1 };
      }
      throw new Error('unexpected query: ' + sql);
    },
  });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-1/run', {});
    assert.equal(res.status, 428);
    assert.equal(updateCalled, false);
  } finally {
    server.close();
  }
});

test('POST /run with confirm=true on a READY_FOR_EXECUTION experiment transitions to RUNNING', async () => {
  const experiment = { id: 'exp-1', status: 'READY_FOR_EXECUTION' };
  let updateCalled = false;
  const app = createApp({
    query: async (sql) => {
      if (/SELECT \* FROM experiments WHERE id/.test(sql)) return { rows: [experiment], rowCount: 1 };
      if (/UPDATE experiments/.test(sql)) {
        updateCalled = true;
        return { rowCount: 1 };
      }
      throw new Error('unexpected query: ' + sql);
    },
  });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-1/run', { confirm: true });
    assert.equal(res.status, 202);
    assert.equal(updateCalled, true);
  } finally {
    server.close();
  }
});

test('POST /run refuses execution when experiment is not READY_FOR_EXECUTION', async () => {
  const experiment = { id: 'exp-1', status: 'DRAFT' };
  const app = createApp({
    query: async (sql) => {
      if (/SELECT \* FROM experiments WHERE id/.test(sql)) return { rows: [experiment], rowCount: 1 };
      throw new Error('unexpected query: ' + sql);
    },
  });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-1/run', { confirm: true });
    assert.equal(res.status, 409);
  } finally {
    server.close();
  }
});

test('POST /api/workload/run executes a real deterministic workload', async () => {
  const app = createApp({ query: async () => ({ rows: [], rowCount: 0 }) });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/workload/run', { seed: 7, concurrency: 2, operationCount: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.requestCount, 10);
  } finally {
    server.close();
  }
});

test('POST /api/workload/run uses CLOUDPORT_STORAGE_MOUNT as scratchDir when configured, and reports storageMountConfigured=true', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-route-mount-'));
  process.env.CLOUDPORT_STORAGE_MOUNT = mountDir;

  const app = createApp({ query: async () => ({ rows: [], rowCount: 0 }) });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/workload/run', { seed: 3, concurrency: 2, operationCount: 6 });
    assert.equal(res.status, 200);
    assert.equal(res.body.scratchDir, mountDir);
    assert.equal(res.body.storageMountConfigured, true);
    const filesInMount = fs.readdirSync(mountDir);
    assert.ok(filesInMount.length > 0, 'expected the route to have actually written into the configured storage mount');
  } finally {
    delete process.env.CLOUDPORT_STORAGE_MOUNT;
    server.close();
  }
});

test('POST /api/workload/run reports storageMountConfigured=false and falls back to OS temp when CLOUDPORT_STORAGE_MOUNT is unset', async () => {
  delete process.env.CLOUDPORT_STORAGE_MOUNT;
  const app = createApp({ query: async () => ({ rows: [], rowCount: 0 }) });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/workload/run', { seed: 3, concurrency: 1, operationCount: 4 });
    assert.equal(res.status, 200);
    assert.equal(res.body.storageMountConfigured, false);
    assert.ok(/cloudport-workload-/.test(res.body.scratchDir));
  } finally {
    server.close();
  }
});

test('POST /api/workload/run produces identical operation counts regardless of INFRA_IDENTITY, given the same seed/config and mount', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  async function runWithIdentity(identity) {
    const mountDir = fs.mkdtempSync(path.join(os.tmpdir(), `cp-identity-${identity}-`));
    process.env.CLOUDPORT_STORAGE_MOUNT = mountDir;
    process.env.INFRA_IDENTITY = identity;
    const app = createApp({ query: async () => ({ rows: [], rowCount: 0 }) });
    const server = await startServer(app);
    try {
      return await request(server, 'POST', '/api/workload/run', { seed: 99, concurrency: 3, operationCount: 12 });
    } finally {
      server.close();
    }
  }

  const resA = await runWithIdentity('infrastructure-a');
  const resB = await runWithIdentity('infrastructure-b');
  delete process.env.CLOUDPORT_STORAGE_MOUNT;
  delete process.env.INFRA_IDENTITY;

  assert.equal(resA.body.requestCount, resB.body.requestCount);
  assert.equal(resA.body.successCount, resB.body.successCount);
  assert.equal(resA.body.failureCount, resB.body.failureCount);
  assert.equal(resA.body.latenciesMs.length, resB.body.latenciesMs.length);
  // The reported identity differs (provenance only)...
  assert.equal(resA.body.infrastructureIdentity, 'infrastructure-a');
  assert.equal(resB.body.infrastructureIdentity, 'infrastructure-b');
  // ...but the workload plan itself must not have been altered by it.
});

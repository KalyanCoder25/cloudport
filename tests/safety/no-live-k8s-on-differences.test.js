'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../application/backend/src/app');
const { InfrastructureInspector } = require('../../analyzer/infrastructure/inspector');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || 'null') }));
      })
      .on('error', reject);
  });
}

test('GET /differences uses persisted evidence only, never touches live InfrastructureInspector, and responds under 1000ms', async () => {
  // Spy on captureSnapshot; fail the test if it is ever invoked.
  let captureSnapshotCalled = false;
  const originalCaptureSnapshot = InfrastructureInspector.prototype.captureSnapshot;
  InfrastructureInspector.prototype.captureSnapshot = async function spy(...args) {
    captureSnapshotCalled = true;
    return originalCaptureSnapshot.apply(this, args);
  };

  const fakeRows = [
    { dimension: 'Storage', difference_found: true, detail: {} },
    { dimension: 'Platform', difference_found: false, detail: {} },
  ];

  // Fake DB: query() resolves instantly from an in-memory fixture. It must be
  // the ONLY data source this route touches.
  const fakeQuery = async (sql) => {
    if (/FROM infrastructure_differences/.test(sql)) {
      return { rows: fakeRows, rowCount: fakeRows.length };
    }
    throw new Error(`Unexpected query in this test: ${sql}`);
  };

  const app = createApp({ query: fakeQuery });
  const server = await startServer(app);

  try {
    const start = Date.now();
    const res = await get(server, '/api/analyzer/experiments/11111111-1111-1111-1111-111111111111/differences');
    const elapsedMs = Date.now() - start;

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, fakeRows);
    assert.ok(elapsedMs < 1000, `expected < 1000ms, got ${elapsedMs}ms`);
    assert.equal(captureSnapshotCalled, false, 'InfrastructureInspector.captureSnapshot must NOT be called by this route');
  } finally {
    InfrastructureInspector.prototype.captureSnapshot = originalCaptureSnapshot;
    server.close();
  }
});

test('constructing an InfrastructureInspector does not open a live client', () => {
  let clientFactoryCalled = false;
  const inspector = new InfrastructureInspector({
    clientFactory: () => {
      clientFactoryCalled = true;
      return {};
    },
  });
  assert.ok(inspector); // constructed successfully
  assert.equal(clientFactoryCalled, false, 'clientFactory must not run until captureSnapshot() is called');
});

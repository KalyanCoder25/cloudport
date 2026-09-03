'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../application/backend/src/app');
const { canonicalChecksum } = require('../../analyzer/evidence/checksum');

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

test('POST /api/analyzer/experiments/:id/validate runs parity validation and returns result', async () => {
  let validateParityCalled = false;
  const mockRunner = {
    validateParity: async (id) => {
      validateParityCalled = true;
      return { status: 'READY_FOR_EXECUTION', parityValidated: true };
    },
    executeExperiment: async () => {},
  };

  const app = createApp({
    query: async () => ({ rows: [], rowCount: 0 }),
    experimentRunner: mockRunner,
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-123/validate', {});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'READY_FOR_EXECUTION');
    assert.equal(res.body.parityValidated, true);
    assert.equal(validateParityCalled, true);
  } finally {
    server.close();
  }
});

test('POST /api/analyzer/experiments/:id/validate returns 422 when validation fails', async () => {
  const mockRunner = {
    validateParity: async (id) => ({
      status: 'FAILED_VALIDATION',
      parityValidated: false,
      reason: 'Unexpected difference in Platform',
    }),
  };

  const app = createApp({
    query: async () => ({ rows: [], rowCount: 0 }),
    experimentRunner: mockRunner,
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-123/validate', {});
    assert.equal(res.status, 422);
    assert.equal(res.body.status, 'FAILED_VALIDATION');
    assert.equal(res.body.parityValidated, false);
  } finally {
    server.close();
  }
});

test('POST /api/analyzer/experiments/:id/run triggers runner.executeExperiment and responds 202', async () => {
  const experiment = { id: 'exp-run-test', status: 'READY_FOR_EXECUTION' };
  let executeCalled = false;

  const mockRunner = {
    executeExperiment: async (id) => {
      executeCalled = true;
      return { status: 'COMPLETED' };
    },
  };

  const app = createApp({
    query: async (sql) => {
      if (/SELECT \* FROM experiments WHERE id/.test(sql)) return { rows: [experiment], rowCount: 1 };
      if (/UPDATE experiments/.test(sql)) return { rowCount: 1 };
      throw new Error('unexpected query: ' + sql);
    },
    experimentRunner: mockRunner,
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/exp-run-test/run', { confirm: true });
    assert.equal(res.status, 202);
    assert.equal(res.body.status, 'RUNNING');
    assert.equal(res.body.experimentId, 'exp-run-test');
    assert.equal(executeCalled, true);
  } finally {
    server.close();
  }
});

test('POST /api/analyzer/experiments/:id/validate returns 404 for non-existent experiment', async () => {
  const mockRunner = {
    validateParity: async () => {
      throw new Error('Experiment non-existent-id not found');
    },
  };

  const app = createApp({
    query: async () => ({ rows: [], rowCount: 0 }),
    experimentRunner: mockRunner,
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/non-existent-id/validate', {});
    assert.equal(res.status, 404);
    assert.ok(/not found/i.test(res.body.error));
  } finally {
    server.close();
  }
});

test('POST /api/analyzer/experiments/:id/run returns 404 for non-existent experiment', async () => {
  const app = createApp({
    query: async () => ({ rows: [], rowCount: 0 }),
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'POST', '/api/analyzer/experiments/non-existent-id/run', { confirm: true });
    assert.equal(res.status, 404);
    assert.ok(/not found/i.test(res.body.error));
  } finally {
    server.close();
  }
});

test('POST /api/analyzer/experiments/:id/run returns 409 for experiment already RUNNING, COMPLETED, FAILED_VALIDATION, or ABORTED', async () => {
  const nonExecutableStatuses = ['RUNNING', 'COMPLETED', 'FAILED_VALIDATION', 'ABORTED', 'DRAFT'];

  for (const status of nonExecutableStatuses) {
    const experiment = { id: `exp-${status}`, status };
    const app = createApp({
      query: async (sql) => {
        if (/SELECT \* FROM experiments WHERE id/.test(sql)) return { rows: [experiment], rowCount: 1 };
        throw new Error('unexpected query: ' + sql);
      },
    });
    const server = await startServer(app);

    try {
      const res = await request(server, 'POST', `/api/analyzer/experiments/exp-${status}/run`, { confirm: true });
      assert.equal(res.status, 409, `Expected 409 for status ${status}`);
      assert.ok(res.body.error.includes(status));
    } finally {
      server.close();
    }
  }
});

test('GET /api/analyzer/experiments/:id/telemetry returns telemetry joined with trial data', async () => {
  const fakeRows = [
    { id: 'telem-1', trial_id: 't-1', trial_index: 1, infrastructure: 'A', p50_ms: 1.2 },
    { id: 'telem-2', trial_id: 't-2', trial_index: 1, infrastructure: 'B', p50_ms: 1.4 },
  ];
  const app = createApp({
    query: async (sql) => {
      if (/FROM telemetry t/.test(sql)) return { rows: fakeRows, rowCount: 2 };
      throw new Error('unexpected query: ' + sql);
    },
  });
  const server = await startServer(app);

  try {
    const res = await request(server, 'GET', '/api/analyzer/experiments/exp-telem-test/telemetry');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].infrastructure, 'A');
    assert.equal(res.body[1].infrastructure, 'B');
  } finally {
    server.close();
  }
});

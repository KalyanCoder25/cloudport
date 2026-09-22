'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pairedTTest, checkNormality } = require('../../analyzer/telemetry/scipyStatsClient');
const { pairedTTest: pairedTTestJs } = require('../../analyzer/telemetry/statisticalTests');

const A = [100, 102, 98, 101, 99, 103];
const B = [110, 111, 108, 112, 109, 113];

test('scipyStatsClient.pairedTTest falls back to the JS engine when no service is configured', async () => {
  const result = await pairedTTest(A, B, 0.05, { serviceUrl: null });
  assert.equal(result.engine, 'javascript');
  const direct = pairedTTestJs(A, B);
  assert.equal(result.significant, direct.significant);
  assert.equal(result.n, direct.n);
});

test('scipyStatsClient.pairedTTest uses the service result verbatim when reachable', async () => {
  const scipyResponse = {
    engine: 'scipy',
    interpretation: 'STATISTICALLY_SIGNIFICANT',
    significance: 'STATISTICALLY_SIGNIFICANT',
    n: 6,
    meanDelta: 10,
    pValue: 0.0001,
    significant: true,
  };
  let calledPath = null;
  let calledBody = null;
  const fetchJson = async (baseUrl, path, body) => {
    calledPath = path;
    calledBody = body;
    assert.equal(baseUrl, 'http://stats:8090');
    return scipyResponse;
  };

  const result = await pairedTTest(A, B, 0.05, { serviceUrl: 'http://stats:8090', fetchJson });

  assert.equal(calledPath, '/paired-ttest');
  assert.deepEqual(calledBody, { valuesA: A, valuesB: B, alpha: 0.05 });
  assert.deepEqual(result, scipyResponse);
});

test('scipyStatsClient.pairedTTest falls back to JS and records the reason when the service errors', async () => {
  const fetchJson = async () => {
    throw new Error('ECONNREFUSED');
  };

  const result = await pairedTTest(A, B, 0.05, { serviceUrl: 'http://stats:8090', fetchJson });

  assert.equal(result.engine, 'javascript');
  assert.equal(result.serviceFallbackReason, 'ECONNREFUSED');
});

test('scipyStatsClient.checkNormality returns null when no service is configured (never fabricates)', async () => {
  const result = await checkNormality(A, B, { serviceUrl: null });
  assert.equal(result, null);
});

test('scipyStatsClient.checkNormality returns null (not a fabricated result) when the service errors', async () => {
  const fetchJson = async () => {
    throw new Error('timeout');
  };
  const result = await checkNormality(A, B, { serviceUrl: 'http://stats:8090', fetchJson });
  assert.equal(result, null);
});

test('scipyStatsClient.checkNormality calls the service when configured and reachable', async () => {
  const scipyResponse = { engine: 'scipy', interpretation: 'CONSISTENT_WITH_NORMAL', n: 6, pValue: 0.8 };
  let calledPath = null;
  const fetchJson = async (baseUrl, path) => {
    calledPath = path;
    return scipyResponse;
  };
  const result = await checkNormality(A, B, { serviceUrl: 'http://stats:8090', fetchJson });
  assert.equal(calledPath, '/normality');
  assert.deepEqual(result, scipyResponse);
});

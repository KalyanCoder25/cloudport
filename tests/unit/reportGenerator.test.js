'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReport } = require('../../analyzer/evidence/reportGenerator');

test('unexecuted experiment produces a PRE-EXECUTION report with no fabricated telemetry', () => {
  const report = generateReport({
    experiment: {
      name: 'storage-isolation-replicated-v1',
      description: 'Test experiment',
      targetDimension: 'STORAGE',
      replicationCount: 3,
      controlledVariable: 'STORAGE',
      excludedDimensions: ['NETWORK', 'CPU', 'MEMORY', 'APPLICATION', 'WORKLOAD'],
      applicationVersion: 'cloudport:1.0.0',
      workload: { type: 'STORAGE', concurrency: 5, operationCount: 200, prngSeed: 987654 },
    },
    executed: false,
  });

  assert.ok(report.includes('PRE-EXECUTION / READY FOR REPLICATED EXPERIMENT'));
  assert.ok(report.includes('NOT AVAILABLE'));
  assert.ok(!/\d+\.\d+ ?ms/.test(report), 'must not contain fabricated latency figures');
});

test('report includes all 20 required sections', () => {
  const report = generateReport({
    experiment: {
      name: 'x',
      targetDimension: 'STORAGE',
      controlledVariable: 'STORAGE',
      excludedDimensions: [],
      applicationVersion: 'cloudport:1.0.0',
      workload: {},
    },
    executed: false,
  });
  for (let i = 1; i <= 20; i += 1) {
    assert.ok(report.includes(`## ${i}. `), `missing section ${i}`);
  }
});

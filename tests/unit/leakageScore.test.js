'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLeakageScore, RUBRIC_WEIGHTS } = require('../../analyzer/leakage/leakageScore');

test('rubric weights sum to 100', () => {
  const total = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
});

test('zero evidence yields score 0 / NO_EVIDENCE band', () => {
  const result = computeLeakageScore({
    infrastructureDifferenceDetected: false,
    applicationVisibleCorrelation: false,
    largestMeaningfulPercentChange: 0,
    replicationClassification: 'INSUFFICIENT_REPLICATION',
  });
  assert.equal(result.score, 0);
  assert.equal(result.band, 'NO_EVIDENCE');
});

test('full evidence with confirmed replication yields HIGH band', () => {
  const result = computeLeakageScore({
    infrastructureDifferenceDetected: true,
    applicationVisibleCorrelation: true,
    largestMeaningfulPercentChange: 80,
    replicationClassification: 'CONFIRMED_REPLICATED',
  });
  assert.equal(result.band, 'HIGH');
  assert.ok(result.score > 60);
});

test('score is reproducible from the same input', () => {
  const input = {
    infrastructureDifferenceDetected: true,
    applicationVisibleCorrelation: false,
    largestMeaningfulPercentChange: 20,
    replicationClassification: 'VARIABLE_REPLICATION',
  };
  const r1 = computeLeakageScore(input);
  const r2 = computeLeakageScore(input);
  assert.deepEqual(r1, r2);
});

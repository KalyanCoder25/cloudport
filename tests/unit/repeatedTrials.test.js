'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRepeatedTrials } = require('../../analyzer/behaviour/repeatedTrials');

test('single trial always yields INSUFFICIENT_REPLICATION', () => {
  const result = analyzeRepeatedTrials([10], [15]);
  assert.equal(result.classification, 'INSUFFICIENT_REPLICATION');
  assert.equal(result.trialCount, 1);
});

test('consistent directional deltas with low variance -> CONFIRMED_REPLICATED', () => {
  const a = [100, 102, 98, 101];
  const b = [150, 151, 149, 150]; // consistently higher, low variance in delta
  const result = analyzeRepeatedTrials(a, b);
  assert.equal(result.classification, 'CONFIRMED_REPLICATED');
  assert.equal(result.trialCount, 4);
  assert.equal(result.directionalConsistency, 1);
});

test('inconsistent directions -> VARIABLE_REPLICATION', () => {
  const a = [100, 100, 100, 100];
  const b = [110, 90, 105, 95]; // deltas alternate sign
  const result = analyzeRepeatedTrials(a, b);
  assert.equal(result.classification, 'VARIABLE_REPLICATION');
});

test('mismatched array lengths throw', () => {
  assert.throws(() => analyzeRepeatedTrials([1, 2], [1]));
});

test('all-zero deltas are perfectly directionally consistent', () => {
  const result = analyzeRepeatedTrials([50, 50, 50], [50, 50, 50]);
  assert.equal(result.directionalConsistency, 1);
});

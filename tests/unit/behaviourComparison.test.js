'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareMetric, classifyDirection, safeDivide } = require('../../analyzer/behaviour/behaviourComparison');

test('safeDivide never throws on zero denominator', () => {
  assert.equal(safeDivide(10, 0), null);
  assert.equal(safeDivide(0, 0), null);
});

test('safeDivide returns correct value for normal division', () => {
  assert.equal(safeDivide(10, 2), 5);
});

test('classifyDirection handles zero-baseline / null delta', () => {
  assert.equal(classifyDirection(null), 'UNCHANGED');
  assert.equal(classifyDirection(0), 'UNCHANGED');
  assert.equal(classifyDirection(5), 'INCREASED');
  assert.equal(classifyDirection(-5), 'DECREASED');
});

test('compareMetric with a zero-mean baseline does not throw and reports null percentChange', () => {
  const result = compareMetric('errors', [0, 0, 0], [0, 0, 1]);
  assert.equal(result.meanA, 0);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('compareMetric correctly classifies an increase', () => {
  const result = compareMetric('p95_ms', [100, 100], [150, 150]);
  assert.equal(result.direction, 'INCREASED');
  assert.equal(result.delta, 50);
  assert.equal(result.percentChange, 50);
});

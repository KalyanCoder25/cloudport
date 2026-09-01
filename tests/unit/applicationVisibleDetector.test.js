'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectApplicationVisibleDifferences } = require('../../analyzer/behaviour/applicationVisibleDetector');

test('no infra difference -> NO_INFRASTRUCTURE_DIFFERENCE, never app-visible', () => {
  const diffs = [{ dimension: 'Storage', differenceFound: false }];
  const result = detectApplicationVisibleDifferences(diffs, []);
  assert.equal(result.classification, 'NO_INFRASTRUCTURE_DIFFERENCE');
  assert.equal(result.applicationVisible, false);
});

test('infra difference with no meaningful metric shift -> INFRASTRUCTURE_DIFFERENCE_ONLY', () => {
  const diffs = [{ dimension: 'Storage', differenceFound: true }];
  const comparisons = [{ metric: 'p95_ms', direction: 'INCREASED', percentChange: 2 }];
  const result = detectApplicationVisibleDifferences(diffs, comparisons);
  assert.equal(result.classification, 'INFRASTRUCTURE_DIFFERENCE_ONLY');
});

test('infra difference with a meaningful metric shift -> APPLICATION_VISIBLE_CORRELATION', () => {
  const diffs = [{ dimension: 'Storage', differenceFound: true }];
  const comparisons = [{ metric: 'p95_ms', direction: 'INCREASED', percentChange: 42 }];
  const result = detectApplicationVisibleDifferences(diffs, comparisons);
  assert.equal(result.classification, 'APPLICATION_VISIBLE_CORRELATION');
  assert.equal(result.applicationVisible, true);
  assert.equal(result.meaningfulMetricShifts.length, 1);
});

test('not every infrastructure difference is marked application-visible', () => {
  const diffs = [
    { dimension: 'Storage', differenceFound: true },
    { dimension: 'Platform', differenceFound: true },
  ];
  const comparisons = [{ metric: 'p95_ms', direction: 'UNCHANGED', percentChange: 0 }];
  const result = detectApplicationVisibleDifferences(diffs, comparisons);
  assert.equal(result.applicationVisible, false);
});

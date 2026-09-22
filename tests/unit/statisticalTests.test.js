'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pairedTTest, tDistPValue, MIN_N_FOR_TTEST } = require('../../analyzer/telemetry/statisticalTests');

test('MIN_N_FOR_TTEST is 5', () => {
  assert.equal(MIN_N_FOR_TTEST, 5);
});

test('pairedTTest throws on non-array input', () => {
  assert.throws(() => pairedTTest('not an array', [1, 2, 3]), TypeError);
  assert.throws(() => pairedTTest([1, 2, 3], null), TypeError);
});

test('pairedTTest throws when array lengths differ', () => {
  assert.throws(() => pairedTTest([1, 2, 3], [1, 2]), /same length/);
});

test('pairedTTest returns INSUFFICIENT_SAMPLE for n < 5', () => {
  const res2 = pairedTTest([10, 20], [15, 25]);
  assert.equal(res2.interpretation, 'INSUFFICIENT_SAMPLE');
  assert.equal(res2.n, 2);
  assert.equal(res2.significant, false);
  assert.equal(res2.pValue, null);
  assert.equal(res2.tStatistic, null);

  const res4 = pairedTTest([10, 20, 30, 40], [12, 22, 32, 42]);
  assert.equal(res4.interpretation, 'INSUFFICIENT_SAMPLE');
  assert.equal(res4.n, 4);
  assert.equal(res4.significant, false);
});

test('pairedTTest returns valid result for n >= 5 with identical values (no difference)', () => {
  const a = [10, 20, 30, 40, 50];
  const b = [10, 20, 30, 40, 50];
  const res = pairedTTest(a, b);
  assert.equal(res.interpretation, 'NOT_STATISTICALLY_SIGNIFICANT');
  assert.equal(res.significant, false);
  assert.equal(res.meanDelta, 0);
  assert.equal(res.pValue, 1);
});

test('pairedTTest detects statistically significant difference for large effect size (n=5)', () => {
  // A has baseline latencies ~100ms; B has throttled latencies ~300ms
  const a = [98, 102, 99, 101, 100];
  const b = [305, 298, 310, 302, 295];
  const res = pairedTTest(a, b);

  assert.equal(res.interpretation, 'STATISTICALLY_SIGNIFICANT');
  assert.equal(res.significant, true);
  assert.equal(res.degreesOfFreedom, 4);
  assert.ok(res.pValue < 0.01, `pValue was ${res.pValue}, expected < 0.01`);
  assert.ok(res.tStatistic > 5, `tStatistic was ${res.tStatistic}, expected > 5`);
  assert.ok(res.meanDelta > 190);
  assert.ok(res.confidenceInterval.low > 180);
});

test('pairedTTest handles non-significant difference with high variance', () => {
  // Deltas are: +10, -15, +5, -12, +8 -> mean is near 0 with high variance
  const a = [100, 100, 100, 100, 100];
  const b = [110, 85, 105, 88, 108];
  const res = pairedTTest(a, b);

  assert.equal(res.interpretation, 'NOT_STATISTICALLY_SIGNIFICANT');
  assert.equal(res.significant, false);
  assert.ok(res.pValue > 0.05, `pValue was ${res.pValue}, expected > 0.05`);
});

test('tDistPValue returns expected probabilities for known df and t values', () => {
  // t=0 should give p=1
  assert.equal(tDistPValue(0, 4), 1);

  // Large t should give p near 0
  const pLarge = tDistPValue(10, 4);
  assert.ok(pLarge < 0.001, `Expected < 0.001, got ${pLarge}`);

  // Very large t should return 0 without throwing or NaN
  assert.equal(tDistPValue(2000, 10), 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalChecksum, verifyParity } = require('../../analyzer/evidence/checksum');

test('canonicalChecksum is order-independent for object keys', () => {
  const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
  const b = { a: 2, m: { x: 2, y: 1 }, z: 1 };
  assert.equal(canonicalChecksum(a), canonicalChecksum(b));
});

test('canonicalChecksum differs when a value differs', () => {
  const a = { seed: 987654, concurrency: 5 };
  const b = { seed: 987655, concurrency: 5 };
  assert.notEqual(canonicalChecksum(a), canonicalChecksum(b));
});

test('verifyParity reports match=true for identical invariants', () => {
  const inv = { applicationVersion: 'cloudport:1.0.0', seed: 1 };
  const result = verifyParity(inv, { ...inv });
  assert.equal(result.match, true);
  assert.equal(result.checksumA, result.checksumB);
});

test('verifyParity reports match=false when invariants differ', () => {
  const result = verifyParity({ seed: 1 }, { seed: 2 });
  assert.equal(result.match, false);
});

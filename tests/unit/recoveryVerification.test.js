'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyRecovery } = require('../../analyzer/recovery/recoveryVerification');

test('no observed recovery -> RECOVERY_NOT_OBSERVED', () => {
  const result = verifyRecovery({
    faultInjectedAtMs: 1000,
    serviceRecoveredAtMs: null,
    stateConsistent: false,
    duplicateOperationsDetected: 0,
    storageRecovered: false,
    workloadRecovered: false,
  });
  assert.equal(result.classification, 'RECOVERY_NOT_OBSERVED');
  assert.equal(result.recoveryTimeMs, null);
});

test('full clean recovery -> FULL_RECOVERY_VERIFIED with computed recovery time', () => {
  const result = verifyRecovery({
    faultInjectedAtMs: 1000,
    serviceRecoveredAtMs: 4500,
    stateConsistent: true,
    duplicateOperationsDetected: 0,
    storageRecovered: true,
    workloadRecovered: true,
  });
  assert.equal(result.classification, 'FULL_RECOVERY_VERIFIED');
  assert.equal(result.recoveryTimeMs, 3500);
  assert.equal(result.idempotencyVerified, true);
});

test('duplicate operations detected -> PARTIAL_RECOVERY, never FULL', () => {
  const result = verifyRecovery({
    faultInjectedAtMs: 0,
    serviceRecoveredAtMs: 1000,
    stateConsistent: true,
    duplicateOperationsDetected: 2,
    storageRecovered: true,
    workloadRecovered: true,
  });
  assert.equal(result.classification, 'PARTIAL_RECOVERY');
  assert.equal(result.idempotencyVerified, false);
});

test('always includes a disclaimer, never a bare guarantee', () => {
  const result = verifyRecovery({
    faultInjectedAtMs: 0,
    serviceRecoveredAtMs: 100,
    stateConsistent: true,
    duplicateOperationsDetected: 0,
    storageRecovered: true,
    workloadRecovered: true,
  });
  assert.ok(result.disclaimer.length > 0);
});

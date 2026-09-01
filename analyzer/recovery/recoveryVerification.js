/**
 * Recovery Verification
 *
 * Measures what actually happened after a fault was reverted -- never
 * asserts a recovery guarantee without evidence. All inputs are
 * caller-supplied observations (e.g. from polling the application's
 * /health and /ready endpoints, and from workload-level idempotency checks);
 * this module only aggregates and classifies them.
 */
'use strict';

/**
 * @param {object} observations
 * @param {number} observations.faultInjectedAtMs - epoch ms
 * @param {number} observations.serviceRecoveredAtMs - epoch ms when /ready first
 *   returned healthy again after the fault; null if it never recovered within
 *   the observation window
 * @param {boolean} observations.stateConsistent - whether post-recovery data checks passed
 * @param {number} observations.duplicateOperationsDetected - count of operations that
 *   appear to have been applied more than once (idempotency violations)
 * @param {boolean} observations.storageRecovered
 * @param {boolean} observations.workloadRecovered
 */
function verifyRecovery(observations) {
  const {
    faultInjectedAtMs,
    serviceRecoveredAtMs,
    stateConsistent,
    duplicateOperationsDetected = 0,
    storageRecovered,
    workloadRecovered,
  } = observations;

  if (typeof faultInjectedAtMs !== 'number') {
    throw new TypeError('faultInjectedAtMs is required and must be a number (epoch ms)');
  }

  const serviceAvailable = serviceRecoveredAtMs !== null && serviceRecoveredAtMs !== undefined;
  const recoveryTimeMs = serviceAvailable ? serviceRecoveredAtMs - faultInjectedAtMs : null;
  const idempotencyVerified = duplicateOperationsDetected === 0;

  let classification;
  if (!serviceAvailable) {
    classification = 'RECOVERY_NOT_OBSERVED';
  } else if (stateConsistent && idempotencyVerified && storageRecovered && workloadRecovered) {
    classification = 'FULL_RECOVERY_VERIFIED';
  } else {
    classification = 'PARTIAL_RECOVERY';
  }

  return {
    recoveryTimeMs,
    serviceAvailable,
    stateConsistent: Boolean(stateConsistent),
    duplicateOperationsDetected,
    idempotencyVerified,
    storageRecovered: Boolean(storageRecovered),
    workloadRecovered: Boolean(workloadRecovered),
    classification,
    // Explicit, load-bearing: this module never claims a guarantee, only an
    // observation of what was measured.
    disclaimer: 'This reflects measured observations only and does not constitute a general recovery guarantee.',
  };
}

module.exports = { verifyRecovery };

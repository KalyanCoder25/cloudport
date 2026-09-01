/**
 * Causal Governance Classifier
 *
 * The single choke point through which every experiment's final claim must
 * pass. Enforces CloudPort's core scientific safety rule: never assert
 * causation beyond what the evidence chain actually supports.
 *
 * Possible classifications (all documented in docs/architecture/safety.md):
 *   NO_EVIDENCE
 *   INFRASTRUCTURE_DIFFERENCE_ONLY
 *   POTENTIAL_LEAKAGE
 *   INSUFFICIENT_DATA
 *   INSUFFICIENT_REPLICATION
 *   CONFIRMED_REPLICATED   (paired with CORRELATION_ONLY causal language)
 */
'use strict';

/**
 * @param {object} evidence
 * @param {boolean} evidence.parityValidated - checksum invariant match between A and B config
 * @param {boolean} evidence.telemetryComplete - telemetry present for every trial on both sides
 * @param {object} evidence.applicationVisibleResult - output of applicationVisibleDetector
 * @param {object} evidence.replicationResult - output of repeatedTrials.analyzeRepeatedTrials
 * @param {object} evidence.leakageResult - output of leakageScore.computeLeakageScore
 * @param {boolean} evidence.excludedDimensionsVerifiedInvariant - whether excluded dims were
 *   actually confirmed unchanged (not merely assumed)
 */
function classifyCausalGovernance(evidence) {
  const {
    parityValidated,
    telemetryComplete,
    applicationVisibleResult,
    replicationResult,
    leakageResult,
    excludedDimensionsVerifiedInvariant,
  } = evidence;

  const findings = [];
  let downgraded = false;

  if (!parityValidated) {
    return finalize('INSUFFICIENT_DATA', 'Invariant checksum parity between Infrastructure A and B configuration was not validated.', findings, true);
  }

  if (!telemetryComplete) {
    return finalize('INSUFFICIENT_DATA', 'Telemetry is missing for one or more trials; no claim can be made.', findings, true);
  }

  if (!excludedDimensionsVerifiedInvariant) {
    downgraded = true;
    findings.push('Excluded dimensions were not explicitly verified invariant; downgrading claim strength.');
  }

  if (!applicationVisibleResult || applicationVisibleResult.classification === 'NO_INFRASTRUCTURE_DIFFERENCE') {
    return finalize('NO_EVIDENCE', 'No infrastructure difference was detected between A and B.', findings, downgraded);
  }

  if (applicationVisibleResult.classification === 'INFRASTRUCTURE_DIFFERENCE_ONLY') {
    return finalize(
      'INFRASTRUCTURE_DIFFERENCE_ONLY',
      'An infrastructure difference exists but no meaningful application-visible metric shift was observed.',
      findings,
      downgraded
    );
  }

  // applicationVisibleResult.classification === 'APPLICATION_VISIBLE_CORRELATION' from here on.

  if (!replicationResult || replicationResult.classification === 'INSUFFICIENT_REPLICATION') {
    return finalize(
      'INSUFFICIENT_REPLICATION',
      'An application-visible correlation was observed in available trials, but too few paired trials exist to assess replication.',
      findings,
      downgraded
    );
  }

  const highLeakage = leakageResult && (leakageResult.band === 'MODERATE' || leakageResult.band === 'HIGH');

  if (replicationResult.classification === 'VARIABLE_REPLICATION') {
    return finalize(
      'POTENTIAL_LEAKAGE',
      'A correlation between infrastructure difference and application behavior was observed, but replication across trials was variable. Causal attribution is not established -- treat as CORRELATION_ONLY.',
      findings,
      downgraded,
      { causalLanguage: 'CORRELATION_ONLY' }
    );
  }

  // replicationResult.classification === 'CONFIRMED_REPLICATED'
  if (highLeakage) {
    return finalize(
      'POTENTIAL_LEAKAGE',
      'The correlation between infrastructure difference and application behavior replicated consistently across paired trials, with a moderate-to-high leakage score. This supports flagging potential infrastructure leakage, but does NOT by itself prove that the infrastructure change caused the behavior change -- treat as CORRELATION_ONLY unless a controlled causal mechanism has been independently verified.',
      findings,
      downgraded,
      { causalLanguage: 'CORRELATION_ONLY' }
    );
  }

  return finalize(
    'CONFIRMED_REPLICATED',
    'The observed application-visible metric shift replicated consistently across paired trials under invariant experimental conditions. This is a confirmed, replicated correlation. It does not, by itself, constitute a proven causal mechanism -- report findings using CORRELATION_ONLY language unless independent causal verification exists.',
    findings,
    downgraded,
    { causalLanguage: 'CORRELATION_ONLY' }
  );
}

function finalize(classification, rationale, findings, downgraded, extra = {}) {
  return {
    classification,
    rationale,
    downgraded,
    downgradeNotes: findings,
    causalLanguage: extra.causalLanguage || 'NOT_APPLICABLE',
    prohibitedClaims: [
      'X caused Y',
      'infrastructure throttling confirmed',
      'proven causal mechanism',
    ],
  };
}

module.exports = { classifyCausalGovernance };

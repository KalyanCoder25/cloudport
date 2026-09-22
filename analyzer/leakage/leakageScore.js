/**
 * Leakage Score
 *
 * "Leakage" here means: infrastructure-identity information or infrastructure
 * differences leaking into application-visible behavior in a way that could
 * be used to fingerprint or infer infrastructure from workload results.
 *
 * The rubric below is intentionally simple, fully documented, and
 * reproducible from evidence -- no hidden weights. Total score is 0-100.
 *
 * RUBRIC (documented weights, must sum to 100 across all rubric items):
 *   1. infrastructureDifferenceDetected  -> +25 if any infra difference found, else 0
 *   2. applicationVisibleCorrelation     -> +35 if app-visible correlation found, else 0
 *   3. metricShiftMagnitude              -> up to +25, scaled linearly by the largest
 *                                            |percentChange| among meaningful shifts,
 *                                            capped at 100% shift = full 25 points
 *   4. replicationConfirmed              -> +15 if replication classification is
 *                                            CONFIRMED_REPLICATED, +7 if VARIABLE_REPLICATION,
 *                                            0 if INSUFFICIENT_REPLICATION
 *
 * Score bands (for classification only, not causal claims):
 *   0        -> NO_EVIDENCE
 *   1-29     -> LOW
 *   30-59    -> MODERATE
 *   60-100   -> HIGH
 */
'use strict';

const RUBRIC_WEIGHTS = {
  infrastructureDifferenceDetected: 25,
  applicationVisibleCorrelation: 35,
  metricShiftMagnitude: 25,
  replicationConfirmed: 15,
};

function scoreBand(score) {
  if (score === 0) return 'NO_EVIDENCE';
  if (score < 30) return 'LOW';
  if (score < 60) return 'MODERATE';
  return 'HIGH';
}

/**
 * @param {object} input
 * @param {boolean} input.infrastructureDifferenceDetected
 * @param {boolean} input.applicationVisibleCorrelation
 * @param {number} [input.largestMeaningfulPercentChange] - absolute value, e.g. 42.5 for 42.5%
 * @param {'CONFIRMED_REPLICATED'|'VARIABLE_REPLICATION'|'INSUFFICIENT_REPLICATION'} input.replicationClassification
 * @param {string} [input.measurementSource] - must be 'kubernetes-pod-exec' for a valid live score;
 *   any other value triggers INSUFFICIENT_EVIDENCE (score 0) to prevent local-host measurements
 *   from generating an inflated score.
 */
function computeLeakageScore(input) {
  const {
    infrastructureDifferenceDetected = false,
    applicationVisibleCorrelation = false,
    largestMeaningfulPercentChange = 0,
    replicationClassification = 'INSUFFICIENT_REPLICATION',
    measurementSource,
  } = input;

  // GUARD: Reject scoring if measurements did not originate from a Kubernetes pod
  // or from a Locust load generator running inside Kubernetes.
  //
  // Valid measurement sources:
  //   'kubernetes-pod-exec' — local kind-korifi experiments (kubectl exec into pod)
  //   'locust-kubernetes'   — multi-cloud experiments (Locust running in-cluster)
  //
  // This prevents local Windows filesystem measurements (or any non-pod source) from
  // being scored as if they were live A/B infrastructure observations.
  const VALID_MEASUREMENT_SOURCES = ['kubernetes-pod-exec', 'locust-kubernetes'];
  if (measurementSource !== undefined && !VALID_MEASUREMENT_SOURCES.includes(measurementSource)) {
    return {
      score: 0,
      band: 'INSUFFICIENT_EVIDENCE',
      rubric: {
        infrastructureDifferenceDetected: 0,
        applicationVisibleCorrelation: 0,
        metricShiftMagnitude: 0,
        replicationConfirmed: 0,
      },
      weights: RUBRIC_WEIGHTS,
      measurementSource,
      rationale:
        `Leakage scoring refused: measurementSource is "${measurementSource}" but must be ` +
        `one of: ${VALID_MEASUREMENT_SOURCES.join(', ')}. ` +
        'Measurements from local host filesystems, temp directories, or unverified sources ' +
        'cannot be used to attribute infrastructure-induced application behavior differences.',
    };
  }


  const rubric = {};

  rubric.infrastructureDifferenceDetected = infrastructureDifferenceDetected
    ? RUBRIC_WEIGHTS.infrastructureDifferenceDetected
    : 0;

  rubric.applicationVisibleCorrelation = applicationVisibleCorrelation
    ? RUBRIC_WEIGHTS.applicationVisibleCorrelation
    : 0;

  const cappedShift = Math.min(Math.max(largestMeaningfulPercentChange, 0), 100);
  rubric.metricShiftMagnitude = Math.round((cappedShift / 100) * RUBRIC_WEIGHTS.metricShiftMagnitude);

  if (replicationClassification === 'CONFIRMED_REPLICATED') {
    rubric.replicationConfirmed = RUBRIC_WEIGHTS.replicationConfirmed;
  } else if (replicationClassification === 'VARIABLE_REPLICATION') {
    rubric.replicationConfirmed = Math.round(RUBRIC_WEIGHTS.replicationConfirmed * 0.47); // documented: ~7/15
  } else {
    rubric.replicationConfirmed = 0;
  }

  const score = Object.values(rubric).reduce((a, b) => a + b, 0);

  return {
    score,
    band: scoreBand(score),
    rubric,
    weights: RUBRIC_WEIGHTS,
  };
}

module.exports = { computeLeakageScore, RUBRIC_WEIGHTS, scoreBand };

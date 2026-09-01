/**
 * Application-Visible Difference Detector
 *
 * Determines whether a detected infrastructure difference correlates with a
 * meaningful application-observable metric shift. An infrastructure
 * difference is NOT automatically treated as application-visible.
 *
 * "Meaningful" is defined by an explicit, documented threshold (not a hidden
 * magic number): a metric shift is meaningful if |percentChange| >= the
 * configured threshold (default 10%) AND the direction is not UNCHANGED.
 */
'use strict';

const DEFAULT_THRESHOLD_PERCENT = 10;

/**
 * @param {Array} infrastructureDifferences - output of differenceDetector.detectDifferences
 * @param {Array} behaviourComparisons - output of behaviourComparison.compareTelemetrySummaries
 * @param {number} [thresholdPercent] - minimum |percentChange| to count as meaningful
 */
function detectApplicationVisibleDifferences(
  infrastructureDifferences,
  behaviourComparisons,
  thresholdPercent = DEFAULT_THRESHOLD_PERCENT
) {
  const anyInfraDifference = infrastructureDifferences.some((d) => d.differenceFound);

  const meaningfulMetricShifts = behaviourComparisons.filter((c) => {
    if (c.direction === 'UNCHANGED') return false;
    if (c.percentChange === null || c.percentChange === undefined) return false;
    return Math.abs(c.percentChange) >= thresholdPercent;
  });

  if (!anyInfraDifference) {
    return {
      classification: 'NO_INFRASTRUCTURE_DIFFERENCE',
      applicationVisible: false,
      meaningfulMetricShifts: [],
      thresholdPercent,
      rationale: 'No infrastructure difference was detected between A and B.',
    };
  }

  if (meaningfulMetricShifts.length === 0) {
    return {
      classification: 'INFRASTRUCTURE_DIFFERENCE_ONLY',
      applicationVisible: false,
      meaningfulMetricShifts: [],
      thresholdPercent,
      rationale: `An infrastructure difference was detected, but no application metric shifted by at least ${thresholdPercent}%.`,
    };
  }

  return {
    classification: 'APPLICATION_VISIBLE_CORRELATION',
    applicationVisible: true,
    meaningfulMetricShifts,
    thresholdPercent,
    rationale: `An infrastructure difference was detected alongside ${meaningfulMetricShifts.length} metric(s) shifting by at least ${thresholdPercent}%. This indicates correlation only, not proven causation.`,
  };
}

module.exports = { detectApplicationVisibleDifferences, DEFAULT_THRESHOLD_PERCENT };

/**
 * Behaviour Comparison
 *
 * Compares telemetry metrics between Infrastructure A and Infrastructure B
 * for a single trial pair or for aggregated values across trials. Produces
 * per-metric deltas, percent changes, and a direction classification.
 *
 * Uses safe division throughout -- a zero baseline never throws or produces
 * NaN/Infinity; instead the percent change is reported as null (undefined).
 */
'use strict';

const { mean, median, percentChange, safeDivide } = require('../telemetry/stats');

const UNCHANGED_EPSILON = 1e-9;

function classifyDirection(delta) {
  if (delta === null || delta === undefined) return 'UNCHANGED';
  if (Math.abs(delta) < UNCHANGED_EPSILON) return 'UNCHANGED';
  return delta > 0 ? 'INCREASED' : 'DECREASED';
}

/**
 * Compare a single metric's values across A and B trial sets.
 * @param {string} metric - metric name, e.g. "p95_ms"
 * @param {number[]} valuesA
 * @param {number[]} valuesB
 * @param {object} [significance] - optional externally-computed significance result; never fabricated here
 */
function compareMetric(metric, valuesA, valuesB, significance = null) {
  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  const medianA = median(valuesA);
  const medianB = median(valuesB);

  const delta = meanA === null || meanB === null ? null : meanB - meanA;
  const pctChange = percentChange(meanA, meanB);

  return {
    metric,
    meanA,
    meanB,
    medianA,
    medianB,
    delta,
    percentChange: pctChange,
    direction: classifyDirection(delta),
    significance, // null unless a real statistical test was supplied by the caller
  };
}

/**
 * Compare a full telemetry summary object (keyed by metric name -> array of
 * per-trial values) between A and B.
 */
function compareTelemetrySummaries(summaryA, summaryB) {
  const metrics = new Set([...Object.keys(summaryA), ...Object.keys(summaryB)]);
  const results = [];
  for (const metric of metrics) {
    const valuesA = summaryA[metric] || [];
    const valuesB = summaryB[metric] || [];
    results.push(compareMetric(metric, valuesA, valuesB));
  }
  return results;
}

module.exports = { compareMetric, compareTelemetrySummaries, classifyDirection, safeDivide };

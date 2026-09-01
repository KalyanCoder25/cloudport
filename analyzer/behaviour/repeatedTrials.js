/**
 * Repeated Trial Engine
 *
 * Consumes paired trial measurements for a single metric (e.g. p95 latency)
 * across N paired A/B trials, and classifies whether an observed effect
 * replicates.
 *
 * Classification is NEVER produced from a single trial -- CloudPort's
 * scientific safety rules require a minimum of two paired trials before any
 * replication classification (other than INSUFFICIENT_REPLICATION) can be
 * emitted.
 */
'use strict';

const {
  mean,
  median,
  variance,
  stddev,
  coefficientOfVariation,
} = require('../telemetry/stats');

const MIN_TRIALS_FOR_CLASSIFICATION = 2;

/**
 * @param {number[]} valuesA - metric value for each trial under Infrastructure A, trial-index aligned
 * @param {number[]} valuesB - metric value for each trial under Infrastructure B, trial-index aligned
 * @returns {object} replication analysis result
 */
function analyzeRepeatedTrials(valuesA, valuesB) {
  if (!Array.isArray(valuesA) || !Array.isArray(valuesB)) {
    throw new TypeError('valuesA and valuesB must be arrays');
  }
  if (valuesA.length !== valuesB.length) {
    throw new Error('Paired trial arrays must be the same length (each A trial must have a matching B trial)');
  }

  const trialCount = valuesA.length;

  if (trialCount < MIN_TRIALS_FOR_CLASSIFICATION) {
    return {
      trialCount,
      classification: 'INSUFFICIENT_REPLICATION',
      reason: `Only ${trialCount} paired trial(s) available; at least ${MIN_TRIALS_FOR_CLASSIFICATION} are required to assess replication.`,
      pairedDeltas: [],
      directionalConsistency: null,
      statistics: { a: emptyStats(), b: emptyStats() },
    };
  }

  const pairedDeltas = valuesA.map((a, i) => valuesB[i] - a);
  const directions = pairedDeltas.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
  const nonZeroDirections = directions.filter((d) => d !== 0);

  let directionalConsistency;
  if (nonZeroDirections.length === 0) {
    // All deltas exactly zero -- perfectly consistent (no effect, consistently).
    directionalConsistency = 1;
  } else {
    const mostCommon = nonZeroDirections.filter((d) => d === nonZeroDirections[0]).length;
    directionalConsistency = mostCommon / nonZeroDirections.length;
  }

  const statsA = computeStats(valuesA);
  const statsB = computeStats(valuesB);
  const deltaCV = coefficientOfVariation(pairedDeltas);

  let classification;
  let reason;

  if (directionalConsistency === 1 && (deltaCV === null || Math.abs(deltaCV) < 0.5)) {
    classification = 'CONFIRMED_REPLICATED';
    reason = 'Paired delta direction was consistent across all trials and delta variability was low.';
  } else if (directionalConsistency >= 0.5) {
    classification = 'VARIABLE_REPLICATION';
    reason = 'Paired delta direction was not fully consistent across trials, or delta variability was high.';
  } else {
    classification = 'VARIABLE_REPLICATION';
    reason = 'Paired deltas disagreed on direction more often than they agreed.';
  }

  return {
    trialCount,
    classification,
    reason,
    pairedDeltas,
    directionalConsistency,
    statistics: { a: statsA, b: statsB },
    deltaCoefficientOfVariation: deltaCV,
  };
}

function computeStats(values) {
  return {
    mean: mean(values),
    median: median(values),
    variance: variance(values),
    stddev: stddev(values),
    coefficientOfVariation: coefficientOfVariation(values),
  };
}

function emptyStats() {
  return { mean: null, median: null, variance: null, stddev: null, coefficientOfVariation: null };
}

module.exports = { analyzeRepeatedTrials, MIN_TRIALS_FOR_CLASSIFICATION };

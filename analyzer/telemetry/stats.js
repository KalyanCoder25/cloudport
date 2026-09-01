/**
 * Shared, dependency-free statistics utilities.
 * All functions are pure and operate on plain arrays of numbers.
 */
'use strict';

function mean(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function variance(values) {
  if (!values || values.length < 2) return values && values.length === 1 ? 0 : null;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return sumSq / (values.length - 1); // sample variance
}

function stddev(values) {
  const v = variance(values);
  return v === null ? null : Math.sqrt(v);
}

function coefficientOfVariation(values) {
  const m = mean(values);
  const sd = stddev(values);
  if (m === null || sd === null || m === 0) return null;
  return sd / Math.abs(m);
}

/**
 * Nearest-rank percentile. p in [0, 100].
 */
function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

function max(values) {
  if (!values || values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Safe division: never throws, never returns NaN/Infinity for a zero
 * denominator. Returns null when the operation is not meaningful.
 */
function safeDivide(numerator, denominator) {
  if (denominator === 0 || denominator === null || denominator === undefined) return null;
  if (numerator === null || numerator === undefined) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function percentChange(before, after) {
  if (before === null || before === undefined) return null;
  if (before === 0) return after === 0 ? 0 : null; // undefined percent change from zero baseline
  return safeDivide(after - before, Math.abs(before)) * 100;
}

function latencySummary(latenciesMs) {
  return {
    p50: percentile(latenciesMs, 50),
    p90: percentile(latenciesMs, 90),
    p95: percentile(latenciesMs, 95),
    p99: percentile(latenciesMs, 99),
    max: max(latenciesMs),
    mean: mean(latenciesMs),
  };
}

module.exports = {
  mean,
  median,
  variance,
  stddev,
  coefficientOfVariation,
  percentile,
  max,
  safeDivide,
  percentChange,
  latencySummary,
};

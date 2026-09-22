/**
 * Statistical Tests for Paired A/B Observations
 *
 * Implements paired statistical tests appropriate for CloudPort's A/B trial design.
 * All functions are pure, dependency-free, and accept plain arrays of numbers.
 *
 * PAIRED T-TEST:
 *   Appropriate when:
 *     - Observations are paired (same workload seed, same operation sequence)
 *     - The paired differences can be assumed approximately normally distributed
 *     - n >= 3 (with n < 30, the normality assumption is noted as unverified)
 *   Returns: t-statistic, degrees of freedom, p-value (two-tailed), 95% CI
 *
 * SAMPLE SIZE GUIDANCE:
 *   n = 1:     INSUFFICIENT_SAMPLE (cannot compute any paired test)
 *   n = 2:     INSUFFICIENT_SAMPLE (t-test is possible but DOF=1 makes it near-meaningless)
 *   n = 3-4:   INSUFFICIENT_SAMPLE for rigorous p-value; returns descriptive stats only
 *   n >= 5:    Paired t-test computed; result flagged with n-limitation note if n < 30
 *
 * INTERPRETATION:
 *   p < 0.05: STATISTICALLY_SIGNIFICANT (at alpha=0.05, two-tailed)
 *   p >= 0.05: NOT_STATISTICALLY_SIGNIFICANT
 *   n < 5: INSUFFICIENT_SAMPLE
 *
 * IMPORTANT: Statistical significance does NOT imply causal attribution.
 * A significant result means the observed difference is unlikely to be
 * due to random sampling variation, given the paired design. It does NOT
 * prove that the difference was caused by the controlled infrastructure variable.
 */
'use strict';

const MIN_N_FOR_TTEST = 5;

/**
 * Compute the two-tailed p-value for a t-distribution.
 * Uses a numerical approximation of the regularized incomplete beta function
 * (Abramowitz and Stegun 26.5.27 approximation).
 *
 * @param {number} t - t-statistic (absolute value used)
 * @param {number} df - degrees of freedom (must be >= 1)
 * @returns {number} p-value in [0, 1]
 */
function tDistPValue(t, df) {
  const absT = Math.abs(t);
  // For very large t, p approaches 0
  if (absT > 1000) return 0;

  // Compute CDF of t-distribution via regularized incomplete beta function
  // p(T > |t|) = I(df/(df+t^2), df/2, 1/2)
  const x = df / (df + absT * absT);
  const betaInc = regularizedIncompleteBeta(x, df / 2, 0.5);
  // Two-tailed p-value
  return Math.min(1, betaInc);
}

function betacf(x, a, b) {
  const MAXIT = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularized incomplete beta function I_x(a, b).
 *
 * @param {number} x  - value in [0,1]
 * @param {number} a  - shape parameter a > 0
 * @param {number} b  - shape parameter b > 0
 * @returns {number}
 */
function regularizedIncompleteBeta(x, a, b) {
  if (x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;

  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/**
 * Log-gamma function (Lanczos approximation, g=7, n=9).
 * Accurate to ~15 significant digits for Re(z) > 0.
 */
function logGamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Paired t-test for two aligned measurement arrays.
 *
 * @param {number[]} valuesA  - metric from Infrastructure A, trial-index aligned
 * @param {number[]} valuesB  - metric from Infrastructure B, trial-index aligned
 * @param {number}   [alpha]  - significance level (default 0.05)
 *
 * @returns {object} test result
 */
function pairedTTest(valuesA, valuesB, alpha = 0.05) {
  if (!Array.isArray(valuesA) || !Array.isArray(valuesB)) {
    throw new TypeError('valuesA and valuesB must be arrays');
  }
  if (valuesA.length !== valuesB.length) {
    throw new Error('Paired arrays must be the same length');
  }

  const n = valuesA.length;

  if (n < MIN_N_FOR_TTEST) {
    const deltas = valuesA.map((a, i) => valuesB[i] - a);
    const meanDelta = n > 0 ? deltas.reduce((s, d) => s + d, 0) / n : null;
    return {
      interpretation: 'INSUFFICIENT_SAMPLE',
      significance: 'INSUFFICIENT_SAMPLE',
      n,
      minNRequired: MIN_N_FOR_TTEST,
      meanDelta,
      tStatistic: null,
      degreesOfFreedom: null,
      pValue: null,
      significant: false,
      alpha,
      note: `n=${n} is below the minimum of ${MIN_N_FOR_TTEST} required for a meaningful paired t-test. ` +
            'Descriptive statistics are reported but no significance conclusion is drawn.',
    };
  }

  const deltas = valuesA.map((a, i) => valuesB[i] - a);
  const meanDelta = deltas.reduce((s, d) => s + d, 0) / n;
  const ssd = deltas.reduce((s, d) => s + (d - meanDelta) ** 2, 0);
  const stdDelta = Math.sqrt(ssd / (n - 1));
  const se = stdDelta / Math.sqrt(n);
  const df = n - 1;

  if (se === 0) {
    // All deltas are identical — either exactly zero (no effect) or identical non-zero (perfect effect)
    const interp = meanDelta === 0 ? 'NOT_STATISTICALLY_SIGNIFICANT' : 'STATISTICALLY_SIGNIFICANT';
    return {
      interpretation: interp,
      significance: interp,
      n,
      meanDelta,
      stdDelta: 0,
      standardError: 0,
      tStatistic: meanDelta === 0 ? 0 : Infinity,
      degreesOfFreedom: df,
      pValue: meanDelta === 0 ? 1 : 0,
      significant: meanDelta !== 0,
      alpha,
      note: 'All paired differences are identical — zero standard error.',
    };
  }

  const t = meanDelta / se;
  const pValue = tDistPValue(t, df);
  const significant = pValue < alpha;

  // 95% confidence interval for the mean difference (two-tailed t critical value)
  // Using an approximation for t_crit based on df
  const tCrit = tCriticalValue(df, alpha);
  const ciLow = meanDelta - tCrit * se;
  const ciHigh = meanDelta + tCrit * se;

  const note = n < 30
    ? `n=${n} — normality of paired differences is assumed but not verified. ` +
      'Interpret p-value with caution for small samples.'
    : undefined;

  const interp = significant ? 'STATISTICALLY_SIGNIFICANT' : 'NOT_STATISTICALLY_SIGNIFICANT';
  return {
    interpretation: interp,
    significance: interp,
    n,
    meanDelta,
    stdDelta,
    standardError: se,
    tStatistic: t,
    degreesOfFreedom: df,
    pValue,
    significant,
    alpha,
    confidenceInterval: { low: ciLow, high: ciHigh, level: 1 - alpha },
    ...(note ? { note } : {}),
  };
}

/**
 * Approximate two-tailed t critical value for given df and alpha.
 * Uses a rational approximation sufficient for df >= 1.
 */
function tCriticalValue(df, alpha = 0.05) {
  // For common cases, use tabulated values
  const table = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042,
    40: 2.021, 60: 2.000, 120: 1.980,
  };

  if (alpha !== 0.05) return 1.96; // fallback for non-standard alpha

  // Exact match
  if (table[df]) return table[df];

  // Interpolate for df between table entries
  const dfs = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < dfs.length - 1; i++) {
    if (df >= dfs[i] && df <= dfs[i + 1]) {
      const t0 = table[dfs[i]];
      const t1 = table[dfs[i + 1]];
      const frac = (df - dfs[i]) / (dfs[i + 1] - dfs[i]);
      return t0 + frac * (t1 - t0);
    }
  }

  // df > 120: use normal approximation
  return 1.96;
}

module.exports = {
  pairedTTest,
  tDistPValue,
  MIN_N_FOR_TTEST,
};

/**
 * Client for the CloudPort statistics service (SciPy-backed).
 *
 * The pure-JavaScript implementation in statisticalTests.js has no external
 * dependency and is what every unit test runs against, so it stays the
 * default. When STATS_SERVICE_URL is configured and reachable, this module
 * calls out to the real SciPy engine instead and returns its result verbatim
 * (including `engine: "scipy"`) so callers and evidence artifacts can see
 * which one actually produced a given number.
 *
 * This module makes network calls and therefore, unlike the rest of
 * analyzer/, is not a pure function -- callers that need determinism for
 * testing should use statisticalTests.js directly and inject a fake here.
 */
'use strict';

const { pairedTTest: pairedTTestJs } = require('./statisticalTests');

const DEFAULT_TIMEOUT_MS = 5000;

function getServiceUrl() {
  const url = process.env.STATS_SERVICE_URL;
  return url && url.trim() ? url.trim().replace(/\/$/, '') : null;
}

async function postJson(baseUrl, path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Statistics service responded with HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Paired t-test, preferring the SciPy service and falling back to the
 * pure-JS implementation when the service is not configured or unreachable.
 *
 * @param {number[]} valuesA
 * @param {number[]} valuesB
 * @param {number} [alpha]
 * @param {object} [deps] - injectable for tests: { fetchJson, serviceUrl, timeoutMs }
 * @returns {Promise<object>} same shape as statisticalTests.pairedTTest, plus `engine`
 */
async function pairedTTest(valuesA, valuesB, alpha = 0.05, deps = {}) {
  const serviceUrl = deps.serviceUrl !== undefined ? deps.serviceUrl : getServiceUrl();
  const fallback = () => ({ engine: 'javascript', ...pairedTTestJs(valuesA, valuesB, alpha) });

  if (!serviceUrl) return fallback();

  const call = deps.fetchJson || postJson;
  try {
    return await call(serviceUrl, '/paired-ttest', { valuesA, valuesB, alpha }, deps.timeoutMs || DEFAULT_TIMEOUT_MS);
  } catch (err) {
    const result = fallback();
    result.serviceFallbackReason = err.message;
    return result;
  }
}

/**
 * Shapiro-Wilk normality check on the paired differences. Only available
 * through the SciPy service -- there is no pure-JS equivalent -- so this
 * returns null (never a fabricated result) when the service is unavailable.
 *
 * @param {number[]} valuesA
 * @param {number[]} valuesB
 * @param {object} [deps]
 * @returns {Promise<object|null>}
 */
async function checkNormality(valuesA, valuesB, deps = {}) {
  const serviceUrl = deps.serviceUrl !== undefined ? deps.serviceUrl : getServiceUrl();
  if (!serviceUrl) return null;

  const call = deps.fetchJson || postJson;
  try {
    return await call(serviceUrl, '/normality', { valuesA, valuesB }, deps.timeoutMs || DEFAULT_TIMEOUT_MS);
  } catch (_err) {
    return null;
  }
}

module.exports = { pairedTTest, checkNormality };

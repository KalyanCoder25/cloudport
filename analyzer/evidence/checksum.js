/**
 * Canonical SHA-256 checksum utilities.
 *
 * Used to verify that every non-target experimental dimension is byte-for-byte
 * identical between Infrastructure A and Infrastructure B runs. If the
 * checksums differ, the experiment MUST fail parity validation and must not run.
 */
'use strict';

const crypto = require('crypto');

/**
 * Deterministically stringify a value: object keys are sorted recursively so
 * that key order never affects the checksum. Arrays preserve order (order is
 * experimentally meaningful for things like excludedDimensions lists only if
 * the caller treats them as ordered -- CloudPort treats them as sets, so
 * callers should sort arrays before hashing if order should not matter).
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sortedKeys = Object.keys(value).sort();
  const out = {};
  for (const key of sortedKeys) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Compute a SHA-256 checksum over a canonicalized JSON representation of the
 * given invariants object.
 * @param {object} invariants
 * @returns {string} hex-encoded SHA-256 digest
 */
function canonicalChecksum(invariants) {
  const json = canonicalJSON(invariants);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Compare invariant checksums between two runs (typically Infrastructure A
 * and Infrastructure B configurations for the same experiment).
 * @returns {{ match: boolean, checksumA: string, checksumB: string }}
 */
function verifyParity(invariantsA, invariantsB) {
  const checksumA = canonicalChecksum(invariantsA);
  const checksumB = canonicalChecksum(invariantsB);
  return {
    match: checksumA === checksumB,
    checksumA,
    checksumB,
  };
}

module.exports = { canonicalize, canonicalJSON, canonicalChecksum, verifyParity };

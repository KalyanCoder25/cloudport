'use strict';

/**
 * Tests for the multi-cloud leakage score extension.
 *
 * Verifies that:
 *   1. locust-kubernetes is a valid measurement source
 *   2. kubernetes-pod-exec still works (backward compatibility)
 *   3. Invalid sources still return INSUFFICIENT_EVIDENCE
 *   4. Hardcoded scores are structurally impossible (scores depend on inputs)
 *   5. Causal chain integrity (score without infra diff = lower score)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { computeLeakageScore, RUBRIC_WEIGHTS, scoreBand } = require('../../analyzer/leakage/leakageScore');

// ---------------------------------------------------------------------------
// Valid measurement sources
// ---------------------------------------------------------------------------

describe('Leakage score — locust-kubernetes measurement source', () => {
  it('accepts locust-kubernetes as a valid source', () => {
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'locust-kubernetes',
    });
    assert.notEqual(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.ok(result.score >= 0);
  });

  it('accepts kubernetes-pod-exec as a valid source (backward compatibility)', () => {
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'kubernetes-pod-exec',
    });
    assert.notEqual(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.ok(result.score >= 0);
  });

  it('rejects local-filesystem source', () => {
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: true,
      largestMeaningfulPercentChange: 50,
      replicationClassification: 'CONFIRMED_REPLICATED',
      measurementSource: 'local-filesystem',
    });
    assert.equal(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.score, 0);
  });

  it('rejects arbitrary source strings', () => {
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: true,
      largestMeaningfulPercentChange: 100,
      replicationClassification: 'CONFIRMED_REPLICATED',
      measurementSource: 'my-custom-source',
    });
    assert.equal(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.score, 0);
  });

  it('rejects undefined measurementSource when explicitly set', () => {
    // When measurementSource is explicitly the string "undefined", it should reject
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: true,
      largestMeaningfulPercentChange: 100,
      replicationClassification: 'CONFIRMED_REPLICATED',
      measurementSource: 'undefined',
    });
    assert.equal(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.score, 0);
  });

  it('omitting measurementSource is allowed (legacy path)', () => {
    // When measurementSource is not provided, the guard is skipped
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: true,
      largestMeaningfulPercentChange: 50,
      replicationClassification: 'CONFIRMED_REPLICATED',
    });
    assert.notEqual(result.band, 'INSUFFICIENT_EVIDENCE');
    assert.ok(result.score > 0);
  });
});

// ---------------------------------------------------------------------------
// Hardcoded scores are impossible
// ---------------------------------------------------------------------------

describe('Leakage score — no hardcoded scores', () => {
  it('score is 0 when no evidence provided', () => {
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: false,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'locust-kubernetes',
    });
    assert.equal(result.score, 0);
    assert.equal(result.band, 'NO_EVIDENCE');
  });

  it('score increases with each evidence component', () => {
    const base = computeLeakageScore({
      infrastructureDifferenceDetected: false,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'locust-kubernetes',
    });

    const withInfra = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'locust-kubernetes',
    });

    const withAll = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: true,
      largestMeaningfulPercentChange: 50,
      replicationClassification: 'CONFIRMED_REPLICATED',
      measurementSource: 'locust-kubernetes',
    });

    assert.ok(withInfra.score > base.score);
    assert.ok(withAll.score > withInfra.score);
  });

  it('rubric weights sum to 100', () => {
    const total = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(total, 100);
  });
});

// ---------------------------------------------------------------------------
// Score band classification
// ---------------------------------------------------------------------------

describe('Leakage score — band classification', () => {
  it('score 0 = NO_EVIDENCE', () => {
    assert.equal(scoreBand(0), 'NO_EVIDENCE');
  });

  it('score 1-29 = LOW', () => {
    assert.equal(scoreBand(1), 'LOW');
    assert.equal(scoreBand(25), 'LOW');
    assert.equal(scoreBand(29), 'LOW');
  });

  it('score 30-59 = MODERATE', () => {
    assert.equal(scoreBand(30), 'MODERATE');
    assert.equal(scoreBand(50), 'MODERATE');
    assert.equal(scoreBand(59), 'MODERATE');
  });

  it('score 60-100 = HIGH', () => {
    assert.equal(scoreBand(60), 'HIGH');
    assert.equal(scoreBand(100), 'HIGH');
  });
});

// ---------------------------------------------------------------------------
// Infrastructure differences vs leakage classification
// ---------------------------------------------------------------------------

describe('Leakage score — provider differences not auto-leakage', () => {
  it('infra difference alone = LOW score, not HIGH', () => {
    // Infrastructure differences (like different load balancers) alone
    // should not produce a HIGH leakage score without app-visible correlation
    const result = computeLeakageScore({
      infrastructureDifferenceDetected: true,
      applicationVisibleCorrelation: false,
      largestMeaningfulPercentChange: 0,
      replicationClassification: 'INSUFFICIENT_REPLICATION',
      measurementSource: 'locust-kubernetes',
    });
    assert.equal(result.band, 'LOW');
    // Score = 25 (infra) + 0 + 0 + 0 = 25 → LOW
    assert.equal(result.score, RUBRIC_WEIGHTS.infrastructureDifferenceDetected);
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCausalGovernance } = require('../../analyzer/evidence/causalGovernance');

function baseEvidence(overrides = {}) {
  return {
    parityValidated: true,
    telemetryComplete: true,
    excludedDimensionsVerifiedInvariant: true,
    applicationVisibleResult: { classification: 'NO_INFRASTRUCTURE_DIFFERENCE' },
    replicationResult: { classification: 'INSUFFICIENT_REPLICATION' },
    leakageResult: { band: 'NO_EVIDENCE', score: 0 },
    ...overrides,
  };
}

test('missing parity validation -> INSUFFICIENT_DATA', () => {
  const result = classifyCausalGovernance(baseEvidence({ parityValidated: false }));
  assert.equal(result.classification, 'INSUFFICIENT_DATA');
});

test('missing telemetry -> INSUFFICIENT_DATA', () => {
  const result = classifyCausalGovernance(baseEvidence({ telemetryComplete: false }));
  assert.equal(result.classification, 'INSUFFICIENT_DATA');
});

test('no infrastructure difference -> NO_EVIDENCE', () => {
  const result = classifyCausalGovernance(baseEvidence());
  assert.equal(result.classification, 'NO_EVIDENCE');
});

test('infra difference only, no app-visible shift -> INFRASTRUCTURE_DIFFERENCE_ONLY', () => {
  const result = classifyCausalGovernance(
    baseEvidence({ applicationVisibleResult: { classification: 'INFRASTRUCTURE_DIFFERENCE_ONLY' } })
  );
  assert.equal(result.classification, 'INFRASTRUCTURE_DIFFERENCE_ONLY');
});

test('app-visible correlation but insufficient replication -> INSUFFICIENT_REPLICATION', () => {
  const result = classifyCausalGovernance(
    baseEvidence({
      applicationVisibleResult: { classification: 'APPLICATION_VISIBLE_CORRELATION' },
      replicationResult: { classification: 'INSUFFICIENT_REPLICATION' },
    })
  );
  assert.equal(result.classification, 'INSUFFICIENT_REPLICATION');
});

test('confirmed replication with low leakage -> CONFIRMED_REPLICATED, correlation-only language', () => {
  const result = classifyCausalGovernance(
    baseEvidence({
      applicationVisibleResult: { classification: 'APPLICATION_VISIBLE_CORRELATION' },
      replicationResult: { classification: 'CONFIRMED_REPLICATED' },
      leakageResult: { band: 'LOW', score: 20 },
    })
  );
  assert.equal(result.classification, 'CONFIRMED_REPLICATED');
  assert.equal(result.causalLanguage, 'CORRELATION_ONLY');
});

test('confirmed replication with high leakage -> POTENTIAL_LEAKAGE, never a bare causal claim', () => {
  const result = classifyCausalGovernance(
    baseEvidence({
      applicationVisibleResult: { classification: 'APPLICATION_VISIBLE_CORRELATION' },
      replicationResult: { classification: 'CONFIRMED_REPLICATED' },
      leakageResult: { band: 'HIGH', score: 90 },
    })
  );
  assert.equal(result.classification, 'POTENTIAL_LEAKAGE');
  assert.equal(result.causalLanguage, 'CORRELATION_ONLY');
});

test('never emits a bare causal claim string', () => {
  const result = classifyCausalGovernance(
    baseEvidence({
      applicationVisibleResult: { classification: 'APPLICATION_VISIBLE_CORRELATION' },
      replicationResult: { classification: 'CONFIRMED_REPLICATED' },
      leakageResult: { band: 'LOW', score: 10 },
    })
  );
  assert.ok(!/storage caused/i.test(result.rationale));
});

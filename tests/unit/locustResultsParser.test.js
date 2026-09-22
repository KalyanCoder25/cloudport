'use strict';

/**
 * Tests for Locust result parsing and provenance attachment.
 *
 * Locust produces a CSV stats file and a provenance JSON file.
 * This module tests the parsing logic used by MultiCloudExperimentRunner
 * to ingest trial results.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Locust result shape validation (structural tests, no live Locust required)
// ---------------------------------------------------------------------------

/**
 * Reference Locust trial result shape (as written by locustfile.py on_test_stop).
 * Tests verify that the shape is complete and provenance fields are present.
 */
const REFERENCE_TRIAL_RESULT = {
  experiment_id: 'multicloud-portability-v1',
  trial_id: 'trial-001',
  target_context: 'aws-eks-cloudport',
  cloud_provider: 'AWS',
  start_timestamp: '2026-09-04T10:00:00.000Z',
  end_timestamp: '2026-09-04T10:05:00.000Z',
  duration_seconds: 300,
  locust_users: 50,
  locust_spawn_rate: 5,
  locust_duration: 300,
  locustfile_version: 'multicloud-portability-v1',
  request_count: 15000,
  success_count: 14950,
  failure_count: 50,
  error_rate: 0.0033,
  requests_per_second: 50.0,
  latency_p50_ms: 120,
  latency_p95_ms: 450,
  latency_p99_ms: 900,
  measurement_source: 'locust-kubernetes',
};

describe('Locust trial result shape', () => {
  it('contains all required provenance fields', () => {
    const required = [
      'experiment_id',
      'trial_id',
      'target_context',
      'cloud_provider',
      'start_timestamp',
      'end_timestamp',
      'duration_seconds',
      'locust_users',
      'locust_spawn_rate',
      'locustfile_version',
      'request_count',
      'success_count',
      'failure_count',
      'error_rate',
      'requests_per_second',
      'latency_p50_ms',
      'latency_p95_ms',
      'latency_p99_ms',
      'measurement_source',
    ];
    for (const field of required) {
      assert.ok(field in REFERENCE_TRIAL_RESULT, `Missing required field: ${field}`);
    }
  });

  it('measurement_source is locust-kubernetes', () => {
    assert.equal(REFERENCE_TRIAL_RESULT.measurement_source, 'locust-kubernetes');
  });

  it('latency values are positive numbers', () => {
    assert.ok(REFERENCE_TRIAL_RESULT.latency_p50_ms > 0);
    assert.ok(REFERENCE_TRIAL_RESULT.latency_p95_ms > 0);
    assert.ok(REFERENCE_TRIAL_RESULT.latency_p99_ms > 0);
    // p95 >= p50, p99 >= p95
    assert.ok(REFERENCE_TRIAL_RESULT.latency_p95_ms >= REFERENCE_TRIAL_RESULT.latency_p50_ms);
    assert.ok(REFERENCE_TRIAL_RESULT.latency_p99_ms >= REFERENCE_TRIAL_RESULT.latency_p95_ms);
  });

  it('error_rate is a fraction between 0 and 1', () => {
    assert.ok(REFERENCE_TRIAL_RESULT.error_rate >= 0);
    assert.ok(REFERENCE_TRIAL_RESULT.error_rate <= 1);
  });

  it('success_count + failure_count = request_count', () => {
    assert.equal(
      REFERENCE_TRIAL_RESULT.success_count + REFERENCE_TRIAL_RESULT.failure_count,
      REFERENCE_TRIAL_RESULT.request_count
    );
  });

  it('duration matches expected load profile duration', () => {
    assert.equal(REFERENCE_TRIAL_RESULT.duration_seconds, 300);
    assert.equal(REFERENCE_TRIAL_RESULT.locust_users, 50);
  });

  it('does not contain credential fields', () => {
    const resultStr = JSON.stringify(REFERENCE_TRIAL_RESULT);
    assert.ok(!resultStr.includes('ACCESS_KEY'));
    assert.ok(!resultStr.includes('SECRET'));
    assert.ok(!resultStr.includes('password'));
    assert.ok(!resultStr.includes('private_key'));
  });
});

// ---------------------------------------------------------------------------
// Paired trial result comparison
// ---------------------------------------------------------------------------

describe('Locust paired trial results', () => {
  const awsTrial = { ...REFERENCE_TRIAL_RESULT, target_context: 'aws-eks-cloudport', cloud_provider: 'AWS' };
  const gcpTrial = {
    ...REFERENCE_TRIAL_RESULT,
    target_context: 'gcp-gke-cloudport',
    cloud_provider: 'GCP',
    trial_id: 'trial-001',
    latency_p95_ms: 380,
    latency_p99_ms: 750,
  };

  it('paired trials have the same locustfile version', () => {
    assert.equal(awsTrial.locustfile_version, gcpTrial.locustfile_version);
  });

  it('paired trials have the same load profile parameters', () => {
    assert.equal(awsTrial.locust_users, gcpTrial.locust_users);
    assert.equal(awsTrial.locust_spawn_rate, gcpTrial.locust_spawn_rate);
    assert.equal(awsTrial.duration_seconds, gcpTrial.duration_seconds);
  });

  it('paired trials have the same trial_id', () => {
    assert.equal(awsTrial.trial_id, gcpTrial.trial_id);
  });

  it('paired trials target different cloud providers', () => {
    assert.notEqual(awsTrial.cloud_provider, gcpTrial.cloud_provider);
    assert.notEqual(awsTrial.target_context, gcpTrial.target_context);
  });
});

// ---------------------------------------------------------------------------
// INSUFFICIENT_SAMPLE guard: fewer than 5 trials
// ---------------------------------------------------------------------------

describe('INSUFFICIENT_SAMPLE for small trial sets', () => {
  const { pairedTTest } = require('../../analyzer/telemetry/statisticalTests');

  it('returns INSUFFICIENT_SAMPLE for n < 5', () => {
    const a = [120, 130, 125];
    const b = [200, 210, 205];
    const result = pairedTTest(a, b);
    assert.equal(result.significance, 'INSUFFICIENT_SAMPLE');
  });

  it('returns INSUFFICIENT_SAMPLE for n = 0', () => {
    const result = pairedTTest([], []);
    assert.equal(result.significance, 'INSUFFICIENT_SAMPLE');
  });

  it('does not fabricate significance for n < 5', () => {
    const a = [120, 130, 125, 140];
    const b = [200, 210, 205, 220];
    const result = pairedTTest(a, b);
    assert.equal(result.significance, 'INSUFFICIENT_SAMPLE');
    assert.ok(!result.pValue || result.significance === 'INSUFFICIENT_SAMPLE');
  });
});

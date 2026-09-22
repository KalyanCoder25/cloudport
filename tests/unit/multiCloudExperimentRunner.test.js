'use strict';

/**
 * Tests for MultiCloudExperimentRunner — context safety, local execution
 * rejection, provenance fields, and INSUFFICIENT_SAMPLE reporting.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MultiCloudExperimentRunner,
  MULTICLOUD_MEASUREMENT_SOURCE,
  MULTICLOUD_EXECUTION_MODE,
  CONTEXT_TO_PROVIDER,
} = require('../../application/backend/src/multiCloudExperimentRunner');

// Minimal fake query function
const fakeQuery = async () => ({ rows: [], rowCount: 0 });

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — construction', () => {
  it('requires a query function', () => {
    assert.throws(
      () => new MultiCloudExperimentRunner({}),
      (err) => {
        assert.ok(err.message.includes('requires a database query function'));
        return true;
      }
    );
  });

  it('constructs with a query function', () => {
    const runner = new MultiCloudExperimentRunner({ query: fakeQuery });
    assert.ok(runner);
  });
});

// ---------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — context validation', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  it('rejects kind-korifi context explicitly', () => {
    assert.throws(
      () => runner.validateCloudContext('kind-korifi'),
      (err) => {
        assert.ok(err.message.includes('kind-korifi'));
        assert.ok(err.message.includes('Safety violation'));
        return true;
      }
    );
  });

  it('rejects localhost context', () => {
    assert.throws(
      () => runner.validateCloudContext('localhost'),
      (err) => {
        assert.ok(err.message.includes('Safety violation'));
        return true;
      }
    );
  });

  it('rejects empty context', () => {
    assert.throws(() => runner.validateCloudContext(''));
    assert.throws(() => runner.validateCloudContext(null));
    assert.throws(() => runner.validateCloudContext(undefined));
  });

  it('rejects any context containing the word local', () => {
    assert.throws(
      () => runner.validateCloudContext('my-local-cluster'),
      (err) => {
        assert.ok(err.message.includes('Safety violation'));
        return true;
      }
    );
  });

  it('accepts aws-eks-cloudport', () => {
    assert.doesNotThrow(() => runner.validateCloudContext('aws-eks-cloudport'));
  });

  it('accepts gcp-gke-cloudport', () => {
    assert.doesNotThrow(() => runner.validateCloudContext('gcp-gke-cloudport'));
  });

  it('rejects arbitrary cloud contexts not in the authorized list', () => {
    assert.throws(() => runner.validateCloudContext('my-eks-cluster'));
    assert.throws(() => runner.validateCloudContext('gke-prod-cluster'));
  });
});

// ---------------------------------------------------------------------------
// Provider mapping
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — provider mapping', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  it('maps aws-eks-cloudport to AWS', () => {
    assert.equal(runner.getProviderForContext('aws-eks-cloudport'), 'AWS');
  });

  it('maps gcp-gke-cloudport to GCP', () => {
    assert.equal(runner.getProviderForContext('gcp-gke-cloudport'), 'GCP');
  });

  it('throws for unmapped context', () => {
    assert.throws(() => runner.getProviderForContext('kind-korifi'));
  });
});

// ---------------------------------------------------------------------------
// Execution mode constants
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — constants', () => {
  it('measurementSource is locust-kubernetes', () => {
    assert.equal(MULTICLOUD_MEASUREMENT_SOURCE, 'locust-kubernetes');
  });

  it('executionMode is MULTICLOUD_KUBERNETES', () => {
    assert.equal(MULTICLOUD_EXECUTION_MODE, 'MULTICLOUD_KUBERNETES');
  });
});

// ---------------------------------------------------------------------------
// Provenance building
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — provenance building', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  const experimentDef = {
    name: 'multicloud-portability-v1',
    infrastructureA: { clusterName: 'cloudport-capstone-eks', region: 'ap-south-1' },
    infrastructureB: { clusterName: 'cloudport-capstone-gke', region: 'asia-south1' },
    benchmark: { application: 'online-boutique', version: 'v0.10.1', deploymentMethod: 'kustomize', namespace: 'online-boutique' },
    loadProfile: { tool: 'locust', locustfileVersion: 'multicloud-portability-v1', users: 50, spawnRate: 5, durationSeconds: 300 },
  };

  it('provenance includes all required fields', () => {
    const provenance = runner._buildProvenance({
      experimentId: 'exp-001',
      contextA: 'aws-eks-cloudport',
      contextB: 'gcp-gke-cloudport',
      providerA: 'AWS',
      providerB: 'GCP',
      experimentDef,
      experimentStartedAt: '2026-09-04T00:00:00Z',
      experimentCompletedAt: '2026-09-04T01:00:00Z',
    });

    assert.equal(provenance.experimentId, 'exp-001');
    assert.equal(provenance.executionMode, 'MULTICLOUD_KUBERNETES');
    assert.equal(provenance.measurementSource, 'locust-kubernetes');
    assert.equal(provenance.infrastructureA.cloudProvider, 'AWS');
    assert.equal(provenance.infrastructureA.kubernetesContext, 'aws-eks-cloudport');
    assert.equal(provenance.infrastructureB.cloudProvider, 'GCP');
    assert.equal(provenance.infrastructureB.kubernetesContext, 'gcp-gke-cloudport');
    assert.equal(provenance.benchmark.application, 'online-boutique');
    assert.equal(provenance.benchmark.version, 'v0.10.1');
    assert.equal(provenance.loadProfile.tool, 'locust');
    assert.equal(provenance.loadProfile.users, 50);
    assert.ok(provenance.startTimestamp);
    assert.ok(provenance.endTimestamp);
  });

  it('provenance does not expose AWS/GCP secrets', () => {
    const provenance = runner._buildProvenance({
      experimentId: 'exp-002',
      contextA: 'aws-eks-cloudport',
      contextB: 'gcp-gke-cloudport',
      providerA: 'AWS',
      providerB: 'GCP',
      experimentDef,
      experimentStartedAt: '2026-09-04T00:00:00Z',
      experimentCompletedAt: '2026-09-04T01:00:00Z',
    });
    const provenanceStr = JSON.stringify(provenance);
    assert.ok(!provenanceStr.includes('ACCESS_KEY'));
    assert.ok(!provenanceStr.includes('SECRET'));
    assert.ok(!provenanceStr.includes('password'));
    assert.ok(!provenanceStr.includes('private_key'));
  });
});

// ---------------------------------------------------------------------------
// Incomplete result (no trials)
// ---------------------------------------------------------------------------

describe('MultiCloudExperimentRunner — incomplete result', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  it('returns AWAITING_TRIALS status when no trial results exist', () => {
    const result = runner._buildIncompleteResult({
      experimentId: 'exp-003',
      reason: 'NO_TRIAL_RESULTS — run Locust trials first',
      experimentStartedAt: new Date().toISOString(),
      contextA: 'aws-eks-cloudport',
      contextB: 'gcp-gke-cloudport',
      providerA: 'AWS',
      providerB: 'GCP',
    });

    assert.equal(result.status, 'AWAITING_TRIALS');
    assert.equal(result.measurementSource, 'locust-kubernetes');
    assert.ok(result.reason.includes('NO_TRIAL_RESULTS'));
    assert.ok(result.note);
  });

  it('does not fabricate measurements in incomplete result', () => {
    const result = runner._buildIncompleteResult({
      experimentId: 'exp-004',
      reason: 'NO_TRIAL_RESULTS',
      experimentStartedAt: new Date().toISOString(),
    });
    // No leakage score, no statistical result, no latency values
    assert.equal(result.leakageResult, undefined);
    assert.equal(result.statisticalResult, undefined);
    assert.equal(result.latencyP95Aws, undefined);
  });
});

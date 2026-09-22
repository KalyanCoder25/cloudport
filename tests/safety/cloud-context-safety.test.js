'use strict';

/**
 * Safety tests for multi-cloud context handling.
 *
 * Ensures that:
 *   - AWS and GCP contexts cannot be confused (cross-cloud safety)
 *   - kind-korifi cannot be used for multi-cloud experiments
 *   - local execution is structurally prevented
 *   - credential fields never appear in provenance
 *   - benchmark namespace never conflicts with CloudPort/Korifi namespaces
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTHORIZED_MULTICLOUD_CONTEXTS,
  BENCHMARK_NAMESPACE,
  PROTECTED_NAMESPACES,
} = require('../../analyzer/infrastructure/multiCloudK8sClient');

const {
  MultiCloudExperimentRunner,
  CONTEXT_TO_PROVIDER,
} = require('../../application/backend/src/multiCloudExperimentRunner');

const {
  AUTHORIZED_MULTICLOUD_CONTEXTS: INSPECTOR_CONTEXTS,
} = require('../../analyzer/infrastructure/multiCloudInspector');

const fakeQuery = async () => ({ rows: [], rowCount: 0 });

// ---------------------------------------------------------------------------
// Cross-cloud confusion prevention
// ---------------------------------------------------------------------------

describe('Cloud context safety — cross-cloud confusion', () => {
  it('aws-eks-cloudport maps only to AWS, never GCP', () => {
    assert.equal(CONTEXT_TO_PROVIDER['aws-eks-cloudport'], 'AWS');
    assert.notEqual(CONTEXT_TO_PROVIDER['aws-eks-cloudport'], 'GCP');
  });

  it('gcp-gke-cloudport maps only to GCP, never AWS', () => {
    assert.equal(CONTEXT_TO_PROVIDER['gcp-gke-cloudport'], 'GCP');
    assert.notEqual(CONTEXT_TO_PROVIDER['gcp-gke-cloudport'], 'AWS');
  });

  it('aws-eks-cluster alias maps only to AWS', () => {
    assert.equal(CONTEXT_TO_PROVIDER['aws-eks-cluster'], 'AWS');
    assert.notEqual(CONTEXT_TO_PROVIDER['aws-eks-cluster'], 'GCP');
  });

  it('gcp-gke-cluster alias maps only to GCP', () => {
    assert.equal(CONTEXT_TO_PROVIDER['gcp-gke-cluster'], 'GCP');
    assert.notEqual(CONTEXT_TO_PROVIDER['gcp-gke-cluster'], 'AWS');
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS includes canonicals and aliases', () => {
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('aws-eks-cloudport'));
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('gcp-gke-cloudport'));
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('aws-eks-cluster'));
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('gcp-gke-cluster'));
  });

  it('runner accepts canonical contexts and aliases', () => {
    const runner = new MultiCloudExperimentRunner({ query: fakeQuery });
    assert.doesNotThrow(() => runner.validateCloudContext('aws-eks-cloudport'));
    assert.doesNotThrow(() => runner.validateCloudContext('gcp-gke-cloudport'));
    assert.doesNotThrow(() => runner.validateCloudContext('aws-eks-cluster'));
    assert.doesNotThrow(() => runner.validateCloudContext('gcp-gke-cluster'));
  });
});

// ---------------------------------------------------------------------------
// kind-korifi isolation
// ---------------------------------------------------------------------------

describe('Cloud context safety — kind-korifi isolation', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  it('kind-korifi is not in AUTHORIZED_MULTICLOUD_CONTEXTS', () => {
    assert.ok(!AUTHORIZED_MULTICLOUD_CONTEXTS.includes('kind-korifi'));
  });

  it('kind-korifi is not in multiCloudInspector authorized contexts', () => {
    assert.ok(!INSPECTOR_CONTEXTS.includes('kind-korifi'));
  });

  it('validateCloudContext throws for kind-korifi with clear message', () => {
    assert.throws(
      () => runner.validateCloudContext('kind-korifi'),
      (err) => {
        assert.match(err.message, /kind-korifi/);
        assert.match(err.message, /Safety violation/);
        return true;
      }
    );
  });

  it('kind-korifi has no entry in CONTEXT_TO_PROVIDER', () => {
    assert.equal(CONTEXT_TO_PROVIDER['kind-korifi'], undefined);
  });
});

// ---------------------------------------------------------------------------
// Local execution prevention
// ---------------------------------------------------------------------------

describe('Cloud context safety — local execution prevention', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  const localContexts = ['localhost', '', 'local', 'my-local-cluster', '127.0.0.1', null, undefined];

  for (const ctx of localContexts) {
    it(`rejects local-like context: "${ctx}"`, () => {
      assert.throws(() => runner.validateCloudContext(ctx));
    });
  }
});

// ---------------------------------------------------------------------------
// Namespace safety
// ---------------------------------------------------------------------------

describe('Cloud context safety — namespace safety', () => {
  it('BENCHMARK_NAMESPACE (online-boutique) is not a protected namespace', () => {
    // online-boutique should be a fresh, experiment-specific namespace
    assert.ok(!PROTECTED_NAMESPACES.includes('online-boutique'));
  });

  it('BENCHMARK_NAMESPACE does not conflict with cloudport namespace', () => {
    assert.notEqual(BENCHMARK_NAMESPACE, 'cloudport');
  });

  it('BENCHMARK_NAMESPACE does not conflict with Korifi namespaces', () => {
    const korifiNamespaces = ['cf', 'korifi', 'korifi-gateway', 'kpack', 'cert-manager'];
    for (const ns of korifiNamespaces) {
      assert.notEqual(BENCHMARK_NAMESPACE, ns);
    }
  });

  it('BENCHMARK_NAMESPACE does not conflict with kube-system', () => {
    assert.notEqual(BENCHMARK_NAMESPACE, 'kube-system');
  });
});

// ---------------------------------------------------------------------------
// Credential safety in provenance
// ---------------------------------------------------------------------------

describe('Cloud context safety — credential safety', () => {
  const runner = new MultiCloudExperimentRunner({ query: fakeQuery });

  it('provenance never contains credential-like keys', () => {
    const provenance = runner._buildProvenance({
      experimentId: 'exp-safety-001',
      contextA: 'aws-eks-cloudport',
      contextB: 'gcp-gke-cloudport',
      providerA: 'AWS',
      providerB: 'GCP',
      experimentDef: {
        name: 'multicloud-portability-v1',
        infrastructureA: { clusterName: 'eks', region: 'ap-south-1' },
        infrastructureB: { clusterName: 'gke', region: 'asia-south1' },
        benchmark: { application: 'online-boutique', version: 'v0.10.1', deploymentMethod: 'kustomize', namespace: 'online-boutique' },
        loadProfile: { tool: 'locust', locustfileVersion: 'v1', users: 50, spawnRate: 5, durationSeconds: 300 },
      },
      experimentStartedAt: new Date().toISOString(),
      experimentCompletedAt: new Date().toISOString(),
    });

    const json = JSON.stringify(provenance).toLowerCase();
    const forbiddenTerms = ['access_key', 'secret_key', 'private_key', 'password', 'token', 'credential'];
    for (const term of forbiddenTerms) {
      assert.ok(!json.includes(term), `Provenance should not contain "${term}"`);
    }
  });
});

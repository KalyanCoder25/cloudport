'use strict';

/**
 * Tests for MultiCloudK8sClient — context validation and provider detection.
 *
 * These tests run without a live Kubernetes cluster by passing a
 * mock kubeconfig / mock kc object through dependency injection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// We test the validation logic by importing the module and exercising
// its constructor and methods with injected options.

const {
  MultiCloudK8sClient,
  AUTHORIZED_MULTICLOUD_CONTEXTS,
  BENCHMARK_NAMESPACE,
} = require('../../analyzer/infrastructure/multiCloudK8sClient');

// ---------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------

describe('MultiCloudK8sClient — context validation', () => {
  it('rejects kind-korifi context with explicit safety message', () => {
    assert.throws(
      () => new MultiCloudK8sClient({ context: 'kind-korifi' }),
      (err) => {
        assert.ok(err.message.includes('kind-korifi'));
        assert.ok(err.message.includes('Safety violation'));
        return true;
      }
    );
  });

  it('rejects localhost context', () => {
    assert.throws(
      () => new MultiCloudK8sClient({ context: 'localhost' }),
      (err) => {
        assert.ok(err.message.includes('Safety violation'));
        return true;
      }
    );
  });

  it('rejects empty string context', () => {
    assert.throws(
      () => new MultiCloudK8sClient({ context: '' }),
      (err) => {
        assert.ok(err.message.includes('MultiCloudK8sClient requires a context'));
        return true;
      }
    );
  });

  it('rejects null/undefined context', () => {
    assert.throws(() => new MultiCloudK8sClient({ context: null }));
    assert.throws(() => new MultiCloudK8sClient({}));
  });

  it('rejects arbitrary unauthorized contexts', () => {
    assert.throws(
      () => new MultiCloudK8sClient({ context: 'my-random-cluster' }),
      (err) => {
        assert.ok(err.message.includes('not authorized'));
        return true;
      }
    );
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS does not include kind-korifi', () => {
    assert.ok(!AUTHORIZED_MULTICLOUD_CONTEXTS.includes('kind-korifi'));
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS includes aws-eks-cloudport', () => {
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('aws-eks-cloudport'));
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS includes gcp-gke-cloudport', () => {
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('gcp-gke-cloudport'));
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS includes aws-eks-cluster alias', () => {
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('aws-eks-cluster'));
  });

  it('AUTHORIZED_MULTICLOUD_CONTEXTS includes gcp-gke-cluster alias', () => {
    assert.ok(AUTHORIZED_MULTICLOUD_CONTEXTS.includes('gcp-gke-cluster'));
  });
});

// ---------------------------------------------------------------------------
// Provider detection from node labels
// ---------------------------------------------------------------------------

describe('MultiCloudK8sClient — provider detection', () => {
  /**
   * Create a minimal stub client for testing detectCloudProvider()
   * without triggering kubeconfig loading.
   */
  function makeStubClient() {
    // We can't call the constructor without a kubeconfig, so we test
    // detectCloudProvider() via a prototype call on a plain object.
    const proto = MultiCloudK8sClient.prototype;
    const stub = Object.create(proto);
    return stub;
  }

  it('detects AWS from eks.amazonaws.com/nodegroup label', () => {
    const stub = makeStubClient();
    const nodes = [
      { metadata: { labels: { 'eks.amazonaws.com/nodegroup': 'cloudport-capstone-eks-ng' } } },
    ];
    assert.equal(stub.detectCloudProvider(nodes), 'AWS');
  });

  it('detects AWS from eks.amazonaws.com/capacityType label', () => {
    const stub = makeStubClient();
    const nodes = [
      { metadata: { labels: { 'eks.amazonaws.com/capacityType': 'ON_DEMAND' } } },
    ];
    assert.equal(stub.detectCloudProvider(nodes), 'AWS');
  });

  it('detects GCP from cloud.google.com/gke-nodepool label', () => {
    const stub = makeStubClient();
    const nodes = [
      { metadata: { labels: { 'cloud.google.com/gke-nodepool': 'cloudport-capstone-gke-np' } } },
    ];
    assert.equal(stub.detectCloudProvider(nodes), 'GCP');
  });

  it('detects GCP from topology.gke.io/zone label', () => {
    const stub = makeStubClient();
    const nodes = [
      { metadata: { labels: { 'topology.gke.io/zone': 'us-central1-a' } } },
    ];
    assert.equal(stub.detectCloudProvider(nodes), 'GCP');
  });

  it('returns UNKNOWN for nodes with no recognized provider labels', () => {
    const stub = makeStubClient();
    const nodes = [{ metadata: { labels: { 'kubernetes.io/hostname': 'my-node' } } }];
    assert.equal(stub.detectCloudProvider(nodes), 'UNKNOWN');
  });

  it('returns UNKNOWN for empty nodes array', () => {
    const stub = makeStubClient();
    assert.equal(stub.detectCloudProvider([]), 'UNKNOWN');
  });

  it('returns UNKNOWN for null nodes', () => {
    const stub = makeStubClient();
    assert.equal(stub.detectCloudProvider(null), 'UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// BENCHMARK_NAMESPACE safety
// ---------------------------------------------------------------------------

describe('MultiCloudK8sClient — namespace constants', () => {
  it('BENCHMARK_NAMESPACE is online-boutique (never cloudport or korifi)', () => {
    assert.equal(BENCHMARK_NAMESPACE, 'online-boutique');
    assert.notEqual(BENCHMARK_NAMESPACE, 'cloudport');
    assert.notEqual(BENCHMARK_NAMESPACE, 'korifi');
    assert.notEqual(BENCHMARK_NAMESPACE, 'kube-system');
  });
});

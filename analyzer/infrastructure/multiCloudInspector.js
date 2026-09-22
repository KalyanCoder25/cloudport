/**
 * Multi-Cloud Infrastructure Inspector
 *
 * Follows the same lazy-factory pattern as the existing inspector.js (kind-korifi),
 * but targets AWS EKS and GCP GKE clusters via MultiCloudK8sClient.
 *
 * LAZINESS CONTRACT: Constructing a MultiCloudInspector instance MUST NOT
 * create a Kubernetes client or open any network connection. A live client
 * is only created inside captureSnapshot(), and only the first time it is called.
 * This mirrors the safety contract enforced for the local inspector.
 *
 * CONTEXT VALIDATION: The inspector always validates the Kubernetes context
 * before any network call. It rejects kind-korifi and any unauthorized context.
 *
 * MEASUREMENT SOURCE: All snapshots from this inspector carry
 * measurementSource: 'locust-kubernetes' — they are combined with Locust
 * load results, not with kubectl exec pod results.
 */
'use strict';

const { MultiCloudK8sClient, AUTHORIZED_MULTICLOUD_CONTEXTS } = require('./multiCloudK8sClient');

class MultiCloudInspector {
  /**
   * @param {object} [options]
   * @param {string} options.context - Authorized Kubernetes context name.
   * @param {() => MultiCloudK8sClient} [options.clientFactory] - Lazy client factory.
   *   Defaults to a factory that validates the context and creates a live client.
   */
  constructor(options = {}) {
    const { context, clientFactory } = options;
    this.context = context;
    this._client = null; // never built in constructor (laziness contract)

    if (clientFactory) {
      this._clientFactory = clientFactory;
    } else if (context) {
      this._clientFactory = () =>
        new MultiCloudK8sClient({ context });
    } else {
      this._clientFactory = () => {
        throw new Error(
          'MultiCloudInspector requires a context. ' +
            `Authorized: ${AUTHORIZED_MULTICLOUD_CONTEXTS.join(', ')}`
        );
      };
    }
  }

  _getClient() {
    if (!this._client) {
      this._client = this._clientFactory();
    }
    return this._client;
  }

  /**
   * Capture a live infrastructure snapshot from the cloud cluster.
   * This is the ONLY method permitted to touch the network.
   *
   * @returns {Promise<object>} normalized infrastructure profile
   */
  async captureSnapshot() {
    const client = this._getClient();
    const raw = await client.describeInfrastructure();
    return normalizeMultiCloudProfile(raw);
  }
}

/**
 * Normalize a raw multi-cloud infrastructure description into a form
 * compatible with the existing CloudPort evidence/reporting pipeline,
 * while preserving multi-cloud-specific fields (cloudProvider, loadBalancers,
 * allocatable resources).
 */
function normalizeMultiCloudProfile(raw) {
  return {
    kubernetesContext: raw.kubernetesContext,
    cloudProvider: raw.cloudProvider || 'UNKNOWN',
    kubernetesVersion: raw.kubernetesVersion ?? null,
    nodes: (raw.nodes || []).map((n) => ({
      name: n.name,
      cpuCapacity: n.cpuCapacity ?? null,
      memoryCapacity: n.memoryCapacity ?? null,
      cpuAllocatable: n.cpuAllocatable ?? null,
      memoryAllocatable: n.memoryAllocatable ?? null,
      ready: n.ready ?? false,
      instanceType: n.instanceType ?? null,
      zone: n.zone ?? null,
    })),
    storageClasses: (raw.storageClasses || []).map((sc) => ({
      name: sc.name,
      provisioner: sc.provisioner,
      volumeBindingMode: sc.volumeBindingMode ?? null,
      reclaimPolicy: sc.reclaimPolicy ?? null,
      allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
      parameters: sc.parameters || {},
    })),
    persistentVolumes: raw.persistentVolumes || [],
    persistentVolumeClaims: raw.persistentVolumeClaims || [],
    services: raw.services || [],
    deployments: raw.deployments || [],
    pods: raw.pods || [],
    ingresses: raw.ingresses || [],
    loadBalancers: raw.loadBalancers || [],
    resourceQuotas: raw.resourceQuotas || [],
    limitRanges: raw.limitRanges || [],
    availability: raw.availability ?? 'UNKNOWN',
    capturedAt: raw.capturedAt || new Date().toISOString(),
    source: 'LIVE',
    measurementSource: 'locust-kubernetes',
  };
}

/**
 * Build a NOT_VERIFIED placeholder for when cloud credentials are not
 * configured. Never presented as real measurement data.
 *
 * @param {string} context - Kubernetes context name
 * @param {string} [cloudProvider] - 'AWS' | 'GCP'
 */
function notVerifiedMultiCloudProfile(context, cloudProvider = 'UNKNOWN') {
  return {
    kubernetesContext: context,
    cloudProvider,
    kubernetesVersion: null,
    nodes: [],
    storageClasses: [],
    persistentVolumes: [],
    persistentVolumeClaims: [],
    services: [],
    deployments: [],
    pods: [],
    ingresses: [],
    loadBalancers: [],
    resourceQuotas: [],
    limitRanges: [],
    availability: 'NOT_VERIFIED',
    capturedAt: new Date().toISOString(),
    source: 'NOT_VERIFIED',
    measurementSource: 'locust-kubernetes',
    note: `NOT VERIFIED — Cloud cluster not reachable. Context: ${context}. ` +
      'Run infra/contexts/configure-contexts.sh after terraform apply to configure access.',
  };
}

function createMultiCloudInspector(options = {}) {
  return new MultiCloudInspector(options);
}

module.exports = {
  MultiCloudInspector,
  createMultiCloudInspector,
  normalizeMultiCloudProfile,
  notVerifiedMultiCloudProfile,
  AUTHORIZED_MULTICLOUD_CONTEXTS,
};

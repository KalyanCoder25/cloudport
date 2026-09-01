/**
 * Infrastructure Inspector
 *
 * IMPORTANT: This module must remain LAZY. Constructing an InfrastructureInspector
 * instance MUST NOT create a Kubernetes client or open any network connection.
 * A live Kubernetes client is only created inside captureSnapshot(), and only
 * the first time it is actually called.
 *
 * This property is enforced by tests/safety/no-live-k8s-on-differences.test.js,
 * which spies on this module and fails if captureSnapshot() (or the underlying
 * client factory) is invoked by a request path that should only use persisted
 * evidence (e.g. GET /api/analyzer/experiments/:id/differences).
 */
'use strict';

class InfrastructureInspector {
  /**
   * @param {object} [options]
   * @param {() => object} [options.clientFactory] - factory that lazily builds a
   *   Kubernetes API client (e.g. from @kubernetes/client-node). Not invoked
   *   until captureSnapshot() is called. Defaults to a factory that throws a
   *   clear error, since this sandbox has no live cluster to connect to.
   */
  constructor(options = {}) {
    this._clientFactory =
      options.clientFactory ||
      (() => {
        throw new Error(
          'No live Kubernetes client factory configured. ' +
            'CloudPort refuses to fabricate infrastructure snapshots -- ' +
            'configure a real @kubernetes/client-node client to enable live inspection.'
        );
      });
    this._client = null; // intentionally not built in the constructor (laziness contract)
  }

  _getClient() {
    if (!this._client) {
      this._client = this._clientFactory();
    }
    return this._client;
  }

  /**
   * Capture a live infrastructure snapshot. This is the ONLY method in this
   * class permitted to touch the network / Kubernetes API.
   *
   * @param {'A'|'B'} infrastructure
   * @returns {Promise<object>} normalized infrastructure profile
   */
  async captureSnapshot(infrastructure) {
    const client = this._getClient();
    const raw = await client.describeInfrastructure(infrastructure);
    return normalizeProfile(raw);
  }
}

/**
 * Normalize a raw, provider-specific infrastructure description into the
 * canonical shape used everywhere else in CloudPort (difference detection,
 * evidence artifacts, reports).
 */
function normalizeProfile(raw) {
  return {
    kubernetesVersion: raw.kubernetesVersion ?? null,
    nodes: (raw.nodes || []).map((n) => ({
      name: n.name,
      cpuCapacity: n.cpuCapacity ?? null,
      memoryCapacity: n.memoryCapacity ?? null,
    })),
    storageClasses: (raw.storageClasses || []).map((sc) => ({
      name: sc.name,
      provisioner: sc.provisioner,
      volumeBindingMode: sc.volumeBindingMode ?? null,
      reclaimPolicy: sc.reclaimPolicy ?? null,
      parameters: sc.parameters || {},
    })),
    networkPolicies: raw.networkPolicies || [],
    services: raw.services || [],
    ingressClasses: raw.ingressClasses || [],
    resourceQuotas: raw.resourceQuotas || [],
    limitRanges: raw.limitRanges || [],
    availability: raw.availability ?? 'UNKNOWN',
    capturedAt: new Date().toISOString(),
    source: 'LIVE',
  };
}

/**
 * Build a NOT_VERIFIED placeholder profile for environments without a live
 * cluster. Never presented as real measurement data -- always tagged.
 */
function notVerifiedProfile(infrastructure) {
  return {
    infrastructure,
    kubernetesVersion: null,
    nodes: [],
    storageClasses: [],
    networkPolicies: [],
    services: [],
    ingressClasses: [],
    resourceQuotas: [],
    limitRanges: [],
    availability: 'NOT_VERIFIED',
    capturedAt: new Date().toISOString(),
    source: 'NOT_VERIFIED',
    note: 'NOT VERIFIED — REQUIRES HOST ENVIRONMENT (no live Kubernetes cluster reachable)',
  };
}

module.exports = { InfrastructureInspector, normalizeProfile, notVerifiedProfile };

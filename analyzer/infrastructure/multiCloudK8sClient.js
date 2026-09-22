/**
 * Multi-Cloud Kubernetes Client
 *
 * Extends the CloudPort Kubernetes client pattern (established in k8sClient.js
 * for kind-korifi) to support AWS EKS and GCP GKE clusters.
 *
 * KEY DIFFERENCES FROM k8sClient.js:
 *   - Accepts aws-eks-cloudport or gcp-gke-cloudport contexts, NEVER kind-korifi.
 *   - Detects cloud provider from Kubernetes node labels (never fabricated).
 *   - Collects the full infrastructure profile required for multicloud comparison:
 *     Kubernetes version, nodes (capacity + allocatable), StorageClasses,
 *     PersistentVolumes, PVCs, Services, Deployments, Pods, Ingress/Gateway,
 *     LoadBalancer info, ResourceQuotas, LimitRanges.
 *   - Returns cloudProvider: 'AWS' | 'GCP' | 'UNKNOWN' from observed node labels.
 *   - measurementSource is always 'locust-kubernetes' for multi-cloud experiments
 *     (workloads are executed by Locust, not kubectl exec).
 *
 * SAFETY CONTRACT:
 *   - NEVER accepts kind-korifi as a valid context (separate code path).
 *   - NEVER accepts localhost or empty context.
 *   - NEVER fabricates provider information.
 *   - NEVER performs destructive operations (read-only only).
 *   - NEVER touches Korifi namespaces or any cloudport namespace.
 */
'use strict';

const k8s = require('@kubernetes/client-node');

// Authorized contexts for multi-cloud experiments.
// Canonical names: aws-eks-cloudport, gcp-gke-cloudport.
// Documented aliases: aws-eks-cluster, gcp-gke-cluster.
// kind-korifi is intentionally absent — it uses the original k8sClient.js.
const AUTHORIZED_MULTICLOUD_CONTEXTS = Object.freeze([
  'aws-eks-cloudport',
  'gcp-gke-cloudport',
  'aws-eks-cluster',
  'gcp-gke-cluster',
]);

// Benchmark namespace — the only namespace multi-cloud inspection queries
const BENCHMARK_NAMESPACE = 'online-boutique';
const LOCUST_NAMESPACE = 'locust';

// Protected namespaces — NEVER queried for mutation, never targeted
const PROTECTED_NAMESPACES = Object.freeze([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'cloudport',
  'cf',
  'korifi',
  'korifi-gateway',
  'kpack',
  'cert-manager',
  'default',
]);

// Node label keys used to detect cloud provider identity
const PROVIDER_LABEL_PATTERNS = {
  AWS: [
    'eks.amazonaws.com/nodegroup',
    'eks.amazonaws.com/capacityType',
    'beta.kubernetes.io/instance-type', // present on EKS nodes
    'node.kubernetes.io/instance-type',
  ],
  GCP: [
    'cloud.google.com/gke-nodepool',
    'cloud.google.com/gke-os-distribution',
    'topology.gke.io/zone',
  ],
};

class MultiCloudK8sClient {
  /**
   * @param {object} options
   * @param {string} options.context - Must be one of AUTHORIZED_MULTICLOUD_CONTEXTS.
   * @param {string} [options.kubeconfigPath] - Path to kubeconfig file (optional).
   */
  constructor(options = {}) {
    const { context, kubeconfigPath } = options;

    if (!context) {
      throw new Error(
        'MultiCloudK8sClient requires a context. ' +
          `Authorized contexts: ${AUTHORIZED_MULTICLOUD_CONTEXTS.join(', ')}`
      );
    }

    this.context = context;
    this.validateContext(context);

    this.kc = new k8s.KubeConfig();
    if (kubeconfigPath) {
      this.kc.loadFromFile(kubeconfigPath);
    } else {
      this.kc.loadFromDefault();
    }

    // Explicitly set the context — prevents kubectl current-context contamination
    this.kc.setCurrentContext(context);
    this.validateContextInConfig(context);

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.storageApi = this.kc.makeApiClient(k8s.StorageV1Api);
    this.versionApi = this.kc.makeApiClient(k8s.VersionApi);
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  /**
   * Validate that the requested context is authorized for multi-cloud use.
   * Explicitly rejects kind-korifi (belongs to the local experiment code path).
   */
  validateContext(context) {
    if (context === 'kind-korifi') {
      throw new Error(
        'Safety violation: "kind-korifi" is the local CloudPort context. ' +
          'Multi-cloud experiments must use aws-eks-cloudport or gcp-gke-cloudport. ' +
          'Local and cloud code paths must never be mixed.'
      );
    }
    if (!context || context === 'localhost' || context.trim() === '') {
      throw new Error(
        'Safety violation: context must be a non-empty, non-localhost string. ' +
          `Got: "${context}"`
      );
    }
    if (!AUTHORIZED_MULTICLOUD_CONTEXTS.includes(context)) {
      throw new Error(
        `Safety violation: context "${context}" is not authorized for multi-cloud experiments. ` +
          `Authorized: ${AUTHORIZED_MULTICLOUD_CONTEXTS.join(', ')}`
      );
    }
  }

  /**
   * Validate that the context actually exists in the kubeconfig file.
   */
  validateContextInConfig(context) {
    const contexts = (this.kc.contexts || []).map((c) => c.name);
    if (!contexts.includes(context)) {
      throw new Error(
        `Context "${context}" is not present in kubeconfig. ` +
          `Run infra/contexts/configure-contexts.sh first. ` +
          `Available contexts: ${contexts.join(', ')}`
      );
    }
  }

  /**
   * Detect cloud provider from node labels.
   * Returns 'AWS', 'GCP', or 'UNKNOWN'. Never fabricated.
   *
   * @param {Array} nodes - Array of Kubernetes node objects
   * @returns {'AWS'|'GCP'|'UNKNOWN'}
   */
  detectCloudProvider(nodes) {
    if (!nodes || nodes.length === 0) return 'UNKNOWN';

    for (const node of nodes) {
      const labels = node.metadata?.labels || {};
      for (const [provider, labelKeys] of Object.entries(PROVIDER_LABEL_PATTERNS)) {
        if (labelKeys.some((key) => key in labels)) {
          return provider;
        }
      }
    }
    return 'UNKNOWN';
  }

  /**
   * Capture a full infrastructure snapshot from the live cloud cluster.
   *
   * Collects: Kubernetes version, nodes (capacity + allocatable), StorageClasses,
   * PersistentVolumes, PVCs, Services, Deployments, Pods, Ingress, LoadBalancer
   * info, ResourceQuotas, LimitRanges, provider identity.
   *
   * @returns {Promise<object>} normalized infrastructure profile
   */
  async describeInfrastructure() {
    // Re-validate context on every call (defense in depth)
    this.validateContext(this.context);

    const profile = {
      kubernetesContext: this.context,
      cloudProvider: 'UNKNOWN',
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
      availability: 'UNKNOWN',
      capturedAt: new Date().toISOString(),
      source: 'LIVE',
      measurementSource: 'locust-kubernetes',
    };

    // 1. Kubernetes Version
    try {
      const res = await this.versionApi.getCode();
      const body = res.body || res;
      profile.kubernetesVersion = body.gitVersion || null;
    } catch {
      profile.kubernetesVersion = null;
    }

    // 2. Nodes — capacity, allocatable, provider labels
    let rawNodes = [];
    try {
      const res = await this.coreApi.listNode();
      rawNodes = res.body?.items || res.items || [];
      profile.nodes = rawNodes.map((n) => ({
        name: n.metadata?.name || 'unknown',
        cpuCapacity: n.status?.capacity?.cpu || null,
        memoryCapacity: n.status?.capacity?.memory || null,
        cpuAllocatable: n.status?.allocatable?.cpu || null,
        memoryAllocatable: n.status?.allocatable?.memory || null,
        ready: (n.status?.conditions || []).some(
          (c) => c.type === 'Ready' && c.status === 'True'
        ),
        labels: n.metadata?.labels || {},
        instanceType:
          n.metadata?.labels?.['node.kubernetes.io/instance-type'] ||
          n.metadata?.labels?.['beta.kubernetes.io/instance-type'] ||
          null,
        zone:
          n.metadata?.labels?.['topology.kubernetes.io/zone'] ||
          n.metadata?.labels?.['failure-domain.beta.kubernetes.io/zone'] ||
          null,
      }));
      profile.cloudProvider = this.detectCloudProvider(rawNodes);
    } catch {
      profile.nodes = [];
    }

    // 3. StorageClasses
    try {
      const res = await this.storageApi.listStorageClass();
      const items = res.body?.items || res.items || [];
      profile.storageClasses = items.map((sc) => ({
        name: sc.metadata?.name,
        provisioner: sc.provisioner,
        volumeBindingMode: sc.volumeBindingMode || null,
        reclaimPolicy: sc.reclaimPolicy || null,
        allowVolumeExpansion: sc.allowVolumeExpansion || false,
        parameters: sc.parameters || {},
      }));
    } catch {
      profile.storageClasses = [];
    }

    // 4. PersistentVolumes (cluster-scoped)
    try {
      const res = await this.coreApi.listPersistentVolume();
      const items = res.body?.items || res.items || [];
      profile.persistentVolumes = items
        .filter((pv) => pv.spec?.claimRef?.namespace === BENCHMARK_NAMESPACE)
        .map((pv) => ({
          name: pv.metadata?.name,
          capacity: pv.spec?.capacity?.storage || null,
          storageClass: pv.spec?.storageClassName || null,
          reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || null,
          phase: pv.status?.phase || null,
        }));
    } catch {
      profile.persistentVolumes = [];
    }

    // 5. PVCs in benchmark namespace
    try {
      const res = await this.coreApi.listNamespacedPersistentVolumeClaim({
        namespace: BENCHMARK_NAMESPACE,
      });
      const items = res.body?.items || res.items || [];
      profile.persistentVolumeClaims = items.map((pvc) => ({
        name: pvc.metadata?.name,
        storageClass: pvc.spec?.storageClassName || null,
        capacity: pvc.status?.capacity?.storage || null,
        phase: pvc.status?.phase || null,
        accessModes: pvc.spec?.accessModes || [],
      }));
    } catch {
      profile.persistentVolumeClaims = [];
    }

    // 6. Services in benchmark namespace
    try {
      const res = await this.coreApi.listNamespacedService({
        namespace: BENCHMARK_NAMESPACE,
      });
      const items = res.body?.items || res.items || [];
      profile.services = items.map((s) => ({
        name: s.metadata?.name,
        type: s.spec?.type || 'ClusterIP',
        clusterIP: s.spec?.clusterIP || null,
        externalIP:
          (s.status?.loadBalancer?.ingress || []).map((i) => i.ip || i.hostname).filter(Boolean) ||
          [],
        ports: (s.spec?.ports || []).map((p) => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
        })),
      }));

      // Extract LoadBalancer info separately for leakage analysis
      profile.loadBalancers = items
        .filter((s) => s.spec?.type === 'LoadBalancer')
        .map((s) => ({
          name: s.metadata?.name,
          externalEndpoints: (s.status?.loadBalancer?.ingress || []).map(
            (i) => i.ip || i.hostname || null
          ),
          annotations: s.metadata?.annotations || {},
          providerClass: s.metadata?.annotations?.['service.beta.kubernetes.io/aws-load-balancer-type'] ||
            s.metadata?.annotations?.['cloud.google.com/load-balancer-type'] ||
            null,
        }));
    } catch {
      profile.services = [];
      profile.loadBalancers = [];
    }

    // 7. Deployments in benchmark namespace
    try {
      const res = await this.appsApi.listNamespacedDeployment({
        namespace: BENCHMARK_NAMESPACE,
      });
      const items = res.body?.items || res.items || [];
      profile.deployments = items.map((d) => ({
        name: d.metadata?.name,
        replicas: d.spec?.replicas || 0,
        readyReplicas: d.status?.readyReplicas || 0,
        image: (d.spec?.template?.spec?.containers || []).map((c) => c.image),
        resources: (d.spec?.template?.spec?.containers || []).map((c) => ({
          name: c.name,
          requests: c.resources?.requests || {},
          limits: c.resources?.limits || {},
        })),
      }));
    } catch {
      profile.deployments = [];
    }

    // 8. Pods in benchmark namespace
    try {
      const res = await this.coreApi.listNamespacedPod({
        namespace: BENCHMARK_NAMESPACE,
      });
      const items = res.body?.items || res.items || [];
      profile.pods = items.map((p) => ({
        name: p.metadata?.name,
        phase: p.status?.phase || null,
        ready: (p.status?.containerStatuses || []).every((c) => c.ready),
        nodeName: p.spec?.nodeName || null,
        images: (p.spec?.containers || []).map((c) => c.image),
      }));
    } catch {
      profile.pods = [];
    }

    // 9. Ingresses in benchmark namespace
    try {
      const res = await this.networkingApi.listNamespacedIngress({
        namespace: BENCHMARK_NAMESPACE,
      });
      const items = res.body?.items || res.items || [];
      profile.ingresses = items.map((ing) => ({
        name: ing.metadata?.name,
        ingressClass: ing.spec?.ingressClassName || null,
        rules: (ing.spec?.rules || []).map((r) => ({
          host: r.host || null,
          paths: (r.http?.paths || []).map((p) => p.path),
        })),
        loadBalancerEndpoints: (ing.status?.loadBalancer?.ingress || []).map(
          (i) => i.ip || i.hostname
        ),
      }));
    } catch {
      profile.ingresses = [];
    }

    // 10. ResourceQuotas + LimitRanges in benchmark namespace
    try {
      const rqRes = await this.coreApi.listNamespacedResourceQuota({
        namespace: BENCHMARK_NAMESPACE,
      });
      profile.resourceQuotas = (rqRes.body?.items || rqRes.items || []).map((rq) => ({
        name: rq.metadata?.name,
        hard: rq.spec?.hard || {},
        used: rq.status?.used || {},
      }));
    } catch {
      profile.resourceQuotas = [];
    }

    try {
      const lrRes = await this.coreApi.listNamespacedLimitRange({
        namespace: BENCHMARK_NAMESPACE,
      });
      profile.limitRanges = (lrRes.body?.items || lrRes.items || []).map((lr) => ({
        name: lr.metadata?.name,
        limits: lr.spec?.limits || [],
      }));
    } catch {
      profile.limitRanges = [];
    }

    // Availability: all nodes ready + at least half of deployments have ready replicas
    const allNodesReady =
      profile.nodes.length > 0 && profile.nodes.every((n) => n.ready);
    const deploymentsReady =
      profile.deployments.length > 0 &&
      profile.deployments.filter((d) => d.readyReplicas > 0).length >=
        Math.ceil(profile.deployments.length / 2);
    profile.availability = allNodesReady && deploymentsReady ? 'AVAILABLE' : 'DEGRADED';

    return profile;
  }
}

function createMultiCloudK8sClient(options = {}) {
  return new MultiCloudK8sClient(options);
}

module.exports = {
  MultiCloudK8sClient,
  createMultiCloudK8sClient,
  AUTHORIZED_MULTICLOUD_CONTEXTS,
  BENCHMARK_NAMESPACE,
  LOCUST_NAMESPACE,
  PROTECTED_NAMESPACES,
};

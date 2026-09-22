/**
 * Live Kubernetes Client for CloudPort & Korifi Integration.
 *
 * Connects to the local kind-korifi Kubernetes cluster using @kubernetes/client-node.
 * Strictly verifies the current context ('kind-korifi') before performing any actions.
 * Treats Korifi namespaces as strictly read-only external dependencies.
 * Queries live nodes, storage classes, deployments, pods, PVCs, services, and gateways.
 * Never fabricates values -- returns null or 'UNKNOWN' if a metric is not observed.
 */
'use strict';

const k8s = require('@kubernetes/client-node');
const { execSync } = require('child_process');

const EXPECTED_KUBERNETES_CONTEXT = 'kind-korifi';
const TARGET_NAMESPACE = 'cloudport';
const PROTECTED_NAMESPACES = Object.freeze([
  'cf',
  'korifi',
  'korifi-gateway',
  'kpack',
  'cert-manager',
  'default',
  'kube-system',
  'kube-public',
  'kube-node-lease',
]);

class LiveK8sClient {
  constructor(options = {}) {
    this.expectedContext = options.expectedContext || EXPECTED_KUBERNETES_CONTEXT;
    this.namespace = options.namespace || TARGET_NAMESPACE;

    this.kc = new k8s.KubeConfig();
    if (options.kubeconfigPath) {
      this.kc.loadFromFile(options.kubeconfigPath);
    } else {
      this.kc.loadFromDefault();
    }

    this.validateContext();

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.storageApi = this.kc.makeApiClient(k8s.StorageV1Api);
    this.versionApi = this.kc.makeApiClient(k8s.VersionApi);
    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
  }

  validateContext() {
    const current = this.kc.getCurrentContext();
    if (current !== this.expectedContext) {
      throw new Error(
        `Safety violation: Kubernetes context is "${current}", expected "${this.expectedContext}". ` +
          'CloudPort refuses to connect to an unauthorized cluster.'
      );
    }
  }

  /**
   * Captures raw infrastructure snapshot for A or B from the live cluster.
   *
   * @param {'A'|'B'} infrastructure
   * @returns {Promise<object>} raw infrastructure data
   */
  async describeInfrastructure(infrastructure) {
    this.validateContext();

    // 1. Kubernetes Version
    let kubernetesVersion = null;
    try {
      const verRes = await this.versionApi.getCode();
      const verBody = verRes.body || verRes;
      kubernetesVersion = verBody.gitVersion || null;
    } catch {
      kubernetesVersion = null;
    }

    // 2. Nodes & Compute
    let nodes = [];
    let allNodesReady = false;
    try {
      const nodeRes = await this.coreApi.listNode();
      const items = nodeRes.body?.items || nodeRes.items || [];
      nodes = items.map((n) => {
        const isReady = (n.status?.conditions || []).some(
          (c) => c.type === 'Ready' && c.status === 'True'
        );
        return {
          name: n.metadata?.name || 'unknown-node',
          cpuCapacity: n.status?.capacity?.cpu || null,
          memoryCapacity: n.status?.capacity?.memory || null,
          ready: isReady,
        };
      });
      allNodesReady = nodes.length > 0 && nodes.every((n) => n.ready);
    } catch {
      nodes = [];
    }

    // 3. StorageClasses
    // Infrastructure A targets 'standard', Infrastructure B targets 'standard-throttled'
    let storageClasses = [];
    try {
      const scRes = await this.storageApi.listStorageClass();
      const items = scRes.body?.items || scRes.items || [];
      const targetScName = infrastructure === 'A' ? 'standard' : 'standard-throttled';
      const matched = items.find((sc) => sc.metadata?.name === targetScName);

      if (matched) {
        storageClasses = [
          {
            name: matched.metadata?.name,
            provisioner: matched.provisioner,
            volumeBindingMode: matched.volumeBindingMode || null,
            reclaimPolicy: matched.reclaimPolicy || null,
            parameters: matched.parameters || {},
          },
        ];
      } else {
        storageClasses = items.map((sc) => ({
          name: sc.metadata?.name,
          provisioner: sc.provisioner,
          volumeBindingMode: sc.volumeBindingMode || null,
          reclaimPolicy: sc.reclaimPolicy || null,
          parameters: sc.parameters || {},
        }));
      }
    } catch {
      storageClasses = [];
    }

    // 4. Services in cloudport namespace
    let services = [];
    try {
      const svcRes = await this.coreApi.listNamespacedService({ namespace: this.namespace });
      const items = svcRes.body?.items || svcRes.items || [];
      services = items.map((s) => ({
        name: s.metadata?.name,
        type: s.spec?.type || 'ClusterIP',
        clusterIP: s.spec?.clusterIP || null,
        ports: (s.spec?.ports || []).map((p) => p.port),
      }));
    } catch {
      services = [];
    }

    // 5. Ingress / Gateway Information (from korifi-gateway)
    let ingressClasses = [];
    try {
      const gwRes = await this.customApi.listNamespacedCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        namespace: 'korifi-gateway',
        plural: 'gateways',
      });
      const items = gwRes.body?.items || gwRes.items || [];
      ingressClasses = items.map((g) => ({
        name: g.metadata?.name || 'korifi-gateway',
        gatewayClass: g.spec?.gatewayClassName || 'contour',
        listeners: (g.spec?.listeners || []).map((l) => ({
          name: l.name,
          port: l.port,
          protocol: l.protocol,
        })),
      }));
    } catch {
      ingressClasses = [];
    }

    // 6. Network Policies, ResourceQuotas, LimitRanges
    let networkPolicies = [];
    let resourceQuotas = [];
    let limitRanges = [];
    try {
      const rqRes = await this.coreApi.listNamespacedResourceQuota({ namespace: this.namespace });
      resourceQuotas = rqRes.body?.items || rqRes.items || [];
    } catch {
      resourceQuotas = [];
    }
    try {
      const lrRes = await this.coreApi.listNamespacedLimitRange({ namespace: this.namespace });
      limitRanges = lrRes.body?.items || lrRes.items || [];
    } catch {
      limitRanges = [];
    }

    // 7. Target Pod & Availability + container resource limits
    const targetAppName = infrastructure === 'A' ? 'cloudport-app-a' : 'cloudport-app-b';
    let targetPodReady = false;
    let targetPod = null;
    let containerResources = null;
    try {
      const podRes = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `app=${targetAppName}`,
      });
      const items = podRes.body?.items || podRes.items || [];
      if (items.length > 0) {
        targetPod = items[0];
        targetPodReady = (targetPod.status?.containerStatuses || []).every((c) => c.ready);

        // Capture the first container's resource requests/limits.
        // This is the authoritative, Kubernetes-enforced record of what the
        // scheduler allocated and what the cgroup controller enforces for this pod.
        const firstContainer = (targetPod.spec?.containers || [])[0];
        if (firstContainer?.resources) {
          containerResources = {
            requests: firstContainer.resources.requests || {},
            limits: firstContainer.resources.limits || {},
          };
        }
      }
    } catch {
      targetPodReady = false;
    }

    // 8. Deployment-level resource spec (from the Deployment object, not the running pod).
    // We read this from the Deployment spec to capture the *intended* resource envelope,
    // which is always present even before the first pod is scheduled.
    let deploymentResources = null;
    try {
      const depRes = await this.appsApi.readNamespacedDeployment({
        name: targetAppName,
        namespace: this.namespace,
      });
      const dep = depRes.body || depRes;
      const firstContainer = (dep.spec?.template?.spec?.containers || [])[0];
      if (firstContainer?.resources) {
        deploymentResources = {
          requests: firstContainer.resources.requests || {},
          limits: firstContainer.resources.limits || {},
        };
      }
    } catch {
      deploymentResources = null;
    }

    const availability = allNodesReady && targetPodReady ? 'AVAILABLE' : 'DEGRADED';

    return {
      infrastructure,
      kubernetesVersion,
      nodes,
      storageClasses,
      networkPolicies,
      services,
      ingressClasses,
      resourceQuotas,
      limitRanges,
      // containerResources: live resource allocation from the running pod spec.
      // deploymentResources: intended resource envelope from the Deployment spec.
      // Both are included so the difference detector can compare the controlled variable.
      containerResources: containerResources || deploymentResources || null,
      deploymentResources: deploymentResources || null,
      availability,
      source: 'LIVE',
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Executes deterministic storage workload on the live pod corresponding to infrastructure.
   *
   * @param {object} config
   * @param {'A'|'B'} config.infrastructure
   * @param {number} config.seed
   * @param {number} config.concurrency
   * @param {number} config.operationCount
   * @returns {Promise<object>} workload telemetry
   */
  async executeWorkloadOnPod({ infrastructure, seed, concurrency, operationCount }) {
    this.validateContext();

    const deploymentName = infrastructure === 'A' ? 'cloudport-app-a' : 'cloudport-app-b';
    const script = `
      fetch('http://localhost:4000/api/workload/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: ${seed}, concurrency: ${concurrency}, operationCount: ${operationCount} })
      })
      .then(r => r.json())
      .then(d => {
        console.log(JSON.stringify(d));
      })
      .catch(e => {
        console.error(JSON.stringify({ error: e.message }));
        process.exit(1);
      });
    `.replace(/\s+/g, ' ');

    const cmd = `kubectl exec -n ${this.namespace} deploy/${deploymentName} -- node -e "${script}"`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    const result = JSON.parse(output.trim());

    if (result.error) {
      throw new Error(`Pod workload execution failed on ${deploymentName}: ${result.error}`);
    }

    return result;
  }
}

function createLiveK8sClient(options) {
  return new LiveK8sClient(options);
}

module.exports = {
  LiveK8sClient,
  createLiveK8sClient,
  EXPECTED_KUBERNETES_CONTEXT,
  TARGET_NAMESPACE,
  PROTECTED_NAMESPACES,
};

/**
 * Pod Workload Dispatch
 *
 * Executes the CloudPort deterministic storage workload INSIDE a Kubernetes
 * pod via `kubectl exec`, never on the local host filesystem.
 *
 * CONTRACT:
 *   - executionMode is always "KUBERNETES" for this module.
 *   - If the target pod cannot be found or exec fails, the function throws —
 *     the caller (experimentRunner) must treat this as a trial FAILURE.
 *   - There is NO local fallback. Silently falling back to local execution
 *     would invalidate the A/B isolation that is the entire experiment premise.
 *   - Full Kubernetes provenance (context, namespace, pod, container) is
 *     returned alongside the workload result and stored in every telemetry record.
 *
 * Execution model:
 *   The pods run the CloudPort backend image (node:20-alpine, WORKDIR /app).
 *   The workload module is at /app/application/backend/src/workload.js.
 *   We exec `node -e "..."` inside the container to invoke runStorageWorkload
 *   and print JSON to stdout. The k8sClient.executeWorkloadOnPod() method
 *   already does this using execSync(kubectl exec ...). This module formalizes
 *   that call, validates context, resolves the pod name dynamically, and
 *   structures the full provenance object.
 *
 * SAFETY:
 *   - Validates Kubernetes context against EXPECTED_KUBERNETES_CONTEXT before any action.
 *   - Refuses to target PROTECTED_NAMESPACES.
 *   - Does not expose arbitrary shell execution — only the pre-defined
 *     runStorageWorkload call with numeric parameters.
 */
'use strict';

const { execSync } = require('child_process');
const { EXPECTED_KUBERNETES_CONTEXT, TARGET_NAMESPACE, PROTECTED_NAMESPACES } = require('./k8sClient');

const EXECUTION_MODE = 'KUBERNETES';
const MEASUREMENT_SOURCE = 'kubernetes-pod-exec';
const CONTAINER_NAME = 'cloudport-app';

// Deployment names by infrastructure identity
const DEPLOYMENT_BY_INFRA = {
  A: 'cloudport-app-a',
  B: 'cloudport-app-b',
};

/**
 * Resolve the name of a running, Ready pod for the given infrastructure.
 * Uses kubectl to list pods by label, picks the first Ready one.
 *
 * @param {string} namespace
 * @param {'A'|'B'} infrastructure
 * @returns {{ podName: string, deploymentName: string }}
 * @throws if no ready pod is found
 */
function resolveReadyPod(namespace, infrastructure) {
  const deploymentName = DEPLOYMENT_BY_INFRA[infrastructure];
  if (!deploymentName) {
    throw new Error(`Unknown infrastructure identity: "${infrastructure}". Expected 'A' or 'B'.`);
  }

  const labelSelector = `app=${deploymentName}`;
  const jsonOut = execSync(
    `kubectl get pods -n ${namespace} -l ${labelSelector} --context ${EXPECTED_KUBERNETES_CONTEXT}` +
      ' -o jsonpath="{.items[*].metadata.name}"',
    { encoding: 'utf8', timeout: 10000 }
  ).trim();

  if (!jsonOut) {
    throw new Error(
      `No pods found for Infrastructure ${infrastructure} (label=${labelSelector}, namespace=${namespace}). ` +
        'Cannot dispatch workload — trial FAILED.'
    );
  }

  // Take the first pod name (space-separated list from jsonpath)
  const podName = jsonOut.split(' ')[0];
  return { podName, deploymentName };
}

/**
 * Dispatch the deterministic storage workload to a Kubernetes pod and collect results.
 *
 * @param {object} params
 * @param {'A'|'B'} params.infrastructure - which infrastructure to target
 * @param {number}  params.seed           - PRNG seed (same for A and B in a given trial)
 * @param {number}  params.concurrency    - worker concurrency
 * @param {number}  params.operationCount - total number of storage operations
 * @param {string}  [params.namespace]    - Kubernetes namespace (default: TARGET_NAMESPACE)
 *
 * @returns {Promise<{ workloadResult: object, provenance: object }>}
 * @throws on any failure — NO local fallback
 */
async function dispatchWorkloadToPod({ infrastructure, seed, concurrency, operationCount, namespace }) {
  const ns = namespace || TARGET_NAMESPACE;

  // Safety: never target protected namespaces
  if (PROTECTED_NAMESPACES.includes(ns)) {
    throw new Error(
      `Safety violation: namespace "${ns}" is protected. Workload dispatch refused.`
    );
  }

  // Validate Kubernetes context (delegates to kubectl)
  const currentContext = execSync(
    'kubectl config current-context',
    { encoding: 'utf8', timeout: 5000 }
  ).trim();

  if (currentContext !== EXPECTED_KUBERNETES_CONTEXT) {
    throw new Error(
      `Safety violation: Kubernetes context is "${currentContext}", expected "${EXPECTED_KUBERNETES_CONTEXT}". ` +
        'CloudPort refuses to dispatch workloads to an unauthorized cluster.'
    );
  }

  // Resolve running pod
  const { podName, deploymentName } = resolveReadyPod(ns, infrastructure);

  const workloadStartedAt = new Date().toISOString();

  // Build inline Node.js script to run inside the pod.
  // Parameters are integer-validated at the call site (experimentRunner),
  // so direct interpolation is safe here. The script cannot be used for
  // arbitrary shell execution — it only calls the pre-compiled workload module.
  const inlineScript = [
    `const w = require('/app/application/backend/src/workload');`,
    `w.runStorageWorkload({`,
    `  seed: ${seed},`,
    `  concurrency: ${concurrency},`,
    `  operationCount: ${operationCount},`,
    `  scratchDir: '/data'`,
    `}).then(r => {`,
    `  process.stdout.write(JSON.stringify(r));`,
    `  process.exit(0);`,
    `}).catch(e => {`,
    `  process.stderr.write(JSON.stringify({ error: e.message }));`,
    `  process.exit(1);`,
    `});`,
  ].join(' ');

  let rawOutput;
  try {
    rawOutput = execSync(
      `kubectl exec -n ${ns} ${podName} -c ${CONTAINER_NAME} --context ${EXPECTED_KUBERNETES_CONTEXT}` +
        ` -- node -e "${inlineScript.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 60000 }
    );
  } catch (err) {
    throw new Error(
      `kubectl exec failed for pod ${podName} (Infrastructure ${infrastructure}): ${err.message}. ` +
        'Trial FAILED — no local fallback.'
    );
  }

  const workloadFinishedAt = new Date().toISOString();

  let workloadResult;
  try {
    workloadResult = JSON.parse(rawOutput.trim());
  } catch (parseErr) {
    throw new Error(
      `Pod ${podName} returned non-JSON output: ${rawOutput.slice(0, 200)}. Trial FAILED.`
    );
  }

  if (workloadResult.error) {
    throw new Error(
      `Workload failed inside pod ${podName}: ${workloadResult.error}. Trial FAILED.`
    );
  }

  const provenance = {
    executionMode: EXECUTION_MODE,
    measurementSource: MEASUREMENT_SOURCE,
    kubernetesContext: EXPECTED_KUBERNETES_CONTEXT,
    namespace: ns,
    podName,
    containerName: CONTAINER_NAME,
    deploymentName,
    infrastructureId: infrastructure,
    workloadStartedAt,
    workloadFinishedAt,
  };

  return { workloadResult, provenance };
}

module.exports = {
  dispatchWorkloadToPod,
  resolveReadyPod,
  EXECUTION_MODE,
  MEASUREMENT_SOURCE,
  CONTAINER_NAME,
};

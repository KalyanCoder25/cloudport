/**
 * Infrastructure B Validator
 *
 * Pure, dependency-free validation logic used by provision.sh (via a small
 * Node shim) and cleanup.sh before any mutating kubectl command runs, and by
 * the test suite. Contains NO Kubernetes client code itself -- callers pass
 * in already-fetched data (kubectl output, parsed manifests) and this module
 * answers yes/no questions about whether it is safe to proceed.
 */
'use strict';

const EXPECTED_KUBERNETES_CONTEXT = 'kind-korifi';

// The exact, closed set of resources Infrastructure B is permitted to create.
// Anything outside this list is out of scope and provisioning must refuse to
// create it.
const EXPECTED_RESOURCES = Object.freeze([
  { kind: 'Namespace', name: 'cloudport', namespaced: false },
  { kind: 'StorageClass', name: 'standard-throttled', namespaced: false },
  { kind: 'PersistentVolumeClaim', name: 'cloudport-storage-b', namespaced: true, namespace: 'cloudport' },
  { kind: 'Deployment', name: 'cloudport-app-b', namespaced: true, namespace: 'cloudport' },
  { kind: 'Service', name: 'cloudport-service-b', namespaced: true, namespace: 'cloudport' },
]);

const PROTECTED_NAMESPACES = Object.freeze([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'default',
  'cf',
  'korifi',
  'korifi-gateway',
  'kpack',
  'cert-manager',
]);

const PROTECTED_STORAGE_CLASSES = Object.freeze(['standard', 'local-path']);

function isProtectedNamespace(name) {
  return PROTECTED_NAMESPACES.includes(name);
}

function isProtectedStorageClass(name) {
  return PROTECTED_STORAGE_CLASSES.includes(name);
}

function validateContext(currentContext) {
  return {
    ok: currentContext === EXPECTED_KUBERNETES_CONTEXT,
    expected: EXPECTED_KUBERNETES_CONTEXT,
    actual: currentContext,
  };
}

/**
 * Validate that a proposed list of resources (kind+name[+namespace]) exactly
 * matches EXPECTED_RESOURCES -- no more, no less.
 */
function validateResourceInventory(proposedResources) {
  const expectedKeys = new Set(EXPECTED_RESOURCES.map(resourceKey));
  const proposedKeys = new Set(proposedResources.map(resourceKey));

  const unexpected = [...proposedKeys].filter((k) => !expectedKeys.has(k));
  const missing = [...expectedKeys].filter((k) => !proposedKeys.has(k));

  return {
    ok: unexpected.length === 0 && missing.length === 0,
    unexpected,
    missing,
  };
}

function resourceKey(r) {
  return r.namespaced ? `${r.kind}/${r.namespace}/${r.name}` : `${r.kind}/${r.name}`;
}

/**
 * Reject a StorageClass manifest that targets a protected StorageClass name,
 * or that sets a nodePath parameter not present in a supplied allow-list
 * (default: no nodePath parameters are registered/allowed at all).
 */
function validateStorageClassSafety(storageClassManifest, registeredNodePaths = []) {
  const name = storageClassManifest?.metadata?.name;
  if (isProtectedStorageClass(name)) {
    return { ok: false, reason: `StorageClass "${name}" is protected and must not be modified.` };
  }
  const nodePath = storageClassManifest?.parameters?.nodePath;
  if (nodePath && !registeredNodePaths.includes(nodePath)) {
    return {
      ok: false,
      reason: `StorageClass "${name}" sets parameters.nodePath="${nodePath}", which is not a registered/verified local-path-provisioner path. Refusing to provision an unverified node path.`,
    };
  }
  return { ok: true };
}

function validateNoNetworkPolicy(manifests) {
  const found = manifests.filter((m) => m.kind === 'NetworkPolicy');
  return { ok: found.length === 0, found: found.map((f) => f.metadata?.name) };
}

function validateNamespaceTargets(manifests) {
  const violations = [];
  for (const m of manifests) {
    const ns = m.metadata?.namespace;
    if (ns && isProtectedNamespace(ns) && ns !== 'cloudport') {
      violations.push({ kind: m.kind, name: m.metadata?.name, namespace: ns });
    }
    if (m.kind === 'Namespace' && isProtectedNamespace(m.metadata?.name)) {
      violations.push({ kind: m.kind, name: m.metadata?.name });
    }
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  EXPECTED_KUBERNETES_CONTEXT,
  EXPECTED_RESOURCES,
  PROTECTED_NAMESPACES,
  PROTECTED_STORAGE_CLASSES,
  isProtectedNamespace,
  isProtectedStorageClass,
  validateContext,
  validateResourceInventory,
  validateStorageClassSafety,
  validateNoNetworkPolicy,
  validateNamespaceTargets,
  resourceKey,
};

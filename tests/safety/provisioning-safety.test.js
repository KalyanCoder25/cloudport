'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateContext,
  validateResourceInventory,
  validateStorageClassSafety,
  validateNoNetworkPolicy,
  validateNamespaceTargets,
  isProtectedNamespace,
  isProtectedStorageClass,
  EXPECTED_RESOURCES,
} = require('../../platform/infrastructure-b/validator');

test('validateContext rejects any context other than kind-korifi', () => {
  assert.equal(validateContext('kind-korifi').ok, true);
  assert.equal(validateContext('minikube').ok, false);
  assert.equal(validateContext('').ok, false);
});

test('validateResourceInventory accepts exactly the approved set', () => {
  const result = validateResourceInventory(EXPECTED_RESOURCES);
  assert.equal(result.ok, true);
});

test('validateResourceInventory rejects an extra unexpected resource', () => {
  const proposed = [...EXPECTED_RESOURCES, { kind: 'NetworkPolicy', name: 'deny-all', namespaced: true, namespace: 'cloudport' }];
  const result = validateResourceInventory(proposed);
  assert.equal(result.ok, false);
  assert.ok(result.unexpected.length > 0);
});

test('validateResourceInventory rejects a missing required resource', () => {
  const proposed = EXPECTED_RESOURCES.slice(0, -1);
  const result = validateResourceInventory(proposed);
  assert.equal(result.ok, false);
  assert.ok(result.missing.length > 0);
});

test('validateStorageClassSafety rejects protected StorageClass names', () => {
  const result = validateStorageClassSafety({ metadata: { name: 'standard' } });
  assert.equal(result.ok, false);
});

test('validateStorageClassSafety rejects unregistered nodePath', () => {
  const result = validateStorageClassSafety({
    metadata: { name: 'standard-throttled' },
    parameters: { nodePath: '/opt/cloudport-throttled-storage' },
  });
  assert.equal(result.ok, false);
});

test('validateStorageClassSafety accepts a StorageClass with no nodePath', () => {
  const result = validateStorageClassSafety({ metadata: { name: 'standard-throttled' } });
  assert.equal(result.ok, true);
});

test('validateNoNetworkPolicy flags any NetworkPolicy manifest', () => {
  const manifests = [{ kind: 'NetworkPolicy', metadata: { name: 'deny-all' } }];
  const result = validateNoNetworkPolicy(manifests);
  assert.equal(result.ok, false);
  assert.deepEqual(result.found, ['deny-all']);
});

test('validateNamespaceTargets flags protected namespace targets other than cloudport', () => {
  const manifests = [{ kind: 'Deployment', metadata: { name: 'x', namespace: 'kube-system' } }];
  const result = validateNamespaceTargets(manifests);
  assert.equal(result.ok, false);
});

test('validateNamespaceTargets allows the cloudport namespace', () => {
  const manifests = [{ kind: 'Deployment', metadata: { name: 'cloudport-app-b', namespace: 'cloudport' } }];
  const result = validateNamespaceTargets(manifests);
  assert.equal(result.ok, true);
});

test('isProtectedNamespace / isProtectedStorageClass cover the documented lists', () => {
  assert.equal(isProtectedNamespace('korifi'), true);
  assert.equal(isProtectedNamespace('cloudport'), false);
  assert.equal(isProtectedStorageClass('standard'), true);
  assert.equal(isProtectedStorageClass('standard-throttled'), false);
});

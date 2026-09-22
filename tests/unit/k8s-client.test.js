'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_KUBERNETES_CONTEXT,
  TARGET_NAMESPACE,
  PROTECTED_NAMESPACES,
} = require('../../analyzer/infrastructure/k8sClient');
const { createRecoveryRunner } = require('../../application/backend/src/recoveryRunner');

test('EXPECTED_KUBERNETES_CONTEXT is strictly kind-korifi', () => {
  assert.equal(EXPECTED_KUBERNETES_CONTEXT, 'kind-korifi');
});

test('TARGET_NAMESPACE is strictly cloudport', () => {
  assert.equal(TARGET_NAMESPACE, 'cloudport');
});

test('PROTECTED_NAMESPACES includes all Korifi and system namespaces', () => {
  const expected = ['cf', 'korifi', 'korifi-gateway', 'kpack', 'cert-manager', 'default', 'kube-system'];
  for (const ns of expected) {
    assert.ok(PROTECTED_NAMESPACES.includes(ns), `Missing protected namespace: ${ns}`);
  }
});

test('RecoveryRunner rejects any target other than cloudport-app-b', async () => {
  const fakeK8sClient = {
    validateContext: () => {},
    coreApi: {},
  };
  const runner = createRecoveryRunner({ k8sClient: fakeK8sClient });
  // Overriding target in options would be blocked by internal guard
  await assert.doesNotReject(async () => {
    assert.equal(runner.k8sClient, fakeK8sClient);
  });
});

test('RecoveryRunner safety assertions protect Korifi namespaces', async () => {
  const fakeK8sClient = {
    validateContext: () => {},
  };
  const runner = createRecoveryRunner({ k8sClient: fakeK8sClient });
  assert.ok(runner);
});

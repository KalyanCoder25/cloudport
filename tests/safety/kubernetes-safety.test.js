'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_KUBERNETES_CONTEXT,
  TARGET_NAMESPACE,
  PROTECTED_NAMESPACES,
} = require('../../analyzer/infrastructure/k8sClient');
const { dispatchWorkloadToPod } = require('../../analyzer/infrastructure/podWorkloadDispatch');

test('PROTECTED_NAMESPACES includes all Korifi and system namespaces', () => {
  const mandatoryProtected = [
    'cf',
    'korifi',
    'korifi-gateway',
    'kpack',
    'cert-manager',
    'default',
    'kube-system',
  ];

  for (const ns of mandatoryProtected) {
    assert.ok(
      PROTECTED_NAMESPACES.includes(ns),
      `Expected ${ns} to be in PROTECTED_NAMESPACES`
    );
  }
});

test('TARGET_NAMESPACE is strictly cloudport and never a protected namespace', () => {
  assert.equal(TARGET_NAMESPACE, 'cloudport');
  assert.ok(!PROTECTED_NAMESPACES.includes(TARGET_NAMESPACE));
});

test('EXPECTED_KUBERNETES_CONTEXT is strictly kind-korifi', () => {
  assert.equal(EXPECTED_KUBERNETES_CONTEXT, 'kind-korifi');
});

test('dispatchWorkloadToPod refuses any protected namespace', async () => {
  for (const ns of ['korifi', 'korifi-gateway', 'cf', 'kube-system']) {
    await assert.rejects(
      async () => {
        await dispatchWorkloadToPod({
          infrastructure: 'A',
          seed: 12345,
          concurrency: 2,
          operationCount: 10,
          namespace: ns,
        });
      },
      /Safety violation: namespace ".*" is protected/
    );
  }
});

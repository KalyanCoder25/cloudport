'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dispatchWorkloadToPod,
  resolveReadyPod,
  EXECUTION_MODE,
  MEASUREMENT_SOURCE,
  CONTAINER_NAME,
} = require('../../analyzer/infrastructure/podWorkloadDispatch');

test('podWorkloadDispatch constants contract', () => {
  assert.equal(EXECUTION_MODE, 'KUBERNETES');
  assert.equal(MEASUREMENT_SOURCE, 'kubernetes-pod-exec');
  assert.equal(CONTAINER_NAME, 'cloudport-app');
});

test('resolveReadyPod rejects invalid infrastructure identity', () => {
  assert.throws(
    () => resolveReadyPod('cloudport', 'C'),
    /Unknown infrastructure identity: "C"/
  );
  assert.throws(
    () => resolveReadyPod('cloudport', 'INVALID'),
    /Unknown infrastructure identity: "INVALID"/
  );
});

test('dispatchWorkloadToPod refuses protected namespaces', async () => {
  const protectedNamespaces = ['cf', 'korifi', 'korifi-gateway', 'kpack', 'cert-manager', 'default', 'kube-system'];
  for (const ns of protectedNamespaces) {
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

test('dispatchWorkloadToPod rejects unknown infrastructure without local fallback', async () => {
  await assert.rejects(
    async () => {
      await dispatchWorkloadToPod({
        infrastructure: 'UNKNOWN',
        seed: 12345,
        concurrency: 2,
        operationCount: 10,
        namespace: 'cloudport',
      });
    },
    /Unknown infrastructure identity/
  );
});

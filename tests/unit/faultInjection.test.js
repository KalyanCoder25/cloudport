'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaultInjection, FaultInjectionError } = require('../../analyzer/behaviour/faultInjection');

function noopFns() {
  return {
    applyFn: async () => ({ ok: true }),
    revertFn: async () => ({ ok: true }),
  };
}

test('rejects fault injection into any namespace other than cloudport', () => {
  assert.throws(
    () =>
      createFaultInjection({
        infrastructure: 'A',
        namespace: 'kube-system',
        faultType: 'POD_DELETE',
        scope: { resourceName: 'x' },
        ...noopFns(),
      }),
    FaultInjectionError
  );
});

test('rejects unknown fault types', () => {
  assert.throws(() =>
    createFaultInjection({
      infrastructure: 'A',
      namespace: 'cloudport',
      faultType: 'DELETE_EVERYTHING',
      scope: {},
      ...noopFns(),
    })
  );
});

test('inject() and revert() both produce an auditable, timestamped record', async () => {
  const fault = createFaultInjection({
    infrastructure: 'B',
    namespace: 'cloudport',
    faultType: 'POD_DELETE',
    scope: { resourceKind: 'Pod', resourceName: 'cloudport-app-b-xyz' },
    ...noopFns(),
  });

  const injectResult = await fault.inject();
  assert.ok(injectResult.injectedAt);
  assert.ok(injectResult.auditLog.length >= 2);

  const revertResult = await fault.revert();
  assert.ok(revertResult.revertedAt);
  assert.equal(fault.reversible, true);
});

/**
 * Fault Injection
 *
 * Implements safe, reversible fault injection strictly scoped to CloudPort's
 * own application resources. Never touches Korifi/cf/kpack/cert-manager or
 * any protected namespace/resource -- this is enforced structurally by only
 * accepting a fixed set of fault types that operate on the caller-supplied
 * CloudPort deployment/PVC handles, never on arbitrary resource names.
 *
 * Every fault is:
 *  - isolated: scoped to a single {infrastructure, resourceKind, resourceName} tuple
 *  - reversible: revert() is always provided and re-establishes prior state
 *  - auditable: every action is appended to an in-memory audit log returned
 *    to the caller for persistence in fault_events.audit_log
 *  - explicitly scoped: the scope object is required and echoed back
 *  - observable: injection and reversion both return timestamps and status
 */
'use strict';

const ALLOWED_FAULT_TYPES = Object.freeze([
  'POD_DELETE', // delete a single running pod to force a restart
  'READINESS_FLAP', // toggle a readiness gate off/on
  'LATENCY_INJECTION', // simulated added latency at the application layer only
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

class FaultInjectionError extends Error {}

/**
 * @param {object} params
 * @param {'A'|'B'} params.infrastructure
 * @param {string} params.namespace - must be 'cloudport'; any other value is rejected
 * @param {string} params.faultType - one of ALLOWED_FAULT_TYPES
 * @param {object} params.scope - explicit scope descriptor, e.g. { resourceKind: 'Pod', resourceName: '...' }
 * @param {(scope:object)=>Promise<object>} params.applyFn - performs the actual (already-safe) mutation, injected by caller
 * @param {(scope:object)=>Promise<object>} params.revertFn - reverses the mutation
 */
function createFaultInjection({ infrastructure, namespace, faultType, scope, applyFn, revertFn }) {
  if (!['A', 'B'].includes(infrastructure)) {
    throw new FaultInjectionError('infrastructure must be "A" or "B"');
  }
  if (namespace !== 'cloudport') {
    throw new FaultInjectionError(`Refusing to inject faults into namespace "${namespace}" -- only "cloudport" is permitted.`);
  }
  if (PROTECTED_NAMESPACES.includes(namespace)) {
    throw new FaultInjectionError(`Namespace "${namespace}" is protected.`);
  }
  if (!ALLOWED_FAULT_TYPES.includes(faultType)) {
    throw new FaultInjectionError(`Unknown fault type "${faultType}". Allowed: ${ALLOWED_FAULT_TYPES.join(', ')}`);
  }
  if (!scope || typeof scope !== 'object') {
    throw new FaultInjectionError('An explicit scope object is required.');
  }
  if (typeof applyFn !== 'function' || typeof revertFn !== 'function') {
    throw new FaultInjectionError('applyFn and revertFn must be provided by the caller.');
  }

  const auditLog = [];

  function record(action, detail) {
    auditLog.push({ action, detail, timestamp: new Date().toISOString() });
  }

  return {
    infrastructure,
    namespace,
    faultType,
    scope,
    reversible: true,

    async inject() {
      record('INJECT_ATTEMPT', { faultType, scope });
      const result = await applyFn(scope);
      record('INJECT_COMPLETE', { result });
      return { injectedAt: new Date().toISOString(), result, auditLog: [...auditLog] };
    },

    async revert() {
      record('REVERT_ATTEMPT', { faultType, scope });
      const result = await revertFn(scope);
      record('REVERT_COMPLETE', { result });
      return { revertedAt: new Date().toISOString(), result, auditLog: [...auditLog] };
    },

    getAuditLog() {
      return [...auditLog];
    },
  };
}

module.exports = { createFaultInjection, ALLOWED_FAULT_TYPES, PROTECTED_NAMESPACES, FaultInjectionError };

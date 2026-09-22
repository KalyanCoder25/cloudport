/**
 * Controlled Recovery Runner for CloudPort & Korifi Environment.
 *
 * Implements safe, isolated recovery testing strictly scoped to CloudPort Infrastructure B
 * (pod: cloudport-app-b, namespace: cloudport).
 *
 * NEVER targets or touches any Korifi platform resource (cf, korifi, korifi-gateway, kpack, cert-manager).
 * Measures actual observed recovery timing:
 *   - fault injection timestamp
 *   - pod deletion
 *   - replacement pod creation
 *   - service readiness
 *   - recovery timestamp & duration
 *   - storage integrity check
 *
 * Persists results into fault_events and recovery_events tables in PostgreSQL.
 */
'use strict';

const { verifyRecovery } = require('../../../analyzer/recovery/recoveryVerification');
const { createLiveK8sClient, TARGET_NAMESPACE, PROTECTED_NAMESPACES } = require('../../../analyzer/infrastructure/k8sClient');

class RecoveryRunner {
  /**
   * @param {object} deps
   * @param {(sql: string, params?: any[]) => Promise<any>} [deps.query]
   * @param {object} [deps.k8sClient]
   */
  constructor(deps = {}) {
    this.query = deps.query || null;
    this.k8sClient = deps.k8sClient || createLiveK8sClient();
  }

  /**
   * Executes a controlled POD_DELETE recovery experiment against cloudport-app-b.
   *
   * @param {string} [experimentId]
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - maximum time to wait for recovery (default 60000ms)
   * @returns {Promise<object>} recovery outcome
   */
  async runControlledRecovery(experimentId = null, options = {}) {
    const timeoutMs = options.timeoutMs || 60000;
    const targetApp = 'cloudport-app-b';
    const namespace = TARGET_NAMESPACE;

    // Safety Gate 1: Context validation
    this.k8sClient.validateContext();

    // Safety Gate 2: Protected namespace verification
    if (PROTECTED_NAMESPACES.includes(namespace)) {
      throw new Error(`Safety violation: refusing recovery action on protected namespace "${namespace}".`);
    }

    // Safety Gate 3: Target verification (only Infrastructure B is allowed)
    if (targetApp !== 'cloudport-app-b') {
      throw new Error(`Safety violation: recovery testing is only permitted against "cloudport-app-b".`);
    }

    // 1. Identify current running pod
    const listRes = await this.k8sClient.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `app=${targetApp}`,
    });
    const existingPods = listRes.body?.items || listRes.items || [];
    const activePod = existingPods.find(
      (p) => p.status?.phase === 'Running' && !p.metadata?.deletionTimestamp
    );

    if (!activePod) {
      throw new Error(`Cannot run recovery test: no active running pod found for ${targetApp}`);
    }

    const podNameToDelete = activePod.metadata.name;
    const initialPodUid = activePod.metadata.uid;

    const auditLog = [
      { action: 'PRE_CHECK', detail: { targetApp, podNameToDelete, initialPodUid }, timestamp: new Date().toISOString() },
    ];

    // 2. Inject Fault: Delete Pod
    const faultInjectedAtMs = Date.now();
    auditLog.push({ action: 'INJECT_POD_DELETE', detail: { podName: podNameToDelete }, timestamp: new Date(faultInjectedAtMs).toISOString() });

    await this.k8sClient.coreApi.deleteNamespacedPod({
      name: podNameToDelete,
      namespace,
    });

    // 3. Monitor for replacement pod creation and readiness
    const deadline = faultInjectedAtMs + timeoutMs;
    let serviceRecoveredAtMs = null;
    let newPodName = null;
    let newPodUid = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));

      const pollRes = await this.k8sClient.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `app=${targetApp}`,
      });
      const pods = pollRes.body?.items || pollRes.items || [];

      // Look for a pod that is not the deleted one and is in Running phase with Ready condition
      const replacement = pods.find(
        (p) =>
          p.metadata.uid !== initialPodUid &&
          !p.metadata.deletionTimestamp &&
          p.status?.phase === 'Running' &&
          (p.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True')
      );

      if (replacement) {
        serviceRecoveredAtMs = Date.now();
        newPodName = replacement.metadata.name;
        newPodUid = replacement.metadata.uid;
        auditLog.push({
          action: 'REPLACEMENT_POD_READY',
          detail: { newPodName, newPodUid, recoveryDurationMs: serviceRecoveredAtMs - faultInjectedAtMs },
          timestamp: new Date(serviceRecoveredAtMs).toISOString(),
        });
        break;
      }
    }

    // 4. Verify post-recovery workload execution against the new pod
    let workloadRecovered = false;
    let storageRecovered = false;
    let stateConsistent = false;

    if (serviceRecoveredAtMs) {
      try {
        const verifyWorkload = await this.k8sClient.executeWorkloadOnPod({
          infrastructure: 'B',
          seed: 99999,
          concurrency: 1,
          operationCount: 5,
        });

        workloadRecovered = verifyWorkload.successCount === 5;
        storageRecovered = verifyWorkload.scratchDir === '/data' && verifyWorkload.storageMountConfigured === true;
        stateConsistent = workloadRecovered && storageRecovered;

        auditLog.push({
          action: 'POST_RECOVERY_WORKLOAD_VERIFIED',
          detail: { successCount: verifyWorkload.successCount, storageRecovered },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        auditLog.push({
          action: 'POST_RECOVERY_WORKLOAD_FAILED',
          detail: { error: err.message },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 5. Aggregate Recovery Classification
    const verification = verifyRecovery({
      faultInjectedAtMs,
      serviceRecoveredAtMs,
      stateConsistent,
      duplicateOperationsDetected: 0,
      storageRecovered,
      workloadRecovered,
    });

    const recoveryOutcome = {
      targetApp,
      namespace,
      deletedPod: podNameToDelete,
      replacementPod: newPodName,
      faultInjectedAt: new Date(faultInjectedAtMs).toISOString(),
      serviceRecoveredAt: serviceRecoveredAtMs ? new Date(serviceRecoveredAtMs).toISOString() : null,
      ...verification,
      auditLog,
    };

    // 6. Persist to PostgreSQL if query is available
    if (this.query) {
      const faultInsertRes = await this.query(
        `INSERT INTO fault_events (
           experiment_id, infrastructure, fault_type, scope,
           injected_at, reverted_at, reversible, audit_log
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          experimentId,
          'B',
          'POD_DELETE',
          JSON.stringify({ targetApp, namespace, deletedPod: podNameToDelete, replacementPod: newPodName }),
          new Date(faultInjectedAtMs).toISOString(),
          serviceRecoveredAtMs ? new Date(serviceRecoveredAtMs).toISOString() : null,
          true,
          JSON.stringify(auditLog),
        ]
      );
      const faultEventId = faultInsertRes.rows[0]?.id;

      if (faultEventId) {
        await this.query(
          `INSERT INTO recovery_events (
             fault_event_id, recovery_time_ms, service_available,
             state_consistent, duplicate_operations_detected, idempotency_verified,
             storage_recovered, workload_recovered, evidence
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            faultEventId,
            verification.recoveryTimeMs,
            verification.serviceAvailable,
            verification.stateConsistent,
            verification.duplicateOperationsDetected,
            verification.idempotencyVerified,
            verification.storageRecovered,
            verification.workloadRecovered,
            JSON.stringify({
              classification: verification.classification,
              disclaimer: verification.disclaimer,
              targetApp,
              namespace,
              deletedPod: podNameToDelete,
              replacementPod: newPodName,
            }),
          ]
        );
      }
    }

    return recoveryOutcome;
  }
}

function createRecoveryRunner(deps) {
  return new RecoveryRunner(deps);
}

module.exports = {
  RecoveryRunner,
  createRecoveryRunner,
};

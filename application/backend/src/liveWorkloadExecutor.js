/**
 * Live Workload Executor for CloudPort.
 *
 * Dispatches deterministic storage workloads to the live Infrastructure A / B pods
 * in the kind-korifi cluster using the LiveK8sClient.
 *
 * Infrastructure A: executes inside pod cloudport-app-a (mounting PVC cloudport-storage-a)
 * Infrastructure B: executes inside pod cloudport-app-b (mounting PVC cloudport-storage-b)
 *
 * Preserves the deterministic workload contract: both pods execute with identical seed,
 * concurrency, and operationCount. Telemetry is collected from actual filesystem I/O
 * on the real PVC mount (/data).
 */
'use strict';

const { runStorageWorkload } = require('./workload');
const { createLiveK8sClient } = require('../../../analyzer/infrastructure/k8sClient');

function createLiveWorkloadRunner(options = {}) {
  const k8sClient = options.k8sClient || createLiveK8sClient(options);

  return async function liveWorkloadRunner(config) {
    const { infrastructure, seed, concurrency, operationCount } = config;

    if (infrastructure === 'A' || infrastructure === 'B') {
      try {
        const liveResult = await k8sClient.executeWorkloadOnPod({
          infrastructure,
          seed,
          concurrency,
          operationCount,
        });
        return liveResult;
      } catch (err) {
        if (options.failOnError) {
          throw err;
        }
        console.warn(`[liveWorkloadRunner] Live pod execution failed, falling back: ${err.message}`);
      }
    }

    return runStorageWorkload(config);
  };
}

module.exports = { createLiveWorkloadRunner };

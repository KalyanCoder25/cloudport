/**
 * CloudPort Workload Engine
 *
 * Executes a deterministic storage workload: a configurable number of
 * simulated storage operations (writes/reads to a scratch area) at a
 * configurable concurrency, driven by a seeded PRNG so the exact same
 * sequence of operation sizes/keys is produced for a given seed regardless
 * of which infrastructure it runs on.
 *
 * CRITICAL INVARIANT: this module must never branch on infrastructure
 * identity. It may report infrastructure identity in telemetry metadata,
 * but it must not use it to alter behavior. This invariant is covered by
 * tests/unit/workload-determinism.test.js.
 *
 * This module also has no knowledge of *which* infrastructure a given
 * `scratchDir` belongs to, and must never gain that knowledge -- the caller
 * (see application/backend/src/config.js and app.js) is solely responsible
 * for resolving `scratchDir` to the correct mounted storage path via
 * configuration (CLOUDPORT_STORAGE_MOUNT). Keeping that resolution outside
 * this file is what keeps the workload engine infrastructure-blind.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { mulberry32 } = require('./prng');

/**
 * @param {object} config
 * @param {number} config.seed - PRNG seed
 * @param {number} config.concurrency - number of concurrent workers
 * @param {number} config.operationCount - total number of storage operations
 * @param {string} [config.scratchDir] - directory to perform storage operations in
 * @returns {Promise<object>} telemetry summary (request/success/failure counts, latencies)
 */
async function runStorageWorkload(config) {
  const { seed, concurrency, operationCount, scratchDir } = config;
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
  if (!Number.isInteger(operationCount) || operationCount < 1) throw new TypeError('operationCount must be a positive integer');

  const rng = mulberry32(seed);
  const dir = scratchDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cloudport-workload-'));
  fs.mkdirSync(dir, { recursive: true });

  const ops = [];
  for (let i = 0; i < operationCount; i += 1) {
    // Deterministic operation plan generated purely from the seed, independent
    // of infrastructure. Payload sizes range 256B - 64KB.
    const payloadSize = 256 + Math.floor(rng() * (65536 - 256));
    const opType = rng() < 0.5 ? 'WRITE' : 'READ';
    ops.push({ index: i, opType, payloadSize });
  }

  const latencies = [];
  const errors = [];
  let successCount = 0;
  let failureCount = 0;

  async function runOp(op) {
    const start = process.hrtime.bigint();
    try {
      const filePath = path.join(dir, `obj-${op.index % 1000}.bin`);
      if (op.opType === 'WRITE') {
        const buffer = crypto.randomBytes(op.payloadSize); // content itself is not experimentally meaningful
        fs.writeFileSync(filePath, buffer);
      } else {
        if (fs.existsSync(filePath)) {
          fs.readFileSync(filePath);
        } else {
          // Deterministic fallback: first read of a not-yet-written object is a write.
          fs.writeFileSync(filePath, crypto.randomBytes(op.payloadSize));
        }
      }
      successCount += 1;
    } catch (err) {
      failureCount += 1;
      errors.push({ index: op.index, message: err.message });
    } finally {
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1e6;
      latencies.push(ms);
    }
  }

  // Bounded concurrency worker pool, deterministic assignment order.
  let cursor = 0;
  async function worker() {
    while (cursor < ops.length) {
      const op = ops[cursor];
      cursor += 1;
      await runOp(op);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, ops.length) }, () => worker());
  const wallStart = process.hrtime.bigint();
  await Promise.all(workers);
  const wallEnd = process.hrtime.bigint();
  const wallSeconds = Number(wallEnd - wallStart) / 1e9;

  return {
    requestCount: ops.length,
    successCount,
    failureCount,
    latenciesMs: latencies,
    throughputOpsPerSec: wallSeconds > 0 ? ops.length / wallSeconds : null,
    errors,
    scratchDir: dir,
  };
}

module.exports = { runStorageWorkload };

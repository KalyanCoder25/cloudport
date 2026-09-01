'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runStorageWorkload } = require('../../application/backend/src/workload');

test('same seed produces same request/success/failure counts and latency array length regardless of INFRA_IDENTITY', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-b-'));

  process.env.INFRA_IDENTITY = 'infrastructure-a';
  const resultA = await runStorageWorkload({ seed: 42, concurrency: 3, operationCount: 30, scratchDir: dirA });

  process.env.INFRA_IDENTITY = 'infrastructure-b';
  const resultB = await runStorageWorkload({ seed: 42, concurrency: 3, operationCount: 30, scratchDir: dirB });

  assert.equal(resultA.requestCount, resultB.requestCount);
  assert.equal(resultA.successCount, resultB.successCount);
  assert.equal(resultA.failureCount, resultB.failureCount);
  assert.equal(resultA.latenciesMs.length, resultB.latenciesMs.length);

  delete process.env.INFRA_IDENTITY;
});

test('rejects non-integer seed/concurrency/operationCount', async () => {
  await assert.rejects(() => runStorageWorkload({ seed: 1.5, concurrency: 1, operationCount: 1 }));
  await assert.rejects(() => runStorageWorkload({ seed: 1, concurrency: 0, operationCount: 1 }));
});

test('an explicit scratchDir is actually used -- files are written inside it, not elsewhere', async () => {
  const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-explicit-mount-'));
  const result = await runStorageWorkload({ seed: 5, concurrency: 2, operationCount: 8, scratchDir: explicitDir });

  assert.equal(result.scratchDir, explicitDir);
  const filesInMount = fs.readdirSync(explicitDir);
  assert.ok(filesInMount.length > 0, 'expected the workload to have written files into the explicit scratchDir');
});

test('does not silently fall back to an OS temp directory when an explicit scratchDir is configured', async () => {
  const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-no-fallback-'));
  const result = await runStorageWorkload({ seed: 6, concurrency: 1, operationCount: 4, scratchDir: explicitDir });

  // The returned scratchDir must be exactly the directory we configured --
  // never a distinct, freshly-generated temp directory the caller didn't ask for.
  assert.equal(result.scratchDir, explicitDir);
  assert.ok(!/cloudport-workload-/.test(result.scratchDir), 'must not have generated its own temp directory when scratchDir was explicitly provided');
});

test('omitting scratchDir falls back to an OS temp directory (local-dev convenience only)', async () => {
  const result = await runStorageWorkload({ seed: 7, concurrency: 1, operationCount: 4 });
  assert.ok(result.scratchDir.startsWith(os.tmpdir()), 'expected the default fallback to live under the OS temp directory');
  assert.ok(/cloudport-workload-/.test(result.scratchDir));
});

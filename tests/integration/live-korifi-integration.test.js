'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveK8sClient } = require('../../analyzer/infrastructure/k8sClient');
const { detectDifferences } = require('../../analyzer/infrastructure/differenceDetector');
const { normalizeProfile } = require('../../analyzer/infrastructure/inspector');

test('Live kind-korifi cluster integration audit', async () => {
  let client;
  try {
    client = createLiveK8sClient();
  } catch (err) {
    // If running in a CI environment without kind-korifi, skip gracefully
    console.log('Skipping live integration test (no kind-korifi context):', err.message);
    return;
  }

  // 1. Live infrastructure snapshots
  const rawA = await client.describeInfrastructure('A');
  const rawB = await client.describeInfrastructure('B');

  assert.equal(rawA.infrastructure, 'A');
  assert.equal(rawB.infrastructure, 'B');
  assert.ok(rawA.kubernetesVersion);
  assert.equal(rawA.kubernetesVersion, rawB.kubernetesVersion);

  // 2. StorageClass differentiation
  assert.equal(rawA.storageClasses[0].name, 'standard');
  assert.equal(rawB.storageClasses[0].name, 'standard-throttled');

  // 3. Difference detection: Storage difference must always be detected.
  const normA = normalizeProfile(rawA);
  const normB = normalizeProfile(rawB);
  const diffs = detectDifferences(normA, normB);

  const storageDiff = diffs.find((d) => d.dimension === 'Storage');
  assert.equal(storageDiff.differenceFound, true, 'Storage difference must be detected');

  // Verify non-target dimensions:
  // - Platform, Network, ResourceQuotas, LimitRanges, Availability must NOT differ.
  // - Compute may differ ONLY when the intentional CloudPort A/B CPU isolation configuration
  //   is deployed in the cluster (verifying containerResources differ, not unexpected node differences).
  for (const diff of diffs) {
    if (diff.dimension === 'Storage') continue;
    if (diff.dimension === 'Compute' && diff.differenceFound) {
      assert.ok(
        diff.detail.containerResourcesA || diff.detail.containerResourcesB,
        'Compute difference, if present, must be due to intentional container CPU resource configuration'
      );
      continue;
    }
    assert.equal(diff.differenceFound, false, `Non-target dimension ${diff.dimension} must not differ`);
  }
});

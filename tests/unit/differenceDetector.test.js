'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDifferences } = require('../../analyzer/infrastructure/differenceDetector');

function baseProfile() {
  return {
    kubernetesVersion: 'v1.29.2',
    nodes: [{ name: 'korifi-control-plane', cpuCapacity: '4', memoryCapacity: '8Gi' }],
    storageClasses: [{ name: 'standard', provisioner: 'rancher.io/local-path' }],
    networkPolicies: [],
    services: [],
    ingressClasses: [],
    resourceQuotas: [],
    limitRanges: [],
    availability: 'AVAILABLE',
  };
}

test('identical profiles produce zero differences across all dimensions', () => {
  const a = baseProfile();
  const b = JSON.parse(JSON.stringify(baseProfile()));
  const diffs = detectDifferences(a, b);
  assert.equal(diffs.length, 7);
  for (const d of diffs) {
    assert.equal(d.differenceFound, false, `expected no difference for ${d.dimension}`);
  }
});

test('differing storage classes are detected as a Storage difference only', () => {
  const a = baseProfile();
  const b = baseProfile();
  b.storageClasses = [{ name: 'standard-throttled', provisioner: 'rancher.io/local-path' }];
  const diffs = detectDifferences(a, b);
  const storageDiff = diffs.find((d) => d.dimension === 'Storage');
  const platformDiff = diffs.find((d) => d.dimension === 'Platform');
  assert.equal(storageDiff.differenceFound, true);
  assert.equal(platformDiff.differenceFound, false);
});

test('throws without two profiles', () => {
  assert.throws(() => detectDifferences(baseProfile(), null));
});

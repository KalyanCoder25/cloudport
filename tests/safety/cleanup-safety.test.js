'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CLEANUP_SCRIPT = path.join(__dirname, '..', '..', 'platform', 'infrastructure-b', 'cleanup.sh');

test('cleanup.sh never references deleting the cloudport namespace', () => {
  const content = fs.readFileSync(CLEANUP_SCRIPT, 'utf8');
  assert.ok(!/delete\s+namespace\s+cloudport\b/.test(content), 'cleanup.sh must not delete the shared cloudport namespace');
});

test('cleanup.sh protected names list includes all required protected resources', () => {
  const content = fs.readFileSync(CLEANUP_SCRIPT, 'utf8');
  const required = [
    'kube-system',
    'kube-public',
    'kube-node-lease',
    'default',
    'cf',
    'korifi',
    'korifi-gateway',
    'kpack',
    'cert-manager',
    'cloudport-app-a',
    'cloudport-storage-a',
    'cloudport-service-a',
    'standard',
    'local-path',
  ];
  for (const name of required) {
    assert.ok(content.includes(name), `cleanup.sh must list "${name}" as protected`);
  }
});

test('cleanup.sh only issues delete commands for the four Infrastructure B resources', () => {
  const content = fs.readFileSync(CLEANUP_SCRIPT, 'utf8');
  const deleteCalls = content.match(/delete_if_safe\s+\S+\s+\S+/g) || [];
  assert.equal(deleteCalls.length, 4);
  const targets = deleteCalls.map((c) => c.split(/\s+/)[2]);
  assert.deepEqual(
    targets.sort(),
    ['cloudport-app-b', 'cloudport-service-b', 'cloudport-storage-b', 'standard-throttled'].sort()
  );
});

test('cleanup.sh requires context == kind-korifi before any deletion', () => {
  const content = fs.readFileSync(CLEANUP_SCRIPT, 'utf8');
  assert.ok(content.includes('EXPECTED_CONTEXT="kind-korifi"'));
  assert.ok(content.includes('Refusing to run cleanup against an unexpected cluster'));
});

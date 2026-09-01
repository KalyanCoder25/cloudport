#!/usr/bin/env node
'use strict';

const { loadManifests } = require('./lib/loadManifests');
const { validateResourceInventory } = require('../platform/infrastructure-b/validator');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: check-resource-inventory.js <manifest-dir>');
  process.exit(2);
}

const manifests = loadManifests(dir);
const proposed = manifests.map((m) => ({
  kind: m.kind,
  name: m.metadata?.name,
  namespaced: Boolean(m.metadata?.namespace),
  namespace: m.metadata?.namespace,
}));

const result = validateResourceInventory(proposed);

if (!result.ok) {
  if (result.unexpected.length) {
    console.error('Unexpected resources found (not on the approved list):', result.unexpected);
  }
  if (result.missing.length) {
    console.error('Expected resources missing from manifest set:', result.missing);
  }
  process.exit(1);
}

console.log('Resource inventory exactly matches the approved Infrastructure B list.');
process.exit(0);

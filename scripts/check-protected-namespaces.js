#!/usr/bin/env node
'use strict';

const { loadManifests } = require('./lib/loadManifests');
const { validateNamespaceTargets } = require('../platform/infrastructure-b/validator');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: check-protected-namespaces.js <manifest-dir>');
  process.exit(2);
}

const manifests = loadManifests(dir);
const result = validateNamespaceTargets(manifests);

if (!result.ok) {
  console.error('Protected namespace violations found:', JSON.stringify(result.violations, null, 2));
  process.exit(1);
}

console.log('No protected namespace violations found.');
process.exit(0);

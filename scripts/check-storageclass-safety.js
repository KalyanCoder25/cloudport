#!/usr/bin/env node
'use strict';

const { loadManifests } = require('./lib/loadManifests');
const { validateStorageClassSafety } = require('../platform/infrastructure-b/validator');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: check-storageclass-safety.js <manifest-dir>');
  process.exit(2);
}

// Registered/verified local-path-provisioner custom node paths. Empty by
// default: CloudPort ships no verified custom node path configuration, so
// any manifest that sets parameters.nodePath is rejected until an operator
// explicitly registers a verified path here after configuring the
// provisioner ConfigMap accordingly.
const REGISTERED_NODE_PATHS = [];

const manifests = loadManifests(dir).filter((m) => m.kind === 'StorageClass');

let failed = false;
for (const sc of manifests) {
  const result = validateStorageClassSafety(sc, REGISTERED_NODE_PATHS);
  if (!result.ok) {
    console.error(`StorageClass safety violation in ${sc.__sourceFile}: ${result.reason}`);
    failed = true;
  } else {
    console.log(`StorageClass ${sc.metadata?.name} (${sc.__sourceFile}): OK`);
  }
}

process.exit(failed ? 1 : 0);

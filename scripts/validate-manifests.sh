#!/usr/bin/env bash
# Validates YAML syntax (not live-cluster admission) for every manifest under
# platform/. Safe to run with no cluster and no Docker at all.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node -e "
const { loadManifests } = require('$REPO_ROOT/scripts/lib/loadManifests');
const dirs = ['$REPO_ROOT/platform/infrastructure-a', '$REPO_ROOT/platform/infrastructure-b'];
let count = 0;
for (const dir of dirs) {
  const manifests = loadManifests(dir);
  for (const m of manifests) {
    if (!m.kind || !m.apiVersion) {
      console.error('INVALID manifest (missing kind/apiVersion):', m.__sourceFile);
      process.exit(1);
    }
    count += 1;
  }
}
console.log('All ' + count + ' manifest documents parsed and have kind+apiVersion set.');
"

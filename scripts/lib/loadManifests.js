'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Load every YAML manifest (one document per file, CloudPort convention) from
 * a directory, returning parsed objects tagged with their source file name.
 */
function loadManifests(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const manifests = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const docs = yaml.loadAll(fs.readFileSync(full, 'utf8'));
    for (const doc of docs) {
      if (doc) manifests.push({ ...doc, __sourceFile: file });
    }
  }
  return manifests;
}

module.exports = { loadManifests };

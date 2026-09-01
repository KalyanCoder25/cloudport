'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateEvidenceArtifacts, sanitize } = require('../../analyzer/evidence/artifactGenerator');

test('strips keys that look like secrets at any nesting depth', () => {
  const input = { apiKey: 'abc', nested: { password: 'x', keep: 'y' }, list: [{ token: 'z', ok: 1 }] };
  const out = sanitize(input);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.nested.password, undefined);
  assert.equal(out.nested.keep, 'y');
  assert.equal(out.list[0].token, undefined);
  assert.equal(out.list[0].ok, 1);
});

test('generates the full required artifact file set', () => {
  const artifacts = generateEvidenceArtifacts({
    manifest: { name: 'x' },
    infrastructureA: {},
    infrastructureB: {},
    infrastructureDifferences: [],
    telemetryA: {},
    telemetryB: {},
    telemetryATrials: [],
    telemetryBTrials: [],
    behaviourComparison: [],
    leakageAnalysis: {},
    replicationAnalysis: {},
    evidenceGraph: {},
    runtimeProvenance: {},
  });

  const expectedFiles = [
    'experiment-manifest.json',
    'infrastructure-a.json',
    'infrastructure-b.json',
    'infrastructure-differences.json',
    'telemetry-a.json',
    'telemetry-b.json',
    'telemetry-a-trials.json',
    'telemetry-b-trials.json',
    'behaviour-comparison.json',
    'leakage-analysis.json',
    'replication-analysis.json',
    'evidence-graph.json',
    'runtime-provenance.json',
  ];
  for (const f of expectedFiles) {
    assert.ok(f in artifacts, `expected artifact ${f}`);
  }
});

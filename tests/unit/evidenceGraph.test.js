'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEvidenceGraph } = require('../../analyzer/evidence/evidenceGraph');

test('builds a traceable node/edge chain from experiment to final finding', () => {
  const graph = buildEvidenceGraph({
    experiment: { id: 'exp-1', name: 'test-experiment', applicationVersion: 'cloudport:1.0.0', manifestChecksum: 'abc' },
    trials: [{ id: 't1' }, { id: 't2' }],
    infrastructureSnapshots: [{ id: 's1' }, { id: 's2' }],
    infrastructureDifferences: [{ dimension: 'Storage', differenceFound: true }],
    telemetryRecords: [{ id: 'tel1' }],
    behaviourComparisons: [{ metric: 'p95_ms', direction: 'INCREASED' }],
    leakageFinding: { score: 40, band: 'MODERATE' },
    replicationAnalysis: { classification: 'CONFIRMED_REPLICATED' },
    causalGovernanceResult: { classification: 'CONFIRMED_REPLICATED', causalLanguage: 'CORRELATION_ONLY' },
  });

  const nodeTypes = graph.nodes.map((n) => n.type);
  for (const expectedType of [
    'Experiment',
    'Trial',
    'InfrastructureSnapshot',
    'InfrastructureDifference',
    'Telemetry',
    'BehaviourComparison',
    'LeakageAnalysis',
    'ReplicationAnalysis',
    'FinalFinding',
  ]) {
    assert.ok(nodeTypes.includes(expectedType), `expected a ${expectedType} node`);
  }

  assert.ok(graph.finalFindingId, 'a final finding node id must be set');
  const supportingEdges = graph.edges.filter((e) => e.to === graph.finalFindingId && e.relation === 'SUPPORTS_FINDING');
  assert.ok(supportingEdges.length > 0, 'the final finding must have supporting evidence edges');
});

test('omits final-finding node when no causal governance result is supplied', () => {
  const graph = buildEvidenceGraph({
    experiment: { id: 'exp-2', name: 'draft-experiment' },
    trials: [],
    infrastructureSnapshots: [],
    infrastructureDifferences: [],
    telemetryRecords: [],
    behaviourComparisons: [],
    leakageFinding: null,
    replicationAnalysis: null,
    causalGovernanceResult: null,
  });
  assert.equal(graph.finalFindingId, null);
});

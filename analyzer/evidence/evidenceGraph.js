/**
 * Evidence Graph
 *
 * Builds a traceable chain of evidence nodes:
 *   Experiment -> Trial -> Infrastructure Snapshot -> Infrastructure Difference
 *   -> Telemetry -> Behaviour Comparison -> Leakage Analysis
 *   -> Replication Analysis -> Final Finding
 *
 * Every "Final Finding" node carries explicit references (by id) to every
 * upstream node that supports it, so no conclusion can be presented without
 * a traceable evidentiary basis.
 */
'use strict';

function buildEvidenceGraph({
  experiment,
  trials,
  infrastructureSnapshots,
  infrastructureDifferences,
  telemetryRecords,
  behaviourComparisons,
  leakageFinding,
  replicationAnalysis,
  causalGovernanceResult,
}) {
  const nodes = [];
  const edges = [];

  function addNode(type, id, data) {
    nodes.push({ id, type, data });
    return id;
  }

  function addEdge(fromId, toId, relation) {
    edges.push({ from: fromId, to: toId, relation });
  }

  const experimentNodeId = addNode('Experiment', `experiment:${experiment.id}`, {
    name: experiment.name,
    applicationVersion: experiment.applicationVersion,
    manifestChecksum: experiment.manifestChecksum,
  });

  const trialNodeIds = (trials || []).map((trial) => {
    const id = addNode('Trial', `trial:${trial.id}`, trial);
    addEdge(experimentNodeId, id, 'HAS_TRIAL');
    return id;
  });

  const snapshotNodeIds = (infrastructureSnapshots || []).map((snap) => {
    const id = addNode('InfrastructureSnapshot', `snapshot:${snap.id}`, snap);
    trialNodeIds.forEach((tid) => addEdge(tid, id, 'OBSERVED_UNDER'));
    return id;
  });

  const differenceNodeIds = (infrastructureDifferences || []).map((diff, i) => {
    const id = addNode('InfrastructureDifference', `difference:${experiment.id}:${diff.dimension}:${i}`, diff);
    snapshotNodeIds.forEach((sid) => addEdge(sid, id, 'COMPARED_IN'));
    return id;
  });

  const telemetryNodeIds = (telemetryRecords || []).map((t) => {
    const id = addNode('Telemetry', `telemetry:${t.id}`, t);
    addEdge(experimentNodeId, id, 'PRODUCED_TELEMETRY');
    return id;
  });

  const comparisonNodeIds = (behaviourComparisons || []).map((c, i) => {
    const id = addNode('BehaviourComparison', `comparison:${experiment.id}:${c.metric}:${i}`, c);
    telemetryNodeIds.forEach((tid) => addEdge(tid, id, 'FEEDS_COMPARISON'));
    return id;
  });

  let leakageNodeId = null;
  if (leakageFinding) {
    leakageNodeId = addNode('LeakageAnalysis', `leakage:${experiment.id}`, leakageFinding);
    comparisonNodeIds.forEach((cid) => addEdge(cid, leakageNodeId, 'INFORMS_LEAKAGE'));
    differenceNodeIds.forEach((did) => addEdge(did, leakageNodeId, 'INFORMS_LEAKAGE'));
  }

  let replicationNodeId = null;
  if (replicationAnalysis) {
    replicationNodeId = addNode('ReplicationAnalysis', `replication:${experiment.id}`, replicationAnalysis);
    comparisonNodeIds.forEach((cid) => addEdge(cid, replicationNodeId, 'INFORMS_REPLICATION'));
  }

  let findingNodeId = null;
  if (causalGovernanceResult) {
    findingNodeId = addNode('FinalFinding', `finding:${experiment.id}`, causalGovernanceResult);
    const supportingIds = [leakageNodeId, replicationNodeId, ...differenceNodeIds, ...comparisonNodeIds].filter(Boolean);
    supportingIds.forEach((sid) => addEdge(sid, findingNodeId, 'SUPPORTS_FINDING'));
  }

  return {
    nodes,
    edges,
    finalFindingId: findingNodeId,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildEvidenceGraph };

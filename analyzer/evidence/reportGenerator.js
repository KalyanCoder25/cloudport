/**
 * Report Generator
 *
 * Produces the structured scientific report (Markdown) described in the
 * CloudPort spec. Before an experiment has executed, the report is emitted
 * in a PRE-EXECUTION state and contains no fabricated numbers. After
 * execution, real values are filled in from persisted evidence; any field
 * for which evidence is absent is rendered as "NOT AVAILABLE" rather than
 * guessed.
 */
'use strict';

const NA = 'NOT AVAILABLE';

function fmt(value) {
  if (value === null || value === undefined) return NA;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : NA;
  return String(value);
}

function generateReport(context) {
  const {
    experiment,
    executed = false,
    infrastructureA,
    infrastructureB,
    checksums,
    infrastructureDifferences,
    telemetry,
    behaviourComparison,
    replicationAnalysis,
    leakageAnalysis,
    causalGovernance,
    limitations = [],
  } = context;

  const statusLine = executed ? 'EXECUTED' : 'PRE-EXECUTION / READY FOR REPLICATED EXPERIMENT';

  const lines = [];
  lines.push(`# Scientific Report: ${experiment.name}`);
  lines.push('');
  lines.push(`**Status:** ${statusLine}`);
  lines.push('');

  lines.push('## 1. Objective');
  lines.push(experiment.description || NA);
  lines.push('');

  lines.push('## 2. Hypothesis');
  lines.push(
    `A change limited to the ${experiment.targetDimension} dimension (Infrastructure B) may produce an ` +
      `application-visible behavior difference relative to Infrastructure A, under otherwise identical ` +
      `application, workload, configuration, and seed.`
  );
  lines.push('');

  lines.push('## 3. Experimental Design');
  lines.push(
    `Paired trials (${fmt(experiment.replicationCount)} planned) are executed under Infrastructure A and ` +
      `Infrastructure B with identical workload parameters. Only the controlled variable is intended to differ.`
  );
  lines.push('');

  lines.push('## 4. Controlled Variable');
  lines.push(fmt(experiment.controlledVariable));
  lines.push('');

  lines.push('## 5. Excluded Variables');
  lines.push((experiment.excludedDimensions || []).map((d) => `- ${d}`).join('\n') || NA);
  lines.push('');

  lines.push('## 6. Application Version');
  lines.push(fmt(experiment.applicationVersion));
  lines.push('');

  lines.push('## 7. Workload');
  lines.push('```json');
  lines.push(JSON.stringify(experiment.workload || {}, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 8. Trial Configuration');
  lines.push(`Replication count: ${fmt(experiment.replicationCount)} paired trials`);
  lines.push('');

  lines.push('## 9. Environment');
  lines.push(
    'Kind cluster with Korifi platform layer. Live cluster verification status is reported per-infrastructure below.'
  );
  lines.push('');

  lines.push('## 10. Infrastructure A');
  lines.push('```json');
  lines.push(JSON.stringify(infrastructureA || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 11. Infrastructure B');
  lines.push('```json');
  lines.push(JSON.stringify(infrastructureB || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 12. Checksums');
  lines.push('```json');
  lines.push(JSON.stringify(checksums || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 13. Infrastructure Differences');
  if (infrastructureDifferences && infrastructureDifferences.length) {
    for (const diff of infrastructureDifferences) {
      lines.push(`- **${diff.dimension}**: ${diff.differenceFound ? 'DIFFERENCE FOUND' : 'no difference'}`);
    }
  } else {
    lines.push(NA);
  }
  lines.push('');

  lines.push('## 14. Telemetry');
  lines.push('```json');
  lines.push(JSON.stringify(telemetry || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 15. Behaviour Comparison');
  lines.push('```json');
  lines.push(JSON.stringify(behaviourComparison || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 16. Replication Analysis');
  lines.push('```json');
  lines.push(JSON.stringify(replicationAnalysis || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 17. Leakage Analysis');
  lines.push('```json');
  lines.push(JSON.stringify(leakageAnalysis || { note: NA }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 18. Causal Governance');
  lines.push('```json');
  lines.push(JSON.stringify(causalGovernance || { classification: 'NO_EVIDENCE', note: 'Experiment has not executed.' }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 19. Limitations');
  const allLimitations = [...limitations];
  if (!executed) {
    allLimitations.unshift('This experiment has not yet executed; all sections above reflect configuration only, not measurement.');
  }
  lines.push(allLimitations.map((l) => `- ${l}`).join('\n') || '- None recorded.');
  lines.push('');

  lines.push('## 20. Conclusion');
  if (!executed) {
    lines.push('PRE-EXECUTION / READY FOR REPLICATED EXPERIMENT. No conclusion can be drawn until trials run.');
  } else {
    lines.push(
      causalGovernance
        ? `Classification: **${causalGovernance.classification}**. ${causalGovernance.rationale}`
        : NA
    );
  }
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateReport };

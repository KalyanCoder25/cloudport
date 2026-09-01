/**
 * Evidence Artifact Generator
 *
 * Produces the sanitized, machine-readable artifact set required by the
 * CloudPort spec. Every artifact is derived strictly from data the caller
 * supplies (persisted experiment/trial/telemetry/analysis records) -- this
 * module never invents values, and it strips any field whose name suggests
 * a secret (password, token, key, secret) before writing an artifact.
 */
'use strict';

const SECRET_KEY_PATTERN = /(password|secret|token|apikey|api_key|private_key)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue; // drop secrets entirely
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

/**
 * @param {object} data - all inputs needed to build the full artifact set
 * @returns {Record<string, object>} map of file name -> sanitized JSON content
 */
function generateEvidenceArtifacts(data) {
  const {
    manifest,
    infrastructureA,
    infrastructureB,
    infrastructureDifferences,
    telemetryA,
    telemetryB,
    telemetryATrials,
    telemetryBTrials,
    behaviourComparison,
    leakageAnalysis,
    replicationAnalysis,
    evidenceGraph,
    runtimeProvenance,
  } = data;

  const artifacts = {
    'experiment-manifest.json': manifest,
    'infrastructure-a.json': infrastructureA,
    'infrastructure-b.json': infrastructureB,
    'infrastructure-differences.json': infrastructureDifferences,
    'telemetry-a.json': telemetryA,
    'telemetry-b.json': telemetryB,
    'telemetry-a-trials.json': telemetryATrials,
    'telemetry-b-trials.json': telemetryBTrials,
    'behaviour-comparison.json': behaviourComparison,
    'leakage-analysis.json': leakageAnalysis,
    'replication-analysis.json': replicationAnalysis,
    'evidence-graph.json': evidenceGraph,
    'runtime-provenance.json': runtimeProvenance,
  };

  const sanitized = {};
  for (const [name, content] of Object.entries(artifacts)) {
    sanitized[name] = sanitize(content ?? null);
  }
  return sanitized;
}

module.exports = { generateEvidenceArtifacts, sanitize };

import React from 'react';

type EvidenceKind = 'observed' | 'inferred' | 'insufficient' | 'good' | 'bad';

const LABELS: Record<EvidenceKind, string> = {
  observed: 'OBSERVED',
  inferred: 'INFERRED',
  insufficient: 'INSUFFICIENT EVIDENCE',
  good: 'OK',
  bad: 'ISSUE',
};

/**
 * Maps a causal-governance / evidence classification string to one of three
 * kinds the UI must always visually distinguish: what was directly measured
 * (Observed), what is a correlation/inference drawn from measurements
 * (Inferred), and claims that cannot yet be supported (Insufficient Evidence).
 */
export function classificationToKind(classification: string): EvidenceKind {
  switch (classification) {
    case 'CONFIRMED_REPLICATED':
    case 'APPLICATION_VISIBLE_CORRELATION':
      return 'observed';
    case 'POTENTIAL_LEAKAGE':
    case 'INFRASTRUCTURE_DIFFERENCE_ONLY':
    case 'VARIABLE_REPLICATION':
    case 'CORRELATION_ONLY':
      return 'inferred';
    default:
      return 'insufficient';
  }
}

export function EvidenceBadge({ kind, label }: { kind: EvidenceKind; label?: string }) {
  return (
    <span className={`badge badge-${kind}`}>
      <span className="badge-dot" />
      {label || LABELS[kind]}
    </span>
  );
}

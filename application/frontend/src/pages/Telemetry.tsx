import React from 'react';
import { PageHeader } from '../components/PageHeader';

export default function Telemetry() {
  return (
    <>
      <PageHeader title="Telemetry" subtitle="Per-trial request/latency/throughput data." />
      <div className="panel">
        <div className="panel-title">Latency percentiles</div>
        <div className="metric-grid">
          {['p50', 'p90', 'p95', 'p99', 'max'].map((p) => (
            <div className="metric-cell" key={p}>
              <div className="metric-label">{p.toUpperCase()}</div>
              <div className="metric-value">&mdash;</div>
            </div>
          ))}
        </div>
        <p className="empty-state">
          No telemetry recorded yet for this experiment. Telemetry populates here once trials execute --
          CloudPort never fabricates latency, throughput, or error figures.
        </p>
      </div>
    </>
  );
}

import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api, TelemetryRecord } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Telemetry() {
  const { id } = useDefaultExperimentId();
  const telemetry = useAsync<TelemetryRecord[]>(() => (id ? api.getTelemetry(id) : Promise.resolve([])), [id]);

  return (
    <>
      <PageHeader title="Telemetry" subtitle="Per-trial request/latency/throughput data." />
      <div className="panel">
        <div className="panel-title">Latency percentiles &amp; trials</div>
        <AsyncPanel
          loading={telemetry.loading}
          error={telemetry.error}
          data={telemetry.data}
          empty="No telemetry recorded yet for this experiment. Telemetry populates here once trials execute -- CloudPort never fabricates latency, throughput, or error figures."
          render={(trials) => {
            const latest = trials[trials.length - 1];
            return (
              <>
                <div className="metric-grid" style={{ marginBottom: 20 }}>
                  {[
                    { label: 'P50', val: latest?.p50_ms },
                    { label: 'P90', val: latest?.p90_ms },
                    { label: 'P95', val: latest?.p95_ms },
                    { label: 'P99', val: latest?.p99_ms },
                    { label: 'MAX', val: latest?.max_ms },
                  ].map((m) => (
                    <div className="metric-cell" key={m.label}>
                      <div className="metric-label">{m.label} (ms)</div>
                      <div className="metric-value">{m.val !== undefined && m.val !== null ? m.val.toFixed(2) : '—'}</div>
                    </div>
                  ))}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Trial #</th>
                      <th>Infra</th>
                      <th>Requests</th>
                      <th>Throughput (ops/s)</th>
                      <th>P50 (ms)</th>
                      <th>P95 (ms)</th>
                      <th>Max (ms)</th>
                      <th>Recorded At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trials.map((t) => (
                      <tr key={t.id}>
                        <td>Trial {t.trial_index}</td>
                        <td>
                          <strong>{t.infrastructure}</strong>
                        </td>
                        <td>{t.request_count}</td>
                        <td className="mono">{t.throughput_ops_per_sec ? t.throughput_ops_per_sec.toFixed(1) : 'n/a'}</td>
                        <td className="mono">{t.p50_ms !== null ? t.p50_ms.toFixed(2) : 'n/a'}</td>
                        <td className="mono">{t.p95_ms !== null ? t.p95_ms.toFixed(2) : 'n/a'}</td>
                        <td className="mono">{t.max_ms !== null ? t.max_ms.toFixed(2) : 'n/a'}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {new Date(t.recorded_at).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          }}
        />
      </div>
    </>
  );
}

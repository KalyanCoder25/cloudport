import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Leakage() {
  const { id } = useDefaultExperimentId();
  const leakage = useAsync(() => (id ? api.getLeakage(id) : Promise.resolve(null)), [id]);

  return (
    <>
      <PageHeader title="Leakage Analysis" subtitle="Transparent 0-100 score with a fully documented rubric." />
      <div className="panel">
        <AsyncPanel
          loading={leakage.loading}
          error={leakage.error}
          data={leakage.data}
          empty="No leakage finding recorded for this experiment yet."
          render={(finding) => (
            <>
              <div className="metric-grid" style={{ marginBottom: 20 }}>
                <div className="metric-cell">
                  <div className="metric-label">Score</div>
                  <div className="metric-value">{finding.score} / 100</div>
                </div>
                <div className="metric-cell">
                  <div className="metric-label">Classification</div>
                  <div className="metric-value" style={{ fontSize: 14 }}>
                    {finding.classification}
                  </div>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Rubric item</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(finding.rubric || {}).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="mono">{v as number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 16 }}>{finding.rationale}</p>
            </>
          )}
        />
      </div>
    </>
  );
}

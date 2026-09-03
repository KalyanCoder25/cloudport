import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Comparison() {
  const { id } = useDefaultExperimentId();
  const differences = useAsync(() => (id ? api.getDifferences(id) : Promise.resolve([])), [id]);
  const behaviour = useAsync(() => (id ? api.getBehaviour(id) : Promise.resolve([])), [id]);

  return (
    <>
      <PageHeader title="A/B Comparison" subtitle="Infrastructure differences and behaviour comparison for the selected experiment." />

      <div className="panel">
        <div className="panel-title">Infrastructure Differences</div>
        <AsyncPanel
          loading={differences.loading}
          error={differences.error}
          data={differences.data}
          empty="No infrastructure differences recorded. For identical infrastructure, this is expected: zero differences."
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.dimension}>
                    <td>{d.dimension}</td>
                    <td>{d.difference_found ? 'DIFFERENCE FOUND' : 'No difference'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>

      <div className="panel">
        <div className="panel-title">Behaviour Comparison</div>
        <AsyncPanel
          loading={behaviour.loading}
          error={behaviour.error}
          data={behaviour.data}
          empty="No behaviour comparisons recorded yet. Execute an experiment to compare Infrastructure A and B."
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Mean A</th>
                  <th>Mean B</th>
                  <th>Delta</th>
                  <th>% Change</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.metric}>
                    <td>{c.metric}</td>
                    <td className="mono">{c.mean_a ?? 'n/a'}</td>
                    <td className="mono">{c.mean_b ?? 'n/a'}</td>
                    <td className="mono">{c.delta ?? 'n/a'}</td>
                    <td className="mono">{c.percent_change !== null ? `${c.percent_change.toFixed(1)}%` : 'n/a'}</td>
                    <td>{c.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>
    </>
  );
}

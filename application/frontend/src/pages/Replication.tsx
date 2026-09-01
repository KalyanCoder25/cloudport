import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';
import { EvidenceBadge, classificationToKind } from '../components/EvidenceBadge';

export default function Replication() {
  const { id } = useDefaultExperimentId();
  const replication = useAsync<any[]>(() => (id ? api.getReplication(id) : Promise.resolve([])), [id]);

  return (
    <>
      <PageHeader
        title="Replication"
        subtitle="Never classified from a single trial -- at least two paired trials are required."
      />
      <div className="panel">
        <AsyncPanel
          loading={replication.loading}
          error={replication.error}
          data={replication.data}
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Trials</th>
                  <th>Directional Consistency</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r: any) => (
                  <tr key={r.metric}>
                    <td>{r.metric}</td>
                    <td>{r.trial_count}</td>
                    <td className="mono">{r.directional_consistency ?? 'n/a'}</td>
                    <td>
                      <EvidenceBadge kind={classificationToKind(r.classification)} label={r.classification} />
                    </td>
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

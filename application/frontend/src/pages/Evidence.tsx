import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Evidence() {
  const { id } = useDefaultExperimentId();
  const evidence = useAsync<any[]>(() => (id ? api.getEvidence(id) : Promise.resolve([])), [id]);

  return (
    <>
      <PageHeader
        title="Evidence"
        subtitle="Every artifact traces back through Trial -> Infrastructure Snapshot -> Difference -> Telemetry -> Comparison -> Finding."
      />
      <div className="panel">
        <AsyncPanel
          loading={evidence.loading}
          error={evidence.error}
          data={evidence.data}
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Artifact</th>
                  <th>Type</th>
                  <th>Checksum</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.file_name}</td>
                    <td>{a.artifact_type}</td>
                    <td className="checksum">{(a.checksum || '').slice(0, 16)}&hellip;</td>
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

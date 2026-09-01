import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Recovery() {
  const { id } = useDefaultExperimentId();
  const recovery = useAsync<any[]>(() => (id ? api.getRecovery(id) : Promise.resolve([])), [id]);

  return (
    <>
      <PageHeader title="Recovery" subtitle="Measured recovery observations only -- never a guarantee without evidence." />
      <div className="panel">
        <AsyncPanel
          loading={recovery.loading}
          error={recovery.error}
          data={recovery.data}
          empty="No fault/recovery events recorded for this experiment."
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Recovery Time (ms)</th>
                  <th>Service Available</th>
                  <th>State Consistent</th>
                  <th>Idempotency</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r: any) => (
                  <tr key={r.id}>
                    <td className="mono">{r.recovery_time_ms ?? 'n/a'}</td>
                    <td>{String(r.service_available)}</td>
                    <td>{String(r.state_consistent)}</td>
                    <td>{String(r.idempotency_verified)}</td>
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

import React, { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';

export default function Experiments() {
  const experiments = useAsync(() => api.listExperiments(), []);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function handleRun(id: string) {
    setRunError(null);
    setRunningId(id);
    try {
      await api.runExperiment(id);
    } catch (err: any) {
      setRunError(err.message);
    } finally {
      setRunningId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Experiments"
        subtitle="Execution requires an explicit operator action -- experiments never auto-run after provisioning."
      />
      {runError && <div className="callout">Run request failed: {runError}</div>}
      <div className="panel">
        <AsyncPanel
          loading={experiments.loading}
          error={experiments.error}
          data={experiments.data}
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>App Version</th>
                  <th>Workload</th>
                  <th>Controlled Variable</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((exp) => (
                  <tr key={exp.id}>
                    <td>{exp.name}</td>
                    <td className="mono">{exp.application_version}</td>
                    <td>{exp.workload}</td>
                    <td>{exp.controlled_variable}</td>
                    <td>{exp.status}</td>
                    <td>
                      <button
                        disabled={exp.status !== 'READY_FOR_EXECUTION' || runningId === exp.id}
                        onClick={() => handleRun(exp.id)}
                      >
                        {runningId === exp.id ? 'Starting...' : 'Run'}
                      </button>
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

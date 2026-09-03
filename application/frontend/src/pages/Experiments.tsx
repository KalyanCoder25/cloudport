import React, { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';

export default function Experiments() {
  const experiments = useAsync(() => api.listExperiments(), []);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleValidate(id: string) {
    setActionError(null);
    setValidatingId(id);
    try {
      await api.validateExperiment(id);
      experiments.reload();
    } catch (err: any) {
      setActionError(err.message || 'Validation failed');
      experiments.reload();
    } finally {
      setValidatingId(null);
    }
  }

  async function handleRun(id: string) {
    setActionError(null);
    setRunningId(id);
    try {
      await api.runExperiment(id);
      experiments.reload();
      // Poll briefly to catch status updates from background run
      setTimeout(() => experiments.reload(), 1500);
      setTimeout(() => experiments.reload(), 3000);
    } catch (err: any) {
      setActionError(err.message || 'Run failed');
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
      {actionError && <div className="callout">Action failed: {actionError}</div>}
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
                  <th>Actions</th>
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
                    <td style={{ display: 'flex', gap: 8 }}>
                      {(exp.status === 'DRAFT' || exp.status === 'FAILED_VALIDATION') && (
                        <button
                          disabled={validatingId === exp.id || runningId === exp.id}
                          onClick={() => handleValidate(exp.id)}
                        >
                          {validatingId === exp.id ? 'Validating...' : 'Validate Parity'}
                        </button>
                      )}
                      {exp.status === 'READY_FOR_EXECUTION' && (
                        <button
                          disabled={runningId === exp.id}
                          onClick={() => handleRun(exp.id)}
                        >
                          {runningId === exp.id ? 'Starting...' : 'Run'}
                        </button>
                      )}
                      {(exp.status === 'RUNNING' || exp.status === 'COMPLETED' || exp.status === 'ABORTED') && (
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {exp.status === 'RUNNING' ? 'Executing...' : 'Finished'}
                        </span>
                      )}
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

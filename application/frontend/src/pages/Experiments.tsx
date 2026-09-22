import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api, Application, Experiment } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useAuth } from '../context/AuthContext';

export default function Experiments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeApp } = useAuth();

  const experiments = useAsync(() => api.listExperiments(), []);
  const appsAsync = useAsync(() => api.listApplications(), []);

  const [runningId, setRunningId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Creation form state
  const isCreateRequested = searchParams.get('create') === 'true';
  const queryAppId = searchParams.get('application_id') || '';

  const [formName, setFormName] = useState('');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [targetDimension, setTargetDimension] = useState('Compute,Storage');
  const [workloadType, setWorkloadType] = useState('STORAGE');
  const [pairedTrials, setPairedTrials] = useState(3);
  const [operationCount, setOperationCount] = useState(20);
  const [concurrency, setConcurrency] = useState(2);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Filter out system baseline and archived applications so experiments attach only to active user applications
  const userApplications = (appsAsync.data || []).filter(
    (app: Application) => app.name !== 'CloudPort Core Research Suite' && app.status !== 'ARCHIVED'
  );

  // Sync preselected application from query param or activeApp
  useEffect(() => {
    if (queryAppId) {
      setSelectedAppId(queryAppId);
    } else if (activeApp && activeApp.name !== 'CloudPort Core Research Suite') {
      setSelectedAppId(activeApp.id);
    } else if (userApplications.length > 0 && !selectedAppId) {
      setSelectedAppId(userApplications[0].id);
    }
  }, [queryAppId, activeApp, userApplications, selectedAppId]);

  // Set default experiment name when app changes
  useEffect(() => {
    if (selectedAppId && !formName) {
      const app = userApplications.find((a: Application) => a.id === selectedAppId);
      if (app) {
        setFormName(`${app.name} Portability Evaluation`);
      }
    }
  }, [selectedAppId, formName, userApplications]);

  function handleCloseCreate() {
    setSearchParams({});
    setCreateError(null);
  }

  async function handleCreateExperiment(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!selectedAppId) {
      setCreateError('Please select a target application.');
      return;
    }
    const app = userApplications.find((a: Application) => a.id === selectedAppId);
    if (!app) {
      setCreateError('Invalid application selected or access denied.');
      return;
    }

    setCreating(true);
    try {
      const controlledVar = targetDimension.includes('Compute') ? 'COMPUTE' : 'STORAGE';
      const manifest = {
        application: {
          name: app.name,
          version: 'v1.0.0',
        },
        workload: {
          type: workloadType,
          seed: Math.floor(Math.random() * 899999) + 100000,
          concurrency: Number(concurrency),
          operationCount: Number(operationCount),
          description: `Deterministic workload for ${app.name}`,
        },
        controlledVariable: controlledVar,
        targetDimension: targetDimension,
        replication: {
          pairedTrials: Number(pairedTrials),
        },
        replicationCount: Number(pairedTrials),
      };

      await api.createExperiment({
        name: formName.trim(),
        applicationId: selectedAppId,
        manifest,
      });

      handleCloseCreate();
      experiments.reload();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create experiment');
    } finally {
      setCreating(false);
    }
  }

  async function handleValidate(id: string) {
    setActionError(null);
    setValidatingId(id);
    try {
      await api.validateExperiment(id);
      experiments.reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Validation failed');
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
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunningId(null);
    }
  }

  return (
    <>
      <div className="page-header-container">
        <div>
          <PageHeader
            title="Experiments"
            subtitle="Execution requires an explicit operator action -- experiments never auto-run after provisioning."
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (isCreateRequested) {
              handleCloseCreate();
            } else {
              setSearchParams({ create: 'true' });
            }
          }}
          className="btn btn-primary btn-sm page-header-btn"
        >
          {isCreateRequested ? '✕ Cancel' : '+ Create Experiment'}
        </button>
      </div>

      {actionError && <div className="callout callout-warn margin-b-16">Action failed: {actionError}</div>}

      {/* Experiment Creation Workflow */}
      {isCreateRequested && (
        <div className="panel panel-workflow">
          <div className="workflow-header">
            <div className="panel-title workflow-title">
              New Portability Experiment Workflow
            </div>
            <button
              type="button"
              onClick={handleCloseCreate}
              className="btn btn-outline btn-sm"
            >
              ✕ Close
            </button>
          </div>

          {createError && <div className="alert-error margin-b-16">{createError}</div>}

          <form onSubmit={handleCreateExperiment}>
            <div className="form-grid-240-mb16">
              <div className="form-group">
                <label className="form-label" htmlFor="exp-name">
                  Experiment Name *
                </label>
                <input
                  id="exp-name"
                  type="text"
                  className="input form-select-full"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Gateway Latency Portability Evaluation"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exp-app">
                  Target Application *
                </label>
                <select
                  id="exp-app"
                  className="input form-select-full"
                  required
                  value={selectedAppId}
                  onChange={(e) => setSelectedAppId(e.target.value)}
                >
                  <option value="" disabled>Select an application...</option>
                  {userApplications.map((app: Application) => (
                    <option key={app.id} value={app.id}>
                      {app.name} ({app.framework})
                    </option>
                  ))}
                </select>
                <div className="form-hint">
                  Only user-owned applications are permitted.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exp-dim">
                  Infrastructure Target Dimension *
                </label>
                <select
                  id="exp-dim"
                  className="input form-select-full"
                  value={targetDimension}
                  onChange={(e) => setTargetDimension(e.target.value)}
                >
                  <option value="Compute,Storage">
                    Compute &amp; Storage (Kind Local Cluster Baseline vs Variant &mdash; Recommended)
                  </option>
                  <option value="Compute">
                    Compute Isolation Only (Requires identical StorageClasses)
                  </option>
                  <option value="Storage">
                    Storage Substrate Only (Requires identical CPU limits)
                  </option>
                </select>
                <div className="form-hint-amber">
                  Kind cluster has active CPU (2000m vs 200m) and StorageClass (standard vs standard-throttled) variants.
                </div>
              </div>
            </div>

            <div className="form-grid-130-mb20">
              <div className="form-group">
                <label className="form-label" htmlFor="exp-trials">
                  Paired Trials
                </label>
                <input
                  id="exp-trials"
                  type="number"
                  className="input form-select-full"
                  min="1"
                  max="10"
                  value={pairedTrials}
                  onChange={(e) => setPairedTrials(Number(e.target.value))}
                />
                <div className="form-hint">
                  &ge; 5 recommended for paired t-test
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exp-workload">
                  Workload Type
                </label>
                <select
                  id="exp-workload"
                  className="input form-select-full"
                  value={workloadType}
                  onChange={(e) => setWorkloadType(e.target.value)}
                >
                  <option value="STORAGE">Storage I/O &amp; CPU Workload</option>
                  <option value="COMPUTE">CPU-Bound Workload</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exp-ops">
                  Operation Count
                </label>
                <input
                  id="exp-ops"
                  type="number"
                  className="input form-select-full"
                  min="10"
                  max="200"
                  value={operationCount}
                  onChange={(e) => setOperationCount(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="exp-concurrency">
                  Concurrency
                </label>
                <input
                  id="exp-concurrency"
                  type="number"
                  className="input form-select-full"
                  min="1"
                  max="8"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="modal-footer-actions">
              <button
                type="button"
                onClick={handleCloseCreate}
                disabled={creating}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !selectedAppId || !formName.trim()}
                className="btn btn-primary btn-sm"
              >
                {creating ? 'Creating...' : 'Create Experiment (Draft)'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Experiments List Panel */}
      <div className="panel">
        <AsyncPanel
          loading={experiments.loading}
          error={experiments.error}
          data={experiments.data}
          render={(data: Experiment[]) => (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>App Version</th>
                  <th>Workload</th>
                  <th>Controlled Variable</th>
                  <th>Target Dimension</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((exp: Experiment) => (
                  <tr key={exp.id}>
                    <td>{exp.name}</td>
                    <td className="mono">{exp.application_version}</td>
                    <td>{exp.workload}</td>
                    <td>{exp.controlled_variable}</td>
                    <td>{exp.target_dimension}</td>
                    <td>
                      <span
                        className={`badge ${
                          exp.status === 'COMPLETED'
                            ? 'badge-good'
                            : exp.status === 'FAILED_VALIDATION' || exp.status === 'ABORTED'
                            ? 'badge-bad'
                            : 'badge-observed'
                        }`}
                      >
                        <span className="badge-dot" /> {exp.status}
                      </span>
                    </td>
                    <td className="table-actions">
                      {(exp.status === 'DRAFT' || exp.status === 'FAILED_VALIDATION') && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={validatingId === exp.id || runningId === exp.id}
                          onClick={() => handleValidate(exp.id)}
                        >
                          {validatingId === exp.id ? 'Validating...' : 'Validate Parity'}
                        </button>
                      )}
                      {exp.status === 'READY_FOR_EXECUTION' && (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={runningId === exp.id}
                          onClick={() => handleRun(exp.id)}
                        >
                          {runningId === exp.id ? 'Starting...' : 'Run'}
                        </button>
                      )}
                      {(exp.status === 'RUNNING' || exp.status === 'COMPLETED' || exp.status === 'ABORTED') && (
                        <span className="table-status-text">
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

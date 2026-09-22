import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, Application, Experiment, Deployment } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeApp, setActiveApp, refreshApplications } = useAuth();

  const [data, setData] = useState<{
    application: Application;
    experiments: Experiment[];
    deployments?: Deployment[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rename application states
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Delete deployment states
  const [depToDelete, setDepToDelete] = useState<Deployment | null>(null);
  const [deletingDep, setDeletingDep] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Lifecycle states
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lifecycleSuccess, setLifecycleSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getApplication(id)
      .then((res) => {
        setData(res);
        setNameInput(res.application.name);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load application');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="loading-state">Loading application details...</div>;
  }

  if (error || !data) {
    return (
      <div className="page-container">
        <div className="alert-error">{error || 'Application not found'}</div>
        <Link to="/applications" className="btn btn-secondary">
          &larr; Back to Applications
        </Link>
      </div>
    );
  }

  const { application, experiments, deployments = [] } = data;
  const isActive = activeApp?.id === application.id;
  const isBaseline = application.name === 'CloudPort Core Research Suite';

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) {
      setNameError('Application name cannot be empty.');
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await api.updateApplication(application.id, { name: nameInput.trim() });
      setData((prev) => (prev ? { ...prev, application: updated } : null));
      if (isActive) {
        setActiveApp(updated);
      }
      setIsEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to rename application');
    } finally {
      setSavingName(false);
    }
  };

  const handleDeleteDeployment = async () => {
    if (!depToDelete) return;
    setDeletingDep(true);
    setDeleteError(null);
    try {
      await api.deleteDeployment(depToDelete.id, true);
      // Remove deleted deployment from state
      setData((prev) =>
        prev
          ? {
              ...prev,
              deployments: prev.deployments?.filter((d) => d.id !== depToDelete.id),
            }
          : null
      );
      setDepToDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete deployment');
    } finally {
      setDeletingDep(false);
    }
  };

  const handleArchiveApplication = async () => {
    setArchiving(true);
    setArchiveError(null);
    setLifecycleSuccess(null);
    try {
      const updated = await api.archiveApplication(application.id);
      setData((prev) => (prev ? { ...prev, application: updated } : null));
      setArchiveModalOpen(false);
      setLifecycleSuccess('Application archived successfully. Research history and deployments remain preserved.');
      await refreshApplications();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive application');
    } finally {
      setArchiving(false);
    }
  };

  const handleRestoreApplication = async () => {
    setRestoring(true);
    setRestoreError(null);
    setLifecycleSuccess(null);
    try {
      const updated = await api.restoreApplication(application.id);
      setData((prev) => (prev ? { ...prev, application: updated } : null));
      setLifecycleSuccess('Application restored successfully and is now active.');
      await refreshApplications();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore application');
    } finally {
      setRestoring(false);
    }
  };

  const isArchived = application.status === 'ARCHIVED';

  const getProviderLabel = (p: string) => {
    switch (p) {
      case 'aws_eks':
        return 'AWS EKS';
      case 'gcp_gke':
        return 'GCP GKE';
      case 'local_k8s':
        return 'Local Kubernetes';
      default:
        return p;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return (
          <span className="badge badge-good">
            <span className="badge-dot" /> RUNNING
          </span>
        );
      case 'BLOCKED_CREDENTIALS':
      case 'BLOCKED_CONFIGURATION':
        return (
          <span className="badge badge-warn" style={{ borderColor: 'var(--signal-amber)' }}>
            <span className="badge-dot" /> {status}
          </span>
        );
      case 'DELETING':
      case 'STOPPING':
        return (
          <span className="badge badge-accent">
            <span className="badge-dot" /> {status}
          </span>
        );
      case 'DELETED':
      case 'STOPPED':
        return (
          <span className="badge">
            <span className="badge-dot" /> {status}
          </span>
        );
      case 'FAILED':
      case 'DELETE_FAILED':
        return (
          <span className="badge badge-bad">
            <span className="badge-dot" /> {status}
          </span>
        );
      default:
        return (
          <span className="badge">
            <span className="badge-dot" /> {status}
          </span>
        );
    }
  };

  return (
    <div className="page-container">
      <div className="nav-back-container">
        <Link to="/applications" className="nav-back-link">
          &larr; All Applications
        </Link>
      </div>

      {/* Success / Alert notification */}
      {lifecycleSuccess && (
        <div className="alert-success alert-dismissible">
          <span>{lifecycleSuccess}</span>
          <button
            onClick={() => setLifecycleSuccess(null)}
            className="alert-close-btn"
          >
            &times;
          </button>
        </div>
      )}

      {/* Application Overview Panel */}
      <div className="panel detail-panel-header">
        <div className="detail-panel-content">
          {isEditingName ? (
            <form onSubmit={handleSaveName} className="rename-form">
              <label className="rename-label">
                Edit Application Name
              </label>
              <div className="rename-form-group">
                <input
                  type="text"
                  className="input rename-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={savingName}
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(application.name);
                    setIsEditingName(false);
                    setNameError(null);
                  }}
                  className="btn btn-secondary btn-sm"
                  disabled={savingName}
                >
                  Cancel
                </button>
              </div>
              {nameError && <div className="rename-error">{nameError}</div>}
            </form>
          ) : (
            <div className="detail-title-group">
              <div>
                <div className="detail-eyebrow">
                  APPLICATION
                </div>
                <h1 className="page-title detail-title">
                  {application.name}
                </h1>
              </div>
              {isArchived ? (
                <span className="badge badge-warn badge-aligned">
                  <span className="badge-dot" /> ARCHIVED
                </span>
              ) : (
                <span className="badge badge-good badge-aligned">
                  <span className="badge-dot" /> ACTIVE
                </span>
              )}
              {!isBaseline && !isArchived && (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="btn btn-outline btn-sm btn-rename"
                  title="Rename Application"
                >
                  Rename
                </button>
              )}
            </div>
          )}

          {/* Clean Decoupled Technology & Framework Badges */}
          <div className="tech-badges-group">
            <span className="tech-label">Technology:</span>
            <span className="badge badge-accent">
              {application.technology || 'NODE'}
            </span>
            <span className="tech-label tech-label-ml">Framework:</span>
            <span className="tech-framework-val">
              {application.framework}
            </span>
          </div>

          <p className="detail-desc">
            {application.description || 'No description provided.'}
          </p>
          {application.repository_url && (
            <div className="detail-repo">
              <span className="detail-repo-label">Repository: </span>
              <a href={application.repository_url} target="_blank" rel="noopener noreferrer">
                {application.repository_url}
              </a>
            </div>
          )}
        </div>

        <div className="detail-actions">
          {isArchived ? (
            <button
              onClick={handleRestoreApplication}
              className="btn btn-outline btn-sm action-btn-green"
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Restore Application'}
            </button>
          ) : (
            <>
              {!isBaseline && (
                <Link
                  to={`/deploy?application_id=${application.id}`}
                  className="btn btn-primary btn-sm"
                >
                  + Deploy Application
                </Link>
              )}

              {isActive ? (
                <span className="badge badge-good">
                  <span className="badge-dot" /> ACTIVE APPLICATION
                </span>
              ) : (
                <button onClick={() => setActiveApp(application)} className="btn btn-secondary btn-sm">
                  Set Active Application
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Target Deployments Panel */}
      {!isBaseline && (
        <div className="panel detail-section-panel">
          <div className="panel-header">
            <div className="panel-title-no-border">
              Multi-Cloud Deployments ({deployments.length})
            </div>
            {!isArchived && (
              <Link
                to={`/deploy?application_id=${application.id}`}
                className="btn btn-primary btn-sm"
              >
                + Deploy Application
              </Link>
            )}
          </div>

          {deployments.length === 0 ? (
            <div className="empty-state">
              No deployments created for this application yet. Click <strong>+ Deploy Application</strong> to configure AWS EKS, GCP GKE, or Local Kubernetes.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Target Provider</th>
                  <th>Status</th>
                  <th>Environment</th>
                  <th>Source Reference</th>
                  <th>Endpoint</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((dep) => (
                  <tr key={dep.id}>
                    <td className="font-semibold">{getProviderLabel(dep.target_provider)}</td>
                    <td>{getStatusBadge(dep.status)}</td>
                    <td className="mono">{dep.target_environment}</td>
                    <td className="mono table-cell-truncate">
                      {dep.source_reference}
                    </td>
                    <td>
                      {dep.endpoint_url ? (
                        <a href={dep.endpoint_url} target="_blank" rel="noopener noreferrer" className="table-link-small">
                          {dep.endpoint_url}
                        </a>
                      ) : (
                        <span className="table-none-small">None</span>
                      )}
                    </td>
                    <td className="mono table-date-small">
                      {new Date(dep.updated_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link to={`/deployments/${dep.id}`} className="btn btn-outline btn-sm action-btn">
                          View
                        </Link>
                        <button
                          onClick={() => setDepToDelete(dep)}
                          className="btn btn-outline btn-sm action-btn-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Associated Experiments Panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title-no-border">
            Associated Portability Experiments ({experiments.length})
          </div>
          {!isArchived && (
            <Link
              to={`/experiments?create=true&application_id=${application.id}`}
              className="btn btn-outline btn-sm"
            >
              + Create Experiment
            </Link>
          )}
        </div>

        {experiments.length === 0 ? (
          <div className="empty-state">
            No experiments have been linked to this application yet. Run an experiment to observe portability across infrastructure targets.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Experiment Name</th>
                <th>Status</th>
                <th>Workload</th>
                <th>Controlled Variable</th>
                <th>Target Dimension</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp: Experiment) => (
                <tr key={exp.id}>
                  <td>
                    <Link to={`/experiments?id=${exp.id}`} style={{ fontWeight: 500 }}>
                      {exp.name}
                    </Link>
                  </td>
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
                  <td className="mono">{exp.workload}</td>
                  <td className="mono">{exp.controlled_variable}</td>
                  <td>{exp.target_dimension}</td>
                  <td className="mono table-date-small">
                    {new Date(exp.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Danger Zone */}
      {!isBaseline && (
        <div className="panel danger-zone-panel">
          <div className="danger-zone-header">
            <span>&#9888; Danger Zone</span>
          </div>

          <div className="danger-zone-content">
            <div className="danger-zone-text-group">
              <div className="danger-zone-title">
                {isArchived ? 'Restore Application' : 'Archive Application'}
              </div>
              <p className="danger-zone-desc">
                {isArchived
                  ? 'Restoring will return this application to active workflows, allowing new deployments and experiments to be created.'
                  : 'Archiving removes this application from active workflows but preserves its research history (experiments, trials, telemetry, evidence, reports, and deployment records).'}
              </p>
            </div>
            <div>
              {isArchived ? (
                <button
                  onClick={handleRestoreApplication}
                  className="btn btn-outline btn-sm action-btn-green"
                  disabled={restoring}
                >
                  {restoring ? 'Restoring...' : 'Restore Application'}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setArchiveError(null);
                    setArchiveModalOpen(true);
                  }}
                  className="btn btn-outline btn-sm action-btn-danger"
                >
                  Archive Application
                </button>
              )}
            </div>
          </div>
          {restoreError && (
            <div className="alert-error margin-t-12">
              {restoreError}
            </div>
          )}
        </div>
      )}

      {/* Delete Deployment Confirmation Modal / Dialog */}
      {depToDelete && (
        <div className="modal-overlay-dark">
          <div className="panel modal-danger-content">
            <div className="modal-danger-title">
              &#9888; Delete Deployment Confirmation
            </div>
            <p className="modal-danger-desc">
              Are you sure you want to delete the deployment on <strong>{getProviderLabel(depToDelete.target_provider)}</strong>?
            </p>
            <div className="alert-box-danger">
              <strong>Important:</strong> This permanently removes the deployment infrastructure. Your application source and experiment history will remain.
            </div>

            {deleteError && (
              <div className="alert-error margin-b-14">
                {deleteError}
              </div>
            )}

            <div className="modal-footer-actions no-margin-t">
              <button
                onClick={() => {
                  setDepToDelete(null);
                  setDeleteError(null);
                }}
                className="btn btn-secondary btn-sm"
                disabled={deletingDep}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDeployment}
                className="btn btn-primary btn-sm btn-danger-solid"
                disabled={deletingDep}
              >
                {deletingDep ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Application Confirmation Modal / Dialog */}
      {archiveModalOpen && (
        <div className="modal-overlay-dark">
          <div className="panel modal-warning-content">
            <div className="modal-warning-title">
              Archive Application?
            </div>
            <p className="modal-warning-desc">
              This application will be removed from active workflows.
            </p>
            <div className="alert-box-warning">
              Its experiments, telemetry, evidence, reports, and deployment history will remain available.
            </div>

            <div className="modal-warning-info">
              <span className="modal-warning-label">Application: </span>
              <strong className="modal-warning-val">{application.name}</strong>
            </div>

            {archiveError && (
              <div className="alert-error margin-b-14">
                {archiveError}
              </div>
            )}

            <div className="modal-footer-actions no-margin-t">
              <button
                onClick={() => {
                  setArchiveModalOpen(false);
                  setArchiveError(null);
                }}
                className="btn btn-secondary btn-sm"
                disabled={archiving}
              >
                Cancel
              </button>
              <button
                onClick={handleArchiveApplication}
                className="btn btn-primary btn-sm btn-warning-solid"
                disabled={archiving}
              >
                {archiving ? 'Archiving...' : 'Archive Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

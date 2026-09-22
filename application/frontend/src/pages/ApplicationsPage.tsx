import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, Application } from '../api/client';

export default function ApplicationsPage() {
  const { applications, activeApp, setActiveApp, refreshApplications } = useAuth();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [framework, setFramework] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Application name is required');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createApplication({
        name: name.trim(),
        description: description.trim() || undefined,
        framework: framework.trim(),
        repository_url: repoUrl.trim() || undefined,
      });
      await refreshApplications();
      setActiveApp(created);
      setIsModalOpen(false);
      setName('');
      setDescription('');
      setRepoUrl('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setSubmitting(false);
    }
  };

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    setActionError(null);
    try {
      await api.restoreApplication(id);
      await refreshApplications();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to restore application');
    } finally {
      setRestoringId(null);
    }
  };

  const activeApplications = applications.filter((app: Application) => app.status !== 'ARCHIVED');
  const archivedApplications = applications.filter((app: Application) => app.status === 'ARCHIVED');

  return (
    <div className="page-container">
      <div className="page-header-actions">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle no-margin">
            Manage registered services, active lifecycles, and track portability experiments across targets.
          </p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
          + New Application
        </button>
      </div>

      {actionError && <div className="alert-error margin-b-16">{actionError}</div>}

      {applications.length === 0 ? (
        <div className="panel empty-state-panel">
          <div className="empty-state-title">No Applications Registered</div>
          <p className="empty-state-text-large">
            Register your application to start testing storage isolation, CPU throttling, and network policies across clouds.
          </p>
          <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
            Create First Application
          </button>
        </div>
      ) : (
        <>
          {/* Active Applications Section */}
          <div className="app-section">
            <div className="app-section-header">
              <h2 className="app-section-title">
                Active Applications ({activeApplications.length})
              </h2>
            </div>

            {activeApplications.length === 0 ? (
              <div className="panel empty-state-small">
                No active applications. You can restore an archived application below or create a new application.
              </div>
            ) : (
              <div className="app-grid">
                {activeApplications.map((app: Application) => {
                  const isActive = activeApp?.id === app.id;
                  return (
                    <div
                      key={app.id}
                      className={`panel app-card ${isActive ? 'app-card-active' : ''}`}
                    >
                      <div className="app-card-header">
                        <div>
                          <div className="app-card-title">{app.name}</div>
                          <span className="badge-tech-small">
                            {app.technology || app.framework || 'CUSTOM'}
                          </span>
                        </div>
                        {isActive ? (
                          <span className="badge badge-good">
                            <span className="badge-dot" /> ACTIVE
                          </span>
                        ) : (
                          <button
                            onClick={() => setActiveApp(app)}
                            className="btn btn-secondary btn-sm"
                          >
                            Select
                          </button>
                        )}
                      </div>

                      <p className="app-card-desc">
                        {app.description || 'No description provided.'}
                      </p>

                      <div className="app-card-footer">
                        <span className="app-card-stat">
                          Experiments:{' '}
                          <strong className="app-card-stat-val">
                            {app.experiment_count || 0}
                          </strong>
                        </span>
                        <Link to={`/applications/${app.id}`} className="app-card-link">
                          View Details &rarr;
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Archived Applications Section */}
          {archivedApplications.length > 0 && (
            <div className="app-section">
              <div className="app-section-header-col">
                <h2 className="app-section-title-archived">
                  Archived Applications ({archivedApplications.length})
                </h2>
                <p className="app-section-desc">
                  Historical research preserved. Archiving removes applications from active deployment and experiment workflows.
                </p>
              </div>

              <div className="app-grid">
                {archivedApplications.map((app: Application) => (
                  <div key={app.id} className="panel app-card app-card-archived">
                    <div className="app-card-header">
                      <div>
                        <div className="app-card-title-archived">{app.name}</div>
                        <span className="badge-tech-archived">
                          {app.technology || app.framework || 'CUSTOM'}
                        </span>
                      </div>
                      <span className="badge badge-bad">
                        <span className="badge-dot" /> ARCHIVED
                      </span>
                    </div>

                    <p className="app-card-desc-archived">
                      {app.description || 'Historical research preserved.'}
                    </p>

                    <div className="app-card-footer">
                      <span className="app-card-stat-archived">
                        Experiments:{' '}
                        <strong className="app-card-stat-val-archived">
                          {app.experiment_count || 0}
                        </strong>
                      </span>
                      <div className="app-card-actions">
                        <button
                          onClick={() => handleRestore(app.id)}
                          className="btn btn-outline btn-sm action-btn-green"
                          disabled={restoringId === app.id}
                        >
                          {restoringId === app.id ? 'Restoring...' : 'Restore'}
                        </button>
                        <Link to={`/applications/${app.id}`} className="btn btn-outline btn-sm action-btn">
                          View Details &rarr;
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal for creating an application */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 className="modal-title">Register New Application</h2>

            {error && <div className="alert-error">{error}</div>}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Application Name *</label>
                <input
                  type="text"
                  required
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Payments Gateway Service"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Primary workloads and portability objectives..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Framework / Stack</label>
                <input
                  type="text"
                  className="input"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  placeholder="e.g. Node.js, Go / Gin, Python / FastAPI"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Repository URL (Optional)</label>
                <input
                  type="url"
                  className="input"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                />
              </div>

              <div className="modal-footer-actions">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-outline"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

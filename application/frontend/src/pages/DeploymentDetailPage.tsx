import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { api, Deployment, Application } from '../api/client';

export default function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [siblingDeployments, setSiblingDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const dep = await api.getDeployment(id);
      setDeployment(dep);

      // Load application details and siblings
      const appRes = await api.getApplication(dep.application_id);
      setApplication(appRes.application);
      if (appRes.deployments) {
        setSiblingDeployments(appRes.deployments);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleStart = async () => {
    if (!id) return;
    setActionLoading(true);
    setError(null);
    setActionSuccess(null);
    try {
      const updated = await api.startDeployment(id);
      setDeployment(updated);
      setActionSuccess(`Deployment initiated. Current status: ${updated.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start deployment');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setActionLoading(true);
    setError(null);
    setActionSuccess(null);
    try {
      const updated = await api.stopDeployment(id);
      setDeployment(updated);
      setActionSuccess('Deployment stopped.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop deployment');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteDeployment(id, true);
      setDeleteModalOpen(false);
      setActionSuccess('Deployment infrastructure permanently removed. Application and research history preserved.');
      // Refresh or mark as deleted
      setDeployment((prev) => (prev ? { ...prev, status: 'DELETED', endpoint_url: undefined } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deployment');
    } finally {
      setDeleting(false);
    }
  };

  const getProviderLabel = (p?: string) => {
    switch (p) {
      case 'aws_eks':
        return 'AWS EKS';
      case 'gcp_gke':
        return 'GCP GKE';
      case 'local_k8s':
        return 'Local Kubernetes';
      default:
        return p || 'Unknown Provider';
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
      case 'READY':
        return (
          <span className="badge badge-accent">
            <span className="badge-dot" /> READY
          </span>
        );
      case 'DEPLOYING':
      case 'QUEUED':
        return (
          <span className="badge badge-accent">
            <span className="badge-dot" /> {status}
          </span>
        );
      case 'STOPPING':
      case 'DELETING':
        return (
          <span className="badge badge-accent">
            <span className="badge-dot" /> {status}
          </span>
        );
      case 'STOPPED':
        return (
          <span className="badge badge-inactive">
            <span className="badge-dot" /> STOPPED
          </span>
        );
      case 'DELETED':
        return (
          <span className="badge badge-inactive">
            <span className="badge-dot" /> DELETED
          </span>
        );
      case 'BLOCKED_CREDENTIALS':
        return (
          <span className="badge badge-warn" style={{ borderColor: 'var(--signal-amber)' }}>
            <span className="badge-dot" /> BLOCKED (CREDENTIALS REQUIRED)
          </span>
        );
      case 'BLOCKED_CONFIGURATION':
        return (
          <span className="badge badge-warn" style={{ borderColor: 'var(--signal-amber)' }}>
            <span className="badge-dot" /> BLOCKED (CONFIGURATION)
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

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading deployment status...</div>;
  }

  if (error && !deployment) {
    return (
      <div>
        <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">
          ← Back
        </button>
      </div>
    );
  }

  if (!deployment) return null;

  const isBlocked =
    deployment.status === 'BLOCKED_CREDENTIALS' ||
    deployment.status === 'BLOCKED_CONFIGURATION';

  return (
    <div className="deployment-detail-container">
      <div className="nav-back-container nav-back-flex">
        <Link
          to={`/applications/${deployment.application_id}`}
          className="nav-back-link"
        >
          &larr; Back to Application ({application?.name || 'Application'})
        </Link>
        <Link to="/deploy" className="btn btn-outline btn-sm">
          + Deploy to Another Target
        </Link>
      </div>

      {actionSuccess && <div className="alert-good margin-b-16">{actionSuccess}</div>}
      {error && <div className="alert-error margin-b-16">{error}</div>}

      <div className="panel detail-section-panel">
        <div className="detail-panel-header">
          <div>
            <div className="deploy-target-eyebrow">
              TARGET DEPLOYMENT
            </div>
            <h1 className="deploy-title">
              {application?.name || 'User Application'} on {getProviderLabel(deployment.target_provider)}
            </h1>
            <div className="deploy-meta">
              Environment: <code>{deployment.target_environment}</code> &bull; Source: <code>{deployment.source_reference}</code>
            </div>
          </div>
          <div>{getStatusBadge(deployment.status)}</div>
        </div>
      </div>

      {/* Sibling Target Tabs / Status Cards */}
      {siblingDeployments.length > 1 && (
        <div className="margin-b-20">
          <div className="sibling-tabs-label">
            All Active Targets for this Application
          </div>
          <div className="sibling-tabs-grid">
            {siblingDeployments.map((sib) => {
              const isCurrent = sib.id === deployment.id;
              return (
                <Link
                  key={sib.id}
                  to={`/deployments/${sib.id}`}
                  className={`sibling-tab ${isCurrent ? 'sibling-tab-active' : ''}`}
                >
                  <div className="sibling-tab-title">
                    {getProviderLabel(sib.target_provider)}
                  </div>
                  <div>{getStatusBadge(sib.status)}</div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary Status & Diagnostics Card */}
      <div className="panel margin-b-20">
        <div className="panel-title">Deployment Diagnostics &amp; Verification</div>

        {isBlocked ? (
          <div className="margin-t-12">
            <div className="diag-step-panel">
              <div className="diag-step-title">
                &#9898; Not Configured &mdash; {deployment.status === 'BLOCKED_CREDENTIALS' ? 'Credentials Required' : 'Configuration Missing'}
              </div>
              <div className="diag-step-desc">
                {deployment.error_message || 'Missing provider authentication or Kubernetes cluster context.'}
              </div>

              <div className="diag-step-instructions">
                <strong>Remediation Steps:</strong>
                {deployment.target_provider === 'aws_eks' ? (
                  <ol className="diag-step-list">
                    <li>Ensure AWS CLI is installed and in system PATH (<code>aws --version</code>).</li>
                    <li>Configure credentials via <code>aws configure</code> or export <code>AWS_ACCESS_KEY_ID</code> and <code>AWS_SECRET_ACCESS_KEY</code>.</li>
                    <li>Provision or attach an EKS cluster with context <code>aws-eks-cloudport</code> in your kubeconfig.</li>
                    <li>Click <strong>Retry Verification</strong> below once credentials and cluster are available.</li>
                  </ol>
                ) : deployment.target_provider === 'gcp_gke' ? (
                  <ol className="diag-step-list">
                    <li>Ensure Google Cloud SDK (gcloud) is installed (<code>gcloud --version</code>).</li>
                    <li>Authenticate via <code>gcloud auth login</code> and select your active GCP project.</li>
                    <li>Provision or attach a GKE cluster with context <code>gcp-gke-cloudport</code> in your kubeconfig.</li>
                    <li>Click <strong>Retry Verification</strong> below once configuration is available.</li>
                  </ol>
                ) : (
                  <ol className="diag-step-list">
                    <li>Ensure local Kind cluster (<code>kind-korifi</code>) is running.</li>
                    <li>Check that <code>kubectl</code> is connected to the local cluster context.</li>
                  </ol>
                )}
              </div>
            </div>

            <div className="action-group">
              <button
                onClick={handleStart}
                className="btn btn-primary btn-sm"
                disabled={actionLoading || deleting}
              >
                {actionLoading ? 'Verifying...' : 'Retry Verification'}
              </button>
              <button
                onClick={() => setDeleteModalOpen(true)}
                className="btn btn-outline btn-sm danger-outline-btn"
                disabled={actionLoading || deleting}
              >
                Delete Deployment
              </button>
            </div>
          </div>
        ) : deployment.status === 'DELETED' ? (
          <div className="margin-t-12">
            <div className="removed-infra-panel">
              <div className="removed-infra-title">
                Infrastructure Removed
              </div>
              <p className="removed-infra-desc">
                The target deployment infrastructure has been removed from the provider. Your application source project, configuration, historical experiments, and telemetry evidence remain intact.
              </p>
            </div>
            <div className="action-group">
              <Link to="/deploy" className="btn btn-primary btn-sm">
                + Create New Deployment
              </Link>
              <Link to={`/applications/${deployment.application_id}`} className="btn btn-secondary btn-sm">
                Back to Application
              </Link>
            </div>
          </div>
        ) : deployment.status === 'RUNNING' ? (
          <div className="margin-t-12">
            <div className="deploy-metrics-grid">
              <div>
                <div className="metric-label">ENDPOINT URL</div>
                <div className="metric-val">
                  {deployment.endpoint_url ? (
                    <a href={deployment.endpoint_url} target="_blank" rel="noopener noreferrer">
                      {deployment.endpoint_url}
                    </a>
                  ) : (
                    'Cluster-internal service'
                  )}
                </div>
              </div>
              <div>
                <div className="metric-label">TARGET ENVIRONMENT</div>
                <div className="metric-val-normal">{deployment.target_environment}</div>
              </div>
              <div>
                <div className="metric-label">DEPLOYED AT</div>
                <div className="metric-val-normal">
                  {new Date(deployment.updated_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="action-group">
              <Link
                to={`/experiments?create=true&application_id=${deployment.application_id}`}
                className="btn btn-primary btn-sm"
              >
                + Run Portability Experiment
              </Link>
              <button
                onClick={handleStop}
                className="btn btn-outline btn-sm"
                disabled={actionLoading || deleting}
              >
                {actionLoading ? 'Stopping...' : 'Stop Deployment'}
              </button>
              <button
                onClick={() => setDeleteModalOpen(true)}
                className="btn btn-outline btn-sm danger-outline-btn"
                disabled={actionLoading || deleting}
              >
                Delete Deployment
              </button>
            </div>
          </div>
        ) : (
          <div className="margin-t-12">
            <p className="deploy-meta margin-b-16">
              Deployment is currently in state <strong>{deployment.status}</strong>.
            </p>
            <div className="action-group">
              <button
                onClick={handleStart}
                className="btn btn-primary btn-sm"
                disabled={actionLoading || deleting}
              >
                {actionLoading ? 'Starting...' : 'Start Deployment'}
              </button>
              <button
                onClick={() => setDeleteModalOpen(true)}
                className="btn btn-outline btn-sm danger-outline-btn"
                disabled={actionLoading || deleting}
              >
                Delete Deployment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Deployment Deletion */}
      {deleteModalOpen && (
        <div className="modal-overlay-dark">
          <div className="modal-danger-content">
            <div className="modal-danger-title">
              Delete Deployment Target?
            </div>
            <p className="modal-danger-desc">
              Are you sure you want to delete this <strong>{getProviderLabel(deployment.target_provider)}</strong> deployment?
            </p>
            <div className="alert-box-danger margin-b-20 no-margin-t">
              &#9888; <strong>Notice:</strong> This permanently removes the deployment infrastructure. Your application and experiment history will remain.
            </div>

            <div className="modal-footer-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting from Provider...' : 'Permanently Delete Deployment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scientific Telemetry & Observation Notice */}
      <div className="callout">
        <strong>CloudPort Rigor Guarantee:</strong> Statuses reflect genuine provider telemetry.
        When genuine cloud infrastructure is connected, this dashboard will surface live latency, throughput,
        CPU, and memory metrics, feeding directly into the CloudPort Parity and Leakage Analyzer.
      </div>
    </div>
  );
}

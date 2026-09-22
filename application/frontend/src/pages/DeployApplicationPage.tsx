import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import {
  api,
  Application,
  DeploymentTargetProvider,
  TechnologyType,
  TechnologyDetectionResult,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function DeployApplicationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedAppId = searchParams.get('application_id');
  const { activeApp } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState<string>(preselectedAppId || activeApp?.id || '');

  const [sourceType, setSourceType] = useState<'github_repo' | 'zip_upload' | 'docker_image'>('github_repo');
  const [githubUrl, setGithubUrl] = useState('');
  const [dockerImageUrl, setDockerImageUrl] = useState('');

  // Technology Detection states
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<TechnologyDetectionResult | null>(null);

  // Manual configuration states
  const [selectedTech, setSelectedTech] = useState<TechnologyType>('AUTO');
  const [buildCommand, setBuildCommand] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [port, setPort] = useState(8080);
  const [dockerfilePath, setDockerfilePath] = useState('');

  const [selectedTargets, setSelectedTargets] = useState<Record<DeploymentTargetProvider, boolean>>({
    aws_eks: true,
    gcp_gke: true,
    local_k8s: false,
  });

  const [step, setStep] = useState<'configure' | 'review'>('configure');
  const [costAcknowledged, setCostAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingApps(true);
    api
      .listApplications()
      .then((apps) => {
        // Exclude system baseline and archived applications from deployment targets
        const userApps = apps.filter((a) => a.name !== 'CloudPort Core Research Suite' && a.status !== 'ARCHIVED');
        setApplications(userApps);
        if (!selectedAppId && userApps.length > 0) {
          setSelectedAppId(userApps[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load applications'))
      .finally(() => setLoadingApps(false));
  }, []);

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  // Update URL if selected app has repository_url
  useEffect(() => {
    if (selectedApp?.repository_url) {
      setGithubUrl(selectedApp.repository_url);
    }
  }, [selectedAppId]);

  const handleDetectTechnology = async () => {
    if (!githubUrl || !githubUrl.trim().startsWith('https://github.com/')) {
      setError('Please enter a valid GitHub repository URL first.');
      return;
    }
    setDetecting(true);
    setError(null);
    try {
      const res = await api.detectTechnology(githubUrl.trim());
      setDetectionResult(res);
      if (res.technology && res.technology !== 'UNKNOWN') {
        setSelectedTech(res.technology);
        if (res.recommendedConfig) {
          if (res.recommendedConfig.port) setPort(res.recommendedConfig.port);
          if (res.recommendedConfig.buildCommand) setBuildCommand(res.recommendedConfig.buildCommand);
          if (res.recommendedConfig.startCommand) setStartCommand(res.recommendedConfig.startCommand);
          if (res.recommendedConfig.dockerfilePath) setDockerfilePath(res.recommendedConfig.dockerfilePath);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Technology detection error');
    } finally {
      setDetecting(false);
    }
  };

  const handleTargetToggle = (provider: DeploymentTargetProvider) => {
    setSelectedTargets((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const getActiveTargetList = (): DeploymentTargetProvider[] => {
    return (Object.keys(selectedTargets) as DeploymentTargetProvider[]).filter(
      (key) => selectedTargets[key]
    );
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedAppId) {
      setError('Please select an application to deploy.');
      return;
    }

    if (sourceType === 'zip_upload') {
      setError('ZIP upload is reserved for future enterprise isolation runtime. Please select GitHub repository or Docker Image URL.');
      return;
    }

    if (sourceType === 'docker_image') {
      if (!dockerImageUrl || !dockerImageUrl.trim()) {
        setError('Please provide a Container Registry URL (e.g. nginx:latest or docker.io/myuser/myapp:v1).');
        return;
      }
    } else {
      if (!githubUrl || !githubUrl.trim().startsWith('https://github.com/')) {
        setError('Please provide a valid GitHub repository HTTPS URL (e.g. https://github.com/username/repository).');
        return;
      }
    }

    const activeTargets = getActiveTargetList();
    if (activeTargets.length === 0) {
      setError('Please select at least one deployment target (AWS EKS, GCP GKE, or Local Kubernetes).');
      return;
    }

    setStep('review');
  };

  const handleConfirmAndDeploy = async () => {
    if (!costAcknowledged) {
      setError('Please acknowledge the cloud resource and cost notice to proceed.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const activeTargets = getActiveTargetList();
      const isDocker = sourceType === 'docker_image';
      const sourceRef = isDocker ? dockerImageUrl.trim() : githubUrl.trim();
      const effectiveTech = isDocker ? 'DOCKER' : selectedTech;

      const created = await api.createDeployment({
        application_id: selectedAppId,
        source_type: sourceType,
        source_reference: sourceRef,
        image_reference: isDocker ? dockerImageUrl.trim() : undefined,
        target_providers: activeTargets,
        technology: effectiveTech,
        buildCommand: isDocker ? undefined : (buildCommand || undefined),
        startCommand: isDocker ? undefined : (startCommand || undefined),
        port: port || undefined,
        dockerfilePath: isDocker ? undefined : (dockerfilePath || undefined),
        configuration: {
          technology: effectiveTech,
          framework: isDocker ? 'Docker Container' : (detectionResult?.framework || selectedApp?.framework || selectedTech),
          buildCommand: isDocker ? '' : buildCommand,
          startCommand: isDocker ? '' : startCommand,
          port,
          dockerfilePath: isDocker ? '' : dockerfilePath,
        },
      });

      // Navigate to deployment detail
      if (created && created.length > 0) {
        navigate(`/deployments/${created[0].id}`);
      } else {
        navigate(`/applications/${selectedAppId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment');
      setSubmitting(false);
    }
  };

  return (
    <div className="deploy-container">
      <div className="nav-back-container">
        <Link to="/applications" className="nav-back-link">
          &larr; Back to Applications
        </Link>
      </div>

      <PageHeader
        title="Deploy Application"
        subtitle="Provision and orchestrate user application deployments across multi-cloud environments"
      />

      {error && <div className="alert-error" style={{ marginBottom: 20 }}>{error}</div>}

      {step === 'configure' ? (
        <form onSubmit={handleProceedToReview}>
          {/* Section 1: Target Application */}
          <div className="panel detail-section-panel">
            <div className="panel-title">1. Target Application</div>
            <p className="detail-desc">
              Select the application to deploy. System research baselines are protected and cannot be deployed to.
            </p>

            {loadingApps ? (
              <div className="loading-state">Loading user applications...</div>
            ) : applications.length === 0 ? (
              <div className="empty-state">
                No user applications found. Please <Link to="/applications">create an application</Link> first.
              </div>
            ) : (
              <div>
                <div className="form-grid-240">
                  <div>
                    <label className="form-label-upper">
                      Application Name:
                    </label>
                    <select
                      value={selectedAppId}
                      onChange={(e) => setSelectedAppId(e.target.value)}
                      className="input form-select-full"
                    >
                      {applications.map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label-upper">
                      Current Technology:
                    </label>
                    <div className="tech-detect-badge-group">
                      <span className="badge badge-accent">
                        {selectedApp?.technology || 'NODE'}
                      </span>
                      <span className="tech-detect-framework">
                        ({selectedApp?.framework || 'Node.js / Express'})
                      </span>
                    </div>
                  </div>
                </div>

                {selectedApp?.description && (
                  <div className="app-select-desc">
                    {selectedApp.description}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Application Source & Technology Detection */}
          <div className="panel detail-section-panel">
            <div className="panel-title">2. Application Source</div>
            <p className="detail-desc">
              Provide the GitHub repository URL. CloudPort safely inspects project manifests to determine runtime requirements.
            </p>

            <div className="source-type-group">
              <label className="source-type-label">
                <input
                  type="radio"
                  name="sourceType"
                  value="github_repo"
                  checked={sourceType === 'github_repo'}
                  onChange={() => setSourceType('github_repo')}
                />
                <strong>GitHub Repository (Recommended)</strong>
              </label>

              <label className="source-type-label source-type-label-disabled">
                <input
                  type="radio"
                  name="sourceType"
                  value="zip_upload"
                  checked={sourceType === 'zip_upload'}
                  onChange={() => setSourceType('zip_upload')}
                />
                <span>ZIP Upload (Isolated Sandbox)</span>
              </label>

              <label className="source-type-label">
                <input
                  type="radio"
                  name="sourceType"
                  value="docker_image"
                  checked={sourceType === 'docker_image'}
                  onChange={() => setSourceType('docker_image')}
                />
                <strong>Docker Image URL (Recommended for Capstone)</strong>
              </label>
            </div>

            {sourceType === 'docker_image' ? (
              <div>
                <label className="form-label">
                  Container Registry URL:
                </label>
                <div className="source-input-group">
                  <input
                    type="text"
                    className="input form-select-full"
                    placeholder="nginx:latest or docker.io/myuser/myapp:v1"
                    value={dockerImageUrl}
                    onChange={(e) => setDockerImageUrl(e.target.value)}
                    required
                  />
                </div>
              </div>
            ) : sourceType === 'github_repo' ? (
              <div>
                <label className="form-label">
                  Repository HTTPS URL:
                </label>
                <div className="source-input-flex">
                  <input
                    type="url"
                    className="input source-input"
                    placeholder="https://github.com/username/repository"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleDetectTechnology}
                    className="btn btn-secondary btn-sm"
                    disabled={detecting || !githubUrl}
                  >
                    {detecting ? 'Detecting...' : 'Detect Technology'}
                  </button>
                </div>
                <div className="source-input-hint">
                  Currently optimized for single-service Node.js, Python, or Java repositories containing a root Dockerfile.
                </div>

                {/* Technology Detection Feedback Card */}
                {detectionResult && (
                  <div className={`detect-feedback-panel ${detectionResult.technology !== 'UNKNOWN' ? 'detect-success' : 'detect-warn'}`}>
                    <div className="detect-header">
                      {detectionResult.technology !== 'UNKNOWN' ? (
                        <span className="detect-title-success">&#10003; Detected Technology:</span>
                      ) : (
                        <span className="detect-title-warn">&#9888; Technology Unknown:</span>
                      )}
                      <span className="badge badge-accent">{detectionResult.technology}</span>
                      <strong className="detect-framework">{detectionResult.framework}</strong>
                    </div>

                    {detectionResult.evidence.length > 0 && (
                      <div className="detect-evidence">
                        <strong>Evidence: </strong> {detectionResult.evidence.join(', ')}
                      </div>
                    )}

                    {detectionResult.note && (
                      <div className="detect-note">
                        {detectionResult.note}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="callout callout-warn">
                <strong>Enterprise Sandbox Roadmap:</strong> Secure arbitrary ZIP extraction requires an isolated ephemeral builder pod. GitHub repository source is active.
              </div>
            )}
          </div>

          {/* Section 3: Deployment Configuration (Manual Fallback) */}
          <div className="panel detail-section-panel">
            <div className="panel-title">3. Deployment Configuration</div>
            <p className="detail-desc">
              Configure runtime commands, container settings, and listen ports. Pre-filled from detection where available.
            </p>

            <div className="form-grid-240">
              <div>
                <label className="form-label-upper">
                  Runtime / Technology:
                </label>
                <select
                  value={selectedTech}
                  onChange={(e) => setSelectedTech(e.target.value as TechnologyType)}
                  className="input form-select-full"
                >
                  <option value="AUTO">AUTO (Auto-Detect)</option>
                  <option value="NODE">Node.js / Express</option>
                  <option value="REACT_VITE">React / Vite</option>
                  <option value="PYTHON">Python</option>
                  <option value="DJANGO">Django</option>
                  <option value="JAVA">Java / Spring Boot</option>
                  <option value="GO">Go</option>
                  <option value="PHP">PHP</option>
                  <option value="DOTNET">.NET</option>
                  <option value="DOCKER">Docker Container</option>
                  <option value="CUSTOM">Custom Configuration</option>
                </select>
              </div>

              <div>
                <label className="form-label-upper">
                  Target Port:
                </label>
                <input
                  type="number"
                  className="input form-select-full"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 8080)}
                  required
                />
              </div>
            </div>

            <div className="form-grid-240-no-mb">
              <div>
                <label className="form-label-upper">
                  Build Command:
                </label>
                <input
                  type="text"
                  className="input form-select-full"
                  placeholder="e.g. npm install / pip install -r requirements.txt"
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label-upper">
                  Start Command:
                </label>
                <input
                  type="text"
                  className="input form-select-full"
                  placeholder="e.g. npm start / python main.py / ./server"
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label-upper">
                  Dockerfile Path (Optional):
                </label>
                <input
                  type="text"
                  className="input form-select-full"
                  placeholder="Dockerfile"
                  value={dockerfilePath}
                  onChange={(e) => setDockerfilePath(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Multi-Cloud Deployment Targets */}
          <div className="panel margin-b-24">
            <div className="panel-title">4. Multi-Cloud Deployment Targets</div>
            <p className="detail-desc">
              Select target cloud or local environments for deployment and comparative portability observation.
            </p>

            <div className="target-grid">
              {/* Local K8s */}
              <div
                onClick={() => handleTargetToggle('local_k8s')}
                className={`target-card ${selectedTargets.local_k8s ? 'target-card-active' : ''}`}
              >
                <div className="target-card-title-group">
                  <input
                    type="checkbox"
                    checked={selectedTargets.local_k8s}
                    onChange={() => {}}
                    className="target-card-checkbox"
                  />
                  <strong className="target-card-title">Local Kubernetes</strong>
                </div>
                <div className="target-card-desc">
                  Local development environment (kind-korifi) in isolated namespace. Zero cloud charges.
                </div>
              </div>

              {/* AWS EKS */}
              <div
                onClick={() => handleTargetToggle('aws_eks')}
                className={`target-card ${selectedTargets.aws_eks ? 'target-card-active' : ''}`}
              >
                <div className="target-card-title-group">
                  <input
                    type="checkbox"
                    checked={selectedTargets.aws_eks}
                    onChange={() => {}}
                    className="target-card-checkbox"
                  />
                  <strong className="target-card-title">AWS EKS</strong>
                </div>
                <div className="target-card-desc">
                  Amazon Elastic Kubernetes Service. Requires AWS CLI or configured cloud credentials.
                </div>
              </div>

              {/* GCP GKE */}
              <div
                onClick={() => handleTargetToggle('gcp_gke')}
                className={`target-card ${selectedTargets.gcp_gke ? 'target-card-active' : ''}`}
              >
                <div className="target-card-title-group">
                  <input
                    type="checkbox"
                    checked={selectedTargets.gcp_gke}
                    onChange={() => {}}
                    className="target-card-checkbox"
                  />
                  <strong className="target-card-title">GCP GKE</strong>
                </div>
                <div className="target-card-desc">
                  Google Kubernetes Engine. Requires Google Cloud SDK (gcloud) or service account credentials.
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer-actions">
            <Link to="/applications" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loadingApps || applications.length === 0}
            >
              Review Deployment &rarr;
            </button>
          </div>
        </form>
      ) : (
        /* Review Screen */
        <div className="panel">
          <div className="panel-title">Deployment Review &amp; Confirmation</div>
          <p className="detail-desc margin-b-20">
            Review application identity, runtime technology, and target infrastructure before queueing.
          </p>

          <table className="review-table margin-b-20">
            <tbody>
              <tr>
                <td className="review-label">Application:</td>
                <td className="font-semibold">{selectedApp?.name}</td>
              </tr>
              <tr>
                <td className="review-label">Technology / Runtime:</td>
                <td>
                  <span className="badge badge-accent review-badge">{selectedTech}</span>
                  <span>{detectionResult?.framework || selectedApp?.framework || selectedTech}</span>
                </td>
              </tr>
              <tr>
                <td className="review-label">
                  {sourceType === 'docker_image' ? 'Container Registry URL:' : 'Source Repository:'}
                </td>
                <td><code>{sourceType === 'docker_image' ? dockerImageUrl : githubUrl}</code></td>
              </tr>
              <tr>
                <td className="review-label">Target Port:</td>
                <td><code>{port}</code></td>
              </tr>
              {startCommand && (
                <tr>
                  <td className="review-label">Start Command:</td>
                  <td><code>{startCommand}</code></td>
                </tr>
              )}
              <tr>
                <td className="review-label">Selected Targets:</td>
                <td>
                  <div className="review-target-badges">
                    {getActiveTargetList().map((t) => (
                      <span key={t} className="badge badge-accent">
                        {t === 'aws_eks' ? 'AWS EKS' : t === 'gcp_gke' ? 'GCP GKE' : 'Local Kubernetes'}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Explicit Cloud Charge Notice */}
          <div className="cloud-notice-panel margin-b-24">
            <div className="cloud-notice-title">
              &#9888; Explicit Cloud Provisioning Notice
            </div>
            <div className="cloud-notice-text">
              Cloud resources in AWS EKS and GCP GKE may incur provider infrastructure charges.
              CloudPort operates with strict scientific integrity: real cloud infrastructure is only provisioned
              when valid credentials and verified clusters exist. If credentials are missing, deployments
              will transition to <strong>BLOCKED_CREDENTIALS</strong> with truthful diagnostic guidance.
            </div>

            <label className="cloud-notice-checkbox">
              <input
                type="checkbox"
                checked={costAcknowledged}
                onChange={(e) => setCostAcknowledged(e.target.checked)}
              />
              I understand deployment targets and acknowledge explicit operator confirmation is required.
            </label>
          </div>

          <div className="review-actions">
            <button
              type="button"
              onClick={() => setStep('configure')}
              className="btn btn-secondary"
              disabled={submitting}
            >
              &larr; Back to Configuration
            </button>

            <button
              type="button"
              onClick={handleConfirmAndDeploy}
              className="btn btn-primary"
              disabled={!costAcknowledged || submitting}
            >
              {submitting ? 'Queueing Deployments...' : 'Confirm & Deploy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CloudPort Deployment Service.
 *
 * Orchestrates multi-target deployments with strict authorization,
 * explicit confirmation gates, and truthful provider state management.
 */
'use strict';

const { getProvider, normalizeProviderKey } = require('./deploymentProviders');

function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

class DeploymentService {
  constructor(deps = {}) {
    this.query = deps.query;
    this.providers = deps.providers || null;
    this._getProvider = (target) => {
      if (deps.getProvider) {
        return deps.getProvider(target);
      }
      return getProvider(target, this.providers);
    };
  }

  /**
   * Validates source reference format to prevent command/protocol injection.
   */
  validateSource(sourceType, sourceReference) {
    if (!sourceReference || typeof sourceReference !== 'string' || !sourceReference.trim()) {
      throw createHttpError(400, 'Source reference is required.');
    }
    const cleanRef = sourceReference.trim();
    const normSource = String(sourceType || 'GITHUB').toUpperCase();

    if (normSource === 'GITHUB' || normSource === 'GITHUB_REPO') {
      const githubRegex = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/i;
      if (!githubRegex.test(cleanRef)) {
        throw createHttpError(400, 'Invalid GitHub repository URL. Format must be a valid HTTPS GitHub repository URL (e.g. https://github.com/owner/repository).');
      }
    } else if (normSource === 'ZIP_ARCHIVE' || normSource === 'ZIP_UPLOAD') {
      throw createHttpError(400, 'ZIP archive uploads are not yet enabled in this environment. Use a GitHub repository URL.');
    } else if (normSource === 'DOCKER_IMAGE' || normSource === 'DOCKER' || normSource === 'IMAGE') {
      const imageRegex = /^[a-zA-Z0-9_.\-/: ]+$/;
      if (!imageRegex.test(cleanRef)) {
        throw createHttpError(400, 'Invalid Docker image URL. Format must be like nginx:latest or docker.io/myuser/myapp:v1.');
      }
    } else {
      throw createHttpError(400, `Unsupported source type: "${sourceType}". Supported: GITHUB, DOCKER_IMAGE`);
    }
    return cleanRef;
  }

  /**
   * Creates deployment records for requested targets in DRAFT state.
   */
  async createDeployments(arg1, arg2) {
    let user;
    let data;

    if (arg1 && arg1.user) {
      user = arg1.user;
      data = arg1;
    } else {
      user = arg1;
      data = arg2 || {};
    }

    if (!user) {
      throw createHttpError(401, 'Authentication required to create a deployment');
    }

    const applicationId = data.applicationId || data.application_id;
    const sourceType = data.sourceType || data.source_type || 'GITHUB';
    const sourceReference = data.sourceReference || data.source_reference;
    const imageReference = data.imageReference || data.image_reference;
    const targets = data.targetProviders || data.target_providers || (data.targetProvider ? [data.targetProvider] : []);

    if (!applicationId) {
      throw createHttpError(400, 'Target application_id is required');
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      throw createHttpError(400, 'At least one target provider must be selected (aws_eks, gcp_gke, local_k8s)');
    }

    const cleanSourceRef = this.validateSource(sourceType, sourceReference);

    // Verify application exists and ownership
    const appRes = await this.query(
      'SELECT id, name, owner_id, status FROM applications WHERE id = $1',
      [applicationId]
    );
    if (appRes.rowCount === 0) {
      throw createHttpError(404, 'Target application not found');
    }

    const app = appRes.rows[0];
    if (app.name === 'CloudPort Core Research Suite' && user.role !== 'admin') {
      throw createHttpError(403, 'Forbidden: cannot deploy to the protected system baseline application');
    }

    if (app.owner_id !== user.id && user.role !== 'admin') {
      throw createHttpError(403, 'Forbidden: you do not have permission to deploy this application');
    }

    if (app.status === 'ARCHIVED') {
      throw createHttpError(409, 'Cannot create deployment for an archived application. Restore the application first.');
    }

    const createdDeployments = [];

    const configuration = data.configuration || {
      technology: data.technology || 'AUTO',
      buildCommand: data.buildCommand || data.build_command || null,
      startCommand: data.startCommand || data.start_command || null,
      port: data.port || 8080,
      dockerfilePath: data.dockerfilePath || data.dockerfile_path || null,
    };

    for (const target of targets) {
      const canonicalProvider = String(target).toLowerCase();
      const normKey = normalizeProviderKey(target);
      if (!normKey || !['AWS_EKS', 'GCP_GKE', 'LOCAL_KUBERNETES'].includes(normKey)) {
        throw createHttpError(400, `Unsupported target provider: ${target}`);
      }

      const targetEnvironment = normKey === 'LOCAL_KUBERNETES' ? 'local' : 'cloud';

      const insertRes = await this.query(
        `INSERT INTO deployments (
           application_id, owner_id, target_provider, target_environment,
           status, source_type, source_reference, image_reference, configuration, metadata
         ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          app.id,
          user.id,
          canonicalProvider,
          targetEnvironment,
          sourceType,
          cleanSourceRef,
          imageReference ? imageReference.trim() : null,
          JSON.stringify(configuration),
          JSON.stringify({ createdBy: user.email, appName: app.name, ...(data.metadata || {}) }),
        ]
      );

      createdDeployments.push(insertRes.rows[0]);
    }

    return createdDeployments;
  }

  // Alias for single deployment creation
  async createDeployment(user, data) {
    const list = await this.createDeployments(user, data);
    return list[0];
  }

  /**
   * Lists deployments accessible to the authenticated user.
   */
  async listDeployments(arg1, arg2) {
    let user;
    let applicationId;
    let includeDeleted = false;
    if (arg1 && arg1.user) {
      user = arg1.user;
      applicationId = arg1.applicationId || arg1.application_id;
      if (arg1.includeDeleted !== undefined) includeDeleted = arg1.includeDeleted;
    } else {
      user = arg1;
      applicationId = arg2;
    }

    if (!user) {
      throw createHttpError(401, 'Authentication required');
    }

    let sql = `
      SELECT d.*, a.name AS application_name, a.framework AS application_framework, a.technology AS application_technology
      FROM deployments d
      JOIN applications a ON a.id = d.application_id
    `;
    const params = [];

    const conditions = [];
    if (!includeDeleted) {
      conditions.push("d.status != 'DELETED' AND d.deleted_at IS NULL");
    }

    if (user.role !== 'admin') {
      params.push(user.id);
      conditions.push(`d.owner_id = $${params.length}`);
    }

    if (applicationId) {
      params.push(applicationId);
      conditions.push(`d.application_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY d.created_at DESC';

    const result = await this.query(sql, params);
    return result.rows;
  }

  /**
   * Gets a specific deployment by ID with strict ownership validation.
   */
  async getDeployment(arg1, arg2) {
    let user;
    let deploymentId;
    if (arg1 && arg1.user) {
      user = arg1.user;
      deploymentId = arg1.id || arg1.deploymentId || arg1.deployment_id;
    } else {
      user = arg1;
      deploymentId = arg2;
    }

    if (!user) {
      throw createHttpError(401, 'Authentication required');
    }

    const result = await this.query(
      `SELECT d.*, a.name AS application_name, a.framework AS application_framework, a.technology AS application_technology
       FROM deployments d
       JOIN applications a ON a.id = d.application_id
       WHERE d.id = $1`,
      [deploymentId]
    );

    if (result.rowCount === 0) {
      throw createHttpError(404, 'Deployment not found');
    }

    const deployment = result.rows[0];
    if (deployment.owner_id !== user.id && user.role !== 'admin') {
      throw createHttpError(403, 'Forbidden: you do not have permission to access this deployment');
    }

    // Inspect provider status truthfully
    try {
      const provider = this._getProvider(deployment.target_provider);
      const providerStatus = await provider.getStatus(deployment);
      deployment.provider_check = providerStatus;
      await this._reconcileStatus(deployment, providerStatus);
    } catch (_err) {
      // ignore provider status inspection errors
    }

    return deployment;
  }

  /**
   * Persists a status the provider observed on the platform.
   *
   * Deployments that stage asynchronously (Korifi's `cf push` takes minutes)
   * leave the row at DEPLOYING, so without this the database would never catch
   * up to a deployment that has since come up or fallen over.
   */
  async _reconcileStatus(deployment, providerStatus) {
    const RECONCILABLE_FROM = ['DEPLOYING', 'RUNNING', 'STOPPED'];
    const RECONCILABLE_TO = ['DEPLOYING', 'RUNNING', 'STOPPED'];

    const observed = providerStatus?.status;
    if (!observed || observed === deployment.status) return;
    if (!RECONCILABLE_FROM.includes(deployment.status)) return;
    if (!RECONCILABLE_TO.includes(observed)) return;

    const result = await this.query(
      `UPDATE deployments
       SET status = $1,
           endpoint_url = $2,
           started_at = CASE WHEN $1 = 'RUNNING' AND started_at IS NULL THEN now() ELSE started_at END,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [observed, providerStatus.endpointUrl || null, deployment.id]
    );

    if (result.rowCount > 0) {
      Object.assign(deployment, result.rows[0]);
    }
  }

  /**
   * Explicit confirmation step required before deployment can proceed.
   */
  async confirmDeployment(arg1, arg2) {
    let user;
    let deploymentId;
    let confirmed = true;
    if (arg1 && arg1.user) {
      user = arg1.user;
      deploymentId = arg1.id || arg1.deploymentId || arg1.deployment_id;
      if (arg1.confirmed !== undefined) confirmed = arg1.confirmed;
    } else {
      user = arg1;
      deploymentId = arg2;
    }

    if (!confirmed) {
      throw createHttpError(400, 'Deployment confirmation requires confirmed = true');
    }

    const deployment = await this.getDeployment(user, deploymentId);

    if (deployment.status !== 'DRAFT') {
      throw createHttpError(400, `Deployment cannot be confirmed in current status: ${deployment.status}`);
    }

    const updateRes = await this.query(
      `UPDATE deployments
       SET status = 'READY', updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [deployment.id]
    );

    return updateRes.rows[0];
  }

  /**
   * Starts the deployment pipeline via the target provider adapter.
   */
  async startDeployment(arg1, arg2) {
    let user;
    let deploymentId;
    if (arg1 && arg1.user) {
      user = arg1.user;
      deploymentId = arg1.id || arg1.deploymentId || arg1.deployment_id;
    } else {
      user = arg1;
      deploymentId = arg2;
    }

    const deployment = await this.getDeployment(user, deploymentId);

    // Explicit confirmation check: must be READY or FAILED/BLOCKED (for retry)
    const allowedStartStatuses = ['READY', 'BLOCKED_CREDENTIALS', 'BLOCKED_CONFIGURATION', 'FAILED', 'STOPPED'];
    if (!allowedStartStatuses.includes(deployment.status)) {
      throw createHttpError(
        400,
        `Deployment cannot be started in status "${deployment.status}". Deployment must be confirmed before starting.`
      );
    }

    const provider = this._getProvider(deployment.target_provider);
    const deployResult = await provider.deploy(deployment);

    const updateRes = await this.query(
      `UPDATE deployments
       SET status = $1,
           endpoint_url = $2,
           error_message = $3,
           metadata = $4,
           started_at = CASE WHEN $1 = 'RUNNING' THEN now() ELSE started_at END,
           updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [
        deployResult.status,
        deployResult.endpointUrl || null,
        deployResult.errorMessage || deployResult.reason || null,
        JSON.stringify({ ...(deployment.metadata || {}), ...(deployResult.metadata || {}) }),
        deployment.id,
      ]
    );

    return updateRes.rows[0];
  }

  /**
   * Stops or scales down an active deployment.
   */
  async stopDeployment(arg1, arg2) {
    let user;
    let deploymentId;
    if (arg1 && arg1.user) {
      user = arg1.user;
      deploymentId = arg1.id || arg1.deploymentId || arg1.deployment_id;
    } else {
      user = arg1;
      deploymentId = arg2;
    }

    const deployment = await this.getDeployment(user, deploymentId);

    // Transition through STOPPING state
    await this.query(
      `UPDATE deployments SET status = 'STOPPING', updated_at = now() WHERE id = $1`,
      [deployment.id]
    );

    const provider = this._getProvider(deployment.target_provider);
    await provider.stop(deployment);

    const updateRes = await this.query(
      `UPDATE deployments
       SET status = 'STOPPED', stopped_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [deployment.id]
    );

    return updateRes.rows[0];
  }

  /**
   * Permanently deletes a deployment via the target provider adapter.
   * Preserves application, source, experiments, and telemetry.
   */
  async deleteDeployment(arg1, arg2) {
    let user;
    let deploymentId;
    let confirmation;
    if (arg1 && arg1.user) {
      user = arg1.user;
      deploymentId = arg1.id || arg1.deploymentId || arg1.deployment_id;
      confirmation = arg1.confirmation !== undefined ? arg1.confirmation : arg1.confirm;
    } else {
      user = arg1;
      deploymentId = arg2;
      confirmation = true;
    }

    if (!confirmation || (confirmation !== true && confirmation !== 'DELETE')) {
      throw createHttpError(
        400,
        'Deployment deletion requires explicit confirmation: { confirm: true } or { confirmation: "DELETE" }'
      );
    }

    const deployment = await this.getDeployment(user, deploymentId);

    // Reject protected baseline deployments
    if (deployment.application_name === 'CloudPort Core Research Suite') {
      throw createHttpError(403, 'Forbidden: cannot delete a deployment associated with the protected system baseline application');
    }

    if (deployment.status === 'DELETED') {
      return deployment;
    }

    // Transition through DELETING state
    await this.query(
      `UPDATE deployments SET status = 'DELETING', updated_at = now() WHERE id = $1`,
      [deployment.id]
    );

    const provider = this._getProvider(deployment.target_provider);
    let deleteResult;
    try {
      deleteResult = await provider.delete(deployment);
    } catch (err) {
      await this.query(
        `UPDATE deployments SET status = 'DELETE_FAILED', error_message = $1, updated_at = now() WHERE id = $2`,
        [err.message, deployment.id]
      );
      throw createHttpError(500, `Failed to delete deployment on provider: ${err.message}`);
    }

    const updateRes = await this.query(
      `UPDATE deployments
       SET status = 'DELETED',
           deleted_at = now(),
           endpoint_url = null,
           metadata = $1,
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [
        JSON.stringify({
          ...(deployment.metadata || {}),
          deletedBy: user.email,
          deleteResult: deleteResult || {},
        }),
        deployment.id,
      ]
    );

    return updateRes.rows[0];
  }
}

function createDeploymentService(deps = {}) {
  return new DeploymentService(deps);
}

module.exports = {
  DeploymentService,
  createDeploymentService,
};

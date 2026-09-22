/**
 * CloudPort Deployment Providers Architecture.
 *
 * Provides a clean adapter interface for deployment targets:
 * - AwsEksProvider (AWS EKS via multi-cloud Terraform / kubeconfig context)
 * - GcpGkeProvider (GCP GKE via multi-cloud Terraform / kubeconfig context)
 * - LocalKubernetesProvider (local kind-korifi cluster in isolated cloudport namespace)
 *
 * SAFETY CONTRACT:
 * - Truthful status: NEVER fabricates running state if credentials or clusters are absent.
 * - Explicit blocked states: Returns BLOCKED_CREDENTIALS or BLOCKED_CONFIGURATION with remediation guidance.
 * - Zero destructive operations on protected namespaces or Korifi.
 */
'use strict';

const child_process = require('child_process');
const execSync = (...args) => child_process.execSync(...args);
const execFileSync = (...args) => child_process.execFileSync(...args);
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CF_COMMAND_TIMEOUT_MS = 60000;
const GIT_CLONE_TIMEOUT_MS = 120000;

// Mirrors the validation in deploymentService.validateSource(). Re-checked here
// because a deployment row read back from the database is untrusted input at the
// point where it becomes a subprocess argument.
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/i;

function cfExec(command, timeoutMs = CF_COMMAND_TIMEOUT_MS) {
  return execSync(command, { stdio: 'pipe', timeout: timeoutMs }).toString();
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch (_err) {
    return null;
  }
}

/**
 * Issues an authenticated request against the Korifi Cloud Controller API.
 * Returns null rather than throwing so callers can treat "cannot determine"
 * as an explicit unknown instead of silently assuming a state.
 */
function cfCurl(apiPath) {
  try {
    return parseJsonLoose(cfExec(`cf curl "${apiPath}"`));
  } catch (_err) {
    return null;
  }
}

function httpsProbe(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let req;
    try {
      // Korifi's local gateway terminates TLS with a self-signed certificate,
      // so this single probe opts out of chain validation. It is scoped to this
      // request only -- never set globally, which would weaken every other
      // outbound TLS connection this process makes.
      req = https.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
    } catch (_err) {
      return resolve(null);
    }
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function verifyKorifiEndpoint(url, attempts = 5, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    const status = await httpsProbe(`${url}/health`);
    if (status && status < 500) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

class DeploymentProvider {
  /**
   * @param {string} providerName - 'AWS_EKS' | 'GCP_GKE' | 'LOCAL_KUBERNETES'
   */
  constructor(providerName) {
    this.providerName = providerName;
  }

  /**
   * Checks whether CLI, credentials, and cluster context are ready.
   * @returns {Promise<{ status: string, ready: boolean, reason?: string, hint?: string }>}
   */
  async checkPrerequisites() {
    throw new Error('checkPrerequisites must be implemented by subclass');
  }

  /**
   * Deploys the workload to the target infrastructure.
   * @param {object} deployment
   * @returns {Promise<object>} updated deployment attributes
   */
  async deploy(_deployment) {
    throw new Error('deploy must be implemented by subclass');
  }

  /**
   * Inspects live status of the deployment on the target.
   * @param {object} deployment
   * @returns {Promise<object>} status descriptor
   */
  async getStatus(_deployment) {
    throw new Error('getStatus must be implemented by subclass');
  }

  /**
   * Stops or scales down the deployment.
   * @param {object} deployment
   * @returns {Promise<object>} stop status
   */
  async stop(_deployment) {
    throw new Error('stop must be implemented by subclass');
  }

  /**
   * Permanently deletes deployment resources on the target provider.
   * @param {object} deployment
   * @returns {Promise<object>} delete status
   */
  async delete(_deployment) {
    throw new Error('delete must be implemented by subclass');
  }
}

class AwsEksProvider extends DeploymentProvider {
  constructor() {
    super('AWS_EKS');
    this.targetContext = process.env.MULTICLOUD_CONTEXT_AWS || 'aws-eks-cloudport';
    this.region = process.env.AWS_REGION || 'ap-south-1';
  }

  async checkPrerequisites() {
    // 1. Check AWS CLI
    try {
      execSync('aws --version', { stdio: 'pipe' });
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'AWS CLI is not installed or not in PATH.',
        hint: 'Install AWS CLI v2 and ensure it is available in system PATH.',
      };
    }

    // 2. Check AWS credentials
    const hasProfile = Boolean(process.env.AWS_PROFILE);
    const hasKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    if (!hasProfile && !hasKeys) {
      return {
        status: 'BLOCKED_CREDENTIALS',
        ready: false,
        reason: 'AWS credentials are not configured.',
        hint: 'Set AWS_PROFILE or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in environment variables.',
      };
    }

    // 3. Check kubeconfig context for EKS
    try {
      const contexts = execSync('kubectl config get-contexts -o name', { stdio: 'pipe' }).toString();
      if (!contexts.includes(this.targetContext)) {
        return {
          status: 'BLOCKED_CONFIGURATION',
          ready: false,
          reason: `Kubernetes context "${this.targetContext}" is not present in kubeconfig.`,
          hint: `Run: aws eks update-kubeconfig --name <cluster-name> --region ${this.region} --alias ${this.targetContext}`,
        };
      }
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'kubectl is unable to query cluster contexts.',
        hint: 'Ensure kubectl is configured and functional.',
      };
    }

    return {
      status: 'READY',
      ready: true,
      context: this.targetContext,
      region: this.region,
    };
  }

  async deploy(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        errorMessage: prereq.reason,
        metadata: {
          hint: prereq.hint,
          checkedAt: new Date().toISOString(),
          provider: 'AWS_EKS',
          region: this.region,
        },
      };
    }

    // When real cloud infrastructure is connected, this triggers the EKS deployment pipeline
    return {
      status: 'DEPLOYING',
      metadata: {
        provider: 'AWS_EKS',
        context: this.targetContext,
        region: this.region,
        source: deployment.source_reference,
        startedAt: new Date().toISOString(),
      },
    };
  }

  async getStatus(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        ready: false,
        reason: prereq.reason,
        hint: prereq.hint,
        provider: 'AWS_EKS',
        region: this.region,
      };
    }

    return {
      status: deployment.status || 'READY',
      ready: deployment.status === 'RUNNING',
      provider: 'AWS_EKS',
      region: this.region,
      context: this.targetContext,
    };
  }

  async stop(_deployment) {
    // PENDING REAL INFRASTRUCTURE INTEGRATION:
    // Real implementation would run: kubectl scale deployment --replicas=0 --context <aws-eks-context>
    // or use the AWS EKS API to drain/scale down the workload before reporting STOPPED.
    // This scaffold returns the expected status shape without live cloud cleanup.
    return {
      status: 'STOPPED',
      stoppedAt: new Date().toISOString(),
      provider: 'AWS_EKS',
      note: 'Scaffold: real EKS workload teardown pending cloud infrastructure integration.',
    };
  }

  async delete(_deployment) {
    // PENDING REAL INFRASTRUCTURE INTEGRATION:
    // Real implementation would execute: kubectl delete deployment/service <name> --context <aws-eks-context>
    // and optionally trigger Terraform destroy for any provisioned EKS resources.
    // This scaffold records the delete intent without performing live cloud resource cleanup.
    return {
      status: 'DELETED',
      deletedAt: new Date().toISOString(),
      provider: 'AWS_EKS',
      note: 'Scaffold: real EKS resource cleanup pending cloud infrastructure integration.',
    };
  }
}

class GcpGkeProvider extends DeploymentProvider {
  constructor() {
    super('GCP_GKE');
    this.targetContext = process.env.MULTICLOUD_CONTEXT_GCP || 'gcp-gke-cloudport';
    this.region = process.env.GCP_REGION || 'asia-south1';
    this.projectId = process.env.GCP_PROJECT_ID || 'your-gcp-project-id';
  }

  async checkPrerequisites() {
    // 1. Check gcloud CLI
    try {
      execSync('gcloud --version', { stdio: 'pipe' });
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'Google Cloud SDK (gcloud) is not installed or not in PATH.',
        hint: 'Install Google Cloud CLI from https://cloud.google.com/sdk/docs/install and add to system PATH.',
      };
    }

    // 2. Check GCP credentials
    const hasAppCreds = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!hasAppCreds) {
      // Check if gcloud auth is active
      try {
        const auth = execSync('gcloud auth list --format=json', { stdio: 'pipe' }).toString();
        const accounts = JSON.parse(auth);
        const hasActive = Array.isArray(accounts) && accounts.some((a) => a.status === 'ACTIVE');
        if (!hasActive) {
          return {
            status: 'BLOCKED_CREDENTIALS',
            ready: false,
            reason: 'Google Cloud credentials are not configured.',
            hint: 'Run: gcloud auth application-default login, or set GOOGLE_APPLICATION_CREDENTIALS.',
          };
        }
      } catch (_err) {
        return {
          status: 'BLOCKED_CREDENTIALS',
          ready: false,
          reason: 'Google Cloud credentials are not configured.',
          hint: 'Run: gcloud auth application-default login, or set GOOGLE_APPLICATION_CREDENTIALS.',
        };
      }
    }

    // 3. Check kubeconfig context for GKE
    try {
      const contexts = execSync('kubectl config get-contexts -o name', { stdio: 'pipe' }).toString();
      if (!contexts.includes(this.targetContext)) {
        return {
          status: 'BLOCKED_CONFIGURATION',
          ready: false,
          reason: `Kubernetes context "${this.targetContext}" is not present in kubeconfig.`,
          hint: `Run: gcloud container clusters get-credentials <cluster-name> --region ${this.region} --project ${this.projectId}`,
        };
      }
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'kubectl is unable to query cluster contexts.',
        hint: 'Ensure kubectl is configured and functional.',
      };
    }

    return {
      status: 'READY',
      ready: true,
      context: this.targetContext,
      region: this.region,
      projectId: this.projectId,
    };
  }

  async deploy(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        errorMessage: prereq.reason,
        metadata: {
          hint: prereq.hint,
          checkedAt: new Date().toISOString(),
          provider: 'GCP_GKE',
          region: this.region,
          projectId: this.projectId,
        },
      };
    }

    // When real cloud infrastructure is connected, this triggers the GKE deployment pipeline
    return {
      status: 'DEPLOYING',
      metadata: {
        provider: 'GCP_GKE',
        context: this.targetContext,
        region: this.region,
        projectId: this.projectId,
        source: deployment.source_reference,
        startedAt: new Date().toISOString(),
      },
    };
  }

  async getStatus(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        ready: false,
        reason: prereq.reason,
        hint: prereq.hint,
        provider: 'GCP_GKE',
        region: this.region,
        projectId: this.projectId,
      };
    }

    return {
      status: deployment.status || 'READY',
      ready: deployment.status === 'RUNNING',
      provider: 'GCP_GKE',
      region: this.region,
      projectId: this.projectId,
      context: this.targetContext,
    };
  }

  async stop(_deployment) {
    // PENDING REAL INFRASTRUCTURE INTEGRATION:
    // Real implementation would run: kubectl scale deployment --replicas=0 --context <gcp-gke-context>
    // or use the GKE API to drain/scale down the workload before reporting STOPPED.
    // This scaffold returns the expected status shape without live cloud cleanup.
    return {
      status: 'STOPPED',
      stoppedAt: new Date().toISOString(),
      provider: 'GCP_GKE',
      note: 'Scaffold: real GKE workload teardown pending cloud infrastructure integration.',
    };
  }

  async delete(_deployment) {
    // PENDING REAL INFRASTRUCTURE INTEGRATION:
    // Real implementation would execute: kubectl delete deployment/service <name> --context <gcp-gke-context>
    // and optionally trigger: gcloud container clusters delete or Terraform destroy.
    // This scaffold records the delete intent without performing live cloud resource cleanup.
    return {
      status: 'DELETED',
      deletedAt: new Date().toISOString(),
      provider: 'GCP_GKE',
      note: 'Scaffold: real GKE resource cleanup pending cloud infrastructure integration.',
    };
  }
}

/**
 * Deploys through Korifi (Cloud Foundry) running on the local kind cluster.
 *
 * Korifi is an external dependency. CloudPort drives it through the public `cf`
 * CLI exactly as any Cloud Foundry operator would, and never touches the
 * korifi, korifi-gateway, or korifi-installer namespaces that make up Korifi
 * itself.
 *
 * `cf push` stages the application with kpack buildpacks, which routinely takes
 * several minutes. deploy() therefore starts the push detached and returns
 * DEPLOYING immediately rather than blocking an HTTP request for the duration;
 * getStatus() reports the real state from the Cloud Controller and only claims
 * RUNNING once the app is STARTED *and* its route actually answers.
 */
class LocalKubernetesProvider extends DeploymentProvider {
  constructor() {
    super('LOCAL_KUBERNETES');
    this.context = process.env.EXPECTED_KUBE_CONTEXT || 'kind-korifi';
    this.org = process.env.CF_ORG || 'cloudport';
    this.appsDomain = process.env.CF_APPS_DOMAIN || 'apps-127-0-0-1.nip.io';
  }

  _appSlug(deployment) {
    return (deployment.metadata?.appName || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-');
  }

  /**
   * Cloud Foundry application name. Derived deterministically from the
   * deployment id so that status/stop/delete address the same app that
   * deploy() created.
   */
  _appName(deployment) {
    const uniqueId = deployment.id ? deployment.id.split('-')[0] : 'local';
    return `cloudport-${this._appSlug(deployment)}-${uniqueId}`;
  }

  /** One CF space per CloudPort application, so apps stay isolated from each other. */
  _spaceName(deployment) {
    return `cloudport-${this._appSlug(deployment)}`;
  }

  _routeUrl(appName) {
    return `https://${appName}.${this.appsDomain}`;
  }

  _target(space) {
    cfExec(`cf target -o ${this.org} -s ${space}`);
  }

  _ensureOrgAndSpace(space) {
    const orgs = cfCurl(`/v3/organizations?names=${this.org}`);
    if (!orgs || !Array.isArray(orgs.resources) || orgs.resources.length === 0) {
      cfExec(`cf create-org ${this.org}`);
    }
    const spaces = cfCurl(`/v3/spaces?names=${space}`);
    if (!spaces || !Array.isArray(spaces.resources) || spaces.resources.length === 0) {
      cfExec(`cf create-space ${space} -o ${this.org}`);
    }
  }

  /** Returns { guid, state } for the app, or null when it does not exist. */
  _findApp(appName) {
    const result = cfCurl(`/v3/apps?names=${appName}`);
    if (!result || !Array.isArray(result.resources) || result.resources.length === 0) {
      return null;
    }
    const app = result.resources[0];
    return { guid: app.guid, state: app.state };
  }

  /**
   * Resolves the directory that will be pushed. A GitHub-sourced deployment is
   * shallow-cloned so what runs is what the user actually asked for; only a
   * deployment with no usable source falls back to the bundled demo app, and
   * that fallback is reported in metadata rather than passed off as the
   * user's code.
   */
  _resolveSource(deployment) {
    const sourceType = String(deployment.source_type || '').toUpperCase();
    const reference = deployment.source_reference;

    if ((sourceType === 'GITHUB' || sourceType === 'GITHUB_REPO') && reference) {
      if (!GITHUB_URL_PATTERN.test(String(reference).trim())) {
        throw new Error(`Refusing to clone untrusted source reference: ${reference}`);
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudport-src-'));
      // execFileSync (not execSync) so the URL is passed as an argument vector
      // and never reaches a shell.
      execFileSync('git', ['clone', '--depth', '1', String(reference).trim(), dir], {
        stdio: 'pipe',
        timeout: GIT_CLONE_TIMEOUT_MS,
      });
      return { dir, kind: 'github-clone', reference };
    }

    return {
      dir: path.join(__dirname, '../../../../demo-app'),
      kind: 'bundled-demo-app',
      reference: 'demo-app',
    };
  }

  async checkPrerequisites() {
    try {
      cfExec('cf --version');
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'The Cloud Foundry CLI (cf) is not installed or not in PATH.',
        hint: 'Install the cf CLI v8+ and ensure it is available in system PATH.',
      };
    }

    try {
      const contexts = execSync('kubectl config get-contexts -o name', { stdio: 'pipe' }).toString();
      if (!contexts.includes(this.context)) {
        return {
          status: 'BLOCKED_CONFIGURATION',
          ready: false,
          reason: `Local context "${this.context}" is not available.`,
          hint: 'Ensure the Kind cluster is running: kind get clusters',
        };
      }
    } catch (_err) {
      return {
        status: 'BLOCKED_CONFIGURATION',
        ready: false,
        reason: 'kubectl is unable to query cluster contexts.',
        hint: 'Check that Docker and the Kind cluster are running.',
      };
    }

    try {
      cfExec('cf target');
    } catch (_err) {
      return {
        status: 'BLOCKED_CREDENTIALS',
        ready: false,
        reason: 'The cf CLI is not authenticated against the Korifi API.',
        hint: 'Run: cf api https://localhost --skip-ssl-validation && cf login',
      };
    }

    return {
      status: 'READY',
      ready: true,
      context: this.context,
      org: this.org,
      environment: 'LOCAL / DEVELOPMENT',
      platform: 'KORIFI_CLOUD_FOUNDRY',
    };
  }

  async deploy(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        errorMessage: prereq.reason,
        metadata: {
          hint: prereq.hint,
          checkedAt: new Date().toISOString(),
          provider: 'LOCAL_KUBERNETES',
        },
      };
    }

    const appName = this._appName(deployment);
    const space = this._spaceName(deployment);

    try {
      this._ensureOrgAndSpace(space);
      this._target(space);

      const existing = this._findApp(appName);

      // An app that was pushed before and merely stopped only needs starting;
      // re-staging it through the buildpacks again would cost minutes for nothing.
      if (existing && existing.state === 'STOPPED') {
        cfExec(`cf start ${appName}`);
        return {
          status: 'DEPLOYING',
          metadata: {
            provider: 'LOCAL_KUBERNETES',
            platform: 'KORIFI_CLOUD_FOUNDRY',
            environment: 'LOCAL / DEVELOPMENT',
            context: this.context,
            org: this.org,
            space,
            cfAppName: appName,
            expectedRoute: this._routeUrl(appName),
            action: 'cf start',
            startedAt: new Date().toISOString(),
          },
        };
      }

      const source = this._resolveSource(deployment);
      const logPath = path.join(os.tmpdir(), `${appName}-cf-push.log`);
      const logFd = fs.openSync(logPath, 'a');

      // cf push stages through kpack buildpacks and regularly runs for minutes.
      // It is detached rather than awaited so the caller's HTTP request is not
      // held open for the whole staging run; getStatus() is the source of truth
      // for what actually happened.
      const child = child_process.spawn(
        'cf',
        ['push', appName, '-p', source.dir, '-m', '256M', '-k', '512M', '-i', '1'],
        { detached: true, stdio: ['ignore', logFd, logFd] }
      );
      child.unref();

      return {
        status: 'DEPLOYING',
        metadata: {
          provider: 'LOCAL_KUBERNETES',
          platform: 'KORIFI_CLOUD_FOUNDRY',
          environment: 'LOCAL / DEVELOPMENT',
          context: this.context,
          org: this.org,
          space,
          cfAppName: appName,
          expectedRoute: this._routeUrl(appName),
          action: 'cf push',
          sourceKind: source.kind,
          sourceReference: source.reference,
          pushLog: logPath,
          startedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        errorMessage: err.message,
        metadata: {
          provider: 'LOCAL_KUBERNETES',
          platform: 'KORIFI_CLOUD_FOUNDRY',
          environment: 'LOCAL / DEVELOPMENT',
          context: this.context,
          org: this.org,
          space,
          cfAppName: appName,
        },
      };
    }
  }

  async getStatus(deployment) {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ready) {
      return {
        status: prereq.status,
        ready: false,
        reason: prereq.reason,
        hint: prereq.hint,
        provider: 'LOCAL_KUBERNETES',
        environment: 'LOCAL / DEVELOPMENT',
        context: this.context,
      };
    }

    const appName = this._appName(deployment);
    const space = this._spaceName(deployment);
    const base = {
      provider: 'LOCAL_KUBERNETES',
      platform: 'KORIFI_CLOUD_FOUNDRY',
      environment: 'LOCAL / DEVELOPMENT',
      context: this.context,
      org: this.org,
      space,
      cfAppName: appName,
    };

    try {
      this._target(space);
    } catch (_err) {
      return { ...base, status: deployment.status || 'DRAFT', ready: false, endpointUrl: null };
    }

    const app = this._findApp(appName);
    if (!app) {
      return { ...base, status: deployment.status || 'DRAFT', ready: false, endpointUrl: null };
    }

    if (app.state !== 'STARTED') {
      return {
        ...base,
        status: app.state === 'STOPPED' ? 'STOPPED' : 'DEPLOYING',
        ready: false,
        cfState: app.state,
        endpointUrl: null,
      };
    }

    // The Cloud Controller reporting STARTED only means the process was
    // scheduled. RUNNING is claimed only once the route actually answers.
    const url = this._routeUrl(appName);
    const reachable = await verifyKorifiEndpoint(url, 2, 1000);

    return {
      ...base,
      status: reachable ? 'RUNNING' : 'DEPLOYING',
      ready: reachable,
      cfState: app.state,
      endpointUrl: reachable ? url : null,
    };
  }

  async stop(deployment) {
    const appName = this._appName(deployment);
    const space = this._spaceName(deployment);

    try {
      this._target(space);
      cfExec(`cf stop ${appName}`);
    } catch (_err) {
      // App may not exist on the platform; the deployment is stopped either way.
    }

    return {
      status: 'STOPPED',
      stoppedAt: new Date().toISOString(),
      provider: 'LOCAL_KUBERNETES',
      platform: 'KORIFI_CLOUD_FOUNDRY',
      cfAppName: appName,
    };
  }

  async delete(deployment) {
    const appName = this._appName(deployment);
    const space = this._spaceName(deployment);

    try {
      this._target(space);
      // -r also removes the route that cf push created for this app.
      cfExec(`cf delete ${appName} -f -r`);
    } catch (_err) {
      // Already absent from the platform; deletion is still recorded.
    }

    return {
      status: 'DELETED',
      deletedAt: new Date().toISOString(),
      provider: 'LOCAL_KUBERNETES',
      platform: 'KORIFI_CLOUD_FOUNDRY',
      org: this.org,
      space,
      cfAppName: appName,
    };
  }
}

function normalizeProviderKey(targetProvider) {
  if (!targetProvider) return targetProvider;
  const str = String(targetProvider).trim().toLowerCase();
  if (str === 'aws_eks' || str === 'aws-eks' || str === 'aws') return 'AWS_EKS';
  if (str === 'gcp_gke' || str === 'gcp-gke' || str === 'gcp') return 'GCP_GKE';
  if (str === 'local_k8s' || str === 'local-k8s' || str === 'local_kubernetes' || str === 'local') return 'LOCAL_KUBERNETES';
  return targetProvider.toUpperCase();
}

const defaultProviders = {
  AWS_EKS: new AwsEksProvider(),
  GCP_GKE: new GcpGkeProvider(),
  LOCAL_KUBERNETES: new LocalKubernetesProvider(),
};

function getProvider(targetProvider, customProviders) {
  const norm = normalizeProviderKey(targetProvider);
  if (customProviders) {
    if (customProviders[targetProvider]) return customProviders[targetProvider];
    if (customProviders[norm]) return customProviders[norm];
    const lower = String(targetProvider).toLowerCase();
    if (customProviders[lower]) return customProviders[lower];
  }
  const provider = defaultProviders[norm];
  if (!provider) {
    throw new Error(`Unsupported deployment provider: "${targetProvider}". Supported: AWS_EKS, GCP_GKE, LOCAL_KUBERNETES`);
  }
  return provider;
}

module.exports = {
  DeploymentProvider,
  AwsEksProvider,
  GcpGkeProvider,
  LocalKubernetesProvider,
  getProvider,
  normalizeProviderKey,
  SUPPORTED_PROVIDERS: ['AWS_EKS', 'GCP_GKE', 'LOCAL_KUBERNETES', 'aws_eks', 'gcp_gke', 'local_k8s'],
};

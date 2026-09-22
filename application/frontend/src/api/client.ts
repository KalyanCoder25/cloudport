const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
const ROOT_URL = BASE_URL.replace(/\/api\/?$/, '');

let currentAuthToken: string | null = null;

try {
  currentAuthToken = localStorage.getItem('cloudport_auth_token');
} catch (_e) {
  // localStorage may not be accessible in some environments
}

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
  try {
    if (token) {
      localStorage.setItem('cloudport_auth_token', token);
    } else {
      localStorage.removeItem('cloudport_auth_token');
    }
  } catch (_e) {
    // ignore storage errors
  }
}

export function getAuthToken(): string | null {
  return currentAuthToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/health') ? `${ROOT_URL}${path}` : `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (currentAuthToken) {
    headers['Authorization'] = `Bearer ${currentAuthToken}`;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    let errorMsg = body || res.statusText;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) errorMsg = parsed.error;
    } catch (_e) {
      // ignore json parse error
    }
    throw new ApiError(res.status, errorMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as Promise<T>;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type TechnologyType =
  | 'AUTO'
  | 'NODE'
  | 'REACT_VITE'
  | 'PYTHON'
  | 'DJANGO'
  | 'JAVA'
  | 'GO'
  | 'PHP'
  | 'DOTNET'
  | 'DOCKER'
  | 'CUSTOM'
  | 'UNKNOWN';

export interface TechnologyDetectionResult {
  technology: TechnologyType;
  framework: string;
  confidence: number;
  evidence: string[];
  source: string;
  note?: string;
  recommendedConfig?: {
    port?: number;
    buildCommand?: string;
    startCommand?: string;
    dockerfilePath?: string | null;
  };
}

export interface Application {
  id: string;
  name: string;
  description?: string;
  repository_url?: string;
  framework: string;
  technology?: TechnologyType;
  build_command?: string | null;
  start_command?: string | null;
  port?: number | null;
  dockerfile_path?: string | null;
  configuration?: Record<string, unknown>;
  owner_id: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  archived_at?: string | null;
  created_at: string;
  updated_at?: string;
  experiment_count?: number;
}

export interface Experiment {
  id: string;
  name: string;
  status: string;
  application_version: string;
  workload: string;
  controlled_variable: string;
  target_dimension: string;
  excluded_dimensions: string[];
  replication_count: number;
  created_by?: string;
  application_id?: string;
  created_at: string;
}

export interface InfrastructureDifference {
  dimension: string;
  difference_found: boolean;
  detail: Record<string, unknown>;
}

export interface BehaviourComparison {
  metric: string;
  mean_a: number | null;
  mean_b: number | null;
  delta: number | null;
  percent_change: number | null;
  direction: 'INCREASED' | 'DECREASED' | 'UNCHANGED';
}

export interface LeakageFinding {
  score: number;
  classification: string;
  rationale: string;
  rubric: Record<string, number>;
}

export interface TelemetryRecord {
  id: string;
  trial_id: string;
  trial_index: number;
  infrastructure: 'A' | 'B';
  mean_latency_ms?: number;
  p95_latency_ms?: number;
  error_rate?: number;
  throughput_ops_per_sec?: number;
  cpu_utilization_pct?: number;
  memory_utilization_pct?: number;
  recorded_at: string;
  request_count?: number;
  p50_ms?: number | null;
  p90_ms?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
  max_ms?: number | null;
}

export interface ValidationResult {
  status: string;
  parityValidated: boolean;
  reason?: string;
  differences?: InfrastructureDifference[];
}

export type DeploymentTargetProvider = 'aws_eks' | 'gcp_gke' | 'local_k8s';

export type DeploymentStatus =
  | 'DRAFT'
  | 'READY'
  | 'QUEUED'
  | 'DEPLOYING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'DELETING'
  | 'DELETED'
  | 'FAILED'
  | 'DELETE_FAILED'
  | 'BLOCKED_CREDENTIALS'
  | 'BLOCKED_CONFIGURATION';

export interface Deployment {
  id: string;
  application_id: string;
  owner_id: string;
  target_provider: DeploymentTargetProvider;
  target_environment: string;
  status: DeploymentStatus;
  source_type: 'github_repo' | 'zip_upload' | 'docker_image';
  source_reference: string;
  image_reference?: string | null;
  endpoint_url?: string | null;
  error_message?: string | null;
  configuration?: {
    technology?: TechnologyType;
    buildCommand?: string | null;
    startCommand?: string | null;
    port?: number | null;
    dockerfilePath?: string | null;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  stopped_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const api = {
  // Health
  health: () => request<{ status: string; version: string }>('/health'),
  getHealth: () => request<{ status: string }>('/health'),

  // Auth API
  signup: (data: { email: string; password: string; displayName?: string }) =>
    request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () => request<{ user: User }>('/auth/me'),
  getMe: () => request<{ user: User }>('/auth/me'),

  // Applications API
  listApplications: (params?: { status?: string }) => {
    const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
    return request<Application[]>(`/applications${qs}`);
  },

  createApplication: (data: {
    name: string;
    description?: string;
    repository_url?: string;
    framework?: string;
    technology?: TechnologyType;
    build_command?: string;
    start_command?: string;
    port?: number;
    dockerfile_path?: string;
  }) =>
    request<Application>('/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateApplication: (id: string, data: Partial<Application>) =>
    request<Application>(`/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  archiveApplication: (id: string) =>
    request<Application>(`/applications/${id}/archive`, {
      method: 'POST',
    }),

  restoreApplication: (id: string) =>
    request<Application>(`/applications/${id}/restore`, {
      method: 'POST',
    }),

  deleteApplication: (id: string) =>
    request<{ message: string; id: string }>(`/applications/${id}`, {
      method: 'DELETE',
    }),

  getApplication: (id: string) =>
    request<{ application: Application; experiments: Experiment[]; deployments?: Deployment[] }>(`/applications/${id}`),

  // Deployments API
  listDeployments: (applicationId?: string) => {
    const qs = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : '';
    return request<Deployment[]>(`/deployments${qs}`);
  },

  createDeployment: (data: {
    application_id: string;
    source_type: 'github_repo' | 'zip_upload' | 'docker_image';
    source_reference: string;
    image_reference?: string;
    target_providers: DeploymentTargetProvider[];
    technology?: TechnologyType;
    buildCommand?: string;
    startCommand?: string;
    port?: number;
    dockerfilePath?: string;
    configuration?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) =>
    request<Deployment[]>('/deployments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getDeployment: (id: string) => request<Deployment>(`/deployments/${id}`),

  confirmDeployment: (id: string, confirmed: boolean = true) =>
    request<Deployment>(`/deployments/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirmed }),
    }),

  startDeployment: (id: string) =>
    request<Deployment>(`/deployments/${id}/start`, {
      method: 'POST',
    }),

  stopDeployment: (id: string) =>
    request<Deployment>(`/deployments/${id}/stop`, {
      method: 'POST',
    }),

  deleteDeployment: (id: string, confirmation: boolean | string = true) =>
    request<Deployment>(`/deployments/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ confirmation }),
    }),

  detectTechnology: (repositoryUrl: string) =>
    request<TechnologyDetectionResult>('/deployments/detect-technology', {
      method: 'POST',
      body: JSON.stringify({ repository_url: repositoryUrl }),
    }),

  // Experiments API
  listExperiments: (params?: { scope?: string; application_id?: string }) => {
    const query = new URLSearchParams();
    if (params?.scope) query.set('scope', params.scope);
    if (params?.application_id) query.set('application_id', params.application_id);
    const qs = query.toString();
    return request<Experiment[]>(`/analyzer/experiments${qs ? `?${qs}` : ''}`);
  },

  createExperiment: (data: {
    name: string;
    applicationId?: string;
    manifest: Record<string, unknown>;
  }) =>
    request<Experiment>('/analyzer/experiments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getExperiment: (id: string) => request<Experiment>(`/analyzer/experiments/${id}`),
  getDifferences: (id: string) => request<InfrastructureDifference[]>(`/analyzer/experiments/${id}/differences`),
  getBehaviour: (id: string) => request<BehaviourComparison[]>(`/analyzer/experiments/${id}/behaviour`),
  getTelemetry: (id: string) => request<TelemetryRecord[]>(`/analyzer/experiments/${id}/telemetry`),
  getLeakage: async (id: string): Promise<LeakageFinding | null> => {
    try {
      return await request<LeakageFinding>(`/analyzer/experiments/${id}/leakage`);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },
  getEvidence: (id: string) => request<unknown[]>(`/analyzer/experiments/${id}/evidence`),
  getReport: (id: string) => request<string>(`/analyzer/experiments/${id}/report`),
  getReplication: (id: string) => request<unknown[]>(`/analyzer/experiments/${id}/replication`),
  getRecovery: (id: string) => request<unknown[]>(`/analyzer/experiments/${id}/recovery`),
  validateExperiment: (id: string) =>
    request<ValidationResult>(`/analyzer/experiments/${id}/validate`, {
      method: 'POST',
    }),
  runExperiment: (id: string) =>
    request<{ status: string }>(`/analyzer/experiments/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
};

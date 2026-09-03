const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
const ROOT_URL = BASE_URL.replace(/\/api\/?$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/health') ? `${ROOT_URL}${path}` : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as Promise<T>;
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
  request_count: number;
  success_count: number;
  failure_count: number;
  throughput_ops_per_sec: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  recorded_at: string;
}

export interface ValidationResult {
  status: string;
  parityValidated: boolean;
  reason?: string;
  differences?: InfrastructureDifference[];
}

export const api = {
  health: () => request<{ status: string; version: string }>('/health'),
  listExperiments: () => request<Experiment[]>('/analyzer/experiments'),
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

-- CloudPort schema migration 0003: multi-cloud capstone persistence
--
-- Adds tables for storing multi-cloud benchmark trial results and
-- aggregated multi-cloud experiment results (AWS EKS vs GCP GKE).

CREATE TABLE IF NOT EXISTS multicloud_trial_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id TEXT NOT NULL,
    trial_id TEXT NOT NULL,
    trial_index INTEGER NOT NULL DEFAULT 0,
    target_context TEXT NOT NULL,
    cloud_provider TEXT NOT NULL CHECK (cloud_provider IN ('AWS', 'GCP')),
    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,
    duration_seconds NUMERIC NOT NULL,
    locust_users INTEGER NOT NULL,
    locust_spawn_rate NUMERIC NOT NULL,
    locustfile_version TEXT NOT NULL,
    request_count BIGINT NOT NULL,
    success_count BIGINT NOT NULL,
    failure_count BIGINT NOT NULL,
    error_rate NUMERIC NOT NULL,
    requests_per_second NUMERIC NOT NULL,
    latency_p50_ms NUMERIC NOT NULL,
    latency_p95_ms NUMERIC NOT NULL,
    latency_p99_ms NUMERIC NOT NULL,
    measurement_source TEXT NOT NULL DEFAULT 'locust-kubernetes',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, trial_index, cloud_provider)
);

CREATE INDEX IF NOT EXISTS idx_multicloud_trials_exp ON multicloud_trial_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_multicloud_trials_provider ON multicloud_trial_results(cloud_provider);

CREATE TABLE IF NOT EXISTS multicloud_experiment_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id TEXT NOT NULL UNIQUE,
    execution_mode TEXT NOT NULL DEFAULT 'MULTICLOUD_KUBERNETES',
    measurement_source TEXT NOT NULL DEFAULT 'locust-kubernetes',
    context_a TEXT NOT NULL,
    context_b TEXT NOT NULL,
    provider_a TEXT NOT NULL,
    provider_b TEXT NOT NULL,
    leakage_score NUMERIC,
    leakage_band TEXT,
    causal_classification TEXT,
    statistical_significance TEXT,
    trials_a INTEGER NOT NULL DEFAULT 0,
    trials_b INTEGER NOT NULL DEFAULT 0,
    experiment_started_at TIMESTAMPTZ,
    experiment_completed_at TIMESTAMPTZ,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_multicloud_results_exp ON multicloud_experiment_results(experiment_id);

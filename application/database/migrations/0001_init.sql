-- CloudPort schema: core tables
-- All identifiers are UUIDs. All tables carry created_at/updated_at timestamps.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'reviewer', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    manifest JSONB NOT NULL,
    manifest_checksum TEXT NOT NULL,
    application_version TEXT NOT NULL,
    workload TEXT NOT NULL,
    controlled_variable TEXT NOT NULL,
    target_dimension TEXT NOT NULL,
    excluded_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    replication_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN (
            'DRAFT',
            'PARITY_VALIDATED',
            'READY_FOR_EXECUTION',
            'RUNNING',
            'COMPLETED',
            'FAILED_VALIDATION',
            'ABORTED'
        )
    ),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_trials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    trial_index INTEGER NOT NULL,
    infrastructure TEXT NOT NULL CHECK (infrastructure IN ('A', 'B')),
    seed BIGINT NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')
    ),
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, trial_index, infrastructure)
);

CREATE TABLE IF NOT EXISTS infrastructure_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
    infrastructure TEXT NOT NULL CHECK (infrastructure IN ('A', 'B')),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL DEFAULT 'LIVE' CHECK (source IN ('LIVE', 'CACHED', 'NOT_VERIFIED')),
    profile JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS infrastructure_differences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    snapshot_a_id UUID REFERENCES infrastructure_snapshots(id),
    snapshot_b_id UUID REFERENCES infrastructure_snapshots(id),
    dimension TEXT NOT NULL,
    difference_found BOOLEAN NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trial_id UUID NOT NULL REFERENCES experiment_trials(id) ON DELETE CASCADE,
    request_count INTEGER NOT NULL,
    success_count INTEGER NOT NULL,
    failure_count INTEGER NOT NULL,
    latencies_ms JSONB NOT NULL,
    throughput_ops_per_sec DOUBLE PRECISION NOT NULL,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    p50_ms DOUBLE PRECISION,
    p90_ms DOUBLE PRECISION,
    p95_ms DOUBLE PRECISION,
    p99_ms DOUBLE PRECISION,
    max_ms DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_trials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    infrastructure TEXT NOT NULL CHECK (infrastructure IN ('A', 'B')),
    telemetry_id UUID NOT NULL REFERENCES telemetry(id) ON DELETE CASCADE,
    trial_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS behaviour_comparisons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    mean_a DOUBLE PRECISION,
    mean_b DOUBLE PRECISION,
    median_a DOUBLE PRECISION,
    median_b DOUBLE PRECISION,
    delta DOUBLE PRECISION,
    percent_change DOUBLE PRECISION,
    direction TEXT NOT NULL CHECK (direction IN ('INCREASED', 'DECREASED', 'UNCHANGED')),
    significance JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leakage_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    rubric JSONB NOT NULL,
    classification TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS replication_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    trial_count INTEGER NOT NULL,
    mean DOUBLE PRECISION,
    median DOUBLE PRECISION,
    variance DOUBLE PRECISION,
    stddev DOUBLE PRECISION,
    coefficient_of_variation DOUBLE PRECISION,
    paired_deltas JSONB NOT NULL,
    directional_consistency DOUBLE PRECISION,
    classification TEXT NOT NULL CHECK (
        classification IN ('CONFIRMED_REPLICATED', 'VARIABLE_REPLICATION', 'INSUFFICIENT_REPLICATION')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content JSONB NOT NULL,
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fault_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
    infrastructure TEXT NOT NULL CHECK (infrastructure IN ('A', 'B')),
    fault_type TEXT NOT NULL,
    scope JSONB NOT NULL,
    injected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reverted_at TIMESTAMPTZ,
    reversible BOOLEAN NOT NULL DEFAULT true,
    audit_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fault_event_id UUID NOT NULL REFERENCES fault_events(id) ON DELETE CASCADE,
    recovery_time_ms DOUBLE PRECISION,
    service_available BOOLEAN,
    state_consistent BOOLEAN,
    duplicate_operations_detected INTEGER DEFAULT 0,
    idempotency_verified BOOLEAN,
    storage_recovered BOOLEAN,
    workload_recovered BOOLEAN,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trials_experiment ON experiment_trials(experiment_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_trial ON telemetry(trial_id);
CREATE INDEX IF NOT EXISTS idx_diffs_experiment ON infrastructure_differences(experiment_id);
CREATE INDEX IF NOT EXISTS idx_leakage_experiment ON leakage_findings(experiment_id);
CREATE INDEX IF NOT EXISTS idx_replication_experiment ON replication_analysis(experiment_id);
CREATE INDEX IF NOT EXISTS idx_evidence_experiment ON evidence_artifacts(experiment_id);

-- CloudPort schema migration 0002: execution provenance
--
-- Adds columns that record WHERE a workload measurement was produced.
-- This makes it possible to prove "this telemetry record originated from
-- a specific Kubernetes pod executing against a specific PVC" and to
-- distinguish valid KUBERNETES-mode measurements from LOCAL development runs.
--
-- execution_provenance (JSONB, nullable): full provenance object written
--   by the pod dispatch layer. Contains at minimum:
--     { kubernetesContext, namespace, podName, containerName,
--       infrastructureId, executionMode, measurementSource,
--       workloadStartedAt, workloadFinishedAt }
--
-- execution_mode (TEXT, default 'LOCAL'): 'KUBERNETES' for live pod-exec
--   measurements; 'LOCAL' for local-development runs. Indexed to enable
--   fast queries like "show only KUBERNETES-mode trials".

ALTER TABLE telemetry
    ADD COLUMN IF NOT EXISTS execution_provenance JSONB;

ALTER TABLE experiment_trials
    ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'LOCAL';

CREATE INDEX IF NOT EXISTS idx_trials_execution_mode ON experiment_trials(execution_mode);

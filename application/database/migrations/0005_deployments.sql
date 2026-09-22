-- Migration 0005: Deployments and Multi-Target Portability
-- Additive and backward-compatible: does not alter or drop existing records or tables.

CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_provider TEXT NOT NULL, -- 'AWS_EKS' | 'GCP_GKE' | 'LOCAL_KUBERNETES'
    target_environment TEXT NOT NULL DEFAULT 'cloud', -- 'cloud' | 'local'
    status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT' | 'READY' | 'QUEUED' | 'DEPLOYING' | 'RUNNING' | 'FAILED' | 'STOPPED' | 'BLOCKED_CREDENTIALS' | 'BLOCKED_CONFIGURATION'
    source_type TEXT NOT NULL DEFAULT 'GITHUB', -- 'GITHUB' | 'ZIP_ARCHIVE'
    source_reference TEXT NOT NULL,
    image_reference TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    endpoint_url TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_application_id ON deployments(application_id);
CREATE INDEX IF NOT EXISTS idx_deployments_owner_id ON deployments(owner_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);

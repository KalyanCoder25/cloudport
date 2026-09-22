-- Migration 0006: Technology Normalization, Manual Configuration, and Deployment Lifecycle
-- Additive and backward compatible: does not alter or drop existing records or tables.

-- 1. Add technology and configuration fields to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS technology TEXT NOT NULL DEFAULT 'NODE';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS build_command TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS start_command TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS port INT DEFAULT 8080;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS dockerfile_path TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Normalize existing applications: if framework contains 'Node.js', ensure technology is 'NODE'
UPDATE applications
SET technology = 'NODE'
WHERE framework ILIKE '%node%' OR framework ILIKE '%express%';

-- 3. Add lifecycle timestamp and configuration fields to deployments table
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 4. Index on deleted_at to support filtering active vs deleted deployments
CREATE INDEX IF NOT EXISTS idx_deployments_deleted_at ON deployments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_applications_technology ON applications(technology);

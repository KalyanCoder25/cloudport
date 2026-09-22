-- Migration 0007: Safe Application Lifecycle Management (Active / Archived)
-- Additive and backward compatible: does not alter or drop existing records or tables.

-- 1. Add status and lifecycle timestamp columns to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2. Index on status to accelerate filtering active vs archived applications
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

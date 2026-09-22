-- Migration 0004: User Authentication & Application Ownership
-- Additive and backward compatible: does not alter or drop existing records or tables.

-- 1. Add authentication columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS salt TEXT;

-- 2. Set default credentials for the existing operator administrator (password: CloudPort2026!)
UPDATE users
SET password_hash = '25e46a226198418e271f33a50b5a4a04351be8f6593019e04b201a444dc518f235bb8e5fcf67872e0f880d0975a877c8e6a6e5c8051c3aba7522e9ed41c372b9',
    salt = 'b99b7bb8e1271cdc2b393c4ec8cc2cc3',
    updated_at = now()
WHERE email = 'operator@cloudport.local' AND password_hash IS NULL;

-- 3. Create applications table
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    repository_url TEXT,
    framework TEXT NOT NULL DEFAULT 'Node.js',
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_id, name)
);

-- 4. Add application_id column to experiments table
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE SET NULL;

-- 5. Establish default system baseline application and link historical experiments
DO $$
DECLARE
    operator_id UUID;
    baseline_app_id UUID;
BEGIN
    SELECT id INTO operator_id FROM users WHERE email = 'operator@cloudport.local' LIMIT 1;
    
    IF operator_id IS NOT NULL THEN
        -- Insert baseline application if it does not already exist
        INSERT INTO applications (name, description, repository_url, framework, owner_id)
        VALUES (
            'CloudPort Core Research Suite',
            'Baseline research applications and multi-cloud experiment benchmarks.',
            'https://github.com/cloudport/cloudport',
            'Node.js / Express',
            operator_id
        )
        ON CONFLICT (owner_id, name) DO UPDATE SET updated_at = now()
        RETURNING id INTO baseline_app_id;

        -- Associate historical experiments with this baseline application if unlinked
        IF baseline_app_id IS NOT NULL THEN
            UPDATE experiments
            SET application_id = baseline_app_id
            WHERE application_id IS NULL;
        END IF;
    END IF;
END $$;

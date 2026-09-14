-- Existing channels retain their publishing behavior. Visibility is unchanged.
ALTER TABLE channels ADD COLUMN posting_policy TEXT NOT NULL DEFAULT 'all'
    CONSTRAINT channels_posting_policy_check CHECK (posting_policy IN ('all', 'admins'));

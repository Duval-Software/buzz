-- CreatorHive managed identities. Secrets are encrypted by the relay with a
-- separately backed-up master key, never by the database or browser.
CREATE TABLE managed_accounts (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    pubkey TEXT NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
    key_version INTEGER NOT NULL CHECK (key_version > 0),
    sealed_secret BYTEA NOT NULL CHECK (octet_length(sealed_secret) = 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, account_id),
    UNIQUE (community_id, pubkey)
);
CREATE TABLE managed_sessions (
    community_id UUID NOT NULL,
    pubkey TEXT NOT NULL,
    auth_session_id UUID NOT NULL,
    token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (community_id, token_hash),
    FOREIGN KEY (community_id, pubkey) REFERENCES managed_accounts(community_id, pubkey) ON DELETE CASCADE
);
CREATE INDEX managed_sessions_expiry ON managed_sessions(expires_at);
CREATE INDEX managed_sessions_auth_session ON managed_sessions(auth_session_id);

-- Non-Supabase deployments fail closed. The explicit Supabase deployment
-- migration replaces this with an auth.sessions check; ordinary startup cannot.
CREATE FUNCTION managed_auth_session_active(account_id UUID, session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT false $$;

-- Replay protection is shared by all signing workers, not process-local.
CREATE TABLE managed_signing_requests (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, account_id, request_id),
    FOREIGN KEY (community_id, account_id) REFERENCES managed_accounts(community_id, account_id) ON DELETE CASCADE
);
CREATE INDEX managed_signing_requests_expiry ON managed_signing_requests(created_at);

-- Registry entries retain agentkeeper's encrypted credentials. No data import.
CREATE TABLE hosted_agents (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
    owner_pubkey TEXT NOT NULL CHECK (owner_pubkey ~ '^[0-9a-f]{64}$'),
    record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, pubkey)
);
CREATE INDEX hosted_agents_owner ON hosted_agents(community_id, owner_pubkey);

-- Credentials recover the existing messaging identity; they never grant membership.
CREATE TABLE community_accounts (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    username TEXT NOT NULL CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    pubkey TEXT NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
    password_hash TEXT NOT NULL,
    vault JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, username),
    UNIQUE (community_id, pubkey)
);

-- Shared across relay processes. No client supplied forwarded IP is trusted.
CREATE TABLE account_auth_attempts (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    bucket TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (community_id, bucket)
);
CREATE INDEX account_auth_attempts_expiry ON account_auth_attempts(window_start);

CREATE TABLE account_sessions (
    community_id UUID NOT NULL,
    pubkey TEXT NOT NULL,
    token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '12 hours',
    PRIMARY KEY (community_id, token_hash),
    FOREIGN KEY (community_id, pubkey) REFERENCES community_accounts(community_id, pubkey) ON DELETE CASCADE
);
CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);

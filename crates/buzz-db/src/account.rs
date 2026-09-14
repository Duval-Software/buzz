//! Community-scoped credentials. All authorization continues through relay membership.
use crate::{Db, Result};
use buzz_core::CommunityId;
use serde_json::Value;

/// Private credential record, read only by the authentication service.
#[derive(sqlx::FromRow)]
pub struct Account {
    /// Canonical, case-insensitive login name.
    pub username: String,
    /// Existing messaging identity; never a role grant.
    pub pubkey: String,
    /// Salted Argon2id password verifier.
    pub password_hash: String,
    /// Browser-encrypted identity envelope.
    pub vault: Value,
}

impl Db {
    /// Fetch credentials from the authoritative pool, scoped to the request host.
    pub async fn account(&self, community: CommunityId, username: &str) -> Result<Option<Account>> {
        Ok(sqlx::query_as("SELECT username, pubkey, password_hash, vault FROM community_accounts WHERE community_id = $1 AND username = $2")
            .bind(community.as_uuid()).bind(username).fetch_optional(&self.pool).await?)
    }

    /// Create a login without modifying community or channel membership.
    pub async fn create_account(&self, community: CommunityId, account: &Account) -> Result<bool> {
        Ok(sqlx::query("INSERT INTO community_accounts (community_id, username, pubkey, password_hash, vault) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
            .bind(community.as_uuid()).bind(&account.username).bind(&account.pubkey)
            .bind(&account.password_hash).bind(&account.vault).execute(&self.pool).await?.rows_affected() == 1)
    }

    /// Compare-and-swap ensures concurrent password changes cannot overwrite one another.
    pub async fn change_account_password(
        &self,
        community: CommunityId,
        account: &Account,
        old_hash: &str,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query("UPDATE community_accounts SET password_hash=$3, vault=$4, updated_at=now() WHERE community_id=$1 AND username=$2 AND password_hash=$5 AND pubkey=$6")
            .bind(community.as_uuid()).bind(&account.username).bind(&account.password_hash)
            .bind(&account.vault).bind(old_hash).bind(&account.pubkey).execute(&mut *tx).await?.rows_affected() == 1;
        if changed {
            sqlx::query("DELETE FROM account_sessions WHERE community_id=$1 AND pubkey=$2")
                .bind(community.as_uuid())
                .bind(&account.pubkey)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    /// Reserve one attempt atomically across replicas; expired buckets reset after 15 minutes.
    pub async fn account_auth_allowed(
        &self,
        community: CommunityId,
        bucket: &str,
        limit: i32,
    ) -> Result<bool> {
        sqlx::query(
            "DELETE FROM account_auth_attempts WHERE community_id=$1 AND window_start < now() - interval '1 day'",
        )
        .bind(community.as_uuid())
        .execute(&self.pool)
        .await?;
        let attempts: i32 = sqlx::query_scalar("INSERT INTO account_auth_attempts (community_id,bucket) VALUES ($1,$2) ON CONFLICT (community_id,bucket) DO UPDATE SET attempts=CASE WHEN account_auth_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE account_auth_attempts.attempts+1 END, window_start=CASE WHEN account_auth_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE account_auth_attempts.window_start END RETURNING attempts")
            .bind(community.as_uuid()).bind(bucket).fetch_one(&self.pool).await?;
        Ok(attempts <= limit)
    }
    /// Issue a session only if credentials still match; serialize against password changes.
    pub async fn create_account_session(
        &self,
        community: CommunityId,
        account: &Account,
        token_hash: &str,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let valid: Option<String> = sqlx::query_scalar("SELECT pubkey FROM community_accounts WHERE community_id=$1 AND username=$2 AND password_hash=$3 FOR UPDATE")
            .bind(community.as_uuid()).bind(&account.username).bind(&account.password_hash).fetch_optional(&mut *tx).await?;
        if valid.is_none() {
            return Ok(false);
        }
        sqlx::query("DELETE FROM account_sessions WHERE community_id=$1 AND expires_at < now()")
            .bind(community.as_uuid())
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO account_sessions (community_id,pubkey,token_hash) VALUES ($1,$2,$3)",
        )
        .bind(community.as_uuid())
        .bind(&account.pubkey)
        .bind(token_hash)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    /// Credential accounts require an unexpired, unrevoked session; legacy identities keep their existing access.
    pub async fn account_session_allowed(
        &self,
        community: CommunityId,
        pubkey: &str,
        token_hash: Option<&str>,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM community_accounts WHERE community_id=$1 AND pubkey=$2) OR EXISTS (SELECT 1 FROM account_sessions WHERE community_id=$1 AND pubkey=$2 AND token_hash=$3 AND expires_at>now())")
            .bind(community.as_uuid()).bind(pubkey).bind(token_hash).fetch_one(&self.pool).await?)
    }

    /// Sign out a single device. Repeating logout is harmless.
    pub async fn revoke_account_session(
        &self,
        community: CommunityId,
        token_hash: &str,
    ) -> Result<()> {
        sqlx::query("DELETE FROM account_sessions WHERE community_id=$1 AND token_hash=$2")
            .bind(community.as_uuid())
            .bind(token_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

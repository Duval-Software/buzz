//! Server-owned identities and sessions. Supabase authority is checked in the
//! database as well as at the HTTP authentication boundary.
use crate::{Db, DbError, Result};
use buzz_core::CommunityId;
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Private authenticated-encryption envelope; never returned by a browser API.
#[derive(sqlx::FromRow)]
pub struct ManagedAccount {
    /// Supabase user ID, unique within a community.
    pub account_id: Uuid,
    /// Public messaging identity.
    pub pubkey: String,
    /// Operator-managed encryption key version.
    pub key_version: i32,
    /// AES-256-GCM nonce followed by ciphertext and authentication tag.
    pub sealed_secret: Vec<u8>,
}

impl Db {
    /// Verify registry-owned agent authority without granting a member session.
    /// Supabase installs this private function alongside its account integration.
    pub async fn managed_hosted_agent_active(
        &self,
        community: CommunityId,
        pubkey: &str,
    ) -> Result<bool> {
        Ok(
            sqlx::query_scalar("SELECT managed_hosted_agent_active($1,$2)")
                .bind(community.as_uuid())
                .bind(pubkey)
                .fetch_one(&self.pool)
                .await?,
        )
    }

    /// Fail startup if managed credentials target the wrong schema or plaintext transport.
    pub async fn managed_database_ready(&self) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT current_schema()='buzz' AND coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false)").fetch_one(&self.pool).await?)
    }

    /// Find joined channels whose relay-authored discovery snapshot omits this member.
    /// Rechecking on bootstrap repairs an interrupted first-login publication.
    pub async fn managed_channels_to_publish(
        &self,
        community: CommunityId,
        pubkey: &str,
        relay: &[u8],
    ) -> Result<Vec<Uuid>> {
        Ok(sqlx::query_scalar("SELECT c.id FROM channels c JOIN channel_members m ON m.community_id=c.community_id AND m.channel_id=c.id LEFT JOIN LATERAL (SELECT e.tags FROM events e WHERE e.community_id=c.community_id AND e.channel_id=c.id AND e.kind=39002 AND e.pubkey=$3 AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 1) snapshot ON true WHERE c.community_id=$1 AND m.pubkey=decode($2,'hex') AND c.deleted_at IS NULL AND c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot.tags) t WHERE t->>0='p' AND t->>1=$2 AND t->>3=m.role::text)")
            .bind(community.as_uuid()).bind(pubkey).bind(relay).fetch_all(&self.pool).await?)
    }

    /// Check live account and session authority, rejecting OAuth client sessions.
    pub async fn managed_session_active(&self, account: Uuid, session: Uuid) -> Result<bool> {
        Ok(
            sqlx::query_scalar("SELECT managed_auth_session_active($1,$2)")
                .bind(account)
                .bind(session)
                .fetch_one(&self.pool)
                .await?,
        )
    }

    /// Provision once under the unique account constraint. Concurrent callbacks
    /// return the winning identity. Existing removals are never undone by login.
    pub async fn provision_managed_account(
        &self,
        community: CommunityId,
        candidate: &ManagedAccount,
        session: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<ManagedAccount> {
        let mut tx = self.pool.begin().await?;
        let active: bool = sqlx::query_scalar("SELECT managed_auth_session_active($1,$2)")
            .bind(candidate.account_id)
            .bind(session)
            .fetch_one(&mut *tx)
            .await?;
        if !active || expires_at <= Utc::now() {
            return Err(DbError::InvalidData(
                "Account session is no longer active".into(),
            ));
        }
        let inserted = sqlx::query("INSERT INTO managed_accounts (community_id,account_id,pubkey,key_version,sealed_secret) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (community_id,account_id) DO NOTHING")
            .bind(community.as_uuid()).bind(candidate.account_id).bind(&candidate.pubkey)
            .bind(candidate.key_version).bind(&candidate.sealed_secret)
            .execute(&mut *tx).await?.rows_affected() == 1;
        let account: ManagedAccount = sqlx::query_as("SELECT account_id,pubkey,key_version,sealed_secret FROM managed_accounts WHERE community_id=$1 AND account_id=$2 FOR UPDATE")
            .bind(community.as_uuid()).bind(candidate.account_id).fetch_one(&mut *tx).await?;
        if inserted {
            sqlx::query(
                "INSERT INTO relay_members (community_id,pubkey,role) VALUES ($1,$2,'member')",
            )
            .bind(community.as_uuid())
            .bind(&account.pubkey)
            .execute(&mut *tx)
            .await?;
            sqlx::query("INSERT INTO channel_members (community_id,channel_id,pubkey,role) SELECT community_id,id,decode($2,'hex'),'member' FROM channels WHERE community_id=$1 AND visibility='open' AND deleted_at IS NULL AND archived_at IS NULL ON CONFLICT DO NOTHING")
                .bind(community.as_uuid()).bind(&account.pubkey).execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM managed_sessions WHERE community_id=$1 AND expires_at<=now()")
            .bind(community.as_uuid())
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO managed_sessions (community_id,pubkey,auth_session_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (community_id,token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE managed_sessions.pubkey=EXCLUDED.pubkey AND managed_sessions.auth_session_id=EXCLUDED.auth_session_id")
            .bind(community.as_uuid()).bind(&account.pubkey).bind(session).bind(token_hash)
            .bind(expires_at).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(account)
    }

    /// Fetch only the caller's community-scoped identity, from the writer pool.
    pub async fn managed_account(
        &self,
        community: CommunityId,
        account: Uuid,
    ) -> Result<Option<ManagedAccount>> {
        Ok(sqlx::query_as("SELECT account_id,pubkey,key_version,sealed_secret FROM managed_accounts WHERE community_id=$1 AND account_id=$2")
            .bind(community.as_uuid()).bind(account).fetch_optional(&self.pool).await?)
    }

    /// Reserve a one-use signing request across replicas. UUIDs older than ten
    /// minutes are rejected by the API timestamp check before reaching this call.
    pub async fn reserve_managed_signature(
        &self,
        community: CommunityId,
        account: Uuid,
        request: Uuid,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM managed_signing_requests WHERE community_id=$1 AND created_at<now()-interval '10 minutes'")
            .bind(community.as_uuid()).execute(&mut *tx).await?;
        let reserved = sqlx::query("INSERT INTO managed_signing_requests (community_id,account_id,request_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(community.as_uuid()).bind(account).bind(request).execute(&mut *tx).await?.rows_affected() == 1;
        tx.commit().await?;
        Ok(reserved)
    }

    /// A signing token must belong to the exact Supabase session making the call.
    pub async fn managed_signing_session_matches(
        &self,
        community: CommunityId,
        pubkey: &str,
        session: Uuid,
        hash: &str,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM managed_sessions WHERE community_id=$1 AND pubkey=$2 AND auth_session_id=$3 AND token_hash=$4 AND expires_at>now())")
            .bind(community.as_uuid()).bind(pubkey).bind(session).bind(hash).fetch_one(&self.pool).await?)
    }

    /// Revoke this Supabase session's relay tokens in every community.
    pub async fn revoke_managed_session(&self, account: Uuid, session: Uuid) -> Result<()> {
        sqlx::query("DELETE FROM managed_sessions s USING managed_accounts a WHERE s.community_id=a.community_id AND s.pubkey=a.pubkey AND a.account_id=$1 AND s.auth_session_id=$2")
            .bind(account).bind(session).execute(&self.pool).await?;
        Ok(())
    }
}

impl Db {
    /// Strict managed-only session check for retained services; no legacy fallback.
    pub async fn managed_pubkey_session_active(
        &self,
        community: CommunityId,
        pubkey: &str,
        hash: &str,
    ) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM managed_sessions s JOIN managed_accounts a USING (community_id,pubkey) JOIN relay_members m USING (community_id,pubkey) WHERE s.community_id=$1 AND s.pubkey=$2 AND s.token_hash=$3 AND s.expires_at>now() AND managed_auth_session_active(a.account_id,s.auth_session_id) AND NOT EXISTS(SELECT 1 FROM moderation_rename_holds h WHERE h.community_id=s.community_id AND h.pubkey=decode(s.pubkey,'hex') AND h.required))")
            .bind(community.as_uuid()).bind(pubkey).bind(hash).fetch_one(&self.pool).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn concurrent_bootstrap_never_duplicates_or_restores_removed_members() {
        let url = std::env::var("TEST_DATABASE_URL").expect("isolated database URL");
        let admin = sqlx::PgPool::connect(&url).await.expect("connect");
        let schema = format!("managed_test_{}", Uuid::new_v4().simple());
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!("CREATE SCHEMA {schema}")))
            .execute(&admin)
            .await
            .expect("create scratch schema");
        let path = schema.clone();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .after_connect(move |conn, _| {
                let path = path.clone();
                Box::pin(async move {
                    sqlx::query("SELECT set_config('search_path',$1,false)")
                        .bind(path)
                        .execute(conn)
                        .await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await
            .expect("scratch pool");
        crate::migration::run_migrations(&pool)
            .await
            .expect("migrate");
        // The real Supabase session function is separately checked against auth
        // rows through MCP. Here isolate the transactional provisioning contract.
        sqlx::raw_sql("CREATE OR REPLACE FUNCTION managed_auth_session_active(account_id UUID,session_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT true $$;")
            .execute(&pool).await.expect("install test authority");
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id,host) VALUES ($1,'test.creatorhive.invalid')")
            .bind(id)
            .execute(&pool)
            .await
            .expect("community");
        let channel = Uuid::new_v4();
        sqlx::query("INSERT INTO channels (id,community_id,name,created_by) VALUES ($1,$2,'General',decode($3,'hex'))")
            .bind(channel).bind(id).bind("ef".repeat(32)).execute(&pool).await.expect("seed channel");
        let community = CommunityId::from_uuid(id);
        let db = Db::from_pool(pool.clone());
        let account_id = Uuid::new_v4();
        let session = Uuid::new_v4();
        let a = ManagedAccount {
            account_id,
            pubkey: "ab".repeat(32),
            key_version: 1,
            sealed_secret: vec![0; 60],
        };
        let b = ManagedAccount {
            account_id,
            pubkey: "cd".repeat(32),
            key_version: 1,
            sealed_secret: vec![1; 60],
        };
        let expires = Utc::now() + chrono::Duration::minutes(10);
        let hash_a = "a".repeat(64);
        let hash_b = "b".repeat(64);
        let (first, second) = tokio::join!(
            db.provision_managed_account(community, &a, session, &hash_a, expires),
            db.provision_managed_account(community, &b, session, &hash_b, expires)
        );
        let first = first.expect("first");
        let second = second.expect("second");
        assert_eq!(first.pubkey, second.pubkey);
        assert_eq!(
            db.managed_channels_to_publish(community, &first.pubkey, &[0u8; 32])
                .await
                .expect("discover joined channels"),
            vec![channel]
        );
        assert!(db
            .managed_signing_session_matches(community, &first.pubkey, session, &hash_a)
            .await
            .expect("same session"));
        assert!(!db
            .managed_signing_session_matches(community, &first.pubkey, Uuid::new_v4(), &hash_a)
            .await
            .expect("wrong session"));
        let role: String =
            sqlx::query_scalar("SELECT role FROM relay_members WHERE community_id=$1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("role");
        assert_eq!(role, "member");
        assert!(!db
            .account_session_allowed(community, &first.pubkey, None)
            .await
            .expect("missing token"));
        assert!(db
            .account_session_allowed(community, &first.pubkey, Some(&hash_a))
            .await
            .expect("valid token"));
        db.revoke_managed_session(account_id, session)
            .await
            .expect("logout");
        assert!(!db
            .account_session_allowed(community, &first.pubkey, Some(&hash_a))
            .await
            .expect("revoked token"));
        sqlx::query("DELETE FROM relay_members WHERE community_id=$1")
            .bind(id)
            .execute(&pool)
            .await
            .expect("remove member");
        db.provision_managed_account(community, &b, session, &hash_b, expires)
            .await
            .expect("repeat bootstrap");
        assert!(!db
            .is_relay_member(community, &first.pubkey)
            .await
            .expect("membership remains removed"));
        let request = Uuid::new_v4();
        assert!(db
            .reserve_managed_signature(community, account_id, request)
            .await
            .expect("first request"));
        assert!(!db
            .reserve_managed_signature(community, account_id, request)
            .await
            .expect("replay"));
        pool.close().await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE")))
            .execute(&admin)
            .await
            .expect("cleanup");
    }
}

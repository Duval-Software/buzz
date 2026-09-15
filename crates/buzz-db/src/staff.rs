//! Private community staff reads and atomic, replay-safe moderation commands.
use crate::{Db, Result};
use buzz_core::CommunityId;
use serde_json::{json, Value};
use uuid::Uuid;

impl Db {
    /// A private target is reviewable only through its existing community report.
    pub async fn staff_event_reported(&self, community: CommunityId, event: &[u8]) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM moderation_reports WHERE community_id=$1 AND target_event_id=$2)").bind(community.as_uuid()).bind(event).fetch_one(&self.pool).await?)
    }

    /// Validate with the same transaction as execution, rolling back when signing only.
    pub async fn staff_command(
        &self,
        community: CommunityId,
        actor: &[u8],
        command: &[u8],
        kind: u32,
        args: &Value,
        validate_only: bool,
    ) -> Result<Value> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query_scalar("SELECT moderation_staff_command($1,$2,$3,$4,$5)")
            .bind(community.as_uuid())
            .bind(actor)
            .bind(command)
            .bind(kind as i32)
            .bind(args)
            .fetch_one(&mut *tx)
            .await?;
        if validate_only {
            tx.rollback().await?;
        } else {
            tx.commit().await?;
        }
        Ok(result)
    }

    /// Current rename restriction, checked independently of browser onboarding state.
    pub async fn staff_rename_required(
        &self,
        community: CommunityId,
        pubkey: &[u8],
    ) -> Result<bool> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM moderation_rename_holds WHERE community_id=$1 AND pubkey=$2 AND required)")
            .bind(community.as_uuid()).bind(pubkey).fetch_one(&self.pool).await?)
    }

    /// Bounded private lists; authorization is performed by the active-session HTTP boundary.
    pub async fn staff_read(
        &self,
        community: CommunityId,
        section: &str,
        status: &str,
        search: &str,
        page: i64,
    ) -> Result<Value> {
        let sql = match section {
            "reports" => "SELECT to_jsonb(r)-'reporter_pubkey'-'target_pubkey'-'target_event_id'-'report_event_id'-'target_blob_sha256' || jsonb_build_object('report_event_id',encode(r.report_event_id,'hex'),'target_pubkey',encode(coalesce(r.target_pubkey,e.pubkey),'hex'),'target_event_id',encode(r.target_event_id,'hex'),'display_name',m.display_name,'username',m.username,'evidence',e.content,'removed',e.deleted_at IS NOT NULL) AS item FROM moderation_reports r LEFT JOIN LATERAL (SELECT pubkey,content,deleted_at FROM events WHERE community_id=r.community_id AND id=r.target_event_id LIMIT 1) e ON true LEFT JOIN moderation_member_directory m ON m.community_id=r.community_id AND m.pubkey=encode(coalesce(r.target_pubkey,e.pubkey),'hex') WHERE r.community_id=$1 AND ($2='' OR r.status=$2) AND (coalesce(r.note,'')||coalesce(m.username,'')||coalesce(m.display_name,'')||r.report_type) ILIKE $3 ORDER BY r.created_at DESC,r.id LIMIT 51 OFFSET $4",
            "members" => "SELECT to_jsonb(m)-'community_id' || jsonb_build_object('banned',coalesce(b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>now()),false),'muted_until',b.muted_until,'rename_required',EXISTS(SELECT 1 FROM moderation_rename_holds h WHERE h.community_id=m.community_id AND h.pubkey=decode(m.pubkey,'hex') AND required)) AS item FROM moderation_member_directory m LEFT JOIN community_bans b ON b.community_id=m.community_id AND b.pubkey=decode(m.pubkey,'hex') WHERE m.community_id=$1 AND ($2='' OR m.role=$2) AND (m.display_name||coalesce(m.username,'')) ILIKE $3 ORDER BY m.display_name,m.pubkey LIMIT 51 OFFSET $4",
            "history" => "SELECT jsonb_build_object('id',a.id,'action',a.action,'reason',a.public_reason,'detail',a.private_reason,'created_at',a.created_at,'display_name',m.display_name,'username',m.username,'actor',actor.display_name,'target_pubkey',encode(a.target_pubkey,'hex')) AS item FROM moderation_actions a LEFT JOIN moderation_member_directory m ON m.community_id=a.community_id AND m.pubkey=encode(a.target_pubkey,'hex') LEFT JOIN moderation_member_directory actor ON actor.community_id=a.community_id AND actor.pubkey=encode(a.actor_pubkey,'hex') WHERE a.community_id=$1 AND ($2='' OR encode(a.target_pubkey,'hex')=$2) AND (a.action||coalesce(a.public_reason,'')||coalesce(m.display_name,'')||coalesce(m.username,'')) ILIKE $3 ORDER BY a.created_at DESC,a.id LIMIT 51 OFFSET $4",
            "appeals" => "SELECT jsonb_build_object('id',p.action_id,'explanation',p.explanation,'status',p.status,'created_at',p.created_at,'action',a.action,'reason',a.public_reason,'decision',p.decision,'original_actor',encode(a.actor_pubkey,'hex'),'exception',p.independent_review_exception,'display_name',m.display_name,'username',m.username) AS item FROM moderation_appeals p JOIN moderation_actions a ON a.community_id=p.community_id AND a.id=p.action_id LEFT JOIN moderation_member_directory m ON m.community_id=p.community_id AND m.pubkey=encode(p.pubkey,'hex') WHERE p.community_id=$1 AND ($2='' OR p.status=$2) AND (p.explanation||coalesce(m.display_name,'')) ILIKE $3 ORDER BY p.created_at DESC,p.action_id LIMIT 51 OFFSET $4",
            _ => return Ok(json!({"items":[]})),
        };
        let mut items: Vec<Value> = sqlx::query_scalar(sql)
            .bind(community.as_uuid())
            .bind(status)
            .bind(format!(
                "%{}%",
                search.replace('%', "\\%").replace('_', "\\_")
            ))
            .bind(page * 50)
            .fetch_all(&self.pool)
            .await?;
        let more = items.len() > 50;
        items.truncate(50);
        Ok(json!({"items":items,"more":more}))
    }

    /// Expose policy revision/count only; never allow browser policy edits.
    pub async fn staff_policy(&self, community: CommunityId) -> Result<Value> {
        Ok(sqlx::query_scalar("SELECT jsonb_build_object('revision',revision,'count',cardinality(terms),'updated_at',updated_at) FROM moderation_word_policy WHERE community_id=$1")
            .bind(community.as_uuid()).fetch_optional(&self.pool).await?.unwrap_or(json!({"count":0,"revision":null})))
    }

    /// Own-record restriction and appeal history, available without community admission.
    pub async fn own_moderation(&self, community: CommunityId, pubkey: &[u8]) -> Result<Value> {
        let items: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'action',a.action,'reason',a.public_reason,'created_at',a.created_at,'appeal_status',p.status,'decision',p.decision) FROM moderation_actions a LEFT JOIN moderation_appeals p ON p.community_id=a.community_id AND p.action_id=a.id WHERE a.community_id=$1 AND a.target_pubkey=$2 AND a.action IN ('ban','timeout','require_rename','delete_message') ORDER BY a.created_at DESC LIMIT 50")
            .bind(community.as_uuid()).bind(pubkey).fetch_all(&self.pool).await?;
        let restriction = self.moderation_restriction_state(community, pubkey).await?;
        Ok(
            json!({"items":items,"banned":restriction.banned,"muted_until":restriction.muted_until,"rename_required":self.staff_rename_required(community,pubkey).await?}),
        )
    }

    /// Submit exactly one appeal for an action against the authenticated account.
    pub async fn submit_appeal(
        &self,
        community: CommunityId,
        pubkey: &[u8],
        action: Uuid,
        explanation: &str,
    ) -> Result<bool> {
        Ok(sqlx::query("INSERT INTO moderation_appeals(community_id,action_id,pubkey,explanation) SELECT community_id,id,target_pubkey,$4 FROM moderation_actions WHERE community_id=$1 AND id=$2 AND target_pubkey=$3 AND action IN ('ban','timeout','require_rename','delete_message') ON CONFLICT DO NOTHING")
            .bind(community.as_uuid()).bind(action).bind(pubkey).bind(explanation).execute(&self.pool).await?.rows_affected()>0)
    }
}

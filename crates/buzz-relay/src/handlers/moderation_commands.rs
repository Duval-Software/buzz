//! Atomic community moderation commands. Commands never enter the public timeline.
use super::moderation_notices::{send_moderation_notice, ModerationNotice};
use crate::state::AppState;
use buzz_core::tenant::TenantContext;
use nostr::Event;
use serde_json::{json, Map, Value};
use std::sync::Arc;

/// Parse a bounded command vocabulary shared by the managed signer and ingestion.
pub fn command_arguments(kind: u32, tags: &[Vec<String>], content: &str) -> Result<Value, String> {
    if !content.is_empty() || !(matches!(kind, 9032 | 9040..=9046)) {
        return Err("invalid: unsupported staff command".into());
    }
    let mut result = Map::new();
    for tag in tags {
        if tag.len() != 2
            || !matches!(
                tag[0].as_str(),
                "p" | "reason"
                    | "expiration"
                    | "report"
                    | "status"
                    | "action"
                    | "expected"
                    | "username"
                    | "appeal"
                    | "decision"
                    | "exception"
                    | "role"
            )
            || tag[1].len() > 2000
            || result.insert(tag[0].clone(), json!(tag[1])).is_some()
        {
            return Err("invalid: malformed staff command".into());
        }
    }
    if !result
        .get("reason")
        .and_then(Value::as_str)
        .is_some_and(|s| (3..=500).contains(&s.trim().chars().count()))
    {
        return Err("invalid: give a reason between 3 and 500 characters".into());
    }
    for key in ["p", "report"] {
        if result
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("invalid: invalid target".into());
        }
    }
    Ok(Value::Object(result))
}

/// Return only explicit validation/conflict failures to members, never database internals.
pub fn command_error(error: buzz_db::DbError) -> String {
    if let buzz_db::DbError::Sqlx(sqlx::Error::Database(ref e)) = error {
        if matches!(
            e.code().as_deref(),
            Some("P0001" | "22023" | "42501" | "40001")
        ) {
            return format!("restricted: {}", e.message());
        }
    }
    tracing::error!(%error,"staff operation failed");
    "error: Moderation service unavailable. Please retry.".into()
}

/// Apply authority, enforcement, audit and report closure in the same transaction.
pub async fn handle_moderation_command(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
) -> Result<(), String> {
    if event
        .created_at
        .as_secs()
        .abs_diff(chrono::Utc::now().timestamp() as u64)
        > 120
    {
        return Err("invalid: staff command expired".into());
    }
    let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
    let args = command_arguments(event.kind.as_u16() as u32, &tags, &event.content)?;
    let result = state
        .db
        .staff_command(
            tenant.community(),
            event.pubkey.as_bytes(),
            event.id.as_bytes(),
            event.kind.as_u16() as u32,
            &args,
            false,
        )
        .await
        .map_err(command_error)?;
    if result["duplicate"] == true {
        return Ok(());
    }
    if result["operation"] == "delete" {
        if let (Some(channel), Some(target)) = (
            result["channel_id"].as_str().and_then(|s| s.parse().ok()),
            result["target_event"].as_str(),
        ) {
            let tombstone = json!({"type":"message_deleted","actor":event.pubkey.to_hex(),"target_event_id":target,"action_id":result["action_id"],"public_reason":args["reason"]});
            if let Err(error) =
                super::side_effects::emit_system_message(tenant, state, channel, tombstone).await
            {
                tracing::warn!(%error,"deletion notice delivery failed");
            }
        }
    }
    if let Some(target) = result["target"].as_str().and_then(|s| hex::decode(s).ok()) {
        if result["operation"] == "ban" || result["operation"] == "require_rename" {
            state.disconnect_pubkey_clusterwide(
                tenant,
                &target,
                &event.id.to_hex(),
                "blocked: review your account restrictions",
            );
        }
        if matches!(
            result["operation"].as_str(),
            Some("ban" | "timeout" | "require_rename" | "delete")
        ) {
            if let Some(action_id) = result["action_id"].as_str().and_then(|s| s.parse().ok()) {
                let public_reason = args["reason"].as_str().unwrap_or_default().into();
                let notice = if result["operation"] == "delete" {
                    ModerationNotice::ContentActioned {
                        action_id,
                        public_reason,
                    }
                } else {
                    ModerationNotice::Restriction {
                        action_id,
                        kind: result["operation"].as_str().unwrap_or_default().into(),
                        public_reason,
                    }
                };
                if let Err(error) = send_moderation_notice(tenant, state, &target, notice).await {
                    tracing::warn!(%error,"restriction notice delivery failed; account restriction remains available");
                }
            }
        }
    }
    if let (Some(reporter), Some(report_id)) = (
        result["reporter"]
            .as_str()
            .and_then(|s| hex::decode(s).ok()),
        result["report_id"].as_str().and_then(|s| s.parse().ok()),
    ) {
        let notice = ModerationNotice::ReportResolved {
            report_id,
            status: result["status"].as_str().unwrap_or("resolved").into(),
            summary: args["reason"].as_str().unwrap_or_default().into(),
        };
        if let Err(error) = send_moderation_notice(tenant, state, &reporter, notice).await {
            tracing::warn!(%error,"report notice delivery failed");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_staff_templates() {
        let good = vec![
            vec!["reason".into(), "Repeated harassment".into()],
            vec!["p".into(), "a".repeat(64)],
        ];
        assert!(command_arguments(9040, &good, "").is_ok());
        assert!(command_arguments(9040, &good, "injected content").is_err());
        assert!(command_arguments(9040, &[], "").is_err());
        let mut duplicate = good.clone();
        duplicate.push(good[0].clone());
        assert!(command_arguments(9040, &duplicate, "").is_err());
        let mut unknown = good;
        unknown.push(vec!["delegation".into(), "x".into()]);
        assert!(command_arguments(9040, &unknown, "").is_err());
    }
}

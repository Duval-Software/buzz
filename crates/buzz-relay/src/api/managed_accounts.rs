//! HTTP-only member bootstrap and signing bridge. Business authorization remains
//! in the shared event ingest pipeline; signing has its own narrow allowlist.
use super::{api_error, internal_error, managed_identity as identity};
use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use identity::ApiError;
use nostr::{Event, EventBuilder, Kind, Tag, Timestamp};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

/// Create or recover the same server-owned identity after a verified login.
pub async fn bootstrap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (tenant, claims) = identity::authenticate(&state, &headers).await?;
    if !state
        .db
        .account_auth_allowed(tenant.community(), &format!("bootstrap:{}", claims.sub), 60)
        .await
        .map_err(|_| internal_error("Account service unavailable"))?
    {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Please try again shortly.",
        ));
    }
    let candidate = match state
        .db
        .managed_account(tenant.community(), claims.sub)
        .await
        .map_err(|_| internal_error("Account unavailable"))?
    {
        Some(account) => {
            let key = hex::decode(&account.pubkey).map_err(|_| identity::denied())?;
            let own = state
                .db
                .own_moderation(tenant.community(), &key)
                .await
                .map_err(|_| internal_error("Account restrictions unavailable"))?;
            if own["banned"] == true || own["rename_required"] == true {
                return Ok(Json(json!({"restrictions":own})));
            }
            account
        }
        None => identity::generate(*tenant.community().as_uuid(), claims.sub)?,
    };
    let token = identity::token()?;
    let account = state
        .db
        .provision_managed_account(
            tenant.community(),
            &candidate,
            claims.session_id,
            &identity::token_hash(&token),
            identity::expiry(&claims)?,
        )
        .await
        .map_err(|_| internal_error("Could not prepare your account. Please retry."))?;
    if !state
        .db
        .is_relay_member(tenant.community(), &account.pubkey)
        .await
        .map_err(|_| internal_error("Community unavailable"))?
    {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Your account does not have community access.",
        ));
    }
    // Membership rows alone are invisible to Nostr clients. Repair their relay-
    // signed discovery records before allowing the browser into the community.
    let relay_public = state.relay_keypair.public_key();
    for channel in state
        .db
        .managed_channels_to_publish(tenant.community(), &account.pubkey, relay_public.as_bytes())
        .await
        .map_err(|_| internal_error("Channel discovery unavailable. Please retry."))?
    {
        crate::handlers::side_effects::emit_group_discovery_events(&tenant, &state, channel)
            .await
            .map_err(|_| internal_error("Channel discovery unavailable. Please retry."))?;
    }
    if state
        .db
        .nip43_membership_snapshot_needs_reconciliation(tenant.community(), &relay_public)
        .await
        .map_err(|_| internal_error("Community discovery unavailable. Please retry."))?
    {
        crate::handlers::side_effects::publish_nip43_membership_list(&tenant, &state)
            .await
            .map_err(|_| internal_error("Community discovery unavailable. Please retry."))?;
    }
    Ok(Json(
        json!({"accountId":claims.sub,"pubkey":account.pubkey,"sessionToken":token,"expiresAt":claims.exp}),
    ))
}

/// A client may request only an unsigned event, never choose its signing key.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignRequest {
    /// Unique, single-use request identifier.
    pub request_id: Uuid,
    /// Session issued by bootstrap and bound to the current Supabase session.
    pub session_token: String,
    /// Narrowly validated event template.
    pub event: SignTemplate,
}

/// Fields allowed in a managed event request.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignTemplate {
    /// Protocol event kind, checked against a server allowlist.
    pub kind: u16,
    /// Seconds since Unix epoch; at most thirty seconds from server time.
    pub created_at: u64,
    /// Protocol tags; client-supplied credentials are forbidden.
    pub tags: Vec<Vec<String>>,
    /// Bounded event content.
    pub content: String,
}

fn invalid() -> ApiError {
    api_error(StatusCode::BAD_REQUEST, "This request cannot be signed.")
}
fn tag<'a>(event: &'a SignTemplate, name: &str) -> Result<&'a str, ApiError> {
    let mut matches = event
        .tags
        .iter()
        .filter(|t| t.first().is_some_and(|k| k == name));
    let result = matches
        .next()
        .filter(|t| t.len() == 2)
        .and_then(|t| t.get(1))
        .ok_or_else(invalid)?;
    if matches.next().is_some() {
        return Err(invalid());
    }
    Ok(result)
}
fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_template(
    event: &SignTemplate,
    relay_url: &str,
    http_origins: &[&str],
    now: u64,
) -> Result<(), ApiError> {
    if event.created_at.abs_diff(now) > 30
        || event.content.len() > 65536
        || event.tags.len() > 64
        || event.tags.iter().any(|t| {
            t.is_empty()
                || t.len() > 8
                || t.iter().any(|s| s.len() > 4096)
                || matches!(t[0].as_str(), "account-session" | "auth" | "delegation")
        })
    {
        return Err(invalid());
    }
    match event.kind {
        22242 => {
            if !event.content.is_empty()
                || tag(event, "relay")?.trim_end_matches('/') != relay_url.trim_end_matches('/')
                || !is_hash(tag(event, "challenge")?)
                || event.tags.len() != 2
            {
                return Err(invalid());
            }
        }
        27235 => {
            let target = url::Url::parse(tag(event, "u")?).map_err(|_| invalid())?;
            let origin = target.origin().ascii_serialization();
            if !http_origins.contains(&origin.as_str())
                || !target.username().is_empty()
                || target.password().is_some()
                || target.fragment().is_some()
                || target.path().starts_with("/api/accounts")
                || target.path().starts_with("/api/identity")
                || !(matches!(target.path(), "/events" | "/query" | "/count")
                    || target.path().starts_with("/api/")
                    || target.path().starts_with("/keeper/")
                    || target.path().starts_with("/stage/"))
                || !event.content.is_empty()
                || !matches!(
                    tag(event, "method")?,
                    "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
                )
            {
                return Err(invalid());
            }
            let nonce = tag(event, "nonce")?;
            if nonce.len() < 16 || nonce.len() > 128 {
                return Err(invalid());
            }
            // Body-bearing requests must bind the exact bytes via their digest.
            if matches!(tag(event, "method")?, "POST" | "PUT" | "PATCH")
                && !is_hash(tag(event, "payload")?)
            {
                return Err(invalid());
            }
            if event
                .tags
                .iter()
                .any(|t| !matches!(t[0].as_str(), "u" | "method" | "nonce" | "payload"))
            {
                return Err(invalid());
            }
        }
        24242 => {
            let relay = url::Url::parse(relay_url).map_err(|_| invalid())?;
            let host = relay.host_str().ok_or_else(invalid)?;
            if tag(event, "server")? != host || !matches!(tag(event, "t")?, "get" | "upload") {
                return Err(invalid());
            }
            let expiration: u64 = tag(event, "expiration")?.parse().map_err(|_| invalid())?;
            if expiration <= now || expiration > now + 3600 {
                return Err(invalid());
            }
            if tag(event, "t")? == "upload" && !is_hash(tag(event, "x")?) {
                return Err(invalid());
            }
            if event
                .tags
                .iter()
                .any(|t| !matches!(t[0].as_str(), "t" | "server" | "expiration" | "x"))
            {
                return Err(invalid());
            }
        }
        // Member-facing operations currently used by the web client. No key
        // delegation, relay administration, identity binding or arbitrary kinds.
        0
        | 1
        | 5
        | 7
        | 9
        | 1984
        | 20001
        | 20002
        | 30078
        | 30177
        | 30300
        | 30620
        | 40003
        | 41010
        | 42000
        | 46011
        | 46012
        | 46020
        | 9021
        | 9022
        | 9002
        | 9030
        | 9031
        | 9032
        | 9040..=9046 => {}
        _ => return Err(invalid()),
    }
    Ok(())
}

/// Sign a bounded member action after current session, tenant and channel checks.
pub async fn sign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<SignRequest>,
) -> Result<Json<Event>, ApiError> {
    let (tenant, claims) = identity::authenticate(&state, &headers).await?;
    let account = state
        .db
        .managed_account(tenant.community(), claims.sub)
        .await
        .map_err(|_| internal_error("Account unavailable"))?
        .ok_or_else(identity::denied)?;
    let hash = identity::token_hash(&request.session_token);
    if !is_hash(&request.session_token)
        || !state
            .db
            .managed_signing_session_matches(
                tenant.community(),
                &account.pubkey,
                claims.session_id,
                &hash,
            )
            .await
            .map_err(|_| internal_error("Session unavailable"))?
        || !state
            .db
            .is_relay_member(tenant.community(), &account.pubkey)
            .await
            .map_err(|_| internal_error("Community unavailable"))?
    {
        return Err(identity::denied());
    }
    if !state
        .db
        .account_auth_allowed(tenant.community(), &format!("sign:{}", claims.sub), 3000)
        .await
        .map_err(|_| internal_error("Account unavailable"))?
    {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Please wait before trying again.",
        ));
    }
    let relay_url = identity::configuration("BUZZ_MANAGED_RELAY_URL")?;
    let origins = identity::configuration("BUZZ_MANAGED_HTTP_ORIGINS")?;
    validate_template(
        &request.event,
        &relay_url,
        &origins.split(',').collect::<Vec<_>>(),
        Utc::now().timestamp() as u64,
    )?;
    let public = nostr::PublicKey::from_hex(&account.pubkey)
        .map_err(|_| internal_error("Identity unavailable"))?;
    if state
        .db
        .moderation_restriction_state(tenant.community(), public.as_bytes())
        .await
        .map_err(|_| internal_error("Permissions unavailable"))?
        .banned
    {
        return Err(identity::denied());
    }
    if state
        .db
        .staff_rename_required(tenant.community(), public.as_bytes())
        .await
        .map_err(|_| invalid())?
    {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Choose a new username in account restrictions.",
        ));
    }
    if matches!(request.event.kind, 9032 | 9040..=9046) {
        let args = crate::handlers::moderation_commands::command_arguments(
            request.event.kind as u32,
            &request.event.tags,
            &request.event.content,
        )
        .map_err(|message| api_error(StatusCode::BAD_REQUEST, &message))?;
        state
            .db
            .staff_command(
                tenant.community(),
                public.as_bytes(),
                &[0; 32],
                request.event.kind as u32,
                &args,
                true,
            )
            .await
            .map_err(|error| {
                api_error(
                    StatusCode::FORBIDDEN,
                    &crate::handlers::moderation_commands::command_error(error),
                )
            })?;
    }
    if matches!(request.event.kind, 9030..=9031) {
        let actor = state
            .db
            .get_relay_member(tenant.community(), &account.pubkey)
            .await
            .map_err(|_| invalid())?
            .ok_or_else(invalid)?;
        if !matches!(actor.role.as_str(), "admin" | "owner")
            || (request.event.kind == 9032 && actor.role != "owner")
        {
            return Err(invalid());
        }
        let target = tag(&request.event, "p")?;
        if !is_hash(target) {
            return Err(invalid());
        }
        if request.event.kind != 9030 && target == account.pubkey {
            return Err(invalid());
        }
        if request.event.kind != 9031 {
            let requested = request
                .event
                .tags
                .iter()
                .find(|t| t[0] == "role")
                .map(|_| tag(&request.event, "role"))
                .transpose()?
                .unwrap_or("member");
            if !matches!(requested, "member" | "admin")
                || (requested == "admin" && actor.role != "owner")
            {
                return Err(invalid());
            }
        }
        if let Some(member) = state
            .db
            .get_relay_member(tenant.community(), target)
            .await
            .map_err(|_| invalid())?
        {
            if request.event.kind != 9030
                && (member.role == "owner" || (actor.role == "admin" && member.role != "member"))
            {
                return Err(invalid());
            }
        } else if request.event.kind != 9030 {
            return Err(invalid());
        }
    }
    let channels: Vec<_> = request.event.tags.iter().filter(|t| t[0] == "h").collect();
    if channels.len() > 1 {
        return Err(invalid());
    }
    if let Some(channel) = channels.first() {
        let id: Uuid = channel
            .get(1)
            .ok_or_else(invalid)?
            .parse()
            .map_err(|_| invalid())?;
        let record = state
            .db
            .get_channel(tenant.community(), id)
            .await
            .map_err(|_| invalid())?;
        if record.deleted_at.is_some() || record.archived_at.is_some() {
            return Err(invalid());
        }
        // Read fresh permissions; a cached membership must not mint new signatures
        // after an administrator removes a person from a private channel.
        if record.visibility != "open"
            && !state
                .db
                .get_members(tenant.community(), id)
                .await
                .map_err(|_| invalid())?
                .iter()
                .any(|m| m.pubkey == public.as_bytes())
        {
            return Err(api_error(StatusCode::FORBIDDEN, "Channel access denied."));
        }
        if matches!(request.event.kind, 9 | 40003 | 20002) {
            crate::handlers::ingest::check_channel_publishing(
                &state,
                tenant.community(),
                id,
                public.as_bytes(),
            )
            .await
            .map_err(|_| {
                api_error(
                    StatusCode::FORBIDDEN,
                    "Posting is restricted in this channel.",
                )
            })?;
        }
    } else if matches!(request.event.kind, 9 | 20002 | 9021 | 9022) {
        return Err(invalid());
    }
    // References are also destinations: do not issue signatures pointing into
    // another community or a private conversation the caller cannot read.
    for reference in request.event.tags.iter().filter(|t| t[0] == "e") {
        let id = hex::decode(
            reference
                .get(1)
                .filter(|v| is_hash(v))
                .ok_or_else(invalid)?,
        )
        .map_err(|_| invalid())?;
        let target = state
            .db
            .get_event_by_id(tenant.community(), &id)
            .await
            .map_err(|_| invalid())?
            .ok_or_else(invalid)?;
        if !buzz_core::filter::reader_authorized_for_event(&target.event, &account.pubkey) {
            return Err(invalid());
        }
        if let Some(id) = target.channel_id {
            let record = state
                .db
                .get_channel(tenant.community(), id)
                .await
                .map_err(|_| invalid())?;
            if record.visibility != "open"
                && !state
                    .db
                    .get_members(tenant.community(), id)
                    .await
                    .map_err(|_| invalid())?
                    .iter()
                    .any(|m| m.pubkey == public.as_bytes())
            {
                return Err(invalid());
            }
            if matches!(request.event.kind, 40003 | 5) {
                crate::handlers::ingest::check_channel_publishing(
                    &state,
                    tenant.community(),
                    id,
                    public.as_bytes(),
                )
                .await
                .map_err(|_| invalid())?;
            }
        }
    }
    if request.event.kind == 41010 {
        let recipients: Vec<_> = request.event.tags.iter().filter(|t| t[0] == "p").collect();
        if recipients.is_empty() || recipients.len() > 8 || !request.event.content.is_empty() {
            return Err(invalid());
        }
        for recipient in recipients {
            let pk = recipient
                .get(1)
                .filter(|v| is_hash(v))
                .ok_or_else(invalid)?;
            if !state
                .db
                .is_relay_member(tenant.community(), pk)
                .await
                .map_err(|_| invalid())?
            {
                return Err(invalid());
            }
        }
    }
    if request.event.kind == 30177 {
        let agent = hex::decode(tag(&request.event, "d")?).map_err(|_| invalid())?;
        if !state
            .db
            .is_agent_owner(tenant.community(), &agent, public.as_bytes())
            .await
            .map_err(|_| invalid())?
        {
            return Err(invalid());
        }
    }
    if !state
        .db
        .reserve_managed_signature(tenant.community(), claims.sub, request.request_id)
        .await
        .map_err(|_| internal_error("Signing unavailable"))?
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "This signing request has already been used.",
        ));
    }
    let keys = identity::decrypt(*tenant.community().as_uuid(), &account)?;
    let mut tags = request
        .event
        .tags
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    if matches!(request.event.kind, 22242 | 27235 | 24242) {
        tags.push(Tag::parse(["account-session", &request.session_token]).map_err(|_| invalid())?);
    }
    let event = EventBuilder::new(Kind::from(request.event.kind), request.event.content)
        .tags(tags)
        .custom_created_at(Timestamp::from(request.event.created_at))
        .sign_with_keys(&keys)
        .map_err(|_| internal_error("Signing unavailable"))?;
    match request.event.kind {
        9002 => crate::handlers::side_effects::validate_admin_event(&tenant, 9002, &event, &state)
            .await
            .map_err(|_| invalid())?,
        40003 => {
            crate::handlers::ingest::validate_edit_ownership(tenant.community(), &event, &state)
                .await
                .map_err(|_| invalid())?
        }
        5 => {
            crate::handlers::side_effects::validate_standard_deletion_event(&tenant, &event, &state)
                .await
                .map_err(|_| invalid())?
        }
        _ => {}
    }
    Ok(Json(event))
}

/// Revoke all relay tokens for this device before the browser signs out of Auth.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let (_, claims) = identity::authenticate(&state, &headers).await?;
    state
        .db
        .revoke_managed_session(claims.sub, claims.session_id)
        .await
        .map_err(|_| internal_error("Could not sign out. Please retry."))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Proof supplied by a retained service after it verifies the request URL and body.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceSessionRequest {
    /// Member-signed NIP-98 event; never a private key or Supabase refresh token.
    pub event: Event,
}

/// Internal service validation. The service credential is separate from member
/// JWTs, and this endpoint can only return a boolean access decision.
pub async fn service_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ServiceSessionRequest>,
) -> Result<Json<Value>, ApiError> {
    use sha2::{Digest, Sha256};
    use subtle::ConstantTimeEq;
    if !identity::enabled() {
        return Err(api_error(StatusCode::NOT_FOUND, "Not found"));
    }
    let expected = identity::configuration("BUZZ_SERVICE_AUTH_TOKEN")?;
    if expected.len() < 64 {
        return Err(internal_error("Service authentication is not configured"));
    }
    let supplied = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if supplied.len() > 256
        || !bool::from(
            Sha256::digest(supplied.as_bytes()).ct_eq(&Sha256::digest(expected.as_bytes())),
        )
    {
        return Err(identity::denied());
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(identity::denied)?;
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| identity::denied())?;
    if request.event.kind != Kind::from(27235u16) || request.event.verify().is_err() {
        return Err(invalid());
    }
    let hash = super::accounts::session_hash(&request.event).ok_or_else(identity::denied)?;
    let pubkey = request.event.pubkey.to_hex();
    let active = state
        .db
        .managed_pubkey_session_active(tenant.community(), &pubkey, &hash)
        .await
        .map_err(|_| internal_error("Session validation unavailable"))?;
    Ok(Json(json!({"active":active})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signer_denies_external_destinations_delegation_stale_and_unknown_kinds() {
        let now = 1000;
        let mut e = SignTemplate {
            kind: 22242,
            created_at: now,
            tags: vec![
                vec!["relay".into(), "wss://chat.creatorhive.ai".into()],
                vec!["challenge".into(), "a".repeat(64)],
            ],
            content: String::new(),
        };
        let check = |e: &SignTemplate| {
            validate_template(
                e,
                "wss://chat.creatorhive.ai",
                &["https://chat.creatorhive.ai"],
                now,
            )
        };
        assert!(check(&e).is_ok());
        e.tags[0][1] = "wss://evil.example".into();
        assert!(check(&e).is_err());
        e.tags[0][1] = "wss://chat.creatorhive.ai".into();
        e.created_at = 900;
        assert!(check(&e).is_err());
        e.created_at = now;
        e.kind = 24243;
        assert!(check(&e).is_err());
        e.kind = 22242;
        e.tags.push(vec!["account-session".into(), "a".repeat(64)]);
        assert!(check(&e).is_err());
        e.tags.pop();
        e.tags.push(vec!["challenge".into(), "b".repeat(64)]);
        assert!(check(&e).is_err());
    }
}

//! First-party, active-session staff reads and restricted members' own appeals.
use super::{api_error, internal_error, managed_identity as identity};
use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

/// Bounded query for private moderation data; never accepts a tenant or actor ID.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StaffRequest {
    /// reports, members, history, appeals, or own.
    pub section: String,
    /// Existing report/appeal status or target key when filtering history.
    #[serde(default)]
    pub status: String,
    /// Search text, capped at 100 characters.
    #[serde(default)]
    pub search: String,
    /// Zero-based page, fifty rows per page.
    #[serde(default)]
    pub page: i64,
}

/// Staff reads do not inherit the deployment-admin API's cross-tenant privileges.
pub async fn read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<StaffRequest>,
) -> Result<(HeaderMap, Json<Value>), identity::ApiError> {
    let (tenant, claims) = identity::authenticate(&state, &headers).await?;
    if request.search.chars().count() > 100
        || request.status.len() > 64
        || !(0..=1000).contains(&request.page)
        || !matches!(
            request.section.as_str(),
            "own" | "reports" | "members" | "history" | "appeals"
        )
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid moderation query",
        ));
    }
    let account = state
        .db
        .managed_account(tenant.community(), claims.sub)
        .await
        .map_err(|_| internal_error("Account unavailable"))?;
    let Some(account) = account else {
        if request.section == "own" {
            return Ok((
                private_headers(),
                Json(json!({"items":[],"banned":false,"rename_required":false})),
            ));
        }
        return Err(identity::denied());
    };
    let pubkey = hex::decode(&account.pubkey).map_err(|_| identity::denied())?;
    let result = if request.section == "own" {
        state
            .db
            .own_moderation(tenant.community(), &pubkey)
            .await
            .map_err(|_| internal_error("Restrictions unavailable"))?
    } else {
        let role = state
            .db
            .get_relay_member(tenant.community(), &account.pubkey)
            .await
            .map_err(|_| internal_error("Permissions unavailable"))?
            .map(|m| m.role)
            .unwrap_or_default();
        let banned = state
            .db
            .moderation_restriction_state(tenant.community(), &pubkey)
            .await
            .map_err(|_| internal_error("Permissions unavailable"))?
            .banned;
        if banned
            || !matches!(role.as_str(), "owner" | "admin" | "moderator")
            || (request.section == "appeals" && role == "moderator")
        {
            return Err(api_error(StatusCode::FORBIDDEN, "Staff access required"));
        }
        let mut result = state
            .db
            .staff_read(
                tenant.community(),
                &request.section,
                &request.status,
                &request.search,
                request.page,
            )
            .await
            .map_err(|error| {
                tracing::error!(%error,"staff read failed");
                internal_error("Moderation service unavailable")
            })?;
        result["role"] = json!(role);
        result["self"] = json!(account.pubkey);
        result["policy"] = state
            .db
            .staff_policy(tenant.community())
            .await
            .map_err(|_| internal_error("Policy unavailable"))?;
        result
    };
    Ok((private_headers(), Json(result)))
}

/// Restricted members can appeal without acquiring a messaging/signing session.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppealRequest {
    /// The moderation action against this account.
    pub action_id: Uuid,
    /// Member explanation; no privileged fields are accepted.
    pub explanation: String,
}

/// One appeal per action, constrained to the authenticated account in this community.
pub async fn appeal(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<AppealRequest>,
) -> Result<Json<Value>, identity::ApiError> {
    let (tenant, claims) = identity::authenticate(&state, &headers).await?;
    if !(10..=2000).contains(&request.explanation.trim().chars().count()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Use between 10 and 2,000 characters.",
        ));
    }
    if !state
        .db
        .account_auth_allowed(tenant.community(), &format!("appeal:{}", claims.sub), 10)
        .await
        .map_err(|_| internal_error("Appeals unavailable"))?
    {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Please wait before submitting another appeal.",
        ));
    }
    let account = state
        .db
        .managed_account(tenant.community(), claims.sub)
        .await
        .map_err(|_| internal_error("Account unavailable"))?
        .ok_or_else(identity::denied)?;
    let key = hex::decode(account.pubkey).map_err(|_| identity::denied())?;
    let inserted = state
        .db
        .submit_appeal(
            tenant.community(),
            &key,
            request.action_id,
            request.explanation.trim(),
        )
        .await
        .map_err(|_| internal_error("Could not submit appeal"))?;
    if !inserted {
        return Err(api_error(
            StatusCode::CONFLICT,
            "Appeal already submitted or action unavailable.",
        ));
    }
    Ok(Json(json!({"submitted":true})))
}
fn private_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    headers
}

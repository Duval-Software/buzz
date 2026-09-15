//! HTTP-only anonymous portfolios and private account presentation editing.
//! Never expose the event query API, private media, or account tables to visitors.
use super::{api_error, internal_error, managed_identity as identity};
use crate::state::AppState;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

type ApiResult<T> = Result<T, identity::ApiError>;

/// Owner-selected public presentation. No identity, credentials or private preferences.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Presentation {
    /// Member-selected public display name.
    pub display_name: String,
    /// Plain-text introduction.
    pub bio: String,
    /// Optional, explicitly published build status; never inferred from private activity.
    #[serde(default)]
    pub build_status: String,
    /// Optional HTTP(S) project link for the chosen build status.
    #[serde(default)]
    pub build_url: String,
    /// Public interests selected independently of onboarding.
    pub interests: Vec<String>,
    /// One of the six accessible accent presets.
    pub accent: String,
    /// Whether the member welcomes collaboration.
    pub collaborating: bool,
    /// Public-facing links; never fetched server-side.
    pub links: Vec<ProfileLink>,
    /// Ordered portfolio selections, at most six.
    pub highlights: Vec<Highlight>,
    /// Sanitized image IDs owned by this account.
    pub avatar: Option<Uuid>,
    /// Sanitized cover ID owned by this account.
    pub cover: Option<Uuid>,
}
/// A labelled web link.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileLink {
    /// Short link label.
    pub label: String,
    /// Validated HTTP(S) destination.
    pub url: String,
}
/// A project or a reference to the owner's root Pulse note.
#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Highlight {
    /// Independently curated project entry.
    Project {
        /// Project name.
        title: String,
        /// Short project summary.
        description: String,
        /// Project website.
        url: String,
        /// Owned sanitized image identifier.
        image: Option<Uuid>,
    },
    /// Server-resolved note; caller cannot supply its author or content.
    Pulse {
        /// Existing owned root-note identifier.
        event_id: String,
    },
}
/// Atomic profile publication request.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveProfile {
    /// Explicit request to publish after preview.
    pub published: bool,
    /// Public or community-members-only.
    pub visibility: String,
    /// Only public presentation fields.
    pub presentation: Presentation,
}
/// Bounded member search; usable only with an active community session.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemberSearch {
    /// Bounded username/name query or known member key.
    pub query: String,
}

fn publication_enabled() -> bool {
    std::env::var("BUZZ_PUBLIC_PROFILES").is_ok_and(|v| v == "true")
}
fn unavailable() -> identity::ApiError {
    api_error(StatusCode::NOT_FOUND, "Profile unavailable")
}
fn invalid() -> identity::ApiError {
    api_error(
        StatusCode::BAD_REQUEST,
        "Check your profile details and links.",
    )
}
fn web_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|u| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    }) && value.len() <= 2048
}
fn validate(data: &Presentation) -> ApiResult<()> {
    if !(1..=60).contains(&data.display_name.trim().chars().count())
        || data.bio.chars().count() > 320
        || data.build_status.chars().count() > 120
        || (!data.build_url.is_empty()
            && (data.build_status.trim().is_empty() || !web_url(&data.build_url)))
        || !matches!(
            data.accent.as_str(),
            "honey" | "sage" | "sky" | "lavender" | "rose" | "sand"
        )
        || data.interests.len() > 8
        || data.links.len() > 5
        || data.highlights.len() > 6
        || data.interests.iter().any(|v| {
            !matches!(
                v.as_str(),
                "vibe_coding"
                    | "software"
                    | "ai_ml"
                    | "design"
                    | "content"
                    | "hardware"
                    | "business"
                    | "exploring"
            )
        })
        || data
            .links
            .iter()
            .any(|l| !(1..=40).contains(&l.label.trim().chars().count()) || !web_url(&l.url))
    {
        return Err(invalid());
    }
    for h in &data.highlights {
        match h {
            Highlight::Project {
                title,
                description,
                url,
                ..
            } if !(1..=80).contains(&title.trim().chars().count())
                || description.chars().count() > 240
                || !web_url(url) =>
            {
                return Err(invalid())
            }
            Highlight::Pulse { event_id }
                if event_id.len() != 64 || !event_id.bytes().all(|b| b.is_ascii_hexdigit()) =>
            {
                return Err(invalid())
            }
            _ => {}
        }
    }
    Ok(())
}
fn headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("cache-control", HeaderValue::from_static("no-store"));
    h.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h
}
async fn member(
    state: &AppState,
    request: &HeaderMap,
) -> ApiResult<(buzz_core::TenantContext, identity::Claims)> {
    let (tenant, claims) = identity::authenticate(state, request).await?;
    let account = state
        .db
        .managed_account(tenant.community(), claims.sub)
        .await
        .map_err(|_| internal_error("Account unavailable"))?
        .ok_or_else(identity::denied)?;
    let key = hex::decode(&account.pubkey).map_err(|_| identity::denied())?;
    if !state
        .db
        .is_relay_member(tenant.community(), &account.pubkey)
        .await
        .map_err(|_| internal_error("Community unavailable"))?
        || state
            .db
            .moderation_restriction_state(tenant.community(), &key)
            .await
            .map_err(|_| internal_error("Permissions unavailable"))?
            .banned
    {
        return Err(identity::denied());
    }
    Ok((tenant, claims))
}
async fn viewer(
    state: &AppState,
    request: &HeaderMap,
) -> ApiResult<(buzz_core::TenantContext, Option<Uuid>)> {
    if request.contains_key("authorization") {
        let (t, c) = member(state, request).await?;
        Ok((t, Some(c.sub)))
    } else {
        if !publication_enabled() {
            return Err(unavailable());
        }
        let host = request
            .get("host")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(unavailable)?;
        let tenant = crate::tenant::bind_community(&state.db, host)
            .await
            .map_err(|_| unavailable())?;
        Ok((tenant, None))
    }
}
/// Anonymous, explicitly projected profile read. Authenticated reads include internal actions.
pub async fn read(
    State(state): State<Arc<AppState>>,
    Path(username): Path<String>,
    request: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    if username.len() < 3
        || username.len() > 24
        || !username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(unavailable());
    }
    let (t, account) = viewer(&state, &request).await?;
    let data = state
        .db
        .public_profile(t.community(), &username.to_lowercase(), account)
        .await
        .map_err(|_| internal_error("Profile unavailable"))?
        .ok_or_else(unavailable)?;
    Ok((headers(), Json(data)))
}
/// Private editor read; existing accounts start unpublished.
pub async fn own(
    State(state): State<Arc<AppState>>,
    request: HeaderMap,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let (t, c) = member(&state, &request).await?;
    let mut data = state
        .db
        .own_public_profile(t.community(), c.sub)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::CONFLICT,
                "Claim your username in onboarding first.",
            )
        })?;
    data["publication_enabled"] = json!(publication_enabled());
    Ok((headers(), Json(data)))
}
/// Atomic account presentation save; does not change the claimed username.
pub async fn save(
    State(state): State<Arc<AppState>>,
    request: HeaderMap,
    Json(body): Json<SaveProfile>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let (t, c) = member(&state, &request).await?;
    validate(&body.presentation)?;
    if !matches!(body.visibility.as_str(), "public" | "members") {
        return Err(invalid());
    }
    if !state
        .db
        .account_auth_allowed(t.community(), &format!("profile:{}", c.sub), 30)
        .await
        .map_err(|_| internal_error("Profile unavailable"))?
    {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Please wait before saving again.",
        ));
    }
    // While release checks are pending, save drafts but never publish publicly.
    let published = body.published && (publication_enabled() || body.visibility == "members");
    state.db.save_public_profile(t.community(),c.sub,c.session_id,published,&body.visibility,serde_json::to_value(body.presentation).map_err(|_|invalid())?).await.map_err(|e| {
        tracing::warn!(error=%e,"profile save rejected");
        api_error(StatusCode::BAD_REQUEST,"Could not save. Check blocked language, image ownership, and selected Pulse posts.")
    })?;
    Ok((
        headers(),
        Json(
            json!({"saved":true,"published":published,"publication_enabled":publication_enabled()}),
        ),
    ))
}
/// Search only member identities; no account identifiers or preference export.
pub async fn search(
    State(state): State<Arc<AppState>>,
    request: HeaderMap,
    Json(body): Json<MemberSearch>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let (t, _) = member(&state, &request).await?;
    if !(1..=64).contains(&body.query.len()) {
        return Err(invalid());
    }
    let rows = state
        .db
        .profile_members(t.community(), body.query.trim())
        .await
        .map_err(|_| internal_error("Members unavailable"))?;
    Ok((headers(), Json(json!(rows))))
}
/// Upload sanitized portfolio images to the retained media store, not Supabase Storage.
pub async fn upload(
    State(state): State<Arc<AppState>>,
    request: HeaderMap,
    bytes: Bytes,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let (t, c) = member(&state, &request).await?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(invalid());
    }
    if !state
        .db
        .account_auth_allowed(t.community(), &format!("profile-image:{}", c.sub), 20)
        .await
        .map_err(|_| internal_error("Upload unavailable"))?
    {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "Please wait before uploading again.",
        ));
    }
    let jpeg = tokio::task::spawn_blocking(move || buzz_media::thumbnail::profile_variant(&bytes))
        .await
        .map_err(|_| invalid())?
        .map_err(|_| invalid())?;
    let id = Uuid::new_v4();
    let key = format!("profile-variants/{}/{id}.jpg", t.community().as_uuid());
    state
        .media_storage
        .put(&key, &jpeg, "image/jpeg")
        .await
        .map_err(|_| internal_error("Upload unavailable"))?;
    if state
        .db
        .add_profile_image(t.community(), c.sub, id)
        .await
        .is_err()
    {
        let _ = state.media_storage.delete(&key).await;
        return Err(internal_error("Upload unavailable"));
    }
    Ok((headers(), Json(json!({"id":id}))))
}
/// No signed public URLs: every image request rechecks current publication and membership.
pub async fn image(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    request: HeaderMap,
) -> ApiResult<Response> {
    let (t, viewer) = viewer(&state, &request).await?;
    let (account, username) = state
        .db
        .profile_image_account(t.community(), id)
        .await
        .map_err(|_| internal_error("Image unavailable"))?
        .ok_or_else(unavailable)?;
    let profile = state
        .db
        .public_profile(t.community(), &username, viewer)
        .await
        .map_err(|_| internal_error("Image unavailable"))?;
    let referenced = profile.as_ref().is_some_and(|p| {
        p["avatar"] == id.to_string()
            || p["cover"] == id.to_string()
            || p["highlights"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|h| h["image"] == id.to_string())
    });
    if viewer != Some(account) && !referenced {
        return Err(unavailable());
    }
    let bytes = state
        .media_storage
        .get(&format!(
            "profile-variants/{}/{id}.jpg",
            t.community().as_uuid()
        ))
        .await
        .map_err(|_| unavailable())?;
    let mut h = headers();
    h.insert("content-type", HeaderValue::from_static("image/jpeg"));
    Ok((h, bytes).into_response())
}
/// Apply privacy headers to errors as well as successful profile responses.
pub async fn no_store(mut response: Response) -> Response {
    response.headers_mut().extend(headers());
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsafe_links_and_forged_fields_are_rejected() {
        assert!(!web_url("javascript:alert(1)"));
        assert!(!web_url("https://user:secret@example.com"));
        assert!(web_url("https://example.com/project"));
        assert!(serde_json::from_value::<Highlight>(
            json!({"kind":"pulse","event_id":"a".repeat(64),"text":"forged"})
        )
        .is_err());
        let mut p:Presentation=serde_json::from_value(json!({"display_name":"Sean","bio":"","interests":[],"accent":"honey","collaborating":false,"links":[],"highlights":[],"avatar":null,"cover":null})).unwrap();
        assert!(validate(&p).is_ok());
        p.build_status = "x".repeat(121);
        assert!(validate(&p).is_err());
        p.build_status = "Building CreatorHive".into();
        p.build_url = "javascript:alert(1)".into();
        assert!(validate(&p).is_err());
        p.build_url = "https://creatorhive.ai".into();
        assert!(validate(&p).is_ok());
        p.build_status.clear();
        assert!(validate(&p).is_err());
        p.build_url.clear();
        p.bio = "x".repeat(321);
        assert!(validate(&p).is_err());
    }
}

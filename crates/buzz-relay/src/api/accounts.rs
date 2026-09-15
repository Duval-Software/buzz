//! Username/password login and migration of existing identities.
//! Passwords never enter Nostr events, logs, or persistent browser storage.
//! Login returns an encrypted identity vault; the browser unlocks it in memory.
use super::{api_error, bridge, internal_error};
use crate::state::AppState;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use buzz_core::TenantContext;
use buzz_db::account::Account;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, sync::Arc};

type ApiError = (StatusCode, Json<Value>);
// Bound expensive hashes before spawn_blocking; no unbounded work queue.
static PASSWORD_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Versioned, authenticated browser encryption envelope. Fixed parameters prevent downgrade.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vault {
    /// Envelope version; 1 means PBKDF2-SHA256/600000 plus AES-256-GCM.
    pub version: u8,
    /// Random 16-byte KDF salt, base64.
    pub salt: String,
    /// Random 12-byte GCM nonce, base64.
    pub iv: String,
    /// 32-byte secret plus 16-byte authentication tag, base64.
    pub ciphertext: String,
}

impl Vault {
    fn valid(&self) -> bool {
        self.version == 1
            && [(&self.salt, 16), (&self.iv, 12), (&self.ciphertext, 48)]
                .iter()
                .all(|(s, n)| STANDARD.decode(s).is_ok_and(|v| v.len() == *n))
    }
}

/// Credential creation or migration. Signed proof binds the full body to the existing identity.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRequest {
    /// Case-insensitive login name, 3–32 ASCII letters, numbers or underscores.
    pub username: String,
    /// Password, never serialized into events.
    pub password: String,
    /// Encrypted identity matching the request signer.
    pub vault: Vault,
}

/// Login credentials. The response is deliberately generic for unknown names and wrong passwords.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    /// Account's login name.
    pub username: String,
    /// Current password.
    pub password: String,
}

/// An authenticated password change also replaces the encrypted vault atomically.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordRequest {
    /// Login name.
    pub username: String,
    /// Current password, required even on an unlocked device.
    pub password: String,
    /// Replacement password.
    pub new_password: String,
    /// Vault encrypted under the replacement password.
    pub vault: Vault,
}

fn username(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Use 3–32 letters, numbers or underscores for your username.",
        ));
    }
    Ok(value)
}

fn password_valid(password: &str) -> Result<(), ApiError> {
    if password.chars().count() < 15 || password.len() > 256 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Use a password of at least 15 characters (up to 256 bytes).",
        ));
    }
    Ok(())
}

fn unauthorized() -> ApiError {
    api_error(
        StatusCode::UNAUTHORIZED,
        "Username or password is incorrect.",
    )
}

async fn hash_password(password: String, existing: Option<String>) -> Result<String, ApiError> {
    let permit = PASSWORD_WORK
        .try_acquire()
        .map_err(|_| api_error(StatusCode::TOO_MANY_REQUESTS, "Please try again shortly."))?;
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let argon = Argon2::default();
        if let Some(hash) = existing {
            let parsed = PasswordHash::new(&hash).map_err(|_| unauthorized())?;
            argon
                .verify_password(password.as_bytes(), &parsed)
                .map_err(|_| unauthorized())?;
            Ok(hash)
        } else {
            argon
                .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
                .map(|hash| hash.to_string())
                .map_err(|_| internal_error("password hash failed"))
        }
    })
    .await
    .map_err(|_| internal_error("password worker failed"))?;
    result
}

async fn context(
    state: &AppState,
    headers: &HeaderMap,
    peer: SocketAddr,
    name: &str,
) -> Result<TenantContext, ApiError> {
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "Community unavailable."))?;
    // Never use X-Forwarded-For without an explicit trusted-proxy configuration.
    let ip_bucket = format!("ip:{}", peer.ip());
    let user_bucket = format!("user:{}", hex::encode(Sha256::digest(name.as_bytes())));
    for (bucket, limit) in [(ip_bucket, 60), (user_bucket, 15)] {
        if !state
            .db
            .account_auth_allowed(tenant.community(), &bucket, limit)
            .await
            .map_err(|_| internal_error("account rate limit unavailable"))?
        {
            return Err(api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts. Try again in 15 minutes.",
            ));
        }
    }
    Ok(tenant)
}

async fn proof(
    state: &AppState,
    tenant: &TenantContext,
    headers: &HeaderMap,
    path: &str,
    body: &[u8],
) -> Result<String, ApiError> {
    let url = bridge::nip98_expected_url(&state.config.relay_url, tenant, path);
    let (key, event) =
        bridge::verify_bridge_auth_with_options(headers, "POST", &url, Some(body), true, true)?;
    bridge::check_nip98_replay(state, tenant, event).await?;
    Ok(key.to_hex())
}

async fn response(
    state: &AppState,
    tenant: &TenantContext,
    account: &Account,
) -> Result<Response, ApiError> {
    use argon2::password_hash::rand_core::RngCore;
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    if !state
        .db
        .create_account_session(tenant.community(), account, &hash)
        .await
        .map_err(|_| internal_error("session creation failed"))?
    {
        return Err(unauthorized());
    }
    Ok(([("cache-control","no-store")],Json(json!({"username":account.username,"pubkey":account.pubkey,"vault":account.vault,"session_token":token}))).into_response())
}

/// Hash a single bounded session tag; tokens never enter the event store.
pub(crate) fn session_hash(event: &nostr::Event) -> Option<String> {
    let mut tags = event.tags.iter().filter(|tag| {
        tag.as_slice()
            .first()
            .is_some_and(|s| s == "account-session")
    });
    let tag = tags.next()?.as_slice();
    if tags.next().is_some()
        || tag.len() != 2
        || tag[1].len() != 64
        || !tag[1].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    Some(hex::encode(Sha256::digest(tag[1].as_bytes())))
}

/// A delegated agent cannot bypass its credential owner's login by presenting a fresh key.
pub(crate) async fn has_account_session(
    state: &AppState,
    tenant: &TenantContext,
    actor: &nostr::PublicKey,
    owner: Option<&nostr::PublicKey>,
    hash: Option<&str>,
) -> bool {
    if super::managed_identity::enabled() {
        // No legacy-key fallback in managed communities. Hosted agents have
        // registry authority, never the owner's signing or administration access.
        if let Some(hash) = hash {
            return owner.is_none()
                && state
                    .db
                    .managed_pubkey_session_active(tenant.community(), &actor.to_hex(), hash)
                    .await
                    .unwrap_or(false);
        }
        return owner.is_none()
            && state
                .db
                .managed_hosted_agent_active(tenant.community(), &actor.to_hex())
                .await
                .unwrap_or(false);
    }
    for key in std::iter::once(actor).chain(owner) {
        if !state
            .db
            .account_session_allowed(tenant.community(), &key.to_hex(), hash)
            .await
            .unwrap_or(false)
        {
            return false;
        }
    }
    true
}

/// Central HTTP guard: possessing an old messaging key alone cannot bypass credential login.
pub async fn session_guard(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    if super::managed_identity::enabled() && request.uri().path().starts_with("/api/accounts/") {
        return api_error(StatusCode::GONE, "Use your CreatorHive account to sign in.")
            .into_response();
    }
    if matches!(
        request.uri().path(),
        "/api/accounts/register" | "/api/accounts/login" | "/api/accounts/password"
    ) {
        return next.run(request).await;
    }
    let event = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Nostr "))
        .and_then(|header| {
            STANDARD
                .decode(header)
                .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(header))
                .ok()
        })
        .and_then(|bytes| serde_json::from_slice::<nostr::Event>(&bytes).ok());
    // The development X-Pubkey shortcut must not bypass a migrated account's session either.
    let actor = event.as_ref().map(|e| e.pubkey.to_hex()).or_else(|| {
        request
            .headers()
            .get("x-pubkey")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned)
    });
    if let Some(actor) = actor {
        let host = request
            .headers()
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let hash = event.as_ref().and_then(session_hash);
        let event_auth = event
            .as_ref()
            .and_then(crate::handlers::auth::extract_auth_tag_json);
        let auth = event_auth.as_deref().or_else(|| {
            request
                .headers()
                .get("x-auth-tag")
                .and_then(|h| h.to_str().ok())
        });
        let allowed = match (
            crate::tenant::bind_community(&state.db, host).await,
            nostr::PublicKey::from_hex(&actor),
        ) {
            (Ok(tenant), Ok(actor)) => {
                let owner = super::relay_members::extract_nip_oa_owner(actor.as_bytes(), auth);
                has_account_session(&state, &tenant, &actor, owner.as_ref(), hash.as_deref()).await
            }
            _ => false,
        };
        if !allowed {
            return api_error(StatusCode::UNAUTHORIZED, "Session expired. Sign in again.")
                .into_response();
        }
    }
    next.run(request).await
}

/// Revoke the device session after a signed logout request.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| unauthorized())?;
    proof(&state, &tenant, &headers, "/api/accounts/logout", &body).await?;
    let event: nostr::Event = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Nostr "))
        .and_then(|s| STANDARD.decode(s).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(unauthorized)?;
    let hash = session_hash(&event).ok_or_else(unauthorized)?;
    state
        .db
        .revoke_account_session(tenant.community(), &hash)
        .await
        .map_err(|_| internal_error("logout failed"))?;
    Ok((
        [("cache-control", "no-store")],
        Json(json!({"signed_out":true})),
    )
        .into_response())
}

/// Register a login, proving ownership of the underlying messaging identity.
pub async fn register(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let request: RegisterRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid account request."))?;
    let name = username(&request.username)?;
    password_valid(&request.password)?;
    if !request.vault.valid() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid account backup.",
        ));
    }
    let tenant = context(&state, &headers, peer, &name).await?;
    let pubkey = proof(&state, &tenant, &headers, "/api/accounts/register", &body).await?;
    let account = Account {
        username: name,
        pubkey,
        password_hash: hash_password(request.password, None).await?,
        vault: serde_json::to_value(request.vault)
            .map_err(|_| internal_error("vault encoding failed"))?,
    };
    if !state
        .db
        .create_account(tenant.community(), &account)
        .await
        .map_err(|_| internal_error("account creation failed"))?
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "That username or account is already registered. Sign in or choose another username.",
        ));
    }
    response(&state, &tenant, &account).await
}

async fn authenticate(
    state: &AppState,
    tenant: &TenantContext,
    name: &str,
    password: String,
) -> Result<Account, ApiError> {
    let account = state
        .db
        .account(tenant.community(), name)
        .await
        .map_err(|_| internal_error("account lookup failed"))?;
    if let Some(account) = account {
        hash_password(password, Some(account.password_hash.clone())).await?;
        Ok(account)
    } else {
        // Spend the same expensive work on unknown usernames; never reveal account existence.
        hash_password(password, None).await?;
        Err(unauthorized())
    }
}

/// Authenticate a member's credentials without granting or restoring revoked membership.
pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let name = username(&request.username)?;
    if request.password.len() > 256 {
        return Err(unauthorized());
    }
    let tenant = context(&state, &headers, peer, &name).await?;
    let account = authenticate(&state, &tenant, &name, request.password).await?;
    response(&state, &tenant, &account).await
}

/// Change credentials using both the current password and proof of the account identity.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let request: ChangePasswordRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid account request."))?;
    let name = username(&request.username)?;
    password_valid(&request.new_password)?;
    if request.password.len() > 256 || !request.vault.valid() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid account request.",
        ));
    }
    let tenant = context(&state, &headers, peer, &name).await?;
    let pubkey = proof(&state, &tenant, &headers, "/api/accounts/password", &body).await?;
    let mut account = authenticate(&state, &tenant, &name, request.password).await?;
    if pubkey != account.pubkey {
        return Err(unauthorized());
    }
    let old_hash = account.password_hash;
    account.password_hash = hash_password(request.new_password, None).await?;
    account.vault =
        serde_json::to_value(request.vault).map_err(|_| internal_error("vault encoding failed"))?;
    if !state
        .db
        .change_account_password(tenant.community(), &account, &old_hash)
        .await
        .map_err(|_| internal_error("password update failed"))?
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "Account changed. Sign in again.",
        ));
    }
    response(&state, &tenant, &account).await
}

/// Resolve a login name for access management. Only an existing community owner/admin can look up nonmembers.
pub async fn resolve(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Lookup {
        username: String,
    }
    let request: Lookup = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid username."))?;
    let name = username(&request.username)?;
    let tenant = context(&state, &headers, peer, &name).await?;
    let actor = proof(&state, &tenant, &headers, "/api/accounts/resolve", &body).await?;
    let actor_key = nostr::PublicKey::from_hex(&actor).map_err(|_| unauthorized())?;
    if state
        .db
        .moderation_restriction_state(tenant.community(), actor_key.as_bytes())
        .await
        .map_err(|_| internal_error("account access check failed"))?
        .banned
    {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Community access unavailable.",
        ));
    }
    let member = state
        .db
        .get_relay_member(tenant.community(), &actor)
        .await
        .map_err(|_| internal_error("account lookup permission failed"))?;
    if !member.is_some_and(|m| matches!(m.role.as_str(), "owner" | "admin")) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Only community owners and admins can look up accounts.",
        ));
    }
    let account = state
        .db
        .account(tenant.community(), &name)
        .await
        .map_err(|_| internal_error("account lookup failed"))?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "No account with that username in this community.",
            )
        })?;
    Ok((
        [("cache-control", "no-store")],
        Json(json!({"username":account.username,"pubkey":account.pubkey})),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request},
    };
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use tower::ServiceExt;

    #[tokio::test]
    async fn credentials_validate_and_password_verifiers_are_salted() {
        assert_eq!(username("  Sean_1 ").unwrap(), "sean_1");
        for value in ["ab", "séán", "a b", "a/b", "<script>"] {
            assert!(username(value).is_err());
        }
        assert!(password_valid("too short").is_err());
        assert!(password_valid(&"x".repeat(257)).is_err());
        let password = "correct horse studio hive".to_string();
        let hash = hash_password(password.clone(), None).await.unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert_ne!(hash, hash_password(password.clone(), None).await.unwrap());
        assert!(hash_password(password, Some(hash.clone())).await.is_ok());
        assert_eq!(
            hash_password("wrong".into(), Some(hash))
                .await
                .unwrap_err()
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert!(!Vault {
            version: 1,
            salt: "bad".into(),
            iv: "bad".into(),
            ciphertext: "bad".into()
        }
        .valid());
    }

    async fn post(
        state: Arc<AppState>,
        host: &str,
        path: &str,
        payload: Value,
        keys: Option<&Keys>,
    ) -> (StatusCode, Value) {
        post_session(state, host, path, payload, keys, None).await
    }

    async fn post_session(
        state: Arc<AppState>,
        host: &str,
        path: &str,
        payload: Value,
        keys: Option<&Keys>,
        session: Option<&str>,
    ) -> (StatusCode, Value) {
        let body = payload.to_string();
        let mut builder = Request::builder()
            .method("POST")
            .uri(path)
            .header(header::HOST, host)
            .header(header::CONTENT_TYPE, "application/json")
            .extension(ConnectInfo("127.0.0.1:4321".parse::<SocketAddr>().unwrap()));
        if let Some(keys) = keys {
            let mut tags = vec![
                Tag::parse(["u", &format!("https://{host}{path}")]).unwrap(),
                Tag::parse(["method", "POST"]).unwrap(),
                Tag::parse(["payload", &hex::encode(Sha256::digest(body.as_bytes()))]).unwrap(),
                Tag::parse(["nonce", &uuid::Uuid::new_v4().to_string()]).unwrap(),
            ];
            if let Some(token) = session {
                tags.push(Tag::parse(["account-session", token]).unwrap());
            }
            let event = EventBuilder::new(Kind::HttpAuth, "")
                .tags(tags)
                .sign_with_keys(keys)
                .unwrap();
            builder = builder.header(
                header::AUTHORIZATION,
                format!(
                    "Nostr {}",
                    STANDARD.encode(serde_json::to_vec(&event).unwrap())
                ),
            );
        }
        let response = crate::router::build_router(state)
            .oneshot(builder.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = response.status();
        if status.is_success() {
            assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        }
        let body = to_bytes(response.into_body(), 8192).await.unwrap();
        (
            status,
            serde_json::from_slice(&body).unwrap_or_else(|_| json!({"non_json":true})),
        )
    }

    #[tokio::test]
    #[ignore = "requires isolated migrated Postgres via BUZZ_TEST_DATABASE_URL"]
    async fn account_lifecycle_is_durable_scoped_and_never_grants_membership() {
        let host = format!("accounts-{}.test", uuid::Uuid::new_v4());
        let state = crate::api::invites::tests::invite_test_state(&host)
            .await
            .expect("isolated Postgres required");
        let tenant = crate::tenant::bind_community(&state.db, &host)
            .await
            .unwrap();
        let keys = Keys::generate();
        let other = Keys::generate();
        let vault = json!({"version":1,"salt":STANDARD.encode([1u8;16]),"iv":STANDARD.encode([2u8;12]),"ciphertext":STANDARD.encode([3u8;48])});
        let registration =
            json!({"username":"Sean","password":"correct horse studio hive","vault":vault});
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/register",
                registration.clone(),
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, created) = post(
            state.clone(),
            &host,
            "/api/accounts/register",
            registration.clone(),
            Some(&keys),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{created}");
        assert_eq!(created["username"], "sean");
        assert_eq!(created["pubkey"], keys.public_key().to_hex());
        assert!(created.get("password_hash").is_none());
        assert!(!state
            .db
            .is_relay_member(tenant.community(), &keys.public_key().to_hex())
            .await
            .unwrap());
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/register",
                registration.clone(),
                Some(&other)
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        let mut duplicate = registration.clone();
        duplicate["username"] = json!("second_name");
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/register",
                duplicate,
                Some(&keys)
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        let credentials = json!({"username":"SEAN","password":"correct horse studio hive"});
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/login",
                credentials.clone(),
                None
            )
            .await
            .1["pubkey"],
            created["pubkey"]
        );
        let wrong = post(
            state.clone(),
            &host,
            "/api/accounts/login",
            json!({"username":"sean","password":"wrong"}),
            None,
        )
        .await;
        let unknown = post(
            state.clone(),
            &host,
            "/api/accounts/login",
            json!({"username":"unknown","password":"wrong"}),
            None,
        )
        .await;
        assert_eq!(wrong, unknown);
        let host_b = format!("other-{}.test", uuid::Uuid::new_v4());
        state.db.ensure_configured_community(&host_b).await.unwrap();
        assert_eq!(
            post(
                state.clone(),
                &host_b,
                "/api/accounts/login",
                credentials.clone(),
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/resolve",
                json!({"username":"sean"}),
                Some(&keys)
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let change = json!({"username":"sean","password":"correct horse studio hive","new_password":"another secure studio password","vault":vault});
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/password",
                change.clone(),
                Some(&other)
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/password",
                change,
                Some(&keys)
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/login",
                credentials,
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            post(
                state.clone(),
                &host,
                "/api/accounts/login",
                json!({"username":"sean","password":"another secure studio password"}),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        assert!(
            !has_account_session(
                &state,
                &tenant,
                &other.public_key(),
                Some(&keys.public_key()),
                None
            )
            .await,
            "a delegated key must not bypass its owner's credentials"
        );
        let old_token = created["session_token"].as_str().unwrap();
        let old_hash = hex::encode(Sha256::digest(old_token.as_bytes()));
        assert!(!state
            .db
            .account_session_allowed(
                tenant.community(),
                &keys.public_key().to_hex(),
                Some(&old_hash)
            )
            .await
            .unwrap());
        assert!(!state
            .db
            .account_session_allowed(tenant.community(), &keys.public_key().to_hex(), None)
            .await
            .unwrap());
        let (_, fresh) = post(
            state.clone(),
            &host,
            "/api/accounts/login",
            json!({"username":"sean","password":"another secure studio password"}),
            None,
        )
        .await;
        let token = fresh["session_token"].as_str().unwrap();
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        assert!(state
            .db
            .account_session_allowed(tenant.community(), &keys.public_key().to_hex(), Some(&hash))
            .await
            .unwrap());
        assert!(
            has_account_session(
                &state,
                &tenant,
                &other.public_key(),
                Some(&keys.public_key()),
                Some(&hash)
            )
            .await
        );
        assert_eq!(
            post_session(
                state.clone(),
                &host,
                "/api/accounts/resolve",
                json!({"username":"sean"}),
                Some(&keys),
                Some(token)
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            post_session(
                state.clone(),
                &host,
                "/api/accounts/logout",
                json!({}),
                Some(&keys),
                Some(token)
            )
            .await
            .0,
            StatusCode::OK
        );
        assert!(!state
            .db
            .account_session_allowed(tenant.community(), &keys.public_key().to_hex(), Some(&hash))
            .await
            .unwrap());
        let stored = state
            .db
            .account(tenant.community(), "sean")
            .await
            .unwrap()
            .unwrap();
        assert!(stored.password_hash.starts_with("$argon2id$"));
        assert!(!state
            .db
            .is_relay_member(tenant.community(), &keys.public_key().to_hex())
            .await
            .unwrap());
        assert!(state
            .db
            .account_auth_allowed(tenant.community(), "test-limit", 1)
            .await
            .unwrap());
        assert!(!state
            .db
            .account_auth_allowed(tenant.community(), "test-limit", 1)
            .await
            .unwrap());
        let bucket = format!("user:{}", hex::encode(Sha256::digest(b"rate_target")));
        for _ in 0..15 {
            assert!(state
                .db
                .account_auth_allowed(tenant.community(), &bucket, 15)
                .await
                .unwrap());
        }
        let (status, _) = post(
            state,
            &host,
            "/api/accounts/login",
            json!({"username":"rate_target","password":"wrong"}),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }
    #[tokio::test]
    #[ignore = "requires isolated migrated Postgres via BUZZ_TEST_DATABASE_URL"]
    async fn active_websocket_requires_and_rechecks_credential_session() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
        let host = format!("account-ws-{}.test", uuid::Uuid::new_v4());
        let state = crate::api::invites::tests::invite_test_state(&host)
            .await
            .expect("isolated Postgres required");
        let tenant = crate::tenant::bind_community(&state.db, &host)
            .await
            .unwrap();
        let keys = Keys::generate();
        let (_,account) = post(state.clone(),&host,"/api/accounts/register",json!({"username":"socket_member","password":"correct horse studio hive","vault":{"version":1,"salt":STANDARD.encode([1u8;16]),"iv":STANDARD.encode([2u8;12]),"ciphertext":STANDARD.encode([3u8;48])}}),Some(&keys)).await;
        let token = account["session_token"].as_str().unwrap();
        state
            .db
            .add_relay_member(
                tenant.community(),
                &keys.public_key().to_hex(),
                "member",
                None,
            )
            .await
            .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = crate::router::build_router(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        for with_session in [false, true] {
            let mut request = format!("ws://{address}/").into_client_request().unwrap();
            request.headers_mut().insert("host", host.parse().unwrap());
            let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            let challenge = ws.next().await.unwrap().unwrap().into_text().unwrap();
            let challenge: Value = serde_json::from_str(&challenge).unwrap();
            let mut tags = vec![
                Tag::parse(["relay", &format!("wss://{host}")]).unwrap(),
                Tag::parse(["challenge", challenge[1].as_str().unwrap()]).unwrap(),
            ];
            if with_session {
                tags.push(Tag::parse(["account-session", token]).unwrap());
            }
            let event = EventBuilder::new(Kind::Authentication, "")
                .tags(tags)
                .sign_with_keys(&keys)
                .unwrap();
            ws.send(Message::Text(json!(["AUTH", event]).to_string().into()))
                .await
                .unwrap();
            let reply = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop {
                    let message = ws.next().await.unwrap().unwrap();
                    let Message::Text(text) = message else {
                        continue;
                    };
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value[0] == "OK" {
                        break value;
                    }
                }
            })
            .await
            .unwrap();
            assert_eq!(reply[2], with_session, "{reply}");
            if with_session {
                let private_auth = EventBuilder::new(Kind::TextNote, "not publishable")
                    .tags([Tag::parse(["account-session", token]).unwrap()])
                    .sign_with_keys(&keys)
                    .unwrap();
                // Test the shared storage boundary directly; the separate WebSocket
                // EVENT rate limiter needs Redis, while this fixture uses isolated Postgres.
                let rejected = crate::handlers::ingest::ingest_event(
                    &state,
                    &tenant,
                    private_auth,
                    crate::handlers::ingest::IngestAuth::Nip42 {
                        pubkey: keys.public_key(),
                        scopes: vec![],
                        channel_ids: None,
                        conn_id: uuid::Uuid::new_v4(),
                    },
                )
                .await;
                assert!(
                    matches!(rejected,Err(crate::handlers::ingest::IngestError::Rejected(reason)) if reason.contains("AUTH events cannot be submitted"))
                );
                state
                    .db
                    .revoke_account_session(
                        tenant.community(),
                        &hex::encode(Sha256::digest(token.as_bytes())),
                    )
                    .await
                    .unwrap();
                tokio::time::timeout(std::time::Duration::from_secs(7), async {
                    loop {
                        match ws.next().await {
                            None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                            _ => {}
                        }
                    }
                })
                .await
                .expect("revoked connection must close within five seconds");
            }
        }
        server.abort();
    }
}

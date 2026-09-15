//! Supabase account authentication and server-owned identity encryption.
//! No private identity material or Supabase service-role credential reaches a client.
use super::{api_error, internal_error};
use crate::state::AppState;
use axum::{
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use buzz_core::TenantContext;
use buzz_db::managed_account::ManagedAccount;
use chrono::{DateTime, Utc};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

pub(super) type ApiError = (StatusCode, Json<Value>);

pub(super) fn denied() -> ApiError {
    api_error(
        StatusCode::UNAUTHORIZED,
        "Your session has expired. Please sign in again.",
    )
}

/// Whether this deployment exclusively uses managed member accounts.
pub fn enabled() -> bool {
    std::env::var("BUZZ_MANAGED_ACCOUNTS").is_ok_and(|v| v == "true")
}

pub(super) fn configuration(name: &str) -> Result<String, ApiError> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| internal_error("Account service is not configured"))
}

/// Claims are used only AFTER the exact token has been verified by Supabase Auth.
#[derive(Deserialize)]
pub(super) struct Claims {
    pub sub: Uuid,
    pub session_id: Uuid,
    pub exp: i64,
    iss: String,
    aud: Value,
    #[serde(default)]
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct VerifiedUser {
    id: Uuid,
    email_confirmed_at: Option<String>,
}

pub(super) async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(TenantContext, Claims), ApiError> {
    if !enabled() {
        return Err(api_error(StatusCode::NOT_FOUND, "Not found"));
    }
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|t| t.len() <= 8192)
        .ok_or_else(denied)?;
    let base = configuration("SUPABASE_URL")?;
    let url = url::Url::parse(&base)
        .map_err(|_| internal_error("Invalid account service configuration"))?;
    if url.scheme() != "https"
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(internal_error("Account service requires a secure origin"));
    }
    // getUser performs Supabase's JWT signature and expiry verification. No
    // locally decoded claims authorize anything without this network check.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| internal_error("Account service unavailable"))?;
    let response = client
        .get(format!("{}/auth/v1/user", base.trim_end_matches('/')))
        .header("apikey", configuration("SUPABASE_PUBLISHABLE_KEY")?)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| internal_error("Account service unavailable. Please retry."))?;
    if !response.status().is_success() {
        return Err(denied());
    }
    let user: VerifiedUser = response.json().await.map_err(|_| denied())?;
    let segments: Vec<_> = token.split('.').collect();
    if segments.len() != 3 {
        return Err(denied());
    }
    let claims: Claims =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(segments[1]).map_err(|_| denied())?)
            .map_err(|_| denied())?;
    let audience_ok = claims.aud == "authenticated"
        || claims
            .aud
            .as_array()
            .is_some_and(|a| a.len() == 1 && a[0] == "authenticated");
    if claims.sub != user.id
        || user.email_confirmed_at.is_none()
        || claims.exp <= Utc::now().timestamp()
        || claims.iss != format!("{}/auth/v1", base.trim_end_matches('/'))
        || !audience_ok
        || claims.client_id.is_some()
        || !state
            .db
            .managed_session_active(claims.sub, claims.session_id)
            .await
            .map_err(|_| internal_error("Account validation unavailable"))?
    {
        return Err(denied());
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(denied)?;
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| denied())?;
    Ok((tenant, claims))
}

fn encryption_key(version: i32) -> Result<aead::LessSafeKey, ApiError> {
    if version < 1 {
        return Err(internal_error("Identity key unavailable"));
    }
    let encoded = Zeroizing::new(configuration(&format!("BUZZ_IDENTITY_KEY_V{version}"))?);
    let bytes = Zeroizing::new(
        hex::decode(encoded.as_str()).map_err(|_| internal_error("Identity key unavailable"))?,
    );
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
            .map_err(|_| internal_error("Identity key unavailable"))?,
    ))
}

fn aad(community: Uuid, account: &ManagedAccount) -> String {
    format!(
        "creatorhive:identity:{community}:{}:{}:{}",
        account.account_id, account.pubkey, account.key_version
    )
}

pub(super) fn generate(community: Uuid, account_id: Uuid) -> Result<ManagedAccount, ApiError> {
    let keys = nostr::Keys::generate();
    let key_version: i32 = configuration("BUZZ_IDENTITY_KEY_VERSION")?
        .parse()
        .map_err(|_| internal_error("Identity key unavailable"))?;
    let mut account = ManagedAccount {
        account_id,
        pubkey: keys.public_key().to_hex(),
        key_version,
        sealed_secret: vec![],
    };
    let key = encryption_key(key_version)?;
    seal_account(community, &mut account, &keys, &key)?;
    Ok(account)
}

fn seal_account(
    community: Uuid,
    account: &mut ManagedAccount,
    keys: &nostr::Keys,
    key: &aead::LessSafeKey,
) -> Result<(), ApiError> {
    let mut nonce = [0u8; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| internal_error("Identity creation unavailable"))?;
    let mut plaintext = Zeroizing::new(keys.secret_key().to_secret_bytes().to_vec());
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(aad(community, account)),
        &mut *plaintext,
    )
    .map_err(|_| internal_error("Identity creation unavailable"))?;
    account.sealed_secret = [nonce.as_slice(), plaintext.as_slice()].concat();
    Ok(())
}

pub(super) fn decrypt(community: Uuid, account: &ManagedAccount) -> Result<nostr::Keys, ApiError> {
    let key = encryption_key(account.key_version)?;
    decrypt_with_key(community, account, &key)
}

fn decrypt_with_key(
    community: Uuid,
    account: &ManagedAccount,
    key: &aead::LessSafeKey,
) -> Result<nostr::Keys, ApiError> {
    let nonce: [u8; 12] = account
        .sealed_secret
        .get(..12)
        .and_then(|n| n.try_into().ok())
        .ok_or_else(|| internal_error("Identity unavailable"))?;
    let mut ciphertext = Zeroizing::new(
        account
            .sealed_secret
            .get(12..)
            .ok_or_else(|| internal_error("Identity unavailable"))?
            .to_vec(),
    );
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(community, account)),
            &mut ciphertext,
        )
        .map_err(|_| internal_error("Identity unavailable"))?;
    let secret = nostr::SecretKey::from_slice(plaintext)
        .map_err(|_| internal_error("Identity unavailable"))?;
    let keys = nostr::Keys::new(secret);
    if keys.public_key().to_hex() != account.pubkey {
        return Err(internal_error("Identity unavailable"));
    }
    Ok(keys)
}

pub(super) fn token() -> Result<String, ApiError> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| internal_error("Session unavailable"))?;
    Ok(hex::encode(bytes))
}

pub(super) fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub(super) fn expiry(claims: &Claims) -> Result<DateTime<Utc>, ApiError> {
    DateTime::from_timestamp(claims.exp, 0).ok_or_else(denied)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_envelope_is_bound_to_community_account_version_and_public_key() {
        let key = aead::LessSafeKey::new(
            aead::UnboundKey::new(&aead::AES_256_GCM, &[7; 32]).expect("key"),
        );
        let keys = nostr::Keys::generate();
        let community = Uuid::new_v4();
        let mut account = ManagedAccount {
            account_id: Uuid::new_v4(),
            pubkey: keys.public_key().to_hex(),
            key_version: 1,
            sealed_secret: vec![],
        };
        seal_account(community, &mut account, &keys, &key).expect("seal");
        assert_eq!(account.sealed_secret.len(), 60);
        assert_eq!(
            decrypt_with_key(community, &account, &key)
                .expect("decrypt")
                .public_key(),
            keys.public_key()
        );
        assert!(decrypt_with_key(Uuid::new_v4(), &account, &key).is_err());
        let account_id = account.account_id;
        account.account_id = Uuid::new_v4();
        assert!(decrypt_with_key(community, &account, &key).is_err());
        account.account_id = account_id;
        account.key_version = 2;
        assert!(decrypt_with_key(community, &account, &key).is_err());
        account.key_version = 1;
        account.sealed_secret[20] ^= 1;
        assert!(decrypt_with_key(community, &account, &key).is_err());
    }
}

//! Narrow portfolio persistence. Private account/preferences tables are never serialized.
use crate::{Db, DbError, Result};
use buzz_core::CommunityId;
use serde_json::{json, Value};
use uuid::Uuid;

impl Db {
    /// Read only explicitly published presentation fields; members may read member-only pages.
    pub async fn public_profile(
        &self,
        community: CommunityId,
        handle: &str,
        viewer: Option<Uuid>,
    ) -> Result<Option<Value>> {
        let row: Option<(Uuid,String,String,String,bool,Value)> = sqlx::query_as(
            "SELECT a.account_id,a.pubkey,m.username,p.visibility,p.published,p.presentation FROM profile_pages p JOIN managed_accounts a USING(community_id,account_id) JOIN member_profiles m ON m.account_id=a.account_id JOIN relay_members r ON r.community_id=a.community_id AND r.pubkey=a.pubkey WHERE p.community_id=$1 AND m.username=$2 AND (p.published OR a.account_id=$3) AND (p.visibility='public' OR $3 IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=a.community_id AND b.pubkey=decode(a.pubkey,'hex') AND b.banned) AND NOT EXISTS(SELECT 1 FROM moderation_rename_holds h WHERE h.community_id=a.community_id AND h.pubkey=decode(a.pubkey,'hex') AND h.required)")
            .bind(community.as_uuid()).bind(handle).bind(viewer).fetch_optional(&self.pool).await?;
        let Some((account, author, username, visibility, published, mut data)) = row else {
            return Ok(None);
        };
        let mut highlights = Vec::new();
        for highlight in data["highlights"].as_array().into_iter().flatten() {
            if highlight["kind"] == "pulse" {
                let note: Option<Value> = sqlx::query_scalar("SELECT profile_pulse($1,$2,$3)")
                    .bind(community.as_uuid())
                    .bind(&author)
                    .bind(highlight["event_id"].as_str().unwrap_or(""))
                    .fetch_one(&self.pool)
                    .await?;
                if let Some(note) = note {
                    highlights.push(note);
                }
            } else {
                highlights.push(highlight.clone());
            }
        }
        data["highlights"] = json!(highlights);
        data["username"] = json!(username);
        data["visibility"] = json!(visibility);
        data["published"] = json!(published);
        data["owner"] = json!(viewer == Some(account));
        if viewer.is_some() {
            data["member_key"] = json!(author);
        }
        Ok(Some(data))
    }

    /// Get the owner's editable document, including source IDs for featured notes.
    pub async fn own_public_profile(&self, community: CommunityId, account: Uuid) -> Result<Value> {
        let (username, name): (String, String) =
            sqlx::query_as("SELECT username,display_name FROM member_profiles WHERE account_id=$1")
                .bind(account)
                .fetch_one(&self.pool)
                .await?;
        let row: Option<(bool,String,Value)>=sqlx::query_as("SELECT published,visibility,presentation FROM profile_pages WHERE community_id=$1 AND account_id=$2").bind(community.as_uuid()).bind(account).fetch_optional(&self.pool).await?;
        let (published,visibility,mut data)=row.unwrap_or((false,"public".into(),json!({"display_name":name,"bio":"","interests":[],"links":[],"highlights":[],"accent":"honey","collaborating":false,"avatar":null,"cover":null})));
        data["username"] = json!(username);
        data["published"] = json!(published);
        data["visibility"] = json!(visibility);
        Ok(data)
    }

    /// Save a validated presentation atomically after checking its backing assets and notes.
    pub async fn save_public_profile(
        &self,
        community: CommunityId,
        account: Uuid,
        session: Uuid,
        published: bool,
        visibility: &str,
        data: Value,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let author: Option<String>=sqlx::query_scalar("SELECT a.pubkey FROM managed_accounts a JOIN relay_members r ON r.community_id=a.community_id AND r.pubkey=a.pubkey JOIN member_profiles m ON m.account_id=a.account_id WHERE a.community_id=$1 AND a.account_id=$2 AND managed_auth_session_active($2,$3) AND NOT EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=a.community_id AND b.pubkey=decode(a.pubkey,'hex') AND b.banned) AND NOT EXISTS(SELECT 1 FROM moderation_rename_holds h WHERE h.community_id=a.community_id AND h.pubkey=decode(a.pubkey,'hex') AND h.required) FOR UPDATE OF a")
            .bind(community.as_uuid()).bind(account).bind(session).fetch_optional(&mut *tx).await?;
        let author =
            author.ok_or_else(|| DbError::InvalidData("Profile access unavailable".into()))?;
        sqlx::query("SELECT moderation_check_text($1,$2)")
            .bind(community.as_uuid())
            .bind(data.to_string())
            .execute(&mut *tx)
            .await?;
        for id in [data["avatar"].as_str(), data["cover"].as_str()]
            .into_iter()
            .flatten()
            .chain(
                data["highlights"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|h| h["image"].as_str()),
            )
        {
            let id =
                Uuid::parse_str(id).map_err(|_| DbError::InvalidData("Invalid image".into()))?;
            let owned:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_images WHERE community_id=$1 AND account_id=$2 AND id=$3)").bind(community.as_uuid()).bind(account).bind(id).fetch_one(&mut *tx).await?;
            if !owned {
                return Err(DbError::InvalidData("Image unavailable".into()));
            }
        }
        for highlight in data["highlights"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|h| h["kind"] == "pulse")
        {
            let note: Option<Value> = sqlx::query_scalar("SELECT profile_pulse($1,$2,$3)")
                .bind(community.as_uuid())
                .bind(&author)
                .bind(highlight["event_id"].as_str().unwrap_or(""))
                .fetch_one(&mut *tx)
                .await?;
            if note.is_none() {
                return Err(DbError::InvalidData(
                    "That Pulse post cannot be featured".into(),
                ));
            }
        }
        sqlx::query("INSERT INTO profile_pages(community_id,account_id,published,visibility,presentation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(community_id,account_id) DO UPDATE SET published=EXCLUDED.published,visibility=EXCLUDED.visibility,presentation=EXCLUDED.presentation,updated_at=now()")
            .bind(community.as_uuid()).bind(account).bind(published).bind(visibility).bind(data).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Resolve usernames from verified member keys, or search named members without private fields.
    pub async fn profile_members(&self, community: CommunityId, query: &str) -> Result<Vec<Value>> {
        Ok(sqlx::query_scalar("SELECT jsonb_build_object('username',m.username,'display_name',m.display_name) FROM managed_accounts a JOIN member_profiles m ON m.account_id=a.account_id JOIN relay_members r ON r.community_id=a.community_id AND r.pubkey=a.pubkey WHERE a.community_id=$1 AND (a.pubkey=$2 OR position(lower($2) IN m.username)>0 OR position(lower($2) IN lower(m.display_name))>0) AND NOT EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=a.community_id AND b.pubkey=decode(a.pubkey,'hex') AND b.banned) ORDER BY m.username LIMIT 20").bind(community.as_uuid()).bind(query).fetch_all(&self.pool).await?)
    }

    /// Register a sanitized variant after writing it to retained media storage.
    pub async fn add_profile_image(
        &self,
        community: CommunityId,
        account: Uuid,
        id: Uuid,
    ) -> Result<()> {
        sqlx::query("INSERT INTO profile_images(community_id,account_id,id) VALUES($1,$2,$3)")
            .bind(community.as_uuid())
            .bind(account)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// A variant is readable only by its owner or while referenced by a visible profile.
    pub async fn profile_image_account(
        &self,
        community: CommunityId,
        id: Uuid,
    ) -> Result<Option<(Uuid, String)>> {
        Ok(sqlx::query_as("SELECT i.account_id,m.username FROM profile_images i JOIN member_profiles m USING(account_id) WHERE i.community_id=$1 AND i.id=$2").bind(community.as_uuid()).bind(id).fetch_optional(&self.pool).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Run against an isolated local database initialized with the normal schema,
    /// Supabase account fixture, and migration 0033; never a deployed database.
    #[tokio::test]
    #[ignore = "requires CREATORHIVE_PROFILE_TEST_DATABASE_URL"]
    async fn profile_privacy_and_source_ownership() {
        let url = std::env::var("CREATORHIVE_PROFILE_TEST_DATABASE_URL").unwrap();
        assert!(url.contains("127.0.0.1") && url.contains("creatorhive_public_profiles"));
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .after_connect(|c, _| {
                Box::pin(async move {
                    sqlx::query("SET search_path=buzz,public")
                        .execute(c)
                        .await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await
            .unwrap();
        let db = Db::from_pool(pool.clone());
        let id = Uuid::new_v4();
        let community = CommunityId::from_uuid(id);
        let account = Uuid::new_v4();
        let session = Uuid::new_v4();
        let author = "a1".repeat(32);
        let handle = format!("p{}", &account.simple().to_string()[..12]);
        sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
            .bind(id)
            .bind(format!("{id}.invalid"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())")
            .bind(account)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO managed_accounts(community_id,account_id,pubkey,key_version,sealed_secret) VALUES($1,$2,$3,1,$4)").bind(id).bind(account).bind(&author).bind(vec![0u8;60]).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'member')")
            .bind(id)
            .bind(&author)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO member_profiles(account_id,username,display_name,working_on) VALUES($1,$2,'A creator','PRIVATE onboarding answer')").bind(account).bind(&handle).execute(&pool).await.unwrap();
        let data = json!({"display_name":"A creator","bio":"Build things","accent":"honey","interests":[],"links":[],"highlights":[],"avatar":null,"cover":null,"collaborating":false});
        assert!(
            !db.own_public_profile(community, account).await.unwrap()["published"]
                .as_bool()
                .unwrap()
        );
        assert!(db
            .public_profile(community, &handle, None)
            .await
            .unwrap()
            .is_none());
        db.save_public_profile(community, account, session, false, "public", data.clone())
            .await
            .unwrap();
        assert!(db
            .public_profile(community, &handle, None)
            .await
            .unwrap()
            .is_none());
        db.save_public_profile(community, account, session, true, "public", data.clone())
            .await
            .unwrap();
        let public = db
            .public_profile(community, &handle, None)
            .await
            .unwrap()
            .unwrap();
        assert!(!public.to_string().contains("PRIVATE"));
        assert!(public.get("account_id").is_none());
        assert!(public.get("member_key").is_none());
        db.save_public_profile(community, account, session, true, "members", data.clone())
            .await
            .unwrap();
        assert!(db
            .public_profile(community, &handle, None)
            .await
            .unwrap()
            .is_none());
        assert!(db
            .public_profile(community, &handle, Some(account))
            .await
            .unwrap()
            .is_some());
        // Foreign image references and revoked sessions cannot alter the saved page.
        let mut forged = data.clone();
        forged["avatar"] = json!(Uuid::new_v4());
        assert!(db
            .save_public_profile(community, account, session, true, "public", forged)
            .await
            .is_err());
        assert!(db
            .save_public_profile(
                community,
                account,
                Uuid::nil(),
                true,
                "public",
                data.clone()
            )
            .await
            .is_err());
        let other_account = Uuid::new_v4();
        sqlx::query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())")
            .bind(other_account)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO managed_accounts(community_id,account_id,pubkey,key_version,sealed_secret) VALUES($1,$2,$3,1,$4)").bind(id).bind(other_account).bind("d4".repeat(32)).bind(vec![0u8;60]).execute(&pool).await.unwrap();
        let other_image = Uuid::new_v4();
        db.add_profile_image(community, other_account, other_image)
            .await
            .unwrap();
        let mut wrong_image = data.clone();
        wrong_image["avatar"] = json!(other_image);
        assert!(db
            .save_public_profile(community, account, session, true, "public", wrong_image)
            .await
            .is_err());
        let wrong_community = CommunityId::from_uuid(Uuid::new_v4());
        assert!(db
            .save_public_profile(
                wrong_community,
                account,
                session,
                true,
                "public",
                data.clone()
            )
            .await
            .is_err());
        assert!(db
            .public_profile(wrong_community, &handle, None)
            .await
            .unwrap()
            .is_none());
        sqlx::query("INSERT INTO moderation_word_policy(community_id,revision,terms) VALUES($1,'test',ARRAY['blockedfixture'])").bind(id).execute(&pool).await.unwrap();
        let mut blocked = data.clone();
        blocked["bio"] = json!("blockedfixture");
        assert!(db
            .save_public_profile(community, account, session, true, "public", blocked)
            .await
            .is_err());
        // An unscoped foreign author's post is still not eligible for this portfolio.
        let foreign_event = "f6".repeat(32);
        sqlx::query("INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES($1,decode($2,'hex'),decode($3,'hex'),now(),1,'[]','Other author',$4)").bind(id).bind(&foreign_event).bind("d4".repeat(32)).bind(vec![0u8;64]).execute(&pool).await.unwrap();
        let mut foreign = data.clone();
        foreign["highlights"] = json!([{"kind":"pulse","event_id":foreign_event}]);
        assert!(db
            .save_public_profile(community, account, session, true, "public", foreign)
            .await
            .is_err());
        // Only owned root notes are selectable; an edit updates the public view.
        let event = "b2".repeat(32);
        sqlx::query("INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES($1,decode($2,'hex'),decode($3,'hex'),now(),1,'[]','Original post',$4)").bind(id).bind(&event).bind(&author).bind(vec![0u8;64]).execute(&pool).await.unwrap();
        let mut with_note = data.clone();
        with_note["highlights"] = json!([{"kind":"pulse","event_id":event}]);
        db.save_public_profile(
            community,
            account,
            session,
            true,
            "public",
            with_note.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            db.public_profile(community, &handle, None)
                .await
                .unwrap()
                .unwrap()["highlights"][0]["text"],
            "Original post"
        );
        sqlx::query("INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES($1,decode($2,'hex'),decode($3,'hex'),now(),40003,$4,'Edited post',$5)").bind(id).bind("c3".repeat(32)).bind(&author).bind(json!([["e",event]])).bind(vec![0u8;64]).execute(&pool).await.unwrap();
        assert_eq!(
            db.public_profile(community, &handle, None)
                .await
                .unwrap()
                .unwrap()["highlights"][0]["text"],
            "Edited post"
        );
        sqlx::query(
            "UPDATE events SET deleted_at=now() WHERE community_id=$1 AND id=decode($2,'hex')",
        )
        .bind(id)
        .bind(&event)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            db.public_profile(community, &handle, None)
                .await
                .unwrap()
                .unwrap()["highlights"],
            json!([])
        );
        assert!(db
            .save_public_profile(community, account, session, true, "public", with_note)
            .await
            .is_err());
        // Rename moves the URL. Old handles never redirect to another member.
        sqlx::query("UPDATE member_profiles SET username=$2 WHERE account_id=$1")
            .bind(account)
            .bind(format!("{handle}x"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(db
            .public_profile(community, &handle, None)
            .await
            .unwrap()
            .is_none());
        assert!(db
            .public_profile(community, &format!("{handle}x"), None)
            .await
            .unwrap()
            .is_some());
        sqlx::query("INSERT INTO community_bans(community_id,pubkey,banned,actor_pubkey) VALUES($1,decode($2,'hex'),true,decode($2,'hex'))").bind(id).bind(&author).execute(&pool).await.unwrap();
        assert!(db
            .public_profile(community, &format!("{handle}x"), None)
            .await
            .unwrap()
            .is_none());
    }
}

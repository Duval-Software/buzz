-- Staff operations use existing reports, bans and audit history. No public API grants.
ALTER TABLE relay_members DROP CONSTRAINT relay_members_role_check;
ALTER TABLE relay_members ADD CONSTRAINT relay_members_role_check CHECK (role IN ('owner','admin','moderator','member'));
ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_action_check CHECK (action IN (
 'delete_message','kick','ban','unban','timeout','untimeout','dismiss_report','escalate',
 'resolve:delete','resolve:kick','resolve:ban','resolve:timeout','require_rename','clear_rename','change_role','appeal_upheld','appeal_reversed'));
ALTER TABLE moderation_actions ADD COLUMN command_id BYTEA;
CREATE UNIQUE INDEX moderation_action_command ON moderation_actions(community_id,command_id) WHERE command_id IS NOT NULL;
CREATE TABLE moderation_rename_holds (
 community_id UUID NOT NULL REFERENCES communities(id), pubkey BYTEA NOT NULL,
 username TEXT NOT NULL, action_id UUID NOT NULL, required BOOLEAN NOT NULL DEFAULT true,
 PRIMARY KEY(community_id,username), FOREIGN KEY(community_id,action_id) REFERENCES moderation_actions(community_id,id));
CREATE TABLE moderation_appeals (
 community_id UUID NOT NULL, action_id UUID NOT NULL, pubkey BYTEA NOT NULL,
 explanation TEXT NOT NULL CHECK(length(btrim(explanation)) BETWEEN 10 AND 2000),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','reversed')),
 reviewer BYTEA, decision TEXT, independent_review_exception TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ,
 PRIMARY KEY(community_id,action_id), FOREIGN KEY(community_id,action_id) REFERENCES moderation_actions(community_id,id));
CREATE TABLE moderation_word_policy (
 community_id UUID NOT NULL PRIMARY KEY REFERENCES communities(id), revision TEXT NOT NULL,
 terms TEXT[] NOT NULL CHECK(cardinality(terms) BETWEEN 1 AND 1000), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE moderation_rename_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_word_policy ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION moderation_normalize(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT btrim(regexp_replace(lower(normalize(translate(value, chr(8203)||chr(8204)||chr(8205)||chr(65279), ''), NFKC)), '[[:space:]]+', ' ', 'g'))
$$;
CREATE FUNCTION moderation_check_text(community UUID, value TEXT) RETURNS VOID LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE words TEXT[]; term TEXT; haystack TEXT;
BEGIN
 SELECT terms INTO words FROM moderation_word_policy WHERE community_id=community;
 -- Installing/enabling the file is an explicit deployment step; never replace it on startup.
 IF words IS NULL THEN RETURN; END IF;
 haystack := ' '||regexp_replace(moderation_normalize(value), '[^[:alnum:]_]+', ' ', 'g')||' ';
 FOREACH term IN ARRAY words LOOP
  IF position(' '||term||' ' IN haystack)>0 THEN
   RAISE EXCEPTION 'This text contains language blocked by the community. Please edit it and try again.' USING ERRCODE='22023';
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION moderation_filter_event() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE body TEXT; ch UUID; is_public BOOLEAN; metadata JSONB;
BEGIN
 -- Counter/tombstone maintenance must never rescan historical content.
 IF TG_OP='UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content AND NEW.tags IS NOT DISTINCT FROM OLD.tags THEN RETURN NEW; END IF;
 IF NEW.kind NOT IN (0,1,9,40003,30023) THEN RETURN NEW; END IF;
 ch := NEW.channel_id;
 IF NEW.kind=40003 THEN
  SELECT e.channel_id INTO ch FROM events e WHERE e.community_id=NEW.community_id
    AND encode(e.id,'hex')=(SELECT t->>1 FROM jsonb_array_elements(NEW.tags) t WHERE t->>0='e' LIMIT 1) LIMIT 1;
 END IF;
 IF NEW.kind=0 THEN
  metadata := NEW.content::jsonb;
  body := concat_ws(' ',metadata->>'name',metadata->>'display_name',metadata->>'about');
 ELSE
  IF ch IS NOT NULL THEN
   SELECT visibility='open' AND channel_type<>'dm' INTO is_public FROM channels WHERE community_id=NEW.community_id AND id=ch;
   IF NOT coalesce(is_public,false) THEN RETURN NEW; END IF;
  ELSIF NEW.kind NOT IN (1,30023,40003) THEN RETURN NEW;
  END IF;
  body := NEW.content || ' ' || coalesce((SELECT string_agg(t->>1,' ') FROM jsonb_array_elements(NEW.tags) t WHERE t->>0 IN ('hive-outcome','hive-project')),'');
 END IF;
 PERFORM moderation_check_text(NEW.community_id,body);
 RETURN NEW;
END $$;
CREATE TRIGGER moderation_filter_event BEFORE INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION moderation_filter_event();

-- Shared deletion primitive preserves thread counters under concurrent removals.
CREATE FUNCTION moderation_delete_event(community UUID,target_event BYTEA) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE parent_id BYTEA; root_id BYTEA;
BEGIN
 UPDATE events SET deleted_at=now() WHERE community_id=community AND id=target_event AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT parent_event_id,root_event_id INTO parent_id,root_id FROM thread_metadata WHERE community_id=community AND event_id=target_event;
 UPDATE thread_metadata SET reply_count=greatest(reply_count-1,0) WHERE community_id=community AND event_id=parent_id;
 IF parent_id IS NOT NULL THEN UPDATE thread_metadata SET descendant_count=greatest(descendant_count-1,0) WHERE community_id=community AND event_id=root_id; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION moderation_delete_event(UUID,BYTEA) FROM PUBLIC;

-- One transaction and one lock order for staff changes, including concurrent role revocation.
CREATE FUNCTION moderation_staff_command(community UUID, actor BYTEA, command BYTEA, command_kind INT, args JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE actor_role TEXT; target_role TEXT; target BYTEA; target_event BYTEA; reason TEXT;
 action UUID := gen_random_uuid(); existing UUID; operation TEXT; expiration TIMESTAMPTZ;
 report moderation_reports%ROWTYPE; restriction community_bans%ROWTYPE; original moderation_actions%ROWTYPE;
 appeal moderation_appeals%ROWTYPE; evidence events%ROWTYPE; parent_id BYTEA; root_id BYTEA;
 selected_role TEXT; held_name TEXT; result_status TEXT; is_private BOOLEAN;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('moderation:'||community::text,0));
 SELECT role INTO actor_role FROM relay_members WHERE community_id=community AND pubkey=encode(actor,'hex');
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin','moderator') OR EXISTS(
  SELECT 1 FROM community_bans WHERE community_id=community AND pubkey=actor AND banned AND (ban_expires_at IS NULL OR ban_expires_at>now())) THEN
  RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 SELECT id INTO existing FROM moderation_actions WHERE community_id=community AND command_id=command AND actor_pubkey=actor;
 IF existing IS NOT NULL THEN RETURN jsonb_build_object('action_id',existing,'duplicate',true); END IF;
 reason := btrim(args->>'reason');
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Give a reason between 3 and 500 characters' USING ERRCODE='22023'; END IF;
 IF args ? 'p' THEN target:=decode(args->>'p','hex'); IF length(target)<>32 THEN RAISE EXCEPTION 'Invalid member'; END IF; END IF;
 IF command_kind=9044 THEN
  SELECT * INTO report FROM moderation_reports WHERE community_id=community AND report_event_id=decode(args->>'report','hex') FOR UPDATE;
  IF NOT FOUND OR report.status NOT IN ('open','escalated') OR report.status IS DISTINCT FROM coalesce(args->>'expected', 'open') THEN
   RAISE EXCEPTION 'Report changed. Refresh and review it again.' USING ERRCODE='40001'; END IF;
  operation:=args->>'action'; target:=report.target_pubkey; target_event:=report.target_event_id;
 ELSIF command_kind=9046 THEN
  IF actor_role='moderator' THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO appeal FROM moderation_appeals WHERE community_id=community AND action_id=(args->>'appeal')::uuid FOR UPDATE;
  IF NOT FOUND OR appeal.status<>'open' THEN RAISE EXCEPTION 'Appeal changed. Refresh and review it again.' USING ERRCODE='40001'; END IF;
  SELECT * INTO original FROM moderation_actions WHERE community_id=community AND id=appeal.action_id;
  target:=original.target_pubkey;
  IF original.actor_pubkey=actor AND (length(btrim(coalesce(args->>'exception','')))<10 OR EXISTS(
   SELECT 1 FROM relay_members m WHERE m.community_id=community AND m.role IN ('owner','admin') AND m.pubkey<>encode(actor,'hex')
    AND NOT EXISTS(SELECT 1 FROM community_bans b WHERE b.community_id=community AND b.pubkey=decode(m.pubkey,'hex') AND b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>now())))) THEN
   RAISE EXCEPTION 'Another administrator must review this appeal, or document why independent review is unavailable.' USING ERRCODE='42501'; END IF;
  IF args->>'decision' NOT IN ('upheld','reversed') OR args->>'decision' IS NULL THEN RAISE EXCEPTION 'Invalid appeal decision'; END IF;
  operation:=CASE WHEN args->>'decision'='upheld' THEN 'appeal_upheld' WHEN original.action='ban' THEN 'unban' WHEN original.action='timeout' THEN 'untimeout' WHEN original.action='require_rename' THEN 'clear_rename' ELSE 'unsupported' END;
 ELSE
  operation:=CASE command_kind WHEN 9040 THEN 'ban' WHEN 9041 THEN 'unban' WHEN 9042 THEN 'timeout' WHEN 9043 THEN 'untimeout' WHEN 9045 THEN 'require_rename' WHEN 9032 THEN 'change_role' ELSE 'unsupported' END;
 END IF;
 IF operation NOT IN ('ban','unban','timeout','untimeout','delete','dismiss','escalate','require_rename','clear_rename','change_role','appeal_upheld') OR operation IS NULL THEN RAISE EXCEPTION 'Unsupported moderation action'; END IF;
 IF target_event IS NOT NULL THEN
  SELECT * INTO evidence FROM events WHERE community_id=community AND id=target_event LIMIT 1;
  IF NOT FOUND THEN
   IF operation NOT IN ('dismiss','escalate') THEN RAISE EXCEPTION 'Reported message is unavailable'; END IF;
  ELSE target:=evidence.pubkey; END IF;
 END IF;
 IF target IS NOT NULL THEN
  SELECT role INTO target_role FROM relay_members WHERE community_id=community AND pubkey=encode(target,'hex');
  IF operation NOT IN ('dismiss','escalate','appeal_upheld') AND (target=actor OR
   (actor_role<>'owner' AND target_role IN ('owner','admin')) OR
   (actor_role='moderator' AND target_role='moderator')) THEN RAISE EXCEPTION 'You cannot take this action against staff' USING ERRCODE='42501'; END IF;
 END IF;
 IF actor_role='moderator' AND operation NOT IN ('timeout','delete','dismiss','escalate') THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF operation NOT IN ('dismiss','escalate','appeal_upheld') AND target IS NULL THEN RAISE EXCEPTION 'A member target is required'; END IF;
 SELECT * INTO restriction FROM community_bans WHERE community_id=community AND pubkey=target FOR UPDATE;
 IF actor_role='moderator' AND operation='timeout' AND restriction.muted_until>now() AND restriction.actor_pubkey<>actor THEN
  RAISE EXCEPTION 'An existing staff restriction must be reviewed by an administrator' USING ERRCODE='42501'; END IF;
 IF command_kind=9046 AND args->>'decision'='reversed' AND EXISTS(
  SELECT 1 FROM moderation_actions a WHERE a.community_id=community AND a.target_pubkey=target AND a.created_at>original.created_at
   AND a.action IN ('ban','unban','timeout','untimeout','require_rename','clear_rename')) THEN
  RAISE EXCEPTION 'Newer restrictions exist. Review the member before reversing this action.' USING ERRCODE='40001'; END IF;
 IF operation IN ('ban','timeout') THEN
  expiration:=CASE WHEN args ? 'expiration' THEN to_timestamp((args->>'expiration')::bigint) END;
  IF (operation='timeout' AND expiration IS NULL) OR expiration<=now() OR (operation='timeout' AND expiration>now()+interval '7 days 30 seconds') THEN RAISE EXCEPTION 'Choose a timeout of at most seven days'; END IF;
  IF actor_role='moderator' AND operation='timeout' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[600,3600,86400,604800]) seconds WHERE extract(epoch FROM expiration-now()) BETWEEN seconds-120 AND seconds+30) THEN RAISE EXCEPTION 'Choose an approved timeout preset'; END IF;
  INSERT INTO community_bans(community_id,pubkey,actor_pubkey) VALUES(community,target,actor) ON CONFLICT DO NOTHING;
  IF operation='ban' THEN UPDATE community_bans SET banned=true,ban_expires_at=expiration,ban_reason=reason,actor_pubkey=actor,updated_at=now() WHERE community_id=community AND pubkey=target;
  ELSE UPDATE community_bans SET muted_until=expiration,mute_reason=reason,actor_pubkey=actor,updated_at=now() WHERE community_id=community AND pubkey=target; END IF;
 ELSIF operation='unban' THEN
  UPDATE community_bans SET banned=false,ban_expires_at=NULL,actor_pubkey=actor,updated_at=now() WHERE community_id=community AND pubkey=target AND banned;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member is no longer banned' USING ERRCODE='40001'; END IF;
 ELSIF operation='untimeout' THEN
  UPDATE community_bans SET muted_until=NULL,actor_pubkey=actor,updated_at=now() WHERE community_id=community AND pubkey=target AND muted_until>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Timeout is no longer active' USING ERRCODE='40001'; END IF;
 ELSIF operation='delete' THEN
  IF target_event IS NULL OR evidence.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Message is unavailable or already removed' USING ERRCODE='40001'; END IF;
  IF NOT moderation_delete_event(community,target_event) THEN RAISE EXCEPTION 'Message already removed' USING ERRCODE='40001'; END IF;
 ELSIF operation='change_role' THEN
  selected_role:=args->>'role';
  IF selected_role IS NULL OR selected_role NOT IN ('member','moderator','admin') OR (actor_role<>'owner' AND selected_role='admin') OR target_role IS NULL THEN RAISE EXCEPTION 'Role change is not allowed' USING ERRCODE='42501'; END IF;
  IF target_role IS DISTINCT FROM args->>'expected' THEN RAISE EXCEPTION 'Role changed. Refresh and review it again.' USING ERRCODE='40001'; END IF;
  UPDATE relay_members SET role=selected_role,updated_at=now() WHERE community_id=community AND pubkey=encode(target,'hex');
 ELSIF operation='require_rename' THEN
  held_name:=args->>'username';
  IF held_name IS NULL OR held_name !~ '^[a-z][a-z0-9_]{2,23}$' THEN RAISE EXCEPTION 'A valid current username is required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM moderation_member_directory WHERE community_id=community AND pubkey=encode(target,'hex') AND username=held_name) THEN RAISE EXCEPTION 'Username changed. Refresh and review it again.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM moderation_rename_holds WHERE community_id=community AND username=held_name) THEN RAISE EXCEPTION 'This handle is already held' USING ERRCODE='40001'; END IF;
 ELSIF operation='clear_rename' THEN
  UPDATE moderation_rename_holds SET required=false WHERE community_id=community AND action_id=original.id;
 END IF;
 INSERT INTO moderation_actions(community_id,id,actor_pubkey,action,target_pubkey,target_event_id,public_reason,private_reason,command_id)
 VALUES(community,action,actor,CASE WHEN operation='delete' THEN 'delete_message' WHEN operation='dismiss' THEN 'dismiss_report' ELSE operation END,target,target_event,reason,
 CASE WHEN operation='change_role' THEN target_role||' -> '||selected_role END,command);
 IF operation='require_rename' THEN INSERT INTO moderation_rename_holds VALUES(community,target,held_name,action,true); END IF;
 IF command_kind=9044 THEN
  result_status:=CASE operation WHEN 'dismiss' THEN 'dismissed' WHEN 'escalate' THEN 'escalated' ELSE 'resolved' END;
  UPDATE moderation_reports SET status=result_status,resolved_by=actor,resolved_at=now(),action_id=action WHERE community_id=community AND id=report.id;
 END IF;
 IF command_kind=9046 THEN
  UPDATE moderation_appeals SET status=args->>'decision',decision=reason,reviewer=actor,reviewed_at=now(),independent_review_exception=nullif(btrim(args->>'exception'),'') WHERE community_id=community AND action_id=appeal.action_id;
 END IF;
 RETURN jsonb_build_object('action_id',action,'operation',operation,'target',encode(target,'hex'),'target_event',encode(target_event,'hex'),'channel_id',report.channel_id,'reporter',encode(report.reporter_pubkey,'hex'),'report_id',report.id,'status',result_status);
END $$;
REVOKE ALL ON FUNCTION moderation_staff_command(UUID,BYTEA,BYTEA,INT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION moderation_check_text(UUID,TEXT) FROM PUBLIC;

CREATE VIEW moderation_member_directory AS
 SELECT m.community_id,m.pubkey,m.role,NULL::text AS username,
 coalesce(p.content::jsonb->>'display_name',p.content::jsonb->>'name','Member') AS display_name
 FROM relay_members m LEFT JOIN LATERAL (
  SELECT content FROM events e WHERE e.community_id=m.community_id AND e.pubkey=decode(m.pubkey,'hex') AND e.kind=0 AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 1
 ) p ON true;
REVOKE ALL ON moderation_member_directory FROM PUBLIC;

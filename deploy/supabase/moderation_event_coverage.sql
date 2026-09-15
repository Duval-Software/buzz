-- Include every existing public message/reply format, including alternate clients.
CREATE OR REPLACE FUNCTION buzz.moderation_filter_event() RETURNS trigger LANGUAGE plpgsql SET search_path=buzz,extensions AS $$
DECLARE body TEXT; ch UUID; is_public BOOLEAN; metadata JSONB;
BEGIN
 -- Counter/tombstone maintenance must never rescan historical content.
 IF TG_OP='UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content AND NEW.tags IS NOT DISTINCT FROM OLD.tags THEN RETURN NEW; END IF;
 IF NEW.kind NOT IN (0,1,9,40002,40003,40006,40008,45001,45003,30023) THEN RETURN NEW; END IF;
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

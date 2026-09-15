-- Preserve original SQLx migration bytes; pin legacy trigger/helper resolution
-- separately for the private production schema. No caller-controlled temp tables.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='buzz' AND p.proname IN (
      'channels_community_id_immutable','guard_nip_rs_watermark',
      'purge_soft_deleted_nip_rs','guard_event_mention_live','guard_nip_rs_hard_delete',
      'enqueue_push_match_job','purge_soft_deleted_buzz_mesh_status',
      'events_created_at_floor_guard','refresh_channel_ttl_after_event_insert'
    )
  LOOP
    EXECUTE format('ALTER FUNCTION buzz.%I(%s) SET search_path = buzz, pg_temp',fn.proname,fn.args);
  END LOOP;
END $$;

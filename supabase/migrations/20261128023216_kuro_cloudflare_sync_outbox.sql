CREATE TABLE public.kuro_cloudflare_sync_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  secret_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.kuro_cloudflare_sync_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kuro_cloudflare_sync_config FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.kuro_cloudflare_sync_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_pk jsonb,
  new_pk jsonb,
  row_data jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.kuro_cloudflare_sync_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kuro_cloudflare_sync_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_check_secret(p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_secret IS NULL OR pg_catalog.length(p_secret) < 40 OR NOT EXISTS (
    SELECT 1
    FROM public.kuro_cloudflare_sync_config AS c
    WHERE c.singleton IS TRUE
      AND c.enabled IS TRUE
      AND c.secret_hash = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(p_secret, 'UTF8'), 'sha256'),
        'hex'
      )
  ) THEN
    RAISE EXCEPTION 'Unauthorized KURO mirror sync request'
      USING ERRCODE = '28000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_capture_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_old_pk jsonb := '{}'::jsonb;
  v_new_pk jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := pg_catalog.to_jsonb(OLD);
  ELSE
    v_new := pg_catalog.to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := pg_catalog.to_jsonb(OLD);
    IF v_old IS NOT DISTINCT FROM v_new THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_object_agg(a.attname, v_new -> a.attname ORDER BY k.ordinality),
      '{}'::jsonb
    )
    INTO v_new_pk
    FROM pg_catalog.pg_index AS i
    JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = TG_RELID AND i.indisprimary;
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_object_agg(a.attname, v_old -> a.attname ORDER BY k.ordinality),
      '{}'::jsonb
    )
    INTO v_old_pk
    FROM pg_catalog.pg_index AS i
    JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = TG_RELID AND i.indisprimary;
  END IF;

  IF TG_OP <> 'INSERT' AND v_old_pk = '{}'::jsonb THEN
    RAISE EXCEPTION 'KURO mirror sync could not resolve primary key for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF TG_OP <> 'DELETE' AND v_new_pk = '{}'::jsonb THEN
    RAISE EXCEPTION 'KURO mirror sync could not resolve primary key for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  INSERT INTO public.kuro_cloudflare_sync_outbox (
    table_name, operation, old_pk, new_pk, row_data
  )
  VALUES (
    TG_TABLE_NAME, TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN v_old_pk ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN v_new_pk ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN v_new ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_pull(
  p_secret text,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  event_id text,
  table_name text,
  operation text,
  old_pk jsonb,
  new_pk jsonb,
  row_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.kuro_cloudflare_sync_check_secret(p_secret);
  RETURN QUERY
  SELECT o.id::text, o.table_name, o.operation, o.old_pk, o.new_pk, o.row_data
  FROM public.kuro_cloudflare_sync_outbox AS o
  ORDER BY o.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_ack(
  p_secret text,
  p_event_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  PERFORM public.kuro_cloudflare_sync_check_secret(p_secret);
  DELETE FROM public.kuro_cloudflare_sync_outbox AS o
  WHERE o.id::text = ANY(COALESCE(p_event_ids, ARRAY[]::text[]));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_cloudflare_sync_check_secret(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.kuro_cloudflare_capture_row_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.kuro_cloudflare_sync_pull(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.kuro_cloudflare_sync_ack(text, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kuro_cloudflare_sync_pull(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.kuro_cloudflare_sync_ack(text, text[]) TO anon;

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['profiles', 'posts', 'post_likes', 'post_replies', 'follows', 'notifications', 'chat_conversations', 'chat_messages', 'chat_message_reads', 'chat_message_hides', 'group_conversations', 'group_chat_members', 'group_chat_messages', 'group_chat_message_reads', 'group_chat_mentions', 'public_chat_daily_stats', 'public_chat_messages', 'game_activity_presence', 'game_daifugo_private_sessions', 'game_daifugo_room_ready', 'game_online_matchmaking', 'game_online_room_members', 'game_online_room_messages', 'game_online_rooms', 'game_online_settings', 'game_saves', 'game_scores', 'game_sevens_private_sessions', 'game_sevens_results', 'game_sevens_room_votes', 'game_studio_games', 'game_tictactoe_verified_events', 'game_tictactoe_verified_stats', 'game_world_blocks', 'werewolf_action_receipts', 'werewolf_chat_messages', 'werewolf_private_sessions', 'werewolf_rooms', 'kuro_coin_balances', 'kuro_coin_game_rewards', 'kuro_game_user_stats', 'kuro_game_win_events', 'kuro_level_coin_rewards', 'kuro_level_game_rewards', 'kuro_level_system_settings', 'kuro_level_thresholds', 'kuro_level_users', 'kuro_store_design_drafts', 'kuro_store_equipped_items', 'kuro_store_items', 'kuro_store_studio_members', 'kuro_store_user_inventory', 'kurogames_home_banners', 'portal_announcements', 'portal_favorites', 'portal_history', 'portal_preferences', 'admin_message_reads', 'admin_messages', 'feature_flags', 'user_last_activity'] LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'KURO mirror source table public.% does not exist', v_table;
    END IF;
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'kuro_cloudflare_mirror_capture',
      v_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.kuro_cloudflare_capture_row_change()',
      'kuro_cloudflare_mirror_capture',
      v_table
    );
  END LOOP;
END;
$block$;

-- Expand the private Supabase -> Cloudflare D1 mirror to the remaining
-- non-Auth application tables. The existing D1 schema already contains these tables.
-- Username credential mapping and login rate limits intentionally remain with Auth.

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_pull(
  p_secret text,
  p_limit integer DEFAULT 250
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
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 250), 1), 250);
END;
$function$;

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_users',
    'admin_audit_logs',
    'admin_email_logs',
    'account_suspension_appeals',
    'account_suspension_appeal_messages',
    'game_tictactoe_events_archive',
    'game_tictactoe_stats_archive',
    'game_verification_sessions',
    'kuro_game_play_events',
    'kuro_ip_ban_logs',
    'kuro_ip_bans',
    'kuro_security_events',
    'portal_request_notifications',
    'portal_requests',
    'pro_applications',
    'pro_invitations',
    'pro_user_controls',
    'push_subscriptions',
    'sns_user_reports',
    'usage_events'
  ] LOOP
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

-- One-time current-state snapshot. New writes are captured by the triggers above.
INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'admin_users', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.admin_users AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'admin_audit_logs', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.admin_audit_logs AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'admin_email_logs', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.admin_email_logs AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'account_suspension_appeals', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.account_suspension_appeals AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'account_suspension_appeal_messages', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.account_suspension_appeal_messages AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'game_tictactoe_events_archive', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.game_tictactoe_events_archive AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'game_tictactoe_stats_archive', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.game_tictactoe_stats_archive AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'game_verification_sessions', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.game_verification_sessions AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_game_play_events', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_game_play_events AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_ip_ban_logs', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_ip_ban_logs AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_ip_bans', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_ip_bans AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_security_events', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_security_events AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'portal_request_notifications', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.portal_request_notifications AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'portal_requests', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.portal_requests AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'pro_applications', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.pro_applications AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'pro_invitations', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.pro_invitations AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'pro_user_controls', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.pro_user_controls AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'push_subscriptions', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.push_subscriptions AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'sns_user_reports', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.sns_user_reports AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'usage_events', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.usage_events AS t;

COMMENT ON TABLE public.kuro_cloudflare_sync_outbox IS
  'Private ordered change log used to mirror application tables from Supabase Postgres to Cloudflare D1. Auth credentials and image binaries are not mirrored.';

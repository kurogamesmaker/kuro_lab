-- Synchronize the KC/XP ledgers, milestone claims, verified coin events,
-- and private account-suspension state to Cloudflare D1.
-- Supabase remains authoritative for all write transactions in this phase.

CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_pull(
  p_secret text,
  p_limit integer DEFAULT 100
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
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
END;
$function$;

-- A private readiness marker is enqueued last. D1 coin-history reads remain
-- on their Supabase fallback until this marker has been applied.
CREATE TABLE IF NOT EXISTS public.__kuro_economy_mirror_control (
  id integer PRIMARY KEY CHECK (id = 1),
  snapshot_ready boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz
);
ALTER TABLE public.__kuro_economy_mirror_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.__kuro_economy_mirror_control FROM PUBLIC, anon, authenticated, service_role;

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'account_suspensions',
    'kuro_coin_ledger',
    'kuro_coin_verified_game_events',
    'kuro_level_ledger',
    'kuro_level_coin_reward_claims'
  ] LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'KURO economy mirror source table public.% does not exist', v_table;
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

-- Seed a complete current-state snapshot. These writes only enqueue mirror
-- events; the source rows and their existing triggers are not modified.
INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'account_suspensions', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.account_suspensions AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_coin_ledger', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_coin_ledger AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_coin_verified_game_events', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_coin_verified_game_events AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_level_ledger', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_level_ledger AS t;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT 'kuro_level_coin_reward_claims', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.kuro_level_coin_reward_claims AS t;

-- This must remain the final initial-snapshot event so D1 can expose a
-- complete-history read only after all of the rows above have been applied.
INSERT INTO public.__kuro_economy_mirror_control (id, snapshot_ready, snapshot_at)
VALUES (1, true, pg_catalog.now())
ON CONFLICT (id) DO UPDATE
SET snapshot_ready = EXCLUDED.snapshot_ready,
    snapshot_at = EXCLUDED.snapshot_at;

INSERT INTO public.kuro_cloudflare_sync_outbox (table_name, operation, row_data)
SELECT '__kuro_economy_mirror_control', 'INSERT', pg_catalog.to_jsonb(t)
FROM public.__kuro_economy_mirror_control AS t;
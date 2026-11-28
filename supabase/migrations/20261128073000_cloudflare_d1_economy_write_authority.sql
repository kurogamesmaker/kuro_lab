-- D1 now owns KC/XP balances, ledgers, reward settings and Store inventory.
-- The initial D1 mirror was checked and the Supabase outbox is empty at cutover.
-- Keep historical source rows in Supabase as rollback evidence, but stop copying
-- their future mutations into D1 where they would overwrite newer D1 transactions.

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'kuro_coin_balances',
    'kuro_coin_game_rewards',
    'kuro_coin_ledger',
    'kuro_level_coin_reward_claims',
    'kuro_level_coin_rewards',
    'kuro_level_game_rewards',
    'kuro_level_ledger',
    'kuro_level_system_settings',
    'kuro_level_thresholds',
    'kuro_level_users',
    'kuro_store_equipped_items',
    'kuro_store_user_inventory'
  ] LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'KURO D1-owned table public.% does not exist', v_table;
    END IF;
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      'kuro_cloudflare_mirror_capture',
      v_table
    );
  END LOOP;
END;
$block$;

COMMENT ON TABLE public.kuro_coin_balances IS
  'Legacy Supabase snapshot retained for rollback; live KC balance writes are authoritative in Cloudflare D1.';
COMMENT ON TABLE public.kuro_coin_ledger IS
  'Legacy Supabase snapshot retained for rollback; live KC ledger writes are authoritative in Cloudflare D1.';
COMMENT ON TABLE public.kuro_level_users IS
  'Legacy Supabase snapshot retained for rollback; live XP/level writes are authoritative in Cloudflare D1.';
COMMENT ON TABLE public.kuro_store_user_inventory IS
  'Legacy Supabase snapshot retained for rollback; live Store inventory writes are authoritative in Cloudflare D1.';
COMMENT ON TABLE public.kuro_store_equipped_items IS
  'Legacy Supabase snapshot retained for rollback; live Store equipment writes are authoritative in Cloudflare D1.';

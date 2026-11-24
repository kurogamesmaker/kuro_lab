-- Public balance display moved to a narrow Edge Function.
-- The coin balance table remains private and there is no anonymous table SELECT grant.
DROP FUNCTION IF EXISTS public.kuro_get_public_coin_balance(uuid);

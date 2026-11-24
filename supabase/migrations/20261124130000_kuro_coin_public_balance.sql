-- Public read-only KURO COIN balance for shared KURO profile cards.
-- The balance table itself remains private; no ledger/history fields are exposed.

CREATE OR REPLACE FUNCTION public.kuro_get_public_coin_balance(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = p_user_id
      )
    THEN NULL::bigint
    ELSE COALESCE(
      (
        SELECT b.balance
        FROM public.kuro_coin_balances AS b
        WHERE b.user_id = p_user_id
      ),
      0
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_get_public_coin_balance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kuro_get_public_coin_balance(uuid)
  TO anon, authenticated;

COMMENT ON FUNCTION public.kuro_get_public_coin_balance(uuid)
  IS 'Public profile display endpoint. Returns only the public KURO COIN balance for an existing profile; never returns ledger or account metadata.';

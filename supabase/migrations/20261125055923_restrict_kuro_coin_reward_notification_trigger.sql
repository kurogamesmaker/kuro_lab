-- The coin notification function is a trigger-only SECURITY DEFINER function.
-- It should not be callable as a public RPC endpoint.
REVOKE ALL ON FUNCTION public.kuro_coin_notify_reward() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kuro_coin_notify_reward() FROM anon, authenticated, service_role;

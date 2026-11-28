CREATE OR REPLACE FUNCTION public.kuro_cloudflare_sync_pull(
  p_secret text,
  p_limit integer DEFAULT 1000
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
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_enforce_account_suspension_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.account_suspensions AS s
    WHERE s.user_id = v_user_id
      AND s.revoked_at IS NULL
      AND s.starts_at <= pg_catalog.now()
      AND s.ends_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_TEMPORARILY_SUSPENDED'
      USING ERRCODE = '42501',
            DETAIL = 'このアカウントは一時停止中のため、書き込みできません。';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSIF TG_OP = 'TRUNCATE' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_enforce_account_suspension_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kuro_enforce_account_suspension_write() TO authenticated, service_role;

DO $block$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname,
           has_table_privilege('authenticated', c.oid, 'INSERT')
             OR has_table_privilege('authenticated', c.oid, 'UPDATE')
             OR has_table_privilege('authenticated', c.oid, 'DELETE') AS needs_row_guard,
           has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS needs_truncate_guard
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN (
        'account_suspension_appeals',
        'account_suspension_appeal_messages',
        'admin_message_reads',
        'usage_events',
        'account_suspensions'
      )
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')
        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      )
  LOOP
    IF t.needs_row_guard THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zz_kuro_account_suspension_row_guard ON public.%I', t.relname);
      EXECUTE format(
        'CREATE TRIGGER zz_kuro_account_suspension_row_guard
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.kuro_enforce_account_suspension_write()',
        t.relname
      );
    END IF;

    IF t.needs_truncate_guard THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zz_kuro_account_suspension_truncate_guard ON public.%I', t.relname);
      EXECUTE format(
        'CREATE TRIGGER zz_kuro_account_suspension_truncate_guard
         BEFORE TRUNCATE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.kuro_enforce_account_suspension_write()',
        t.relname
      );
    END IF;
  END LOOP;
END;
$block$;

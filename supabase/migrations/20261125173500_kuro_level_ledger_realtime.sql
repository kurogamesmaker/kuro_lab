-- Publish only the player's own XP ledger changes through RLS-filtered Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='kuro_level_ledger'
  ) then
    alter publication supabase_realtime add table public.kuro_level_ledger;
  end if;
end
$$;

-- Recalculate only users whose stored level differs from the level implied by their XP.
-- This preserves all XP and avoids unbounded UPDATE statements rejected by the database guard.
create or replace function public.kuro_level_recalculate_all()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  update public.kuro_level_users u
  set current_level = public.kuro_level_for_xp(u.total_xp),
      updated_at = pg_catalog.now()
  where u.current_level is distinct from public.kuro_level_for_xp(u.total_xp);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

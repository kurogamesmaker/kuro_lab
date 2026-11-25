create or replace function public.kuro_level_xp_required(p_level integer)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_level integer := greatest(coalesce(p_level,1),1);
  v_xp bigint;
  v_base bigint;
  v_base_level integer;
  v_n bigint;
begin
  select t.required_xp into v_xp
  from public.kuro_level_thresholds t
  where t.level=v_level;
  if found then return v_xp; end if;

  -- If an administrator configures fewer than ten explicit levels,
  -- continue a steadily increasing curve from the highest configured level.
  select t.level,t.required_xp into v_base_level,v_base
  from public.kuro_level_thresholds t
  order by t.level desc
  limit 1;
  v_base_level:=coalesce(v_base_level,10);
  v_base:=coalesce(v_base,10000);
  v_n:=greatest(v_level-v_base_level,0);
  return v_base+2000*v_n+100*v_n*(v_n+1);
end;
$$;
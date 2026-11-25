-- KuroGames independent player level / XP system.
-- XP is awarded only from server-verified rows in kuro_game_win_events.
-- Legacy wins are intentionally not backfilled.

create table if not exists public.kuro_level_system_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  default_win_xp integer not null default 100 check (default_win_xp between 0 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.kuro_level_system_settings(singleton,enabled,default_win_xp)
values (true,true,100) on conflict (singleton) do nothing;

create table if not exists public.kuro_level_game_rewards (
  game_id uuid primary key references public.game_studio_games(id) on delete cascade,
  xp_per_win integer not null default 100 check (xp_per_win between 0 and 100000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.kuro_level_thresholds (
  level integer primary key check (level >= 1),
  required_xp bigint not null check (required_xp >= 0),
  updated_at timestamptz not null default now(),
  check (level <> 1 or required_xp = 0)
);
insert into public.kuro_level_thresholds(level,required_xp) values
  (1,0),(2,300),(3,800),(4,1500),(5,2400),
  (6,3500),(7,4800),(8,6300),(9,8000),(10,10000)
on conflict (level) do nothing;

create table if not exists public.kuro_level_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp bigint not null default 0 check (total_xp >= 0),
  current_level integer not null default 1 check (current_level >= 1),
  updated_at timestamptz not null default now()
);
create table if not exists public.kuro_level_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_amount integer not null check (xp_amount <> 0),
  total_xp_after bigint not null check (total_xp_after >= 0),
  source_game_id uuid references public.game_studio_games(id) on delete set null,
  source_mode text,
  source_win_event_id uuid references public.kuro_game_win_events(id) on delete set null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists kuro_level_ledger_source_win_event_uidx
  on public.kuro_level_ledger(source_win_event_id)
  where source_win_event_id is not null;
create index if not exists kuro_level_ledger_user_created_idx
  on public.kuro_level_ledger(user_id,created_at desc);

alter table public.kuro_level_system_settings enable row level security;
alter table public.kuro_level_game_rewards enable row level security;
alter table public.kuro_level_thresholds enable row level security;
alter table public.kuro_level_users enable row level security;
alter table public.kuro_level_ledger enable row level security;

drop policy if exists kuro_level_thresholds_public_read on public.kuro_level_thresholds;
create policy kuro_level_thresholds_public_read on public.kuro_level_thresholds
  for select to anon,authenticated using (true);
drop policy if exists kuro_level_users_public_read on public.kuro_level_users;
create policy kuro_level_users_public_read on public.kuro_level_users
  for select to anon,authenticated using (true);
drop policy if exists kuro_level_ledger_read_own on public.kuro_level_ledger;
create policy kuro_level_ledger_read_own on public.kuro_level_ledger
  for select to authenticated using ((select auth.uid())=user_id);

revoke all on public.kuro_level_system_settings from public,anon,authenticated;
revoke all on public.kuro_level_game_rewards from public,anon,authenticated;
revoke all on public.kuro_level_thresholds from public,anon,authenticated;
revoke all on public.kuro_level_users from public,anon,authenticated;
revoke all on public.kuro_level_ledger from public,anon,authenticated;
grant select on public.kuro_level_thresholds to anon,authenticated,service_role;
grant select on public.kuro_level_users to anon,authenticated,service_role;
grant select on public.kuro_level_ledger to authenticated,service_role;
grant all on public.kuro_level_system_settings to service_role;
grant all on public.kuro_level_game_rewards to service_role;
grant all on public.kuro_level_thresholds to service_role;
grant all on public.kuro_level_users to service_role;
grant all on public.kuro_level_ledger to service_role;

create or replace function public.kuro_level_xp_required(p_level integer)
returns bigint
language plpgsql
stable
set search_path = ''
as $
declare
  v_level integer := greatest(coalesce(p_level,1),1);
  v_xp bigint;
  v_base bigint;
  v_base_level integer;
  v_n bigint;
begin
  select t.required_xp into v_xp
  from public.kuro_level_thresholds t
  where t.level = v_level;
  if found then return v_xp; end if;

  if v_level <= 10 then
    return case v_level
      when 1 then 0 when 2 then 300 when 3 then 800 when 4 then 1500
      when 5 then 2400 when 6 then 3500 when 7 then 4800
      when 8 then 6300 when 9 then 8000 else 10000 end;
  end if;

  select t.level,t.required_xp into v_base_level,v_base
  from public.kuro_level_thresholds t
  order by t.level desc limit 1;
  v_base_level := coalesce(v_base_level,10);
  v_base := coalesce(v_base,10000);
  v_n := greatest(v_level - v_base_level,0);
  return v_base + 2000 * v_n + 100 * v_n * (v_n + 1);
end;
$;

create or replace function public.kuro_level_for_xp(p_total_xp bigint)
returns integer language plpgsql stable set search_path=''
as $$
declare v_xp bigint:=greatest(coalesce(p_total_xp,0),0); v_level integer;
begin
  select coalesce(max(t.level),1) into v_level from public.kuro_level_thresholds t
  where t.required_xp<=v_xp;
  while v_level<10000 and v_xp>=public.kuro_level_xp_required(v_level+1) loop
    v_level:=v_level+1;
  end loop;
  return v_level;
end;
$$;

create or replace function public.kuro_level_recalculate_all()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_count bigint;
begin
  update public.kuro_level_users u
  set current_level=public.kuro_level_for_xp(u.total_xp),updated_at=pg_catalog.now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.kuro_level_admin_adjust(
  p_user_id uuid,p_amount integer,p_reason text,p_actor_user_id uuid
)
returns table(total_xp bigint,current_level integer)
language plpgsql security definer set search_path=''
as $$
declare v_current bigint; v_next bigint; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if p_user_id is null or p_actor_user_id is null then raise exception 'INVALID_LEVEL_ADJUSTMENT'; end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_actor_user_id) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_amount is null or p_amount=0 or abs(p_amount::bigint)>1000000 then raise exception 'INVALID_LEVEL_AMOUNT'; end if;
  if char_length(v_reason)<1 or char_length(v_reason)>200 then raise exception 'INVALID_LEVEL_REASON'; end if;
  insert into public.kuro_level_users(user_id,total_xp,current_level)
    values(p_user_id,0,1) on conflict(user_id) do nothing;
  select u.total_xp into v_current from public.kuro_level_users u where u.user_id=p_user_id for update;
  v_next:=v_current+p_amount;
  if v_next<0 then raise exception 'LEVEL_XP_CANNOT_BE_NEGATIVE'; end if;
  update public.kuro_level_users u set total_xp=v_next,
    current_level=public.kuro_level_for_xp(v_next),updated_at=pg_catalog.now()
    where u.user_id=p_user_id returning u.total_xp,u.current_level into total_xp,current_level;
  insert into public.kuro_level_ledger(user_id,xp_amount,total_xp_after,reason,created_by)
    values(p_user_id,p_amount,v_next,'管理者補正：'||v_reason,p_actor_user_id);
  return next;
end;
$$;

create or replace function public.kuro_level_award_from_win_event()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_system_enabled boolean:=true; v_default_xp integer:=100;
  v_game_enabled boolean; v_game_xp integer; v_award_xp integer;
  v_ledger_id uuid; v_total bigint;
begin
  select s.enabled,s.default_win_xp into v_system_enabled,v_default_xp
    from public.kuro_level_system_settings s where s.singleton=true;
  if not coalesce(v_system_enabled,true) then return new; end if;
  select r.enabled,r.xp_per_win into v_game_enabled,v_game_xp
    from public.kuro_level_game_rewards r where r.game_id=new.game_id;
  if found then
    if not coalesce(v_game_enabled,false) then return new; end if;
    v_award_xp:=coalesce(v_game_xp,0);
  else v_award_xp:=coalesce(v_default_xp,100); end if;
  if v_award_xp<=0 then return new; end if;
  insert into public.kuro_level_ledger(
    user_id,xp_amount,total_xp_after,source_game_id,source_mode,source_win_event_id,reason
  ) values(new.user_id,v_award_xp,0,new.game_id,new.mode,new.id,'ゲーム勝利')
  on conflict(source_win_event_id) where source_win_event_id is not null do nothing
  returning id into v_ledger_id;
  if v_ledger_id is null then return new; end if;
  insert into public.kuro_level_users(user_id,total_xp,current_level)
  values(new.user_id,v_award_xp,public.kuro_level_for_xp(v_award_xp))
  on conflict(user_id) do update
  set total_xp=public.kuro_level_users.total_xp+excluded.total_xp,
    current_level=public.kuro_level_for_xp(public.kuro_level_users.total_xp+excluded.total_xp),
    updated_at=pg_catalog.now()
  returning total_xp into v_total;
  update public.kuro_level_ledger set total_xp_after=v_total where id=v_ledger_id;
  return new;
end;
$$;

drop trigger if exists kuro_level_reward_from_verified_win on public.kuro_game_win_events;
create trigger kuro_level_reward_from_verified_win after insert on public.kuro_game_win_events
for each row execute function public.kuro_level_award_from_win_event();

revoke all on function public.kuro_level_xp_required(integer) from public,anon,authenticated;
revoke all on function public.kuro_level_for_xp(bigint) from public,anon,authenticated;
revoke all on function public.kuro_level_recalculate_all() from public,anon,authenticated;
revoke all on function public.kuro_level_admin_adjust(uuid,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.kuro_level_award_from_win_event() from public,anon,authenticated,service_role;
grant execute on function public.kuro_level_recalculate_all() to service_role;
grant execute on function public.kuro_level_admin_adjust(uuid,integer,text,uuid) to service_role;

comment on table public.kuro_level_users is 'KuroGamesの公開プレイヤーレベルと累計経験値。KURO COINとは独立。';
comment on table public.kuro_level_ledger is 'KuroGames XPの付与・管理者補正履歴。勝利イベントは一意制約で二重付与を防止。';

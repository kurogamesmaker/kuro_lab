-- KURO IP BAN: edge-enforced IPv4/IPv6/CIDR restrictions with immutable audit history.
create table if not exists public.kuro_ip_bans (
  id uuid primary key default gen_random_uuid(),
  network cidr not null,
  scope text not null check (scope in ('all', 'write')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint kuro_ip_bans_valid_period check (expires_at is null or expires_at > starts_at)
);
create index if not exists kuro_ip_bans_active_period_idx on public.kuro_ip_bans (starts_at, expires_at) where revoked_at is null;
create index if not exists kuro_ip_bans_network_idx on public.kuro_ip_bans (network);

create table if not exists public.kuro_ip_ban_logs (
  id bigint generated always as identity primary key,
  ban_id uuid references public.kuro_ip_bans(id) on delete set null,
  network cidr not null,
  scope text not null check (scope in ('all', 'write')),
  reason text not null,
  action text not null check (action in ('created', 'revoked')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists kuro_ip_ban_logs_created_at_idx on public.kuro_ip_ban_logs (created_at desc);

alter table public.kuro_ip_bans enable row level security;
alter table public.kuro_ip_ban_logs enable row level security;
revoke all on table public.kuro_ip_bans from anon, authenticated;
revoke all on table public.kuro_ip_ban_logs from anon, authenticated;
grant all on table public.kuro_ip_bans to service_role;
grant all on table public.kuro_ip_ban_logs to service_role;
grant usage, select on sequence public.kuro_ip_ban_logs_id_seq to service_role;

create or replace function public.kuro_ip_ban_check(p_ip text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_ip inet; v_ban record;
begin
  if p_ip is null or btrim(p_ip) = '' or position('/' in p_ip) > 0 then
    return jsonb_build_object('blocked', false);
  end if;
  begin v_ip := btrim(p_ip)::inet;
  exception when others then return jsonb_build_object('blocked', false);
  end;
  select b.scope, b.expires_at into v_ban
  from public.kuro_ip_bans b
  where b.revoked_at is null
    and b.starts_at <= pg_catalog.now()
    and (b.expires_at is null or b.expires_at > pg_catalog.now())
    and v_ip <<= b.network
  order by (b.scope = 'all') desc, pg_catalog.masklen(b.network) desc, b.created_at desc
  limit 1;
  if not found then return jsonb_build_object('blocked', false); end if;
  return jsonb_build_object('blocked', true, 'scope', v_ban.scope, 'expires_at', v_ban.expires_at);
end;
$function$;

create or replace function public.kuro_ip_ban_admin_list()
returns table (
  id uuid, network cidr, scope text, reason text, starts_at timestamptz,
  expires_at timestamptz, created_at timestamptz, created_by uuid,
  revoked_at timestamptz, revoked_by uuid
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return query
  select b.id, b.network, b.scope, b.reason, b.starts_at, b.expires_at,
         b.created_at, b.created_by, b.revoked_at, b.revoked_by
  from public.kuro_ip_bans b order by b.created_at desc limit 500;
end;
$function$;

create or replace function public.kuro_ip_ban_admin_logs(p_limit integer default 100)
returns table (
  id bigint, ban_id uuid, network cidr, scope text, reason text,
  action text, actor_user_id uuid, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return query
  select l.id, l.ban_id, l.network, l.scope, l.reason, l.action, l.actor_user_id, l.created_at
  from public.kuro_ip_ban_logs l
  order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$function$;

create or replace function public.kuro_ip_ban_admin_create(
  p_network text, p_scope text, p_reason text,
  p_starts_at timestamptz default now(), p_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_network cidr;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_scope text := coalesce(p_scope, '');
  v_id uuid;
begin
  if v_actor is null or not exists (select 1 from public.admin_users a where a.user_id = v_actor) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_network is null or btrim(p_network) = '' then
    raise exception 'IP_NETWORK_REQUIRED' using errcode = '22023';
  end if;
  begin v_network := btrim(p_network)::cidr;
  exception when others then raise exception 'INVALID_IP_OR_CIDR' using errcode = '22023';
  end;
  if (family(v_network) = 4 and masklen(v_network) < 8)
     or (family(v_network) = 6 and masklen(v_network) < 32) then
    raise exception 'IP_RANGE_TOO_BROAD' using errcode = '22023';
  end if;
  if v_scope not in ('all', 'write') then raise exception 'INVALID_IP_BAN_SCOPE' using errcode = '22023'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'INVALID_IP_BAN_REASON' using errcode = '22023'; end if;
  if p_starts_at is null or (p_expires_at is not null and p_expires_at <= p_starts_at) then
    raise exception 'INVALID_IP_BAN_PERIOD' using errcode = '22023';
  end if;
  insert into public.kuro_ip_bans (network, scope, reason, starts_at, expires_at, created_by)
  values (v_network, v_scope, v_reason, p_starts_at, p_expires_at, v_actor)
  returning id into v_id;
  insert into public.kuro_ip_ban_logs (ban_id, network, scope, reason, action, actor_user_id)
  values (v_id, v_network, v_scope, v_reason, 'created', v_actor);
  insert into public.admin_audit_logs (actor_user_id, action, metadata)
  values (v_actor, 'moderation.ip_ban.create',
    jsonb_build_object('ban_id', v_id, 'network', v_network::text, 'scope', v_scope,
      'reason', v_reason, 'starts_at', p_starts_at, 'expires_at', p_expires_at));
  return v_id;
end;
$function$;

create or replace function public.kuro_ip_ban_admin_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare v_actor uuid := (select auth.uid()); v_ban public.kuro_ip_bans%rowtype;
begin
  if v_actor is null or not exists (select 1 from public.admin_users a where a.user_id = v_actor) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_ban from public.kuro_ip_bans b where b.id = p_id for update;
  if not found then raise exception 'IP_BAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_ban.revoked_at is not null then return false; end if;
  update public.kuro_ip_bans set revoked_at = pg_catalog.now(), revoked_by = v_actor where id = p_id;
  insert into public.kuro_ip_ban_logs (ban_id, network, scope, reason, action, actor_user_id)
  values (v_ban.id, v_ban.network, v_ban.scope, v_ban.reason, 'revoked', v_actor);
  insert into public.admin_audit_logs (actor_user_id, action, metadata)
  values (v_actor, 'moderation.ip_ban.revoke',
    jsonb_build_object('ban_id', v_ban.id, 'network', v_ban.network::text, 'scope', v_ban.scope));
  return true;
end;
$function$;

revoke all on function public.kuro_ip_ban_check(text) from public;
revoke all on function public.kuro_ip_ban_admin_list() from public;
revoke all on function public.kuro_ip_ban_admin_logs(integer) from public;
revoke all on function public.kuro_ip_ban_admin_create(text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.kuro_ip_ban_admin_revoke(uuid) from public;
grant execute on function public.kuro_ip_ban_check(text) to anon, authenticated, service_role;
grant execute on function public.kuro_ip_ban_admin_list() to authenticated, service_role;
grant execute on function public.kuro_ip_ban_admin_logs(integer) to authenticated, service_role;
grant execute on function public.kuro_ip_ban_admin_create(text, text, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.kuro_ip_ban_admin_revoke(uuid) to authenticated, service_role;
comment on table public.kuro_ip_bans is 'KURO network-level IP/CIDR restrictions enforced at the Cloudflare Worker edge.';
comment on table public.kuro_ip_ban_logs is 'Append-only audit history for KURO IP bans.';

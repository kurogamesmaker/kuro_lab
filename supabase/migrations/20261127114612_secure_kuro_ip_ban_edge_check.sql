
create schema if not exists private;
create table if not exists private.kuro_ip_ban_edge_config (
  singleton boolean primary key default true check (singleton),
  key_hash text not null,
  updated_at timestamptz not null default now()
);
alter table private.kuro_ip_ban_edge_config enable row level security;
revoke all on table private.kuro_ip_ban_edge_config from public, anon, authenticated;
grant all on table private.kuro_ip_ban_edge_config to service_role;
insert into private.kuro_ip_ban_edge_config (singleton, key_hash)
values (true, encode(extensions.digest(convert_to('a688d957eff44813fafdf92eb4eba1837a8a853cd92958a12caf591e4d177f7e', 'UTF8'), 'sha256'), 'hex'))
on conflict (singleton) do update
set key_hash = excluded.key_hash, updated_at = now();

drop function if exists public.kuro_ip_ban_check(text);
create or replace function public.kuro_ip_ban_check(p_ip text, p_edge_key text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_ip inet; v_ban record;
begin
  if p_edge_key is null or char_length(p_edge_key) < 48 or not exists (
    select 1 from private.kuro_ip_ban_edge_config c
    where c.singleton and c.key_hash = encode(extensions.digest(convert_to(p_edge_key, 'UTF8'), 'sha256'), 'hex')
  ) then return jsonb_build_object('blocked', false); end if;
  if p_ip is null or btrim(p_ip) = '' or position('/' in p_ip) > 0 then
    return jsonb_build_object('blocked', false);
  end if;
  begin v_ip := btrim(p_ip)::inet;
  exception when others then return jsonb_build_object('blocked', false);
  end;
  select b.scope, b.expires_at into v_ban
  from public.kuro_ip_bans b
  where b.revoked_at is null and b.starts_at <= pg_catalog.now()
    and (b.expires_at is null or b.expires_at > pg_catalog.now()) and v_ip <<= b.network
  order by (b.scope = 'all') desc, pg_catalog.masklen(b.network) desc, b.created_at desc limit 1;
  if not found then return jsonb_build_object('blocked', false); end if;
  return jsonb_build_object('blocked', true, 'scope', v_ban.scope, 'expires_at', v_ban.expires_at);
end;
$function$;
revoke all on function public.kuro_ip_ban_check(text, text) from public;
grant execute on function public.kuro_ip_ban_check(text, text) to anon, authenticated, service_role;
comment on function public.kuro_ip_ban_check(text, text) is 'Internal Cloudflare edge IP ban check; valid edge key required.';

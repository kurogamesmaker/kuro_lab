
create or replace function public.kuro_store_studio_sales_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'purchaseCount', count(*)::bigint,
    'totalKC', coalesce(sum(amount_kc), 0)::bigint
  )
  from public.kuro_store_transactions
  where transaction_type = 'shop_purchase'
    and status = 'completed';
$function$;
revoke all on function public.kuro_store_studio_sales_summary()
  from public, anon, authenticated, service_role;
grant execute on function public.kuro_store_studio_sales_summary()
  to service_role;

create or replace function public.kuro_store_studio_set_member(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current_role text;
  v_current_active boolean;
  v_owner_count integer;
begin
  if p_actor_user_id is null or p_target_user_id is null
     or p_role not in ('owner','editor') or p_is_active is null then
    raise exception 'STUDIO_INVALID_MEMBER_CHANGE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kuro_store_studio_membership_guard', 0));

  if not exists (
    select 1 from public.kuro_store_studio_members
    where user_id = p_actor_user_id
      and role = 'owner'
      and is_active = true
  ) then
    raise exception 'STUDIO_OWNER_REQUIRED';
  end if;

  select role, is_active
    into v_current_role, v_current_active
  from public.kuro_store_studio_members
  where user_id = p_target_user_id
  for update;

  if found
     and v_current_role = 'owner'
     and v_current_active
     and (p_role <> 'owner' or not p_is_active) then
    select count(*)::integer
      into v_owner_count
    from public.kuro_store_studio_members
    where role = 'owner' and is_active = true;
    if v_owner_count <= 1 then
      raise exception 'STUDIO_LAST_OWNER';
    end if;
  end if;

  insert into public.kuro_store_studio_members(user_id, role, is_active, updated_at)
  values (p_target_user_id, p_role, p_is_active, now())
  on conflict (user_id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'userId', p_target_user_id,
    'role', p_role,
    'isActive', p_is_active
  );
end;
$function$;
revoke all on function public.kuro_store_studio_set_member(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.kuro_store_studio_set_member(uuid,uuid,text,boolean)
  to service_role;

comment on function public.kuro_store_studio_set_member(uuid,uuid,text,boolean) is
  'Owner-only Shop Studio member change with an advisory lock and last-owner protection.';

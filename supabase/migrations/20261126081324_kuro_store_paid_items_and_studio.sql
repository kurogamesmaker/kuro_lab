
-- KURO Store paid cosmetics + isolated Shop Studio access.
-- This is independent from the KURO Admin console.

alter table public.kuro_store_items
  drop constraint if exists kuro_store_items_category_check;
alter table public.kuro_store_items
  add constraint kuro_store_items_category_check
  check (category in ('avatar','frame','background','theme','nameplate','banner','other'));

alter table public.kuro_store_equipped_items
  drop constraint if exists kuro_store_equipped_items_slot_check;
alter table public.kuro_store_equipped_items
  add constraint kuro_store_equipped_items_slot_check
  check (slot in ('avatar','frame','background','theme','nameplate','banner'));

alter table public.kuro_store_transactions
  add column if not exists request_id uuid;
create unique index if not exists kuro_store_transactions_request_once_idx
  on public.kuro_store_transactions(user_id, request_id)
  where request_id is not null;

create table if not exists public.kuro_store_studio_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kuro_store_studio_members enable row level security;
revoke all on table public.kuro_store_studio_members from public, anon, authenticated;
grant all on table public.kuro_store_studio_members to service_role;

insert into public.kuro_store_studio_members(user_id, role, is_active)
select p.id, 'owner', true
from public.profiles p
join auth.users u on u.id = p.id
where lower(p.username) = 'kuro'
  and coalesce(u.is_anonymous, false) = false
on conflict (user_id) do update
set role = 'owner', is_active = true, updated_at = now();

create or replace function private.kuro_store_is_studio_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.kuro_store_studio_members m
    where m.user_id = auth.uid()
      and m.is_active = true
  );
$function$;
revoke all on function private.kuro_store_is_studio_member() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.kuro_store_is_studio_member() to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('kuro-store-assets', 'kuro-store-assets', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kuro_store_assets_insert_studio_members on storage.objects;
create policy kuro_store_assets_insert_studio_members
on storage.objects for insert to authenticated
with check (bucket_id = 'kuro-store-assets' and private.kuro_store_is_studio_member());

drop policy if exists kuro_store_assets_update_studio_members on storage.objects;
create policy kuro_store_assets_update_studio_members
on storage.objects for update to authenticated
using (bucket_id = 'kuro-store-assets' and private.kuro_store_is_studio_member())
with check (bucket_id = 'kuro-store-assets' and private.kuro_store_is_studio_member());

drop policy if exists kuro_store_assets_delete_studio_members on storage.objects;
create policy kuro_store_assets_delete_studio_members
on storage.objects for delete to authenticated
using (bucket_id = 'kuro-store-assets' and private.kuro_store_is_studio_member());

create or replace function public.kuro_store_set_equipped_item(
  p_user_id uuid,
  p_slot text,
  p_item_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_category text;
begin
  if p_user_id is null or p_slot not in ('avatar','frame','background','theme','nameplate','banner') then
    raise exception 'STORE_INVALID_EQUIPMENT_SLOT';
  end if;
  if p_item_id is null then
    delete from public.kuro_store_equipped_items
    where user_id = p_user_id and slot = p_slot;
    return jsonb_build_object('ok', true, 'equipped', false, 'slot', p_slot);
  end if;
  select i.category into v_category
  from public.kuro_store_items i
  join public.kuro_store_user_inventory inv
    on inv.item_id = i.id and inv.user_id = p_user_id
  where i.id = p_item_id;
  if not found or v_category <> p_slot then
    raise exception 'STORE_ITEM_NOT_OWNED_OR_SLOT_MISMATCH';
  end if;
  insert into public.kuro_store_equipped_items(user_id, slot, item_id, updated_at)
  values (p_user_id, p_slot, p_item_id, now())
  on conflict (user_id, slot) do update
    set item_id = excluded.item_id, updated_at = now();
  return jsonb_build_object('ok', true, 'equipped', true, 'slot', p_slot, 'itemId', p_item_id);
end;
$function$;
revoke all on function public.kuro_store_set_equipped_item(uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.kuro_store_set_equipped_item(uuid,text,uuid)
  to service_role;

create or replace function public.kuro_store_purchase_item(
  p_user_id uuid,
  p_item_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.kuro_store_items%rowtype;
  v_balance bigint;
  v_new_balance bigint;
  v_inventory_id uuid;
  v_existing public.kuro_store_transactions%rowtype;
begin
  if p_user_id is null or p_item_id is null or p_request_id is null then
    raise exception 'STORE_INVALID_REQUEST';
  end if;

  select * into v_existing
  from public.kuro_store_transactions
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_existing.item_id <> p_item_id then
      raise exception 'STORE_REQUEST_ID_REUSED';
    end if;
    return jsonb_build_object(
      'ok', true, 'alreadyOwned', true, 'alreadyPurchased', true,
      'charged', false, 'priceKC', v_existing.amount_kc
    );
  end if;

  select * into v_item
  from public.kuro_store_items
  where id = p_item_id
  for share;
  if not found or not v_item.is_active then
    raise exception 'STORE_ITEM_NOT_AVAILABLE';
  end if;
  if v_item.is_free or v_item.price_kc <= 0 then
    raise exception 'STORE_ITEM_NOT_PAID';
  end if;

  insert into public.kuro_coin_balances(user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.kuro_coin_balances
  where user_id = p_user_id
  for update;

  select id into v_inventory_id
  from public.kuro_store_user_inventory
  where user_id = p_user_id and item_id = p_item_id;
  if found then
    return jsonb_build_object('ok', true, 'alreadyOwned', true, 'charged', false, 'priceKC', 0);
  end if;

  if v_balance < v_item.price_kc then
    raise exception 'STORE_INSUFFICIENT_KC';
  end if;

  v_new_balance := v_balance - v_item.price_kc;

  insert into public.kuro_store_user_inventory(user_id, item_id, source)
  values (p_user_id, p_item_id, 'shop_purchase')
  returning id into v_inventory_id;

  insert into public.kuro_coin_ledger(
    user_id, amount, balance_after, transaction_type,
    description, metadata
  ) values (
    p_user_id, -v_item.price_kc, v_new_balance, 'shop_purchase',
    'KURO STORE購入：' || v_item.name,
    jsonb_build_object('itemId', v_item.id, 'itemKey', v_item.item_key, 'requestId', p_request_id)
  );

  insert into public.kuro_store_transactions(
    user_id, item_id, inventory_id, transaction_type, amount_kc,
    status, request_id
  ) values (
    p_user_id, p_item_id, v_inventory_id, 'shop_purchase',
    v_item.price_kc, 'completed', p_request_id
  );

  update public.kuro_coin_balances
  set balance = v_new_balance, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true, 'alreadyOwned', false, 'charged', true,
    'priceKC', v_item.price_kc, 'balance', v_new_balance,
    'inventoryId', v_inventory_id
  );
end;
$function$;
revoke all on function public.kuro_store_purchase_item(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.kuro_store_purchase_item(uuid,uuid,uuid)
  to service_role;

comment on table public.kuro_store_studio_members is
  'KURO Store Studio専用アクセス制御。KURO Adminの権限とは独立。';
comment on function public.kuro_store_purchase_item(uuid,uuid,uuid) is
  'Atomically charges KURO COIN, records the immutable ledger and grants one cosmetic item; service-role only.';

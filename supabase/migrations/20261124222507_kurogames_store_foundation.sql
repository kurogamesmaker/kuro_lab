-- KURO GAMES Store: server-managed catalog, inventory, equipment and claim history.
-- Initial release intentionally supports free claims only. KC purchases can be added later.

create table if not exists public.kuro_store_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique check (item_key ~ '^[a-z0-9][a-z0-9_-]{1,47}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  category text not null check (category in ('avatar','frame','background','theme','other')),
  icon text not null default '🎁' check (char_length(icon) between 1 and 12),
  image_url text,
  rarity text not null default 'common' check (rarity in ('common','rare','epic','legendary')),
  price_kc integer not null default 0 check (price_kc >= 0),
  is_free boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kuro_store_item_free_price_check check (is_free = (price_kc = 0)),
  constraint kuro_store_item_image_url_check check (
    image_url is null or
    (left(image_url, 1) = '/' and left(image_url, 2) <> '//') or
    image_url ~* '^https://'
  )
);

create index if not exists kuro_store_items_active_sort_idx on public.kuro_store_items(is_active, sort_order, created_at desc);

create table if not exists public.kuro_store_user_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.kuro_store_items(id) on delete restrict,
  source text not null default 'free_claim' check (source in ('free_claim','admin_grant','shop_purchase')),
  acquired_at timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists kuro_store_inventory_user_recent_idx on public.kuro_store_user_inventory(user_id, acquired_at desc);

create table if not exists public.kuro_store_equipped_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('avatar','frame','background','theme')),
  item_id uuid not null references public.kuro_store_items(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create table if not exists public.kuro_store_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.kuro_store_items(id) on delete restrict,
  inventory_id uuid references public.kuro_store_user_inventory(id) on delete set null,
  transaction_type text not null check (transaction_type in ('free_claim','shop_purchase','shop_refund')),
  amount_kc integer not null default 0 check (amount_kc >= 0),
  status text not null default 'completed' check (status in ('completed','refunded','failed')),
  created_at timestamptz not null default now()
);
create index if not exists kuro_store_transactions_user_recent_idx on public.kuro_store_transactions(user_id, created_at desc);

alter table public.kuro_store_items enable row level security;
alter table public.kuro_store_user_inventory enable row level security;
alter table public.kuro_store_equipped_items enable row level security;
alter table public.kuro_store_transactions enable row level security;

revoke all on table public.kuro_store_items, public.kuro_store_user_inventory, public.kuro_store_equipped_items, public.kuro_store_transactions from public, anon, authenticated;
grant all on table public.kuro_store_items, public.kuro_store_user_inventory, public.kuro_store_equipped_items, public.kuro_store_transactions to service_role;

create or replace function public.kuro_store_claim_free_item(p_user_id uuid, p_item_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_item public.kuro_store_items%rowtype;
  v_inventory_id uuid;
begin
  if p_user_id is null or p_item_id is null then raise exception 'STORE_INVALID_REQUEST'; end if;
  select * into v_item from public.kuro_store_items where id = p_item_id for share;
  if not found or not v_item.is_active then raise exception 'STORE_ITEM_NOT_AVAILABLE'; end if;
  if not v_item.is_free or v_item.price_kc <> 0 then raise exception 'STORE_ITEM_NOT_FREE'; end if;
  insert into public.kuro_store_user_inventory(user_id, item_id, source)
  values (p_user_id, p_item_id, 'free_claim')
  on conflict (user_id, item_id) do nothing
  returning id into v_inventory_id;
  if v_inventory_id is null then return jsonb_build_object('ok', true, 'alreadyOwned', true); end if;
  insert into public.kuro_store_transactions(user_id, item_id, inventory_id, transaction_type, amount_kc, status)
  values (p_user_id, p_item_id, v_inventory_id, 'free_claim', 0, 'completed');
  return jsonb_build_object('ok', true, 'alreadyOwned', false, 'inventoryId', v_inventory_id);
end;
$function$;
revoke all on function public.kuro_store_claim_free_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kuro_store_claim_free_item(uuid, uuid) to service_role;

create or replace function public.kuro_store_set_equipped_item(p_user_id uuid, p_slot text, p_item_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_category text;
begin
  if p_user_id is null or p_slot not in ('avatar','frame','background','theme') then raise exception 'STORE_INVALID_EQUIPMENT_SLOT'; end if;
  if p_item_id is null then
    delete from public.kuro_store_equipped_items where user_id = p_user_id and slot = p_slot;
    return jsonb_build_object('ok', true, 'equipped', false, 'slot', p_slot);
  end if;
  select i.category into v_category
  from public.kuro_store_items i
  join public.kuro_store_user_inventory inv on inv.item_id = i.id and inv.user_id = p_user_id
  where i.id = p_item_id;
  if not found or v_category <> p_slot then raise exception 'STORE_ITEM_NOT_OWNED_OR_SLOT_MISMATCH'; end if;
  insert into public.kuro_store_equipped_items(user_id, slot, item_id, updated_at)
  values (p_user_id, p_slot, p_item_id, now())
  on conflict (user_id, slot) do update set item_id = excluded.item_id, updated_at = now();
  return jsonb_build_object('ok', true, 'equipped', true, 'slot', p_slot, 'itemId', p_item_id);
end;
$function$;
revoke all on function public.kuro_store_set_equipped_item(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.kuro_store_set_equipped_item(uuid, text, uuid) to service_role;

insert into public.kuro_store_items(item_key, name, description, category, icon, rarity, price_kc, is_free, is_active, sort_order)
values
 ('kuro-neon-avatar','KUROネオンアバター','ストア公開記念のアバターアイテムです。','avatar','👾','common',0,true,true,10),
 ('kuro-star-avatar','スターアバター','プロフィールを星のアイコンで飾ります。','avatar','⭐','common',0,true,true,20),
 ('kuro-purple-frame','パープルフレーム','紫を基調にしたプロフィールフレームです。','frame','💜','common',0,true,true,30),
 ('kuro-neon-frame','ネオンフレーム','ネオンカラーのプロフィールフレームです。','frame','💠','rare',0,true,true,40),
 ('midnight-background','ミッドナイト背景','夜空をイメージしたプロフィール背景です。','background','🌌','common',0,true,true,50),
 ('cyber-background','サイバー背景','サイバー風のプロフィール背景です。','background','🟣','rare',0,true,true,60),
 ('kuro-classic-theme','KUROクラシックテーマ','落ち着いたダークカラーのテーマです。','theme','⚫','common',0,true,true,70),
 ('neon-theme','ネオンテーマ','紫と青のネオンをアクセントにしたテーマです。','theme','✨','rare',0,true,true,80)
on conflict (item_key) do nothing;

comment on table public.kuro_store_items is 'KURO GAMESストアの商品カタログ。商品公開状態と価格を管理します。';
comment on table public.kuro_store_user_inventory is 'KURO共通アカウントに紐づく所持アイテム。';
comment on table public.kuro_store_equipped_items is 'KUROストアでユーザーが選択した装備スロット。';
comment on table public.kuro_store_transactions is 'KUROストアの取得・購入・返金履歴。';

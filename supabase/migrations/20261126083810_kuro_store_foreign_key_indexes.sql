
create index if not exists kuro_store_equipped_items_item_id_idx
  on public.kuro_store_equipped_items(item_id);
create index if not exists kuro_store_items_created_by_idx
  on public.kuro_store_items(created_by)
  where created_by is not null;
create index if not exists kuro_store_transactions_inventory_id_idx
  on public.kuro_store_transactions(inventory_id)
  where inventory_id is not null;
create index if not exists kuro_store_transactions_item_id_idx
  on public.kuro_store_transactions(item_id);
create index if not exists kuro_store_user_inventory_item_id_idx
  on public.kuro_store_user_inventory(item_id);

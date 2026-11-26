alter table public.kuro_store_items
  add column if not exists deleted_at timestamptz;

create index if not exists kuro_store_items_deleted_at_idx
  on public.kuro_store_items (deleted_at)
  where deleted_at is not null;

comment on column public.kuro_store_items.deleted_at is
  'Soft-delete timestamp. Keeps owned cosmetics and transaction history intact.';

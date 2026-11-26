
create index if not exists kuro_store_transactions_completed_purchase_recent_idx
on public.kuro_store_transactions (created_at desc)
include (amount_kc, item_id)
where transaction_type = 'shop_purchase'
  and status = 'completed';

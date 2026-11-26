create or replace function public.kuro_store_discard_inventory_item(
  p_user_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item_id uuid;
  v_item_name text;
begin
  if p_user_id is null or p_inventory_id is null then
    raise exception 'STORE_INVALID_DISCARD_REQUEST';
  end if;

  select inventory.item_id, item.name
    into v_item_id, v_item_name
  from public.kuro_store_user_inventory as inventory
  join public.kuro_store_items as item on item.id = inventory.item_id
  where inventory.id = p_inventory_id
    and inventory.user_id = p_user_id
  for update of inventory;

  if not found then
    raise exception 'STORE_INVENTORY_ITEM_NOT_FOUND';
  end if;

  delete from public.kuro_store_equipped_items
  where user_id = p_user_id
    and item_id = v_item_id;

  delete from public.kuro_store_user_inventory
  where id = p_inventory_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'discarded', true,
    'itemId', v_item_id,
    'itemName', v_item_name
  );
end;
$function$;

revoke all on function public.kuro_store_discard_inventory_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kuro_store_discard_inventory_item(uuid, uuid) to service_role;
comment on function public.kuro_store_discard_inventory_item(uuid, uuid) is
  'Permanently removes one owned store inventory entry; auto-unequips it and preserves purchase history. Service-role only; caller must validate the user session.';

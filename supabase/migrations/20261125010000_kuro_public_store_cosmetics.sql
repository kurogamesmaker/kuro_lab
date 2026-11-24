-- Public, read-only view of only equipped KURO Store cosmetics.
-- No inventory history, transaction data or account-private fields are exposed.

create or replace function public.kuro_get_public_store_cosmetics(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    jsonb_object_agg(
      equipped.slot,
      jsonb_build_object(
        'itemKey', item.item_key,
        'name', item.name,
        'category', item.category,
        'icon', item.icon,
        'imageUrl', item.image_url,
        'rarity', item.rarity
      )
    ),
    '{}'::jsonb
  )
  from public.kuro_store_equipped_items as equipped
  join public.kuro_store_user_inventory as inventory
    on inventory.user_id = equipped.user_id
   and inventory.item_id = equipped.item_id
  join public.kuro_store_items as item
    on item.id = equipped.item_id
  where equipped.user_id = p_user_id
    and p_user_id is not null
    and exists (
      select 1 from public.profiles as profile
      where profile.id = p_user_id
    );
$function$;

revoke all on function public.kuro_get_public_store_cosmetics(uuid)
  from public, service_role;
grant execute on function public.kuro_get_public_store_cosmetics(uuid)
  to anon, authenticated;

comment on function public.kuro_get_public_store_cosmetics(uuid)
  is 'Returns only equipped cosmetic item display fields for public KURO profiles; never reveals inventory or transaction history.';

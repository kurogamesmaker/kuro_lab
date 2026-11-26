
-- Initial editable paid cosmetics for the new KURO Store.
-- Existing free items and existing user inventories remain untouched.
insert into public.kuro_store_items (
  item_key, name, description, category, icon, image_url, rarity,
  price_kc, is_free, is_active, sort_order, metadata
) values
(
  'neon-pulse-frame',
  'NEON PULSE フレーム',
  'プロフィールアイコンをネオンカラーで囲むフレーム。商品画像はShop Studioから差し替えできます。',
  'frame', '💠', null, 'rare',
  500, false, true, 40,
  jsonb_build_object('starter_item', true, 'artwork_status', 'studio_upload')
),
(
  'aurora-profile-wallpaper',
  'AURORA プロフィール壁紙',
  'プロフィール表示画面を彩る壁紙。商品画像はShop Studioからアップロードできます。',
  'background', '🌌', null, 'epic',
  800, false, true, 50,
  jsonb_build_object('starter_item', true, 'artwork_status', 'studio_upload')
)
on conflict (item_key) do nothing;

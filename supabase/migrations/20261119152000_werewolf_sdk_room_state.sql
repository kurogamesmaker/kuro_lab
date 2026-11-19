-- Common SDK-backed Werewolf room state.
-- Applied to the production Supabase project on 2026-11-19.

alter table public.game_online_rooms
  add column if not exists game_data jsonb,
  add column if not exists game_data_updated_at timestamptz;

insert into public.game_online_settings(game_id, features)
values (
  '903a4c45-37bb-4a4b-a259-a5a8245de998',
  '{"ranking":false,"cloudSave":false,"multiplayer":true}'::jsonb
)
on conflict (game_id) do update set
  features = jsonb_set(
    case
      when jsonb_typeof(public.game_online_settings.features) = 'object'
        then public.game_online_settings.features
      else '{}'::jsonb
    end,
    '{multiplayer}', 'true'::jsonb, true
  ),
  updated_at = now();

comment on column public.game_online_rooms.game_data
  is 'Game-specific room state for SDK-backed multiplayer games.';
comment on column public.game_online_rooms.game_data_updated_at
  is 'Optimistic concurrency timestamp for game_data updates.';

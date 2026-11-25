alter table public.game_studio_games
  add column if not exists mobile_html_content text;

comment on column public.game_studio_games.mobile_html_content is
  'Optional mobile-specific game HTML. When null, the player uses html_content as the compatibility fallback.';

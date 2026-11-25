alter table public.game_studio_games
  add column if not exists mobile_html_content text;

-- Preserve the current experience initially; each game can then diverge on mobile
-- without changing the PC document.
update public.game_studio_games
set mobile_html_content = html_content
where status = 'published'
  and mobile_html_content is null;

comment on column public.game_studio_games.mobile_html_content is
  'Optional mobile-specific game HTML. When null, the player uses html_content as the compatibility fallback.';

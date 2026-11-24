update public.game_studio_games
set html_content = regexp_replace(
  html_content,
  '/game-studio/kurog-online\\.js\\?v=[A-Za-z0-9_-]+',
  '/game-studio/kurog-online.js?v=20261125-unified-ranking-metrics1',
  'g'
)
where html_content ~ '/game-studio/kurog-online\\.js\\?v=[A-Za-z0-9_-]+'
returning id,title;

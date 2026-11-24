update public.game_studio_games
set html_content = replace(
  html_content,
  '/game-studio/kurog-online.js?v=20261125-storecosmetics3',
  '/game-studio/kurog-online.js?v=20261125-unified-ranking-metrics1'
)
where html_content like '%/game-studio/kurog-online.js?v=20261125-storecosmetics3%'
returning id, title;

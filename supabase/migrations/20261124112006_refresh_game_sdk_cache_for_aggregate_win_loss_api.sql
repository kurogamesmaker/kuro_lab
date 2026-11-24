update public.game_studio_games
set html_content = replace(
  html_content,
  '/game-studio/kurog-online.js?v=20261124-aggregate-records1',
  '/game-studio/kurog-online.js?v=20261124-aggregate-win-loss1'
)
where html_content like '%/game-studio/kurog-online.js?v=20261124-aggregate-records1%';
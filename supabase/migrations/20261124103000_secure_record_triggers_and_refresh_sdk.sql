-- Restrict unified record trigger functions to the installed trigger execution path.
revoke all on function public.kuro_sync_win_event_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_tictactoe_event_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_sevens_result_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_number_session_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_werewolf_score_to_user_records() from public, anon, authenticated;

-- Refresh cache key for SDK consumers in the three published game documents.
update public.game_studio_games
set html_content =
  replace(
    replace(
      replace(
        html_content,
        '/game-studio/kurog-online.js?v=20261123-wins-online-v1',
        '/game-studio/kurog-online.js?v=20261124-userstats1'
      ),
      '/game-studio/kurog-online.js?v=20261122netlight1',
      '/game-studio/kurog-online.js?v=20261124-userstats1'
    ),
    '/game-studio/kurog-online.js"',
    '/game-studio/kurog-online.js?v=20261124-userstats1"'
  ),
  updated_at = now()
where id in (
  'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
  '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid,
  '5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid
)
and html_content ilike '%/game-studio/kurog-online.js%';

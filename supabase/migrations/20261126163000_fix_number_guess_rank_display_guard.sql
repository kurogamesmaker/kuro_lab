-- Keep the in-game result message threshold aligned with the server's
-- verified 400ms minimum for Number Guess time-attack rankings.
update public.game_studio_games
set html_content = replace(html_content, 'serverElapsedMs<500', 'serverElapsedMs<400'),
    updated_at = now()
where id = 'bb466662-5423-48e6-bbcc-d19da50ba818'::uuid
  and position('serverElapsedMs<500' in html_content) > 0;

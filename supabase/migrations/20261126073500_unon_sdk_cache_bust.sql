-- Ensure the published UNON game loads the updated matchmaking SDK bundle.
UPDATE public.game_studio_games
SET html_content = replace(
  html_content,
  '20261125-unified-ranking-metrics1',
  '20261126-unon-matchmaking-four1'
),
updated_at = now()
WHERE id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  AND html_content LIKE '%20261125-unified-ranking-metrics1%';

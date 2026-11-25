-- Forward the currently selected UNON rule mode for cancel requests.
-- The online Edge Function validates ruleMode for every UNON matchmaking action.
UPDATE public.game_studio_games
SET html_content = replace(
  html_content,
  'cancelMatch:async()=>{const kg=await ensureSDK();return kg.multiplayer.cancelUnoRandomMatch()}',
  'cancelMatch:async()=>{const kg=await ensureSDK();return kg.multiplayer.cancelUnoRandomMatch(ruleModeNow())}'
),
updated_at = now()
WHERE id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  AND html_content LIKE '%cancelMatch:async()=>{const kg=await ensureSDK();return kg.multiplayer.cancelUnoRandomMatch()}%';

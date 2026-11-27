ALTER TABLE public.game_studio_games
  ADD COLUMN IF NOT EXISTS extra_js_content text NOT NULL DEFAULT '';

UPDATE public.game_studio_games
SET extra_js_content = COALESCE(pc_extension_js_content, '')
WHERE COALESCE(extra_js_content, '') = '';

COMMENT ON COLUMN public.game_studio_games.extra_js_content IS
  'Optional additional JavaScript used by the unified game build on all devices.';

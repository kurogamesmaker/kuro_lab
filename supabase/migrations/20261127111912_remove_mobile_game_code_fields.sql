BEGIN;

UPDATE public.game_studio_games
SET extra_js_content = COALESCE(pc_extension_js_content, '')
WHERE COALESCE(extra_js_content, '') = ''
  AND COALESCE(pc_extension_js_content, '') <> '';

ALTER TABLE public.game_studio_games
  DROP CONSTRAINT IF EXISTS game_studio_games_platform_code_nonempty_chk;

ALTER TABLE public.game_studio_games
  DROP COLUMN IF EXISTS mobile_html_content,
  DROP COLUMN IF EXISTS mobile_extension_js_content,
  DROP COLUMN IF EXISTS pc_extension_js_content;

COMMENT ON COLUMN public.game_studio_games.html_content IS
  'Single responsive HTML and CSS document used across all devices.';
COMMENT ON COLUMN public.game_studio_games.shared_js_content IS
  'Shared JavaScript game logic used across all devices.';
COMMENT ON COLUMN public.game_studio_games.extra_js_content IS
  'Optional additional JavaScript used by the unified game build across all devices.';

COMMIT;

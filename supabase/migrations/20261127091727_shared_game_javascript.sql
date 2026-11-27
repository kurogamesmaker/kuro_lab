ALTER TABLE public.game_studio_games
  ADD COLUMN IF NOT EXISTS shared_js_content text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pc_extension_js_content text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mobile_extension_js_content text NOT NULL DEFAULT '';

WITH extracted AS (
  SELECT
    id,
    CASE
      WHEN position('//# sourceURL=KURO_GAME_PREVIEW.js' IN html_content) > 0 THEN
        btrim(regexp_replace(
          regexp_replace(
            substring(html_content FROM 1 FOR position('//# sourceURL=KURO_GAME_PREVIEW.js' IN html_content)),
            '(?s)^.*<script[^>]*>', ''
          ),
          '(?s)[[:space:]]*//# sourceURL=KURO_GAME_PREVIEW[.]js.*$', ''
        ))
      ELSE ''
    END AS pc_js,
    CASE
      WHEN position('//# sourceURL=KURO_GAME_PREVIEW.js' IN mobile_html_content) > 0 THEN
        btrim(regexp_replace(
          regexp_replace(
            substring(mobile_html_content FROM 1 FOR position('//# sourceURL=KURO_GAME_PREVIEW.js' IN mobile_html_content)),
            '(?s)^.*<script[^>]*>', ''
          ),
          '(?s)[[:space:]]*//# sourceURL=KURO_GAME_PREVIEW[.]js.*$', ''
        ))
      ELSE ''
    END AS mobile_js
  FROM public.game_studio_games
)
UPDATE public.game_studio_games AS game
SET
  shared_js_content = CASE
    WHEN extracted.pc_js = extracted.mobile_js THEN extracted.pc_js
    ELSE ''
  END,
  pc_extension_js_content = CASE
    WHEN extracted.pc_js <> extracted.mobile_js THEN extracted.pc_js
    ELSE ''
  END,
  mobile_extension_js_content = CASE
    WHEN extracted.pc_js <> extracted.mobile_js THEN extracted.mobile_js
    ELSE ''
  END,
  html_content = regexp_replace(
    game.html_content,
    '(?s)<script[^>]*>.*?//# sourceURL=KURO_GAME_PREVIEW[.]js.*?</script[[:space:]]*>',
    '',
    'g'
  ),
  mobile_html_content = regexp_replace(
    game.mobile_html_content,
    '(?s)<script[^>]*>.*?//# sourceURL=KURO_GAME_PREVIEW[.]js.*?</script[[:space:]]*>',
    '',
    'g'
  )
FROM extracted
WHERE game.id = extracted.id;

COMMENT ON COLUMN public.game_studio_games.shared_js_content IS
  'Shared game logic JavaScript used by both PC and mobile. Stored once and injected by the game launcher.';
COMMENT ON COLUMN public.game_studio_games.pc_extension_js_content IS
  'Optional PC-only UI/input JavaScript. Existing divergent legacy scripts are preserved here during migration.';
COMMENT ON COLUMN public.game_studio_games.mobile_extension_js_content IS
  'Optional mobile-only UI/input JavaScript. Existing divergent legacy scripts are preserved here during migration.';

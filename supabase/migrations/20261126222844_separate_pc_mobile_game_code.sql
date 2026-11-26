DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.game_studio_games
    WHERE html_content IS NULL
       OR btrim(html_content) = ''
       OR mobile_html_content IS NULL
       OR btrim(mobile_html_content) = ''
  ) THEN
    RAISE EXCEPTION 'PC and mobile game code must both be present before platform isolation can be enforced';
  END IF;
END
$$;

ALTER TABLE public.game_studio_games
  ALTER COLUMN mobile_html_content SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.game_studio_games'::regclass
      AND conname = 'game_studio_games_platform_code_nonempty_chk'
  ) THEN
    ALTER TABLE public.game_studio_games
      ADD CONSTRAINT game_studio_games_platform_code_nonempty_chk
      CHECK (btrim(html_content) <> '' AND btrim(mobile_html_content) <> '');
  END IF;
END
$$;

COMMENT ON COLUMN public.game_studio_games.html_content IS
  'PC platform game document (HTML, CSS, JavaScript). Edited and served independently from mobile_html_content. No mobile fallback is applied.';

COMMENT ON COLUMN public.game_studio_games.mobile_html_content IS
  'Mobile platform game document (HTML, CSS, JavaScript). Required and edited/served independently from html_content. No PC fallback is applied.';

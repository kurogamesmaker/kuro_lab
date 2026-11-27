WITH extracted AS (
  SELECT
    id,
    COALESCE((regexp_match(html_content,
      '(?is)<script>(.*?)</script[[:space:]]*>'
    ))[1], '') ||
    CASE WHEN title = '人狼ゲーム' THEN E'\n\n' || COALESCE((regexp_match(html_content,
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>(.*?)</script[[:space:]]*>'
    ))[1], '') ELSE '' END AS pc_js,
    COALESCE((regexp_match(mobile_html_content,
      '(?is)<script>(.*?)</script[[:space:]]*>'
    ))[1], '') ||
    CASE WHEN title = '人狼ゲーム' THEN E'\n\n' || COALESCE((regexp_match(mobile_html_content,
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>(.*?)</script[[:space:]]*>'
    ))[1], '') ELSE '' END AS mobile_js
  FROM public.game_studio_games
  WHERE title IN ('NEON DEFENDER ULTIMATE EDITION','ブロックブラスト','人狼ゲーム')
)
UPDATE public.game_studio_games AS game
SET
  shared_js_content = extracted.pc_js,
  html_content = CASE
    WHEN game.title = '人狼ゲーム' THEN regexp_replace(
      regexp_replace(game.html_content,
        '(?is)<script>(.*?)</script[[:space:]]*>', '', ''),
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>.*?</script[[:space:]]*>', '', ''
    )
    ELSE regexp_replace(
      game.html_content,
      '(?is)<script>(.*?)</script[[:space:]]*>', '', ''
    )
  END,
  mobile_html_content = CASE
    WHEN game.title = '人狼ゲーム' THEN regexp_replace(
      regexp_replace(game.mobile_html_content,
        '(?is)<script>(.*?)</script[[:space:]]*>', '', ''),
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>.*?</script[[:space:]]*>', '', ''
    )
    ELSE regexp_replace(
      game.mobile_html_content,
      '(?is)<script>(.*?)</script[[:space:]]*>', '', ''
    )
  END
FROM extracted
WHERE game.id = extracted.id
  AND extracted.pc_js = extracted.mobile_js
  AND extracted.pc_js <> ''
  AND game.shared_js_content = '';

WITH extracted AS (
  SELECT
    id,
    CASE
      WHEN title = '大富豪' THEN
        COALESCE((regexp_match(html_content,
          '(?is)<script[[:space:]]+type=["'']module["''][^>]*>(.*?)</script[[:space:]]*>'
        ))[1], '')
      WHEN title = '数字当て' THEN
        COALESCE((regexp_match(html_content,
          '(?is)<script[[:space:]]*>(.*?)</script[[:space:]]*>'
        ))[1], '')
      ELSE ''
    END AS pc_js,
    CASE
      WHEN title = '大富豪' THEN
        COALESCE((regexp_match(mobile_html_content,
          '(?is)<script[[:space:]]+type=["'']module["''][^>]*>(.*?)</script[[:space:]]*>'
        ))[1], '')
      WHEN title = '数字当て' THEN
        COALESCE((regexp_match(mobile_html_content,
          '(?is)<script[[:space:]]*>(.*?)</script[[:space:]]*>'
        ))[1], '')
      ELSE ''
    END AS mobile_js
  FROM public.game_studio_games
  WHERE title IN ('大富豪','数字当て')
)
UPDATE public.game_studio_games AS game
SET
  pc_extension_js_content = extracted.pc_js,
  mobile_extension_js_content = extracted.mobile_js,
  html_content = CASE
    WHEN game.title = '大富豪' THEN regexp_replace(
      game.html_content,
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>.*?</script[[:space:]]*>',
      '',
      'g'
    )
    ELSE regexp_replace(
      game.html_content,
      '(?is)<script[[:space:]]*>(.*?)</script[[:space:]]*>',
      '',
      'g'
    )
  END,
  mobile_html_content = CASE
    WHEN game.title = '大富豪' THEN regexp_replace(
      game.mobile_html_content,
      '(?is)<script[[:space:]]+type=["'']module["''][^>]*>.*?</script[[:space:]]*>',
      '',
      'g'
    )
    ELSE regexp_replace(
      game.mobile_html_content,
      '(?is)<script[[:space:]]*>(.*?)</script[[:space:]]*>',
      '',
      'g'
    )
  END
FROM extracted
WHERE game.id = extracted.id
  AND length(extracted.pc_js) > 0
  AND length(extracted.mobile_js) > 0;

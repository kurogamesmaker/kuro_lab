UPDATE public.game_studio_games
SET
  shared_js_content = replace(
    pc_extension_js_content,
    'serverElapsedMs<400',
    'serverElapsedMs<(window.KURO_GAMES_PLATFORM==="mobile"?500:400)'
  ),
  pc_extension_js_content = '',
  mobile_extension_js_content = ''
WHERE title = '数字当て'
  AND pc_extension_js_content <> ''
  AND mobile_extension_js_content <> ''
  AND length(pc_extension_js_content) = length(mobile_extension_js_content)
  AND (
    length(pc_extension_js_content) - length(replace(pc_extension_js_content, 'serverElapsedMs<400', ''))
  ) = length('serverElapsedMs<400')
  AND (
    length(mobile_extension_js_content) - length(replace(mobile_extension_js_content, 'serverElapsedMs<500', ''))
  ) = length('serverElapsedMs<500')
  AND replace(pc_extension_js_content,'serverElapsedMs<400','serverElapsedMs<500')
      = mobile_extension_js_content;

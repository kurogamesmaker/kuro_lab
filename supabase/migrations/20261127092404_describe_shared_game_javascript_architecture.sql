COMMENT ON COLUMN public.game_studio_games.html_content IS
  'PC platform HTML and CSS document. Game JavaScript is stored in shared_js_content and optional pc_extension_js_content. No mobile fallback is applied.';
COMMENT ON COLUMN public.game_studio_games.mobile_html_content IS
  'Mobile platform HTML and CSS document. Game JavaScript is stored in shared_js_content and optional mobile_extension_js_content. No PC fallback is applied.';
COMMENT ON COLUMN public.game_studio_games.shared_js_content IS
  'Shared game logic JavaScript used by both PC and mobile. Stored once and injected by the game launcher.';
COMMENT ON COLUMN public.game_studio_games.pc_extension_js_content IS
  'Optional PC-specific UI/input JavaScript. Existing divergent legacy scripts are preserved here during migration and can be refactored progressively.';
COMMENT ON COLUMN public.game_studio_games.mobile_extension_js_content IS
  'Optional mobile-specific UI/input JavaScript. Existing divergent legacy scripts are preserved here during migration and can be refactored progressively.';

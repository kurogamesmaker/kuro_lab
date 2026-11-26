DO $migration$
DECLARE
  v_old text := $old$/game-studio/kurog-online.js?v=20261125-unified-ranking-metrics1$old$;
  v_new text := $new$/game-studio/kurog-online.js?v=20261126-daifugo-ranking-status2$new$;
  v_changed integer;
BEGIN
  UPDATE public.game_studio_games
  SET html_content = replace(html_content, v_old, v_new)
  WHERE id = '2eb37847-1b7e-43e4-ad98-901d5b830ac4'
    AND position(v_old in html_content) > 0;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Daifugo SDK URL to update; updated % rows', v_changed;
  END IF;
END
$migration$;

DO $migration$
DECLARE
  v_old text := $old$
      status.textContent=(message.indexOf('KUROアカウント')>=0 || message.indexOf('ログイン')>=0)
        ? 'ランキングを見るにはKUROアカウントでログインしてください。'
        : 'ランキングを取得できませんでした。時間をおいて再度お試しください。';
$old$;
  v_new text := $new$
      if(mode==='wins-bot' && message.indexOf('サーバー検証')>=0){
        status.textContent='CPU戦ランキングはサーバー検証対応中のため、一時停止しています。オンライン対戦ランキングは利用できます。';
      }else{
        status.textContent=(message.indexOf('KUROアカウント')>=0 || message.indexOf('ログイン')>=0)
          ? 'ランキングを見るにはKUROアカウントでログインしてください。'
          : 'ランキングを取得できませんでした。時間をおいて再度お試しください。';
      }
$new$;
  v_changed integer;
BEGIN
  UPDATE public.game_studio_games
  SET html_content = replace(html_content, v_old, v_new)
  WHERE id = '2eb37847-1b7e-43e4-ad98-901d5b830ac4'
    AND position(v_old in html_content) > 0;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Daifugo ranking UI block to update; updated % rows', v_changed;
  END IF;
END
$migration$;

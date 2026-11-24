update public.game_studio_games
set html_content=replace(replace(html_content,$$async function submitDaifugoLoss(){
    const status=$('rankSubmitStatus');
    if(status) status.textContent='CPU対戦の敗北数を記録しています...';
    try{
      if(!window.KuroGames || !window.KuroGames.stats || typeof window.KuroGames.stats.recordResult!=='function'){
        throw new Error('結果記録SDKを読み込めませんでした。');
      }
      const config=await window.KuroGames.init({gameId:'2eb37847-1b7e-43e4-ad98-901d5b830ac4'});
      if(!config.features || config.features.ranking!==true) throw new Error('ランキング機能が無効になっています。');
      await window.KuroGames.stats.recordResult({
        mode:'wins-bot',
        result:'loss',
        submissionId:rankingRoundId,
        metadata:{source:'daifugo-bot',opponentMode:'bot'}
      });
      if(status) status.textContent='CPU対戦の敗北数を記録しました。';
    }catch(error){
      if(status) status.textContent='敗北数を記録できませんでした。通信状態を確認してください。';
      console.warn('大富豪CPU敗北記録:',error);
    }
  }

$$,''),$$if(!rankingSubmittedThisGame){
      rankingSubmittedThisGame=true;
      if(daifugoOnlineGameActive){
        $('rankSubmitStatus').textContent='オンラインの勝敗数は対局サーバーで記録しました。';
      }else if(playerWon){
        submitDaifugoWin('wins-bot');
      }else{
        submitDaifugoLoss();
      }
    }$$,$$if(!rankingSubmittedThisGame){
      rankingSubmittedThisGame=true;
      if(daifugoOnlineGameActive){
        $('rankSubmitStatus').textContent='オンラインの勝敗数は対局サーバーで記録しました。';
      }else if(playerWon){
        submitDaifugoWin('wins-bot');
      }else{
        $('rankSubmitStatus').textContent='CPU戦の敗北数は、サーバー検証対応後に集計されます。';
      }
    }$$)
where id='2eb37847-1b7e-43e4-ad98-901d5b830ac4'
returning
 (length(html_content)-length(replace(html_content,'async function submitDaifugoLoss()','')))/length('async function submitDaifugoLoss()') as remaining_loss_functions,
 position('submitDaifugoLoss()' in html_content)>0 as old_loss_call_remains,
 position('サーバー検証対応後に集計されます。' in html_content)>0 as cpu_loss_message_added;
update public.game_studio_games
set html_content=replace(html_content,$$rankingRoundId=(window.crypto && typeof window.crypto.randomUUID==='function')
      ? window.crypto.randomUUID()
      : 'daifugo-'+Date.now()+'-'+Math.random().toString(36).slice(2);$$,$$rankingRoundId=(window.crypto && typeof window.crypto.randomUUID==='function')
      ? window.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
          const r=Math.random()*16|0;
          return (c==='x'?r:(r&0x3|0x8)).toString(16);
        });$$)
where id='2eb37847-1b7e-43e4-ad98-901d5b830ac4'
returning position('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx' in html_content)>0 as uuid_fallback_added;
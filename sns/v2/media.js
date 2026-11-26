/* KURO SNS shared photo upload, compression and rendering */
(function () {
  'use strict';
  const PUB='kuro-sns-public-media', PRIV='kuro-sns-private-media';
  const MAX=4, MAX_SOURCE=12*1024*1024, MAX_UPLOAD=5*1024*1024;
  const TYPES=new Set(['image/jpeg','image/png','image/webp']);
  const selected={post:[],chat:[],publicChat:[]};
  const db=()=>window.kuroSNSDB||window.kuroGamesDB||null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const say=s=>typeof window.showToast==='function'?window.showToast(s):console.warn(s);
  const uid=()=>{try{return crypto.randomUUID()}catch(_){return Date.now().toString(36)+Math.random().toString(36).slice(2)}};
  async function imageBlob(file){
    if(!TYPES.has(file.type))throw Error('JPEG・PNG・WebP画像を選択してください。');
    if(file.size>MAX_SOURCE)throw Error('画像は12MB以下にしてください。');
    let bitmap;
    try{
      if(window.createImageBitmap)bitmap=await createImageBitmap(file);
      else bitmap=await new Promise((resolve,reject)=>{const im=new Image(),u=URL.createObjectURL(file);im.onload=()=>{URL.revokeObjectURL(u);resolve(im)};im.onerror=()=>{URL.revokeObjectURL(u);reject(Error('画像を読み込めませんでした。'))};im.src=u});
      const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
      if(!w||!h)throw Error('画像サイズを確認できません。');
      const scale=Math.min(1,1920/Math.max(w,h)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('画像を処理できませんでした。');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const toBlob=(type,q)=>new Promise(resolve=>canvas.toBlob(resolve,type,q));
      let blob=await toBlob('image/webp',.84);
      if(!blob||blob.type!=='image/webp')blob=await toBlob('image/jpeg',.82);
      if(!blob)throw Error('画像の圧縮に失敗しました。');
      if(blob.size>MAX_UPLOAD)blob=await toBlob('image/jpeg',.65);
      if(!blob||blob.size>MAX_UPLOAD)throw Error('圧縮後も画像が大きすぎます。別の画像を選んでください。');
      return {blob,width:canvas.width,height:canvas.height};
    }finally{if(bitmap&&typeof bitmap.close==='function')bitmap.close()}
  }
  function revoke(items){(items||[]).forEach(x=>{try{URL.revokeObjectURL(x.url)}catch(_){}})}
  function preview(type){
    const id=type==='publicChat'?'publicChatImagePreview':type+'ImagePreview',box=document.getElementById(id);
    if(!box)return;
    box.innerHTML=selected[type].map((x,i)=>'<div class="kuro-sns-preview-item"><img src="'+esc(x.url)+'" alt="選択した写真"><button type="button" onclick="KuroSNSMedia.removeSelected(\''+type+'\','+i+')" aria-label="写真を削除">×</button></div>').join('');
    box.classList.toggle('hidden',!selected[type].length);
  }
  async function onPick(type,input){
    const files=Array.from(input.files||[]);input.value='';if(!files.length)return;
    if(type==='publicChat'){
      try{const a=await db().auth.getUser();if(a.error||!a.data?.user){say('オープンチャットで写真を送るにはログインしてください');window.openAuthModal?.('signin');return}}
      catch(e){say(e.message||'ログイン状態を確認できません。');return}
    }
    const next=selected[type].slice();
    for(const file of files){
      if(!TYPES.has(file.type)){say('JPEG・PNG・WebP画像を選択してください');continue}
      if(file.size>MAX_SOURCE){say('画像は12MB以下にしてください');continue}
      if(next.length>=MAX){say('写真は1回につき最大4枚です');break}
      if(next.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified))continue;
      next.push({file,url:URL.createObjectURL(file)});
    }
    revoke(selected[type]);selected[type]=next;preview(type);
  }
  function clear(type){if(!selected[type])return;revoke(selected[type]);selected[type]=[];preview(type)}
  function removeSelected(type,i){if(!selected[type]?.[i])return;revoke([selected[type].splice(i,1)[0]]);preview(type)}
  function getSelected(type){return(selected[type]||[]).map(x=>x.file)}
  async function upload(client,scope,entityId,files){
    const list=Array.from(files||[]);if(!list.length)return[];
    const auth=await client.auth.getUser(),user=auth.data?.user;if(auth.error||!user)throw Error('写真を送るにはログインしてください。');
    const bucket=scope==='dm'||scope==='group'?PRIV:PUB,out=[];
    try{
      for(const file of list.slice(0,MAX)){
        const p=await imageBlob(file),ext=p.blob.type==='image/webp'?'webp':'jpg';
        const path=(scope==='post'||scope==='open-chat')?user.id+'/'+scope+'/'+uid()+'.'+ext:user.id+'/'+scope+'/'+String(entityId||'')+'/'+uid()+'.'+ext;
        if((scope==='dm'||scope==='group')&&!entityId)throw Error('会話IDを確認できません。');
        const res=await client.storage.from(bucket).upload(path,p.blob,{contentType:p.blob.type,cacheControl:'31536000',upsert:false});
        if(res.error)throw res.error;
        out.push({bucket,path,content_type:p.blob.type,width:p.width,height:p.height,size:p.blob.size});
      }
      return out;
    }catch(e){await remove(client,out);throw e}
  }
  async function remove(client,media){
    const groups={};(media||[]).forEach(x=>{if(x?.path&&(x.bucket===PUB||x.bucket===PRIV))(groups[x.bucket]||=[]).push(x.path)});
    await Promise.all(Object.entries(groups).map(async([b,paths])=>{const r=await client.storage.from(b).remove(paths);if(r.error)console.warn('KURO SNS photo cleanup failed',r.error)}));
  }
  function render(items,urls,isPublic){
    const valid=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.path==='string'&&x.bucket===(isPublic?PUB:PRIV)).slice(0,MAX);
    if(!valid.length)return'';
    const cells=valid.map(x=>{
      const url=isPublic?db().storage.from(PUB).getPublicUrl(x.path).data.publicUrl:urls.get(x.path);
      return url?'<button type="button" class="kuro-sns-media-tile" data-kuro-media-open="'+esc(url)+'" aria-label="写真を拡大"><img loading="lazy" decoding="async" src="'+esc(url)+'" alt="写真"></button>':'';
    }).join('');
    return cells?'<div class="kuro-sns-media-grid kuro-sns-media-count-'+valid.length+'">'+cells+'</div>':'';
  }
  function renderPublic(media){try{return render(media,new Map(),true)}catch(e){console.warn(e);return''}}
  async function renderPrivateBatch(client,messages){
    const paths=[...new Set((messages||[]).flatMap(m=>(Array.isArray(m.media)?m.media:[]).filter(x=>x?.bucket===PRIV&&typeof x.path==='string').map(x=>x.path)))],urls=new Map();
    for(let offset=0;offset<paths.length;offset+=50){const chunk=paths.slice(offset,offset+50);const r=await client.storage.from(PRIV).createSignedUrls(chunk,3600);if(r.error){console.warn('KURO SNS private photo URL failed',r.error);continue}(r.data||[]).forEach(x=>{const u=x.signedUrl||x.signedURL;if(x.path&&u)urls.set(x.path,u)})}
    const byId=new Map();(messages||[]).forEach(m=>byId.set(String(m.id),render(m.media,urls,false)));return byId;
  }
  async function renderPrivateOne(client,media){const m=await renderPrivateBatch(client,[{id:'preview',media}]);return m.get('preview')||''}
  function viewer(){
    let v=document.getElementById('kuroSNSMediaViewer');if(v)return v;
    v=document.createElement('div');v.id='kuroSNSMediaViewer';v.className='kuro-sns-media-viewer hidden';v.innerHTML='<button type="button" class="kuro-sns-media-viewer-close" aria-label="閉じる">×</button><img alt="拡大写真">';document.body.appendChild(v);
    v.addEventListener('click',e=>{if(e.target===v||e.target.closest('.kuro-sns-media-viewer-close'))v.classList.add('hidden')});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')v.classList.add('hidden')});return v;
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-kuro-media-open]');if(!b)return;e.preventDefault();const v=viewer();v.querySelector('img').src=b.getAttribute('data-kuro-media-open');v.classList.remove('hidden')});
  const css=document.createElement('style');css.id='kuro-sns-media-style';css.textContent=[
    '.kuro-sns-media-preview{display:flex;gap:8px;flex-wrap:wrap;width:100%;padding:4px 0}.kuro-sns-media-preview.hidden{display:none!important}',
    '.kuro-sns-preview-item{position:relative;width:76px;height:76px;border-radius:12px;overflow:hidden;border:1px solid #52525b;background:#18181b}.kuro-sns-preview-item img{width:100%;height:100%;object-fit:cover}.kuro-sns-preview-item button{position:absolute;right:4px;top:4px;width:24px;height:24px;min-height:24px!important;border-radius:50%;background:#111c;color:#fff;font-size:18px;line-height:1}',
    '.kuro-sns-photo-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;min-height:44px;border:1px solid rgba(148,163,184,.3);border-radius:12px;padding:0 12px;background:rgba(255,255,255,.04);color:inherit}',
    '.kuro-sns-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px;max-width:560px}.kuro-sns-media-grid.kuro-sns-media-count-1{grid-template-columns:minmax(0,1fr);max-width:460px}.kuro-sns-media-tile{display:block;min-width:0;overflow:hidden;padding:0!important;border:0;border-radius:14px;background:#18181b;aspect-ratio:1.2}.kuro-sns-media-count-1 .kuro-sns-media-tile{aspect-ratio:auto;max-height:520px}.kuro-sns-media-tile img{display:block;width:100%;height:100%;max-height:520px;object-fit:cover}.kuro-sns-media-count-1 .kuro-sns-media-tile img{object-fit:contain}',
    '#submitForm{flex-wrap:wrap}#chatModal #chatConversationPanel form[onsubmit="sendChatMessage(event)"]{flex-wrap:wrap}#chatModal #chatConversationPanel form[onsubmit="sendChatMessage(event)"] #chatMessageInput{flex:1 1 120px}',
    '#publicChatForm #publicChatImagePreview{display:flex!important}#publicChatForm #publicChatImagePreview.hidden{display:none!important}#publicChatForm>div:not(#publicChatImagePreview){grid-template-columns:minmax(0,1fr) auto auto!important;align-items:center}#publicChatForm #publicChatNickname{grid-column:1/-1!important;width:100%!important}#publicChatForm #publicChatInput{grid-column:1!important;min-width:0}#publicChatForm .kuro-sns-photo-button{grid-column:2!important}#publicChatForm #publicChatSendButton{grid-column:3!important}',
    '.kuro-sns-media-viewer{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.92)}.kuro-sns-media-viewer.hidden{display:none!important}.kuro-sns-media-viewer>img{max-width:min(96vw,1400px);max-height:90dvh;object-fit:contain}.kuro-sns-media-viewer-close{position:absolute;right:18px;top:14px;width:44px;height:44px;border-radius:50%;background:#fff;color:#111;font-size:28px;line-height:1}'
  ].join('\n');document.head.appendChild(css);
  window.KuroSNSMedia={pick(type){document.getElementById(type==='publicChat'?'publicChatImageInput':type+'ImageInput')?.click()},handlePick:onPick,clear,removeSelected,getSelected,upload,remove,renderPublic,renderPrivateBatch,renderPrivateOne};
})();
/* KURO SNS shared photo upload, compression and rendering */
(function () {
  'use strict';
  const PUB='kuro-sns-public-media', PRIV='kuro-sns-private-media';
  const MAX=4, MAX_SOURCE=12*1024*1024, MAX_UPLOAD=3*1024*1024;
  const TYPES=new Set(['image/jpeg','image/png','image/webp']);
  const selected={post:[],chat:[],publicChat:[]};
  const db=()=>window.kuroSNSDB||window.kuroGamesDB||null;
  const STORAGE_ORIGIN='https://cprvpphlfpmiegjiutjn.supabase.co';
  function relayAssetUrl(value){
    if(!value)return'';
    try{
      const url=new URL(String(value),STORAGE_ORIGIN);
      if(url.origin!==STORAGE_ORIGIN)return url.href;
      const resource=url.pathname+url.search;
      return window.location.origin+'/api/kuro-storage-relay?resource='+encodeURIComponent(resource);
    }catch(_){return String(value)}
  }
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
      const scale=Math.min(1,1600/Math.max(w,h)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw Error('画像を処理できませんでした。');
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const toBlob=(surface,type,q)=>new Promise(resolve=>surface.toBlob(resolve,type,q));
      let blob=await toBlob(canvas,'image/webp',.82),format='image/webp';
      if(!blob||blob.type!=='image/webp'){
        const jpg=document.createElement('canvas');jpg.width=canvas.width;jpg.height=canvas.height;
        const jpgCtx=jpg.getContext('2d');if(!jpgCtx)throw Error('画像を処理できませんでした。');
        jpgCtx.fillStyle='#fff';jpgCtx.fillRect(0,0,jpg.width,jpg.height);jpgCtx.drawImage(bitmap,0,0,jpg.width,jpg.height);
        blob=await toBlob(jpg,'image/jpeg',.82);format='image/jpeg';
      }
      if(!blob)throw Error('画像の圧縮に失敗しました。');
      for(const quality of [.74,.66,.58]){
        if(!blob||blob.size<=MAX_UPLOAD)break;
        blob=await toBlob(format==='image/webp'?canvas:(()=>{const jpg=document.createElement('canvas');jpg.width=canvas.width;jpg.height=canvas.height;const c=jpg.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,jpg.width,jpg.height);c.drawImage(bitmap,0,0,jpg.width,jpg.height);return jpg})(),format,quality);
      }
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
    selected[type]=next;preview(type);
  }
  function clear(type){if(!selected[type])return;revoke(selected[type]);selected[type]=[];preview(type)}
  function removeSelected(type,i){if(!selected[type]?.[i])return;revoke([selected[type].splice(i,1)[0]]);preview(type)}
  function getSelected(type){return(selected[type]||[]).map(x=>x.file)}
  function closeMenu(type){
    const id=type==='publicChat'?'publicChatAttachMenu':type==='post'?'postAttachMenu':'chatAttachMenu';
    const menu=document.getElementById(id);if(menu)menu.classList.add('hidden');
    document.querySelector('[aria-controls="'+id+'"]')?.setAttribute('aria-expanded','false');
  }
  function toggleMenu(type){
    const id=type==='publicChat'?'publicChatAttachMenu':type==='post'?'postAttachMenu':'chatAttachMenu';
    const menu=document.getElementById(id);if(!menu)return;
    ['chat','publicChat','post'].forEach(other=>{if(other!==type)closeMenu(other)});
    const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);
    document.querySelector('[aria-controls="'+id+'"]')?.setAttribute('aria-expanded',String(opening));
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest('.kuro-sns-attach-wrap'))['chat','publicChat','post'].forEach(closeMenu);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')['chat','publicChat','post'].forEach(closeMenu);
  });
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
  function render(items,urls,isPublic,context){
    const valid=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.path==='string'&&x.bucket===(isPublic?PUB:PRIV)).slice(0,MAX);
    if(!valid.length)return'';
    const cells=valid.map(x=>{
      const source=isPublic?db().storage.from(PUB).getPublicUrl(x.path).data.publicUrl:urls.get(x.path);
      const url=relayAssetUrl(source);
      return url?'<button type="button" class="kuro-sns-media-tile" data-kuro-media-open="'+esc(url)+'" data-kuro-media-fallback="'+esc(source||'')+'" aria-label="写真を拡大"><img loading="lazy" decoding="async" src="'+esc(url)+'" data-kuro-media-fallback="'+esc(source||'')+'" alt="写真"></button>':'';
    }).join('');
    const contextClass=context==='chat'?' kuro-sns-chat-media':'';
    return cells?'<div class="kuro-sns-media-grid kuro-sns-media-count-'+valid.length+contextClass+'">'+cells+'</div>':'';
  }
  function renderPublic(media,context){try{return render(media,new Map(),true,context)}catch(e){console.warn(e);return''}}
  async function renderPrivateBatch(client,messages){
    const paths=[...new Set((messages||[]).flatMap(m=>(Array.isArray(m.media)?m.media:[]).filter(x=>x?.bucket===PRIV&&typeof x.path==='string').map(x=>x.path)))],urls=new Map();
    for(let offset=0;offset<paths.length;offset+=50){const chunk=paths.slice(offset,offset+50);const r=await client.storage.from(PRIV).createSignedUrls(chunk,3600);if(r.error){console.warn('KURO SNS private photo URL failed',r.error);continue}(r.data||[]).forEach((x,index)=>{const u=relayAssetUrl(x.signedUrl||x.signedURL||x.signed_url);if(!u)return;const requestedPath=chunk[index];if(requestedPath)urls.set(requestedPath,u);if(x.path)urls.set(x.path,u)})}
    const byId=new Map();(messages||[]).forEach(m=>byId.set(String(m.id),render(m.media,urls,false,'chat')));return byId;
  }
  async function renderPrivateOne(client,media){const m=await renderPrivateBatch(client,[{id:'preview',media}]);return m.get('preview')||''}
  function viewer(){
    let v=document.getElementById('kuroSNSMediaViewer');if(v)return v;
    v=document.createElement('div');v.id='kuroSNSMediaViewer';v.className='kuro-sns-media-viewer hidden';v.innerHTML='<button type="button" class="kuro-sns-media-viewer-close" aria-label="閉じる">×</button><img alt="拡大写真">';document.body.appendChild(v);
    v.addEventListener('click',e=>{if(e.target===v||e.target.closest('.kuro-sns-media-viewer-close'))v.classList.add('hidden')});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')v.classList.add('hidden')});return v;
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-kuro-media-open]');if(!b)return;e.preventDefault();const v=viewer(),img=v.querySelector('img');img.dataset.kuroMediaFallback=b.getAttribute('data-kuro-media-fallback')||'';img.src=b.getAttribute('data-kuro-media-open');v.classList.remove('hidden')});
  document.addEventListener('error',e=>{
    const img=e.target;
    if(!(img instanceof HTMLImageElement))return;
    const fallback=img.dataset.kuroMediaFallback;
    if(!fallback)return;
    delete img.dataset.kuroMediaFallback;
    if(img.src!==fallback)img.src=fallback;
  },true);
  const css=document.createElement('style');css.id='kuro-sns-media-style';css.textContent=[
    '.kuro-sns-media-preview{display:flex;gap:8px;flex-wrap:wrap;width:100%;padding:4px 0}.kuro-sns-media-preview.hidden{display:none!important}',
    '.kuro-sns-preview-item{position:relative;width:76px;height:76px;border-radius:12px;overflow:hidden;border:1px solid #52525b;background:#18181b}.kuro-sns-preview-item img{width:100%;height:100%;object-fit:cover}.kuro-sns-preview-item button{position:absolute;right:4px;top:4px;width:24px;height:24px;min-height:24px!important;border-radius:50%;background:#111c;color:#fff;font-size:18px;line-height:1}',
    '.kuro-sns-attach-wrap{position:relative;display:inline-flex;flex:0 0 auto;align-items:center}',
    '.kuro-sns-plus-button{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;min-width:42px;min-height:42px;border:1px solid rgba(148,163,184,.34);border-radius:14px;background:rgba(255,255,255,.055);color:inherit;font-size:26px;font-weight:400;line-height:1;transition:background .15s,border-color .15s}',
    '.kuro-sns-plus-button:hover,.kuro-sns-plus-button[aria-expanded=true]{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.55)}',
    '.kuro-sns-attach-menu{position:absolute;z-index:80;left:0;bottom:calc(100% + 8px);width:190px;padding:6px;border:1px solid #3f3f46;border-radius:14px;background:#18181b;box-shadow:0 12px 36px rgba(0,0,0,.38)}',
    '.kuro-sns-attach-menu.hidden{display:none!important}',
    '.kuro-sns-attach-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:9px 11px;border-radius:10px;color:#f4f4f5;text-align:left;font-size:13px}',
    '.kuro-sns-attach-menu button:hover{background:#27272a}',
    '.kuro-sns-link{color:inherit!important;text-decoration:underline!important;text-decoration-thickness:1px;text-underline-offset:2px;overflow-wrap:anywhere;cursor:pointer}.kuro-sns-link:hover{opacity:.78}',
    '#chatModal #chatConversationPanel form[onsubmit="sendChatMessage(event)"] .kuro-sns-media-preview{flex:0 0 100%}',
    '.kuro-sns-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px;max-width:min(100%,420px)}.kuro-sns-media-grid.kuro-sns-media-count-1{grid-template-columns:minmax(0,1fr);max-width:min(100%,360px)}.kuro-sns-media-tile{display:block;min-width:0;overflow:hidden;padding:0!important;border:0;border-radius:14px;background:#18181b;aspect-ratio:1.2}.kuro-sns-media-count-1 .kuro-sns-media-tile{aspect-ratio:auto;max-height:320px}.kuro-sns-media-tile img{display:block;width:100%;height:100%;max-height:210px;object-fit:contain}.kuro-sns-media-count-1 .kuro-sns-media-tile img{max-height:320px;object-fit:contain}',
    '.kuro-sns-chat-media{width:min(100%,280px);max-width:min(68vw,280px);margin-top:8px;gap:7px}.kuro-sns-chat-media.kuro-sns-media-count-1{width:100%;max-width:min(68vw,280px)}.kuro-sns-chat-media .kuro-sns-media-tile{aspect-ratio:1;max-height:none;border-radius:13px;background:transparent}.kuro-sns-chat-media.kuro-sns-media-count-1 .kuro-sns-media-tile{aspect-ratio:auto;width:100%;max-height:320px}.kuro-sns-chat-media .kuro-sns-media-tile img{width:100%;height:100%;max-height:210px;object-fit:contain}.kuro-sns-chat-media.kuro-sns-media-count-1 .kuro-sns-media-tile img{width:100%;height:auto;max-height:320px;object-fit:contain}@media(max-width:640px){.kuro-sns-chat-media,.kuro-sns-chat-media.kuro-sns-media-count-1{max-width:min(72vw,280px)}.kuro-sns-chat-media.kuro-sns-media-count-1 .kuro-sns-media-tile img{max-height:320px}}',
    '#submitForm{flex-wrap:wrap}#chatModal #chatConversationPanel form[onsubmit="sendChatMessage(event)"]{flex-wrap:wrap}#chatModal #chatConversationPanel form[onsubmit="sendChatMessage(event)"] #chatMessageInput{flex:1 1 120px}',
    '#publicChatForm #publicChatImagePreview{display:flex!important}#publicChatForm #publicChatImagePreview.hidden{display:none!important}#publicChatForm>div:not(#publicChatImagePreview){grid-template-columns:minmax(76px,160px) 42px minmax(0,1fr) auto!important;align-items:center!important;gap:8px!important}#publicChatForm #publicChatNickname{grid-column:1!important;grid-row:1!important;width:100%!important;min-width:0!important}#publicChatForm #publicChatInput{grid-column:3!important;grid-row:1!important;min-width:0!important}#publicChatForm .kuro-sns-attach-wrap{grid-column:2!important;grid-row:1!important}#publicChatForm #publicChatSendButton{grid-column:4!important;grid-row:1!important}#publicChatForm #publicChatImageInput{display:none!important}@media(max-width:640px){#publicChatForm>div:not(#publicChatImagePreview){grid-template-columns:minmax(76px,110px) 42px minmax(0,1fr) auto!important;gap:6px!important}}',
    '.kuro-sns-media-viewer{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.92)}.kuro-sns-media-viewer.hidden{display:none!important}.kuro-sns-media-viewer>img{max-width:min(96vw,1400px);max-height:90dvh;object-fit:contain}.kuro-sns-media-viewer-close{position:absolute;right:18px;top:14px;width:44px;height:44px;border-radius:50%;background:#fff;color:#111;font-size:28px;line-height:1}'
  ].join('\n');document.head.appendChild(css);
  window.KuroSNSMedia={pick(type){document.getElementById(type==='publicChat'?'publicChatImageInput':type+'ImageInput')?.click()},toggleMenu,closeMenu,handlePick:onPick,clear,removeSelected,getSelected,upload,remove,renderPublic,renderPrivateBatch,renderPrivateOne};
})();
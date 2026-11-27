window.__KURO_STUDIO_BOOT_STAGE__="main-script-start";
(function(){
"use strict";
window.__KURO_STUDIO_BOOT_STAGE__="loading-project-state";
const $=id=>document.getElementById(id);
const KEY="kuroGameStudio.v1";
const SUPABASE_URL="https://cprvpphlfpmiegjiutjn.supabase.co",SUPABASE_KEY="sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const KURO_CLOUDFLARE_TRANSPORT=true;
const KURO_CLOUDFLARE_PROXY_URL="https://kurolab.cc.cd/api/cloudflare-relay";
function kuroCloudflareClientId(){
 const key="kuro_cloudflare_client_id_studio_v1";
 try{let value=localStorage.getItem(key);if(!value){value=window.crypto&&crypto.randomUUID?crypto.randomUUID():"kuro-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);localStorage.setItem(key,value);}return value;}
 catch(_){return "kuro-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);}
}
async function kuroCloudflareFetch(input,init){
 const req=new Request(input,init),url=new URL(req.url);
 if(url.origin!=="https://cprvpphlfpmiegjiutjn.supabase.co")return fetch(req);
 const bytes=new Uint8Array(await req.arrayBuffer());let binary="";
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
 const headers={};req.headers.forEach((v,k)=>{headers[k]=v;});
 const proxy=await fetch(KURO_CLOUDFLARE_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:url.pathname+url.search,method:req.method,headers,bodyBase64:bytes.length?btoa(binary):"",clientId:kuroCloudflareClientId()})});
 let result;try{result=await proxy.json();}catch(e){throw new Error("Cloudflare中継サーバーの応答を読み取れませんでした");}
 if(!proxy.ok||!result||typeof result.status!=="number")throw new Error(result&&result.error||"Cloudflare中継通信に失敗しました");
 let body=null;if(result.isBinary&&result.bodyBase64){const raw=atob(result.bodyBase64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);body=out;}else if(result.bodyText!==undefined&&![204,205,304].includes(result.status))body=result.bodyText;
 return new Response(body,{status:result.status,headers:result.headers||{"Content-Type":"application/json"}});
}
async function getStudioSession(client){
 const first=await client.auth.getSession();
 if(first.data&&first.data.session&&!first.error)return first;
 const refreshed=await client.auth.refreshSession();
 if(refreshed.data&&refreshed.data.session&&!refreshed.error)return refreshed;
 if(first.error)throw first.error;
 return refreshed;
}
const publishDb=window.supabase&&window.supabase.createClient?window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:kuroCloudflareFetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
const clone=x=>JSON.parse(JSON.stringify(x));
const escapeHTML=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fallback={id:"studio-new",name:"新しいゲーム",type:"clicker",background:"#17243a",objects:[
{id:"title",type:"text",name:"タイトル",text:"CLICK GAME",x:25,y:10,w:50,h:15,color:"#ffffff",bg:"transparent",size:34,radius:0},
{id:"score",type:"text",name:"スコア",text:"SCORE  0",x:35,y:32,w:30,h:12,color:"#d8def0",bg:"transparent",size:22,radius:0},
{id:"main",type:"button",name:"スコアボタン",text:"クリック！",x:34,y:53,w:32,h:17,color:"#ffffff",bg:"#8068ed",size:22,radius:14}
]};
let project,activeTab="html",activeSurface="pc",saveTimer=null,previewTimer=null,toastTimer=null;
function makeVisualCode(p){
 const objects=Array.isArray(p.objects)?p.objects.filter(o=>o.type!=="group"&&o.visible!==false):[];
 const html='<main id="kuro-game" aria-label="'+escapeHTML(p.name||"KURO Game")+'">\n'+objects.map(o=>{
  const text=escapeHTML(o.text||"");
  const size=Number(o.size)||20;
  const style='left:'+Number(o.x||0)+'%;top:'+Number(o.y||0)+'%;width:'+Number(o.w||20)+'%;height:'+Number(o.h||12)+'%;color:'+(o.color||"#fff")+';background:'+(o.bg||"transparent")+';font-size:clamp(8px,'+(size/960*100)+'vw,'+size+'px);border-radius:'+(Number(o.radius)||0)+'px;transform:rotate('+(Number(o.rotation)||0)+'deg)';
  const asset=(p.assets||[]).find(a=>a.id===o.assetId),imageSrc=o.imageData||(asset&&asset.data);
  const content=o.type==="image"&&imageSrc?'<img alt="" src="'+imageSrc+'" style="width:100%;height:100%;object-fit:fill">':o.type==="particle"?"✦":text;
  return '  <div class="game-object" data-id="'+escapeHTML(o.id)+'" data-kind="'+escapeHTML(o.type)+'" style="'+style+'">'+content+'</div>';
 }).join("\n")+'\n</main>';
 const frameW=Math.max(240,Math.min(3840,Number(p.settings&&p.settings.gameFrameWidth)||Number(p.settings&&p.settings.width)||960)),frameH=Math.max(160,Math.min(2160,Number(p.settings&&p.settings.gameFrameHeight)||Number(p.settings&&p.settings.height)||540)),frameRatio=frameW/frameH;
 const css=[
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2vw;background:#0b1020;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}',
  '#kuro-game{position:relative;width:min(96vw,'+frameW+'px,calc((100vh - 40px) * '+frameRatio+'));max-height:calc(100vh - 40px);aspect-ratio:'+frameW+' / '+frameH+';overflow:hidden;border-radius:14px;background:'+(p.background||"#17243a")+';box-shadow:0 20px 60px #0008}',
  '.game-object{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;word-break:break-word;line-height:1.2;user-select:none}',
  '.game-object[data-kind="button"],.game-object[data-kind="emoji"],.game-object[data-kind="particle"]{cursor:pointer}',
  '.kuro-tilemap{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
  '@keyframes kuro-float{50%{translate:0 -8px}}@keyframes kuro-spin{to{rotate:360deg}}@keyframes kuro-pulse{50%{scale:1.1}}@keyframes kuro-bob{0%,100%{translate:0 0}50%{translate:0 -14px}}'
 ].join("\n");
 const type=JSON.stringify(p.type||"custom");
 const model=JSON.stringify(objects).replace(/</g,"\\u003c");
 const events=JSON.stringify(Array.isArray(p.events)?p.events:[]).replace(/</g,"\\u003c");
 const settings=JSON.stringify(p.settings||{}).replace(/</g,"\\u003c");
 const tilemap=JSON.stringify(p.tilemap||null).replace(/</g,"\\u003c");
 const collisions=JSON.stringify(p.collisionMatrix||{}).replace(/</g,"\\u003c");
 const js=[
  "// KURO GAME STUDIO - Visual project runtime",
  "const gameType = "+type+";",
  "const objects = "+model+";",
  "const events = "+events+";",
  "const settings = "+settings+";",
  "const tilemap = "+tilemap+";",
  "const collisionMatrix = "+collisions+";",
  'const root = document.querySelector("#kuro-game");',
  'const nodes = new Map(); let score = 0, running = true;',
  'const tileColors = ["#26364f","#4d8a72","#b58d55","#8f536e","#6f83b7","#c3c9d4","#e5b35d","#1d2431"];',
  'if(tilemap && tilemap.enabled){const c=document.createElement("canvas");c.className="kuro-tilemap";c.width=tilemap.cols;c.height=tilemap.rows;const ctx=c.getContext("2d");tilemap.cells.forEach((v,i)=>{if(v<0)return;ctx.fillStyle=tileColors[v%tileColors.length];ctx.fillRect(i%tilemap.cols,Math.floor(i/tilemap.cols),1,1);});root.prepend(c);}',
  'objects.forEach(o=>{const e=root.querySelector(\'[data-id="\'+CSS.escape(o.id)+\'"]\');if(!e)return;nodes.set(o.id,e);if(o.animation&&o.animation.enabled)e.style.animation="kuro-"+o.animation.type+" "+Math.max(.1,Number(o.animation.duration)||1.2)+"s "+(o.animation.loop===false?"1":"infinite")+" ease-in-out";});',
  'function particles(x,y,n=18){for(let i=0;i<n;i++){const el=document.createElement("i");el.textContent=["✦","•","✧"][i%3];el.style.cssText="position:absolute;z-index:50;left:"+x+"%;top:"+y+"%;color:"+tileColors[i%tileColors.length]+";pointer-events:none;animation:kuro-particle .7s ease-out forwards;--dx:"+((Math.random()-.5)*100)+"px;--dy:"+((Math.random()-.5)*100)+"px";root.appendChild(el);setTimeout(()=>el.remove(),750);}}',
  'function runEvents(trigger,target){events.filter(ev=>ev.trigger===trigger&&(ev.targetId==="*"||!target||ev.targetId===target.id)).forEach(ev=>(ev.actions||[]).forEach(a=>{if(a.type==="addScore"){score+=Number(a.value||0);const scoreObj=objects.find(o=>o.id==="score");const el=scoreObj&&nodes.get(scoreObj.id);if(el)el.textContent="SCORE  "+score;}else if(a.type==="setText"&&target){const el=nodes.get(target.id);if(el)el.textContent=String(a.value||"");}else if(a.type==="moveRandom"&&target){target.x=5+Math.random()*75;target.y=5+Math.random()*75;const el=nodes.get(target.id);if(el){el.style.left=target.x+"%";el.style.top=target.y+"%";}}else if(a.type==="particles"){const t=target||{x:45,y:45,w:10,h:10};particles(t.x+t.w/2,t.y+t.h/2);}else if(a.type==="cameraShake"){root.animate([{translate:"-3px 2px"},{translate:"3px -2px"},{translate:"0 0"}],{duration:450});}else if(a.type==="message"){console.log(String(a.value||""));alert(String(a.value||""));}else if(a.type==="gameOver"){running=false;console.log("Game over");}}));}',
  'root.addEventListener("click",event=>{const el=event.target.closest(".game-object");if(!el)return;const obj=objects.find(o=>o.id===el.dataset.id);if(!obj)return;if(gameType==="clicker"&&obj.type==="button"){score++;const scoreObj=objects.find(o=>o.id==="score");const scoreNode=scoreObj&&nodes.get(scoreObj.id);if(scoreNode)scoreNode.textContent="SCORE  "+score;}else if(gameType==="quiz"&&obj.type==="button"){alert(obj.id==="a"?"正解！":"もう一度挑戦！");}else if(gameType==="target"&&obj.id==="target"){score+=10;const scoreObj=objects.find(o=>o.id==="score");const scoreNode=scoreObj&&nodes.get(scoreObj.id);if(scoreNode)scoreNode.textContent="SCORE  "+score;obj.x=5+Math.random()*75;obj.y=20+Math.random()*60;el.style.left=obj.x+"%";el.style.top=obj.y+"%";}if(obj.type==="particle")particles(obj.x+obj.w/2,obj.y+obj.h/2);runEvents("click",obj);});',
  'function intersects(a,b){const pair=[a.layer||"Default",b.layer||"Default"].sort().join("|");if(collisionMatrix[pair]===false)return false;return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}',
  'function raycast(x,y,dx,dy,maxDistance=100){const steps=Math.max(1,Math.ceil(maxDistance));for(let i=0;i<=steps;i++){const px=x+dx*i,py=y+dy*i;for(const o of objects){if(!o.collider||!o.collider.enabled)continue;if(px>=o.x&&px<=o.x+o.w&&py>=o.y&&py<=o.y+o.h)return {object:o,x:px,y:py,distance:i};}}return null;}',
  'const platformKeys={left:false,right:false,jump:false};document.addEventListener("keydown",e=>{if(gameType!=="platformer")return;const k=e.key.toLowerCase();if(["arrowleft","arrowright","arrowup"," ","a","d","w"].includes(k))e.preventDefault();if(k==="arrowleft"||k==="a")platformKeys.left=true;if(k==="arrowright"||k==="d")platformKeys.right=true;if(k===" "||k==="w"||k==="arrowup")platformKeys.jump=true;});document.addEventListener("keyup",e=>{const k=e.key.toLowerCase();if(k==="arrowleft"||k==="a")platformKeys.left=false;if(k==="arrowright"||k==="d")platformKeys.right=false;if(k===" "||k==="w"||k==="arrowup")platformKeys.jump=false;});',
  'let last=performance.now();const hit=new Set();function tick(now){if(!running)return;const dt=Math.min(.04,(now-last)/1000);last=now;const bodies=objects.filter(o=>o.collider&&o.collider.enabled);if(gameType==="platformer"){const player=objects.find(o=>o.id==="player");if(player){player.vx=platformKeys.left?-30:platformKeys.right?30:0;if(platformKeys.jump&&player.grounded){player.vy=-65;player.grounded=false;}}}bodies.forEach(o=>{if(o.collider.gravity){o.vy=(o.vy||0)+Number(settings.gravity||600)*Number(o.collider.gravity)*dt/540*100/Math.max(.1,Number(o.collider.mass||1));o.y+=o.vy*dt;}o.vx=(o.vx||0)*Math.max(0,1-Number(o.collider.friction||0)*dt*2);o.x+=o.vx*dt;if(o.y+o.h>100){o.y=100-o.h;o.vy=0;o.grounded=true;}if(o.x<0)o.x=0;if(o.x+o.w>100)o.x=100-o.w;});for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){const a=bodies[i],b=bodies[j],key=[a.id,b.id].sort().join(":");const hitNow=intersects(a,b);if(hitNow&&!hit.has(key)){hit.add(key);runEvents("overlap",a);runEvents("overlap",b);}if(!hitNow&&hit.has(key)){hit.delete(key);runEvents("overlapExit",a);runEvents("overlapExit",b);}if(hitNow&&!a.collider.trigger&&!b.collider.trigger&&a.vy>0&&a.y+a.h-b.y<6){a.y=b.y-a.h;a.vy=0;a.grounded=true;}}bodies.forEach(o=>{const el=nodes.get(o.id);if(el){el.style.left=o.x+"%";el.style.top=o.y+"%";}});requestAnimationFrame(tick);}',
  'window.Kuro2D={objects:objects,raycast:raycast,runEvents:runEvents};',
  'runEvents("start",null);setInterval(()=>{if(running)runEvents("timer",null);},1000);',
  'if(objects.some(o=>o.collider&&o.collider.enabled))requestAnimationFrame(tick);'
 ].join("\n");
 return {html,css,js};
}
function getStoredProject(){
 try{
  const params=new URLSearchParams(location.search);
  if(params.get("publishedId"))return null;
  const all=JSON.parse(localStorage.getItem(KEY)||"[]");
  const requestedId=params.get("projectId");
  const id=requestedId||localStorage.getItem(KEY+".current");
  return (id?all.find(x=>x.id===id):null)||(!requestedId?all[0]:null)||null;
 }catch(_){return null}
}
const codeParams=new URLSearchParams(location.search);
const requestedLocalProjectId=codeParams.get("projectId");
const requestedPublishedGameId=codeParams.get("publishedId");
project=getStoredProject();
if(!project&&requestedLocalProjectId){window.__KURO_STUDIO_REDIRECTING=true;window.__KURO_STUDIO_BOOT_STAGE__="redirecting-to-project-list";window.__KURO_STUDIO_CORE_READY=true;location.replace("/game-studio/projects.html");return;}
if(!project&&!new URLSearchParams(location.search).get("publishedId")){window.__KURO_STUDIO_REDIRECTING=true;window.__KURO_STUDIO_BOOT_STAGE__="redirecting-to-project-list";window.__KURO_STUDIO_CORE_READY=true;location.replace("/game-studio/projects.html");return;}
project=project||clone(fallback);
if(!project.code||typeof project.code!=="object")project.code=makeVisualCode(project);
if(!project.mobileCode||typeof project.mobileCode!=="object")project.mobileCode=clone(project.code);
["html","css"].forEach(k=>{
 if(typeof project.code[k]!=="string")project.code[k]="";
 if(typeof project.mobileCode[k]!=="string")project.mobileCode[k]=project.code[k]||"";
});
const legacyPcJs=typeof project.code.js==="string"?project.code.js:"";
const legacyMobileJs=typeof project.mobileCode.js==="string"?project.mobileCode.js:legacyPcJs;
if(typeof project.sharedJs!=="string"){
 if(legacyPcJs===legacyMobileJs){
  project.sharedJs=legacyPcJs;
  if(typeof project.pcExtensionJs!=="string")project.pcExtensionJs="";
  if(typeof project.mobileExtensionJs!=="string")project.mobileExtensionJs="";
 }else{
  project.sharedJs="";
  if(typeof project.pcExtensionJs!=="string")project.pcExtensionJs=legacyPcJs;
  if(typeof project.mobileExtensionJs!=="string")project.mobileExtensionJs=legacyMobileJs;
 }
}
if(typeof project.pcExtensionJs!=="string")project.pcExtensionJs="";
if(typeof project.mobileExtensionJs!=="string")project.mobileExtensionJs="";
project.code.js="";
project.mobileCode.js="";
function codeForSurface(surface){
 const target=surface==="mobile"?project.mobileCode:project.code;
 return new Proxy(target,{
  get(object,key){
   if(key==="js")return project.sharedJs||"";
   if(key==="platformJs")return surface==="mobile"?(project.mobileExtensionJs||""):(project.pcExtensionJs||"");
   return object[key];
  },
  set(object,key,value){
   if(key==="js"){project.sharedJs=String(value??"");return true;}
   if(key==="platformJs"){
    if(surface==="mobile")project.mobileExtensionJs=String(value??"");
    else project.pcExtensionJs=String(value??"");
    return true;
   }
   object[key]=value;return true;
  }
 });
}
function activeCode(){return codeForSurface(activeSurface);}
function setActiveCode(value){
 const next=value&&typeof value==="object"?value:{};
 const target=activeSurface==="mobile"?project.mobileCode:project.code;
 target.html=typeof next.html==="string"?next.html:"";
 target.css=typeof next.css==="string"?next.css:"";
 project.sharedJs=typeof next.js==="string"?next.js:"";
 if(Object.prototype.hasOwnProperty.call(next,"platformJs"))activeCode().platformJs=next.platformJs;
 return activeCode();
}
function setStatus(text,color){$("saveStatus").textContent=text;$("saveStatus").style.color=color||"var(--good)"}
function toast(s){$("toast").textContent=s;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2200)}
function persist(silent){
 if(requestedPublishedGameId){
  if(!project.publishedGameId){setStatus("● 公開作品を読み込み中","var(--warn)");return true;}
  try{project.updatedAt=Date.now();localStorage.setItem("kuroGameStudio.publishedDraft."+requestedPublishedGameId,JSON.stringify(project));setStatus("● 下書き保存済み","var(--good)");if(!silent)toast("公開作品の下書きを保存しました");return true;}
  catch(e){setStatus("● 下書き保存エラー","#ff9292");if(!silent)toast("下書きを保存できませんでした");return false;}
 }
 try{
  let all=JSON.parse(localStorage.getItem(KEY)||"[]");
  const i=all.findIndex(x=>x.id===project.id);
  project.updatedAt=Date.now();
  if(i>=0)all[i]=clone(project);else if(requestedLocalProjectId){setStatus("● 保存先プロジェクトなし","#ff9292");if(!silent)toast("保存先が見つかりません。一覧から開き直してください");return false;}else all.unshift(clone(project));
  localStorage.setItem(KEY,JSON.stringify(all));
  localStorage.setItem(KEY+".current",project.id);
  setStatus("● 保存済み","var(--good)");
  if(!silent)toast("このブラウザに保存しました");
  return true;
 }catch(e){setStatus("● 保存エラー","#ff9292");if(!silent)toast("保存できません。ブラウザの保存容量を確認してください");return false}
}
function markDirty(){setStatus("● 未保存","var(--warn)");clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(true),900)}
function currentValue(){return $("codeEditor").value}
function renderGutter(){
 const lines=currentValue().split("\n").length;
 $("gutter").textContent=Array.from({length:lines},(_,i)=>i+1).join("\n");
 $("lineInfo").textContent=lines+" 行";
}
function showTab(tab){
 activeTab=tab;
 document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
 $("fileTag").textContent=(activeSurface==="mobile"?"mobile/":"pc/")+({html:"index.html",css:"style.css",js:"../shared/game.js",platformjs:"ui-controls.js"}[tab]||"index.html");
 $("codeEditor").value=activeCode()[tab]||"";
 renderGutter();
}
function stripStudioInjectedRuntime(source){
 let input=String(source||"");
 input=input.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attrs,body)=>{
  const lower=body.toLowerCase();
  if(lower.includes("iskuroauthcreation")&&lower.includes("kuro-online-login-required"))return "";
  if(lower.includes("const senderror")&&lower.includes("kuro-studio-error")&&lower.includes("filename:"))return "";
  body=body.replace(/^const __kuroSend=\(level,args\)=>{[\s\S]*?window\.addEventListener\(['"]error['"],function\(e\){try{parent\.postMessage\(\{type:['"]kuro-studio-error['"],message:e\.message\},['"]\*['"]\)\}catch\(_\)\{\}\}\);[\t ]*\r?\n?/,"");
  if(lower.includes("kuro responsive fit")||lower.includes("data.kuroautofit"))return "";
  if(/^\s*window\.kuro_games_platform=["'](?:pc|mobile)["'];?\s*$/i.test(body.trim()))return "";
  if(!body.trim())return "";
  return "<script"+attrs+">"+body+"</scr"+"ipt>";
 });
 input=input.replace(/<meta\b(?=[^>]*name\s*=\s*["']kuro-game-(?:frame|scale)["'])[^>]*>/gi,"");
 return input;
}
function splitMixedCode(source){
 let input=String(source||"").replace(/^\uFEFF/,"").trim();
 const parts={html:"",css:"",js:""},notes=[];
 const fence=/\x60{3}([\w+-]*)\s*\n([\s\S]*?)\x60{3}/g;
 const fenced=[...input.matchAll(fence)];
 if(fenced.length){
  const rest=input.replace(fence,"").trim();
  for(const m of fenced){const lang=(m[1]||"").toLowerCase(),body=m[2].trim();
   if(["html","htm","xhtml"].includes(lang))parts.html+=(parts.html?"\n":"")+body;
   else if(["css","scss","less"].includes(lang))parts.css+=(parts.css?"\n":"")+body;
   else if(["js","javascript","mjs","jsx","ts","typescript"].includes(lang))parts.js+=(parts.js?"\n":"")+body;
   else if(/<(!doctype|html|head|body|div|main|section|style|script)\b/i.test(body))parts.html+=(parts.html?"\n":"")+body;
   else if(/(^|\n)\s*(@media|@keyframes|:root|[.#][\w-]+\s*\{)/.test(body))parts.css+=(parts.css?"\n":"")+body;
   else parts.js+=(parts.js?"\n":"")+body;
  }
  if(rest)notes.push("コードフェンス外の説明文は取り込まずに除外しました。");
  input="";
 }else if(!/<(!doctype|html|head|body|style|script)\b/i.test(input)&&/(^|\n)\s*(@media|@keyframes|:root|[.#][\w-]+\s*\{)/.test(input)){parts.css=input;input="";}
 else if(!/<(!doctype|html|head|body|style|script)\b/i.test(input)&&/\b(const|let|var|function|import|export|document\.|window\.|console\.)/.test(input)){parts.js=input;input="";}
 if(input){
  input=input.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,(_,body)=>{parts.css+=(parts.css?"\n\n":"")+body.trim();return"<!-- CSSをstyle.cssへ分離 -->";});
  input=input.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attrs,body)=>{
   if(/\bsrc\s*=/.test(attrs)){notes.push("外部script読み込みタグはHTML内に保持しました。");return whole;}
   if(body.trim()){parts.js+=(parts.js?"\n\n":"")+body.trim();if(/\btype\s*=\s*["']module["']/.test(attrs))notes.push("module形式のJavaScriptを検出しました。import文を保持しています。");}
   return"<!-- JavaScriptをgame.jsへ分離 -->";
  });
  parts.html=input.trim();
 }
 if(!parts.html&&!parts.css&&!parts.js)throw new Error("コードを判別できませんでした。");
 if(parts.html){
  parts.html=parts.html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,(_,body)=>{parts.css+=(parts.css?"\n\n":"")+body.trim();return"<!-- CSSをstyle.cssへ分離 -->";});
  parts.html=parts.html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attrs,body)=>{
   if(/\bsrc\s*=/.test(attrs)){notes.push("外部script読み込みタグはHTML内に保持しました。");return whole;}
   if(body.trim()){parts.js+=(parts.js?"\n\n":"")+body.trim();if(/\btype\s*=\s*["']module["']/.test(attrs))notes.push("module形式のJavaScriptを検出しました。import文を保持しています。");}
   return"<!-- JavaScriptをgame.jsへ分離 -->";
  });
 }
 if(!parts.html)parts.html="<!-- HTMLをここに追加できます -->";
 if(!parts.css)parts.css="/* CSSをここに追加できます */";
 if(!parts.js)parts.js="// JavaScriptをここに追加できます";
 return {parts,notes};
}
function safeScript(source){return String(source||"").replace(/<\/script/gi,"<\\/script");}
function kuroNeedsModuleScript(source) {
 const original=String(source||"");
 let code=original.split("");let i=0;
 while(i<code.length){
  const ch=code[i],next=code[i+1],tick=String.fromCharCode(96);
  if(ch==="'"||ch==='"'||ch===tick){
   const quote=ch;code[i]=" ";i++;
   while(i<code.length){const c=code[i];if((c==="\n"||c==="\r")&&quote!==tick)break;code[i]=" ";if(c==="\\"){i++;if(i<code.length)code[i]=" ";i++;continue;}if(c===quote){i++;break;}i++;}
   continue;
  }
  if(ch==="/"&&next==="/"){code[i]=code[i+1]=" ";i+=2;while(i<code.length&&code[i]!=="\n"){code[i]=" ";i++;}continue;}
  if(ch==="/"&&next==="*"){code[i]=code[i+1]=" ";i+=2;while(i<code.length&&!(code[i]==="*"&&code[i+1]==="/")){if(code[i]!=="\n"&&code[i]!=="\r")code[i]=" ";i++;}if(i<code.length){code[i]=code[i+1]=" ";i+=2;}continue;}
  i++;
 }
 const masked=code.join("");
 if(/^\s*(?:import\s+(?!\()|export\s+)/m.test(masked))return true;
 const awaits=[...masked.matchAll(/\bawait\b/g)];
 if(!awaits.length)return false;
 const ranges=[];
 function addBodies(pattern){
  pattern.lastIndex=0;let match;
  while((match=pattern.exec(masked))){
   const open=match.index+match[0].lastIndexOf("{");if(open<0)continue;
   let depth=0,end=-1;
   for(let p=open;p<masked.length;p++){if(masked[p]==="{")depth++;else if(masked[p]==="}"&&--depth===0){end=p;break;}}
   if(end>=open)ranges.push([open,end]);
  }
 }
 addBodies(/\basync\s+function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g);
 addBodies(/\basync\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g);
 addBodies(/\basync\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g);
 const expression=/\basync\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*[^{}\n;,]+/g;
 let arrow;while((arrow=expression.exec(masked)))ranges.push([arrow.index,arrow.index+arrow[0].length]);
 return awaits.some(match=>!ranges.some(range=>match.index>=range[0]&&match.index<=range[1]));
}
function makeDocument(sourceCode,targetPlatform,includeGameScripts){
 const platform=targetPlatform||activeSurface;
 const source=sourceCode||activeCode();
 const code={
  html:typeof source.html==="string"?source.html:"",
  css:typeof source.css==="string"?source.css:"",
  js:typeof source.js==="string"?source.js:"",
  platformJs:typeof source.platformJs==="string"?source.platformJs:""
 };
 let html=code.html||"";
 // HTMLタブ内のインラインscriptにもトップレベルawait対応を適用
 html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attrs,body)=>{
  if(!kuroNeedsModuleScript(body)&&!/\btype\s*=\s*["\']module["\']/i.test(attrs))return whole;
  const cleanAttrs=attrs.replace(/\s+type\s*=\s*(["']).*?\1/i,"");
  return "<scr"+"ipt"+cleanAttrs+' type="module">'+body+"</scr"+"ipt>";
 });
 const css=String(code.css||"").replace(/<\/style/gi,"<\\/style");
 const rawJs=safeScript([code.js,code.platformJs].filter(value=>String(value||"").trim()).join("\n\n"));
 const frameWidth=platform==="mobile"?390:Math.max(240,Math.min(3840,Number(project.settings&&project.settings.gameFrameWidth)||960));
 const frameHeight=platform==="mobile"?844:Math.max(160,Math.min(2160,Number(project.settings&&project.settings.gameFrameHeight)||540));
 const frameScale=platform==="mobile"?100:Math.max(25,Math.min(300,Number(project.settings&&project.settings.gameFrameScale)||100));
 const frameMeta='<meta name="kuro-game-frame" content="'+frameWidth+'x'+frameHeight+'"><meta name="kuro-game-scale" content="'+frameScale+'">';
 const viewportMeta=platform==="mobile"&&!/<meta\b(?=[^>]*\bname=["']viewport["'])[^>]*>/i.test(html)?'<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">':"";
 const platformScript='<script>window.KURO_GAMES_PLATFORM='+JSON.stringify(platform)+';</script>';
 const styleBlock="<style>"+css+"</style>";
 const moduleMode=kuroNeedsModuleScript(rawJs);
 const scriptOpen=(moduleMode?"<scr"+"ipt type=\"module\">":"<scr"+"ipt>");
 const scriptClose="<"+"/script>";
 const legacyLogger="const __kuroSend=(level,args)=>{try{parent.postMessage({type:'kuro-studio-console',level:level,values:Array.from(args).map(v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch(_){return String(v)}})},'*')}catch(_){}};['log','info','warn','error'].forEach(level=>{const base=console[level].bind(console);console[level]=(...args)=>{base(...args);__kuroSend(level,args)}});window.addEventListener('error',function(e){try{parent.postMessage({type:'kuro-studio-error',message:e.message},'*')}catch(_){}});\n";
 const errorReporter="<script>(function(){const sendError=function(e){try{parent.postMessage({type:\"kuro-studio-error\",message:e&&e.message||\"Script error\",filename:e&&e.filename||\"\",line:e&&e.lineno||0,column:e&&e.colno||0,stack:e&&e.error&&e.error.stack||\"\"},\"*\")}catch(_){}};window.addEventListener(\"error\",sendError,true);const sendConsole=(level,args)=>{try{parent.postMessage({type:\"kuro-studio-console\",level:level,values:Array.from(args).map(v=>{try{return typeof v===\"string\"?v:JSON.stringify(v)}catch(_){return String(v)}})},\"*\")}catch(_){}};[\"log\",\"info\",\"warn\",\"error\"].forEach(level=>{const base=console[level].bind(console);console[level]=(...args)=>{base(...args);sendConsole(level,args)}});window.addEventListener(\"unhandledrejection\",function(e){const reason=e&&e.reason;try{parent.postMessage({type:\"kuro-studio-error\",message:\"Unhandled promise rejection: \"+(reason&&reason.message||String(reason||\"unknown error\")),filename:location.href,stack:reason&&reason.stack||\"\"},\"*\")}catch(_){}});})();<"+"/script>";
 // 保存済みHTMLから読み込んだ際、前回のmakeDocumentが付加したloggerを再挿入しない
 let js=rawJs;
 while(js.startsWith(legacyLogger))js=js.slice(legacyLogger.length);
 const scriptBlock=includeGameScripts===false||!js.trim()?"":scriptOpen+js+"\n//# sourceURL=KURO_GAME_PREVIEW.js\n"+scriptClose;
 const authGuard='<script>(function(){const isKuroAuthCreation=function(u){try{const parsed=new URL(typeof u==="string"?u:(u&&u.url)||"",location.href);const path=parsed.pathname.toLowerCase();return path==="/auth/v1/signup"||(path==="/auth/v1/token"&&parsed.searchParams.get("grant_type")==="anonymous");}catch(_){return false;}};const notify=function(){try{parent.postMessage({type:"kuro-online-login-required",action:"signup"},"*");}catch(_){}};const nativeFetch=window.fetch.bind(window);window.fetch=function(input,init){const url=typeof input==="string"?input:(input&&input.url)||"";if(isKuroAuthCreation(url)){notify();return Promise.resolve(new Response(JSON.stringify({error:"ゲーム内で匿名KUROアカウントは作成できません。共通アカウント画面からログインしてください。"}),{status:403,headers:{"Content-Type":"application/json"}}));}return nativeFetch(input,init);};})();<\/script>';
 const audioUnlock='<script>(function(){function unlock(){var tone=window.Tone;if(!tone||typeof tone.start!=="function")return;try{var promise=tone.start();if(promise&&typeof promise.then==="function")promise.then(function(){document.removeEventListener("pointerdown",unlock,true);document.removeEventListener("keydown",unlock,true);}).catch(function(){});else{document.removeEventListener("pointerdown",unlock,true);document.removeEventListener("keydown",unlock,true);}}catch(_){}}document.addEventListener("pointerdown",unlock,true);document.addEventListener("keydown",unlock,true);})();<\/script>';
 const autoFitScript=project.settings&&project.settings.autoFitOverflow===false?"":"<scr"+"ipt>(function(){try{document.documentElement.style.overflowX='auto';document.body.style.overflowX='auto';document.querySelectorAll('img,video,svg,iframe').forEach(function(el){el.style.maxWidth='100%';});}catch(e){console.warn('KURO responsive fit',e);}})();<"+"/script>";
 if(/<html[\s>]/i.test(html)){
  let doc=html;
  if(/<head\b[^>]*>/i.test(doc))doc=doc.replace(/<head\b[^>]*>/i,m=>m+errorReporter+authGuard+audioUnlock+viewportMeta+frameMeta+styleBlock+platformScript);
  else if(/<html[^>]*>/i.test(doc))doc=doc.replace(/<html[^>]*>/i,m=>m+"<head>"+errorReporter+authGuard+audioUnlock+viewportMeta+frameMeta+styleBlock+platformScript+"</head>");
  else doc="<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"+errorReporter+authGuard+viewportMeta+frameMeta+styleBlock+platformScript+"</head><body>"+doc+"</body></html>";
  if(/<\/body>/i.test(doc))doc=doc.replace(/<\/body>/i,scriptBlock+autoFitScript+"</body>");
  else doc+=scriptBlock+autoFitScript;
  return doc;
 }
 return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(project.name||"KURO Game")+'</title>'+errorReporter+authGuard+audioUnlock+viewportMeta+frameMeta+styleBlock+platformScript+'</head><body>'+html+scriptBlock+autoFitScript+'</body></html>';
}
let previewMode="fit";
function applyPreviewSize(){
 const w=activeSurface==="mobile"?390:Math.max(240,Math.min(3840,Number(project.settings&&project.settings.gameFrameWidth)||960));
 const h=activeSurface==="mobile"?844:Math.max(160,Math.min(2160,Number(project.settings&&project.settings.gameFrameHeight)||540));const ratio=activeSurface==="mobile"?1:Math.max(25,Math.min(300,Number(project.settings&&project.settings.gameFrameScale)||100))/100,displayW=w*ratio,displayH=h*ratio;
 const frame=$("previewFrame"),screen=frame.parentElement;
 frame.style.width=displayW+"px";frame.style.height=displayH+"px";frame.style.maxWidth="none";frame.style.maxHeight="none";frame.style.flex="0 0 auto";
 if(previewMode==="fit"){
  const scale=Math.min(1,Math.max(.05,(screen.clientWidth-28)/displayW),Math.max(.05,(screen.clientHeight-28)/displayH));
  frame.style.transformOrigin="center center";frame.style.transform="scale("+scale+")";
  screen.style.overflow="hidden";screen.style.alignItems="center";screen.style.justifyContent="center";
  $("previewSize").textContent=w+" × "+h+" px（全体表示・"+Math.round(scale*100)+"%（設定倍率 "+Math.round(ratio*100)+"%）";
 }else{
  frame.style.transform="none";frame.style.transformOrigin="top left";
  screen.style.overflow="auto";screen.style.alignItems="flex-start";screen.style.justifyContent="flex-start";
  $("previewSize").textContent=w+" × "+h+" px（実寸）";
 }
 $("fitPreviewBtn").classList.toggle("mode-active",previewMode==="fit");
 $("actualPreviewBtn").classList.toggle("mode-active",previewMode==="actual");
}
function run(){
 applyPreviewSize();clearConsole();$("previewStatus").textContent="実行中…";
 $("previewFrame").srcdoc=makeDocument();
 $("previewStatus").textContent="更新済み "+new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function queuePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(run,700)}
function editCurrent(){
 activeCode()[activeTab]=currentValue();
 renderGutter();
 markDirty();
 queuePreview();
}
function syncFromVisual(){
 setActiveCode(makeVisualCode(project));
 showTab("html");run();markDirty();toast("ビジュアル内容からコードを再生成しました");
}
function exportHTML(){
 const blob=new Blob([makeDocument()],{type:"text/html;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");
 const base=(project.name||"kuro-game").replace(/[\\/:*?"<>|]+/g,"-").trim()||"kuro-game";
 a.href=url;a.download=base+".html";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1200);
 toast("単独HTMLを書き出しました");
}
function downloadBaseName(){const invalid='/\\:*?"<>|';return Array.from(String(project.name||"kuro-game").trim().slice(0,80),ch=>invalid.includes(ch)?"-":ch).join("").replaceAll(" ","-")||"kuro-game";}
function downloadSourceFile(tab){
 const config={html:{extension:"html",mime:"text/html"},css:{extension:"css",mime:"text/css"},js:{extension:"shared.js",mime:"text/javascript"},platformjs:{extension:"controls.js",mime:"text/javascript"}}[tab];
 if(!config)return;
 const base=downloadBaseName(),content=String(activeCode()[tab]||"");
 const blob=new Blob([content],{type:config.mime+";charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=base+"."+config.extension;a.style.display="none";document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);toast(config.extension.toUpperCase()+"ファイルをダウンロードしました");
}
function syncEditorBeforeDownload(){project.name=$("projectName").value.trim()||project.name||"kuro-game";activeCode()[activeTab]=currentValue();}
function downloadAllSourceFiles(){
 syncEditorBeforeDownload();
 const base=downloadBaseName();
 const files=[
  {name:"pc/"+base+".html",data:String(project.code.html||"")},
  {name:"pc/"+base+".css",data:String(project.code.css||"")},
  {name:"mobile/"+base+".html",data:String(project.mobileCode.html||"")},
  {name:"mobile/"+base+".css",data:String(project.mobileCode.css||"")},
  {name:"shared/"+base+".js",data:String(project.sharedJs||"")},
  {name:"pc/controls.js",data:String(project.pcExtensionJs||"")},
  {name:"mobile/controls.js",data:String(project.mobileExtensionJs||"")}
 ];
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
 function u16(v){return new Uint8Array([v&255,(v>>>8)&255]);}
 function u32(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
 function join(arr){let size=arr.reduce((n,x)=>n+x.length,0),out=new Uint8Array(size),p=0;for(const x of arr){out.set(x,p);p+=x.length;}return out;}
 for(const file of files){const name=enc.encode(file.name),data=enc.encode(file.data),crc=crc32(data);
  const local=join([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
  parts.push(local);
  central.push(join([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
  offset+=local.length;
 }
 const centralBytes=join(central),end=join([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralBytes.length),u32(offset),u16(0)]);
 const blob=new Blob([...parts,centralBytes,end],{type:"application/zip"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=downloadBaseName()+"-sources.zip";a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 closeDownloadModal();toast("PC・モバイルの画面コードと共通／端末別JSをZIPで保存しました");
}

function openDownloadModal(){$("downloadModal").classList.add("open");}
function closeDownloadModal(){$("downloadModal").classList.remove("open");}

let publishUser=null,publishAllowed=false,publishIconData="";
let publishedFallbackCode=null,publishedFallbackMobileCode=null,publishedFallbackId="",activePublishedDraft=false,publishedFallbackRecovered=false;
let cropImage=null,cropObjectUrl="",cropZoom=1,cropX=0,cropY=0,cropDrag=null;
function showPublishIconPreview(){const img=$("publishIconPreviewImage");if(publishIconData){img.src=publishIconData;img.hidden=false;}else{img.removeAttribute("src");img.hidden=true;}}
function drawIconCrop(){
 const canvas=$("iconCropCanvas"),ctx=canvas.getContext("2d"),size=canvas.width,height=canvas.height;
 ctx.clearRect(0,0,size,height);ctx.fillStyle="#080c14";ctx.fillRect(0,0,size,height);
 if(!cropImage)return;
 const base=Math.max(size/cropImage.naturalWidth,height/cropImage.naturalHeight),scale=base*cropZoom;
 const w=cropImage.naturalWidth*scale,h=cropImage.naturalHeight*scale;
 const maxX=Math.max(0,(w-size)/2),maxY=Math.max(0,(h-height)/2);
 cropX=Math.max(-maxX,Math.min(maxX,cropX));cropY=Math.max(-maxY,Math.min(maxY,cropY));
 ctx.save();ctx.beginPath();ctx.rect(0,0,size,height);ctx.clip();
 ctx.drawImage(cropImage,(size-w)/2+cropX,(height-h)/2+cropY,w,h);ctx.restore();
}
function closeIconCrop(){ $("iconCropModal").classList.remove("open");if(cropObjectUrl){URL.revokeObjectURL(cropObjectUrl);cropObjectUrl="";}cropImage=null;cropDrag=null; }
async function openIconCrop(file){
 if(!file||!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("PNG・JPG・WebP画像を選択してください");
 if(file.size>8*1024*1024)throw new Error("画像は8MB以下にしてください");
 if(cropObjectUrl)URL.revokeObjectURL(cropObjectUrl);
 cropObjectUrl=URL.createObjectURL(file);cropImage=new Image();
 await new Promise((resolve,reject)=>{cropImage.onload=resolve;cropImage.onerror=()=>reject(new Error("画像を読み込めませんでした"));cropImage.src=cropObjectUrl;});
 cropZoom=1;cropX=0;cropY=0;$("iconCropZoom").value="1";$("iconCropZoomValue").textContent="100%";
 drawIconCrop();$("iconCropModal").classList.add("open");
}
$("iconCropZoom").addEventListener("input",()=>{cropZoom=Number($("iconCropZoom").value)||1;$("iconCropZoomValue").textContent=Math.round(cropZoom*100)+"%";drawIconCrop();});
$("iconCropStage").addEventListener("pointerdown",e=>{if(!cropImage)return;e.preventDefault();$("iconCropStage").setPointerCapture(e.pointerId);cropDrag={x:e.clientX,y:e.clientY,originX:cropX,originY:cropY};});
$("iconCropStage").addEventListener("pointermove",e=>{if(!cropDrag)return;const rect=$("iconCropStage").getBoundingClientRect(),canvas=$("iconCropCanvas"),scaleX=canvas.width/rect.width,scaleY=canvas.height/rect.height;cropX=cropDrag.originX+(e.clientX-cropDrag.x)*scaleX;cropY=cropDrag.originY+(e.clientY-cropDrag.y)*scaleY;drawIconCrop();});
["pointerup","pointercancel","lostpointercapture"].forEach(type=>$("iconCropStage").addEventListener(type,()=>{cropDrag=null;}));
$("cancelIconCrop").addEventListener("click",()=>{closeIconCrop();$("publishIconFile").value="";});
$("iconCropModal").addEventListener("click",e=>{if(e.target===$("iconCropModal")){$("publishIconFile").value="";closeIconCrop();}});
$("applyIconCrop").addEventListener("click",()=>{
 if(!cropImage)return;
 const canvas=document.createElement("canvas");canvas.width=256;canvas.height=200;
 const ctx=canvas.getContext("2d"),base=Math.max(256/cropImage.naturalWidth,200/cropImage.naturalHeight),scale=base*cropZoom;
 const w=cropImage.naturalWidth*scale,h=cropImage.naturalHeight*scale;
 ctx.drawImage(cropImage,(256-w)/2+cropX*.8,(200-h)/2+cropY*.8,w,h);
 const data=canvas.toDataURL("image/webp",.84);
 if(data.length>420000){toast("画像を小さくしてから再度お試しください");return;}
 publishIconData=data;showPublishIconPreview();$("publishIconFile").value="";closeIconCrop();toast("切り取ったアイコンを設定しました");
});
function slugifyGameName(value){const s=String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);return s.length>=3?s:"kuro-game-"+Date.now().toString(36);}
function latinWidthCaseVariants(value){const s=String(value||"");if(!/[A-Za-z]/.test(s))return [s,s.toLowerCase(),s.toUpperCase(),s.replace(/[!-~]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0xfee0)).replace(/ /g,"　"),s.toLowerCase().replace(/[!-~]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0xfee0)).replace(/ /g,"　"),s.toUpperCase().replace(/[!-~]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0xfee0)).replace(/ /g,"　")];return [s];}function searchNormalize(value){return String(value||"").normalize("NFKC").toLowerCase().trim();}function kanaToKatakana(s){return String(s||"").replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));}
function kanaToHiragana(s){return String(s||"").replace(/[ァ-ヶ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));}
function kanaToRomaji(s,mode="n"){const src=kanaToHiragana(String(s||"")).replace(/ゔ/g,"vu");const pairs={"きゃ":"kya","きゅ":"kyu","きょ":"kyo","しゃ":"sha","しゅ":"shu","しょ":"sho","ちゃ":"cha","ちゅ":"chu","ちょ":"cho","にゃ":"nya","にゅ":"nyu","にょ":"nyo","ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo","みゃ":"mya","みゅ":"myu","みょ":"myo","りゃ":"rya","りゅ":"ryu","りょ":"ryo","ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo","じゃ":"ja","じゅ":"ju","じょ":"jo","びゃ":"bya","びゅ":"byu","びょ":"byo","ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo","てぃ":"ti","でぃ":"di","とぅ":"tu","どぅ":"du","ふぁ":"fa","ふぃ":"fi","ふぇ":"fe","ふぉ":"fo","うぃ":"wi","うぇ":"we","うぉ":"wo","ゔぁ":"va","ゔぃ":"vi","ゔぇ":"ve","ゔぉ":"vo"};const base={"あ":"a","い":"i","う":"u","え":"e","お":"o","か":"ka","き":"ki","く":"ku","け":"ke","こ":"ko","さ":"sa","し":"shi","す":"su","せ":"se","そ":"so","た":"ta","ち":"chi","つ":"tsu","て":"te","と":"to","な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no","は":"ha","ひ":"hi","ふ":"fu","へ":"he","ほ":"ho","ま":"ma","み":"mi","む":"mu","め":"me","も":"mo","や":"ya","ゆ":"yu","よ":"yo","ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro","わ":"wa","を":"o","ん":"n","が":"ga","ぎ":"gi","ぐ":"gu","げ":"ge","ご":"go","ざ":"za","じ":"ji","ず":"zu","ぜ":"ze","ぞ":"zo","だ":"da","ぢ":"ji","づ":"zu","で":"de","ど":"do","ば":"ba","び":"bi","ぶ":"bu","べ":"be","ぼ":"bo","ぱ":"pa","ぴ":"pi","ぷ":"pu","ぺ":"pe","ぽ":"po","ぁ":"a","ぃ":"i","ぅ":"u","ぇ":"e","ぉ":"o","ゃ":"ya","ゅ":"yu","ょ":"yo","ー":""};let out="",i=0;while(i<src.length){if(src[i]==="っ"){let j=i+1,next=pairs[src.slice(j,j+2)]||base[src[j]]||"";out+=next&&/[bcdfghjklmnpqrstvwxyz]/i.test(next[0])?next[0]:"";i++;continue;}if(src[i]==="ん"){out+=mode==="nn"?"nn":"n";i++;continue;}const chunk=src.slice(i,i+2),rom=pairs[chunk];if(rom){out+=rom;i+=2;}else{out+=base[src[i]]??src[i];i++;}}return out;}
function fillAliasFields(values){const [kanji,hira,kata,romaji,romajiNN,other]=values||[];$("aliasKanji").dataset.manual="";$("aliasHiragana").dataset.manual="";$("aliasKatakana").dataset.manual="";$("aliasRomaji").dataset.manual="";$("aliasRomajiNN").dataset.manual="";$("aliasOther").dataset.manual="";$("aliasKanji").value=kanji||"";$("aliasHiragana").value=hira||"";$("aliasKatakana").value=kata||"";$("aliasRomaji").value=romaji||"";$("aliasRomajiNN").value=romajiNN||"";$("aliasOther").value=other||"";}
function readAliasFields(){return {kanji:$("aliasKanji").value.trim(),hiragana:$("aliasHiragana").value.trim(),katakana:$("aliasKatakana").value.trim(),romaji:$("aliasRomaji").value.trim(),romajiNN:$("aliasRomajiNN").value.trim(),other:$("aliasOther").value.trim()};}
function syncKanaAliases(){const hira=$("aliasHiragana").value.trim();if(hira){if(!$("aliasKatakana").dataset.manual||!$("aliasKatakana").value.trim())$("aliasKatakana").value=kanaToKatakana(hira);if(!$("aliasRomaji").dataset.manual||!$("aliasRomaji").value.trim())$("aliasRomaji").value=kanaToRomaji(hira,"n");if(!$("aliasRomajiNN").dataset.manual||!$("aliasRomajiNN").value.trim())$("aliasRomajiNN").value=kanaToRomaji(hira,"nn");}}
["aliasKatakana","aliasRomaji","aliasRomajiNN"].forEach(id=>$(id).addEventListener("input",()=>{$(id).dataset.manual="1";}));
$("aliasHiragana").addEventListener("input",()=>{ $("aliasKatakana").dataset.manual="";$("aliasRomaji").dataset.manual="";$("aliasRomajiNN").dataset.manual="";syncKanaAliases();});
async function updatePublishTagPreview(){const preview=$("publishTagPreview"),style=$("publishTagStyle")?.value||"classic",color=$("publishTagColor")?.value||"#ffffff",textColor=$("publishTagTextColor")?.value||"#df6547",text=$("publishTagText")?.value||"PREVIEW";if(!preview)return;preview.className="publish-tag-preview "+style;const chip=preview.querySelector("span");chip.textContent=text||"PREVIEW";chip.style.background=color;chip.style.color=textColor;preview.style.setProperty("--tag-color",color);preview.style.setProperty("--tag-text-color",textColor);}document.addEventListener("change",event=>{if(["publishTagStyle","publishTagColor","publishTagTextColor"].includes(event.target.id))updatePublishTagPreview();});document.addEventListener("input",event=>{if(event.target.id==="publishTagText")updatePublishTagPreview();});async function openPublishModal(){
 $("publishModal").classList.add("open");$("publishTitle").value=project.name||"新しいゲーム";$("publishSlug").value=project.publishedMeta?.slug||slugifyGameName(project.name||"");$("publishSlug").dataset.edited=project.publishedGameId?"1":"";$("publishDescription").value=project.publishedMeta?.description||"";const savedAliases=project.publishedMeta?.searchAliases||{};fillAliasFields([savedAliases.kanji||((/[一-龯々]/.test(project.name||""))?(project.name||""):""),savedAliases.hiragana||(/[ぁ-ゖァ-ヶ]/.test(project.name||"")?kanaToHiragana(project.name):""),savedAliases.katakana||(/[ぁ-ゖァ-ヶ]/.test(project.name||"")?kanaToKatakana(project.name):""),savedAliases.romaji||(/[ぁ-ゖァ-ヶ]/.test(project.name||"")?kanaToRomaji(project.name,"n"):""),savedAliases.romajiNN||(/[ぁ-ゖァ-ヶ]/.test(project.name||"")?kanaToRomaji(project.name,"nn"):""),savedAliases.other||""]);syncKanaAliases();const savedIcon=project.publishedMeta?.icon||"🎮";$("publishIcon").value=String(savedIcon).startsWith("data:image/")?"🎮":savedIcon;publishIconData=project.publishedMeta?.iconImage||(String(savedIcon).startsWith("data:image/")?savedIcon:"");showPublishIconPreview();$("publishIconFile").value="";const savedCategories=project.publishedMeta?.categories||(project.publishedMeta?.category?[project.publishedMeta.category]:[project.type==="platformer"?"action":"other"]);$("publishCategories").querySelectorAll("input").forEach(input=>{input.checked=savedCategories.includes(input.value);});$("publishTagText").value=project.publishedMeta?.tagText??"KURO STUDIO";$("publishTagStyle").value=project.publishedMeta?.tagStyle||"classic";$("publishTagColor").value=project.publishedMeta?.tagColor||"#ffffff";$("publishTagTextColor").value=project.publishedMeta?.tagTextColor||"#df6547";updatePublishTagPreview();
 $("publishStatus").textContent="ログイン状態を確認しています…";$("confirmPublish").disabled=true;publishAllowed=false;
 if(!publishDb){$("publishStatus").textContent="Supabaseに接続できません。ページを再読み込みしてください。";return;}
 try{const {data:{session},error}=await getStudioSession(publishDb);if(error)throw error;if(!session){$("publishStatus").textContent="KURO Labにログインしてください。ログイン後、この画面を再読み込みしてください。";return;}publishUser=session.user;
  const {data:admin,error:adminError}=await publishDb.from("admin_users").select("user_id").eq("user_id",session.user.id).maybeSingle();if(adminError)throw adminError;
  if(!admin){$("publishStatus").textContent="このアカウントには公開権限がありません。KURO Lab管理者アカウントでログインしてください。";return;}
  publishAllowed=true;$("confirmPublish").disabled=false;$("publishStatus").textContent="管理者として認証済み。公開前にタイトル・説明・ジャンルを確認してください。";
 }catch(e){$("publishStatus").textContent="確認エラー: "+(e.message||"Supabaseへの接続に失敗しました");}
}
async function publishCurrentGame(){
 if(!publishAllowed||!publishUser||!publishDb)return;
 const title=$("publishTitle").value.trim(),slug=$("publishSlug").value.trim().toLowerCase(),description=$("publishDescription").value.trim(),categories=[...$("publishCategories").querySelectorAll("input:checked")].map(input=>input.value),category=categories[0]==="none"?"other":(categories[0]||"other"),icon=publishIconData||$("publishIcon").value.trim()||"🎮";
 if(!title||! /^[a-z0-9][a-z0-9-]{2,47}$/.test(slug)){toast("タイトルとURL用IDを確認してください");return;}
 activeCode()[activeTab]=currentValue();const html=makeDocument(codeForSurface("pc"),"pc",false),mobileHtml=makeDocument(codeForSurface("mobile"),"mobile",false);if(html.length>1000000||mobileHtml.length>1000000){toast("PC版またはスマホ版のHTMLが大きすぎます（上限約1MB）");return;}
 $("confirmPublish").disabled=true;$("publishStatus").textContent="KURO GAMESへ公開中…";
 try{const now=new Date().toISOString();
  if(!categories.length){toast("ジャンルを1つ以上選択してください");$("confirmPublish").disabled=false;return;}const tagText=$("publishTagText").value.trim().slice(0,18),tagStyle=$("publishTagStyle").value,tagColor=$("publishTagColor").value,tagTextColor=$("publishTagTextColor").value;const searchAliases=readAliasFields();const generatedWidthAliases=[...new Set([title,searchAliases.kanji,searchAliases.hiragana,searchAliases.katakana,searchAliases.romaji,searchAliases.romajiNN,searchAliases.other].flatMap(latinWidthCaseVariants).filter(v=>v&&v!==title))];const otherAliases=[searchAliases.other,...generatedWidthAliases].filter(Boolean).join(" ");const aliasArray=[searchAliases.kanji||null,searchAliases.hiragana||null,searchAliases.katakana||null,searchAliases.romaji||null,searchAliases.romajiNN||null,otherAliases||null];const payload={owner_id:publishUser.id,slug,title,description,category,categories,icon,search_aliases:aliasArray,tag_text:tagText,tag_style:tagStyle,tag_color:tagColor,tag_text_color:tagTextColor,html_content:html,mobile_html_content:mobileHtml,shared_js_content:project.sharedJs||"",pc_extension_js_content:project.pcExtensionJs||"",mobile_extension_js_content:project.mobileExtensionJs||"",status:"published",updated_at:now};
  let data,error;
  if(project.publishedGameId){
   const result=await publishDb.from("game_studio_games").update(payload).eq("id",project.publishedGameId).eq("owner_id",publishUser.id).select("id,slug").single();data=result.data;error=result.error;
  }else{
   payload.published_at=now;
   const result=await publishDb.from("game_studio_games").insert(payload).select("id,slug").single();data=result.data;error=result.error;
  }
  if(error)throw error;
  project.publishedGameId=data.id;project.publishedMeta={slug,title,description,category,categories,searchAliases,icon:publishIconData?"🎮":icon,iconImage:publishIconData,tagText,tagStyle,tagColor,tagTextColor};project.updatedAt=Date.now();
  const publishBtn=$("publishBtn");if(publishBtn)publishBtn.textContent="公開内容を更新";
  persist(true);
  try{localStorage.removeItem("kuroGameStudio.publishedDraft."+data.id);}catch(_){} $("publishStatus").textContent="公開しました！\n"+location.origin+"/games/play/?id="+data.id;toast("KURO GAMESに公開しました");$("confirmPublish").disabled=false;
 }catch(e){$("publishStatus").textContent="公開できませんでした: "+(e.message||"不明なエラー");$("confirmPublish").disabled=false;}
}
$("publishBtn").addEventListener("click",openPublishModal);$("cancelPublish").addEventListener("click",()=>$("publishModal").classList.remove("open"));$("publishModal").addEventListener("click",e=>{if(e.target===$("publishModal"))$("publishModal").classList.remove("open");});$("confirmPublish").addEventListener("click",publishCurrentGame);
$("publishIconFile").addEventListener("change",async()=>{const file=$("publishIconFile").files&&$("publishIconFile").files[0];if(!file)return;try{await openIconCrop(file);}catch(e){toast(e.message||"画像を読み込めませんでした");$("publishIconFile").value="";}});$("removePublishIcon").addEventListener("click",()=>{publishIconData="";$("publishIconFile").value="";showPublishIconPreview();});
$("publishTitle").addEventListener("input",()=>{if(!$("publishSlug").dataset.edited)$("publishSlug").value=slugifyGameName($("publishTitle").value);});$("publishSlug").addEventListener("input",()=>{$("publishSlug").dataset.edited="1";});

async function loadPublishedGameFromCloud(){
 const id=new URLSearchParams(location.search).get("publishedId");if(!id)return;
 if(!publishDb){toast("Supabaseに接続できません");return;}
 try{
  const {data:{session},error:authError}=await getStudioSession(publishDb);if(authError)throw authError;
  if(!session){toast("公開作品を編集するにはログインしてください");return;}
  const {data,error}=await publishDb.from("game_studio_games").select("id,slug,title,description,category,categories,icon,search_aliases,tag_text,tag_style,tag_color,html_content,mobile_html_content,shared_js_content,pc_extension_js_content,mobile_extension_js_content,updated_at").eq("id",id).eq("owner_id",session.user.id).maybeSingle();
  if(error)throw error;if(!data)throw new Error("作品が見つからないか、編集権限がありません");
  const cleanPublishedHtml=stripStudioInjectedRuntime(data.html_content||"");const parsed=splitMixedCode(cleanPublishedHtml);
  const mobileDocument=String(data.mobile_html_content||"").trim();
  if(!mobileDocument)throw new Error("モバイル版コードが保存されていません。PC版コードで代用せず、モバイル版コードを登録してください。");
  const cleanMobilePublishedHtml=stripStudioInjectedRuntime(mobileDocument);
  const mobileParsed=splitMixedCode(cleanMobilePublishedHtml);
  const draftKey="kuroGameStudio.publishedDraft."+data.id;let draft=null;try{draft=JSON.parse(localStorage.getItem(draftKey)||"null");}catch(_){}
  const remoteUpdated=Date.parse(data.updated_at||"")||0;
  let useDraft=!!(draft&&draft.publishedGameId===data.id&&Number(draft.updatedAt||0)>remoteUpdated);
  // CSPで禁止されるnew Functionによる構文検査は行わず、プレビュー側のSyntaxErrorを検知して公開版へ自動復旧する。
  activePublishedDraft=useDraft;
  let remoteSharedJs=String(data.shared_js_content||"");
  let remotePcExtensionJs=String(data.pc_extension_js_content||"");
  let remoteMobileExtensionJs=String(data.mobile_extension_js_content||"");
  const legacyParsedPcJs=String(parsed.parts.js||"");
  const legacyParsedMobileJs=String(mobileParsed.parts.js||"");
  if(!remoteSharedJs&&!remotePcExtensionJs&&!remoteMobileExtensionJs&&(legacyParsedPcJs||legacyParsedMobileJs)){
   if(legacyParsedPcJs===legacyParsedMobileJs)remoteSharedJs=legacyParsedPcJs;
   else{remotePcExtensionJs=legacyParsedPcJs;remoteMobileExtensionJs=legacyParsedMobileJs;}
  }
  let loadedSharedJs=useDraft&&typeof draft.sharedJs==="string"?draft.sharedJs:remoteSharedJs;
  let loadedPcExtensionJs=useDraft&&typeof draft.pcExtensionJs==="string"?draft.pcExtensionJs:remotePcExtensionJs;
  let loadedMobileExtensionJs=useDraft&&typeof draft.mobileExtensionJs==="string"?draft.mobileExtensionJs:remoteMobileExtensionJs;
  if(useDraft&&typeof draft.sharedJs!=="string"&&draft.code){
   const draftPcJs=String(draft.code.js||"");
   const draftMobileJs=String(draft.mobileCode&&draft.mobileCode.js||draftPcJs);
   if(draftPcJs===draftMobileJs)loadedSharedJs=draftPcJs;
   else if(draftPcJs||draftMobileJs){loadedPcExtensionJs=draftPcJs;loadedMobileExtensionJs=draftMobileJs;}
  }
  publishedFallbackCode=Object.assign({},clone(parsed.parts),{js:remoteSharedJs,platformJs:remotePcExtensionJs});
  publishedFallbackMobileCode=Object.assign({},clone(mobileParsed.parts),{js:remoteSharedJs,platformJs:remoteMobileExtensionJs});
  publishedFallbackId=data.id;
  publishedFallbackRecovered=false;
  const savedSettings=useDraft&&draft.settings&&typeof draft.settings==="object"?clone(draft.settings):{};
  const publishedFrame=String(data.html_content||"").match(/<meta\s+name=["']kuro-game-frame["']\s+content=["'](\d{3,4})x(\d{3,4})["'][^>]*>/i);
  const publishedWidth=publishedFrame?Math.max(240,Math.min(3840,Number(publishedFrame[1]))):960;
  const publishedHeight=publishedFrame?Math.max(160,Math.min(2160,Number(publishedFrame[2]))):540;
  const isKuroXoGame=data.id==="2dbd6773-2684-4f00-973e-c46acbc348e7";
  const loadedCode=useDraft&&draft.code?clone(draft.code):clone(parsed.parts);
  const loadedMobileCode=useDraft&&draft.mobileCode
   ?Object.assign({},clone(mobileParsed.parts),clone(draft.mobileCode))
   :clone(mobileParsed.parts);
  loadedCode.js="";
  loadedMobileCode.js="";
  if(isKuroXoGame){
   // Force Studio to use the current published layout instead of stale 960x540 draft dimensions.
   savedSettings.gameFrameWidth=publishedWidth;
   savedSettings.gameFrameHeight=publishedHeight;
   const xoUtilityMatch=String(data.html_content||"").match(/<style\b[^>]*id=["']kuro-xo-utility-compat["'][^>]*>([\s\S]*?)<\/style\s*>/i);
   if(xoUtilityMatch){
    const utilityCss=String(xoUtilityMatch[1]||"").trim();
    if(utilityCss&&!String(loadedCode.css||"").includes("KURO 〇✕ゲーム: Tailwind utility compatibility layer")){
     loadedCode.css=(String(loadedCode.css||"").trim()+"\n\n"+utilityCss).trim();
    }
   }
  }else{
   if(!Number(savedSettings.gameFrameWidth))savedSettings.gameFrameWidth=publishedWidth;
   if(!Number(savedSettings.gameFrameHeight))savedSettings.gameFrameHeight=publishedHeight;
  }
  project={id:"published-"+data.id,name:useDraft?(draft.name||data.title||"公開済みゲーム"):(data.title||"公開済みゲーム"),type:data.category==="action"?"platformer":"published",background:"#101522",objects:[],events:[],settings:savedSettings,tilemap:{cols:20,rows:12,cells:Array(240).fill(-1),enabled:false},assets:[],prefabs:[],layers:["Default"],collisionMatrix:{},code:loadedCode,mobileCode:loadedMobileCode,sharedJs:loadedSharedJs,pcExtensionJs:loadedPcExtensionJs,mobileExtensionJs:loadedMobileExtensionJs,publishedGameId:data.id,publishedMeta:{slug:data.slug,title:data.title,description:data.description,category:data.category,categories:data.categories?.length?data.categories:[data.category||"other"],icon:data.icon,searchAliases:(()=>{const a=Array.isArray(data.search_aliases)?data.search_aliases:[];return {kanji:a[0]||"",hiragana:a[1]||"",katakana:a[2]||"",romaji:a[3]||"",other:a[4]||""};})(),tagText:data.tag_text||"KURO STUDIO",tagStyle:data.tag_style||"classic",tagColor:data.tag_color||"#ffffff",tagTextColor:data.tag_text_color||"#df6547"},updatedAt:useDraft?draft.updatedAt:Date.now()};
  $("projectName").value=project.name;$("publishBtn").textContent="公開内容を更新";
  setStatus(useDraft?"● 下書きから復元":"● 公開作品を読み込み済み","var(--good)");
  showTab("html");run();
  toast(useDraft?"下書きを復元しました":"公開済みゲームをStudioに読み込みました");
 }catch(e){toast("読み込み失敗: "+(e.message||"不明なエラー"));}
}
let pendingImport=null;
if($("importCodeBtn"))$("importCodeBtn").addEventListener("click",()=>{$("importModal").classList.add("open");$("importSource").focus();});
$("cancelImport").addEventListener("click",()=>{$("importModal").classList.remove("open");});
$("analyzeImport").addEventListener("click",()=>{
 try{pendingImport=splitMixedCode($("importSource").value);const p=pendingImport.parts;$("importResult").textContent="自動判定結果\nHTML: "+p.html.length+" 文字\nCSS: "+p.css.length+" 文字\nJavaScript: "+p.js.length+" 文字"+(pendingImport.notes.length?"\n\n補足: "+pendingImport.notes.join(" / "):"\n\n分別できました。反映前に各タブの内容を確認できます。");$("applyImport").disabled=false;}
 catch(e){pendingImport=null;$("applyImport").disabled=true;$("importResult").textContent="解析できませんでした: "+e.message;}
});
$("applyImport").addEventListener("click",()=>{
 if(!pendingImport)return;
 setActiveCode(pendingImport.parts);
 showTab("html");$("importModal").classList.remove("open");run();markDirty();toast("HTML・CSS・JavaScriptに分別して反映しました");
});
$("importModal").addEventListener("click",e=>{if(e.target===$("importModal"))$("importModal").classList.remove("open");});
const codeFileInput=$("codeFileInput");
$("fileLoadBtn").addEventListener("click",()=>codeFileInput.click());
codeFileInput.addEventListener("change",async()=>{
 const files=Array.from(codeFileInput.files||[]);codeFileInput.value="";if(!files.length)return;
 const updates={html:[],css:[],js:[],platformjs:[]},notes=[],scriptFiles=new Map(),referencedScripts=new Set();
 try{
  activeCode()[activeTab]=currentValue();
  const normalizeScriptName=value=>{let p=String(value||"").split(/[?#]/)[0];try{p=decodeURIComponent(p);}catch(_){}return p.split(/[\/]/).pop().toLowerCase().replace(/\s*\(\d+\)(?=\.[^.]+$)/,"");};
  const loaded=[];
  for(const file of files){const name=file.name||"ファイル",ext=(name.split(".").pop()||"").toLowerCase(),source=await file.text();loaded.push({name,ext,source});if(["js","mjs"].includes(ext))scriptFiles.set(normalizeScriptName(name),source);}
  const inlineFileScripts=sourceText=>sourceText.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script\s*>/gi,(whole,before,quote,src,after)=>{
   const body=scriptFiles.get(normalizeScriptName(src));if(body==null)return whole;
   referencedScripts.add(normalizeScriptName(src));
   const attrs=(before+" "+after).replace(/\s+(?:src|async|defer|integrity|crossorigin)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,"");
   const moduleMode=/\btype\s*=\s*["']module["']/i.test(attrs)||/\b(?:import|export)\s/.test(body)||/\bawait\b/.test(body)||/\.mjs$/i.test(src);
   const clean=attrs.replace(/\s+type\s*=\s*(["']).*?\1/i,"");
   return "<scr"+"ipt"+clean+(moduleMode?' type="module"':"")+">"+safeScript(body)+"<"+"/script>";
  });
  for(const item of loaded){
   const {name,ext,source}=item;
   if(["html","htm","xhtml","txt"].includes(ext)){
    const prepared=inlineFileScripts(source),parsed=splitMixedCode(prepared),p=parsed.parts;
    if(p.html&&!/^<!-- HTMLをここに追加できます -->$/.test(p.html))updates.html.push(p.html);
    if(p.css&&!/^\/\* CSSをここに追加できます \*\/$/.test(p.css))updates.css.push(p.css);
    if(p.js&&!/^\/\/ JavaScriptをここに追加できます$/.test(p.js))updates.js.push(p.js);
    notes.push(name+": HTML/CSS/JavaScriptを自動判別");if(parsed.notes.length)notes.push(...parsed.notes.map(n=>name+": "+n));
   }else if(ext==="css"){updates.css.push(source);notes.push(name+": CSSタブへ読み込み");   }
   else if(["js","mjs"].includes(ext)){
    const importedName=normalizeScriptName(name);let matched=referencedScripts.has(importedName);
    const currentHtml=updates.html.length?updates.html.join("\n\n"):String(activeCode().html||"");
    const updatedHtml=currentHtml.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script\s*>/gi,(whole,before,quote,src,after)=>normalizeScriptName(src)===importedName?(matched=true,""):whole);
    if(updates.html.length)updates.html[updates.html.length-1]=updatedHtml;else activeCode().html=updatedHtml;
    const targetTab=activeTab==="platformjs"?"platformjs":"js";
    if(matched){referencedScripts.add(importedName);updates[targetTab].unshift(source);notes.push(name+": HTML参照を除去して"+(targetTab==="platformjs"?"端末別UI・操作JS":"共通JavaScript")+"へ統合");}else{updates[targetTab].push(source);notes.push(name+": "+(targetTab==="platformjs"?"端末別UI・操作JS":"共通JavaScript")+"タブへ読み込み");}
   }else if(["jsx","ts","tsx","json"].includes(ext)){const targetTab=activeTab==="platformjs"?"platformjs":"js";updates[targetTab].push("// "+name+"\n"+source);notes.push(name+": "+(targetTab==="platformjs"?"端末別UI・操作JS":"共通JavaScript")+"タブへ読み込み");}
   else if(["xml","svg"].includes(ext)){updates.html.push(source);notes.push(name+": HTMLタブへ読み込み");}
   else if(ext==="md"){const targetTab=activeTab==="platformjs"?"platformjs":"js";updates[targetTab].push("// "+name+"（Markdownテキスト）\n"+source);notes.push(name+": テキストとしてJavaScriptタブへ読み込み");}
   else throw new Error("未対応のファイル形式です: "+name);
  }
  const applied=Object.keys(updates).filter(tab=>updates[tab].length);if(!applied.length)throw new Error("読み込めるコードが見つかりませんでした。");
  activeCode()[activeTab]=currentValue();
  const occupied=applied.filter(tab=>{const value=String(activeCode()[tab]||"").trim();return value&&!["<!-- HTMLをここに追加できます -->","/* CSSをここに追加できます */","// JavaScriptをここに追加できます"].includes(value);});
  const labels={html:"HTML",css:"CSS",js:"共通JavaScript",platformjs:"端末別UI・操作JS"},summary=applied.map(tab=>labels[tab]).join("・");
  if(occupied.length&&!window.confirm("読み込むファイル: "+files.map(f=>f.name).join("、")+"\n反映先: "+summary+"\n既存コードを上書きします。続行しますか？")){toast("ファイル読み込みをキャンセルしました");return;}
  applied.forEach(tab=>{activeCode()[tab]=updates[tab].join("\n\n");});
  showTab(applied.includes("html")?"html":applied[0]);run();markDirty();$("previewStatus").textContent="複数ファイル読み込み済み";toast(files.length+"個のファイルを読み込みました");if(notes.length)console.info("複数ファイル読み込み:\n"+notes.join("\n"));
 }catch(error){toast("読み込み失敗: "+(error.message||"ファイルを確認してください"));console.error(error);}
});
window.__KURO_STUDIO_BOOT_STAGE__="binding-editor-controls";
const tickerBtn=$("rankingTickerBtn");
if(tickerBtn&&requestedPublishedGameId){
 tickerBtn.style.display="inline-flex";tickerBtn.textContent="🏆 ランキング設定";tickerBtn.title="モードごとのランキング掲載ON/OFF";
 tickerBtn.onclick=async()=>{
  const gameId=project.publishedGameId||requestedPublishedGameId,original=String(project.name||"ゲーム");
  const readMap=key=>{try{const value=JSON.parse(localStorage.getItem(key)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}catch(_){return {};}};
  const textMap=readMap("kuroGamesRankingTickerByGame"),historyMap=readMap("kuroGamesRankingTickerHistoryByGame"),styleMap=readMap("kuroGamesRankingTickerStyleByGame");
  const current=String(textMap[gameId]||""),savedStyle=styleMap[gameId]&&typeof styleMap[gameId]==="object"?styleMap[gameId]:{};
  const defaults={enabled:true,speed:30,direction:"left",textColor:"#164b8e",backgroundColor:"#eaf2ff"};
  const initialStyle=Object.assign({},defaults,savedStyle);
  const safeColor=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):fallback;
  const safeSpeed=value=>Math.max(10,Math.min(100,Math.round(Number(value)||30)));
  const overlay=document.createElement("div");
  overlay.style.cssText="position:fixed;inset:0;z-index:99999;background:#080d18d9;display:grid;place-items:center;padding:16px;font-family:system-ui";
  const panel=document.createElement("section");
  panel.style.cssText="width:min(640px,96vw);max-height:92vh;overflow:auto;background:#111b2c;color:#edf3ff;border:1px solid #34445e;border-radius:18px;padding:20px;box-shadow:0 24px 70px #0008";
  panel.innerHTML='<h2 style="margin:0 0 5px;font-size:19px">ランキング掲載設定</h2><p style="margin:0 0 14px;color:#9eacc4;font-size:12px">ゲーム内のモードごとにランキング掲載をON/OFFできます。OFFにした区分はランキング表示から除外されます。</p><div id="tickerModeStatus" style="font-size:11px;color:#9eacc4;margin-bottom:8px">ランキング区分を読み込み中…</div><div id="tickerModeList" style="display:grid;gap:7px"></div><div style="font-size:10px;color:#8192ad;margin-top:9px">設定は保存するとランキングに反映されます。区分名やスコア自体は変更されません。</div><div style="display:none"><div id="tickerOriginal"></div><textarea id="tickerEdit"></textarea><span id="tickerCount"></span><div id="tickerPreview"></div><input id="tickerEnabled" type="checkbox"><input id="tickerSpeed" type="range"><span id="tickerSpeedValue"></span><select id="tickerDirection"></select><input id="tickerTextColor" type="color"><input id="tickerBackgroundColor" type="color"><button id="tickerStyleReset"></button><select id="tickerHistory"></select><button data-ticker-preset="rank"></button><button data-ticker-preset="hype"></button><button data-ticker-preset="simple"></button><button id="tickerReset"></button></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button id="tickerCancel" type="button">閉じる</button><button id="tickerSave" type="button">設定を保存</button></div>';
  overlay.id="kuroTickerModal";panel.id="kuroTickerPanel";overlay.appendChild(panel);document.body.appendChild(overlay);
  panel.querySelectorAll("button").forEach(b=>{b.style.cssText="cursor:pointer;border:1px solid #3a4b67;background:#1b2940;color:#eaf1ff;border-radius:8px;padding:8px 11px";});
  const originalNode=panel.querySelector("#tickerOriginal"),edit=panel.querySelector("#tickerEdit"),preview=panel.querySelector("#tickerPreview"),count=panel.querySelector("#tickerCount"),history=panel.querySelector("#tickerHistory"),enabled=panel.querySelector("#tickerEnabled"),speed=panel.querySelector("#tickerSpeed"),speedValue=panel.querySelector("#tickerSpeedValue"),direction=panel.querySelector("#tickerDirection"),textColor=panel.querySelector("#tickerTextColor"),backgroundColor=panel.querySelector("#tickerBackgroundColor");
  originalNode.textContent=original;edit.value=current;enabled.checked=initialStyle.enabled!==false;speed.value=String(safeSpeed(initialStyle.speed));direction.value=initialStyle.direction==="right"?"right":"left";textColor.value=safeColor(initialStyle.textColor,defaults.textColor);backgroundColor.value=safeColor(initialStyle.backgroundColor,defaults.backgroundColor);
  const templates={rank:"🏆 "+original+"｜ランキング挑戦中！",hype:"🔥 "+original+"をプレイ！ハイスコアを目指そう！",simple:"✨ "+original+" ✨"};
  const update=()=>{
   const value=edit.value;count.textContent=value.length+" / 160";preview.textContent=value.trim()||original;
   preview.style.color=safeColor(textColor.value,defaults.textColor);preview.style.backgroundColor=safeColor(backgroundColor.value,defaults.backgroundColor);
   speedValue.textContent=safeSpeed(speed.value)+" px/秒";
   preview.style.opacity=enabled.checked?"1":".45";
   preview.title=enabled.checked?"表示ON":"表示OFF";
  };
  update();
  (Array.isArray(historyMap[gameId])?historyMap[gameId]:[]).slice(0,20).forEach(v=>{const o=document.createElement("option");o.value=String(v);o.textContent=String(v);history.appendChild(o);});
  edit.addEventListener("input",update);enabled.addEventListener("change",update);speed.addEventListener("input",update);textColor.addEventListener("input",update);backgroundColor.addEventListener("input",update);
  history.addEventListener("change",()=>{if(history.value){edit.value=history.value;update();}});
  panel.querySelectorAll("[data-ticker-preset]").forEach(b=>b.onclick=()=>{edit.value=templates[b.dataset.tickerPreset];update();});
  const close=()=>overlay.remove();panel.querySelector("#tickerCancel").onclick=close;overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
  panel.querySelector("#tickerReset").onclick=()=>{edit.value="";update();};
  panel.querySelector("#tickerStyleReset").onclick=()=>{enabled.checked=true;speed.value=String(defaults.speed);direction.value=defaults.direction;textColor.value=defaults.textColor;backgroundColor.value=defaults.backgroundColor;update();};
  const modeStatus=panel.querySelector("#tickerModeStatus"),modeContainer=panel.querySelector("#tickerModeList"),saveButton=panel.querySelector("#tickerSave");
  const defaultModeLabels={normal:"通常ルール・勝利数",vanish:"消えるルール・勝利数",gobble:"食べるルール・勝利数",reverse:"逆転ルール・勝利数","wins-bot":"CPU戦・勝利数","wins-online":"オンライン対戦・勝利数",werewolf_villager_wins:"村人陣営の勝利数",werewolf_wolf_wins:"人狼陣営の勝利数",normal_beginner:"ノーマル・初心者"};
  let modeRows=[],modeConfigLoaded=false;
  const renderModeRows=()=>{
   modeContainer.replaceChildren();
   if(!modeRows.length){modeContainer.textContent="現在、編集できるランキング区分はありません。";return;}
   modeRows.forEach((item,index)=>{
    const row=document.createElement("div");row.dataset.mode=item.mode;
    row.style.cssText="display:grid;grid-template-columns:74px minmax(0,1fr) 76px 58px;align-items:center;gap:6px;padding:8px;border:1px solid #273750;border-radius:8px;background:#111d30";
    const toggle=document.createElement("label");toggle.style.cssText="display:flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=item.enabled;checkbox.style.cssText="width:15px;height:15px;accent-color:#58a5ff";
    const toggleText=document.createElement("span");toggleText.textContent="表示";toggle.append(checkbox,toggleText);
    const labelWrap=document.createElement("div");labelWrap.style.cssText="display:grid;gap:4px;min-width:0";
    const originalLabel=document.createElement("div");originalLabel.textContent=defaultModeLabels[item.mode]||(item.mode==="default"?"通常ランキング":item.mode.replace(/[_-]+/g," "));originalLabel.title="元のランキング区分名（固定）";originalLabel.style.cssText="font-size:10px;line-height:1.35;color:#c5d5ec;font-weight:800;overflow-wrap:anywhere";
    const labelInput=document.createElement("input");labelInput.type="text";labelInput.maxLength=64;labelInput.value=item.label;labelInput.placeholder="追加名（任意）";labelInput.dataset.field="label";labelInput.title="元の名前の下に追加表示する名前";
    labelInput.style.cssText="min-width:0;width:100%;box-sizing:border-box;padding:7px;border:1px solid #384966;border-radius:7px;background:#091321;color:#fff;font:11px system-ui";
    labelWrap.append(originalLabel,labelInput);
    const suffixInput=document.createElement("input");suffixInput.type="text";suffixInput.maxLength=10;suffixInput.value=item.scoreSuffix||"";suffixInput.placeholder="単位";suffixInput.dataset.field="suffix";suffixInput.title="スコア単位（空欄なら自動）";
    suffixInput.style.cssText="min-width:0;width:100%;box-sizing:border-box;padding:7px;border:1px solid #384966;border-radius:7px;background:#091321;color:#fff;font:11px system-ui";
    const order=document.createElement("div");order.style.cssText="display:flex;gap:3px;justify-content:flex-end";
    const up=document.createElement("button");up.type="button";up.textContent="↑";up.title="上へ";up.disabled=index===0;
    const down=document.createElement("button");down.type="button";down.textContent="↓";down.title="下へ";down.disabled=index===modeRows.length-1;
    [up,down].forEach(button=>button.style.cssText="padding:6px 8px;border:1px solid #3a4b67;border-radius:6px;background:#1b2940;color:#eaf1ff;cursor:pointer");
    up.onclick=()=>{if(index>0){[modeRows[index-1],modeRows[index]]=[modeRows[index],modeRows[index-1]];renderModeRows();}};
    down.onclick=()=>{if(index<modeRows.length-1){[modeRows[index+1],modeRows[index]]=[modeRows[index],modeRows[index+1]];renderModeRows();}};
    order.append(up,down);row.append(toggle,labelWrap,suffixInput,order);modeContainer.appendChild(row);
   });
  };
  const loadModeSettings=async()=>{
   saveButton.disabled=true;
   try{
    if(!publishDb||!publishDb.functions)throw new Error("ランキング設定への接続を確認できません。");
    const {data,error}=await publishDb.functions.invoke("kurogames-online",{body:{action:"leaderboard_modes",gameId}});
    if(error)throw error;
    const modes=Array.isArray(data?.modes)?data.modes.filter(mode=>typeof mode==="string"&&/^[A-Za-z0-9_-]{1,40}$/.test(mode)):[];
    const config=data?.showcaseConfig?.modes&&typeof data.showcaseConfig.modes==="object"?data.showcaseConfig.modes:{};
    modeRows=modes.map((mode,index)=>{
     const saved=config[mode]&&typeof config[mode]==="object"?config[mode]:{};
     return {mode,enabled:saved.enabled!==false,label:typeof saved.label==="string"?saved.label:"",scoreSuffix:typeof saved.scoreSuffix==="string"?saved.scoreSuffix:"",order:Number.isFinite(Number(saved.order))?Number(saved.order):index};
    }).sort((a,b)=>a.order-b.order);
    modeConfigLoaded=true;modeStatus.textContent=modes.length?modes.length+"種類のランキング区分を読み込みました。":"現在、登録済みのランキング区分はありません。";
    modeStatus.style.color="#8fc5ff";renderModeRows();saveButton.disabled=false;
   }catch(error){
    modeStatus.textContent="区分設定を読み込めませんでした："+(error&&error.message||"ログイン状態を確認してください。");
    modeStatus.style.color="#ffaaaa";modeContainer.textContent="KURO GAME STUDIOにログインした状態で再度開いてください。";
   }
  };
  panel.querySelector("#tickerSave").onclick=async()=>{
   if(!modeConfigLoaded){toast("ランキング区分を読み込めていません。再読み込みしてください");return;}
   const modeConfig={modes:{}};
   Array.from(modeContainer.children).forEach((row,index)=>{
    const mode=row.dataset.mode;if(!mode)return;
    const inputs=row.querySelectorAll("input");
    const label=String(row.querySelector('[data-field="label"]')?.value||"").trim().slice(0,64);
    const rawSuffix=String(row.querySelector('[data-field="suffix"]')?.value||"").trim().slice(0,10);
    modeConfig.modes[mode]={enabled:!!inputs[0]?.checked,label,scoreSuffix:rawSuffix||null,order:index};
   });
   saveButton.disabled=true;modeStatus.textContent="ランキング区分を保存しています…";
   try{
    const {data,error}=await publishDb.functions.invoke("kurogames-online",{body:{action:"ranking_showcase_config_update",gameId,config:modeConfig}});
    if(error)throw error;
    if(!data||data.ok!==true)throw new Error("サーバーから保存完了の応答がありません。");
    close();toast("モード別ランキング掲載設定を保存しました");
   }catch(error){
    modeStatus.textContent="保存できませんでした："+(error&&error.message||"権限・通信を確認してください。");
    modeStatus.style.color="#ffaaaa";toast("ランキング設定の保存に失敗しました");
   }finally{saveButton.disabled=false;}
  };
  loadModeSettings();
  edit.focus();
 };
}
$("projectName").value=project.name||"新しいゲーム";
$("projectName").addEventListener("input",()=>{project.name=$("projectName").value;markDirty();});
$("codeEditor").addEventListener("input",editCurrent);
$("codeEditor").addEventListener("scroll",()=>$("gutter").scrollTop=$("codeEditor").scrollTop);
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{activeCode()[activeTab]=currentValue();showTab(b.dataset.tab);}));
document.querySelectorAll("[data-surface]").forEach(b=>b.addEventListener("click",()=>{
 activeCode()[activeTab]=currentValue();
 activeSurface=b.dataset.surface==="mobile"?"mobile":"pc";
 document.querySelectorAll("[data-surface]").forEach(button=>button.classList.toggle("active",button.dataset.surface===activeSurface));
 showTab(activeTab);run();
}));
$("saveBtn").addEventListener("click",()=>{activeCode()[activeTab]=currentValue();persist(false)});

$("runBtn").addEventListener("click",()=>{activeCode()[activeTab]=currentValue();run();});
$("refreshBtn").addEventListener("click",()=>{activeCode()[activeTab]=currentValue();run()});
$("fitPreviewBtn").addEventListener("click",()=>{previewMode="fit";applyPreviewSize();});$("actualPreviewBtn").addEventListener("click",()=>{previewMode="actual";applyPreviewSize();});window.addEventListener("resize",()=>{if(previewMode==="fit")applyPreviewSize();});
$("sizeBtn").addEventListener("click",()=>{const w=Number(project.settings&&project.settings.gameFrameWidth)||960,h=Number(project.settings&&project.settings.gameFrameHeight)||540,s=Number(project.settings&&project.settings.gameFrameScale)||100;$("previewWidth").value=w;$("previewHeight").value=h;$("previewScale").value=s;$("autoFitOverflow").checked=!(project.settings&&project.settings.autoFitOverflow===false);$("sizeModal").classList.add("open");});
$("sizeCancel").addEventListener("click",()=>$("sizeModal").classList.remove("open"));
$("sizeModal").addEventListener("click",e=>{if(e.target===$("sizeModal"))$("sizeModal").classList.remove("open");});
$("sizeReset").addEventListener("click",()=>{$("previewWidth").value=960;$("previewHeight").value=540;$("previewScale").value=100;});
$("autoFixLayoutBtn").addEventListener("click",()=>{activeCode()[activeTab]=currentValue();const viewport='<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';if(!/name=["']viewport["']/i.test(activeCode().html))activeCode().html=activeCode().html.replace(/<head([^>]*)>/i,'<head$1>'+viewport);const safeCSS="\n/* KURO Studio: responsive layout safety patch */\nhtml,body{max-width:100%;}body{overflow-x:auto;}svg,video,img,iframe{max-width:100%;}img,video{height:auto;}\n";if(!activeCode().css.includes("KURO Studio: responsive layout safety patch"))activeCode().css+=safeCSS;showTab("css");run();markDirty();toast("レスポンシブ補助CSSを追加しました。必要に応じて内容を確認・調整してください。");});$("sizeApply").addEventListener("click",()=>{project.settings=project.settings||{};project.settings.gameFrameWidth=Math.max(240,Math.min(3840,Number($("previewWidth").value)||960));project.settings.gameFrameHeight=Math.max(160,Math.min(2160,Number($("previewHeight").value)||540));project.settings.gameFrameScale=Math.max(25,Math.min(300,Number($("previewScale").value)||100));project.settings.autoFitOverflow=$("autoFitOverflow").checked;$("sizeModal").classList.remove("open");persist(true);run();toast("公開ゲーム画面サイズを保存しました");});
if($("exportBtn"))$("exportBtn").addEventListener("click",()=>{activeCode()[activeTab]=currentValue();persist(true);exportHTML()});
if($("downloadBtn"))$("downloadBtn").addEventListener("click",openDownloadModal);
if($("closeDownloadModal"))$("closeDownloadModal").addEventListener("click",closeDownloadModal);
if($("downloadModal"))$("downloadModal").addEventListener("click",e=>{if(e.target===$("downloadModal"))closeDownloadModal();});
if($("downloadStandaloneBtn"))$("downloadStandaloneBtn").addEventListener("click",()=>{syncEditorBeforeDownload();closeDownloadModal();exportHTML();});
if($("downloadHtmlSourceBtn"))$("downloadHtmlSourceBtn").addEventListener("click",()=>{syncEditorBeforeDownload();closeDownloadModal();downloadSourceFile("html");});
if($("downloadCssSourceBtn"))$("downloadCssSourceBtn").addEventListener("click",()=>{syncEditorBeforeDownload();closeDownloadModal();downloadSourceFile("css");});
if($("downloadJsSourceBtn"))$("downloadJsSourceBtn").addEventListener("click",()=>{syncEditorBeforeDownload();closeDownloadModal();downloadSourceFile("js");});
if($("downloadPlatformJsSourceBtn"))$("downloadPlatformJsSourceBtn").addEventListener("click",()=>{syncEditorBeforeDownload();closeDownloadModal();downloadSourceFile("platformjs");});
if($("downloadAllSourceBtn"))$("downloadAllSourceBtn").addEventListener("click",downloadAllSourceFiles);

function clearConsole(){ $("consoleOutput").textContent="";$("consoleCount").textContent="0"; }
function writeConsole(level,values){const out=$("consoleOutput");const line=document.createElement("div");line.className=level==="error"?"error":level==="warn"?"warn":"";line.textContent="["+String(level).toUpperCase()+"] "+(values||[]).join(" ");out.appendChild(line);out.scrollTop=out.scrollHeight;$("consoleCount").textContent=String(out.children.length);}
window.addEventListener("message",async event=>{
 const frame=$("previewFrame");
 if(event.source!==frame.contentWindow||!event.data)return;
 const msg=event.data;
 if(msg.type==="kuro-online-login-required"){
  toast("オンライン機能にはKUROアカウントへのログインが必要です。画面上部の「KUROアカウント」からログインしてください。");
  return;
 }
 if(msg.type==="kuro-online-auth-request"&&typeof msg.requestId==="string"&&msg.requestId.length<=100){
  try{
   let session=null;
   if(publishDb){
    try{
     const {data,error}=await getStudioSession(publishDb);
     if(error)throw error;
     session=data.session||null;
     if(session?.user?.is_anonymous){
      await publishDb.auth.signOut({scope:"local"}).catch(()=>{});
      session=null;
     }
    }catch(sessionError){
     console.warn("KURO Studio session check failed; online features are disabled in preview:",sessionError);
     session=null;
    }
   }
   event.source.postMessage({
    type:"kuro-online-auth",requestId:msg.requestId,
    access_token:session?.access_token||null,
    useCloudflareProxy:KURO_CLOUDFLARE_TRANSPORT,
    user:session?.user?{id:session.user.id,email:session.user.email??null}:null,
    isGuest:!session,guestMode:!session
   },"*");
  }catch(error){
   event.source.postMessage({type:"kuro-online-auth-error",requestId:msg.requestId,message:error&&error.message||"KUROGAMES認証に失敗しました"},"*");
  }
  return;
 }
 if(msg.type==="kuro-online-proxy-request"){
  if(!KURO_CLOUDFLARE_TRANSPORT||typeof msg.requestId!=="string"||msg.requestId.length>120||msg.path!=="/functions/v1/kurogames-online"||msg.method!=="POST")return;
  try{
   const {data:authData,error:authError}=publishDb?await getStudioSession(publishDb):{data:{session:null},error:null};
   const activeSession=authData?.session;
   if(authError||!activeSession?.access_token||activeSession.user?.is_anonymous){
    const message="オンライン機能を利用するにはKUROアカウントへのログインが必要です。";
    toast(message+" 画面上部の「KUROアカウント」を開いてください。");
    const bodyBase64=btoa(unescape(encodeURIComponent(JSON.stringify({error:message}))));
    event.source.postMessage({type:"kuro-online-proxy-response",requestId:msg.requestId,response:{status:401,headers:{"content-type":"application/json"},bodyBase64}},"*");
    return;
   }
   const bytes=msg.bodyBase64?Uint8Array.from(atob(msg.bodyBase64),ch=>ch.charCodeAt(0)):new Uint8Array();
   const request=new Request(SUPABASE_URL+msg.path,{method:"POST",headers:msg.headers||{},body:bytes});
   const response=await kuroCloudflareFetch(request),responseBytes=new Uint8Array(await response.arrayBuffer());
   let binary="";for(let i=0;i<responseBytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,responseBytes.subarray(i,Math.min(i+0x8000,responseBytes.length)));
   const responseHeaders={};response.headers.forEach((v,k)=>responseHeaders[k]=v);
   event.source.postMessage({type:"kuro-online-proxy-response",requestId:msg.requestId,response:{status:response.status,headers:responseHeaders,bodyBase64:responseBytes.length?btoa(binary):""}},"*");
  }catch(error){event.source.postMessage({type:"kuro-online-proxy-response",requestId:msg.requestId,error:error&&error.message||"Cloudflare中継エラー"},"*");}
  return;
 }
 if(msg.type==="kuro-werewolf-auth-request"){
  try{
   if(!publishDb)throw new Error("Supabaseに接続できません");
   let {data,error}=await getStudioSession(publishDb);
   if(error)throw error;
   let session=data.session||null;
   if(session?.user?.is_anonymous){
    await publishDb.auth.signOut({scope:"local"}).catch(()=>{});
    session=null;
   }
   const storage={};
   const prefix="kuro-werewolf-session:";
   for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key&&key.startsWith(prefix))storage[key.slice(prefix.length)]=localStorage.getItem(key);
   }
   event.source.postMessage({type:"kuro-werewolf-auth",useCloudflareProxy:KURO_CLOUDFLARE_TRANSPORT,access_token:session?.access_token||null,refresh_token:session?.refresh_token||null,isGuest:!session,guestMode:!session,storage},"*");
  }catch(error){
   event.source.postMessage({type:"kuro-werewolf-auth-error",message:error&&error.message||"Supabase認証に失敗しました"},"*");
  }
  return;
 }
 if(msg.type==="kuro-werewolf-storage-set"&&typeof msg.key==="string"&&msg.key.startsWith("werewolf_")){localStorage.setItem("kuro-werewolf-session:"+msg.key,String(msg.value??""));return;}
 if(msg.type==="kuro-werewolf-storage-remove"&&typeof msg.key==="string"&&msg.key.startsWith("werewolf_")){localStorage.removeItem("kuro-werewolf-session:"+msg.key);return;}
 if(msg.type==="kuro-studio-error"){
  const message=String(msg.message||"実行エラー");
  const isSyntaxError=/SyntaxError|Unexpected identifier|Unexpected token|Unexpected end of input|Invalid or unexpected token|unterminated/i.test(message);
  if(isSyntaxError&&activePublishedDraft&&!publishedFallbackRecovered&&publishedFallbackCode&&project.publishedGameId===publishedFallbackId){
   publishedFallbackRecovered=true;activePublishedDraft=false;
   const draftKey="kuroGameStudio.publishedDraft."+publishedFallbackId;
   try{const brokenDraft=localStorage.getItem(draftKey);if(brokenDraft)localStorage.setItem(draftKey+".syntax-backup",brokenDraft);}catch(backupError){console.warn("KURO Studio: 構文エラー下書きのバックアップを保存できませんでした。",backupError);}
   setActiveCode(clone(activeSurface==="mobile"?(publishedFallbackMobileCode||publishedFallbackCode):publishedFallbackCode));project.updatedAt=Date.now();
   showTab(activeTab);persist(true);run();
   setStatus("● 公開版に自動復旧済み","var(--warn)");
   toast("下書きの構文エラーを検出したため公開版に復旧しました。元の下書きもバックアップしました。");
   return;
  }
  const line=Number(msg.line)||0,column=Number(msg.column)||0,filename=String(msg.filename||"");const locationText=line?(filename?filename+" ":"")+"行 "+line+(column?"・"+column+"列":""):filename;const detail=message+(locationText?"\n"+locationText:"")+(msg.stack?"\n"+String(msg.stack).slice(0,1600):"");$("previewStatus").textContent=(line?"エラー（"+line+"行"+(column?"・"+column+"列":"")+"）: ":"エラー: ")+message.slice(0,80);writeConsole("error",[detail]);
 }
 else if(msg.type==="kuro-studio-console"){writeConsole(msg.level,msg.values||[]);}
});
document.addEventListener("keydown",e=>{
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();activeCode()[activeTab]=currentValue();persist(false)}
 if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();activeCode()[activeTab]=currentValue();run()}
 if(e.key==="Tab"&&document.activeElement===$("codeEditor")){e.preventDefault();const el=$("codeEditor"),start=el.selectionStart,end=el.selectionEnd,value=el.value;el.value=value.slice(0,start)+"  "+value.slice(end);el.selectionStart=el.selectionEnd=start+2;editCurrent()}
});
window.addEventListener("beforeunload",()=>{activeCode()[activeTab]=currentValue();persist(true)});
window.__KURO_STUDIO_BOOT_STAGE__="initializing-editor-view";
showTab("html");
if(project.publishedGameId)$("publishBtn").textContent="公開内容を更新";
// Supabase通信はkuroCloudflareFetchで中継済み。未定義の旧リンク変換関数を呼ばない。
window.__KURO_STUDIO_BOOT_STAGE__="starting-cloud-load";
loadPublishedGameFromCloud();
window.__KURO_STUDIO_BOOT_STAGE__="starting-preview";
run();
if(new URLSearchParams(location.search).get("publish")==="1"){openPublishModal();}
window.__KURO_STUDIO_BOOT_STAGE__="studio-ready";
window.__KURO_STUDIO_CORE_READY=true;
})();

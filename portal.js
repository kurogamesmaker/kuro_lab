
(async function(){
"use strict";
function safeStorageGet(name,key){try{return window[name].getItem(key);}catch(e){return null;}}
function safeStorageSet(name,key,value){try{window[name].setItem(key,value);return true;}catch(e){console.warn("KURO storage unavailable:",name);return false;}}
function safeStorageRemove(name,key){try{window[name].removeItem(key);return true;}catch(e){return false;}}

window.__kuroPendingRequests=0;var kuroNativeFetch=window.fetch.bind(window);var trackingUserId=null,trackingVisitorId=null,trackingSessionId=null,trackingWrite=false,trackedPageView=false,trackedSessionUser=null;window.fetch=function(input,init){window.__kuroPendingRequests++;if(typeof updateNetworkStatus==="function")updateNetworkStatus();var apiInfo=trackingWrite?null:classifyApiRequest(input);var started=Date.now();return kuroNativeFetch(input,init).then(function(response){if(apiInfo)queueUsageEvent(response.ok?"api_success":"api_error",{service_key:apiInfo.service,status_code:response.status,error_code:response.ok?null:"http_"+response.status,widget_key:apiInfo.widget});return response;}).catch(function(err){if(apiInfo)queueUsageEvent("api_error",{service_key:apiInfo.service,error_code:"network_error",widget_key:apiInfo.widget});if(!navigator.onLine&&typeof showErrorPanel==="function")showErrorPanel("オフラインです","接続を確認してください。端末の保存データは保持されています。");throw err;}).finally(function(){window.__kuroPendingRequests=Math.max(0,window.__kuroPendingRequests-1);if(typeof updateNetworkStatus==="function")updateNetworkStatus();});};
var SUPABASE_URL="https://cprvpphlfpmiegjiutjn.supabase.co",PUBLISHABLE_KEY="sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
async function ensureSupabaseSdk(){
 if(window.supabase&&typeof window.supabase.createClient==="function")return true;
 var urls=["https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js","https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"];
 for(var i=0;i<urls.length;i++){
  var loaded=await new Promise(function(resolve){
   var script=document.createElement("script");script.src=urls[i];script.onload=function(){resolve(true);};script.onerror=function(){resolve(false);};document.head.appendChild(script);
  });
  if(loaded&&window.supabase&&typeof window.supabase.createClient==="function")return true;
 }
 return false;
}
var supabaseReady=await ensureSupabaseSdk();
// KURO Lab communication is forced through the same-origin Cloudflare Worker proxy.
var useCloudflare=true;

function cloudflareFetch(input,init){
 var req=new Request(input,init),url=new URL(req.url),serviceInfo=url.origin===SUPABASE_URL?classifyApiRequest(url.href):null;
 if(url.origin!==SUPABASE_URL)return fetch(req);
 return req.arrayBuffer().then(function(buf){
  var bytes=new Uint8Array(buf),binary="",step=0x8000;
  for(var i=0;i<bytes.length;i+=step)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+step,bytes.length)));
  var headers={};req.headers.forEach(function(v,k){headers[k]=v;});
  return fetch("/api/cloudflare-relay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:url.pathname+url.search,method:req.method,headers:headers,bodyBase64:bytes.length?btoa(binary):"",clientId:safeStorageGet("localStorage","kuro_portal_guest_id")||"portal-guest"})})
   .then(async function(proxyResponse){
    var result;try{result=await proxyResponse.json();}catch(e){throw new Error("Cloudflare中継サーバーから応答を読み取れませんでした");}
    if(!proxyResponse.ok||!result||typeof result.status!=="number")return new Response(JSON.stringify(result||{message:"Cloudflare proxy error"}),{status:proxyResponse.status||502,headers:{"Content-Type":"application/json"}});
    var responseHeaders=new Headers(result.headers||{}),body=null,status=result.status||502;
    if(result.isBinary&&result.bodyBase64){var raw=atob(result.bodyBase64),out=new Uint8Array(raw.length);for(var j=0;j<raw.length;j++)out[j]=raw.charCodeAt(j);body=out;}
    else if(result.bodyText!==undefined&&![204,205,304].includes(status))body=result.bodyText;
    if(serviceInfo&&!trackingWrite)queueUsageEvent(status>=200&&status<400?"api_success":"api_error",{service_key:serviceInfo.service,status_code:status,error_code:status>=400?"http_"+status:null,widget_key:serviceInfo.widget});
    return new Response(body,{status:status,headers:responseHeaders});
   }).catch(function(error){if(serviceInfo&&!trackingWrite)queueUsageEvent("api_error",{service_key:serviceInfo.service,error_code:"network_error",widget_key:serviceInfo.widget});throw error;});
 });
}
var db=supabaseReady?window.supabase.createClient(SUPABASE_URL,PUBLISHABLE_KEY,{global:{fetch:useCloudflare?cloudflareFetch:window.fetch},auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}}):null;
function classifyApiRequest(input){
 try{
  var raw=typeof input==="string"?input:input&&input.url?input.url:String(input||"");
  var u=new URL(raw,location.href),host=u.hostname.toLowerCase(),p=u.pathname.toLowerCase(),service="";
  if(p.indexOf("/api/cloudflare-relay")===0)return null;
  else if(p.indexOf("/api/workspace-rss")===0||/rss|feed/.test(p))service="rss";
  else if(p.indexOf("/api/ogp")===0||/ogp|opengraph/.test(p))service="ogp";
  else if(/weather|openweathermap|weatherapi/.test(host)||/weather/.test(p))service="weather";
  else if(host===new URL(SUPABASE_URL).hostname){if(p.indexOf("/auth/v1/")===0)service="supabase_auth";else if(p.indexOf("/storage/v1/")===0)service="supabase_storage";else if(p.indexOf("/functions/v1/")===0)service="supabase_edge";else service="supabase_data_api";}
  else if(/youtube|googleapis/.test(host))service="other_api";
  else if(p.indexOf("/api/")===0)service="other_api";
  if(!service||p.indexOf("/rest/v1/usage_events")>=0)return null;
  var active=document.activeElement,widget=active&&active.closest?active.closest("[data-widget-id]"):null;
  return {service:service,widget:widget?String(widget.dataset.widgetId||"").slice(0,64)||null:null};
 }catch(e){return null;}
}
var pendingUsageEvents=[];
function queueUsageEvent(eventName,extra){
 if(!trackingVisitorId||!db)return;
 var payload=Object.assign({user_id:trackingUserId||null,visitor_id:trackingVisitorId,session_id:trackingSessionId,event_name:eventName,page_key:(page||"home").replace(/[^a-zA-Z0-9_/-]/g,"").slice(0,64)||"home"},extra||{});
 if(payload.widget_key&&!/^[a-zA-Z0-9_-]{1,64}$/.test(payload.widget_key))payload.widget_key=null;
 pendingUsageEvents.push(payload);
 flushUsageEvents();
}
function flushUsageEvents(){
 if(trackingWrite||!pendingUsageEvents.length||!db)return;
 var batch=pendingUsageEvents.splice(0,20);
 trackingWrite=true;
 Promise.resolve(db.from("usage_events").insert(batch)).then(function(result){if(result&&result.error)console.debug("KURO usage telemetry skipped",result.error.message);}).catch(function(error){console.debug("KURO usage telemetry skipped",error&&error.message||error);}).finally(function(){trackingWrite=false;if(pendingUsageEvents.length)flushUsageEvents();});
}
function activateUsageTracking(user){
 trackingUserId=user&&user.id||null;
 trackingVisitorId=guest();
 var sessionKey="kuro_usage_session",startedKey="kuro_usage_session_started";
 trackingSessionId=safeStorageGet("sessionStorage",sessionKey);
 if(!trackingSessionId){trackingSessionId=uuid();safeStorageSet("sessionStorage",sessionKey,trackingSessionId);}
 if(safeStorageGet("sessionStorage",startedKey)!==trackingSessionId){safeStorageSet("sessionStorage",startedKey,trackingSessionId);queueUsageEvent("session_start");}
 if(!trackedPageView){queueUsageEvent("page_view");trackedPageView=true;}
 observeDashboardWidgets();
}
var usageViewedWidgets=new Set(),usageWidgetObserver=null;
function observeDashboardWidgets(){
 if(!trackingVisitorId)return;
 if(!usageWidgetObserver&&"IntersectionObserver" in window){
  usageWidgetObserver=new IntersectionObserver(function(entries){
   entries.forEach(function(entry){
    if(!entry.isIntersecting)return;
    var id=String(entry.target.dataset.widgetId||"");
    if(!id||usageViewedWidgets.has(id))return;
    usageViewedWidgets.add(id);queueUsageEvent("widget_view",{widget_key:id});
   });
  },{threshold:0.25});
 }
 document.querySelectorAll(".portal-widget[data-widget-id]").forEach(function(el){
  if(usageWidgetObserver){if(el.dataset.usageObserved!=="1"){el.dataset.usageObserved="1";usageWidgetObserver.observe(el);}}
  else{var id=String(el.dataset.widgetId||"");if(id&&!usageViewedWidgets.has(id)){usageViewedWidgets.add(id);queueUsageEvent("widget_view",{widget_key:id});}}
 });
}
function bindUsageWidgetTracking(){
 if(window.__kuroUsageWidgetTrackingBound)return;
 window.__kuroUsageWidgetTrackingBound=true;
 document.addEventListener("click",function(event){
  var target=event.target&&event.target.closest?event.target.closest("[data-widget-toggle],[data-widget-remove]"):null;
  if(!target)return;
  var id=String(target.dataset.widgetToggle||target.dataset.widgetRemove||"");
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id))return;
  var action=target.hasAttribute("data-widget-remove")?"widget_removed":null;
  window.setTimeout(function(){
   var present=Array.from(document.querySelectorAll(".portal-widget[data-widget-id]")).some(function(el){return el.dataset.widgetId===id;});
   var name=action||(present?"widget_added":"widget_removed");
   queueUsageEvent(name,{widget_key:id});
   observeDashboardWidgets();
  },220);
 },true);
}

console.info("KURO portal transport:",useCloudflare?"Cloudflare relay":"direct");
var S="kuro_portal_v1",G="kuro_portal_guest_id",path=location.pathname.replace(/\/+$/,"")||"/";
var page=path==="/"?"home":path.split("/")[1];
var titles={home:["KURO Lab ポータル","サービス、ゲーム、お知らせにすぐアクセス。"],search:["KURO Lab内を検索","サービス、ゲーム、ガイドをまとめて検索できます。"],notifications:["お知らせ","KURO Labからのお知らせを確認できます。"],mypage:["マイページ","アカウントと利用状況を確認できます。"],favorites:["お気に入り","保存したサービスやゲームを確認できます。"],history:["閲覧履歴","最近開いたサービスやゲームを確認できます。"],achievements:["実績","利用状況に応じた実績を確認できます。"],request:["リクエストBOX","機能やサービスのリクエストを送信できます。"],settings:["設定","ポータルの表示設定を変更できます。"],tools:["ツールボックス","天気・ニュース・世界時計・変換・RSS・稼働状況をまとめて使えます。"],pro:["KURO Labの共通機能","すべての機能を共通で利用できます。"],"theme-studio":["KUROLAB Theme Studio","テーマ・背景・UIを自由にカスタマイズできます。"],"pro-tools":["KUROLAB 開発ツール","JSON・URL・Base64・UUIDなどの開発ツールです。"]};
if(!titles[page])page="home";
var catalog=[
{key:"games",type:"service",title:"KURO GAMES",desc:"ブラウザゲームをまとめて遊べるゲームコーナー",href:"/games/",icon:"🎮",tags:"ゲーム ブラウザ 遊ぶ"},
{key:"tools",type:"page",title:"ツールボックス",desc:"天気・ニュース・世界時計・為替・単位変換・RSS・サイト稼働状況",href:"/tools/",icon:"🧰",tags:"ツール 天気 ニュース 世界時計 為替 単位変換 RSS 稼働状況"},
{key:"pro-tools",type:"page",title:"開発ツール",desc:"JSON整形・URL変換・Base64・UUIDなど",href:"/pro-tools/",icon:"⚡",tags:"JSON URL Base64 UUID 開発ツール"},
{key:"sns",type:"service",title:"KURO SNS",desc:"投稿・フォロー・チャットでつながるソーシャルサービス",href:"/sns/",icon:"💬",tags:"SNS 投稿 フォロー"},
{key:"chat",type:"service",title:"オープンチャット",desc:"アカウント登録なしで参加できる公開チャット",href:"/chat/",icon:"🗨️",tags:"チャット 会話"},
{key:"sushi",type:"game",title:"回転寿司タイピング",desc:"回転寿司をモチーフにしたタイピングゲーム",href:"/game/kaiten-sushi-typing/",icon:"🍣",tags:"タイピング 寿司"},
{key:"blocks",type:"game",title:"ブロックブラスト",desc:"ブロックを配置してラインを消すパズルゲーム",href:"/game/block-blast/",icon:"🧩",tags:"パズル ブロック"},
{key:"about",type:"page",title:"KURO Labについて",desc:"KURO Labの活動やサービスについて",href:"/about/",icon:"🏢",tags:"紹介 運営"},
{key:"guide",type:"page",title:"使い方ガイド",desc:"各サービスの基本的な使い方",href:"/guide/",icon:"📘",tags:"ガイド ヘルプ"},
{key:"faq",type:"page",title:"よくある質問",desc:"利用時の疑問や困ったときの案内",href:"/faq/",icon:"❔",tags:"質問 ヘルプ"}];
var nav=[["home","ホーム","⌂","/"],["search","検索","⌕","/search/"],["games","ゲーム","▣","/games/"],["sns","SNS","◉","/sns/"],["chat","チャット","☷","/chat/"],["favorites","お気に入り","☆","/favorites/"],["history","履歴","◷","/history/"],["notifications","お知らせ","♧","/notifications/"],["mypage","マイページ","◎","/mypage/"],["settings","設定","⚙","/settings/"]];
var st={user:null,kuroId:null,kuroProfile:null,kuroIdLoading:false,kuroIdUserId:null,ann:[],data:null,sync:false,requestNotifications:[],requestUnread:0,adminMessages:[],adminMessageReads:[],adminMessageUnread:0};var proState={active:true,plan:"all",status:"active",features:{workspace_plus:true,pro_tools:true,customization_plus:true,early_access:true,desktop:true,theme_studio:true,developer_mode:true,analytics:"advanced",ai:true,ad_free:true},expiresAt:null,source:"system",fetchedAt:Date.now()};var portalNotificationTopId=null,portalNotificationTimer=null,portalNotificationChannel=null,portalNotificationEventsBound=false,portalAdminMessageTopId=null;window.__kuroPortal={state:st,catalog:catalog,pro:proState,hasProFeature:function(){return true;},save:save,render:render,sync:sync,toast:toast,openQuick:openQuick,closeQuick:closeQuick,applyDisplayPrefs:applyDisplayPrefs};window.dispatchEvent(new Event("kuro:portal-api-ready"));
function $(s,r){return (r||document).querySelector(s);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fmt(v){try{return new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v));}catch(e){return "";}}
function uuid(){return window.crypto&&typeof window.crypto.randomUUID==="function"?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==="x"?r:(r&3|8)).toString(16);});}
function guest(){var x=safeStorageGet("localStorage",G);if(!x){x=uuid();safeStorageSet("localStorage",G,x);}return x;}
function defaults(){return {favorites:[],history:[],preferences:{theme:"light",density:"comfortable",motion:"normal",background:"plain",dashboardLayout:"balanced",dashboardWidgets:["shortcuts","games","weather"],dashboardSizes:{},customLinks:[],weatherCity:"東京",marketSymbol:"TVC:NI225",smartLinks:[],linkGroups:[],quickNote:"",todos:[],pomodoroState:{mode:"work",remaining:1500,endAt:0,running:false},countdownTarget:"",photoFrameUrl:"",mediaEmbedUrl:"",rssFeeds:[],qrValue:"",dashboardViewMode:"grid",dashboardCanvasPositions:{},dashboardCanvasBounds:{width:4800,height:3200},dashboardCanvasZoom:1},updatedAt:0};}
function load(){try{var x=JSON.parse(safeStorageGet("localStorage",S)||"null"),d=Object.assign(defaults(),x||{});d.preferences=Object.assign(defaults().preferences,x&&x.preferences||{});d.preferences.customLinks=(Array.isArray(d.preferences.customLinks)?d.preferences.customLinks:[]).slice(0,16).map(function(v){var href=safeDashboardUrl(v&&v.href),title=String(v&&v.title||"").trim().slice(0,32);return href&&title?{id:String(v.id||uuid()).slice(0,64),title:title,href:href,icon:String(v.icon||"🔗").slice(0,8)}:null;}).filter(Boolean);d.preferences.dashboardSizes=d.preferences.dashboardSizes&&typeof d.preferences.dashboardSizes==="object"?d.preferences.dashboardSizes:{};return d;}catch(e){return defaults();}}
function save(){st.data.updatedAt=Date.now();safeStorageSet("localStorage",S,JSON.stringify(st.data));applyDisplayPrefs();try{window.dispatchEvent(new CustomEvent("kuro:preferences-changed",{detail:st.data.preferences}));}catch(e){}}
function toast(t){var e=$("#portal-toast");e.textContent=t;e.classList.add("show");clearTimeout(window.ptimer);window.ptimer=setTimeout(function(){e.classList.remove("show");},2200);}
function has(k){return st.data.favorites.some(function(x){return x.item_key===k;});}
function favBtn(x){return '<button class="portal-fav" data-fav="'+esc(x.key)+'" aria-pressed="'+has(x.key)+'">'+(has(x.key)?"★ 保存済み":"☆ お気に入り")+'</button>';}
function card(x){return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+x.icon+'</div><div><span class="portal-kicker">'+(x.type==="game"?"GAME":x.type==="page"?"INFO":"SERVICE")+'</span><h3>'+esc(x.title)+'</h3></div></div><p>'+esc(x.desc)+'</p><div class="portal-card-actions"><a class="portal-btn primary small" href="'+x.href+'">開く →</a>'+favBtn(x)+'</div></article>';}
function head(t,d,k){return '<div class="portal-page-heading"><span class="portal-eyebrow">'+(k||"KURO PORTAL")+'</span><h1>'+t+'</h1><p>'+d+'</p></div>';}
function hist(a){if(!a.length)return '<div class="portal-empty"><strong>まだ履歴はありません</strong>サービスやゲームを開くと、ここに表示されます。</div>';return '<div class="portal-list">'+a.map(function(x){return '<div class="portal-list-item"><div class="portal-icon">◷</div><div class="grow"><strong>'+esc(x.title)+'</strong><small>'+fmt(x.visited_at)+'</small></div><a class="portal-btn small" href="'+esc(x.href)+'">開く</a></div>';}).join("")+'</div>';}
function announcements(){if(!st.ann.length)return '<div class="portal-empty"><strong>新しいお知らせはありません</strong>重要なお知らせはここに表示されます。</div>';return '<div class="portal-list">'+st.ann.map(function(a){return '<article class="portal-card portal-announcement"><time>'+fmt(a.created_at)+'</time><h3>'+esc(a.title)+'</h3><p>'+esc(a.body)+'</p>'+(a.href?'<a class="portal-btn small" href="'+esc(a.href)+'">詳しく見る →</a>':"")+'</article>';}).join("")+'</div>';}
function profileSummary(){return st.user?'<p><strong>ログイン中</strong><br>'+esc(st.user.email||"KURO Labアカウント")+'<br>お気に入りや履歴はアカウントに同期されます。</p><a href="/mypage/" class="portal-btn primary small">アカウントを確認 →</a>':'<p>ゲストのままでも利用できます。ログインするとお気に入りや履歴を複数端末で同期できます。</p><a href="/mypage/" class="portal-btn primary small">ログイン・アカウント設定 →</a>';}
function normalizeKuroSearch(s){var v=String(s||"").toLowerCase(),out="";for(var i=0;i<v.length;i++){var c=v.charCodeAt(i);out+=c>=0x30a1&&c<=0x30f6?String.fromCharCode(c-96):v.charAt(i);}return out.split(" ").join("").split("　").join("").split("・").join("").split(".").join("").split("_").join("").split("-").join("");}
function rankKuroSearch(query){var raw=String(query||"").trim();if(!raw)return catalog.slice();var q=normalizeKuroSearch(raw),aliases={games:"ゲーム ゲーム一覧 あそぶ play",tools:"ツール toolbox utility", "pro-tools":"開発 開発ツール json url base64 uuid",sns:"sns ソーシャル 投稿 social",chat:"チャット 会話 chat talk",sushi:"タイピング typing 寿司 回転寿司",blocks:"パズル puzzle ブロック",about:"紹介 kurolab",guide:"ガイド 使い方 help",faq:"質問 faq"};return catalog.map(function(x){var title=normalizeKuroSearch(x.title),desc=normalizeKuroSearch(x.desc),tags=normalizeKuroSearch(x.tags||""),alias=normalizeKuroSearch(aliases[x.key]||""),score=0;if(title===q)score+=120;if(title.indexOf(q)>=0)score+=70;if(tags.indexOf(q)>=0)score+=50;if(alias.indexOf(q)>=0)score+=45;if(desc.indexOf(q)>=0)score+=25;return {item:x,score:score};}).filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score;}).map(function(x){return x.item;});}
function renderPortalAdminMessageList(){
 if(!st.user)return '<div class="portal-empty">共通メッセージを確認するにはログインしてください。<a href="/mypage/">ログインする →</a></div>';
 var items=st.adminMessages||[];
 if(!items.length)return '<div class="portal-empty">共通メッセージはまだありません。</div>';
 var reads=new Set((st.adminMessageReads||[]).map(function(x){return x.message_id;}));
 return '<div class="portal-request-notification-list">'+items.map(function(m){
  var unread=!reads.has(m.id);
  return '<article class="portal-request-notification '+(unread?'is-unread':'is-read')+'"><div class="portal-request-notification-mark">✉</div><div class="portal-request-notification-body"><div class="portal-request-notification-top"><strong>'+esc(m.title)+'</strong><time>'+new Date(m.created_at).toLocaleString("ja-JP")+'</time></div><p>'+esc(m.body)+'</p>'+(m.href?'<a class="portal-btn small" href="'+esc(m.href)+'" target="_blank" rel="noopener noreferrer">リンクを開く ↗</a>':'')+(unread?'<button type="button" class="portal-btn small" data-portal-read-admin-message="'+esc(m.id)+'">既読にする</button>':'<small>既読</small>')+'</div>'+(unread?'<span class="portal-request-notification-dot" aria-label="未読"></span>':'')+'</article>';
 }).join("")+'</div>';
}
async function refreshPortalAdminMessages(showNew){
 if(!db||!st.user)return;
 try{
  var result=await db.from("admin_messages").select("id,title,body,href,audience,recipient_id,created_at").eq("published",true).in("service_scope",["lab","both"]).or("audience.eq.all,recipient_id.eq."+st.user.id).order("created_at",{ascending:false}).limit(100);
  if(result.error)throw result.error;
  var items=result.data||[],ids=items.map(function(x){return x.id;}),reads=[];
  if(ids.length){
   var rr=await db.from("admin_message_reads").select("message_id,read_at").eq("user_id",st.user.id).in("message_id",ids);
   if(rr.error)throw rr.error;
   reads=rr.data||[];
  }
  var top=items.length?items[0].id:null;
  if(showNew&&portalAdminMessageTopId&&top&&top!==portalAdminMessageTopId&&typeof toast==="function")toast("運営から新しい共通メッセージが届きました");
  if(top)portalAdminMessageTopId=top;
  st.adminMessages=items;st.adminMessageReads=reads;
  var readIds=new Set(reads.map(function(x){return x.message_id;}));
  st.adminMessageUnread=items.filter(function(x){return !readIds.has(x.id);}).length;
  updatePortalNotificationBadge();
  if(page==="notifications"&&$("#portal-main"))render();
 }catch(e){console.warn("KURO shared admin message sync failed",e);}
}
async function markPortalAdminMessageRead(id){
 if(!st.user||!id)return;
 var now=new Date().toISOString();
 var result=await db.from("admin_message_reads").upsert({message_id:id,user_id:st.user.id,read_at:now},{onConflict:"message_id,user_id"});
 if(result.error){if(typeof toast==="function")toast("共通メッセージを既読にできませんでした");return;}
 var old=(st.adminMessageReads||[]).find(function(x){return x.message_id===id;});
 if(old)old.read_at=now;else st.adminMessageReads.push({message_id:id,read_at:now});
 st.adminMessageUnread=Math.max(0,st.adminMessageUnread-(old?0:1));
 updatePortalNotificationBadge();render();
}
async function markAllPortalAdminMessagesRead(){
 var ids=(st.adminMessages||[]).filter(function(x){return !(st.adminMessageReads||[]).some(function(r){return r.message_id===x.id;});}).map(function(x){return x.id;});
 if(!st.user||!ids.length)return;
 var now=new Date().toISOString();
 var result=await db.from("admin_message_reads").upsert(ids.map(function(id){return {message_id:id,user_id:st.user.id,read_at:now};}),{onConflict:"message_id,user_id"});
 if(result.error){if(typeof toast==="function")toast("既読にできませんでした");return;}
 ids.forEach(function(id){st.adminMessageReads.push({message_id:id,read_at:now});});
 st.adminMessageUnread=0;updatePortalNotificationBadge();render();
}
function renderPortalRequestNotificationList(){
 if(!st.user)return '<div class="portal-empty">返信通知を受け取るにはログインしてください。<a href="/mypage/">ログインする →</a></div>';
 var items=st.requestNotifications||[];
 if(!items.length)return '<div class="portal-empty">新しい返信通知はありません。</div>';
 return '<div class="portal-request-notification-list">'+items.map(function(n){var r=n.request||{};return '<article class="portal-request-notification '+(n.read_at?'is-read':'is-unread')+'"><div class="portal-request-notification-mark">✉</div><div class="portal-request-notification-body"><div class="portal-request-notification-top"><strong>リクエストBOXに返信が届きました</strong><time>'+new Date(n.created_at).toLocaleString("ja-JP")+'</time></div><p>'+esc(r.admin_reply||"運営から返信がありました。")+'</p><small>リクエスト：'+esc(r.message||"")+'</small><button type="button" class="portal-btn small" data-portal-open-request-notification="'+esc(n.id)+'">リクエストBOXを開く →</button></div>'+(n.read_at?'':'<span class="portal-request-notification-dot" aria-label="未読"></span>')+'</article>';}).join("")+'</div>';
}
async function refreshPortalRequestNotifications(showNew){
 if(!db||!st.user)return;
 try{
  var result=await db.from("portal_request_notifications").select("id,request_id,created_at,read_at,request:portal_requests(message,admin_reply,replied_at)").eq("user_id",st.user.id).order("created_at",{ascending:false}).limit(50);
  if(result.error)throw result.error;
  var items=result.data||[],top=items.length?items[0].id:null;
  if(showNew&&portalNotificationTopId&&top&&top!==portalNotificationTopId){if(typeof toast==="function")toast("リクエストBOXに運営から返信が届きました");}
  if(top)portalNotificationTopId=top;
  st.requestNotifications=items;
  st.requestUnread=items.filter(function(x){return !x.read_at;}).length;
  updatePortalNotificationBadge();
  if(page==="notifications"&&$("#portal-main"))render();
 }catch(e){console.warn("KURO portal notification sync failed",e);}
}
function updatePortalNotificationBadge(){
 var badge=$("#portal-notification-badge"),bell=$("#portal-notification-bell");
 var unread=st.requestUnread+st.adminMessageUnread;
 if(badge){badge.textContent=unread>99?"99+":String(unread);badge.hidden=!unread;}
 if(bell){bell.setAttribute("aria-label",unread?"未読通知 "+unread+" 件":"お知らせ");bell.classList.toggle("has-unread",!!unread);}
 document.querySelectorAll('a[href="/notifications/"]').forEach(function(a){a.classList.toggle("has-notification-unread",!!unread);});
 window.dispatchEvent(new Event("kuro:portal-notifications-updated"));
}
function startPortalRequestNotificationSync(){
 if(portalNotificationChannel&&db){try{db.removeChannel(portalNotificationChannel);}catch(e){}portalNotificationChannel=null;}
 if(portalNotificationTimer)clearInterval(portalNotificationTimer);
 portalNotificationTopId=null;portalAdminMessageTopId=null;
 if(!st.user||!db){st.requestNotifications=[];st.requestUnread=0;st.adminMessages=[];st.adminMessageReads=[];st.adminMessageUnread=0;updatePortalNotificationBadge();return;}
 refreshPortalRequestNotifications(false);refreshPortalAdminMessages(false);
 portalNotificationTimer=setInterval(function(){if(document.visibilityState!=="hidden"){refreshPortalRequestNotifications(true);refreshPortalAdminMessages(true);}},25000);
 if(!useCloudflare&&db.channel){
  portalNotificationChannel=db.channel("portal-request-notifications-"+st.user.id)
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"portal_request_notifications",filter:"user_id=eq."+st.user.id},function(){refreshPortalRequestNotifications(true);})
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"admin_messages"},function(){refreshPortalAdminMessages(true);})
   .subscribe();
 }
 if(!portalNotificationEventsBound){
  portalNotificationEventsBound=true;
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"){refreshPortalRequestNotifications(true);refreshPortalAdminMessages(true);}});
  window.addEventListener("focus",function(){refreshPortalRequestNotifications(true);refreshPortalAdminMessages(true);});
 }
}
async function markPortalRequestNotificationRead(id){
 var item=(st.requestNotifications||[]).find(function(x){return x.id===id;});
 if(!item||item.read_at)return;
 var result=await db.from("portal_request_notifications").update({read_at:new Date().toISOString()}).eq("id",id).eq("user_id",st.user.id);
 if(result.error){if(typeof toast==="function")toast("通知を既読にできませんでした");return;}
 item.read_at=new Date().toISOString();st.requestUnread=Math.max(0,st.requestUnread-1);updatePortalNotificationBadge();
}
function bindPortalNotificationActions(){
 document.querySelectorAll("[data-portal-read-admin-message]").forEach(function(b){b.onclick=function(){b.disabled=true;markPortalAdminMessageRead(b.dataset.portalReadAdminMessage);};});
 var markAdmin=document.querySelector("[data-portal-mark-all-admin]");
 if(markAdmin)markAdmin.onclick=markAllPortalAdminMessagesRead;
 document.querySelectorAll("[data-portal-open-request-notification]").forEach(function(b){b.onclick=async function(){b.disabled=true;await markPortalRequestNotificationRead(b.dataset.portalOpenRequestNotification);location.href="/request/";};});
 var all=document.querySelector("[data-portal-mark-all]");
 if(all)all.onclick=async function(){if(!st.user||!st.requestUnread)return;all.disabled=true;var ids=(st.requestNotifications||[]).filter(function(x){return !x.read_at;}).map(function(x){return x.id;});if(!ids.length)return;var result=await db.from("portal_request_notifications").update({read_at:new Date().toISOString()}).in("id",ids).eq("user_id",st.user.id);if(result.error){all.disabled=false;if(typeof toast==="function")toast("既読にできませんでした");return;}st.requestNotifications.forEach(function(x){if(!x.read_at)x.read_at=new Date().toISOString();});st.requestUnread=0;updatePortalNotificationBadge();render();};
}
function render(){var m=$("#portal-main");if(m){document.querySelectorAll("#portal-dashboard-editor").forEach(function(panel){if(!m.contains(panel))panel.remove();});}var v={
home:home,
search:function(){
 var q=new URLSearchParams(location.search).get("q")||"",mode=new URLSearchParams(location.search).get("type")||"web";
 if(["web","images","news","local"].indexOf(mode)<0)mode="web";
 return head("KURO Search","ウェブ・画像・ニュース・KURO Lab内をひとつの画面で検索。","KURO SEARCH")+
 '<section class="kuro-engine"><form id="portal-search-form" class="portal-search kuro-engine-form"><input id="portal-search-input" class="portal-input" type="search" autocomplete="off" maxlength="180" placeholder="検索したい言葉を入力…" value="'+esc(q)+'" aria-label="検索ワード"><button class="portal-btn primary" type="submit">検索</button></form>'+
 '<nav class="kuro-engine-tabs" role="tablist" aria-label="検索カテゴリ">'+
 '<button type="button" role="tab" data-kuro-search-mode="web" aria-selected="'+(mode==="web")+'">ウェブ</button>'+
 '<button type="button" role="tab" data-kuro-search-mode="images" aria-selected="'+(mode==="images")+'">画像</button>'+
 '<button type="button" role="tab" data-kuro-search-mode="news" aria-selected="'+(mode==="news")+'">ニュース</button>'+
 '<button type="button" role="tab" data-kuro-search-mode="local" aria-selected="'+(mode==="local")+'">KURO Lab内</button></nav>'+
 '<p class="kuro-engine-note">外部検索はセーフサーチを有効にして表示します。</p>'+
 '<div id="kuro-search-status" class="kuro-search-status" role="status" aria-live="polite"></div>'+
 '<div id="portal-search-results" class="kuro-engine-results"></div></section>'+
 '<style>.kuro-engine{max-width:980px;margin:0 auto}.kuro-engine-form{display:flex;gap:10px;align-items:center}.kuro-engine-form input{flex:1;min-width:0}.kuro-engine-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:16px 0 8px;border-bottom:1px solid var(--line,rgba(100,110,130,.2));padding-bottom:10px}.kuro-engine-tabs button{border:0;background:transparent;color:var(--muted,#667085);padding:9px 14px;border-radius:10px;font-weight:700;cursor:pointer}.kuro-engine-tabs button[aria-selected="true"]{background:var(--surface-2,rgba(80,100,140,.12));color:var(--text,#1e293b)}.kuro-engine-note,.kuro-search-status{color:var(--muted,#667085);font-size:12px;margin:10px 2px}.kuro-engine-results{display:grid;gap:12px;margin-top:12px}.kuro-web-result{padding:16px 18px;border:1px solid var(--line,rgba(100,110,130,.2));border-radius:14px;background:var(--surface,white);min-width:0}.kuro-web-result a{color:var(--text,#1e293b);text-decoration:none}.kuro-web-result a:hover{text-decoration:underline}.kuro-web-result h2{font-size:17px;line-height:1.45;margin:5px 0 7px}.kuro-web-result p{font-size:13px;line-height:1.7;color:var(--muted,#667085);margin:0}.kuro-web-result .kuro-result-url{font-size:11px;color:#16805d;overflow-wrap:anywhere}.kuro-web-result time{font-size:11px;color:var(--muted,#667085);margin-left:8px}.kuro-image-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.kuro-image-result{overflow:hidden;border:1px solid var(--line,rgba(100,110,130,.2));border-radius:13px;background:var(--surface,white)}.kuro-image-result img{width:100%;height:150px;object-fit:cover;display:block;background:var(--surface-2,rgba(100,110,130,.12))}.kuro-image-result p{font-size:12px;padding:9px 10px;margin:0;color:var(--muted,#667085);line-height:1.5}.kuro-engine-empty{padding:26px 16px;text-align:center;border:1px dashed var(--line,rgba(100,110,130,.25));border-radius:14px;color:var(--muted,#667085)}@media(max-width:600px){.kuro-engine-form{gap:7px}.kuro-engine-form button{white-space:nowrap}.kuro-web-result{padding:13px}.kuro-image-results{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>';
},notifications:function(){return head("KURO NOTIFICATIONS","共通メッセージ、リクエストBOXへの返信、KURO Lab専用のお知らせを確認できます。","NOTIFICATION CENTER")+
'<section class="portal-section"><div class="portal-section-head"><div><h2>KURO SNS・KUROLAB 共通メッセージ</h2><p>管理者からの個別メッセージ・一斉お知らせ。両サービスで共通です。</p></div><button type="button" class="portal-btn small" data-portal-mark-all-admin '+(st.adminMessageUnread?'':'disabled')+'>すべて既読にする</button></div>'+renderPortalAdminMessageList()+'</section>'+
'<section class="portal-section"><div class="portal-section-head"><div><h2>リクエストBOXへの返信</h2><p>運営から返信が届くと、ここに通知されます。</p></div><button type="button" class="portal-btn small" data-portal-mark-all '+(st.requestUnread?'':'disabled')+'>すべて既読にする</button></div>'+renderPortalRequestNotificationList()+'</section>'+announcements()+
'<section class="portal-section portal-notification-channels"><div class="portal-section-head"><div><h2>サービス別の通知</h2><p>通知の種類に応じて、各サービスを確認できます。</p></div></div><div class="portal-notification-channel-grid">'+
'<a class="portal-notification-channel" href="/sns/"><span>💬</span><div><b>KURO SNS</b><small>コメント・返信・フォローなどの通知</small></div><i>↗</i></a>'+
'<a class="portal-notification-channel" href="/chat/"><span>🗨️</span><div><b>KURO CHAT</b><small>チャットの会話を確認</small></div><i>↗</i></a>'+
'</div><p class="portal-notification-note">リクエストBOXへの返信通知はログイン中のアカウントに保存されます。</p></section>';},
favorites:function(){return head("お気に入り","保存したサービスやゲームを確認できます。","YOUR COLLECTION")+(st.data.favorites.length?'<div class="portal-grid">'+st.data.favorites.map(function(x){var c=catalog.find(function(y){return y.key===x.item_key;})||x;return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+(c.icon||"☆")+'</div><h3>'+esc(x.title)+'</h3></div><a class="portal-btn primary small" href="'+esc(x.href)+'">開く →</a> <button class="portal-fav" data-fav="'+esc(x.item_key)+'" aria-pressed="true">★ 保存済み</button></article>';}).join("")+'</div>':'<div class="portal-empty"><strong>お気に入りはまだありません</strong>サービスカードの「お気に入り」から保存できます。</div>');},
history:function(){return head("閲覧履歴","最近開いたサービスやゲームを確認できます。","RECENTLY USED")+hist(st.data.history)+'<div class="portal-card-actions"><button id="portal-clear-history" class="portal-btn small">履歴を消去</button></div>';},
achievements:function(){return head("実績機能の整理","実績機能はホーム画面をシンプルにするため終了しました。お気に入りや履歴は引き続き利用できます。","FEATURE UPDATE") + '<section class="portal-card"><p>保存したサービスはお気に入り、最近開いたページは閲覧履歴から確認できます。</p><div class="portal-card-actions"><a class="portal-btn primary small" href="/">ホームへ戻る</a><a class="portal-btn small" href="/favorites/">お気に入りを見る</a><a class="portal-btn small" href="/history/">閲覧履歴を見る</a></div></section>'},
mypage:function(){return head("マイページ","アカウントと利用情報を確認できます。","MY KURO")+'<section class="portal-card portal-plan-card"><div class="portal-plan-top"><div><span class="portal-eyebrow">KURO LAB ACCESS</span><h2>すべての機能を利用できます</h2></div><span class="portal-plan-pill">ALL FEATURES</span></div><p>KURO Labでは、ログイン状態や利用期間による機能制限はありません。ツール、ワークスペース、テーマカスタマイズを共通で利用できます。</p><div class="portal-card-actions"><a class="portal-btn primary" href="/theme-studio/">Theme Studioを開く →</a><a class="portal-btn" href="/pro-tools/">開発ツールを開く →</a></div></section>'+'<section class="portal-card"><h2>アカウント</h2>'+(st.user?'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0;padding:14px;border-radius:12px;background:var(--portal-surface-2,rgba(120,130,150,.10))"><div style="min-width:0"><small class="portal-eyebrow">YOUR KURO ID</small><div style="font-size:clamp(18px,3vw,24px);font-weight:850;letter-spacing:.06em;overflow-wrap:anywhere">'+esc(st.kuroId||(st.kuroIdLoading?"読み込み中…":"IDを取得できませんでした"))+'</div></div>'+(st.kuroId?'<button id="portal-copy-kuro-id" type="button" class="portal-btn small">IDをコピー</button>':"")+'</div><p class="portal-muted">KURO IDはKURO Lab・KURO SNS・KURO GAMES共通の固定ユーザーIDです。変更できません。</p><p>ログイン中：'+esc(st.kuroProfile&&st.kuroProfile.username?"@"+st.kuroProfile.username:"KUROアカウント")+'</p>':'<p>ゲストとして利用中。この端末にデータを保存しています。</p>')+'<p class="portal-muted">ログインするとゲストデータとアカウントデータを統合します。</p><div class="portal-card-actions">'+(st.user?'<button id="portal-sync-now" class="portal-btn primary">今すぐ同期</button><button id="portal-signout" class="portal-btn">ログアウト</button>':'<button id="portal-open-login" class="portal-btn primary">ログイン・新規登録</button>')+'</div></section><section class="portal-section"><div class="portal-grid"><article class="portal-card"><h3>'+st.data.favorites.length+' 件</h3><p>お気に入り</p><a class="portal-btn small" href="/favorites/">確認する</a></article><article class="portal-card"><h3>'+st.data.history.length+' 件</h3><p>閲覧履歴</p><a class="portal-btn small" href="/history/">確認する</a></article></div></section>'},
request:function(){return head("リクエストBOX","追加してほしい機能や改善してほしい点を送ってください。","FEEDBACK")+'<form id="portal-request-form" class="portal-form"><div class="portal-field"><label for="portal-request-message">リクエスト内容</label><textarea id="portal-request-message" class="portal-textarea" minlength="5" maxlength="500" required placeholder="追加してほしい機能、改善してほしい点など"></textarea><small>5〜500文字。住所・電話番号・学校名・パスワードなどは書かないでください。</small><p class="portal-muted">運営からの返信通知を受け取るにはログインが必要です。ゲスト状態では送信できません。</p></div><div style="position:absolute;left:-9999px" aria-hidden="true"><input id="portal-request-website" tabindex="-1"></div><button class="portal-btn primary">リクエストを送信</button><p id="portal-request-status" role="status" class="portal-muted"></p></form><section class="portal-section"><div class="portal-section-head"><div><h2>送信したリクエスト</h2><p>運営からの返信はこちらに表示されます。</p></div></div><div id="portal-my-requests" class="portal-request-history"><div class="portal-muted">読み込み中…</div></div></section>';},
tools:function(){return head("ツールボックス","天気・ニュース・世界時計・為替・単位変換・RSS・稼働状況をまとめて使えます。","KURO TOOLBOX")+'<div id="kuro-toolbox-root"></div>';},"theme-studio":function(){return head("KUROLAB Theme Studio","テーマ・背景・UIを自由にカスタマイズできます。","KURO DESIGN STUDIO")+'<section class="portal-card"><p>Theme Studioを読み込んでいます…</p></section>';},settings:function(){var p=st.data.preferences,t=p.theme==="dark"?"dark":"light",d=p.density||"comfortable",m=p.motion||"normal";return head("設定","KURO Labの表示やホーム画面を自分好みに調整できます。","PREFERENCES")+'<section class="portal-card"><h2>アカウント設定</h2><p id="portal-username-current" class="portal-muted">アカウント情報を読み込み中…</p><form id="portal-username-form" hidden><div class="portal-field"><label for="portal-new-username">新しいユーザーネーム</label><input id="portal-new-username" class="portal-input" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" autocapitalize="off" spellcheck="false" required><small>半角英数字と_の3〜24文字。ユーザーネームは全サービス共通で変更されます。</small></div><div class="portal-card-actions"><button id="portal-username-submit" type="submit" class="portal-btn primary">ユーザーネームを変更</button></div><p id="portal-username-status" role="status" aria-live="polite" class="portal-muted"></p></form><button id="portal-open-login" type="button" class="portal-btn primary" hidden>ログイン・アカウント作成</button></section><section class="portal-card"><div class="portal-settings-row"><div><strong>テーマ</strong><small>ポータル全体のライト・ダークを切り替えます</small></div><select id="portal-theme" class="portal-select"><option value="light" '+(t==="light"?"selected":"") +'>ホワイト</option><option value="dark" '+(t==="dark"?"selected":"") +'>ダーク</option></select></div><div class="portal-settings-row"><div><strong>表示密度</strong><small>カードの余白や情報量を調整します</small></div><select id="portal-density" class="portal-select"><option value="comfortable" '+(d==="comfortable"?"selected":"") +'>ゆったり</option><option value="compact" '+(d==="compact"?"selected":"") +'>コンパクト</option></select></div><div class="portal-settings-row"><div><strong>アニメーション</strong><small>動きを少なくして表示を軽くします</small></div><select id="portal-motion" class="portal-select"><option value="normal" '+(m==="normal"?"selected":"") +'>通常</option><option value="reduced" '+(m==="reduced"?"selected":"") +'>控えめ</option></select></div><div class="portal-settings-row"><div><strong>ホーム画面</strong><small>ウィジェットや自分のリンクを自由に編集できます</small></div><a href="/" class="portal-btn small">カスタマイズする</a></div><div class="portal-settings-row"><div><strong>Theme Studio</strong><small>カラー・背景画像・UIを自由にカスタマイズ</small></div><a href="/theme-studio/" class="portal-btn small">開く</a></div><div class="portal-settings-row"><div><strong>端末データ</strong><small>この端末のお気に入り・履歴・表示設定を消去します</small></div><button id="portal-reset-local" class="portal-btn small">消去</button></div><div class="portal-settings-row"><div><strong>アカウント同期</strong><small>ログインすると設定や利用データを複数端末で同期できます</small></div><a href="/mypage/" class="portal-btn small">アカウント設定</a></div></section>';},
pro:function(){return head("KURO Labの共通機能","KURO Labの機能はすべての利用者に共通で開放されています。","ALL FEATURES")+'<section class="portal-pro-hero"><div><span class="portal-pro-wordmark">KURO LAB <b>OPEN</b></span><h1>すべての機能を、<br>すべての人へ。</h1><p>プラン区分を廃止しました。ログイン状態や申請・承認に関係なく、KURO Labの機能を共通で利用できます。</p><div class="portal-pro-price">全機能開放 <small>登録後すぐにすべての機能を利用できます</small></div></div><div class="portal-pro-emblem">ALL</div></section><section class="portal-section"><div class="portal-grid"><article class="portal-card"><h2>開発ツール</h2><p>JSON Formatter、URL / Base64 Converter、UUID Generatorを利用できます。</p><a class="portal-btn primary small" href="/pro-tools/">開発ツールを開く →</a></article><article class="portal-card"><h2>Theme Studio</h2><p>カラー、背景画像、カードの透明度、角丸、アイコン、コンテンツ幅をカスタマイズできます。</p><a class="portal-btn primary small" href="/theme-studio/">Theme Studioを開く →</a></article><article class="portal-card"><h2>ワークスペース</h2><p>ホーム画面のワークスペースやウィジェットを自由にカスタマイズできます。</p><a class="portal-btn primary small" href="/">ホームへ →</a></article></div></section>';},
"pro-tools":function(){
 var selected=new URLSearchParams(location.search).get("tool")||"",valid=["json","convert","uuid"].indexOf(selected)>=0;
 var back='<div class="portal-card-actions"><a class="portal-btn small" href="/pro-tools/">← 開発ツール一覧</a></div>';
 if(!valid)return head("開発ツール","使いたいツールを選択してください。","TOOLBOX")+'<section class="portal-section"><div class="portal-grid">'+
  '<article class="portal-card"><h2>JSON Formatter</h2><p class="portal-muted">JSONを整形・圧縮して確認できます。</p><a class="portal-btn primary small" href="/pro-tools/?tool=json">開く →</a></article>'+
  '<article class="portal-card"><h2>URL / Base64 Converter</h2><p class="portal-muted">URLエンコード・デコード、Base64変換に対応。</p><a class="portal-btn primary small" href="/pro-tools/?tool=convert">開く →</a></article>'+
  '<article class="portal-card"><h2>UUID Generator</h2><p class="portal-muted">テストや開発で使えるUUIDを生成します。</p><a class="portal-btn primary small" href="/pro-tools/?tool=uuid">開く →</a></article>'+
 '</div></section>';
 if(selected==="json")return head("JSON Formatter","JSONを整形・圧縮して確認できます。","DEVELOPER TOOL")+back+'<section class="portal-section"><article id="portal-pro-tools" class="portal-card"><h2>JSON Formatter</h2><p class="portal-muted">JSONを入力して整形または圧縮します。</p><textarea id="pro-json-input" class="portal-textarea" rows="9" placeholder="{ &quot;name&quot;: &quot;KUROLAB&quot; }"></textarea><div class="portal-pro-tool-actions"><button class="portal-btn primary small" data-pro-tool="json-format">整形</button><button class="portal-btn small" data-pro-tool="json-minify">圧縮</button></div><textarea id="pro-json-output" class="portal-textarea" rows="9" readonly placeholder="結果がここに表示されます"></textarea></article></section>';
 if(selected==="convert")return head("URL / Base64 Converter","URLエンコード・デコード、Base64変換ができます。","DEVELOPER TOOL")+back+'<section class="portal-section"><article id="portal-pro-tools" class="portal-card"><h2>URL / Base64 Converter</h2><p class="portal-muted">変換するテキストを入力して操作を選択してください。</p><textarea id="pro-convert-input" class="portal-textarea" rows="8" placeholder="変換するテキスト"></textarea><div class="portal-pro-tool-actions"><button class="portal-btn small" data-pro-tool="url-encode">URL encode</button><button class="portal-btn small" data-pro-tool="url-decode">URL decode</button><button class="portal-btn small" data-pro-tool="base64-encode">Base64 encode</button><button class="portal-btn small" data-pro-tool="base64-decode">Base64 decode</button></div><textarea id="pro-convert-output" class="portal-textarea" rows="8" readonly placeholder="変換結果"></textarea></article></section>';
 return head("UUID Generator","ランダムなUUIDを生成します。","DEVELOPER TOOL")+back+'<section class="portal-section"><article id="portal-pro-tools" class="portal-card"><h2>UUID Generator</h2><p class="portal-muted">テストや開発で使えるUUIDを生成します。</p><textarea id="pro-uuid-output" class="portal-textarea" rows="3" readonly placeholder="生成したUUID"></textarea><button class="portal-btn primary small" data-pro-tool="uuid">UUIDを生成</button></article></section>';
}
};m.innerHTML=(v[page]||home)();bind();observeDashboardWidgets();window.dispatchEvent(new Event("kuro:portal-rendered"));}
function updateHeaderPlanBadge(){var badge=$("#portal-header-plan-badge");if(badge)badge.remove();}
function applyProEntitlements(){proState.active=true;proState.plan="all";proState.status="active";proState.features={workspace_plus:true,pro_tools:true,customization_plus:true,early_access:true,desktop:true,theme_studio:true,developer_mode:true,analytics:"advanced",ai:true,ad_free:true};proState.expiresAt=null;proState.source="system";proState.fetchedAt=Date.now();if(window.__kuroPortal)window.__kuroPortal.pro=proState;window.dispatchEvent(new Event("kuro:pro-status-updated"));updateHeaderPlanBadge();return {membership:{status:"active",plan:"all",features:proState.features,expires_at:null},applications:[],invitations:[],can_apply:false};}
async function getFunctionErrorMessage(error){return String(error&&error.message||error||"通信エラー");}
async function refreshProEntitlements(){return applyProEntitlements();}
async function loadProStatus(){return applyProEntitlements();}
function bindProTools(){
 var root=$("#portal-pro-tools"),login=$("#pro-tools-login");if(login)login.onclick=openLogin;if(!root)return;
 root.addEventListener("click",function(event){
  var button=event.target.closest("[data-pro-tool]");if(!button)return;
  var action=button.dataset.proTool,output=null,input="";
  try{
   if(action==="json-format"||action==="json-minify"){
    input=$("#pro-json-input").value;var parsed=JSON.parse(input);output=$("#pro-json-output");output.value=action==="json-format"?JSON.stringify(parsed,null,2):JSON.stringify(parsed);
   }else if(action==="url-encode"||action==="url-decode"||action==="base64-encode"||action==="base64-decode"){
    input=$("#pro-convert-input").value;output=$("#pro-convert-output");
    if(action==="url-encode")output.value=encodeURIComponent(input);
    if(action==="url-decode")output.value=decodeURIComponent(input);
    if(action==="base64-encode")output.value=btoa(unescape(encodeURIComponent(input)));
    if(action==="base64-decode")output.value=decodeURIComponent(escape(atob(input.trim())));
   }else if(action==="uuid"){output=$("#pro-uuid-output");output.value=uuid();}
  }catch(error){if(output)output.value="変換できませんでした："+(error.message||"入力内容を確認してください。");}
 });
}
function bindFav(){document.querySelectorAll("[data-fav]").forEach(function(b){b.onclick=function(){var k=b.dataset.fav,x=catalog.find(function(y){return y.key===k;})||st.data.favorites.find(function(y){return y.item_key===k;});if(!x)return;var i=st.data.favorites.findIndex(function(y){return y.item_key===k;});if(i>=0){st.data.favorites.splice(i,1);save();if(st.user)db.from("portal_favorites").delete().eq("user_id",st.user.id).eq("item_key",k);}else{st.data.favorites.unshift({item_key:k,item_type:x.type,title:x.title,href:x.href,created_at:new Date().toISOString()});save();if(st.user)sync();}render();};});}
function bindKuroEnginePage(){
 var form=$("#portal-search-form"),input=$("#portal-search-input"),results=$("#portal-search-results"),status=$("#kuro-search-status");
 if(!form||!input||!results||!status)return;
 var params=new URLSearchParams(location.search),query=String(params.get("q")||"").trim(),mode=params.get("type")||"web";
 if(["web","images","news","local"].indexOf(mode)<0)mode="web";
 input.value=query;
 function updateAddress(push){
  var u=new URL(location.href);
  if(query)u.searchParams.set("q",query);else u.searchParams.delete("q");
  u.searchParams.set("type",mode);
  if(push)history.pushState({kuroSearch:true},"",u.pathname+u.search);else history.replaceState({kuroSearch:true},"",u.pathname+u.search);
 }
 function updateTabs(){
  document.querySelectorAll("[data-kuro-search-mode]").forEach(function(button){button.setAttribute("aria-selected",String(button.dataset.kuroSearchMode===mode));});
 }
 function showEmpty(message){results.innerHTML='<div class="kuro-engine-empty">'+esc(message)+'</div>';}
 function safeHttpUrl(value){
  try{var u=new URL(String(value||""));return (u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password?u.href:"";}catch(e){return "";}
 }
 function renderWebResults(data){
  var rows=Array.isArray(data.results)?data.results:[];
  if(!rows.length){showEmpty("検索結果がありませんでした。別のキーワードで試してください。");return;}
  var validRows=rows.filter(function(item){return safeHttpUrl(item.url);}).slice(0,12);
  results.innerHTML=validRows.map(function(item,index){
   var href=safeHttpUrl(item.url),host="";
   try{host=new URL(href).hostname.replace(/^www\./,"");}catch(e){}
   return '<article class="kuro-web-result"><a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer nofollow"><div class="kuro-result-url">'+esc(host)+'</div><h2>'+esc(item.title||host)+'</h2></a><p>'+esc(item.snippet||"")+'</p>'+(item.date?'<time>'+esc(item.date)+'</time>':"")+'<button type="button" class="kuro-branch-btn" data-graph-focus="g'+(index+1)+'">マップで見る ↗</button></article>';
  }).join("")||'<div class="kuro-engine-empty">表示できる検索結果がありませんでした。</div>';
  createSearchExplorer(validRows);
 }
 function createSearchExplorer(rows){
  var old=$("#kuro-search-explorer");if(old)old.remove();
  var graph=document.createElement("section");graph.id="kuro-search-explorer";graph.className="kuro-search-explorer";
  graph.innerHTML='<div class="kuro-explorer-header"><div><span class="kuro-explorer-eyebrow">KUROLAB DISCOVERY NETWORK</span><h2>関連探索マップ</h2><p>サイトやテーマをノードでつなぎ、気になる方向へ探索できます。</p></div><div class="kuro-explorer-tools"><button type="button" data-explorer-zoom="out" aria-label="縮小">−</button><button type="button" data-explorer-zoom="in" aria-label="拡大">＋</button><button type="button" data-explorer-zoom="fit">全体表示</button><button type="button" data-explorer-reset>リセット</button></div></div><div class="kuro-explorer-legend"><span><i class="kuro-legend-dot root"></i>検索テーマ</span><span><i class="kuro-legend-dot site"></i>ウェブサイト</span><span><i class="kuro-legend-line"></i>関連するサイト</span></div><div class="kuro-explorer-viewport" aria-label="関連探索マップ。ドラッグで移動、ボタンで拡大縮小できます。"><div class="kuro-explorer-spacer"><div class="kuro-explorer-stage"><svg class="kuro-explorer-svg" aria-hidden="true"></svg><div class="kuro-explorer-nodes"></div></div></div></div><div class="kuro-explorer-foot"><span class="kuro-explorer-count"></span><span>ノードを開くとサイトへ移動 ／「関連を広げる」で枝を追加</span></div>';
  results.appendChild(graph);
  var viewport=graph.querySelector(".kuro-explorer-viewport"),spacer=graph.querySelector(".kuro-explorer-spacer"),stage=graph.querySelector(".kuro-explorer-stage"),svg=graph.querySelector(".kuro-explorer-svg"),nodeLayer=graph.querySelector(".kuro-explorer-nodes"),countLabel=graph.querySelector(".kuro-explorer-count");
  var nodes=[{id:"root",depth:0,parent:null,title:query,url:"",snippet:"検索したテーマ"}],edges=[],serial=0,scale=1,canvasWidth=900,canvasHeight=560;
  rows.forEach(function(item,index){var url=safeHttpUrl(item.url);if(!url)return;var id="g"+(index+1);nodes.push({id:id,parent:"root",depth:1,title:String(item.title||url).slice(0,110),url:url,snippet:String(item.snippet||"").slice(0,220)});edges.push({from:"root",to:id,type:"branch"});});
  function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase();}catch(e){return "";}}
  function nodeById(id){return nodes.find(function(n){return n.id===id;});}
  function edgeExists(from,to){return edges.some(function(e){return e.from===from&&e.to===to||e.from===to&&e.to===from;});}
  function layout(){
   var levels={};nodes.forEach(function(n){(levels[n.depth]||(levels[n.depth]=[])).push(n);});
   var maxDepth=Math.max.apply(null,nodes.map(function(n){return n.depth;}));
   var maxCount=1;Object.keys(levels).forEach(function(k){maxCount=Math.max(maxCount,levels[k].length);});
   canvasHeight=Math.max(560,maxCount*142+110);canvasWidth=100+(maxDepth+1)*330+220;
   Object.keys(levels).forEach(function(key){var depth=Number(key),list=levels[key];list.forEach(function(n,index){n.x=48+depth*330;n.y=depth===0?canvasHeight/2:((index+1)*canvasHeight/(list.length+1));});});
  }
  function addPath(from,to,type){
   if(!from||!to)return;
   var path=document.createElementNS("http://www.w3.org/2000/svg","path"),x1=from.x+238,y1=from.y,x2=to.x,y2=to.y;
   if(type==="related"){x1=from.x+238;y1=from.y+28;x2=to.x;y2=to.y+28;}
   var bend=Math.max(50,Math.abs(x2-x1)*0.48);
   path.setAttribute("d","M "+x1+" "+y1+" C "+(x1+bend)+" "+y1+", "+(x2-bend)+" "+y2+", "+x2+" "+y2);
   path.setAttribute("class","kuro-explorer-edge "+(type==="related"?"is-related":""));
   svg.appendChild(path);
  }
  function draw(){
   layout();stage.style.width=canvasWidth+"px";stage.style.height=canvasHeight+"px";stage.style.transform="scale("+scale+")";spacer.style.width=(canvasWidth*scale)+"px";spacer.style.height=(canvasHeight*scale)+"px";
   nodeLayer.innerHTML="";svg.innerHTML="";svg.setAttribute("width",canvasWidth);svg.setAttribute("height",canvasHeight);svg.setAttribute("viewBox","0 0 "+canvasWidth+" "+canvasHeight);
   edges.forEach(function(edge){addPath(nodeById(edge.from),nodeById(edge.to),edge.type);});
   var byHost={};nodes.filter(function(n){return n.url;}).forEach(function(n){var host=hostOf(n.url);if(host)(byHost[host]||(byHost[host]=[])).push(n);});
   Object.keys(byHost).forEach(function(host){var group=byHost[host];if(group.length>1){for(var i=0;i<group.length;i++){for(var j=i+1;j<group.length;j++){if(group[i].parent===group[j].id||group[j].parent===group[i].id)continue;addPath(group[i],group[j],"related");}}}});
   nodes.forEach(function(n){
    var el=document.createElement("article");el.className="kuro-explorer-node "+(n.id==="root"?"is-root":"");el.dataset.explorerNode=n.id;el.style.left=n.x+"px";el.style.top=(n.y-54)+"px";
    var domain=hostOf(n.url),link=n.url?'<a class="kuro-explorer-node-link" href="'+esc(n.url)+'" target="_blank" rel="noopener noreferrer nofollow"><strong>'+esc(n.title)+'</strong><span>'+esc(domain)+'</span></a>':'<div class="kuro-explorer-root-label"><span>SEARCH TOPIC</span><strong>'+esc(n.title)+'</strong></div>';
    var action=n.depth<4?'<button type="button" data-explorer-expand="'+esc(n.id)+'" '+(n.busy?"disabled":"")+'>'+(n.busy?"検索中…":n.depth===0?"＋ 別の関連を探す":"＋ 関連を広げる")+'</button>':'<small class="kuro-explorer-limit">探索の深さの上限です</small>';
    el.innerHTML=link+'<p>'+esc(n.error||n.snippet|| (n.id==="root"?"ここから探索を広げよう":"関連ページを検索できます"))+'</p>'+action;
    nodeLayer.appendChild(el);
   });
   countLabel.textContent=nodes.length+" ノード · "+edges.length+" 接続";
  }
  async function expandNode(id){
   var parent=nodeById(id);if(!parent||parent.busy||parent.depth>=4||nodes.length>=45)return;
   parent.busy=true;parent.error="";draw();
   try{
    var response=await fetch("/api/web-search",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:String(parent.title||query).slice(0,180),mode:"web"})});
    var payload=await response.json().catch(function(){return {};});
    if(!response.ok)throw new Error(payload.message||"関連情報を取得できませんでした。");
    var found=Array.isArray(payload.results)?payload.results:[];
    var added=0;
    found.slice(0,6).forEach(function(item){
     var url=safeHttpUrl(item.url);if(!url)return;
     var existing=nodes.find(function(n){return n.url===url;});
     if(existing){if(!edgeExists(parent.id,existing.id))edges.push({from:parent.id,to:existing.id,type:"branch"});return;}
     if(nodes.length>=45||added>=6)return;
     var node={id:"g"+(++serial+rows.length),parent:parent.id,depth:parent.depth+1,title:String(item.title||url).slice(0,110),url:url,snippet:String(item.snippet||"").slice(0,220)};
     nodes.push(node);edges.push({from:parent.id,to:node.id,type:"branch"});added++;
    });
    if(!added&&found.length===0)parent.error="関連する検索結果が見つかりませんでした。";
   }catch(error){parent.error=error.message||"検索に失敗しました。";}
   finally{parent.busy=false;draw();}
  }
  graph.addEventListener("click",function(event){
   var expand=event.target.closest("[data-explorer-expand]");
   if(expand){expandNode(expand.dataset.explorerExpand);return;}
   var zoom=event.target.closest("[data-explorer-zoom]");
   if(zoom){var action=zoom.dataset.explorerZoom;if(action==="in")scale=Math.min(1.65,scale+0.15);if(action==="out")scale=Math.max(0.55,scale-0.15);if(action==="fit")scale=Math.min(1,(viewport.clientWidth-24)/canvasWidth);draw();return;}
   if(event.target.closest("[data-explorer-reset]")){scale=Math.min(1,(viewport.clientWidth-24)/canvasWidth);draw();viewport.scrollTo({left:0,top:0,behavior:"smooth"});}
  });
  graph.addEventListener("click",function(event){
   var focus=event.target.closest("[data-graph-focus]");if(!focus)return;
   var node=nodeById(focus.dataset.graphFocus);if(!node)return;
   viewport.scrollTo({left:Math.max(0,node.x*scale-35),top:Math.max(0,(node.y-viewport.clientHeight/2)*scale),behavior:"smooth"});
   var el=nodeLayer.querySelector('[data-explorer-node="'+node.id+'"]');if(el){el.classList.add("is-highlighted");window.setTimeout(function(){el.classList.remove("is-highlighted");},1300);}
  });
  var dragging=false,lastX=0,lastY=0;
  viewport.addEventListener("pointerdown",function(event){if(event.target.closest("a,button"))return;dragging=true;lastX=event.clientX;lastY=event.clientY;viewport.classList.add("is-dragging");try{viewport.setPointerCapture(event.pointerId);}catch(e){}});
  viewport.addEventListener("pointermove",function(event){if(!dragging)return;var dx=event.clientX-lastX,dy=event.clientY-lastY;lastX=event.clientX;lastY=event.clientY;viewport.scrollLeft-=dx;viewport.scrollTop-=dy;});
  function stopDrag(){dragging=false;viewport.classList.remove("is-dragging");}
  viewport.addEventListener("pointerup",stopDrag);viewport.addEventListener("pointercancel",stopDrag);viewport.addEventListener("lostpointercapture",stopDrag);
  viewport.addEventListener("wheel",function(event){if(!event.ctrlKey)return;event.preventDefault();scale=Math.max(0.55,Math.min(1.65,scale+(event.deltaY<0?0.08:-0.08)));draw();},{passive:false});
  if(!document.getElementById("kuro-explorer-style")){
   var style=document.createElement("style");style.id="kuro-explorer-style";
   style.textContent=".kuro-web-result{position:relative;padding:15px 18px;border:1px solid var(--line,rgba(100,110,130,.2));border-radius:14px;background:var(--surface,white);min-width:0}.kuro-web-result a{color:var(--text,#1e293b);text-decoration:none}.kuro-web-result h2{font-size:17px;line-height:1.45;margin:5px 0 7px}.kuro-web-result p{font-size:13px;line-height:1.7;color:var(--muted,#667085);margin:0}.kuro-result-url{font-size:11px;color:#16805d;overflow-wrap:anywhere}.kuro-web-result time{font-size:11px;color:var(--muted,#667085);margin-left:8px}.kuro-branch-btn{margin-top:11px;border:1px solid var(--line,rgba(100,110,130,.25));background:var(--surface-2,rgba(80,100,140,.09));color:inherit;padding:7px 10px;border-radius:9px;cursor:pointer;font-weight:700}.kuro-search-explorer{margin-top:24px;border:1px solid rgba(96,127,190,.22);border-radius:20px;overflow:hidden;background:linear-gradient(145deg,#fff 0%,#f6f9ff 58%,#fffdf5 100%);box-shadow:0 12px 34px rgba(57,83,132,.08);color:#192943}.kuro-explorer-header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 20px;border-bottom:1px solid rgba(100,125,170,.16);flex-wrap:wrap}.kuro-explorer-eyebrow{font-size:9px;letter-spacing:.16em;font-weight:850;color:#6681b8}.kuro-explorer-header h2{margin:4px 0;font-size:19px;color:#1c3155}.kuro-explorer-header p{margin:0;color:#72809a;font-size:12px}.kuro-explorer-tools{display:flex;gap:6px;flex-wrap:wrap}.kuro-explorer-tools button{border:1px solid #dbe4f2;border-radius:9px;background:#fff;color:#38527e;padding:8px 11px;font-size:12px;font-weight:750;cursor:pointer}.kuro-explorer-tools button:hover{background:#edf4ff;border-color:#a9c1ea}.kuro-explorer-legend{display:flex;gap:18px;align-items:center;padding:10px 20px;font-size:10px;color:#72809a}.kuro-explorer-legend span{display:flex;align-items:center;gap:6px}.kuro-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.kuro-legend-dot.root{background:#5c88e6;box-shadow:0 0 0 4px #e5edff}.kuro-legend-dot.site{background:#e3b341}.kuro-legend-line{width:22px;border-top:2px dashed #e2b34a;display:inline-block}.kuro-explorer-viewport{height:570px;overflow:auto;position:relative;cursor:grab;background-image:radial-gradient(#d9e2f2 1px,transparent 1px),radial-gradient(ellipse at 15% 35%,rgba(103,153,239,.09),transparent 42%),radial-gradient(ellipse at 85% 70%,rgba(244,197,91,.10),transparent 38%);background-size:22px 22px,auto,auto;touch-action:none;scrollbar-color:#c5d3e8 transparent}.kuro-explorer-viewport.is-dragging{cursor:grabbing;user-select:none}.kuro-explorer-spacer{position:relative;min-width:100%;min-height:100%}.kuro-explorer-stage{position:absolute;left:0;top:0;transform-origin:top left}.kuro-explorer-svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}.kuro-explorer-edge{fill:none;stroke:#8aa9e4;stroke-width:2.6;stroke-linecap:round;opacity:.8}.kuro-explorer-edge.is-related{stroke:#e0b24c;stroke-width:2;stroke-dasharray:6 7;opacity:.9}.kuro-explorer-nodes{position:absolute;inset:0}.kuro-explorer-node{position:absolute;width:238px;min-height:108px;box-sizing:border-box;padding:12px 13px;border:1px solid #dbe5f3;border-radius:15px;background:rgba(255,255,255,.96);box-shadow:0 7px 22px rgba(48,75,121,.10);display:flex;flex-direction:column;gap:6px;z-index:1;transition:box-shadow .18s,border-color .18s,transform .18s}.kuro-explorer-node:before{content:'';position:absolute;width:7px;height:7px;border-radius:50%;left:-4px;top:18px;background:#7fa3e9;box-shadow:0 0 0 4px #edf3ff}.kuro-explorer-node.is-root{border-color:#8caae9;background:linear-gradient(135deg,#fff,#edf4ff);box-shadow:0 9px 26px rgba(70,112,190,.16)}.kuro-explorer-node.is-root:before{background:#477fe0;box-shadow:0 0 0 5px #e2ecff}.kuro-explorer-node.is-highlighted{border-color:#e1b448;box-shadow:0 0 0 5px rgba(232,190,85,.22),0 10px 30px rgba(48,75,121,.14);transform:translateY(-2px)}.kuro-explorer-node-link{color:#1d355c;text-decoration:none;display:block;min-width:0}.kuro-explorer-node-link strong,.kuro-explorer-root-label strong{font-size:12px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.kuro-explorer-node-link span,.kuro-explorer-root-label span{display:block;margin-top:4px;color:#6984b2;font-size:10px;overflow-wrap:anywhere}.kuro-explorer-root-label span{font-size:9px;letter-spacing:.12em;font-weight:850}.kuro-explorer-node p{margin:0;color:#7c879b;font-size:10px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.kuro-explorer-node button{align-self:flex-start;border:0;border-radius:8px;padding:6px 9px;background:linear-gradient(110deg,#e9f1ff,#fff5d9);color:#345582;font-size:10px;font-weight:800;cursor:pointer}.kuro-explorer-node button:disabled{opacity:.55;cursor:wait}.kuro-explorer-limit{font-size:10px;color:#9a8a65}.kuro-explorer-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 18px;border-top:1px solid rgba(100,125,170,.16);font-size:10px;color:#8190a8}.kuro-explorer-count{font-weight:800;color:#617ba9}@media(max-width:640px){.kuro-explorer-header{padding:14px}.kuro-explorer-tools{width:100%}.kuro-explorer-tools button{flex:1}.kuro-explorer-viewport{height:490px}.kuro-explorer-legend{padding:9px 14px;gap:12px}.kuro-explorer-foot{padding:10px 13px}}";
   document.head.appendChild(style);
  }
  draw();scale=Math.min(1,(viewport.clientWidth-24)/canvasWidth);draw();
 } function renderImageResults(data){
  var rows=Array.isArray(data.images)?data.images:[];
  if(!rows.length){showEmpty("画像が見つかりませんでした。別のキーワードで試してください。");return;}
  results.innerHTML='<div class="kuro-image-results">'+rows.map(function(item){
   var href=safeHttpUrl(item.url);if(!href)return "";
   return '<a class="kuro-image-result" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer nofollow"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(href)+'" alt="'+esc(item.description||"検索画像")+'"><p>'+esc(item.description||"画像を開く")+'</p></a>';
  }).filter(Boolean).join("")+'</div>';
  if(!results.querySelector(".kuro-image-result"))showEmpty("表示できる画像がありませんでした。");
 }
 function renderLocal(){
  var rows=rankKuroSearch(query);
  status.textContent="KURO Labのサービス・ゲーム・ガイドを検索しています。";
  if(!rows.length){showEmpty("KURO Lab内に一致する項目がありませんでした。");return;}
  results.className="kuro-engine-results portal-grid";
  results.innerHTML=rows.map(card).join("");
  bindFav();
 }
 async function runSearch(){
  results.className="kuro-engine-results";
  if(!query){status.textContent="検索ワードを入力してください。";showEmpty("キーワードを入力して検索を開始できます。");return;}
  if(mode==="local"){renderLocal();return;}
  status.textContent="検索しています…";
  showEmpty("検索結果を取得しています。");
  try{
   var response=await fetch("/api/web-search",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:query,mode:mode})});
   var payload=await response.json().catch(function(){return {};});
   if(!response.ok){
    if(response.status===503||payload.code==="SEARCH_PROVIDER_NOT_CONFIGURED"){status.textContent="外部検索の接続準備が必要です。";showEmpty("検索エンジンのバックエンドに検索APIキーがまだ設定されていません。KURO Labの画面にはキーを公開せず、Cloudflareの秘密設定に登録する必要があります。");return;}
    if(response.status===404){status.textContent="検索サーバーの更新が必要です。";showEmpty("Cloudflare Workerの検索APIがまだ公開されていません。Workerの更新後に利用できるようになります。");return;}
    if(response.status===429){status.textContent="検索が混み合っています。";showEmpty("少し時間をおいてから、もう一度検索してください。");return;}
    throw new Error(payload.message||"検索に失敗しました。");
   }
   status.textContent=(payload.results&&payload.results.length?payload.results.length+" 件":"")+" の結果";
   if(mode==="images")renderImageResults(payload);else renderWebResults(payload);
  }catch(error){
   console.warn("KURO web search failed",error);
   status.textContent="検索に失敗しました。";
   showEmpty("通信に失敗しました。インターネット接続を確認して、もう一度検索してください。");
  }
 }
 results.addEventListener("click",function(event){var focus=event.target.closest("[data-graph-focus]");if(!focus)return;var graph=$("#kuro-search-explorer");if(graph){var node=graph.querySelector('[data-explorer-node="'+focus.dataset.graphFocus+'"]');if(node){node.classList.add("is-highlighted");window.setTimeout(function(){node.classList.remove("is-highlighted");},1300);}}});
 form.onsubmit=function(event){event.preventDefault();query=String(input.value||"").trim().slice(0,180);input.value=query;updateAddress(true);runSearch();};
 document.querySelectorAll("[data-kuro-search-mode]").forEach(function(button){
  button.onclick=function(){var next=button.dataset.kuroSearchMode;if(!next||next===mode)return;mode=next;updateTabs();updateAddress(false);runSearch();};
 });
 updateTabs();
 if(query)runSearch();else{status.textContent="ウェブ・画像・ニュース、またはKURO Lab内を検索できます。";showEmpty("キーワードを入力して検索を開始できます。");}
}
function bind(){bindFav();bindPortalNotificationActions();bindProTools();var sf=$("#portal-search-form");if(sf){var i=$("#portal-search-input"),run=function(){var a=rankKuroSearch(i.value);$("#portal-search-results").innerHTML=a.length?a.map(card).join(""):'<div class="portal-empty" style="grid-column:1/-1">該当する項目がありません。別の言葉でも検索してみてください。</div>';bindFav();};sf.onsubmit=function(e){e.preventDefault();run();};i.oninput=run;var initialQuery=new URLSearchParams(location.search).get("q");if(initialQuery){i.value=initialQuery;run();}}var hf=$("#kuro-home-search");if(hf){var hi=$("#kuro-home-search-input"),hb=$("#kuro-home-search-results"),renderHomeSearch=function(q){var a=rankKuroSearch(q);if(!String(q||"").trim()){hb.innerHTML="";return;}hb.innerHTML=a.length?a.slice(0,8).map(function(x){return '<a class="kuro-search-result" href="'+esc(x.href)+'"><span class="icon">'+x.icon+'</span><span class="text"><b>'+esc(x.title)+'</b><small>'+esc(x.desc)+'</small></span><span class="arrow">↗</span></a>';}).join(""):'<div class="portal-empty">見つかりませんでした。キーワードを変えて検索してください。</div>';};var homeMode="web";document.querySelectorAll("[data-kuro-home-mode]").forEach(function(button){button.onclick=function(){homeMode=button.dataset.kuroHomeMode||"web";document.querySelectorAll("[data-kuro-home-mode]").forEach(function(b){b.setAttribute("aria-pressed",String(b===button));});renderHomeSearch(hi.value);};});hi.oninput=function(){if(homeMode==="local")renderHomeSearch(hi.value);else hb.innerHTML="";};hf.onsubmit=function(e){e.preventDefault();var term=String(hi.value||"").trim();if(term)location.href="/search/?type="+encodeURIComponent(homeMode)+"&q="+encodeURIComponent(term);};}bindKuroEnginePage();var cl=$("#portal-clear-history");if(cl)cl.onclick=async function(){if(!confirm("閲覧履歴を消去しますか？"))return;st.data.history=[];save();if(st.user)await db.from("portal_history").delete().eq("user_id",st.user.id);render();};
var sy=$("#portal-sync-now");if(sy)sy.onclick=sync;var op=$("#portal-open-login");if(op)op.onclick=openLogin;var copyKuro=$("#portal-copy-kuro-id");if(copyKuro)copyKuro.onclick=async function(){if(!st.kuroId)return;try{await navigator.clipboard.writeText(st.kuroId);toast("KURO IDをコピーしました");}catch(error){toast("コピーできませんでした。ブラウザの権限を確認してください。");}};var so=$("#portal-signout");if(so)so.onclick=function(){db.auth.signOut();};
var th=$("#portal-theme");if(th)th.onchange=function(e){st.data.preferences.theme=e.target.value;save();if(st.user)sync();};var usernameCurrent=$("#portal-username-current"),usernameForm=$("#portal-username-form"),usernameInput=$("#portal-new-username"),usernameStatus=$("#portal-username-status"),usernameLogin=$("#portal-open-login");if(usernameInput){var applyUsernameContrast=function(){var dark=document.body.dataset.theme==="dark"||document.body.dataset.proTheme==="on"&&document.body.style.colorScheme==="dark";usernameInput.style.setProperty("background-color",dark?"#1b2939":"#ffffff","important");usernameInput.style.setProperty("color",dark?"#edf4fb":"#17283c","important");usernameInput.style.setProperty("-webkit-text-fill-color",dark?"#edf4fb":"#17283c","important");usernameInput.style.setProperty("caret-color",dark?"#54b8ed":"#087fbd","important");usernameInput.style.setProperty("border-color",dark?"#39495c":"#dbe3ed","important");};applyUsernameContrast();usernameInput.addEventListener("focus",applyUsernameContrast);usernameInput.addEventListener("input",applyUsernameContrast);}if(usernameCurrent){if(st.user){usernameCurrent.innerHTML='<strong>ユーザーネーム：</strong>@'+esc(st.kuroProfile&&st.kuroProfile.username||st.user.user_metadata&&st.user.user_metadata.username||"取得中")+'<br><strong>KURO ID：</strong>'+esc(st.kuroId||"取得中")+'<br><small>KURO Lab・KURO SNS・KURO GAMES共通アカウント</small>';if(usernameForm){usernameForm.hidden=false;if(usernameInput&&usernameInput.dataset.initializedFor!==st.user.id){usernameInput.value=st.kuroProfile&&st.kuroProfile.username||st.user.user_metadata&&st.user.user_metadata.username||"";usernameInput.dataset.initializedFor=st.user.id;}}if(usernameLogin)usernameLogin.hidden=true;}else{usernameCurrent.textContent="ログインするとユーザーネームを変更できます。KURO IDは固定です。";if(usernameForm)usernameForm.hidden=true;if(usernameLogin)usernameLogin.hidden=false;}}if(usernameForm)usernameForm.onsubmit=async function(ev){ev.preventDefault();if(!st.user){openLogin();return;}var name=String(usernameInput&&usernameInput.value||"").trim(),btn=$("#portal-username-submit");if(!/^[A-Za-z0-9_]{3,24}$/.test(name)){usernameStatus.textContent="ユーザーネームは半角英数字と_の3〜24文字で入力してください。";return;}if(name.toLowerCase()===String(st.kuroProfile&&st.kuroProfile.username||"").toLowerCase()){usernameStatus.textContent="現在と同じユーザーネームです。";return;}if(btn)btn.disabled=true;usernameStatus.textContent="変更を保存しています…";try{var refreshResult=await db.auth.refreshSession(),session=refreshResult&&refreshResult.data&&refreshResult.data.session,token=session&&session.access_token;if(!token){var refreshError=refreshResult&&refreshResult.error;throw new Error(refreshError&&refreshError.message?("ログインセッションを更新できません："+refreshError.message):"ログインセッションを更新できません。再ログインしてください。");}var requestUsernameChange=function(accessToken){return cloudflareFetch(SUPABASE_URL+"/functions/v1/username-auth",{method:"POST",headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY,"Authorization":"Bearer "+accessToken},body:JSON.stringify({action:"change_username",username:name})});};var res=await requestUsernameChange(token);if(res.status===401){var retryRefresh=await db.auth.refreshSession(),retrySession=retryRefresh&&retryRefresh.data&&retryRefresh.data.session,retryToken=retrySession&&retrySession.access_token;if(retryToken)res=await requestUsernameChange(retryToken);}var data={};try{data=await res.json();}catch(parseErr){}if(!res.ok||!data.success)throw new Error(data.error||"変更できませんでした。");usernameStatus.textContent="変更しました。3サービス共通で反映されます。";if(st.user.user_metadata)st.user.user_metadata.username=data.username;await loadKuroId(st.user);render();toast("ユーザーネームを変更しました。");}catch(err){usernameStatus.textContent=err.message||"変更に失敗しました。";console.error("KURO username change failed",err);}finally{var currentButton=$("#portal-username-submit");if(currentButton)currentButton.disabled=false;}};
var rs=$("#portal-reset-local");if(rs)rs.onclick=function(){if(!confirm("この端末のデータを消去しますか？アカウント側のデータは消えません。"))return;st.data=defaults();save();render();};
var rf=$("#portal-request-form");if(rf)rf.onsubmit=sendRequest;loadMyRequests();bindDashboard();bindDisplaySettings();/* Plan applications and invitations were retired with the plan tiers. */}
async function sync(showToast){if(!st.user)return;if(st.sync){st.syncAgain=true;return;}st.sync=true;try{var id=st.user.id,r=await Promise.all([db.from("portal_preferences").select("*").eq("user_id",id).maybeSingle(),db.from("portal_favorites").select("*").eq("user_id",id),db.from("portal_history").select("*").eq("user_id",id).order("visited_at",{ascending:false}).limit(100)]);r.forEach(function(x){if(x.error)throw x.error;});var p=r[0].data,guestNew=(st.data.updatedAt||0)>(p&&p.updated_at?new Date(p.updated_at).getTime():0),prefs=guestNew?Object.assign({},p&&p.preferences||{},st.data.preferences):Object.assign({},st.data.preferences,p&&p.preferences||{}),fm=new Map(),hm=new Map();(r[1].data||[]).concat(st.data.favorites).forEach(function(x){fm.set(x.item_key,x);});(r[2].data||[]).concat(st.data.history).forEach(function(x){var old=hm.get(x.item_key);if(!old||new Date(x.visited_at||0)>new Date(old.visited_at||0))hm.set(x.item_key,x);});var f=Array.from(fm.values()),h=Array.from(hm.values()).sort(function(a,b){return new Date(b.visited_at)-new Date(a.visited_at);}).slice(0,100),writes=[];if(guestNew||!p)writes.push(db.from("portal_preferences").upsert({user_id:id,preferences:prefs,updated_at:new Date().toISOString()},{onConflict:"user_id"}));if(f.length)writes.push(db.from("portal_favorites").upsert(f.map(function(x){return {user_id:id,item_key:x.item_key,item_type:x.item_type,title:x.title,href:x.href,created_at:x.created_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"}));if(h.length)writes.push(db.from("portal_history").upsert(h.map(function(x){return {user_id:id,item_key:x.item_key,title:x.title,href:x.href,visited_at:x.visited_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"}));var wr=await Promise.all(writes);wr.forEach(function(x){if(x.error)throw x.error;});st.data.favorites=f;st.data.history=h;st.data.preferences=prefs;save();if(showToast)toast("アカウントのデータを同期しました");}catch(e){console.warn(e);if(showToast)toast("同期できませんでした。端末データは保持しています");}finally{st.sync=false;render();if(st.syncAgain){st.syncAgain=false;sync(false);}}}async function loadMyRequests(){var box=$("#portal-my-requests");if(!box)return;var auth=await db.auth.getUser(),user=auth.data&&auth.data.user;if(!user){box.innerHTML='<div class="portal-empty">返信の確認にはログインが必要です。ログイン中に送信したリクエストのみ、ここに表示されます。</div>';return;}var result=await db.from("portal_requests").select("id,message,status,admin_reply,replied_at,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);if(result.error){box.textContent="リクエストを読み込めませんでした。";return;}var items=result.data||[];if(!items.length){box.innerHTML='<div class="portal-empty">まだリクエストはありません。</div>';return;}var names={pending:"未対応",reviewing:"確認中",done:"対応済み"};box.innerHTML=items.map(function(r){return '<article class="portal-card portal-request-item" style="margin:12px 0"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><span>'+esc(names[r.status]||r.status)+'</span><small>'+new Date(r.created_at).toLocaleString("ja-JP")+'</small></div><p style="white-space:pre-wrap">'+esc(r.message)+'</p>'+(r.admin_reply?'<div style="margin-top:14px;padding:14px;border-radius:12px;background:var(--portal-surface-2,rgba(120,130,150,.12));border-left:3px solid var(--portal-accent)"><strong>KURO Lab 運営からの返信</strong><p style="white-space:pre-wrap">'+esc(r.admin_reply)+'</p><small>'+(r.replied_at?new Date(r.replied_at).toLocaleString("ja-JP"):"")+'</small></div>':'<div class="portal-muted">運営からの返信はまだありません。</div>')+'</article>';}).join("");}
async function sendRequest(e){e.preventDefault();var msg=$("#portal-request-message").value.trim(),s=$("#portal-request-status");if(msg.length<5||msg.length>500){s.textContent="5〜500文字で入力してください。";return;}if($("#portal-request-website").value){s.textContent="送信できませんでした。";return;}var last=Number(safeStorageGet("localStorage","kuro_portal_request_at")||0);if(Date.now()-last<60000){s.textContent="送信は1分ほど空けてからお試しください。";return;}var a=await db.auth.getUser(),user=a.data&&a.data.user;if(!user){s.textContent="返信通知を受け取るにはログインが必要です。ログイン後に送信してください。";openLogin();return;}var data={message:msg,user_id:user.id};var r=await db.from("portal_requests").insert(data);if(r.error){s.textContent="送信できませんでした。時間をおいて再度お試しください。";return;}safeStorageSet("localStorage","kuro_portal_request_at",Date.now());$("#portal-request-message").value="";s.textContent="送信しました。ありがとうございます。";loadMyRequests();}
async function loadKuroId(user){
 var userId=user&&user.id?String(user.id):null;
 if(!userId){st.kuroId=null;st.kuroProfile=null;st.kuroIdLoading=false;st.kuroIdUserId=null;return null;}
 st.kuroIdUserId=userId;st.kuroIdLoading=true;
 try{
  var result=await db.from("profiles").select("kuro_id,username").eq("id",userId).maybeSingle();
  if(result.error)throw result.error;
  if(!st.user||st.user.id!==userId)return null;
  st.kuroProfile=result.data||null;
  st.kuroId=result.data&&result.data.kuro_id?String(result.data.kuro_id):null;
  st.kuroIdLoading=false;
  if(page==="mypage"||page==="settings")render();
  return st.kuroId;
 }catch(error){
  if(st.user&&st.user.id===userId){st.kuroIdLoading=false;console.warn("KURO ID could not be loaded",error);}
  return null;
 }
}
async function usernamePasswordAuth(action,username,password){
 var response=await cloudflareFetch(SUPABASE_URL+"/functions/v1/username-auth",{
  method:"POST",headers:{"Content-Type":"application/json","apikey":PUBLISHABLE_KEY},
  body:JSON.stringify({action:action,username:username,password:password})
 });
 var payload={};try{payload=await response.json();}catch(e){}
 if(!response.ok||!payload.session)throw new Error(payload.error||"ユーザーネーム認証に失敗しました。");
 var applied=await db.auth.setSession({access_token:payload.session.access_token,refresh_token:payload.session.refresh_token});
 if(applied.error)throw applied.error;
 return applied;
}
function openLogin(){var modal=$("#portal-login-modal");if(!modal)return;modal.hidden=false;var email=$("#portal-login-email");if(email)email.focus();}
function setRecoveryMode(active){
 ["portal-login-form","portal-auth-help","portal-register-switch","portal-recovery-form"].forEach(function(id){var el=$("#"+id);if(el)el.hidden=id==="portal-recovery-form"?!active:active;});
 document.querySelectorAll(".portal-oauth,.portal-oauth-note").forEach(function(el){el.hidden=active;});
 var title=$("#portal-login-title"),loginError=$("#portal-login-error"),recoveryError=$("#portal-recovery-error");
 if(active){if(title)title.textContent="新しいパスワードを設定";if(loginError)loginError.textContent="";if(recoveryError)recoveryError.textContent="メールのリンクを確認しました。新しいパスワードを入力してください。";}
}
function updateAccountUI(){var account=$("#portal-account-button");if(account){account.textContent=st.user?"マイページ":"ログイン";account.setAttribute("aria-label",st.user?"ログイン中。マイページを開く":"ログイン・新規登録");}}
function initLogin(){
 if(new URLSearchParams(location.search).get("auth")==="1")openLogin();
 var account=$("#portal-account-button");if(account)account.onclick=function(){if(st.user)location.href="/mypage/";else openLogin();};updateAccountUI();
 var transport=$("#portal-transport-button");if(transport){transport.textContent="Cloudflare経由";transport.onclick=function(){toast("通信はCloudflare Worker経由に固定されています。");};}
 var close=$("#portal-login-close");if(close)close.onclick=function(){var m=$("#portal-login-modal");if(m)m.hidden=true;};
 function showLoginError(message){var el=$("#portal-login-error");if(el)el.textContent=message;}
 var forgot=$("#portal-forgot-password");if(forgot)forgot.onclick=async function(){var e=$("#portal-login-email"),email=e?e.value.trim():"";if(!email||email.indexOf("@")<0){showLoginError("パスワード再設定には登録済みメールアドレスが必要です。メールアドレスのないアカウントはパスワードを忘れると復旧できません。");if(e)e.focus();return;}var b=this;b.disabled=true;showLoginError("");try{var r=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/mypage/"});if(r.error)throw r.error;showLoginError("パスワード再設定メールを送信しました。メール内のリンクを開いてください。");}catch(err){showLoginError("再設定メールを送信できませんでした："+(err.message||"時間をおいて再度お試しください。"));}b.disabled=false;};
 var emailLink=$("#portal-email-link");if(emailLink)emailLink.onclick=async function(){var e=$("#portal-login-email"),email=e?e.value.trim():"";if(!email||email.indexOf("@")<0){showLoginError("メールリンクログインにはメールアドレスが必要です。");if(e)e.focus();return;}var b=this;b.disabled=true;showLoginError("");try{var r=await db.auth.signInWithOtp({email:email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+"/mypage/"}});if(r.error)throw r.error;showLoginError("ログイン用リンクを送信しました。メールを確認してください。");}catch(err){showLoginError("メールリンクを送信できませんでした："+(err.message||"時間をおいて再度お試しください。"));}b.disabled=false;};
 var recovery=$("#portal-recovery-form");if(recovery)recovery.onsubmit=async function(e){e.preventDefault();var b=$("#portal-recovery-submit"),p=$("#portal-new-password"),er=$("#portal-recovery-error");if(!b||!p)return;b.disabled=true;if(er)er.textContent="";try{var r=await db.auth.updateUser({password:p.value});if(r.error)throw r.error;var m=$("#portal-login-modal");if(m)m.hidden=true;setRecoveryMode(false);toast("パスワードを更新しました。");}catch(err){if(er)er.textContent=err.message||"パスワードを更新できませんでした。";}b.disabled=false;};
 var open=$("#portal-open-login");if(open)open.addEventListener("click",openLogin);
 async function oauth(provider){var id=provider==="google"?"portal-google-login":"portal-apple-login",b=$("#"+id),er=$("#portal-login-error");if(!b)return;b.disabled=true;if(er)er.textContent="";try{var r=await db.auth.signInWithOAuth({provider:provider,options:{redirectTo:location.origin+"/"}});if(r.error)throw r.error;}catch(err){var msg=String(err&&err.message||"");if(er)er.textContent=provider==="apple"&&/provider is not enabled|unsupported provider|apple/i.test(msg)?"AppleログインはSupabase側で未設定です。Googleまたはメールでログインしてください。":(msg||"ログインを開始できませんでした。");b.disabled=false;}}
 var google=$("#portal-google-login");if(google)google.onclick=function(){oauth("google");};var apple=$("#portal-apple-login");if(apple)apple.onclick=function(){oauth("apple");};
 var modal=$("#portal-login-modal");if(modal)modal.onclick=function(e){if(e.target.id==="portal-login-modal")e.currentTarget.hidden=true;};
 var sw=$("#portal-register-switch");if(sw)sw.onclick=function(){var form=$("#portal-login-form");if(!form)return;var reg=form.dataset.mode!=="register",help=$("#portal-auth-help"),g=$("#portal-google-login"),a=$("#portal-apple-login"),note=document.querySelector("#portal-login-modal .portal-oauth-note"),warning=$("#portal-username-warning");if(warning)warning.hidden=!reg;if(help)help.hidden=reg;if(g)g.hidden=reg;if(a)a.hidden=reg;if(note)note.hidden=reg;form.dataset.mode=reg?"register":"login";var title=$("#portal-login-title"),submit=$("#portal-login-submit"),pw=$("#portal-login-password");if(title)title.textContent=reg?"KURO Labに新規登録":"KURO Labにログイン";if(submit)submit.textContent=reg?"アカウントを作成":"ログイン";sw.textContent=reg?"ログインに戻る":"新規アカウント作成";if(pw){pw.autocomplete=reg?"new-password":"current-password";pw.minLength=reg?8:1;}var identityLabel=document.querySelector('label[for="portal-login-email"]'),identityInput=$("#portal-login-email");if(identityLabel)identityLabel.textContent=reg?"ユーザーネーム":"ユーザーネーム / メールアドレス";if(identityInput)identityInput.placeholder=reg?"3〜24文字のユーザーネーム":"ユーザーネームまたはメールアドレス";showLoginError(reg?"新規登録はユーザーネーム（半角英数字・_の3〜24文字）とパスワードで行います。":"");};
 var login=$("#portal-login-form");if(login)login.onsubmit=async function(e){e.preventDefault();var b=$("#portal-login-submit"),em=$("#portal-login-email"),pw=$("#portal-login-password"),er=$("#portal-login-error");if(!b||!em||!pw)return;var reg=this.dataset.mode==="register",identity=em.value.trim(),password=pw.value;b.disabled=true;if(er)er.textContent="";try{if(!db)throw new Error("認証ライブラリを読み込めませんでした。ページを再読み込みしてお試しください。");var r;if(reg){if(!/^[A-Za-z0-9_]{3,24}$/.test(identity))throw new Error("ユーザーネームは半角英数字と_の3〜24文字で入力してください。");r=await usernamePasswordAuth("register",identity,password);}else if(identity.indexOf("@")>=0){r=await db.auth.signInWithPassword({email:identity,password:password});}else{r=await usernamePasswordAuth("login",identity,password);}if(r.error)throw r.error;pw.value="";st.user=(r.data&&r.data.user)||(r.data&&r.data.session&&r.data.session.user)||st.user;updateAccountUI();loadKuroId(st.user);if(modal)modal.hidden=true;toast(reg?"アカウントを作成しました。データを同期しています。":"ログインしました。データを同期しています。");render();sync(true);}catch(err){var msg=String(err&&err.message||err||"通信エラー");if(er)er.textContent=(reg?"新規登録できませんでした：":"ログインできませんでした：")+msg+(useCloudflare?"（Cloudflare中継通信）":"");console.error("KURO portal auth error",err);}finally{b.disabled=false;}};
}

/* KURO Dashboard personalization and shared portal tools */
var DASHBOARD_WIDGETS=[
{id:"shortcuts",title:"クイックアクセス",desc:"よく使うサービスへ",icon:"⚡"},
{id:"games",title:"ゲーム",desc:"KURO GAMESのおすすめ",icon:"🎮"},
{id:"activity",title:"KURO Activity",desc:"KURO Labの新着情報",icon:"◉"},
{id:"clock",title:"時計・日付",desc:"現在時刻と今日の日付",icon:"◷"},
{id:"weather",title:"天気",desc:"地域の現在の天気と予報",icon:"🌤️"},
{id:"market",title:"株価・指数・為替・暗号資産",desc:"国内外の市場チャート",icon:"📈"},
{id:"smartlinks",title:"スマートリンク",desc:"URLからタイトルや画像を自動取得",icon:"🔗"},
{id:"groups",title:"リンクグループ",desc:"複数のリンクをまとめて一括オープン",icon:"🗂️"},
{id:"searchbox",title:"サイト別検索",desc:"Google・YouTube・Amazonなどを検索",icon:"⌕"},
{id:"qr",title:"QRコード",desc:"URLをQRコードに変換",icon:"▦"},
{id:"rss",title:"RSSフィード",desc:"ブログやニュースの新着記事",icon:"📰"},
{id:"notes",title:"クイックメモ",desc:"Markdown対応のメモ",icon:"📝"},
{id:"todo",title:"ToDoリスト",desc:"今日やることをチェック",icon:"☑️"},
{id:"pomodoro",title:"ポモドーロ",desc:"作業と休憩を切り替えるタイマー",icon:"⏱️"},
{id:"worldclock",title:"世界時計",desc:"複数都市の現在時刻",icon:"🌐"},
{id:"countdown",title:"カウントダウン",desc:"締め切りや予定までの残り時間",icon:"⌛"},
{id:"utilities",title:"ミニツール",desc:"電卓とカラーピッカー",icon:"🧮"},
{id:"photo",title:"フォトフレーム",desc:"好きな画像を飾る",icon:"🖼️"},
{id:"media",title:"メディア埋め込み",desc:"YouTubeやSpotifyを表示",icon:"▶️"},
{id:"custom",title:"マイリンク・アプリ起動",desc:"Webサイトや対応アプリへのショートカット",icon:"🔗"}
];
function safeDashboardUrl(value){var raw=String(value||"").trim();if(!raw||raw.length>500)return "";try{if(raw.charAt(0)==="/"&&raw.charAt(1)!=="/"){var local=new URL(raw,location.origin);return local.origin===location.origin?local.pathname+local.search+local.hash:"";}var app=raw.match(/^(slack|notion|vscode):\/\//i);if(app){var au=new URL(raw);return au.protocol.toLowerCase()===app[1].toLowerCase()+":"?au.href:"";}var u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password)return "";return u.href;}catch(e){return "";}}
function dashboardMediaEmbed(value){try{var u=new URL(value);var h=u.hostname.toLowerCase(),id="";if(h==="youtu.be")id=u.pathname.split("/").filter(Boolean)[0]||"";else if(h==="youtube.com"||h==="www.youtube.com"||h==="m.youtube.com"){id=u.searchParams.get("v")||((u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)||[])[1]||"");}if(id&&/^[A-Za-z0-9_-]{6,20}$/.test(id))return "https://www.youtube-nocookie.com/embed/"+id;if((h==="open.spotify.com"||h==="www.open.spotify.com")&&/^\/(?:track|album|playlist|episode|show)\/[A-Za-z0-9]+/.test(u.pathname))return "https://open.spotify.com/embed"+u.pathname;return "";}catch(e){return "";}}
function dashboardFormatTime(sec){sec=Math.max(0,Math.floor(Number(sec)||0));return String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");}
function dashboardSafeMarkdown(value){return esc(value).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>").replace(/\n/g,"<br>");}
function renderCustomLinksEditor(){var a=st.data.preferences.customLinks||[];if(!a.length)return '<div class="portal-widget-empty">まだリンクはありません。上のフォームから好きなサイトを追加できます。</div>';return a.map(function(x){return '<div class="portal-custom-link-row"><span>'+esc(x.icon||"🔗")+'</span><b>'+esc(x.title)+'</b><small>'+esc(x.href)+'</small><button type="button" data-custom-link-remove="'+esc(x.id)+'" aria-label="'+esc(x.title)+'を削除">×</button></div>';}).join("");}
function getDashboardIds(){var a=st.data.preferences.dashboardWidgets;if(!Array.isArray(a))a=["shortcuts","games","weather"];var out=a.filter(function(id,i){return DASHBOARD_WIDGETS.some(function(x){return x.id===id;})&&a.indexOf(id)===i;});return out;}
function getDashboardCanvasBounds(){return {width:2400,height:1600};}
function getDashboardCanvasPosition(id,index){var all=st.data.preferences.dashboardCanvasPositions||{},p=all[id]||{},size=(st.data.preferences.dashboardSizes||{})[id]||"half",bounds=getDashboardCanvasBounds();var widths={small:320,half:420,wide:560,full:740},width=Math.max(260,Math.min(1100,Number.isFinite(Number(p.width))?Number(p.width):(widths[size]||420)));return {x:Math.max(0,Math.min(bounds.width-width,Number.isFinite(Number(p.x))?Number(p.x):80+(index%3)*480)),y:Math.max(0,Math.min(bounds.height-160,Number.isFinite(Number(p.y))?Number(p.y):80+Math.floor(index/3)*380)),width:width,rotation:Math.max(-180,Math.min(180,Number(p.rotation)||0)),z:Math.max(1,Math.min(999,Number(p.z)||100+index))};}
function saveDashboardCanvasPosition(id,p){var all=st.data.preferences.dashboardCanvasPositions||{};all[id]={x:Math.round(p.x),y:Math.round(p.y),width:Math.round(p.width),rotation:Math.round(p.rotation),z:Math.round(p.z)};st.data.preferences.dashboardCanvasPositions=all;}
function setDashboardIds(a){st.data.preferences.dashboardWidgets=a;persistDisplayPrefs();}
function dashboardWidget(id){
 var d=DASHBOARD_WIDGETS.find(function(x){return x.id===id;});if(!d)return "";
 var defaultSizes={shortcuts:"wide",games:"wide",activity:"small",clock:"half",weather:"small",market:"wide",smartlinks:"wide",groups:"wide",searchbox:"half",qr:"small",rss:"wide",notes:"half",todo:"half",pomodoro:"small",worldclock:"half",countdown:"half",utilities:"half",photo:"half",media:"wide",custom:"half"},savedSize=(st.data.preferences.dashboardSizes||{})[id],size=["small","half","wide","full"].indexOf(savedSize)>=0?savedSize:(defaultSizes[id]||"half"),savedSpan=Number((st.data.preferences.dashboardSpans||{})[id]),spanStyle=savedSpan>=3&&savedSpan<=12?'--widget-span:'+Math.round(savedSpan)+';':'',savedHeight=Number((st.data.preferences.dashboardHeights||{})[id]),heightStyle=savedHeight>=160&&savedHeight<=900?'height:'+Math.round(savedHeight)+'px;':'',edit=!!st.dashboardEditing,resizeMode=!!st.dashboardResizeMode,canvasMode=st.data.preferences.dashboardViewMode==="canvas",canvasPos=getDashboardCanvasPosition(id,Math.max(0,getDashboardIds().indexOf(id))),canvasStyle=canvasMode?"position:absolute;left:"+canvasPos.x+"px;top:"+canvasPos.y+"px;width:"+canvasPos.width+"px;z-index:"+canvasPos.z+";transform:rotate("+canvasPos.rotation+"deg);"+heightStyle:"",b="";
 if(id==="shortcuts"){var savedShortcuts=st.data.favorites.slice(0,6);b='<div class="portal-shortcut-grid"><a href="/games/"><span>🎮</span><b>KURO GAMES</b><small>ゲームを遊ぶ</small></a><a href="/sns/"><span>💬</span><b>KURO SNS</b><small>投稿・交流</small></a><a href="/chat/"><span>🗨️</span><b>オープンチャット</b><small>ゲスト参加OK</small></a><a href="/search/"><span>⌕</span><b>サイト内検索</b><small>ページを探す</small></a></div>'+(savedShortcuts.length?'<div class="portal-shortcut-saved"><div class="portal-shortcut-saved-head"><b>保存したリンク</b><a href="/favorites/">すべて見る →</a></div><div class="portal-widget-link-list">'+savedShortcuts.map(function(x){return '<a href="'+esc(x.href)+'"><span>★</span><b>'+esc(x.title)+'</b><i>↗</i></a>';}).join("")+'</div></div>':'<div class="portal-shortcut-empty">お気に入りに保存した項目はここに表示されます。</div>');}
 else if(id==="games")b='<div class="portal-dashboard-game-grid"><a class="portal-dashboard-game sushi" href="/game/kaiten-sushi-typing/"><span>🍣</span><b>回転寿司タイピング</b><small>タイピングゲーム</small></a><a class="portal-dashboard-game blocks" href="/game/block-blast/"><span>🧩</span><b>ブロックブラスト</b><small>パズルゲーム</small></a><a class="portal-dashboard-game all" href="/games/"><span>＋</span><b>ゲーム一覧</b><small>もっと探す</small></a></div>';
 else if(id==="activity")b=st.ann.length?'<div class="portal-activity-list">'+st.ann.slice(0,4).map(function(x){return '<a href="'+esc(x.href||"/notifications/")+'"><time>'+fmt(x.created_at)+'</time><b>'+esc(x.title)+'</b><span>'+esc(x.body)+'</span></a>';}).join("")+'</div>':'<div class="portal-widget-empty">新しいお知らせはありません。<a href="/notifications/">お知らせを見る →</a></div>';
 else if(id==="clock")b='<div class="portal-dashboard-clock"><strong id="portal-clock-time">--:--</strong><span id="portal-clock-date"></span></div>';
 else if(id==="weather"){var city=String(st.data.preferences.weatherCity||"東京").slice(0,32);b='<div class="portal-weather"><div class="portal-weather-search" data-weather-editor hidden><input type="text" maxlength="32" value="'+esc(city)+'" data-weather-city aria-label="天気を表示する地域" placeholder="都市名"><button type="button" data-weather-search>表示</button></div><div class="portal-weather-status" id="portal-weather-status">天気を読み込み中…</div><div class="portal-weather-scene is-loading" id="portal-weather-scene" aria-hidden="true"><div class="weather-sun"><i></i></div><div class="weather-cloud"><i></i></div><div class="weather-rain"><i></i><i></i><i></i></div><div class="weather-snow"><i>✦</i><i>✦</i><i>✦</i></div><div class="weather-lightning"></div></div><div class="portal-weather-main"><strong id="portal-weather-temp">--°</strong><span id="portal-weather-label">---</span></div><div class="portal-weather-details"><span>最高 <b id="portal-weather-max">--°</b></span><span>最低 <b id="portal-weather-min">--°</b></span><span>降水 <b id="portal-weather-rain">--%</b></span></div><small class="portal-weather-credit">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a></small><button type="button" class="portal-weather-location" data-weather-location-toggle aria-label="地域を変更" title="地域を変更">⌖</button></div>';}
 else if(id==="market"){var symbols=[{v:"TVC:NI225",n:"日経平均"},{v:"SP:SPX",n:"S&P 500"},{v:"NASDAQ:NDX",n:"NASDAQ 100"},{v:"FX:USDJPY",n:"ドル / 円"},{v:"FX:EURJPY",n:"ユーロ / 円"},{v:"FX:GBPJPY",n:"ポンド / 円"},{v:"BINANCE:BTCUSDT",n:"Bitcoin / USDT"},{v:"BINANCE:ETHUSDT",n:"Ethereum / USDT"},{v:"NASDAQ:AAPL",n:"Apple"}],sym=String(st.data.preferences.marketSymbol||"TVC:NI225");if(!symbols.some(function(x){return x.v===sym;}))sym="TVC:NI225";var tvUrl="https://s.tradingview.com/widgetembed/?frameElementId=kuro-market-chart&symbol="+encodeURIComponent(sym)+"&interval=60&hidesidetoolbar=1&symboledit=1&saveimage=0&toolbarbg=%23f4f7fb&studies=%5B%5D&theme="+(document.body.dataset.theme==="dark"?"dark":"light")+"&style=1&timezone=Asia%2FTokyo&withdateranges=1&hideideas=1&locale=ja";b='<div class="portal-market"><label class="portal-market-select-label" for="portal-market-symbol">表示する市場</label><select id="portal-market-symbol" data-market-symbol>'+symbols.map(function(x){return '<option value="'+x.v+'" '+(x.v===sym?"selected":"")+'>'+x.n+'</option>';}).join("")+'</select><iframe class="portal-market-frame" title="株価・市場チャート" src="'+esc(tvUrl)+'" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><small>市場データは遅延する場合があります。情報表示用であり、投資判断を目的としたものではありません。 <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a></small></div>';}
 
else if(id==="smartlinks"){var smart=Array.isArray(st.data.preferences.smartLinks)?st.data.preferences.smartLinks:[];b='<div class="portal-smartlinks-form"><input type="url" data-smart-url placeholder="https://example.com/" aria-label="URLを入力"><button type="button" data-smart-add>カードを作成</button></div><small class="portal-widget-hint">ページ情報の取得に外部サービスを使用します。公開URLだけを使い、認証情報や秘密トークンを含むURLは登録しないでください。</small>'+(smart.length?'<div class="portal-smartlinks-grid">'+smart.map(function(x){var href=safeDashboardUrl(x.href);if(!href)return "";var icon=x.logo||("https://www.google.com/s2/favicons?domain="+encodeURIComponent(new URL(href).hostname)+"&sz=64");return '<a class="portal-smartlink-card" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+(x.image?'<img class="portal-smartlink-image" src="'+esc(x.image)+'" alt="" loading="lazy">':"")+'<div class="portal-smartlink-meta"><img src="'+esc(icon)+'" alt="" loading="lazy"><span><b>'+esc(x.title||new URL(href).hostname)+'</b><small>'+esc(x.description||new URL(href).hostname)+'</small></span></div></a>';}).join("")+'</div>':'<div class="portal-widget-empty">URLを貼り付けると、タイトル・説明・画像を取得してカードにします。</div>');}
 else if(id==="groups"){var groups=Array.isArray(st.data.preferences.linkGroups)?st.data.preferences.linkGroups:[];b='<div class="portal-groups-form"><input type="text" maxlength="32" data-group-title placeholder="グループ名（例：朝のルーティン）"><textarea rows="3" data-group-urls placeholder="URLを1行に1つずつ入力"></textarea><button type="button" data-group-add>グループを作成</button></div>'+(groups.length?'<div class="portal-group-list">'+groups.map(function(g){return '<div class="portal-group-row"><div><b>'+esc(g.title)+'</b><small>'+(g.links||[]).length+' 件のリンク</small></div><button type="button" data-group-open="'+esc(g.id)+'">まとめて開く ↗</button><button type="button" class="subtle" data-group-delete="'+esc(g.id)+'" aria-label="削除">×</button></div>';}).join("")+'</div>':'<div class="portal-widget-empty">複数のURLを用途別にまとめて、まとめて開けます。</div>');}
 else if(id==="searchbox"){b='<form class="portal-site-search" data-site-search-form><select data-search-engine aria-label="検索先"><option value="google">Google</option><option value="youtube">YouTube</option><option value="amazon">Amazon</option><option value="chatgpt">ChatGPT</option></select><input type="search" data-site-search-query placeholder="検索ワードを入力"><button type="submit">検索 ↗</button></form>';}
 else if(id==="qr"){var qrValue=String(st.data.preferences.qrValue||"");b='<div class="portal-qr-form"><input type="url" data-qr-value value="'+esc(qrValue)+'" placeholder="https://example.com/" aria-label="QRコードにするURL"><button type="button" data-qr-generate>生成</button></div><small class="portal-widget-hint">QR生成のため、入力URLを外部サービスに送信します。</small><div class="portal-qr-result">'+(qrValue?'<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data='+encodeURIComponent(qrValue)+'" alt="入力したURLのQRコード" loading="lazy">':'<span>URLを入力するとQRコードを生成します</span>')+'</div>';}
 else if(id==="rss"){var feeds=Array.isArray(st.data.preferences.rssFeeds)?st.data.preferences.rssFeeds:[];b='<div class="portal-rss-form"><input type="url" data-rss-url placeholder="RSS / Atom フィードURL"><button type="button" data-rss-add>フィードを登録</button></div><small class="portal-widget-hint">公開フィード専用です。認証情報や秘密トークンを含むURLは登録しないでください。</small><div class="portal-rss-list">'+(feeds.length?feeds.map(function(x){return '<section class="portal-rss-feed" data-rss-id="'+esc(x.id)+'"><div><b>'+esc(x.title||x.url)+'</b><button type="button" data-rss-refresh="'+esc(x.id)+'">更新</button><button type="button" data-rss-delete="'+esc(x.id)+'" aria-label="削除">×</button></div><div class="portal-rss-items" id="rss-items-'+esc(x.id)+'">読み込み中…</div></section>';}).join(""):'<div class="portal-widget-empty">RSS / Atom またはYouTubeチャンネルのフィードURLを登録できます。</div>')+'</div>';}
 else if(id==="notes"){var note=String(st.data.preferences.quickNote||"");b='<div class="portal-note-editor"><textarea rows="7" data-quick-note placeholder="メモを書く… **太字**、*斜体*、コード に対応">'+esc(note)+'</textarea><div class="portal-note-preview" data-note-preview>'+(note?dashboardSafeMarkdown(note):"プレビューはここに表示されます")+'</div><small>入力内容は自動保存されます</small></div>';}
 else if(id==="todo"){var todos=Array.isArray(st.data.preferences.todos)?st.data.preferences.todos:[];b='<div class="portal-todo-form"><input type="text" maxlength="100" data-todo-text placeholder="今日やること"><button type="button" data-todo-add>追加</button></div>'+(todos.length?'<ul class="portal-todo-list">'+todos.map(function(x){return '<li class="'+(x.done?"is-done":"")+'"><label><input type="checkbox" data-todo-toggle="'+esc(x.id)+'" '+(x.done?"checked":"")+'><span>'+esc(x.text)+'</span></label><button type="button" data-todo-delete="'+esc(x.id)+'" aria-label="削除">×</button></li>';}).join("")+'</ul>':'<div class="portal-widget-empty">タスクを追加して、終わったらチェック。</div>');}
 else if(id==="pomodoro"){var ps=st.data.preferences.pomodoroState||{mode:"work",remaining:1500,endAt:0,running:false};var pr=ps.running&&ps.endAt?Math.max(0,Math.ceil((ps.endAt-Date.now())/1000)):Number(ps.remaining||1500);b='<div class="portal-pomodoro"><div class="portal-pomodoro-modes"><button type="button" data-pomo-mode="work" class="'+(ps.mode==="work"?"active":"")+'">作業 25分</button><button type="button" data-pomo-mode="break" class="'+(ps.mode==="break"?"active":"")+'">休憩 5分</button></div><strong id="portal-pomo-time">'+dashboardFormatTime(pr)+'</strong><small id="portal-pomo-status">'+(ps.running?"計測中":ps.mode==="break"?"休憩モード":"作業モード")+'</small><div><button type="button" data-pomo-start>スタート / 再開</button><button type="button" data-pomo-pause>一時停止</button><button type="button" data-pomo-reset>リセット</button></div></div>';}
 else if(id==="worldclock"){b='<div class="portal-worldclocks"><div><span>東京</span><b data-worldclock="Asia/Tokyo">--:--</b></div><div><span>ロンドン</span><b data-worldclock="Europe/London">--:--</b></div><div><span>ニューヨーク</span><b data-worldclock="America/New_York">--:--</b></div><div><span>ロサンゼルス</span><b data-worldclock="America/Los_Angeles">--:--</b></div></div>';}
 else if(id==="countdown"){var target=String(st.data.preferences.countdownTarget||"");b='<div class="portal-countdown"><label for="portal-countdown-input">目標日時</label><div><input type="datetime-local" id="portal-countdown-input" data-countdown-input value="'+esc(target)+'"><button type="button" data-countdown-save>設定</button></div><strong id="portal-countdown-display">日時を設定してください</strong></div>';}
 else if(id==="utilities"){b='<div class="portal-mini-calc"><div><input type="number" step="any" data-calc-a value="12" aria-label="1つ目の数値"><select data-calc-op aria-label="演算"><option value="+">＋</option><option value="-">−</option><option value="*">×</option><option value="/">÷</option></select><input type="number" step="any" data-calc-b value="3" aria-label="2つ目の数値"><button type="button" data-calc-run>=</button></div><output data-calc-result>15</output></div><div class="portal-color-tool"><label>カラーピッカー <input type="color" data-color-value value="#6478d3"></label><button type="button" data-color-copy>HEXをコピー</button><code data-color-hex>#6478d3</code></div>';}
 else if(id==="photo"){var photo=safeDashboardUrl(st.data.preferences.photoFrameUrl||"");b='<div class="portal-photo-tool"><div><input type="url" data-photo-url value="'+esc(photo)+'" placeholder="画像のHTTPS URL"><button type="button" data-photo-save>表示</button></div>'+(photo?'<img src="'+esc(photo)+'" alt="カスタムフォトフレーム" loading="lazy">':'<div class="portal-photo-placeholder">画像URLを設定するとここに表示します</div>')+'</div>';}
 else if(id==="media"){var media=String(st.data.preferences.mediaEmbedUrl||""),embed=dashboardMediaEmbed(media);b='<div class="portal-media-tool"><div><input type="url" data-media-url value="'+esc(media)+'" placeholder="YouTube / Spotify のURL"><button type="button" data-media-save>埋め込む</button></div>'+(embed?'<iframe src="'+esc(embed)+'" title="メディアプレイヤー" loading="lazy" allow="encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>':'<div class="portal-photo-placeholder">YouTubeまたはSpotifyのURLを設定してください</div>')+'</div>';}
else if(id==="custom"){var links=st.data.preferences.customLinks||[];b=links.length?'<div class="portal-custom-link-grid">'+links.map(function(x){var href=safeDashboardUrl(x.href);if(!href)return "";var external=/^https:\/\//i.test(href)&&new URL(href,location.href).origin!==location.origin;return '<a href="'+esc(href)+'" '+(external?'target="_blank" rel="noopener noreferrer"':"")+'><span>'+esc(x.icon||"🔗")+'</span><b>'+esc(x.title)+'</b><i>↗</i></a>';}).join("")+'</div>':'<div class="portal-widget-empty">自分だけのショートカットを登録できます。<a href="#" data-open-dashboard-editor>リンクを追加する →</a></div>';}
 var more=id==="games"?"/games/":id==="activity"?"/notifications/":id==="recent"?"/history/":id==="favorites"?"/favorites/":id==="achievements"?"/achievements/":id==="shortcuts"?"/search/":"/settings/";
 return '<section class="portal-widget '+(edit?"is-editing":"")+'" data-widget-id="'+id+'" data-size="'+size+'" style="'+(canvasMode?canvasStyle:spanStyle+heightStyle)+'"><div class="portal-widget-head"><div class="portal-widget-title"><span>'+d.icon+'</span><div><b>'+d.title+'</b><small>'+d.desc+'</small></div></div><div class="portal-widget-tools" '+(edit?"":"hidden")+'>'+(edit&&canvasMode?'<button type="button" data-canvas-rotate="'+id+'" title="15度回転" aria-label="回転">↻</button><button type="button" data-canvas-front="'+id+'" title="前面へ" aria-label="前面へ">↑</button><button type="button" data-canvas-back="'+id+'" title="背面へ" aria-label="背面へ">↓</button>':'')+'</div><a class="portal-widget-more" href="'+more+'" '+(edit?'hidden':'')+'>›</a></div>'+(edit&&!canvasMode?'<div class="portal-widget-resize-handle n" data-resize-dir="n" title="上辺をドラッグ"></div><div class="portal-widget-resize-handle s" data-resize-dir="s" title="下辺をドラッグ"></div><div class="portal-widget-resize-handle e" data-resize-dir="e" title="右辺をドラッグ"></div><div class="portal-widget-resize-handle w" data-resize-dir="w" title="左辺をドラッグ"></div><div class="portal-widget-resize-handle ne" data-resize-dir="ne" title="右上をドラッグ"></div><div class="portal-widget-resize-handle nw" data-resize-dir="nw" title="左上をドラッグ"></div><div class="portal-widget-resize-handle se" data-resize-dir="se" title="右下をドラッグ"></div><div class="portal-widget-resize-handle sw" data-resize-dir="sw" title="左下をドラッグ"></div>':'')+'<button type="button" class="portal-widget-remove" data-widget-remove="'+id+'" aria-label="'+d.title+'を削除" '+(edit?"":"hidden")+'>−</button><div class="portal-widget-body">'+b+'</div></section>';
}
function home(){
 var params=new URLSearchParams(location.search),q=params.get("q")||"",mode=params.get("type")||"web";
 if(["web","images","news","local"].indexOf(mode)<0)mode="web";
 return '<section class="kuro-home-searchpage"><div class="kuro-home-searchbrand"><img src="/assets/brand/logo/kurolab_icon_maru_160.png?v=20261122searchhome2" alt="KURO Lab"><span><b>KURO LAB</b><small>SEARCH</small></span></div><div class="kuro-home-searchintro"><span class="kuro-home-eyebrow">KURO SEARCH</span><h1>何を検索しますか？</h1><p>ウェブも、画像も、ニュースも。ここから検索。</p></div><section class="kuro-engine"><form id="portal-search-form" class="portal-search kuro-engine-form"><input id="portal-search-input" class="portal-input" type="search" autocomplete="off" maxlength="180" placeholder="検索したい言葉を入力…" value="'+esc(q)+'" aria-label="検索ワード"><button class="portal-btn primary" type="submit">検索</button></form><nav class="kuro-engine-tabs" role="tablist" aria-label="検索カテゴリ"><button type="button" role="tab" data-kuro-search-mode="web" aria-selected="'+(mode==="web")+'">ウェブ</button><button type="button" role="tab" data-kuro-search-mode="images" aria-selected="'+(mode==="images")+'">画像</button><button type="button" role="tab" data-kuro-search-mode="news" aria-selected="'+(mode==="news")+'">ニュース</button><button type="button" role="tab" data-kuro-search-mode="local" aria-selected="'+(mode==="local")+'">KURO Lab内</button></nav><p class="kuro-engine-note">外部検索はセーフサーチを有効にして表示します。</p><div id="kuro-search-status" class="kuro-search-status" role="status" aria-live="polite"></div><div id="portal-search-results" class="kuro-engine-results"></div></section><nav class="kuro-home-shortcuts" aria-label="ショートカット"><a href="/games/">ゲーム</a><a href="/sns/">SNS</a><a href="/chat/">チャット</a><a href="/guide/">ガイド</a></nav></section><style>'+".kuro-home-searchpage{max-width:1080px;min-height:calc(100vh - 190px);margin:0 auto;padding:clamp(30px,7vh,76px) 14px 46px;display:flex;flex-direction:column;align-items:stretch}.kuro-home-searchbrand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:clamp(38px,7vh,66px)}.kuro-home-searchbrand img{width:46px;height:46px;object-fit:contain}.kuro-home-searchbrand span{display:grid;text-align:left;gap:2px}.kuro-home-searchbrand b{font-size:16px;letter-spacing:.13em}.kuro-home-searchbrand small{font-size:9px;letter-spacing:.22em;color:var(--muted)}.kuro-home-searchintro{text-align:center;margin-bottom:25px}.kuro-home-eyebrow{font-size:10px;font-weight:900;letter-spacing:.2em;color:var(--blue)}.kuro-home-searchintro h1{font-size:clamp(27px,4vw,39px);letter-spacing:-.045em;line-height:1.2;margin:9px 0}.kuro-home-searchintro p{margin:0;color:var(--muted);font-size:13px}.kuro-engine{width:100%;max-width:850px;margin:0 auto}.kuro-engine-form{display:flex;gap:10px;align-items:center;padding:7px;border:1px solid var(--line);border-radius:17px;background:var(--surface);box-shadow:0 12px 35px rgba(30,50,80,.08)}.kuro-engine-form input{flex:1;min-width:0;border:0!important;box-shadow:none!important;background:transparent!important;padding:12px 13px!important;font-size:16px!important}.kuro-engine-form input:focus{outline:0}.kuro-engine-form button{min-height:43px;padding:0 21px;border-radius:11px;white-space:nowrap}.kuro-engine-tabs{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin:17px 0 8px;border-bottom:1px solid var(--line);padding-bottom:11px}.kuro-engine-tabs button{border:0;background:transparent;color:var(--muted);padding:9px 15px;border-radius:10px;font-weight:750;cursor:pointer}.kuro-engine-tabs button[aria-selected=\"true\"]{background:var(--blue2);color:var(--ink)}.kuro-engine-note,.kuro-search-status{color:var(--muted);font-size:11px;margin:10px 2px;text-align:center}.kuro-engine-results{display:grid;gap:12px;margin-top:13px}.kuro-web-result{padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:var(--surface);min-width:0}.kuro-web-result a{color:var(--ink);text-decoration:none}.kuro-web-result a:hover{text-decoration:underline}.kuro-web-result h2{font-size:17px;line-height:1.45;margin:5px 0 7px}.kuro-web-result p{font-size:13px;line-height:1.7;color:var(--muted);margin:0}.kuro-web-result .kuro-result-url{font-size:11px;color:#16805d;overflow-wrap:anywhere}.kuro-web-result time{font-size:11px;color:var(--muted);margin-left:8px}.kuro-image-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.kuro-image-result{overflow:hidden;border:1px solid var(--line);border-radius:13px;background:var(--surface);text-decoration:none}.kuro-image-result img{width:100%;height:150px;object-fit:cover;display:block;background:var(--surface2)}.kuro-image-result p{font-size:12px;padding:9px 10px;margin:0;color:var(--muted);line-height:1.5}.kuro-engine-empty{padding:26px 16px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}.kuro-home-shortcuts{display:flex;justify-content:center;gap:19px;flex-wrap:wrap;margin:34px 0 0}.kuro-home-shortcuts a{font-size:11px;color:var(--muted);text-decoration:none}.kuro-home-shortcuts a:hover{color:var(--blue);text-decoration:underline}@media(max-width:600px){.kuro-home-searchpage{padding-top:28px}.kuro-home-searchbrand{margin-bottom:36px}.kuro-home-searchintro h1{font-size:28px}.kuro-engine-form{gap:5px;padding:5px}.kuro-engine-form input{font-size:14px!important;padding:10px 8px!important}.kuro-engine-form button{padding:0 13px;min-height:40px}.kuro-engine-tabs{gap:2px}.kuro-engine-tabs button{padding:8px 10px;font-size:12px}.kuro-web-result{padding:13px}.kuro-image-results{grid-template-columns:repeat(2,minmax(0,1fr))}.kuro-home-shortcuts{gap:14px}}"+'</style>';
}
function applyDisplayPrefs(){var p=st.data&&st.data.preferences||{};document.body.dataset.theme=p.theme==="dark"?"dark":"light";document.body.dataset.density=p.density==="compact"?"compact":"comfortable";document.body.dataset.motion=p.motion==="reduced"?"reduced":"normal";document.body.dataset.background="plain";document.body.style.removeProperty("--blue");document.body.style.removeProperty("--blue2");if(document.body.dataset.theme==="light"){document.body.style.setProperty("--bg","#ffffff");document.body.style.setProperty("--surface","#ffffff");document.body.style.setProperty("--surface2","#f8fafc");document.body.style.setProperty("background","#ffffff","important");}else{document.body.style.removeProperty("--bg");document.body.style.removeProperty("--surface");document.body.style.removeProperty("--surface2");document.body.style.removeProperty("background");}var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=document.body.dataset.theme==="dark"?"#090a10":"#ffffff";}
function persistDisplayPrefs(){save();if(st.user){if(st.sync)st.syncAgain=true;else sync(false);}}
function bindDisplaySettings(){var x=$("#portal-theme");if(x)x.onchange=function(){st.data.preferences.theme=this.value;persistDisplayPrefs();};x=$("#portal-density");if(x)x.onchange=function(){st.data.preferences.density=this.value;persistDisplayPrefs();};x=$("#portal-motion");if(x)x.onchange=function(){st.data.preferences.motion=this.value;persistDisplayPrefs();};}
function positionDashboardEditor(){
 var panel=$("#portal-dashboard-editor"),button=$("#portal-dashboard-add");
 if(!panel||panel.hidden||!button)return;
 if(panel.parentNode!==document.body)document.body.appendChild(panel);
 var r=button.getBoundingClientRect(),gap=8,w=Math.min(360,window.innerWidth-24);
 var mobile=window.matchMedia&&window.matchMedia("(max-width:760px)").matches;
 var maxLeft=Math.max(12,window.innerWidth-w-12),minLeft=mobile?12:Math.min(272,maxLeft);
 var left=Math.max(minLeft,Math.min(r.left,maxLeft));
 var top=r.bottom+gap,available=window.innerHeight-top-12;
 if(available<180){
  var above=Math.min(480,Math.max(150,r.top-24));
  top=Math.max(12,r.top-above-gap);
  available=window.innerHeight-top-12;
 }
 panel.style.setProperty("position","fixed","important");
 panel.style.setProperty("top",Math.round(top)+"px","important");
 panel.style.setProperty("left",Math.round(left)+"px","important");
 panel.style.setProperty("right","auto","important");
 panel.style.setProperty("bottom","auto","important");
 panel.style.setProperty("width",Math.round(w)+"px","important");
 panel.style.setProperty("max-height",Math.max(150,Math.min(480,available))+"px","important");
 panel.style.setProperty("overflow-y","auto","important");
 panel.style.setProperty("z-index","2147483647","important");
}
function restoreDashboardEditor(panel,add){
 var actions=document.querySelector(".portal-dashboard-actions");
 if(panel){panel.hidden=true;panel.style.position="";panel.style.top="";panel.style.left="";panel.style.right="";panel.style.bottom="";panel.style.width="";panel.style.maxHeight="";panel.style.overflowY="";panel.style.zIndex="";if(actions&&panel.parentNode!==actions)actions.appendChild(panel);}
 if(add)add.setAttribute("aria-expanded","false");
}
function positionDashboardToolbar(){
 var main=$("#portal-main"),headerInner=document.querySelector(".portal-header-inner");
 if(!main||!headerInner)return;
 var toolbar=main.querySelector(".portal-dashboard-toolbar");
 var oldHeaderToolbar=headerInner.querySelector(".portal-dashboard-toolbar-in-header");
 if(!toolbar)toolbar=oldHeaderToolbar;
 if(!toolbar)return;
 if(toolbar!==oldHeaderToolbar&&oldHeaderToolbar)oldHeaderToolbar.remove();
 var mobile=window.matchMedia&&window.matchMedia("(max-width:760px)").matches;
 var brand=headerInner.querySelector(".portal-brand"),topnav=$("#portal-desktop-nav");
 if(mobile){
  toolbar.classList.remove("portal-dashboard-toolbar-in-header");
  toolbar.classList.add("portal-dashboard-toolbar-mobile");
  if(toolbar.parentNode!==main)main.insertBefore(toolbar,main.firstChild);
 }else{
  toolbar.classList.remove("portal-dashboard-toolbar-mobile");
  toolbar.classList.add("portal-dashboard-toolbar-in-header");
  if(toolbar.parentNode!==headerInner){
   if(brand&&brand.parentNode===headerInner)brand.insertAdjacentElement("afterend",toolbar);
   else headerInner.insertBefore(toolbar,topnav||headerInner.firstChild);
  }
 }
 /* Force full contrast on the actual toolbar controls after they are moved into the header. */
 var toolbarActions=toolbar.querySelector(".portal-dashboard-actions");
 if(toolbarActions){
  function applyToolbarButtonContrast(){
   toolbar.style.setProperty("opacity","1","important");
   toolbar.style.setProperty("filter","none","important");
   toolbar.style.setProperty("visibility","visible","important");
   toolbar.style.setProperty("animation","none","important");
   toolbarActions.style.setProperty("opacity","1","important");
   toolbarActions.style.setProperty("filter","none","important");
   toolbarActions.style.setProperty("visibility","visible","important");
   Array.prototype.forEach.call(toolbarActions.children,function(button){
    if(!button||button.tagName!=="BUTTON")return;
    button.style.setProperty("opacity","1","important");
    button.style.setProperty("filter","none","important");
    button.style.setProperty("visibility","visible","important");
    button.style.setProperty("color","#17283c","important");
    button.style.setProperty("-webkit-text-fill-color","#17283c","important");
    button.style.setProperty("background-color","#eef2f6","important");
    button.style.setProperty("background-image","none","important");
    button.style.setProperty("border-color","#d5dee8","important");
    button.style.setProperty("text-shadow","none","important");
    button.style.setProperty("mix-blend-mode","normal","important");
    if(button.classList.contains("primary")||button.classList.contains("is-active")||button.getAttribute("aria-pressed")==="true"){
     button.style.setProperty("background-color","#dbeafe","important");
     button.style.setProperty("border-color","#b8d2f3","important");
     button.style.setProperty("color","#16416b","important");
     button.style.setProperty("-webkit-text-fill-color","#16416b","important");
    }
    Array.prototype.forEach.call(button.querySelectorAll("*"),function(child){
     child.style.setProperty("color","inherit","important");
     child.style.setProperty("-webkit-text-fill-color","inherit","important");
    });
   });
  }
  applyToolbarButtonContrast();
  if(!toolbarActions.__kuroContrastObserver&&window.MutationObserver){
   toolbarActions.__kuroContrastObserver=new MutationObserver(applyToolbarButtonContrast);
   toolbarActions.__kuroContrastObserver.observe(toolbarActions,{childList:true});
  }
 }
}
function bindDashboard(){
 positionDashboardToolbar();
 if(!window.kuroDashboardViewModeDelegationBound){
  document.addEventListener("click",function(e){
   var target=e.target&&e.target.nodeType===1?e.target:e.target&&e.target.parentElement;
   var choice=target&&target.closest?target.closest("[data-dashboard-view-choice]"):null;
   if(!choice)return;
   var mode=choice.getAttribute("data-dashboard-view-choice");
   if(mode!=="grid"&&mode!=="canvas")return;
   e.preventDefault();
   e.stopPropagation();
   if(e.stopImmediatePropagation)e.stopImmediatePropagation();
   if(!st.data||!st.data.preferences)return;
   if(st.data.preferences.dashboardViewMode===mode)return;
   st.data.preferences.dashboardViewMode=mode;
   persistDisplayPrefs();
   render();
  },true);
  window.kuroDashboardViewModeDelegationBound=true;
 }
 if(!window.kuroDashboardAddDelegationBound){
  document.addEventListener("click",function(e){
   var target=e.target&&e.target.nodeType===1?e.target:e.target&&e.target.parentElement;
   var trigger=target&&target.closest?target.closest("#portal-dashboard-add"):null;
   if(!trigger)return;
   e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
   var panels=Array.prototype.slice.call(document.querySelectorAll("#portal-dashboard-editor"));
   var panel=panels.find(function(x){return !x.hidden;});
   if(!panel){
    var toolbar=trigger.closest(".portal-dashboard-toolbar");
    panel=toolbar&&toolbar.querySelector("#portal-dashboard-editor");
   }
   if(!panel)panel=panels[panels.length-1];
   if(!panel)return;
   panels.forEach(function(x){if(x!==panel)x.remove();});
   if(panel.hidden){panel.hidden=false;trigger.setAttribute("aria-expanded","true");positionDashboardEditor();}
   else{restoreDashboardEditor(panel,trigger);}
  },true);
  window.kuroDashboardAddDelegationBound=true;
 }

 window.addEventListener("resize",positionDashboardEditor,{passive:true});
 window.addEventListener("scroll",positionDashboardEditor,{passive:true,capture:true});
 if(!window.kuroDashboardToolbarResizeBound){
  window.addEventListener("resize",positionDashboardToolbar,{passive:true});
  window.kuroDashboardToolbarResizeBound=true;
 }
 var edit=$("#portal-dashboard-edit"),mode=$("#portal-dashboard-mode"),add=$("#portal-dashboard-add"),reset=$("#portal-dashboard-reset"),panel=$("#portal-dashboard-editor"),grid=$("#portal-dashboard-grid"),layout=$("#portal-dashboard-layout"),form=$("#portal-custom-link-form");
 if(edit)edit.onclick=function(){st.dashboardEditing=!st.dashboardEditing;if(!st.dashboardEditing)st.dashboardResizeMode=false;render();};
 if(mode)mode.onclick=function(){st.dashboardResizeMode=!st.dashboardResizeMode;render();};
 if(add)add.onclick=function(){if(panel){if(panel.hidden){panel.hidden=false;add.setAttribute("aria-expanded","true");positionDashboardEditor();}else{restoreDashboardEditor(panel,add);}}};
 if(reset)reset.onclick=function(){if(!confirm("ホーム画面の配置を初期状態に戻しますか？"))return;st.data.preferences.dashboardWidgets=["shortcuts","games","weather"];st.data.preferences.dashboardSizes={};st.data.preferences.dashboardSpans={};st.data.preferences.dashboardHeights={};st.data.preferences.dashboardLayout="balanced";st.data.preferences.dashboardViewMode="grid";st.data.preferences.dashboardCanvasPositions={};st.data.preferences.dashboardCanvasBounds={width:4800,height:3200};st.data.preferences.dashboardCanvasZoom=1;window.__kuroCanvasScroll=null;safeStorageRemove("localStorage","kuro_canvas_view");st.dashboardEditing=false;persistDisplayPrefs();render();toast("ホーム画面を初期配置に戻しました");};
 if(layout)layout.onchange=function(){st.data.preferences.dashboardLayout=this.value;persistDisplayPrefs();render();};

 var viewChoices=document.querySelectorAll(".portal-dashboard-toolbar [data-dashboard-view-choice]");
 viewChoices.forEach(function(choice){choice.onclick=function(){var mode=choice.getAttribute("data-dashboard-view-choice");if(mode!=="grid"&&mode!=="canvas")return;if(st.data.preferences.dashboardViewMode===mode)return;st.data.preferences.dashboardViewMode=mode;persistDisplayPrefs();render();};});
 var zoomIn=$("[data-canvas-zoom-in]"),zoomOut=$("[data-canvas-zoom-out]"),zoomSlider=$("[data-canvas-zoom-slider]"),zoomValue=$("[data-canvas-zoom-value]");
 function applyCanvasZoom(next,anchorX,anchorY,rerender){var viewport=$("#portal-canvas-viewport"),old=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1));next=Math.max(.25,Math.min(1.5,Math.round(next*100)/100));if(next===old)return;var ax=Number.isFinite(anchorX)?anchorX:(viewport?viewport.clientWidth/2:0),ay=Number.isFinite(anchorY)?anchorY:(viewport?viewport.clientHeight/2:0),cx=viewport?(viewport.scrollLeft+ax)/old:0,cy=viewport?(viewport.scrollTop+ay)/old:0;st.data.preferences.dashboardCanvasZoom=next;window.__kuroCanvasScroll=viewport?{left:Math.max(0,cx*next-ax),top:Math.max(0,cy*next-ay)}:null;if(rerender!==false){persistDisplayPrefs();render();}else{var stage=$("#portal-canvas-stage"),grid=$("#portal-dashboard-grid");if(stage&&grid){var b=getDashboardCanvasBounds();stage.style.width=Math.round(b.width*next)+"px";stage.style.height=Math.round(b.height*next)+"px";grid.style.transform="scale("+next+")";}if(zoomSlider)zoomSlider.value=String(Math.round(next*100));if(zoomValue)zoomValue.textContent=Math.round(next*100)+"%";if(viewport&&window.__kuroCanvasScroll){viewport.scrollLeft=window.__kuroCanvasScroll.left;viewport.scrollTop=window.__kuroCanvasScroll.top;}save();}}
 function changeCanvasZoom(delta){applyCanvasZoom((Number(st.data.preferences.dashboardCanvasZoom)||1)+delta);}
 if(zoomIn)zoomIn.onclick=function(){changeCanvasZoom(.1);};
 if(zoomOut)zoomOut.onclick=function(){changeCanvasZoom(-.1);};
 if(zoomSlider)zoomSlider.oninput=function(){applyCanvasZoom(Number(zoomSlider.value)/100,undefined,undefined,false);};
 var fitCanvas=$("[data-canvas-fit]");
 if(fitCanvas)fitCanvas.onclick=function(){var viewport=$("#portal-canvas-viewport"),ids=getDashboardIds();if(!viewport||!ids.length)return;var minX=Infinity,minY=Infinity,maxX=0,maxY=0;ids.forEach(function(id,i){var p=getDashboardCanvasPosition(id,i),h=Number((st.data.preferences.dashboardHeights||{})[id])||280;minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+p.width);maxY=Math.max(maxY,p.y+h);});var pad=90,availableW=Math.max(100,viewport.clientWidth-pad*2),availableH=Math.max(100,viewport.clientHeight-pad*2),fit=Math.min(availableW/Math.max(1,maxX-minX),availableH/Math.max(1,maxY-minY),1.5);fit=Math.max(.25,Math.min(1.5,fit));st.data.preferences.dashboardCanvasZoom=fit;window.__kuroCanvasScroll={left:Math.max(0,(minX+maxX)*fit/2-viewport.clientWidth/2),top:Math.max(0,(minY+maxY)*fit/2-viewport.clientHeight/2)};persistDisplayPrefs();render();};
 var centerCanvas=$("[data-canvas-center]");
 if(centerCanvas)centerCanvas.onclick=function(){var viewport=$("#portal-canvas-viewport");if(!viewport)return;var ids=getDashboardIds(),minX=Infinity,minY=Infinity,maxX=0,maxY=0;ids.forEach(function(id,i){var p=getDashboardCanvasPosition(id,i);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+p.width);maxY=Math.max(maxY,p.y+(Number((st.data.preferences.dashboardHeights||{})[id])||260));});if(!Number.isFinite(minX))return;var z=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1));viewport.scrollLeft=Math.max(0,(minX+maxX)*z/2-viewport.clientWidth/2);viewport.scrollTop=Math.max(0,(minY+maxY)*z/2-viewport.clientHeight/2);};

 if(form)form.onsubmit=function(e){e.preventDefault();var title=$("#portal-custom-link-title").value.trim(),raw=$("#portal-custom-link-url").value.trim(),icon=$("#portal-custom-link-icon").value.trim()||"🔗",href=safeDashboardUrl(raw),links=st.data.preferences.customLinks||[];if(!title||!href){toast("表示名とHTTPS URL・サイト内パス・Slack / Notion / VS Code のアプリURLを入力してください");return;}if(links.length>=16){toast("マイリンクは最大16件です");return;}links.push({id:uuid(),title:title.slice(0,32),href:href,icon:icon.slice(0,8)});st.data.preferences.customLinks=links;var ids=getDashboardIds();if(ids.indexOf("custom")<0)ids.push("custom");st.data.preferences.dashboardWidgets=ids;st.dashboardEditing=true;persistDisplayPrefs();render();toast("マイリンクを追加しました");};
 if(panel)panel.addEventListener("click",function(e){var close=e.target.closest(".portal-editor-close");if(close){restoreDashboardEditor(panel,add);return;}var choice=e.target.closest("[data-widget-toggle]");if(!choice)return;e.preventDefault();e.stopPropagation();var id=choice.dataset.widgetToggle,ids=getDashboardIds();if(ids.indexOf(id)>=0){restoreDashboardEditor(panel,add);var existing=grid&&grid.querySelector('[data-widget-id="'+id+'"]');if(existing){existing.scrollIntoView({behavior:"smooth",block:"center"});existing.classList.add("portal-widget-focus");window.setTimeout(function(){existing.classList.remove("portal-widget-focus");},1400);}toast("この項目はホームに追加済みです");return;}ids.push(id);panel.remove();if(add)add.setAttribute("aria-expanded","false");setDashboardIds(ids);st.dashboardEditing=true;render();toast("ホームに追加しました");});
 if(!grid)return;
 grid.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;
  if(b.hasAttribute("data-dashboard-add-widget")){if(panel){panel.hidden=false;if(add)add.setAttribute("aria-expanded","true");positionDashboardEditor();}return;}
   if(b.dataset.widgetRemove){setDashboardIds(getDashboardIds().filter(function(x){return x!==b.dataset.widgetRemove;}));render();return;}
 });
 
 
 grid.addEventListener("click",function(e){
  var b=e.target.closest("button");if(!b)return;
  if(b.dataset.canvasRotate||b.dataset.canvasFront||b.dataset.canvasBack){
   var id=b.dataset.canvasRotate||b.dataset.canvasFront||b.dataset.canvasBack,ids=getDashboardIds(),positions=st.data.preferences.dashboardCanvasPositions||{},pos=getDashboardCanvasPosition(id,Math.max(0,ids.indexOf(id))),zValues=ids.map(function(x,i){return getDashboardCanvasPosition(x,i).z;});
   if(b.dataset.canvasRotate)pos.rotation=pos.rotation>=165?-180:pos.rotation+15;
   if(b.dataset.canvasFront)pos.z=Math.min(999,Math.max.apply(null,zValues)+1);
   if(b.dataset.canvasBack)pos.z=Math.max(1,Math.min.apply(null,zValues)-1);
   saveDashboardCanvasPosition(id,pos);persistDisplayPrefs();render();return;
  }
  if(b.hasAttribute("data-smart-add")){addSmartDashboardLink();return;}
  if(b.hasAttribute("data-group-add")){addDashboardLinkGroup();return;}
  if(b.dataset.groupOpen){openDashboardLinkGroup(b.dataset.groupOpen);return;}
  if(b.dataset.groupDelete){var groups=st.data.preferences.linkGroups||[];st.data.preferences.linkGroups=groups.filter(function(x){return x.id!==b.dataset.groupDelete;});persistDisplayPrefs();render();return;}
  if(b.hasAttribute("data-qr-generate")){generateDashboardQr();return;}
  if(b.hasAttribute("data-todo-add")){addDashboardTodo();return;}
  if(b.dataset.todoDelete){st.data.preferences.todos=(st.data.preferences.todos||[]).filter(function(x){return x.id!==b.dataset.todoDelete;});persistDisplayPrefs();render();return;}
  if(b.dataset.pomoMode){setPomodoroMode(b.dataset.pomoMode);return;}
  if(b.hasAttribute("data-pomo-start")){startPomodoro();return;}
  if(b.hasAttribute("data-pomo-pause")){pausePomodoro();return;}
  if(b.hasAttribute("data-pomo-reset")){resetPomodoro();return;}
  if(b.hasAttribute("data-countdown-save")){saveDashboardCountdown();return;}
  if(b.hasAttribute("data-calc-run")){runDashboardCalculator();return;}
  if(b.hasAttribute("data-color-copy")){copyDashboardColor();return;}
  if(b.hasAttribute("data-photo-save")){saveDashboardPhoto();return;}
  if(b.hasAttribute("data-media-save")){saveDashboardMedia();return;}
  if(b.hasAttribute("data-rss-add")){addDashboardRssFeed();return;}
  if(b.dataset.rssDelete){st.data.preferences.rssFeeds=(st.data.preferences.rssFeeds||[]).filter(function(x){return x.id!==b.dataset.rssDelete;});persistDisplayPrefs();render();return;}
  if(b.dataset.rssRefresh){loadDashboardRssFeed(b.dataset.rssRefresh,true);return;}
 });
 grid.addEventListener("submit",function(e){if(e.target.matches("[data-site-search-form]")){e.preventDefault();runDashboardSearch();}});
 grid.addEventListener("change",function(e){
  var t=e.target;
  if(t.matches("[data-todo-toggle]")){var list=st.data.preferences.todos||[];list.forEach(function(x){if(x.id===t.dataset.todoToggle)x.done=t.checked;});st.data.preferences.todos=list;persistDisplayPrefs();render();return;}
  if(t.matches("[data-color-value]")){var code=grid.querySelector("[data-color-hex]");if(code)code.textContent=t.value;return;}
 });
 grid.addEventListener("input",function(e){
  var t=e.target;
  if(t.matches("[data-quick-note]")){var preview=grid.querySelector("[data-note-preview]");if(preview)preview.innerHTML=t.value?dashboardSafeMarkdown(t.value):"プレビューはここに表示されます";clearTimeout(window.kuroNoteSaveTimer);window.kuroNoteSaveTimer=setTimeout(function(){st.data.preferences.quickNote=t.value;persistDisplayPrefs();},600);}
  if(t.matches("[data-color-value]")){var code=grid.querySelector("[data-color-hex]");if(code)code.textContent=t.value;}
 });
 (st.data.preferences.rssFeeds||[]).forEach(function(feed){if(feed&&feed.id)loadDashboardRssFeed(feed.id,false);});
 updateDashboardWorldClocks();updateDashboardCountdown();updatePomodoroClock();
 if(!window.kuroWorldClockTimer)window.kuroWorldClockTimer=setInterval(updateDashboardWorldClocks,15000);
 if(!window.kuroCountdownTimer)window.kuroCountdownTimer=setInterval(updateDashboardCountdown,1000);
 if(!window.kuroPomodoroTimer)window.kuroPomodoroTimer=setInterval(updatePomodoroClock,250);

 var drag=null,resize=null,canvasDrag=null;
 function finishPointer(){
  if(canvasDrag){
   var r=canvasDrag;canvasDrag=null;
   r.item.classList.remove("canvas-dragging");
   var positions=st.data.preferences.dashboardCanvasPositions||{},pos=getDashboardCanvasPosition(r.id,Math.max(0,getDashboardIds().indexOf(r.id)));
   pos.x=Math.round(r.x);pos.y=Math.round(r.y);saveDashboardCanvasPosition(r.id,pos);
   persistDisplayPrefs();render();return;
  }
  if(drag){
   var ids=Array.from(grid.querySelectorAll("[data-widget-id]")).map(function(x){return x.dataset.widgetId;});
   grid.querySelectorAll(".drag-active").forEach(function(x){x.classList.remove("drag-active");});
   drag=null;setDashboardIds(ids);render();return;
  }
  if(resize){
   var r=resize;resize=null;r.item.classList.remove("resizing");
   if(r.placeholder&&r.placeholder.parentNode)r.placeholder.parentNode.removeChild(r.placeholder);
   r.item.style.position="";r.item.style.left="";r.item.style.top="";r.item.style.width="";r.item.style.zIndex="";
   var sizes=st.data.preferences.dashboardSizes||{};sizes[r.id]=r.size;st.data.preferences.dashboardSizes=sizes;
   var spans=st.data.preferences.dashboardSpans||{};spans[r.id]=r.span;st.data.preferences.dashboardSpans=spans;
   var heights=st.data.preferences.dashboardHeights||{};if(r.height!==null)heights[r.id]=Math.round(r.height);st.data.preferences.dashboardHeights=heights;
   persistDisplayPrefs();render();
  }
 }
 function moveBeforePoint(x,y){
  var over=document.elementFromPoint(x,y),target=over&&over.closest("[data-widget-id]");
  if(!target||target.dataset.widgetId===drag.id||!grid.contains(target))return;
  var moving=grid.querySelector('[data-widget-id="'+drag.id+'"]');if(!moving)return;
  var r=target.getBoundingClientRect(),sameRow=y>=r.top&&y<=r.bottom;
  var after=sameRow?x>r.left+r.width/2:y>r.top+r.height/2;
  if(after){if(target.nextElementSibling!==moving)grid.insertBefore(moving,target.nextElementSibling);}
  else if(target!==moving.nextElementSibling){grid.insertBefore(moving,target);}
 }
 function applyResize(x,y){
  if(!resize)return;
  var dx=x-resize.startX,dy=y-resize.startY,dir=resize.dir;
  var cols=resize.gridColumns||12,gap=resize.gridGap||0,track=(resize.gridWidth-gap*(cols-1))/cols;
  if(dir.indexOf("e")>=0||dir.indexOf("w")>=0){
   var delta=dir.indexOf("w")>=0?-dx:dx,step=track+gap,maxSpan=Math.max(2,Math.min(12,cols)),minSpan=Math.min(2,maxSpan);
   resize.span=Math.max(minSpan,Math.min(maxSpan,resize.startSpan+Math.round(delta/step)));
   resize.size=resize.span<=4?"small":resize.span<=6?"half":resize.span<=9?"wide":"full";
   var width=resize.span*track+(resize.span-1)*gap;
   resize.item.style.width=Math.max(0,width)+"px";
   if(dir.indexOf("w")>=0)resize.item.style.left=Math.max(0,resize.startLeft+resize.startWidth-width)+"px";
   resize.item.dataset.span=String(resize.span);resize.item.dataset.size=resize.size;
  }
  if(dir.indexOf("n")>=0||dir.indexOf("s")>=0){
   var hdelta=dir.indexOf("n")>=0?-dy:dy;
   resize.height=Math.max(160,Math.min(900,resize.startHeight+hdelta));
   resize.item.style.height=Math.round(resize.height)+"px";
   if(dir.indexOf("n")>=0)resize.item.style.top=Math.max(0,resize.startTop+resize.startHeight-resize.height)+"px";
  }
 }
 grid.addEventListener("pointerdown",function(e){
  if(grid.classList.contains("is-canvas")){
   if(!st.dashboardEditing)return;
   var canvasItem=e.target.closest("[data-widget-id]");
   if(!canvasItem||!grid.contains(canvasItem)||e.target.closest("button,a,input,select,textarea,[contenteditable=true]"))return;
   e.preventDefault();e.stopPropagation();
   var ids=getDashboardIds(),id=canvasItem.dataset.widgetId,position=getDashboardCanvasPosition(id,Math.max(0,ids.indexOf(id))),zoom=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1));
   canvasDrag={id:id,item:canvasItem,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:position.x,y:position.y,zoom:zoom};
   canvasItem.classList.add("canvas-dragging");
   try{grid.setPointerCapture(e.pointerId);}catch(err){}
   return;
  }
  if(!st.dashboardEditing)return;
  var item=e.target.closest("[data-widget-id]");
  if(!item||!grid.contains(item)||e.target.closest("[data-widget-remove]"))return;
  var handle=e.target.closest("[data-resize-dir]");
  if(handle&&item.contains(handle)){
   e.preventDefault();e.stopPropagation();
   var current=item.dataset.size||"half",rect=grid.getBoundingClientRect(),itemRect=item.getBoundingClientRect(),gridStyle=getComputedStyle(grid);
   var cols=Math.max(1,gridStyle.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length),gap=parseFloat(gridStyle.columnGap)||0;
   var savedHeight=(st.data.preferences.dashboardHeights||{})[item.dataset.widgetId],savedSpan=Number((st.data.preferences.dashboardSpans||{})[item.dataset.widgetId]),baseSpan=savedSpan>=3&&savedSpan<=12?savedSpan:({small:4,half:6,wide:8,full:12}[current]||6);
   baseSpan=Math.max(Math.min(2,cols),Math.min(baseSpan,cols));
   var placeholder=document.createElement("div");
   placeholder.className="portal-widget-resize-placeholder";
   placeholder.style.gridColumn=getComputedStyle(item).gridColumn;
   placeholder.style.height=Math.round(itemRect.height)+"px";
   placeholder.style.minHeight="160px";
   grid.insertBefore(placeholder,item);
   var startLeft=itemRect.left-rect.left,startTop=itemRect.top-rect.top;
   resize={id:item.dataset.widgetId,item:item,placeholder:placeholder,dir:handle.dataset.resizeDir,startX:e.clientX,startY:e.clientY,startSpan:baseSpan,span:baseSpan,size:current,gridWidth:rect.width,gridColumns:cols,gridGap:gap,startHeight:Number(savedHeight)||itemRect.height,height:null,startLeft:startLeft,startTop:startTop,startWidth:itemRect.width,pointerId:e.pointerId};
   item.style.position="absolute";item.style.left=startLeft+"px";item.style.top=startTop+"px";item.style.width=itemRect.width+"px";item.style.zIndex="130";
   item.classList.add("resizing");
  }else{
   if(e.target.closest("button,a,input,select,textarea,[contenteditable=true],[data-resize-dir]"))return;
   e.preventDefault();e.stopPropagation();
   drag={id:item.dataset.widgetId,pointerId:e.pointerId};item.classList.add("drag-active");
  }
  try{grid.setPointerCapture(e.pointerId);}catch(err){}
 });
 grid.addEventListener("pointermove",function(e){
  if(canvasDrag&&e.pointerId===canvasDrag.pointerId){
   e.preventDefault();
   var p=canvasDrag,zoom=p.zoom;
   p.x=Math.max(0,Math.min(getDashboardCanvasBounds().width-p.item.offsetWidth,p.x+(e.clientX-p.startX)/zoom));
   p.y=Math.max(0,Math.min(getDashboardCanvasBounds().height-p.item.offsetHeight,p.y+(e.clientY-p.startY)/zoom));
   p.startX=e.clientX;p.startY=e.clientY;
   p.item.style.left=Math.round(p.x)+"px";p.item.style.top=Math.round(p.y)+"px";
  }else if(drag&&e.pointerId===drag.pointerId){e.preventDefault();moveBeforePoint(e.clientX,e.clientY);}
  else if(resize&&e.pointerId===resize.pointerId){e.preventDefault();applyResize(e.clientX,e.clientY);}
 },{passive:false});
 grid.addEventListener("pointerup",function(e){if((canvasDrag&&e.pointerId===canvasDrag.pointerId)||(drag&&e.pointerId===drag.pointerId)||(resize&&e.pointerId===resize.pointerId))finishPointer();});
 grid.addEventListener("pointercancel",function(e){if((canvasDrag&&e.pointerId===canvasDrag.pointerId)||(drag&&e.pointerId===drag.pointerId)||(resize&&e.pointerId===resize.pointerId))finishPointer();});

 var viewport=$("#portal-canvas-viewport"),stage=$("#portal-canvas-stage");
 if(viewport&&stage){
  var zoom=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1)),bounds=getDashboardCanvasBounds(),workspaceCanvasKey="kuro_canvas_view_"+String(st.data.preferences.activeWorkspace||"personal"),savedView=window.__kuroCanvasScroll;
  if(!savedView){try{savedView=JSON.parse(safeStorageGet("localStorage",workspaceCanvasKey)||"null");}catch(err){}}
  if(savedView&&Number.isFinite(savedView.left)&&Number.isFinite(savedView.top)){viewport.scrollLeft=Math.max(0,savedView.left);viewport.scrollTop=Math.max(0,savedView.top);}
  else{var visibleIds=getDashboardIds(),minX=Infinity,minY=Infinity;visibleIds.forEach(function(id,index){var position=getDashboardCanvasPosition(id,index);minX=Math.min(minX,position.x);minY=Math.min(minY,position.y);});viewport.scrollLeft=Number.isFinite(minX)?Math.max(0,(minX-180)*zoom):900*zoom;viewport.scrollTop=Number.isFinite(minY)?Math.max(0,(minY-180)*zoom):480*zoom;}
  var growing=false;
  function updateCanvasView(){var view={left:viewport.scrollLeft,top:viewport.scrollTop};window.__kuroCanvasScroll=view;try{safeStorageSet("localStorage",workspaceCanvasKey,JSON.stringify(view));}catch(err){}}
  function setCanvasDimensions(){var b=getDashboardCanvasBounds(),z=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1));stage.style.width=Math.round(b.width*z)+"px";stage.style.height=Math.round(b.height*z)+"px";grid.style.width=b.width+"px";grid.style.height=b.height+"px";grid.style.transform="scale("+z+")";}
  viewport.addEventListener("wheel",function(e){if(e.target&&e.target.closest("input,textarea,select,button,a,[contenteditable=true],iframe"))return;e.preventDefault();var current=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1)),factor=Math.exp(-e.deltaY*.0015),next=Math.max(.25,Math.min(1.5,current*factor));applyCanvasZoom(next,e.clientX-viewport.getBoundingClientRect().left,e.clientY-viewport.getBoundingClientRect().top,false);},{passive:false});
  viewport.addEventListener("scroll",updateCanvasView,{passive:true});
  var pan=null;
  viewport.addEventListener("pointerdown",function(e){
   var target=e.target;if(target&&target.nodeType!==1)target=target.parentElement;
   if(e.button!==0||!target||target.closest("[data-widget-id]"))return;
   pan={pointerId:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
   viewport.classList.add("is-panning");try{viewport.setPointerCapture(e.pointerId);}catch(err){}
   e.preventDefault();
  });
  viewport.addEventListener("pointermove",function(e){if(!pan||e.pointerId!==pan.pointerId)return;e.preventDefault();viewport.scrollLeft=pan.left-(e.clientX-pan.x);viewport.scrollTop=pan.top-(e.clientY-pan.y);},{passive:false});
  function finishPan(e){if(!pan||e.pointerId!==pan.pointerId)return;pan=null;viewport.classList.remove("is-panning");}
  viewport.addEventListener("pointerup",finishPan);viewport.addEventListener("pointercancel",finishPan);
 }

 if($("#portal-clock-time")){function tick(){var n=new Date(),t=$("#portal-clock-time"),d=$("#portal-clock-date");if(t)t.textContent=new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(n);if(d)d.textContent=new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(n);}tick();if(!window.kuroClockTimer)window.kuroClockTimer=setInterval(tick,15000);}
 var weatherInput=$("[data-weather-city]"),weatherSearch=$("[data-weather-search]"),weatherEditor=$("[data-weather-editor]"),weatherLocationToggle=$("[data-weather-location-toggle]");
 if(weatherLocationToggle)weatherLocationToggle.onclick=function(){if(!weatherEditor)return;weatherEditor.hidden=!weatherEditor.hidden;if(!weatherEditor.hidden&&weatherInput){weatherInput.focus();weatherInput.select();}};
 if(weatherSearch)weatherSearch.onclick=function(){var value=weatherInput&&weatherInput.value.trim();if(!value){toast("地域名を入力してください");return;}st.data.preferences.weatherCity=value.slice(0,32);persistDisplayPrefs();if(weatherEditor)weatherEditor.hidden=true;loadDashboardWeather(true);};
 if(weatherInput)weatherInput.onkeydown=function(e){if(e.key==="Enter"){e.preventDefault();if(weatherSearch)weatherSearch.click();}};
 var marketSelect=$("[data-market-symbol]");if(marketSelect)marketSelect.onchange=function(){st.data.preferences.marketSymbol=this.value;persistDisplayPrefs();render();};
 if($("#portal-weather-status"))loadDashboardWeather(false);
 if(!window.kuroWeatherTimer)window.kuroWeatherTimer=setInterval(function(){if($("#portal-weather-status"))loadDashboardWeather(true);},900000);
}
function weatherCodeLabel(code){var map={0:"快晴",1:"晴れ",2:"一部くもり",3:"くもり",45:"霧",48:"着氷性の霧",51:"弱い霧雨",53:"霧雨",55:"強い霧雨",56:"弱い着氷性の霧雨",57:"着氷性の霧雨",61:"弱い雨",63:"雨",65:"強い雨",66:"弱い着氷性の雨",67:"着氷性の雨",71:"弱い雪",73:"雪",75:"強い雪",77:"霧雪",80:"にわか雨",81:"雨",82:"強いにわか雨",85:"にわか雪",86:"強いにわか雪",95:"雷雨",96:"ひょうを伴う雷雨",99:"強い雷雨"};return map[Number(code)]||"天気情報";}
function loadDashboardWeather(force){
 var status=$("#portal-weather-status");if(!status)return;
 var city=String(st.data.preferences.weatherCity||"東京").trim().slice(0,32)||"東京";
 if(!force&&window.__kuroWeatherCache&&window.__kuroWeatherCache.city===city&&Date.now()-window.__kuroWeatherCache.time<900000){applyWeatherData(window.__kuroWeatherCache.data);return;}
 var requestId=(window.__kuroWeatherRequestId||0)+1;window.__kuroWeatherRequestId=requestId;window.__kuroWeatherLoading=true;status.textContent=city+"の天気を取得中…";
 var fallbackPlaces={
  "東京":[35.6762,139.6503],"東京都":[35.6762,139.6503],"新宿":[35.6938,139.7034],"新宿区":[35.6938,139.7034],
  "横浜":[35.4437,139.6380],"横浜市":[35.4437,139.6380],"神奈川":[35.4478,139.6425],"神奈川県":[35.4478,139.6425],
  "大阪":[34.6937,135.5023],"大阪府":[34.6937,135.5023],"京都":[35.0116,135.7681],"京都府":[35.0116,135.7681],
  "名古屋":[35.1815,136.9066],"愛知":[35.1802,136.9066],"愛知県":[35.1802,136.9066],
  "札幌":[43.0618,141.3545],"北海道":[43.0618,141.3545],"仙台":[38.2682,140.8694],"宮城":[38.2682,140.8694],
  "さいたま":[35.8617,139.6455],"埼玉":[35.8617,139.6455],"千葉":[35.6074,140.1065],"千葉県":[35.6074,140.1065],
  "神戸":[34.6901,135.1956],"兵庫":[34.6913,135.1830],"兵庫県":[34.6913,135.1830],
  "広島":[34.3853,132.4553],"広島県":[34.3853,132.4553],"福岡":[33.5902,130.4017],"福岡県":[33.5902,130.4017],
  "那覇":[26.2124,127.6809],"沖縄":[26.2124,127.6809],"沖縄県":[26.2124,127.6809],
  "静岡":[34.9756,138.3828],"新潟":[37.9161,139.0364],"金沢":[36.5613,136.6562],"岡山":[34.6551,133.9195],
  "熊本":[32.8031,130.7079],"鹿児島":[31.5966,130.5571],"長野":[36.6513,138.1810],"高松":[34.3428,134.0466],
  "松山":[33.8392,132.7657]
 };
 function knownPlace(){
  var key=city.replace(/[\s　]/g,"");
  if(fallbackPlaces[key])return {name:key,latitude:fallbackPlaces[key][0],longitude:fallbackPlaces[key][1]};
  return null;
 }
 function fetchForecast(place){
  var q="https://api.open-meteo.com/v1/forecast?latitude="+encodeURIComponent(place.latitude)+"&longitude="+encodeURIComponent(place.longitude)+"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1";
  return fetch(q).then(function(r){if(!r.ok)throw new Error("天気データを取得できません");return r.json();}).then(function(data){return {city:place.name||city,data:data};});
 }
 var geo="https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(city)+"&count=10&language=ja&format=json";
 fetch(geo).then(function(r){if(!r.ok)throw new Error("地域検索に失敗しました");return r.json();}).then(function(g){
  if(requestId!==window.__kuroWeatherRequestId)return null;
  var results=Array.isArray(g.results)?g.results:[],place=results.find(function(x){return x.country_code==="JP";})||results[0]||knownPlace();
  if(!place)throw new Error("地域が見つかりませんでした。市区町村名か都道府県名で入力してください");
  return fetchForecast(place);
 }).then(function(result){
  if(!result||requestId!==window.__kuroWeatherRequestId)return;
  window.__kuroWeatherCache={city:city,time:Date.now(),data:result};applyWeatherData(result);
 }).catch(function(err){
  if(requestId!==window.__kuroWeatherRequestId)return;
  var el=$("#portal-weather-status");if(el)el.textContent=err&&err.message?err.message:"天気を読み込めませんでした";
 }).finally(function(){if(requestId===window.__kuroWeatherRequestId)window.__kuroWeatherLoading=false;});
}
function applyWeatherData(result){var data=result&&result.data||{},current=data.current||{},daily=data.daily||{};var put=function(id,value){var el=$("#"+id);if(el)el.textContent=value;};put("portal-weather-status",result.city+" の現在の天気");put("portal-weather-temp",Number.isFinite(current.temperature_2m)?Math.round(current.temperature_2m)+"°":"--°");put("portal-weather-label",weatherCodeLabel(current.weather_code));var scene=$("#portal-weather-scene"),code=Number(current.weather_code),kind=(code===0||code===1)?"sun":code===2?"partly":(code===3||code===45||code===48)?"cloud":(code>=71&&code<=77||code===85||code===86)?"snow":(code>=95)?"storm":(code>=51&&code<=67||code>=80&&code<=82)?"rain":"cloud";if(scene){scene.className="portal-weather-scene weather-state-"+kind;}put("portal-weather-max",daily.temperature_2m_max&&daily.temperature_2m_max.length?Math.round(daily.temperature_2m_max[0])+"°":"--°");put("portal-weather-min",daily.temperature_2m_min&&daily.temperature_2m_min.length?Math.round(daily.temperature_2m_min[0])+"°":"--°");put("portal-weather-rain",daily.precipitation_probability_max&&daily.precipitation_probability_max.length?Math.round(daily.precipitation_probability_max[0])+"%":"--%");}

function addSmartDashboardLink(){
 var input=$("[data-smart-url]"),href=safeDashboardUrl(input&&input.value);if(!href||!/^https:\/\//i.test(href)){toast("HTTPSのURLを入力してください");return;}
 var list=st.data.preferences.smartLinks||[];if(list.some(function(x){return x.href===href;})){toast("このリンクは追加済みです");return;}if(list.length>=20){toast("スマートリンクは最大20件です");return;}
 var fallback={href:href,title:new URL(href).hostname,description:"",image:"",logo:""};list.unshift(fallback);st.data.preferences.smartLinks=list;persistDisplayPrefs();render();
 fetch("https://api.microlink.io/?url="+encodeURIComponent(href)).then(function(r){if(!r.ok)throw new Error("メタデータを取得できません");return r.json();}).then(function(json){
  var data=json&&json.data||{},items=st.data.preferences.smartLinks||[],item=items.find(function(x){return x.href===href;});if(!item)return;
  item.title=String(data.title||item.title).slice(0,140);item.description=String(data.description||"").slice(0,240);var imageUrl=data.image&&data.image.url?safeDashboardUrl(data.image.url):"",logoUrl=data.logo&&data.logo.url?safeDashboardUrl(data.logo.url):"";item.image=imageUrl&&/^https:\/\//i.test(imageUrl)?imageUrl:"";item.logo=logoUrl&&/^https:\/\//i.test(logoUrl)?logoUrl:"";
  persistDisplayPrefs();render();toast("スマートリンクを追加しました");
 }).catch(function(){toast("基本カードを追加しました（詳細情報は取得できませんでした）");});
}
function addDashboardLinkGroup(){
 var titleEl=$("[data-group-title]"),urlsEl=$("[data-group-urls]"),title=titleEl&&titleEl.value.trim(),raw=urlsEl&&urlsEl.value||"",links=raw.split(/\r?\n/).map(function(x){return safeDashboardUrl(x);}).filter(Boolean).slice(0,12);
 if(!title||!links.length){toast("グループ名と有効なURLを入力してください");return;}
 var groups=st.data.preferences.linkGroups||[];if(groups.length>=12){toast("リンクグループは最大12個です");return;}
 groups.push({id:uuid(),title:title.slice(0,32),links:links});st.data.preferences.linkGroups=groups;persistDisplayPrefs();render();toast("リンクグループを作成しました");
}
function openDashboardLinkGroup(id){
 var g=(st.data.preferences.linkGroups||[]).find(function(x){return x.id===id;});if(!g)return;
 var opened=0;(g.links||[]).forEach(function(href){var u=safeDashboardUrl(href);if(!u)return;window.open(u,"_blank","noopener,noreferrer");opened++;});
 toast(opened+"件のリンクを開く操作を送りました。ブロックされた場合はポップアップを許可してください");
}
function runDashboardSearch(){
 var q=$("[data-site-search-query]"),engine=$("[data-search-engine]"),word=q&&q.value.trim();if(!word){toast("検索ワードを入力してください");return;}
 var bases={google:"https://www.google.com/search?q=",youtube:"https://www.youtube.com/results?search_query=",amazon:"https://www.amazon.co.jp/s?k=",chatgpt:"https://chatgpt.com/?q="};
 window.open((bases[engine&&engine.value]||bases.google)+encodeURIComponent(word),"_blank","noopener,noreferrer");
}
function generateDashboardQr(){
 var input=$("[data-qr-value]"),value=input&&input.value.trim();if(!value||!/^https:\/\//i.test(value)){toast("HTTPSのURLを入力してください");return;}
 st.data.preferences.qrValue=value;persistDisplayPrefs();render();toast("QRコードを生成しました");
}
function addDashboardTodo(){
 var input=$("[data-todo-text]"),textValue=input&&input.value.trim();if(!textValue){toast("タスクを入力してください");return;}
 var todos=st.data.preferences.todos||[];if(todos.length>=40){toast("ToDoは最大40件です");return;}
 todos.push({id:uuid(),text:textValue.slice(0,100),done:false});st.data.preferences.todos=todos;persistDisplayPrefs();render();
}
function setPomodoroMode(mode){
 var p=st.data.preferences.pomodoroState||{};p.mode=mode==="break"?"break":"work";p.remaining=p.mode==="break"?300:1500;p.endAt=0;p.running=false;st.data.preferences.pomodoroState=p;persistDisplayPrefs();render();
}
function startPomodoro(){
 var p=st.data.preferences.pomodoroState||{mode:"work",remaining:1500};if(p.running)return;
 p.remaining=Math.max(0,Number(p.remaining)||0);if(!p.remaining)p.remaining=p.mode==="break"?300:1500;
 p.endAt=Date.now()+p.remaining*1000;p.running=true;st.data.preferences.pomodoroState=p;persistDisplayPrefs();updatePomodoroClock();
}
function pausePomodoro(){
 var p=st.data.preferences.pomodoroState;if(!p||!p.running)return;
 p.remaining=Math.max(0,Math.ceil((p.endAt-Date.now())/1000));p.endAt=0;p.running=false;st.data.preferences.pomodoroState=p;persistDisplayPrefs();updatePomodoroClock();
}
function resetPomodoro(){
 var p=st.data.preferences.pomodoroState||{mode:"work"};p.remaining=p.mode==="break"?300:1500;p.endAt=0;p.running=false;st.data.preferences.pomodoroState=p;persistDisplayPrefs();render();
}
function updatePomodoroClock(){
 var p=st.data&&st.data.preferences&&st.data.preferences.pomodoroState;if(!p)return;
 if(p.running&&p.endAt&&Date.now()>=p.endAt){p.running=false;p.remaining=0;p.endAt=0;persistDisplayPrefs();}
 var remain=p.running?Math.max(0,Math.ceil((p.endAt-Date.now())/1000)):Math.max(0,Number(p.remaining)||0);
 var t=$("#portal-pomo-time"),status=$("#portal-pomo-status");if(t)t.textContent=dashboardFormatTime(remain);
 if(status)status.textContent=remain===0?"時間です":p.running?"計測中":p.mode==="break"?"休憩モード":"作業モード";
}
function updateDashboardWorldClocks(){
 document.querySelectorAll("[data-worldclock]").forEach(function(el){try{el.textContent=new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:el.dataset.worldclock}).format(new Date());}catch(e){}});
}
function saveDashboardCountdown(){
 var input=$("[data-countdown-input]"),value=input&&input.value;if(!value){toast("目標日時を設定してください");return;}
 var date=new Date(value);if(Number.isNaN(date.getTime())){toast("日時を確認してください");return;}
 st.data.preferences.countdownTarget=value;persistDisplayPrefs();updateDashboardCountdown();toast("カウントダウンを設定しました");
}
function updateDashboardCountdown(){
 var el=$("#portal-countdown-display");if(!el)return;var raw=st.data.preferences.countdownTarget;if(!raw){el.textContent="日時を設定してください";return;}
 var target=new Date(raw).getTime();if(!Number.isFinite(target)){el.textContent="日時を確認してください";return;}
 var diff=target-Date.now();if(diff<=0){el.textContent="予定の時刻になりました";return;}
 var days=Math.floor(diff/86400000),hours=Math.floor(diff%86400000/3600000),minutes=Math.floor(diff%3600000/60000),seconds=Math.floor(diff%60000/1000);
 el.textContent=days+"日 "+hours+"時間 "+minutes+"分 "+seconds+"秒";
}
function runDashboardCalculator(){
 var a=$("[data-calc-a]"),b=$("[data-calc-b]"),op=$("[data-calc-op]"),out=$("[data-calc-result]");if(!a||!b||!op||!out)return;
 var x=Number(a.value),y=Number(b.value),v;if(!Number.isFinite(x)||!Number.isFinite(y)){out.textContent="数値を入力してください";return;}
 if(op.value==="+")v=x+y;else if(op.value==="-")v=x-y;else if(op.value==="*")v=x*y;else{if(y===0){out.textContent="0では割れません";return;}v=x/y;}
 out.textContent=Number.isFinite(v)?String(Number(v.toPrecision(12))):"計算できません";
}
function copyDashboardColor(){
 var input=$("[data-color-value]"),value=input&&input.value;if(!value)return;
 var done=function(){toast("カラーコードをコピーしました");};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(value).then(done).catch(function(){toast(value);});else toast(value);
}
function saveDashboardPhoto(){
 var input=$("[data-photo-url]"),url=safeDashboardUrl(input&&input.value);if(!url||!/^https:\/\//i.test(url)){toast("画像のHTTPS URLを入力してください");return;}
 st.data.preferences.photoFrameUrl=url;persistDisplayPrefs();render();toast("フォトフレームを更新しました");
}
function saveDashboardMedia(){
 var input=$("[data-media-url]"),raw=input&&input.value.trim(),embed=raw&&dashboardMediaEmbed(raw);if(!embed){toast("対応するYouTubeまたはSpotifyのURLを入力してください");return;}
 st.data.preferences.mediaEmbedUrl=raw;persistDisplayPrefs();render();toast("メディアを埋め込みました");
}
function addDashboardRssFeed(){
 var input=$("[data-rss-url]"),url=safeDashboardUrl(input&&input.value);if(!url||!/^https:\/\//i.test(url)){toast("HTTPSのRSS / Atom URLを入力してください");return;}
 var feeds=st.data.preferences.rssFeeds||[];if(feeds.some(function(x){return x.url===url;})){toast("このフィードは登録済みです");return;}if(feeds.length>=8){toast("RSSは最大8件です");return;}
 var id=uuid();feeds.push({id:id,url:url,title:new URL(url).hostname});st.data.preferences.rssFeeds=feeds;persistDisplayPrefs();render();
}
function loadDashboardRssFeed(id,force){
 var feed=(st.data.preferences.rssFeeds||[]).find(function(x){return x.id===id;});if(!feed)return;
 var box=$("#rss-items-"+id);if(box)box.textContent="読み込み中…";
 var cache=window.__kuroRssCache||(window.__kuroRssCache={}),entry=cache[id];
 if(!force&&entry&&Date.now()-entry.at<300000){if(box)box.innerHTML=entry.html;if(entry.title)feed.title=entry.title;return;}
 fetch("/api/workspace-rss?url="+encodeURIComponent(feed.url)).then(function(r){if(!r.ok)throw new Error("フィードを取得できません（"+r.status+"）");return r.text();}).then(function(xml){
  var doc=new DOMParser().parseFromString(xml,"application/xml");if(doc.querySelector("parsererror"))throw new Error("RSS / Atomの形式を読み取れません");
  var titles=doc.getElementsByTagName("title"),feedTitle=titles.length?String(titles[0].textContent||"").trim().slice(0,100):"";
  var nodes=Array.from(doc.getElementsByTagName("item")).concat(Array.from(doc.getElementsByTagNameNS("*","entry"))).slice(0,6);
  var items=nodes.map(function(n){var titleEl=n.getElementsByTagName("title")[0],linkEl=n.getElementsByTagName("link")[0],href=linkEl&&(linkEl.getAttribute("href")||linkEl.textContent.trim()),dateEl=n.getElementsByTagName("pubDate")[0]||n.getElementsByTagName("published")[0]||n.getElementsByTagName("updated")[0];return {title:titleEl?titleEl.textContent.trim():"（タイトルなし）",href:safeDashboardUrl(href),date:dateEl?dateEl.textContent.trim():""};}).filter(function(x){return x.href;});
  var html=items.length?items.map(function(x){return '<a href="'+esc(x.href)+'" target="_blank" rel="noopener noreferrer"><b>'+esc(x.title)+'</b><small>'+esc(x.date)+'</small></a>';}).join(""):'<span>新着記事がありません</span>';
  cache[id]={at:Date.now(),html:html,title:feedTitle};if(feedTitle)feed.title=feedTitle;if(box)box.innerHTML=html;
 }).catch(function(err){if(box)box.textContent=err.message||"フィードを読み込めませんでした";});
}

function updateNetworkStatus(){var e=$("#portal-network-status");if(!e)return;var off=!navigator.onLine,busy=(window.__kuroPendingRequests||0)>0;e.dataset.state=off?"offline":busy?"busy":"online";e.innerHTML='<i></i><span>'+(off?"オフライン":busy?"通信中":"オンライン")+'</span>';e.title=off?"ネットワーク未接続":busy?"データを読み込み中":"通信できます";}
function showErrorPanel(t,m){var p=$("#portal-error-panel");if(!p)return;$("#portal-error-title").textContent=t;$("#portal-error-message").textContent=m;p.hidden=false;}
function initGlobalUI(){
 if(!$("#portal-plan-style")){var planStyle=document.createElement("style");planStyle.id="portal-plan-style";planStyle.textContent=".portal-plan-card{display:grid;gap:12px;margin:18px 0;padding:clamp(18px,3vw,28px);border:1px solid var(--portal-border,rgba(120,130,150,.25));border-radius:18px;background:var(--portal-card,rgba(255,255,255,.8))}.portal-plan-card.portal-plan-pro{border-color:rgba(119,101,210,.42);background:linear-gradient(135deg,rgba(119,101,210,.10),var(--portal-card,rgba(255,255,255,.9)) 58%)}.portal-plan-top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.portal-plan-top h2{margin:5px 0}.portal-plan-pill{display:inline-flex;align-items:center;padding:6px 11px;border-radius:99px;background:#e9e4ff;color:#51409a;font-size:12px;font-weight:800}.portal-plan-pill.free{background:var(--portal-surface-2,rgba(120,130,150,.13));color:inherit}.portal-plan-meta{display:flex;justify-content:space-between;gap:12px;max-width:420px;padding:12px 0;border-top:1px solid var(--portal-border,rgba(120,130,150,.2));border-bottom:1px solid var(--portal-border,rgba(120,130,150,.2))}.portal-plan-features{display:flex;flex-wrap:wrap;gap:8px}.portal-plan-features span{padding:7px 10px;border-radius:9px;background:var(--portal-surface-2,rgba(120,130,150,.10));font-size:12px}.portal-member-welcome{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:20px;border-radius:16px;background:var(--portal-surface-2,rgba(120,130,150,.08))}.portal-member-welcome h2{margin:5px 0}.portal-member-welcome p{margin:0;color:var(--portal-muted)}.portal-header-plan-badge{display:inline-flex;align-items:center;justify-content:center;min-width:48px;height:27px;padding:0 10px;margin-left:10px;border:1px solid var(--portal-border,rgba(120,130,150,.28));border-radius:8px;background:var(--portal-surface-2,rgba(120,130,150,.08));color:var(--portal-muted,#667085);font-size:10px;font-weight:850;letter-spacing:.08em;text-decoration:none;flex:0 0 auto;transition:background .18s,border-color .18s,color .18s}.portal-header-plan-badge.is-pro{background:rgba(119,101,210,.13);border-color:rgba(119,101,210,.45);color:#6652b5}.portal-header-plan-badge.is-guest{opacity:.75}@media(max-width:700px){.portal-header-plan-badge{height:24px;min-width:42px;padding:0 7px;margin-left:7px;font-size:9px}}";document.head.appendChild(planStyle);}
 if(!$("#portal-notification-style")){var style=document.createElement("style");style.id="portal-notification-style";style.textContent=".portal-header-notification{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid var(--portal-border,rgba(120,130,150,.25));border-radius:12px;background:var(--portal-card,rgba(255,255,255,.75));color:inherit;text-decoration:none;font-size:19px;margin-right:8px;flex:0 0 auto}.portal-header-notification.has-unread{border-color:var(--portal-accent,#7865dc)}.portal-header-notification-count{position:absolute;right:-5px;top:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#e5484d;color:white;font-size:10px;font-weight:800;line-height:17px;text-align:center}.portal-request-notification-list{display:grid;gap:10px}.portal-request-notification{position:relative;display:flex;gap:12px;align-items:flex-start;padding:16px;border:1px solid var(--portal-border,rgba(120,130,150,.2));border-radius:14px;background:var(--portal-card,rgba(255,255,255,.72))}.portal-request-notification.is-unread{border-color:var(--portal-accent,#7865dc);background:var(--portal-accent-soft,rgba(120,100,220,.07))}.portal-request-notification-mark{width:36px;height:36px;flex:0 0 36px;border-radius:11px;display:grid;place-items:center;background:var(--portal-accent-soft,rgba(120,100,220,.12));font-size:18px}.portal-request-notification-body{min-width:0;flex:1}.portal-request-notification-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.portal-request-notification-top time,.portal-request-notification-body small{font-size:12px;opacity:.7}.portal-request-notification-body p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.portal-request-notification-body small{display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:10px}.portal-request-notification-dot{width:8px;height:8px;border-radius:50%;background:#e5484d;flex:0 0 8px;margin-top:6px}.portal-notification-note{font-size:13px;opacity:.75}.portal-request-notification-body .portal-btn{margin:5px 6px 0 0}@media(max-width:700px){.portal-header-notification{width:34px;height:34px;margin-right:4px}.portal-request-notification{padding:12px;gap:9px}.portal-request-notification-top{display:grid;gap:4px}}";document.head.appendChild(style);}
 var h=$(".portal-header-inner");
 if(h){var brand=$(".portal-brand",h);if(brand)updateHeaderPlanBadge();if(brand&&!$("#portal-back-button")){var back=document.createElement("button");back.id="portal-back-button";back.className="portal-back-button";back.type="button";back.textContent="← 戻る";back.onclick=function(){var prev;try{prev=new URL(document.referrer);}catch(e){}if(history.length>1&&prev&&prev.origin===location.origin)history.back();else location.href="/";};h.insertBefore(back,brand);}
 if(!$("#portal-notification-bell")){var bell=document.createElement("a");bell.id="portal-notification-bell";bell.className="portal-header-notification";bell.href="/notifications/";bell.innerHTML="♧ <span id=\"portal-notification-badge\" class=\"portal-header-notification-count\" hidden>0</span>";bell.setAttribute("aria-label","お知らせ");var accountForBell=$("#portal-account-button",h);if(accountForBell)accountForBell.insertAdjacentElement("afterend",bell);else h.appendChild(bell);}
 if(!$("#portal-quick-button")){var q=document.createElement("button");q.id="portal-quick-button";q.className="portal-quick-button";q.type="button";q.innerHTML="⌕ <span>KURO Quick</span>";q.onclick=openQuick;h.insertBefore(q,$("#portal-transport-button")||null);}
 if(!$("#portal-network-status")){var n=document.createElement("div");n.id="portal-network-status";n.className="portal-network-status";h.insertBefore(n,$("#portal-account-button")||null);}}
 if(!$("#portal-quick-overlay")){var o=document.createElement("div");o.id="portal-quick-overlay";o.className="portal-quick-overlay";o.hidden=true;o.innerHTML='<section class="portal-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-quick-title"><div class="portal-quick-title"><div><span>KURO QUICK</span><b id="portal-quick-title">どこへ移動しますか？</b></div><button type="button" id="portal-quick-close" aria-label="閉じる">×</button></div><input id="portal-quick-input" class="portal-input" type="search" placeholder="サービス・ゲーム・設定を検索…" autocomplete="off"><div id="portal-quick-results" class="portal-quick-results"></div><small class="portal-quick-shortcut">Enterで開く · Escで閉じる · Ctrl + K で起動</small></section>';document.body.appendChild(o);$("#portal-quick-close").onclick=closeQuick;o.addEventListener("click",function(e){if(e.target===o)closeQuick();});var qi=$("#portal-quick-input");qi.oninput=function(){renderQuickResults(qi.value);};qi.onkeydown=function(e){if(e.key==="Enter"){var a=$("#portal-quick-results a");if(a)a.click();}};}
 if(!$("#portal-error-panel")){var p=document.createElement("div");p.id="portal-error-panel";p.className="portal-error-panel";p.hidden=true;p.innerHTML='<div><b id="portal-error-title">通信エラー</b><p id="portal-error-message"></p></div><button type="button" id="portal-error-close">閉じる</button>';document.body.appendChild(p);$("#portal-error-close").onclick=function(){p.hidden=true;};}
 window.addEventListener("online",function(){updateNetworkStatus();$("#portal-error-panel").hidden=true;toast("インターネットに再接続しました");});
 window.addEventListener("offline",function(){updateNetworkStatus();showErrorPanel("オフラインです","インターネットに接続できません。一部機能は通信が戻るまで使えません。端末に保存済みのデータは保持されています。");});
 window.addEventListener("error",function(e){if(e&&e.message){queueUsageEvent("client_error",{error_code:"window_error"});showErrorPanel("ページ内でエラーが発生しました","ページを再読み込みしてください。繰り返す場合はエラー内容をサポートへお知らせください。");}});
 window.addEventListener("unhandledrejection",function(e){var m=String(e&&e.reason&&e.reason.message||e&&e.reason||"");if(!/abort/i.test(m)){queueUsageEvent("client_error",{error_code:"unhandled_rejection"});showErrorPanel("処理に失敗しました","通信状態を確認して再試行してください。問題が続く場合はページを再読み込みしてください。");}});
 bindUsageWidgetTracking();document.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openQuick();}if(e.key==="Escape")closeQuick();});
 document.addEventListener("click",function(e){if(e.target.closest("#portal-quick-results a"))closeQuick();});
 updateNetworkStatus();
}
function openQuick(){var o=$("#portal-quick-overlay");if(!o)return;o.hidden=false;renderQuickResults("");var i=$("#portal-quick-input");if(i){i.value="";i.focus();}}
function closeQuick(){var o=$("#portal-quick-overlay");if(o)o.hidden=true;}
function renderQuickResults(q){var box=$("#portal-quick-results");if(!box)return;var items=catalog.concat([{key:"home",title:"ホーム・ダッシュボード",desc:"自分専用のホーム画面",href:"/",icon:"⌂"},{key:"favorites",title:"お気に入り",desc:"保存したページ",href:"/favorites/",icon:"☆"},{key:"history",title:"閲覧履歴",desc:"最近開いたページ",href:"/history/",icon:"◷"},{key:"notifications",title:"お知らせ",desc:"KURO Labのお知らせ",href:"/notifications/",icon:"♧"},{key:"mypage",title:"マイページ",desc:"アカウントと同期",href:"/mypage/",icon:"◎"},{key:"settings",title:"表示設定",desc:"テーマや表示密度を変更",href:"/settings/",icon:"⚙"},]);var s=String(q||"").toLowerCase().trim(),a=items.filter(function(x){return !s||(x.title+" "+x.desc+" "+(x.tags||"")).toLowerCase().indexOf(s)>=0;}).slice(0,12);box.innerHTML=a.length?a.map(function(x){return '<a href="'+esc(x.href)+'"><span>'+x.icon+'</span><div><b>'+esc(x.title)+'</b><small>'+esc(x.desc)+'</small></div><i>↗</i></a>';}).join(""):'<div class="portal-widget-empty">一致するページがありません。</div>';}

async function init(){st.data=load();guest();applyDisplayPrefs();document.body.dataset.transport="cloudflare";document.title=titles[page][0]+"｜KURO Lab";var md=$('meta[name="description"]');if(md)md.content=titles[page][1];$("#portal-desktop-nav").innerHTML=nav.map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'>'+x[1]+'</a>';}).join("");$("#portal-mobile-nav").innerHTML=nav.filter(function(x){return ["home","search","favorites","notifications","mypage"].indexOf(x[0])>=0;}).map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'><span>'+x[2]+'</span><span>'+x[1]+'</span></a>';}).join("");initLogin();initGlobalUI();render();if(!db){console.error("KURO Supabase SDK could not be loaded");return;}db.auth.onAuthStateChange(function(ev,session){st.user=session?session.user:null;activateUsageTracking(st.user);updateAccountUI();loadKuroId(st.user);startPortalRequestNotificationSync();if(ev==="PASSWORD_RECOVERY"){setRecoveryMode(true);var recoveryModal=$("#portal-login-modal");if(recoveryModal)recoveryModal.hidden=false;}if(ev==="SIGNED_IN"&&st.user)setTimeout(function(){sync(false);},0);refreshProEntitlements().catch(function(){}).then(function(){if(page==="pro-tools")render();});render();});try{var ss=await db.auth.getSession();st.user=ss.data&&ss.data.session?ss.data.session.user:null;activateUsageTracking(st.user);updateAccountUI();loadKuroId(st.user);await refreshProEntitlements().catch(function(){});render();startPortalRequestNotificationSync();if(st.user)sync(false);}catch(authError){console.warn("KURO portal session restore failed",authError);}db.from("portal_announcements").select("id,title,body,href,created_at").eq("published",true).order("created_at",{ascending:false}).limit(20).then(function(a){if(!a.error){st.ann=a.data||[];render();window.dispatchEvent(new Event("kuro:announcements-updated"));}});function recordVisit(item){var h={item_key:item.key,title:item.title,href:item.href,visited_at:new Date().toISOString()},i=st.data.history.findIndex(function(x){return x.item_key===item.key;});if(i>=0)st.data.history.splice(i,1);st.data.history.unshift(h);st.data.history=st.data.history.slice(0,100);save();if(st.user)db.from("portal_history").upsert(Object.assign({user_id:st.user.id},h),{onConflict:"user_id,item_key"});}var item=catalog.find(function(x){return x.href.slice(0,-1)===path;});if(item)recordVisit(item);document.addEventListener("click",function(e){var a=e.target.closest("a[href]");if(!a)return;var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;var destination=catalog.find(function(x){return x.href===u.pathname;});if(destination)recordVisit(destination);});render();}init().catch(function(e){console.error(e);render();});
})();

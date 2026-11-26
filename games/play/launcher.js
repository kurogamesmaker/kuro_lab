

const KURO_CLOUDFLARE_TRANSPORT=true; try{localStorage.setItem("kuro_portal_transport","cloudflare");}catch(_){}
const KURO_CLOUDFLARE_PROXY_URL="https://kurolab.cc.cd/api/cloudflare-relay";
function kuroGameCloudflareClientId(){
 const key="kuro_cloudflare_client_id_gameplay_v1";
 try{let value=localStorage.getItem(key);if(!value){value=crypto.randomUUID();localStorage.setItem(key,value);}return value;}
 catch(_){return "kuro-game-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);}
}
async function kuroCloudflareFetch(input,init){
 const req=new Request(input,init),url=new URL(req.url);
 if(url.origin!=="https://cprvpphlfpmiegjiutjn.supabase.co")return fetch(req);
 const bytes=new Uint8Array(await req.arrayBuffer());let binary="";
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
 const headers={};req.headers.forEach((v,k)=>{headers[k]=v;});
 const proxy=await fetch(KURO_CLOUDFLARE_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:url.pathname+url.search,method:req.method,headers,bodyBase64:bytes.length?btoa(binary):"",clientId:kuroGameCloudflareClientId()})});
 let result;try{result=await proxy.json();}catch(e){throw new Error("Cloudflare中継サーバーの応答を読み取れませんでした");}
 if(!proxy.ok||!result||typeof result.status!=="number")throw new Error(result&&result.error||"Cloudflare中継通信に失敗しました");
 let body=null;if(result.isBinary&&result.bodyBase64){const raw=atob(result.bodyBase64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);body=out;}else if(result.bodyText!==undefined&&![204,205,304].includes(result.status))body=result.bodyText;
 return new Response(body,{status:result.status,headers:result.headers||{"Content-Type":"application/json"}});
}

let kuroGameFrame = null;
let kuroGameFrameGameId = null;
let kuroGameFrameLayout = null;
let kuroGameGuestMode = false;
const kuroGameIsMobileDevice=!!(navigator.userAgentData&&navigator.userAgentData.mobile)||/Android|iPhone|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent)||/iPad/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
window.addEventListener("resize",()=>{if(kuroGameFrameLayout)kuroGameFrameLayout();});
function kuroRouteCloudflareRealtime(client) {
const realtime = client && client.realtime;
if (!realtime) return;
const websocketBase = new URL("/api/realtime/v1", window.location.href);
websocketBase.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const httpBase = new URL("/api/realtime/v1", window.location.href);
// realtime-js appends /websocket itself, and uses httpEndpoint for REST broadcast APIs.
realtime.endPoint = websocketBase.toString().replace(/\/$/, "");
realtime.httpEndpoint = httpBase.toString().replace(/\/$/, "");
}

const kuroGameAuthClient = window.supabase.createClient(
 "https://cprvpphlfpmiegjiutjn.supabase.co",
 "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn",
 {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: kuroCloudflareFetch },
  realtime: { params: { log_level: "info" } }
 }
);
kuroRouteCloudflareRealtime(kuroGameAuthClient);
window.kuroGameAuthClient = kuroGameAuthClient;
let kuroGameAuthPromise = null;
const kuroGameRealtimeChannels = new Map();
kuroGameAuthClient.auth.onAuthStateChange((_event, session) => {
 const active = session && !session.user?.is_anonymous && session.access_token ? session : null;
 kuroGameAuthPromise = Promise.resolve(active);
 kuroGameGuestMode = !active;
 if (active?.access_token) kuroGameAuthClient.realtime.setAuth(active.access_token);
 const prompt = document.getElementById("onlineAuthPrompt");
 if (active && prompt) prompt.hidden = true;
 if (kuroGameFrame?.contentWindow) {
  kuroGameFrame.contentWindow.postMessage({ type: "kuro-account-auth-state", authenticated: !!active }, "*");
 }
});
async function getKuroGameAuthSession() {
 if (!kuroGameAuthPromise) {
  kuroGameAuthPromise = (async () => {
   const { data, error } = await kuroGameAuthClient.auth.getSession();
   if (error) throw error;
   const session = data.session || null;
   // 以前の仕様で作られた匿名セッションはこの端末からサインアウトし、新規作成もしない
   if (session?.user?.is_anonymous) {
    await kuroGameAuthClient.auth.signOut({ scope: "local" }).catch(() => {});
    return null;
   }
   return session?.access_token ? session : null;
  })().catch(error => {
   console.warn("KURO GAMES session check failed; continuing in guest mode:", error);
   return null;
  });
 }
 const session = await kuroGameAuthPromise;
 // ログイン済みユーザーだけRealtimeへJWTを設定する
 if (session?.access_token) kuroGameAuthClient.realtime.setAuth(session.access_token);
 return session;
}

// KURO GAMES activity heartbeat. A browser-local random id is used for guests;
// registered users are deduplicated by account id on the server.
function kuroGameActivityClientId(){
 const key="kuro_games_activity_client_v1";
 const makeId=()=>window.crypto?.randomUUID?.()||("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx").replace(/[xy]/g,ch=>{const n=Math.random()*16|0;return(ch==="x"?n:(n&3|8)).toString(16);});
 try{let value=localStorage.getItem(key);if(!value){value=makeId();localStorage.setItem(key,value);}return value;}
 catch(_){return makeId();}
}
const kuroGameActivityGuestId=kuroGameActivityClientId();
let kuroGameActivityStatus="playing";
let kuroGameActivityOpponent="unknown";
let kuroGameActivityTimer=null;
async function sendKuroGameActivityHeartbeat(){
 const gameId=kuroGameFrameGameId;
 if(!gameId||!kuroGameAuthClient)return;
 try{
  const {error}=await kuroGameAuthClient.functions.invoke("kurogames-activity",{body:{
   action:"heartbeat",gameId,clientSessionId:kuroGameActivityGuestId,
   status:kuroGameActivityStatus,opponentType:kuroGameActivityOpponent
  }});
  if(error)throw error;
 }catch(error){console.debug("[KURO GAMES activity] heartbeat skipped:",error?.message||error);}
}
function setKuroGameActivity(status,opponentType){
 const nextStatus=status==="waiting"?"waiting":"playing";
 const validOpponents=["human","bot","solo","unknown"];
 const nextOpponent=validOpponents.includes(opponentType)?opponentType:(nextStatus==="waiting"?"human":"unknown");
 const changed=nextStatus!==kuroGameActivityStatus||nextOpponent!==kuroGameActivityOpponent;
 kuroGameActivityStatus=nextStatus;kuroGameActivityOpponent=nextOpponent;
 if(changed)void sendKuroGameActivityHeartbeat();
}
function startKuroGameActivity(gameId){
 if(kuroGameActivityTimer)clearInterval(kuroGameActivityTimer);
 kuroGameActivityStatus="playing";kuroGameActivityOpponent="unknown";
 void sendKuroGameActivityHeartbeat();
 kuroGameActivityTimer=setInterval(sendKuroGameActivityHeartbeat,20000);
}

// Durable Object接続チケット専用ブリッジ。通常のゲームメッセージ処理とは独立させる。
window.addEventListener("message", async event => {
 const msg = event.data;
 if (!msg || msg.type !== "kuro-online-ticket-request") return;
 const requestId = msg.requestId;
 const reply = payload => {
  try {
   if (event.source) event.source.postMessage(Object.assign({
    type: "kuro-online-ticket-response",
    requestId: requestId
   }, payload), "*");
  } catch (error) {
   console.error("[UNON ticket relay] response postMessage failed", error);
  }
 };
 const roomId = String(msg.roomId || "");
 if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(requestId)) {
  reply({ error: "ticket_request_id_invalid" });
  return;
 }
 if (!event.source || !kuroGameFrame || event.source !== kuroGameFrame.contentWindow) {
  console.error("[UNON ticket relay] source frame mismatch");
  reply({ error: "ticket_source_frame_mismatch" });
  return;
 }
 if (msg.gameId !== kuroGameFrameGameId) {
  reply({ error: "ticket_game_id_mismatch" });
  return;
 }
 if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) {
  reply({ error: "ticket_room_id_invalid" });
  return;
 }
 try {
  const activeSession = await getKuroGameAuthSession();
  if (!activeSession?.access_token) {
   reply({ error: "KUROアカウントへのログインが必要です。" });
   return;
  }
  const response = await fetch(new URL("/api/online-room/ticket", window.location.origin).href, {
   method: "POST",
   mode: "cors",
   credentials: "omit",
   cache: "no-store",
   headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + activeSession.access_token
   },
   body: JSON.stringify({ roomId: roomId, gameId: msg.gameId })
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  console.info("[UNON ticket relay] response", response.status, data.error || "ticket_response");
  reply({ ok: response.ok, status: response.status, data: data, endpoint: new URL("/api/online-room", window.location.origin).href });
 } catch (error) {
  console.error("[UNON ticket relay] fetch failed", error);
  reply({ error: "ticket_fetch_failed: " + String(error && error.message || error).slice(0, 180) });
 }
});
// ---- end UNON ticket bridge ----

window.addEventListener("message", async event => {
 if (!kuroGameFrame || event.source !== kuroGameFrame.contentWindow || !event.data) return;
 const msg = event.data;

 if (msg.type === "kuro-games-activity") {
  if (msg.gameId !== kuroGameFrameGameId) return;
  setKuroGameActivity(msg.status, msg.opponentType);
  return;
 }

 if (msg.type === "kuro-online-login-required") {
  const prompt = document.getElementById("onlineAuthPrompt");
  if (prompt) prompt.hidden = false;
  return;
 }
 if (msg.type === "kuro-online-auth-request" && typeof msg.requestId === "string" && msg.requestId.length <= 100) {
  try {
   const session = await getKuroGameAuthSession();
   event.source.postMessage({
    type: "kuro-online-auth",
    requestId: msg.requestId,
    access_token: session?.access_token || null,
    useCloudflareProxy: KURO_CLOUDFLARE_TRANSPORT,
    user: session?.user ? { id: session.user.id, email: session.user.email ?? null } : null,
    isGuest: !session,
    guestMode: !session || !!kuroGameGuestMode
   }, "*");
  } catch (error) {
   event.source.postMessage({
    type: "kuro-online-auth-error",
    requestId: msg.requestId,
    message: error?.message || "KUROGAMES認証に失敗しました"
   }, "*");
  }
  return;
 }
 if (msg.type === "kuro-online-proxy-request") {
  if (!KURO_CLOUDFLARE_TRANSPORT || typeof msg.requestId !== "string" || msg.requestId.length > 120 ||
      msg.path !== "/functions/v1/kurogames-online" || msg.method !== "POST") return;
  try {
   const activeSession = await getKuroGameAuthSession();
   const bytes = msg.bodyBase64 ? Uint8Array.from(atob(msg.bodyBase64), ch => ch.charCodeAt(0)) : new Uint8Array();
   let action = "";
   try { action = String(JSON.parse(new TextDecoder().decode(bytes)).action || ""); } catch (_) {}
   const isMatchmakingAction=/^(?:unon_|sevens_)?matchmaking_(?:join|status|cancel|ack)$/.test(action);
   if (isMatchmakingAction && /(?:join|status)$/.test(action)) setKuroGameActivity("waiting","human");
   // 公開ランキングの閲覧だけはゲストにも許可。記録・設定変更・セーブ等はログイン必須。
   const publicActions = new Set(["get_config", "leaderboard", "leaderboard_modes", "tictactoe_leaderboard"]);
   if (!activeSession?.access_token && !publicActions.has(action)) {
    const message = "オンライン機能を利用するにはKUROアカウントへのログインが必要です。";
    const prompt = document.getElementById("onlineAuthPrompt");
    if (prompt) prompt.hidden = false;
    const bodyBase64 = btoa(unescape(encodeURIComponent(JSON.stringify({ error: message }))));
    event.source.postMessage({type:"kuro-online-proxy-response",requestId:msg.requestId,response:{status:401,headers:{"content-type":"application/json"},bodyBase64}},"*");
    return;
   }
   const proxyHeaders = new Headers(msg.headers || {});
   proxyHeaders.set("apikey", "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn");
   if (activeSession?.access_token) proxyHeaders.set("Authorization", "Bearer " + activeSession.access_token);
   else proxyHeaders.delete("Authorization");
   const request = new Request("https://cprvpphlfpmiegjiutjn.supabase.co" + msg.path, {
    method: "POST", headers: proxyHeaders, body: bytes
   });
   const response = await kuroCloudflareFetch(request);
   const responseBytes = new Uint8Array(await response.arrayBuffer());
   if (isMatchmakingAction) {
    if (!response.ok) setKuroGameActivity("playing","unknown");
    try {
     const matchResult=JSON.parse(new TextDecoder().decode(responseBytes));
     if (matchResult.status==="matched") setKuroGameActivity("playing","human");
     else if (matchResult.status==="waiting") setKuroGameActivity("waiting","human");
     else if (matchResult.status==="cancelled" || action.endsWith("_cancel")) setKuroGameActivity("playing","unknown");
    } catch (_) {}
   }
   let binary = "";
   for (let i = 0; i < responseBytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, responseBytes.subarray(i, Math.min(i + 0x8000, responseBytes.length)));
   const responseHeaders = {}; response.headers.forEach((value, key) => { responseHeaders[key] = value; });
   event.source.postMessage({ type: "kuro-online-proxy-response", requestId: msg.requestId,
    response: { status: response.status, headers: responseHeaders, bodyBase64: responseBytes.length ? btoa(binary) : "" } }, "*");
  } catch (error) {
   event.source.postMessage({ type: "kuro-online-proxy-response", requestId: msg.requestId, error: error?.message || "Cloudflare中継エラー" }, "*");
  }
  return;
 }
 if (msg.type === "kuro-werewolf-realtime-subscribe") {
  const requestId = msg.requestId;
  const roomCode = msg.roomCode;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) ||
      typeof roomCode !== "string" || !/^\d{4}$/.test(roomCode)) return;
  // Realtime room notifications use Supabase's WebSocket channel directly.
  // REST/API calls still use the Cloudflare relay; the WebSocket channel is separate.
  const previous = kuroGameRealtimeChannels.get(requestId);
  if (previous && previous.source === event.source) {
   kuroGameRealtimeChannels.delete(requestId);
   if (previous.channel) void kuroGameAuthClient.removeChannel(previous.channel);
  }
  try {
   const activeSession = await getKuroGameAuthSession();
   if (!activeSession?.access_token) {
    const prompt = document.getElementById("onlineAuthPrompt");
    if (prompt) prompt.hidden = false;
    throw new Error("オンライン機能を利用するにはKUROアカウントへのログインが必要です。");
   }
   const entry = { source: event.source, channel: null };
   kuroGameRealtimeChannels.set(requestId, entry);
   entry.channel = kuroGameAuthClient
    .channel("kuro-werewolf-" + roomCode + "-" + requestId)
    .on("postgres_changes", {
     event: "*", schema: "public", table: "werewolf_rooms", filter: "room_code=eq." + roomCode
    }, payload => {
     if (kuroGameRealtimeChannels.get(requestId) !== entry) return;
     try {
      entry.source.postMessage({
       type: "kuro-werewolf-realtime-event",
       requestId,
       eventType: payload.eventType
      }, "*");
     } catch (_) {}
    })
    .subscribe((status, error) => {
     if (kuroGameRealtimeChannels.get(requestId) !== entry) return;
     const detail = error
      ? [error.message, error.code, error.details, error.hint].filter(Boolean).join(" | ").slice(0, 240)
      : "";
     if (status === "SUBSCRIBED") {
      console.info("[KURO GAMES Realtime] connected", { roomCode });
     } else {
      console.error("[KURO GAMES Realtime]", status, detail || "(詳細なし)", { roomCode });
     }
     try {
      entry.source.postMessage({
       type: "kuro-werewolf-realtime-status",
       requestId,
       status,
       detail
      }, "*");
     } catch (_) {}
     // CHANNEL_ERROR / TIMED_OUT後も購読を保持し、Supabaseクライアントの自動再接続を受け取れるようにする
    });
  } catch (error) {
   try {
    event.source.postMessage({
     type: "kuro-werewolf-realtime-status",
     requestId,
     status: "CHANNEL_ERROR",
     detail: String(error && error.message || error).slice(0, 240)
    }, "*");
   } catch (_) {}
  }
  return;
 }
 if (msg.type === "kuro-werewolf-realtime-unsubscribe") {
  const requestId = msg.requestId;
  if (typeof requestId === "string") {
   const entry = kuroGameRealtimeChannels.get(requestId);
   if (entry && entry.source === event.source) {
    kuroGameRealtimeChannels.delete(requestId);
    if (entry.channel) void kuroGameAuthClient.removeChannel(entry.channel);
   }
  }
  return;
 }
 if (msg.type === "kuro-werewolf-proxy-request") {
  if (!KURO_CLOUDFLARE_TRANSPORT || typeof msg.requestId !== "string" || typeof msg.path !== "string" ||
      (!msg.path.startsWith("/rest/v1/") && !msg.path.startsWith("/auth/v1/") && !msg.path.startsWith("/storage/v1/"))) return;
  try {
   const bytes = msg.bodyBase64 ? Uint8Array.from(atob(msg.bodyBase64), ch => ch.charCodeAt(0)) : new Uint8Array();
   const request = new Request("https://cprvpphlfpmiegjiutjn.supabase.co" + msg.path, {
    method: msg.method || "GET", headers: msg.headers || {},
    body: ["GET","HEAD"].includes(String(msg.method || "GET").toUpperCase()) ? undefined : bytes
   });
   const response = await kuroCloudflareFetch(request);
   const responseBytes = new Uint8Array(await response.arrayBuffer());
   let binary = "";
   for (let i = 0; i < responseBytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, responseBytes.subarray(i, Math.min(i + 0x8000, responseBytes.length)));
   const responseHeaders = {};
   response.headers.forEach((value, key) => { responseHeaders[key] = value; });
   event.source.postMessage({ type: "kuro-werewolf-proxy-response", requestId: msg.requestId,
    response: { status: response.status, headers: responseHeaders, bodyBase64: responseBytes.length ? btoa(binary) : "" } }, "*");
  } catch (error) {
   event.source.postMessage({ type: "kuro-werewolf-proxy-response", requestId: msg.requestId, error: error?.message || "Cloudflare中継エラー" }, "*");
  }
  return;
 }
 if (msg.type === "kuro-werewolf-storage-set" && typeof msg.key === "string" && msg.key.startsWith("werewolf_")) {
  localStorage.setItem("kuro-werewolf-session:" + msg.key, String(msg.value ?? ""));
  return;
 }
 if (msg.type === "kuro-werewolf-storage-remove" && typeof msg.key === "string" && msg.key.startsWith("werewolf_")) {
  localStorage.removeItem("kuro-werewolf-session:" + msg.key);
  return;
 }
 if (msg.type !== "kuro-werewolf-auth-request") return;
 try {
  const session = await getKuroGameAuthSession();
  const storage = {};
  const prefix = "kuro-werewolf-session:";
  for (let i = 0; i < localStorage.length; i++) {
   const key = localStorage.key(i);
   if (key && key.startsWith(prefix)) storage[key.slice(prefix.length)] = localStorage.getItem(key);
  }
  event.source.postMessage({
   type: "kuro-werewolf-auth",
   useCloudflareProxy: KURO_CLOUDFLARE_TRANSPORT,
   access_token: session?.access_token || null,
   refresh_token: session?.refresh_token || null,
   isGuest: !session || !!kuroGameGuestMode,
   guestMode: !session || !!kuroGameGuestMode,
   storage
  }, "*");
 } catch (error) {
  event.source.postMessage({
   type: "kuro-werewolf-auth-error",
   message: error?.message || "Supabase認証に失敗しました"
  }, "*");
 }
});

async function loadKuroGameRewards(gameId, db){const bar=document.getElementById("kuroGameRewardBar"),list=document.getElementById("kuroGameRewardList");if(!bar||!list)return;try{const {data,error}=await db.from("kuro_public_game_rewards").select("mode,reward_amount,reward_label,reward_type,score_tiers,required_cpu_difficulty").eq("game_id",gameId).eq("enabled",true).gt("reward_amount",0);if(error)throw error;const rows=Array.isArray(data)?data.filter(row=>Number(row.reward_amount)>0):[];if(!rows.length){bar.hidden=true;bar.dataset.visible="false";return;}list.replaceChildren();rows.forEach(row=>{const chip=document.createElement("span");chip.className="kuro-game-reward-chip";const label=String(row.reward_label||"クリア報酬").trim().slice(0,42)||"ゲーム報酬";const txt=document.createElement("span");txt.textContent=label;const amount=document.createElement("strong");amount.textContent="+"+Number(row.reward_amount)+" P";chip.append(txt,amount);list.appendChild(chip);});bar.hidden=false;bar.dataset.visible="true";}catch(error){bar.hidden=true;bar.dataset.visible="false";console.warn("[KURO GAMES rewards] config unavailable",error?.message||error);}}
(async function(){
 const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),id=params.get("id");
 
 function fail(message){$("state").innerHTML="<strong>ゲームを開けませんでした</strong>"+message;}
 if(!id||!/^[0-9a-f-]{36}$/i.test(id)){fail("ゲームIDが正しくありません。");return;}
 if(!window.supabase||!window.supabase.createClient){fail("通信ライブラリを読み込めませんでした。");return;}
 try{const db=kuroGameAuthClient;
  const {data,error}=await db.from("game_studio_games").select("title,description,icon,html_content,mobile_html_content").eq("id",id).eq("status","published").maybeSingle();if(error)throw error;if(!data){fail("公開が終了したか、URLが正しくありません。");return;}
  const mobileHtml=String(data.mobile_html_content||"").trim();
  let selectedGameHtml=kuroGameIsMobileDevice&&mobileHtml?data.mobile_html_content:data.html_content;
  if(kuroGameIsMobileDevice&&!/<meta\b(?=[^>]*\bname=["']viewport["'])[^>]*>/i.test(selectedGameHtml)){
   const mobileViewport='<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
   if(/<head\b[^>]*>/i.test(selectedGameHtml))selectedGameHtml=selectedGameHtml.replace(/<head\b[^>]*>/i,match=>match+mobileViewport);
   else if(/<html\b[^>]*>/i.test(selectedGameHtml))selectedGameHtml=selectedGameHtml.replace(/<html\b[^>]*>/i,match=>match+'<head>'+mobileViewport+'</head>');
   else selectedGameHtml='<!doctype html><html lang="ja"><head>'+mobileViewport+'</head><body>'+selectedGameHtml+'</body></html>';
  }
  document.documentElement.dataset.kuroGamesPlatform=kuroGameIsMobileDevice?"mobile":"pc";
  $("gameTitle").textContent=data.title;loadKuroGameRewards(id,db);const gameDescription=String(data.description||"").trim();$("gameDescription").textContent=gameDescription;$("gameDescriptionBox").hidden=!gameDescription;const iconValue=data.icon||"🎮",iconNode=$("gameIcon");if(/^data:image\//i.test(iconValue)||/^https?:\/\//i.test(iconValue)){const img=document.createElement("img");img.src=iconValue;img.alt="";img.style.cssText="width:100%;height:100%;object-fit:cover;border-radius:inherit";iconNode.replaceChildren(img);}else iconNode.textContent=iconValue;$("gameInfo").hidden=false;
  const launchGame=(guest)=>{kuroGameGuestMode=!!guest;
  if(kuroGameIsMobileDevice){document.body.classList.add("mobile-game-mode");const mobileControls=$("mobileGameControls");if(mobileControls)mobileControls.hidden=false;}
  const frame=document.createElement("iframe");frame.className="game-frame";frame.title=data.title;frame.setAttribute("sandbox","allow-scripts allow-forms allow-modals");frame.setAttribute("allow","autoplay; fullscreen");frame.referrerPolicy="no-referrer";
  const frameMeta=String(selectedGameHtml||"").match(/<meta\s+name=["']kuro-game-frame["']\s+content=["'](\d{3,4})x(\d{3,4})["'][^>]*>/i);
  const frameWidth=frameMeta?Math.max(240,Math.min(3840,Number(frameMeta[1]))):960;
   const frameHeight=frameMeta?Math.max(160,Math.min(2160,Number(frameMeta[2]))):540;
   const scaleMeta=String(selectedGameHtml||"").match(/<meta\s+name=["']kuro-game-scale["']\s+content=["'](\d{1,3})["'][^>]*>/i);
   const frameScale=scaleMeta?Math.max(25,Math.min(300,Number(scaleMeta[1])))/100:1;
  const pageWrap=$("gamePageWrap");
  pageWrap.style.width="calc(100% - 28px)";
  pageWrap.style.maxWidth=Math.min(4200,frameWidth*frameScale+28)+"px";
  kuroGameFrameLayout=()=>{
    if(kuroGameIsMobileDevice){
     const viewportWidth=Math.max(1,window.visualViewport?.width||window.innerWidth||390);
     const viewportHeight=Math.max(1,window.visualViewport?.height||window.innerHeight||window.screen?.height||844);
     frame.style.width=viewportWidth+"px";frame.style.height=viewportHeight+"px";frame.style.maxWidth="none";frame.style.maxHeight="none";frame.style.aspectRatio="auto";return;
    }
    const desiredWidth=frameWidth*frameScale;
    const availableWidth=Math.max(1,Math.min(desiredWidth,Math.max(1,(pageWrap.clientWidth||desiredWidth)-2)));
   const scale=availableWidth/frameWidth;
   frame.style.width=availableWidth+"px";
   frame.style.height=Math.round(frameHeight*scale)+"px";
   frame.style.maxWidth="100%";
   frame.style.maxHeight="none";
   frame.style.aspectRatio=frameWidth+" / "+frameHeight;
  };
  frame.addEventListener("load",()=>{
   startKuroGameActivity(id);
   // Notify the mobile shell from the player document. This avoids relying on
   // cross-origin contentDocument access to a sandboxed srcdoc iframe.
   try{window.parent.postMessage({type:"kuro-mobile-game-frame-ready",gameId:String(id)},window.location.origin);}catch(error){console.debug("[KURO GAMES MOBILE] ready signal skipped",error?.message||error);}
  },{once:true});
  kuroGameFrame=frame;kuroGameFrameGameId=id;$("frameWrap").replaceChildren(frame);kuroGameFrameLayout();frame.srcdoc='<script>window.KURO_GAMES_PLATFORM='+JSON.stringify(kuroGameIsMobileDevice?"mobile":"pc")+';window.KURO_GUEST_MODE='+guest+';window.KURO_GAMES_ACTIVITY_GAME_ID='+JSON.stringify(id)+';window.KURO_GAMES_SET_ACTIVITY=function(status,opponentType){window.parent.postMessage({type:"kuro-games-activity",gameId:window.KURO_GAMES_ACTIVITY_GAME_ID,status:status,opponentType:opponentType||"unknown"},"*");};document.addEventListener("click",function(event){var control=event.target&&event.target.closest?event.target.closest("button,[role=button],a"):null;if(!control)return;var label=String(control.innerText||control.textContent||"").trim().toLowerCase();if(label.includes("cpu")||label.includes("bot")||label.includes("ボット")||label.includes("コンピューター")||label.includes("コンピュータ")||label.includes("ai対戦")){window.KURO_GAMES_SET_ACTIVITY("playing","bot");return;}if(label.includes("相手を探す")||label.includes("ランダムマッチ")||label.includes("マッチング")||label.includes("オンライン対戦"))window.KURO_GAMES_SET_ACTIVITY("waiting","human");},true);document.addEventListener("change",function(event){var control=event.target;var label=(String(control&&control.value||"")+" "+String(control&&control.selectedOptions&&control.selectedOptions[0]&&control.selectedOptions[0].textContent||"")).toLowerCase();if(label.includes("cpu")||label.includes("bot")||label.includes("ボット")||label.includes("コンピューター")||label.includes("コンピュータ")||label.includes("ai対戦"))window.KURO_GAMES_SET_ACTIVITY("playing","bot");},true);(function(){var previousMode="";function syncOpponentMode(){var cpu=document.getElementById("modeCpuBtn"),pvp=document.getElementById("modePvpBtn"),game=document.getElementById("gameScreen");if(cpu&&pvp&&game&&!game.classList.contains("hidden")){var mode=cpu.classList.contains("bg-blue-500")?"bot":pvp.classList.contains("bg-blue-500")?"human":"";if(mode&&mode!==previousMode){previousMode=mode;window.KURO_GAMES_SET_ACTIVITY("playing",mode);}}var cpuActors=document.querySelector(".cpu-avatar,.cpu-flight,[data-player-type=bot],[data-opponent=bot]");if(cpuActors&&cpuActors.getClientRects().length){if(previousMode!=="bot"){previousMode="bot";window.KURO_GAMES_SET_ACTIVITY("playing","bot");}}}setInterval(syncOpponentMode,1500);})();window.KURO_GAMES_RECORDS_ENABLED=!window.KURO_GUEST_MODE;window.addEventListener("message",event=>{if(event.source===window.parent&&event.data?.type==="kuro-account-auth-state"){window.KURO_GUEST_MODE=!event.data.authenticated;window.KURO_GAMES_RECORDS_ENABLED=!!event.data.authenticated;}});const isKuroAuthCreation=u=>{const s=String(u);if(s.indexOf("/auth/v1/signup")!==-1)return true;try{const x=new URL(s,location.href);return x.pathname.indexOf("/auth/v1/token")!==-1&&x.searchParams.get("grant_type")==="anonymous";}catch(_){return false;}};const needsKuroAccount=u=>{if(!window.KURO_GUEST_MODE)return false;const s=String(u);return ["/rest/v1/game_scores","/rest/v1/game_saves","/rest/v1/game_online_","/rest/v1/werewolf_rooms","/rest/v1/werewolf_chat_messages","/rest/v1/kuro_game_win_events","/rest/v1/rpc/werewolf_join_room","/rest/v1/rpc/werewolf_update_room","/rest/v1/rpc/kuro_join_online_room","/functions/v1/kurogames-online"].some(p=>s.indexOf(p)!==-1);};const nativeFetch=window.fetch.bind(window);window.fetch=function(input,init){const u=typeof input==="string"?input:(input&&input.url)||"";if(isKuroAuthCreation(u)){try{window.parent.postMessage({type:"kuro-online-login-required",action:"signup"},"*");}catch(_){}return Promise.resolve(new Response(JSON.stringify({error:"ゲーム内で匿名KUROアカウントは作成できません。共通アカウント画面からログインしてください。"}),{status:403,headers:{"Content-Type":"application/json"}}));}if(needsKuroAccount(u)){try{window.parent.postMessage({type:"kuro-online-login-required",action:"online"},"*");}catch(_){}return Promise.resolve(new Response(JSON.stringify({error:"オンライン機能にはKUROアカウントへのログインが必要です。"}),{status:401,headers:{"Content-Type":"application/json"}}));}return nativeFetch(input,init);};const NativeWebSocket=window.WebSocket;window.WebSocket=new Proxy(NativeWebSocket,{construct(target,args,newTarget){if(window.KURO_GUEST_MODE&&String(args[0]||"").indexOf(".supabase.co/realtime/v1")!==-1){try{window.parent.postMessage({type:"kuro-online-login-required",action:"realtime"},"*");}catch(_){}throw new Error("KUROアカウントへのログインが必要です。");}return Reflect.construct(target,args,newTarget);}})'+selectedGameHtml;};
  const session=await getKuroGameAuthSession();launchGame(!session||!!session.user?.is_anonymous);
 }catch(error){fail(error.message||"通信エラーが発生しました。");}
})();


(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 let mode="login";
 const modal=$("kuroAccountModal"),form=$("kuroAccountForm"),identity=$("kuroAccountIdentity"),password=$("kuroAccountPassword");
 function showError(message){$("kuroAccountError").textContent=String(message||"");}
 let gameCosmeticUserId=null,gameCosmeticRequest=0;
function kuroGameAvatarDisplayUrl(value){
 const raw=String(value||"").trim();if(!raw)return "";
 try{const url=new URL(raw,location.origin);if(url.origin==="https://cprvpphlfpmiegjiutjn.supabase.co"&&url.pathname.startsWith("/storage/v1/object/public/"))return location.origin+"/api/cloudflare-relay?resource="+encodeURIComponent(url.pathname+url.search);return url.href;}catch(_){return "";}
}
 function renderGameCosmetics(data){
  const avatarHost=$("gameCosmeticAvatar"),effectsHost=$("gameCosmeticEffects"),header=document.querySelector("header.top");
  if(!avatarHost||!effectsHost||!header)return;
  const equipped=Array.isArray(data&&data.equipped)?data.equipped:[];
  const itemFor=slot=>{const row=equipped.find(item=>item.slot===slot);return row&&row.item?row.item:null;};
  const avatar=itemFor("avatar"),frame=itemFor("frame"),background=itemFor("background"),theme=itemFor("theme");
  const profileImage=String(data&&data.profileAvatarUrl||"");
  avatarHost.replaceChildren();
  avatarHost.hidden=!profileImage&&!avatar&&!frame;
  avatarHost.dataset.frame=frame&&["common","rare","epic","legendary"].includes(frame.rarity)?frame.rarity:"";
  const image=profileImage||(avatar&&typeof avatar.image_url==="string"?avatar.image_url:"");
  const safeImage=kuroGameAvatarDisplayUrl(image);
  if(safeImage){
   const img=document.createElement("img");img.src=safeImage;img.alt="";img.loading="lazy";
   img.onerror=()=>{img.remove();avatarHost.textContent=avatar&&avatar.icon||"👤";};
   avatarHost.appendChild(img);
  }else avatarHost.textContent=avatar&&avatar.icon||"👤";
  avatarHost.title=[profileImage?"プロフィール画像":"",avatar&&avatar.name,frame&&frame.name].filter(Boolean).join(" · ");
  effectsHost.replaceChildren();
  const labels=[background,theme].filter(Boolean);
  labels.forEach(item=>{const chip=document.createElement("span");chip.textContent=(item.icon||"✦")+" "+(item.name||"");effectsHost.appendChild(chip);});
  effectsHost.hidden=labels.length===0;
  ["kuro-game-theme-neon","kuro-game-theme-classic","kuro-game-theme-rare","kuro-game-theme-epic","kuro-game-theme-legendary","kuro-game-background-midnight","kuro-game-background-cyber","kuro-game-background-rare","kuro-game-background-epic","kuro-game-background-legendary"].forEach(name=>header.classList.remove(name));
  if(theme&&theme.item_key==="neon-theme")header.classList.add("kuro-game-theme-neon");
  else if(theme&&theme.item_key==="kuro-classic-theme")header.classList.add("kuro-game-theme-classic");
  else if(theme&&["rare","epic","legendary"].includes(theme.rarity))header.classList.add("kuro-game-theme-"+theme.rarity);
  if(background&&background.item_key==="midnight-background")header.classList.add("kuro-game-background-midnight");
  else if(background&&background.item_key==="cyber-background")header.classList.add("kuro-game-background-cyber");
  else if(background&&["rare","epic","legendary"].includes(background.rarity))header.classList.add("kuro-game-background-"+background.rarity);
  if(background&&typeof background.image_url==="string"){
   let image="";
   try{const parsed=new URL(background.image_url,location.origin);if(parsed.protocol==="https:"||parsed.origin===location.origin)image=parsed.href;}catch(_){}
   header.style.backgroundImage=image?'linear-gradient(90deg,rgba(255,255,255,.94),rgba(255,255,255,.8)),url("'+image.replace(/["\\\\]/g,"")+'")':"";
  }else header.style.backgroundImage="";
 }
 async function refreshGameCosmetics(session,force){
  const active=session&&session.access_token&&!session.user?.is_anonymous?session:null;
  if(!active){
   gameCosmeticUserId=null;renderGameCosmetics({equipped:[]});return;
  }
  const userId=active.user&&active.user.id||"";
  if(!userId||(!force&&gameCosmeticUserId===userId))return;
  const request=++gameCosmeticRequest;gameCosmeticUserId=userId;
  try{
   const client=window.kuroGameAuthClient;if(!client)throw new Error("KURO認証クライアントを読み込めませんでした。");
   const [catalogResult,profileResult]=await Promise.all([
    client.functions.invoke("kurogames-store",{body:{action:"catalog"}}),
    client.from("profiles").select("avatar_url").eq("id",userId).maybeSingle()
   ]);
   if(request!==gameCosmeticRequest)return;
   if(catalogResult.error)console.warn("KURO Store cosmetics could not be loaded for game header:",catalogResult.error);
   if(profileResult.error)console.warn("KURO account avatar could not be loaded for game header:",profileResult.error);
   if(catalogResult.data&&catalogResult.data.error)console.warn("KURO Store cosmetics response:",catalogResult.data.error);
   renderGameCosmetics(Object.assign({},catalogResult.data||{equipped:[]},{profileAvatarUrl:profileResult.data&&profileResult.data.avatar_url||""}));
  }catch(error){
   if(request===gameCosmeticRequest){
    gameCosmeticUserId=null;
    console.warn("KURO Store equipped cosmetics could not be loaded in game header:",error);
   }
  }
 }
 function updateAccountButton(){
  const button=$("gameAccountButton");
  if(!button)return;
  const session=kuroGameAuthPromise;
  Promise.resolve(session).then(active=>{
   refreshGameCosmetics(active).catch(()=>{});
   button.textContent=active?.user?.user_metadata?.username||active?.user?.email|| (active?"KUROアカウント":"ログイン / 登録");
   button.title=active?"KURO Lab共通アカウントでログイン中":"KURO Lab共通アカウントでログイン・新規登録";
  }).catch(()=>{button.textContent="ログイン / 登録";});
 }
 function openAccount(){
  if(!modal)return;
  const prompt=$("onlineAuthPrompt");if(prompt)prompt.hidden=true;
  modal.hidden=false;showError("");
  setTimeout(()=>identity?.focus(),30);
 }
 function closeAccount(){if(modal)modal.hidden=true;showError("");}
 function setMode(next){
  mode=next;
  const registering=mode==="register";
  $("kuroAccountTitle").textContent=registering?"KURO共通アカウントを新規作成":"KURO共通アカウントにログイン";
  $("kuroAccountIdentityLabel").textContent=registering?"ユーザーネーム":"ユーザーネーム / メールアドレス";
  identity.placeholder=registering?"3〜24文字のユーザーネーム":"ユーザーネームまたはメールアドレス";
  identity.maxLength=registering?24:254;
  identity.autocomplete="username";
  password.autocomplete=registering?"new-password":"current-password";
  password.minLength=registering?8:1;
  password.maxLength=72;
  $("kuroAccountSubmit").textContent=registering?"共通アカウントを作成":"ログイン";
  $("kuroAccountSwitch").textContent=registering?"ログインに戻る":"新規アカウントを作成";
  $("kuroAccountHint").textContent=registering
   ?"半角英数字と_を使った3〜24文字のユーザーネーム、8〜72文字のパスワードを設定してください。KURO Labと同じ共通アカウントが作成されます。"
   :"既にKURO Labアカウントをお持ちの場合は、同じユーザーネームとパスワードでログインしてください。";
  showError("");
 }
 async function usernameAuth(action,username,pass){
  const response=await kuroCloudflareFetch("https://cprvpphlfpmiegjiutjn.supabase.co/functions/v1/username-auth",{
   method:"POST",
   headers:{"Content-Type":"application/json","apikey":"sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn"},
   body:JSON.stringify({action,username,password:pass})
  });
  let payload={};try{payload=await response.json();}catch(_){}
  if(!response.ok||!payload.session)throw new Error(payload.error||"KURO共通アカウントの認証に失敗しました。");
  const client=window.kuroGameAuthClient;if(!client)throw new Error("KURO認証クライアントを読み込めませんでした。");const applied=await client.auth.setSession({
   access_token:payload.session.access_token,
   refresh_token:payload.session.refresh_token
  });
  if(applied.error)throw applied.error;
  return applied;
 }
 $("gameAccountButton")?.addEventListener("click",openAccount);
 $("onlineAuthOpenAccount")?.addEventListener("click",openAccount);
 $("kuroAccountClose")?.addEventListener("click",closeAccount);
 $("onlineAuthClose")?.addEventListener("click",()=>{const p=$("onlineAuthPrompt");if(p)p.hidden=true;});
 $("kuroAccountSwitch")?.addEventListener("click",()=>setMode(mode==="login"?"register":"login"));
 modal?.addEventListener("click",event=>{if(event.target===modal)closeAccount();});
 document.addEventListener("keydown",event=>{if(event.key==="Escape"&&modal&&!modal.hidden)closeAccount();});
 window.kuroGameAuthClient?.auth?.onAuthStateChange((_event,session)=>{
  const active=session&&!session.user?.is_anonymous&&session.access_token?session:null;
  if(active){closeAccount();const prompt=$("onlineAuthPrompt");if(prompt)prompt.hidden=true;}
  updateAccountButton();
  refreshGameCosmetics(active,true).catch(()=>{});
 });
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)Promise.resolve(kuroGameAuthPromise).then(active=>refreshGameCosmetics(active,true)).catch(()=>{});});
 form?.addEventListener("submit",async event=>{
  event.preventDefault();
  const submit=$("kuroAccountSubmit"),username=identity.value.trim(),pass=password.value;
  submit.disabled=true;showError("");
  try{
   const authClient=window.kuroGameAuthClient;if(!authClient)throw new Error("認証機能を読み込めませんでした。ページを再読み込みしてください。");
   let result;
   if(mode==="register"){
    if(!/^[A-Za-z0-9_]{3,24}$/.test(username))throw new Error("ユーザーネームは半角英数字と_の3〜24文字で入力してください。");
    if(pass.length<8||pass.length>72)throw new Error("パスワードは8〜72文字で入力してください。");
    result=await usernameAuth("register",username,pass);
   }else if(username.includes("@")){
    result=await authClient.auth.signInWithPassword({email:username,password:pass});
    if(result.error)throw result.error;
   }else{
    result=await usernameAuth("login",username,pass);
   }
   const active=result?.data?.session;
   if(active?.user?.is_anonymous)throw new Error("匿名アカウントではログインできません。KURO共通アカウントを使用してください。");
   kuroGameAuthPromise=Promise.resolve(active||null);
   kuroGameGuestMode=!active;
   if(active?.access_token)authClient.realtime.setAuth(active.access_token);
   if(kuroGameFrame?.contentWindow)kuroGameFrame.contentWindow.postMessage({type:"kuro-account-auth-state",authenticated:!!active},"*");
   password.value="";
   closeAccount();
   const prompt=$("onlineAuthPrompt");if(prompt)prompt.hidden=true;
   updateAccountButton();
   if(mode==="register")setMode("login");
  }catch(error){
   console.error("KURO GAMES shared account auth failed",error);
   showError((mode==="register"?"新規登録できませんでした：":"ログインできませんでした：")+(error?.message||"通信エラーが発生しました。"));
  }finally{submit.disabled=false;}
 });
 updateAccountButton();
})();

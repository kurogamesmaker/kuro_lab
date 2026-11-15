
(async function(){
"use strict";
window.__kuroPendingRequests=0;var kuroNativeFetch=window.fetch.bind(window);window.fetch=function(input,init){window.__kuroPendingRequests++;if(typeof updateNetworkStatus==="function")updateNetworkStatus();return kuroNativeFetch(input,init).catch(function(err){if(!navigator.onLine&&typeof showErrorPanel==="function")showErrorPanel("オフラインです","接続を確認してください。端末の保存データは保持されています。");throw err;}).finally(function(){window.__kuroPendingRequests=Math.max(0,window.__kuroPendingRequests-1);if(typeof updateNetworkStatus==="function")updateNetworkStatus();});};
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
var requestedTransport=new URLSearchParams(location.search).get("transport");
// KURO portal defaults to GAS relay. Direct mode is only enabled explicitly.
var useGas=requestedTransport!=="direct";
localStorage.setItem("kuro_portal_transport",useGas?"gas":"direct");
function gasFetch(input,init){
 var req=new Request(input,init),url=new URL(req.url);
 if(url.origin!==SUPABASE_URL)return fetch(req);
 return req.arrayBuffer().then(function(buf){
  var bytes=new Uint8Array(buf),binary="",step=0x8000;
  for(var i=0;i<bytes.length;i+=step)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+step,bytes.length)));
  var headers={};req.headers.forEach(function(v,k){headers[k]=v;});
  return fetch("/api/kuro-gas-proxy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:url.pathname+url.search,method:req.method,headers:headers,bodyBase64:bytes.length?btoa(binary):"",clientId:localStorage.getItem("kuro_portal_guest_id")||"portal-guest"})})
   .then(async function(proxyResponse){
    var result;try{result=await proxyResponse.json();}catch(e){throw new Error("GAS中継サーバーから応答を読み取れませんでした");}
    if(!proxyResponse.ok||!result||typeof result.status!=="number")return new Response(JSON.stringify(result||{message:"GAS proxy error"}),{status:proxyResponse.status||502,headers:{"Content-Type":"application/json"}});
    var responseHeaders=new Headers(result.headers||{}),body=null;
    if(result.isBinary&&result.bodyBase64){var raw=atob(result.bodyBase64),out=new Uint8Array(raw.length);for(var j=0;j<raw.length;j++)out[j]=raw.charCodeAt(j);body=out;}
    else if(result.bodyText!==undefined&&![204,205,304].includes(result.status))body=result.bodyText;
    return new Response(body,{status:result.status,headers:responseHeaders});
   });
 });
}
var db=supabaseReady?window.supabase.createClient(SUPABASE_URL,PUBLISHABLE_KEY,{global:{fetch:useGas?gasFetch:window.fetch},auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}}):null;
console.info("KURO portal transport:",useGas?"GAS relay":"direct");
var S="kuro_portal_v1",G="kuro_portal_guest_id",path=location.pathname.replace(/\/+$/,"")||"/";
var page=path==="/"?"home":path.split("/")[1];
var titles={home:["KURO Lab ポータル","サービス、ゲーム、お知らせにすぐアクセス。"],search:["KURO Lab内を検索","サービス、ゲーム、ガイドをまとめて検索できます。"],notifications:["お知らせ","KURO Labからのお知らせを確認できます。"],mypage:["マイページ","アカウントと利用状況を確認できます。"],favorites:["お気に入り","保存したサービスやゲームを確認できます。"],history:["閲覧履歴","最近開いたサービスやゲームを確認できます。"],achievements:["実績","利用状況に応じた実績を確認できます。"],request:["リクエストBOX","機能やサービスのリクエストを送信できます。"],settings:["設定","ポータルの表示設定を変更できます。"]};
if(!titles[page])page="home";
var catalog=[
{key:"games",type:"service",title:"KURO GAMES",desc:"ブラウザゲームをまとめて遊べるゲームコーナー",href:"/games/",icon:"🎮",tags:"ゲーム ブラウザ 遊ぶ"},
{key:"sns",type:"service",title:"KURO SNS",desc:"投稿・フォロー・チャットでつながるソーシャルサービス",href:"/sns/",icon:"💬",tags:"SNS 投稿 フォロー"},
{key:"chat",type:"service",title:"オープンチャット",desc:"アカウント登録なしで参加できる公開チャット",href:"/chat/",icon:"🗨️",tags:"チャット 会話"},
{key:"sushi",type:"game",title:"回転寿司タイピング",desc:"回転寿司をモチーフにしたタイピングゲーム",href:"/game/kaiten-sushi-typing/",icon:"🍣",tags:"タイピング 寿司"},
{key:"blocks",type:"game",title:"ブロックブラスト",desc:"ブロックを配置してラインを消すパズルゲーム",href:"/game/block-blast/",icon:"🧩",tags:"パズル ブロック"},
{key:"about",type:"page",title:"KURO Labについて",desc:"KURO Labの活動やサービスについて",href:"/about/",icon:"🏢",tags:"紹介 運営"},
{key:"guide",type:"page",title:"使い方ガイド",desc:"各サービスの基本的な使い方",href:"/guide/",icon:"📘",tags:"ガイド ヘルプ"},
{key:"faq",type:"page",title:"よくある質問",desc:"利用時の疑問や困ったときの案内",href:"/faq/",icon:"❔",tags:"質問 ヘルプ"}];
var nav=[["home","ホーム","⌂","/"],["search","検索","⌕","/search/"],["games","ゲーム","▣","/games/"],["sns","SNS","◉","/sns/"],["chat","チャット","☷","/chat/"],["favorites","お気に入り","☆","/favorites/"],["history","履歴","◷","/history/"],["notifications","お知らせ","♧","/notifications/"],["mypage","マイページ","◎","/mypage/"],["settings","設定","⚙","/settings/"]];
var st={user:null,ann:[],data:null,sync:false};window.__kuroPortal={state:st,catalog:catalog,save:save,render:render,sync:sync,toast:toast,openQuick:openQuick,closeQuick:closeQuick,applyDisplayPrefs:applyDisplayPrefs};window.dispatchEvent(new Event("kuro:portal-api-ready"));
function $(s,r){return (r||document).querySelector(s);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fmt(v){try{return new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v));}catch(e){return "";}}
function uuid(){return crypto.randomUUID();}
function guest(){var x=localStorage.getItem(G);if(!x){x=uuid();localStorage.setItem(G,x);}return x;}
function defaults(){return {favorites:[],history:[],preferences:{theme:"light",density:"comfortable",motion:"normal",accent:"violet",background:"aurora",dashboardLayout:"balanced",dashboardWidgets:["shortcuts","games","weather"],dashboardSizes:{},customLinks:[],weatherCity:"東京",marketSymbol:"TVC:NI225",smartLinks:[],linkGroups:[],quickNote:"",todos:[],pomodoroState:{mode:"work",remaining:1500,endAt:0,running:false},countdownTarget:"",photoFrameUrl:"",mediaEmbedUrl:"",rssFeeds:[],qrValue:"",dashboardViewMode:"grid",dashboardCanvasPositions:{},dashboardCanvasBounds:{width:4800,height:3200},dashboardCanvasZoom:1},updatedAt:0};}
function load(){try{var x=JSON.parse(localStorage.getItem(S)||"null"),d=Object.assign(defaults(),x||{});d.preferences=Object.assign(defaults().preferences,x&&x.preferences||{});d.preferences.customLinks=(Array.isArray(d.preferences.customLinks)?d.preferences.customLinks:[]).slice(0,16).map(function(v){var href=safeDashboardUrl(v&&v.href),title=String(v&&v.title||"").trim().slice(0,32);return href&&title?{id:String(v.id||uuid()).slice(0,64),title:title,href:href,icon:String(v.icon||"🔗").slice(0,8)}:null;}).filter(Boolean);d.preferences.dashboardSizes=d.preferences.dashboardSizes&&typeof d.preferences.dashboardSizes==="object"?d.preferences.dashboardSizes:{};return d;}catch(e){return defaults();}}
function save(){st.data.updatedAt=Date.now();localStorage.setItem(S,JSON.stringify(st.data));applyDisplayPrefs();try{window.dispatchEvent(new CustomEvent("kuro:preferences-changed",{detail:st.data.preferences}));}catch(e){}}
function toast(t){var e=$("#portal-toast");e.textContent=t;e.classList.add("show");clearTimeout(window.ptimer);window.ptimer=setTimeout(function(){e.classList.remove("show");},2200);}
function has(k){return st.data.favorites.some(function(x){return x.item_key===k;});}
function favBtn(x){return '<button class="portal-fav" data-fav="'+esc(x.key)+'" aria-pressed="'+has(x.key)+'">'+(has(x.key)?"★ 保存済み":"☆ お気に入り")+'</button>';}
function card(x){return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+x.icon+'</div><div><span class="portal-kicker">'+(x.type==="game"?"GAME":x.type==="page"?"INFO":"SERVICE")+'</span><h3>'+esc(x.title)+'</h3></div></div><p>'+esc(x.desc)+'</p><div class="portal-card-actions"><a class="portal-btn primary small" href="'+x.href+'">開く →</a>'+favBtn(x)+'</div></article>';}
function head(t,d,k){return '<div class="portal-page-heading"><span class="portal-eyebrow">'+(k||"KURO PORTAL")+'</span><h1>'+t+'</h1><p>'+d+'</p></div>';}
function hist(a){if(!a.length)return '<div class="portal-empty"><strong>まだ履歴はありません</strong>サービスやゲームを開くと、ここに表示されます。</div>';return '<div class="portal-list">'+a.map(function(x){return '<div class="portal-list-item"><div class="portal-icon">◷</div><div class="grow"><strong>'+esc(x.title)+'</strong><small>'+fmt(x.visited_at)+'</small></div><a class="portal-btn small" href="'+esc(x.href)+'">開く</a></div>';}).join("")+'</div>';}
function announcements(){if(!st.ann.length)return '<div class="portal-empty"><strong>新しいお知らせはありません</strong>重要なお知らせはここに表示されます。</div>';return '<div class="portal-list">'+st.ann.map(function(a){return '<article class="portal-card portal-announcement"><time>'+fmt(a.created_at)+'</time><h3>'+esc(a.title)+'</h3><p>'+esc(a.body)+'</p>'+(a.href?'<a class="portal-btn small" href="'+esc(a.href)+'">詳しく見る →</a>':"")+'</article>';}).join("")+'</div>';}
function profileSummary(){return st.user?'<p><strong>ログイン中</strong><br>'+esc(st.user.email||"KURO Labアカウント")+'<br>お気に入りや履歴はアカウントに同期されます。</p><a href="/mypage/" class="portal-btn primary small">アカウントを確認 →</a>':'<p>ゲストのままでも利用できます。ログインするとお気に入りや履歴を複数端末で同期できます。</p><a href="/mypage/" class="portal-btn primary small">ログイン・アカウント設定 →</a>';}
function home(){return '<div class="portal-dashboard"><aside class="portal-side"><a class="portal-side-brand" href="/"><img src="/icon-192.png" alt=""><span><b>KURO Lab</b><small>PLAY · CREATE · CONNECT</small></span></a><div class="portal-side-label">MENU</div><a class="portal-side-link active" href="/"><span>⌂</span>ダッシュボード</a><a class="portal-side-link" href="/games/"><span>▣</span>ゲーム</a><a class="portal-side-link" href="/search/"><span>⌕</span>検索</a><a class="portal-side-link" href="/favorites/"><span>☆</span>お気に入り</a><a class="portal-side-link" href="/notifications/"><span>♧</span>お知らせ</a><div class="portal-side-spacer"></div><a class="portal-side-link" href="/about/"><span>ⓘ</span>KURO Labについて</a><a class="portal-side-link" href="/settings/"><span>⚙</span>設定</a><div class="portal-side-support"><a href="/contact/">SUPPORT</a><a href="/chat/">CHAT</a></div></aside><div class="portal-center"><div class="portal-welcome"><div><span class="portal-eyebrow">WELCOME TO KURO LAB</span><h1>好きなことを、<em>ここから。</em></h1><p>ゲームもサービスも、KURO Labの楽しさをひとつの場所に。</p></div><a class="portal-btn primary" href="/games/">ゲームを探す ↗</a></div><div class="portal-feature-row"><a class="portal-feature-card feature-sushi" href="/game/kaiten-sushi-typing/"><span class="portal-feature-tag">PICK UP GAME</span><strong>回転寿司<br>タイピング</strong><small>回して、打って、ハイスコアへ。</small><b class="feature-go">PLAY NOW ↗</b><span class="feature-art">🍣</span></a><a class="portal-feature-card feature-quest" href="/game/block-blast/"><span class="portal-feature-tag">DAILY CHALLENGE</span><strong>ブロックを<br>並べて消そう！</strong><small>今日の気分でパズルに挑戦。</small><b class="feature-go">PLAY NOW ↗</b><span class="feature-art">🧩</span></a></div><div class="portal-section portal-home-games"><div class="portal-section-head"><div><h2>お気に入りのゲームを見つけよう</h2><p>PLAY SOMETHING FUN TODAY</p></div><a class="portal-text-link" href="/games/">すべて見る →</a></div><div class="portal-game-grid"><a class="portal-game-tile tile-sushi" href="/game/kaiten-sushi-typing/"><span class="tile-art">🍣</span><b>回転寿司タイピング</b><small>タイピング · GAME</small></a><a class="portal-game-tile tile-block" href="/game/block-blast/"><span class="tile-art">🧩</span><b>ブロックブラスト</b><small>パズル · GAME</small></a><a class="portal-game-tile tile-sns" href="/sns/"><span class="tile-art">💬</span><b>KURO SNS</b><small>COMMUNITY</small></a><a class="portal-game-tile tile-chat" href="/chat/"><span class="tile-art">🗨️</span><b>オープンチャット</b><small>CHAT</small></a></div></div><div class="portal-section portal-home-bottom"><div class="portal-section-head"><div><h2>KURO Labからのお知らせ</h2><p>WHAT IS NEW</p></div><a class="portal-text-link" href="/notifications/">一覧を見る →</a></div>'+announcements()+'</div></div><aside class="portal-right"><div class="portal-right-section"><div class="portal-right-heading"><b>クイックアクセス</b><span>SHORTCUTS</span></div><a class="portal-quick-link" href="/sns/"><span>💬</span><b>KURO SNS</b><i>↗</i></a><a class="portal-quick-link" href="/chat/"><span>🗨️</span><b>オープンチャット</b><i>↗</i></a><a class="portal-quick-link" href="/request/"><span>✉️</span><b>リクエストBOX</b><i>↗</i></a></div><div class="portal-right-section"><div class="portal-right-heading"><b>最近使ったページ</b><a href="/history/">すべて</a></div>'+hist(st.data.history.slice(0,3))+'</div><div class="portal-right-promo"><span>KURO LAB COMMUNITY</span><b>アイデアを、<br>かたちにしよう。</b><a href="/about/">KURO Labについて ↗</a></div></aside></div>';}

function render(){var m=$("#portal-main");if(m){document.querySelectorAll("#portal-dashboard-editor").forEach(function(panel){if(!m.contains(panel))panel.remove();});}var v={
home:home,
search:function(){return head("KURO Lab内を検索","サービス・ゲーム・ガイドをまとめて検索できます。","DISCOVER")+'<form id="portal-search-form" class="portal-search"><input id="portal-search-input" class="portal-input" type="search" placeholder="例：タイピング、チャット、ゲーム…"><button class="portal-btn primary">検索する</button></form><section class="portal-section"><div id="portal-search-results" class="portal-grid">'+catalog.map(card).join("")+'</div></section>';},
notifications:function(){return head("KURO NOTIFICATIONS","KURO Lab公式のお知らせと、各サービスの通知先をまとめています。","NOTIFICATION CENTER")+announcements()+
'<section class="portal-section portal-notification-channels"><div class="portal-section-head"><div><h2>サービス別の通知</h2><p>通知の種類に応じて、各サービスを確認できます。</p></div></div><div class="portal-notification-channel-grid">'+
'<a class="portal-notification-channel" href="/sns/"><span>💬</span><div><b>KURO SNS</b><small>コメント・返信・フォローなどの通知</small></div><i>↗</i></a>'+
'<a class="portal-notification-channel" href="/chat/"><span>🗨️</span><div><b>KURO CHAT</b><small>チャットの会話を確認</small></div><i>↗</i></a>'+
'</div><p class="portal-notification-note">現在、公式のお知らせはこのページで確認できます。SNS・チャット内の通知や会話は各サービスで確認してください。全サービスの通知を一画面に統合する機能は、今後の拡張項目です。</p></section>';},
favorites:function(){return head("お気に入り","保存したサービスやゲームを確認できます。","YOUR COLLECTION")+(st.data.favorites.length?'<div class="portal-grid">'+st.data.favorites.map(function(x){var c=catalog.find(function(y){return y.key===x.item_key;})||x;return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+(c.icon||"☆")+'</div><h3>'+esc(x.title)+'</h3></div><a class="portal-btn primary small" href="'+esc(x.href)+'">開く →</a> <button class="portal-fav" data-fav="'+esc(x.item_key)+'" aria-pressed="true">★ 保存済み</button></article>';}).join("")+'</div>':'<div class="portal-empty"><strong>お気に入りはまだありません</strong>サービスカードの「お気に入り」から保存できます。</div>');},
history:function(){return head("閲覧履歴","最近開いたサービスやゲームを確認できます。","RECENTLY USED")+hist(st.data.history)+'<div class="portal-card-actions"><button id="portal-clear-history" class="portal-btn small">履歴を消去</button></div>';},
achievements:function(){return head("実績機能の整理","実績機能はホーム画面をシンプルにするため終了しました。お気に入りや履歴は引き続き利用できます。","FEATURE UPDATE") + '<section class="portal-card"><p>保存したサービスはお気に入り、最近開いたページは閲覧履歴から確認できます。</p><div class="portal-card-actions"><a class="portal-btn primary small" href="/">ホームへ戻る</a><a class="portal-btn small" href="/favorites/">お気に入りを見る</a><a class="portal-btn small" href="/history/">閲覧履歴を見る</a></div></section>'},
mypage:function(){return head("マイページ","アカウントと利用状況を確認できます。","MY KURO")+'<section class="portal-card"><h2>アカウント</h2><p>'+(st.user?"ログイン中："+esc(st.user.email||"アカウント"):"ゲストとして利用中。この端末にデータを保存しています。")+'</p><p class="portal-muted">ログインするとゲストデータとアカウントデータを統合します。</p><div class="portal-card-actions">'+(st.user?'<button id="portal-sync-now" class="portal-btn primary">今すぐ同期</button><button id="portal-signout" class="portal-btn">ログアウト</button>':'<button id="portal-open-login" class="portal-btn primary">ログイン・新規登録</button>')+'</div></section><section class="portal-section"><div class="portal-grid"><article class="portal-card"><h3>'+st.data.favorites.length+' 件</h3><p>お気に入り</p><a class="portal-btn small" href="/favorites/">確認する</a></article><article class="portal-card"><h3>'+st.data.history.length+' 件</h3><p>閲覧履歴</p><a class="portal-btn small" href="/history/">確認する</a></article></div></section>';},
request:function(){return head("リクエストBOX","追加してほしい機能や改善してほしい点を送ってください。","FEEDBACK")+'<form id="portal-request-form" class="portal-form"><div class="portal-field"><label for="portal-request-message">リクエスト内容</label><textarea id="portal-request-message" class="portal-textarea" minlength="5" maxlength="500" required placeholder="追加してほしい機能、改善してほしい点など"></textarea><small>5〜500文字。住所・電話番号・学校名・パスワードなどは書かないでください。</small></div><div style="position:absolute;left:-9999px" aria-hidden="true"><input id="portal-request-website" tabindex="-1"></div><button class="portal-btn primary">リクエストを送信</button><p id="portal-request-status" role="status" class="portal-muted"></p></form>';},
settings:function(){var p=st.data.preferences,t=p.theme||"light",d=p.density||"comfortable",m=p.motion||"normal",a=p.accent||"violet",bg=p.background||"aurora";return head("設定","KURO Labの表示やホーム画面を自分好みに調整できます。","PREFERENCES")+'<section class="portal-card"><div class="portal-settings-row"><div><strong>テーマ</strong><small>ポータル全体のライト・ダークを切り替えます</small></div><select id="portal-theme" class="portal-select"><option value="light" '+(t==="light"?"selected":"") +'>ホワイト</option><option value="dark" '+(t==="dark"?"selected":"") +'>ダーク</option></select></div><div class="portal-settings-row"><div><strong>アクセントカラー</strong><small>ボタンや選択中メニューの色を変更します</small></div><select id="portal-accent" class="portal-select"><option value="violet" '+(a==="violet"?"selected":"") +'>バイオレット</option><option value="blue" '+(a==="blue"?"selected":"") +'>ブルー</option><option value="green" '+(a==="green"?"selected":"") +'>グリーン</option><option value="rose" '+(a==="rose"?"selected":"") +'>ローズ</option><option value="amber" '+(a==="amber"?"selected":"") +'>アンバー</option></select></div><div class="portal-settings-row"><div><strong>背景スタイル</strong><small>背景の雰囲気を選べます</small></div><select id="portal-background" class="portal-select"><option value="aurora" '+(bg==="aurora"?"selected":"") +'>オーロラ</option><option value="plain" '+(bg==="plain"?"selected":"") +'>シンプル</option><option value="grid" '+(bg==="grid"?"selected":"") +'>グリッド</option></select></div><div class="portal-settings-row"><div><strong>表示密度</strong><small>カードの余白や情報量を調整します</small></div><select id="portal-density" class="portal-select"><option value="comfortable" '+(d==="comfortable"?"selected":"") +'>ゆったり</option><option value="compact" '+(d==="compact"?"selected":"") +'>コンパクト</option></select></div><div class="portal-settings-row"><div><strong>アニメーション</strong><small>動きを少なくして表示を軽くします</small></div><select id="portal-motion" class="portal-select"><option value="normal" '+(m==="normal"?"selected":"") +'>通常</option><option value="reduced" '+(m==="reduced"?"selected":"") +'>控えめ</option></select></div><div class="portal-settings-row"><div><strong>ホーム画面</strong><small>ウィジェットや自分のリンクを自由に編集できます</small></div><a href="/" class="portal-btn small">カスタマイズする</a></div><div class="portal-settings-row"><div><strong>端末データ</strong><small>この端末のお気に入り・履歴・表示設定を消去します</small></div><button id="portal-reset-local" class="portal-btn small">消去</button></div><div class="portal-settings-row"><div><strong>アカウント同期</strong><small>ログインすると設定や利用データを複数端末で同期できます</small></div><a href="/mypage/" class="portal-btn small">アカウント設定</a></div></section>';}
};m.innerHTML=(v[page]||home)();bind();window.dispatchEvent(new Event("kuro:portal-rendered"));}
function bindFav(){document.querySelectorAll("[data-fav]").forEach(function(b){b.onclick=function(){var k=b.dataset.fav,x=catalog.find(function(y){return y.key===k;})||st.data.favorites.find(function(y){return y.item_key===k;});if(!x)return;var i=st.data.favorites.findIndex(function(y){return y.item_key===k;});if(i>=0){st.data.favorites.splice(i,1);save();if(st.user)db.from("portal_favorites").delete().eq("user_id",st.user.id).eq("item_key",k);}else{st.data.favorites.unshift({item_key:k,item_type:x.type,title:x.title,href:x.href,created_at:new Date().toISOString()});save();if(st.user)sync();}render();};});}
function bind(){bindFav();var sf=$("#portal-search-form");if(sf){var i=$("#portal-search-input"),run=function(){var q=i.value.toLowerCase().trim(),a=catalog.filter(function(x){return (x.title+" "+x.desc+" "+x.tags).toLowerCase().indexOf(q)>=0;});$("#portal-search-results").innerHTML=a.length?a.map(card).join(""):'<div class="portal-empty" style="grid-column:1/-1">該当する項目がありません</div>';bindFav();};sf.onsubmit=function(e){e.preventDefault();run();};i.oninput=run;}
var cl=$("#portal-clear-history");if(cl)cl.onclick=async function(){if(!confirm("閲覧履歴を消去しますか？"))return;st.data.history=[];save();if(st.user)await db.from("portal_history").delete().eq("user_id",st.user.id);render();};
var sy=$("#portal-sync-now");if(sy)sy.onclick=sync;var op=$("#portal-open-login");if(op)op.onclick=openLogin;var so=$("#portal-signout");if(so)so.onclick=function(){db.auth.signOut();};
var th=$("#portal-theme");if(th)th.onchange=function(e){st.data.preferences.theme=e.target.value;save();if(st.user)sync();};
var rs=$("#portal-reset-local");if(rs)rs.onclick=function(){if(!confirm("この端末のデータを消去しますか？アカウント側のデータは消えません。"))return;st.data=defaults();save();render();};
var rf=$("#portal-request-form");if(rf)rf.onsubmit=sendRequest;bindDashboard();bindDisplaySettings();}
async function sync(showToast){if(!st.user)return;if(st.sync){st.syncAgain=true;return;}st.sync=true;try{var id=st.user.id,r=await Promise.all([db.from("portal_preferences").select("*").eq("user_id",id).maybeSingle(),db.from("portal_favorites").select("*").eq("user_id",id),db.from("portal_history").select("*").eq("user_id",id).order("visited_at",{ascending:false}).limit(100)]);r.forEach(function(x){if(x.error)throw x.error;});var p=r[0].data,guestNew=(st.data.updatedAt||0)>(p&&p.updated_at?new Date(p.updated_at).getTime():0),prefs=guestNew?Object.assign({},p&&p.preferences||{},st.data.preferences):Object.assign({},st.data.preferences,p&&p.preferences||{}),fm=new Map(),hm=new Map();(r[1].data||[]).concat(st.data.favorites).forEach(function(x){fm.set(x.item_key,x);});(r[2].data||[]).concat(st.data.history).forEach(function(x){var old=hm.get(x.item_key);if(!old||new Date(x.visited_at||0)>new Date(old.visited_at||0))hm.set(x.item_key,x);});var f=Array.from(fm.values()),h=Array.from(hm.values()).sort(function(a,b){return new Date(b.visited_at)-new Date(a.visited_at);}).slice(0,100),writes=[];if(guestNew||!p)writes.push(db.from("portal_preferences").upsert({user_id:id,preferences:prefs,updated_at:new Date().toISOString()},{onConflict:"user_id"}));if(f.length)writes.push(db.from("portal_favorites").upsert(f.map(function(x){return {user_id:id,item_key:x.item_key,item_type:x.item_type,title:x.title,href:x.href,created_at:x.created_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"}));if(h.length)writes.push(db.from("portal_history").upsert(h.map(function(x){return {user_id:id,item_key:x.item_key,title:x.title,href:x.href,visited_at:x.visited_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"}));var wr=await Promise.all(writes);wr.forEach(function(x){if(x.error)throw x.error;});st.data.favorites=f;st.data.history=h;st.data.preferences=prefs;save();if(showToast)toast("アカウントのデータを同期しました");}catch(e){console.warn(e);if(showToast)toast("同期できませんでした。端末データは保持しています");}finally{st.sync=false;render();if(st.syncAgain){st.syncAgain=false;sync(false);}}}async function sendRequest(e){e.preventDefault();var msg=$("#portal-request-message").value.trim(),s=$("#portal-request-status");if($("#portal-request-website").value){s.textContent="送信できませんでした。";return;}var last=Number(localStorage.getItem("kuro_portal_request_at")||0);if(Date.now()-last<60000){s.textContent="送信は1分ほど空けてからお試しください。";return;}var a=await db.auth.getUser(),data={message:msg,guest_id:guest()};if(a.data&&a.data.user)data.user_id=a.data.user.id;var r=await db.from("portal_requests").insert(data);if(r.error){s.textContent="送信できませんでした。時間をおいて再度お試しください。";return;}localStorage.setItem("kuro_portal_request_at",Date.now());$("#portal-request-message").value="";s.textContent="送信しました。ありがとうございます。";}
function openLogin(){var modal=$("#portal-login-modal");if(!modal)return;modal.hidden=false;var email=$("#portal-login-email");if(email)email.focus();}
function setRecoveryMode(active){
 ["portal-login-form","portal-auth-help","portal-register-switch","portal-recovery-form"].forEach(function(id){var el=$("#"+id);if(el)el.hidden=id==="portal-recovery-form"?!active:active;});
 document.querySelectorAll(".portal-oauth,.portal-oauth-note").forEach(function(el){el.hidden=active;});
 var title=$("#portal-login-title"),loginError=$("#portal-login-error"),recoveryError=$("#portal-recovery-error");
 if(active){if(title)title.textContent="新しいパスワードを設定";if(loginError)loginError.textContent="";if(recoveryError)recoveryError.textContent="メールのリンクを確認しました。新しいパスワードを入力してください。";}
}
function updateAccountUI(){var account=$("#portal-account-button");if(account){account.textContent=st.user?"マイページ":"ログイン";account.setAttribute("aria-label",st.user?"ログイン中。マイページを開く":"ログイン・新規登録");}}
function initLogin(){
 var account=$("#portal-account-button");if(account)account.onclick=function(){if(st.user)location.href="/mypage/";else openLogin();};updateAccountUI();
 var transport=$("#portal-transport-button");if(transport){transport.textContent=useGas?"GAS版（使用中）":"通常版";transport.onclick=function(){var next=useGas?"direct":"gas";localStorage.setItem("kuro_portal_transport",next);var u=new URL(location.href);u.searchParams.set("transport",next);location.href=u.pathname+u.search;};}
 var close=$("#portal-login-close");if(close)close.onclick=function(){var m=$("#portal-login-modal");if(m)m.hidden=true;};
 function showLoginError(message){var el=$("#portal-login-error");if(el)el.textContent=message;}
 var forgot=$("#portal-forgot-password");if(forgot)forgot.onclick=async function(){var e=$("#portal-login-email"),email=e?e.value.trim():"";if(!email){showLoginError("先にメールアドレスを入力してください。");if(e)e.focus();return;}var b=this;b.disabled=true;showLoginError("");try{var r=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/mypage/"});if(r.error)throw r.error;showLoginError("パスワード再設定メールを送信しました。メール内のリンクを開いてください。");}catch(err){showLoginError("再設定メールを送信できませんでした："+(err.message||"時間をおいて再度お試しください。"));}b.disabled=false;};
 var emailLink=$("#portal-email-link");if(emailLink)emailLink.onclick=async function(){var e=$("#portal-login-email"),email=e?e.value.trim():"";if(!email){showLoginError("先にメールアドレスを入力してください。");if(e)e.focus();return;}var b=this;b.disabled=true;showLoginError("");try{var r=await db.auth.signInWithOtp({email:email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+"/mypage/"}});if(r.error)throw r.error;showLoginError("ログイン用リンクを送信しました。メールを確認してください。");}catch(err){showLoginError("メールリンクを送信できませんでした："+(err.message||"時間をおいて再度お試しください。"));}b.disabled=false;};
 var recovery=$("#portal-recovery-form");if(recovery)recovery.onsubmit=async function(e){e.preventDefault();var b=$("#portal-recovery-submit"),p=$("#portal-new-password"),er=$("#portal-recovery-error");if(!b||!p)return;b.disabled=true;if(er)er.textContent="";try{var r=await db.auth.updateUser({password:p.value});if(r.error)throw r.error;var m=$("#portal-login-modal");if(m)m.hidden=true;setRecoveryMode(false);toast("パスワードを更新しました。");}catch(err){if(er)er.textContent=err.message||"パスワードを更新できませんでした。";}b.disabled=false;};
 var open=$("#portal-open-login");if(open)open.addEventListener("click",openLogin);
 async function oauth(provider){var id=provider==="google"?"portal-google-login":"portal-apple-login",b=$("#"+id),er=$("#portal-login-error");if(!b)return;b.disabled=true;if(er)er.textContent="";try{var r=await db.auth.signInWithOAuth({provider:provider,options:{redirectTo:location.origin+"/"}});if(r.error)throw r.error;}catch(err){var msg=String(err&&err.message||"");if(er)er.textContent=provider==="apple"&&/provider is not enabled|unsupported provider|apple/i.test(msg)?"AppleログインはSupabase側で未設定です。Googleまたはメールでログインしてください。":(msg||"ログインを開始できませんでした。");b.disabled=false;}}
 var google=$("#portal-google-login");if(google)google.onclick=function(){oauth("google");};var apple=$("#portal-apple-login");if(apple)apple.onclick=function(){oauth("apple");};
 var modal=$("#portal-login-modal");if(modal)modal.onclick=function(e){if(e.target.id==="portal-login-modal")e.currentTarget.hidden=true;};
 var sw=$("#portal-register-switch");if(sw)sw.onclick=function(){var form=$("#portal-login-form");if(!form)return;var reg=form.dataset.mode!=="register",help=$("#portal-auth-help"),g=$("#portal-google-login"),a=$("#portal-apple-login"),note=document.querySelector("#portal-login-modal .portal-oauth-note");if(help)help.hidden=reg;if(g)g.hidden=reg;if(a)a.hidden=reg;if(note)note.hidden=reg;form.dataset.mode=reg?"register":"login";var title=$("#portal-login-title"),submit=$("#portal-login-submit"),pw=$("#portal-login-password");if(title)title.textContent=reg?"KURO Labに新規登録":"KURO Labにログイン";if(submit)submit.textContent=reg?"アカウントを作成":"ログイン";sw.textContent=reg?"ログインに戻る":"新規アカウント作成";if(pw){pw.autocomplete=reg?"new-password":"current-password";pw.minLength=reg?8:1;}showLoginError(reg?"メールアドレスと8文字以上のパスワードで登録できます。":"");};
 var login=$("#portal-login-form");if(login)login.onsubmit=async function(e){e.preventDefault();var b=$("#portal-login-submit"),em=$("#portal-login-email"),pw=$("#portal-login-password"),er=$("#portal-login-error");if(!b||!em||!pw)return;var reg=this.dataset.mode==="register",email=em.value.trim(),password=pw.value;b.disabled=true;if(er)er.textContent="";try{if(!db)throw new Error("認証ライブラリを読み込めませんでした。ページを再読み込みしてお試しください。");var r=reg?await db.auth.signUp({email:email,password:password,options:{emailRedirectTo:location.origin+"/mypage/"}}):await db.auth.signInWithPassword({email:email,password:password});if(r.error)throw r.error;pw.value="";if(reg&&!r.data.session){if(er)er.textContent="確認メールを送信しました。メール内のリンクから登録を完了してください。";return;}st.user=(r.data&&r.data.user)||(r.data&&r.data.session&&r.data.session.user)||st.user;updateAccountUI();if(modal)modal.hidden=true;toast(reg?"アカウントを作成しました。データを同期しています。":"ログインしました。データを同期しています。");render();sync(true);}catch(err){var msg=String(err&&err.message||err||"通信エラー");if(er)er.textContent=(reg?"新規登録できませんでした：":"ログインできませんでした：")+msg+(useGas?"（GAS中継通信）":"");console.error("KURO portal auth error",err);}finally{b.disabled=false;}};
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
function getDashboardIds(){var a=st.data.preferences.dashboardWidgets;if(!Array.isArray(a))a=["shortcuts","games","weather"]var out=a.filter(function(id,i){return DASHBOARD_WIDGETS.some(function(x){return x.id===id;})&&a.indexOf(id)===i;});return out;}
function getDashboardCanvasBounds(){var b=st.data.preferences.dashboardCanvasBounds||{},w=Number(b.width),h=Number(b.height);return {width:Math.max(3200,Math.min(30000,Number.isFinite(w)?w:4800)),height:Math.max(2200,Math.min(30000,Number.isFinite(h)?h:3200))};}
function getDashboardCanvasPosition(id,index){var all=st.data.preferences.dashboardCanvasPositions||{},p=all[id]||{},size=(st.data.preferences.dashboardSizes||{})[id]||"half";var widths={small:320,half:420,wide:560,full:740};return {x:Math.max(-50000,Math.min(50000,Number.isFinite(Number(p.x))?Number(p.x):1200+(index%3)*460)),y:Math.max(-50000,Math.min(50000,Number.isFinite(Number(p.y))?Number(p.y):780+Math.floor(index/3)*360)),width:Math.max(260,Math.min(1100,Number.isFinite(Number(p.width))?Number(p.width):(widths[size]||420))),rotation:Math.max(-180,Math.min(180,Number(p.rotation)||0)),z:Math.max(1,Math.min(999,Number(p.z)||100+index))};}
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
function home(){var ids=getDashboardIds(),edit=!!st.dashboardEditing,resizeMode=!!st.dashboardResizeMode,storedLayout=st.data.preferences.dashboardLayout,layout=["balanced","three","single"].indexOf(storedLayout)>=0?storedLayout:"balanced",canvasMode=st.data.preferences.dashboardViewMode==="canvas",zoom=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1)),bounds=getDashboardCanvasBounds(),canvasHtml=canvasMode?'<div id="portal-canvas-viewport" class="portal-canvas-viewport"><div id="portal-canvas-stage" class="portal-canvas-stage" style="width:'+Math.round(bounds.width*zoom)+'px;height:'+Math.round(bounds.height*zoom)+'px"><div id="portal-dashboard-grid" class="portal-dashboard-grid is-canvas '+(edit?"is-editing ":"")+'" data-layout="'+layout+'" style="width:'+bounds.width+'px;height:'+bounds.height+'px;transform:scale('+zoom+')">'+ids.map(dashboardWidget).join("")+'</div></div></div>':'<div id="portal-dashboard-grid" class="portal-dashboard-grid '+(edit?"is-editing ":"")+(edit&&resizeMode?"is-resize-mode":"")+'" data-layout="'+layout+'">'+ids.map(dashboardWidget).join("")+'</div>';return '<div class="portal-dashboard-v2"><div class="portal-dashboard-toolbar"><div class="portal-dashboard-actions"><button type="button" class="portal-btn" data-open-quick="true" aria-label="検索">⌕ 検索</button><button id="portal-dashboard-edit" class="portal-btn '+(edit?"primary":"")+'" type="button">'+(edit?"完了":"編集")+'</button><button type="button" class="portal-btn" data-dashboard-view-toggle>'+(canvasMode?"▦ 整列表示":"✥ 無限キャンバス")+'</button>'+(canvasMode?'<button type="button" class="portal-btn" data-canvas-zoom-out aria-label="縮小">−</button><input class="portal-canvas-zoom-slider" data-canvas-zoom-slider type="range" min="25" max="150" step="5" value="'+Math.round(zoom*100)+'" aria-label="キャンバス倍率"><output class="portal-canvas-zoom-value" data-canvas-zoom-value>'+Math.round(zoom*100)+'%</output><button type="button" class="portal-btn" data-canvas-zoom-in aria-label="拡大">＋</button><button type="button" class="portal-btn" data-canvas-fit>全体表示</button><button type="button" class="portal-btn" data-canvas-center>中央へ</button>':'')+'<button id="portal-dashboard-add" class="portal-btn" type="button">＋ 追加</button><button id="portal-dashboard-reset" class="portal-btn subtle" type="button" aria-label="初期配置に戻す">↺</button></div><section id="portal-dashboard-editor" class="portal-dashboard-editor" hidden><div class="portal-editor-heading"><b>ホームに追加</b><button type="button" class="portal-editor-close" aria-label="閉じる">×</button></div><div class="portal-widget-picker">'+DASHBOARD_WIDGETS.filter(function(w){return w.id!=="custom";}).map(function(w){var on=ids.indexOf(w.id)>=0;return '<button type="button" data-widget-toggle="'+w.id+'" class="'+(on?"selected":"")+'" aria-disabled="false"><span>'+w.icon+'</span><b>'+w.title+'</b><small>'+(on?"追加済み・表示":"追加する")+'</small></button>';}).join("")+'</div></section></div>'+canvasHtml+'</div>';}
function applyDisplayPrefs(){var p=st.data&&st.data.preferences||{},themes={violet:["#8b5cf6","#30254b"],blue:["#087fbd","#e9f6fd"],green:["#15966d","#e4f7ef"],rose:["#db5475","#fceaf0"],amber:["#c17a16","#fff4df"]},a=themes[p.accent]||themes.violet;document.body.dataset.theme=p.theme==="auto"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p.theme==="dark"?"dark":"light";document.body.dataset.density=p.density==="compact"?"compact":"comfortable";document.body.dataset.motion=p.motion==="reduced"?"reduced":"normal";document.body.dataset.background=["aurora","plain","grid"].indexOf(p.background)>=0?p.background:"aurora";document.body.style.setProperty("--blue",a[0]);document.body.style.setProperty("--blue2",a[1]);var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=p.theme==="dark"?"#090a10":"#f4f7fb";}
function persistDisplayPrefs(){save();if(st.user){if(st.sync)st.syncAgain=true;else sync(false);}}
function bindDisplaySettings(){var x=$("#portal-theme");if(x)x.onchange=function(){st.data.preferences.theme=this.value;persistDisplayPrefs();};x=$("#portal-density");if(x)x.onchange=function(){st.data.preferences.density=this.value;persistDisplayPrefs();};x=$("#portal-motion");if(x)x.onchange=function(){st.data.preferences.motion=this.value;persistDisplayPrefs();};x=$("#portal-accent");if(x)x.onchange=function(){st.data.preferences.accent=this.value;persistDisplayPrefs();};x=$("#portal-background");if(x)x.onchange=function(){st.data.preferences.background=this.value;persistDisplayPrefs();};}
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
}
function bindDashboard(){
 positionDashboardToolbar();
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
 if(reset)reset.onclick=function(){if(!confirm("ホーム画面の配置を初期状態に戻しますか？"))return;st.data.preferences.dashboardWidgets=["shortcuts","games","weather"];st.data.preferences.dashboardSizes={};st.data.preferences.dashboardSpans={};st.data.preferences.dashboardHeights={};st.data.preferences.dashboardLayout="balanced";st.data.preferences.dashboardViewMode="grid";st.data.preferences.dashboardCanvasPositions={};st.data.preferences.dashboardCanvasBounds={width:4800,height:3200};st.data.preferences.dashboardCanvasZoom=1;window.__kuroCanvasScroll=null;localStorage.removeItem("kuro_canvas_view");st.dashboardEditing=false;persistDisplayPrefs();render();toast("ホーム画面を初期配置に戻しました");};
 if(layout)layout.onchange=function(){st.data.preferences.dashboardLayout=this.value;persistDisplayPrefs();render();};

 var viewToggle=$("[data-dashboard-view-toggle]");
 if(viewToggle)viewToggle.onclick=function(){st.data.preferences.dashboardViewMode=st.data.preferences.dashboardViewMode==="canvas"?"grid":"canvas";persistDisplayPrefs();render();};
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
   p.x=Math.max(-50000,Math.min(50000,p.x+(e.clientX-p.startX)/zoom));
   p.y=Math.max(-50000,Math.min(50000,p.y+(e.clientY-p.startY)/zoom));
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
  if(!savedView){try{savedView=JSON.parse(localStorage.getItem(workspaceCanvasKey)||"null");}catch(err){}}
  if(savedView&&Number.isFinite(savedView.left)&&Number.isFinite(savedView.top)){viewport.scrollLeft=Math.max(0,savedView.left);viewport.scrollTop=Math.max(0,savedView.top);}
  else{var visibleIds=getDashboardIds(),minX=Infinity,minY=Infinity;visibleIds.forEach(function(id,index){var position=getDashboardCanvasPosition(id,index);minX=Math.min(minX,position.x);minY=Math.min(minY,position.y);});viewport.scrollLeft=Number.isFinite(minX)?Math.max(0,(minX-180)*zoom):900*zoom;viewport.scrollTop=Number.isFinite(minY)?Math.max(0,(minY-180)*zoom):480*zoom;}
  var growing=false;
  function updateCanvasView(){var view={left:viewport.scrollLeft,top:viewport.scrollTop};window.__kuroCanvasScroll=view;try{localStorage.setItem(workspaceCanvasKey,JSON.stringify(view));}catch(err){}}
  function setCanvasDimensions(){var b=getDashboardCanvasBounds(),z=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1));stage.style.width=Math.round(b.width*z)+"px";stage.style.height=Math.round(b.height*z)+"px";grid.style.width=b.width+"px";grid.style.height=b.height+"px";grid.style.transform="scale("+z+")";}
  viewport.addEventListener("wheel",function(e){if(e.target&&e.target.closest("input,textarea,select,button,a,[contenteditable=true],iframe"))return;e.preventDefault();var current=Math.max(.25,Math.min(1.5,Number(st.data.preferences.dashboardCanvasZoom)||1)),factor=Math.exp(-e.deltaY*.0015),next=Math.max(.25,Math.min(1.5,current*factor));applyCanvasZoom(next,e.clientX-viewport.getBoundingClientRect().left,e.clientY-viewport.getBoundingClientRect().top,false);},{passive:false});
  viewport.addEventListener("scroll",function(){
   updateCanvasView();if(growing)return;var leftGrow=viewport.scrollLeft<220,topGrow=viewport.scrollTop<220,rightGrow=viewport.scrollLeft+viewport.clientWidth>viewport.scrollWidth-260,bottomGrow=viewport.scrollTop+viewport.clientHeight>viewport.scrollHeight-260;
   if(!leftGrow&&!topGrow&&!rightGrow&&!bottomGrow)return;
   growing=true;var grow=1800,pos=st.data.preferences.dashboardCanvasPositions||{};
   if(leftGrow){Object.keys(pos).forEach(function(id){pos[id].x=Number(pos[id].x||0)+grow;});viewport.scrollLeft+=grow*zoom;bounds.width+=grow;}
   if(topGrow){Object.keys(pos).forEach(function(id){pos[id].y=Number(pos[id].y||0)+grow;});viewport.scrollTop+=grow*zoom;bounds.height+=grow;}
   if(rightGrow)bounds.width+=grow;if(bottomGrow)bounds.height+=grow;
   st.data.preferences.dashboardCanvasPositions=pos;st.data.preferences.dashboardCanvasBounds=bounds;setCanvasDimensions();updateCanvasView();persistDisplayPrefs();window.dispatchEvent(new Event("kuro:canvas-layout-changed"));growing=false;
  },{passive:true});
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
 var h=$(".portal-header-inner");
 if(h){var brand=$(".portal-brand",h);if(brand&&!$("#portal-back-button")){var back=document.createElement("button");back.id="portal-back-button";back.className="portal-back-button";back.type="button";back.textContent="← 戻る";back.onclick=function(){var prev;try{prev=new URL(document.referrer);}catch(e){}if(history.length>1&&prev&&prev.origin===location.origin)history.back();else location.href="/";};h.insertBefore(back,brand);}
 if(!$("#portal-quick-button")){var q=document.createElement("button");q.id="portal-quick-button";q.className="portal-quick-button";q.type="button";q.innerHTML="⌕ <span>KURO Quick</span>";q.onclick=openQuick;h.insertBefore(q,$("#portal-transport-button")||null);}
 if(!$("#portal-network-status")){var n=document.createElement("div");n.id="portal-network-status";n.className="portal-network-status";h.insertBefore(n,$("#portal-account-button")||null);}}
 if(!$("#portal-quick-overlay")){var o=document.createElement("div");o.id="portal-quick-overlay";o.className="portal-quick-overlay";o.hidden=true;o.innerHTML='<section class="portal-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-quick-title"><div class="portal-quick-title"><div><span>KURO QUICK</span><b id="portal-quick-title">どこへ移動しますか？</b></div><button type="button" id="portal-quick-close" aria-label="閉じる">×</button></div><input id="portal-quick-input" class="portal-input" type="search" placeholder="サービス・ゲーム・設定を検索…" autocomplete="off"><div id="portal-quick-results" class="portal-quick-results"></div><small class="portal-quick-shortcut">Enterで開く · Escで閉じる · Ctrl + K で起動</small></section>';document.body.appendChild(o);$("#portal-quick-close").onclick=closeQuick;o.addEventListener("click",function(e){if(e.target===o)closeQuick();});var qi=$("#portal-quick-input");qi.oninput=function(){renderQuickResults(qi.value);};qi.onkeydown=function(e){if(e.key==="Enter"){var a=$("#portal-quick-results a");if(a)a.click();}};}
 if(!$("#portal-error-panel")){var p=document.createElement("div");p.id="portal-error-panel";p.className="portal-error-panel";p.hidden=true;p.innerHTML='<div><b id="portal-error-title">通信エラー</b><p id="portal-error-message"></p></div><button type="button" id="portal-error-close">閉じる</button>';document.body.appendChild(p);$("#portal-error-close").onclick=function(){p.hidden=true;};}
 window.addEventListener("online",function(){updateNetworkStatus();$("#portal-error-panel").hidden=true;toast("インターネットに再接続しました");});
 window.addEventListener("offline",function(){updateNetworkStatus();showErrorPanel("オフラインです","インターネットに接続できません。一部機能は通信が戻るまで使えません。端末に保存済みのデータは保持されています。");});
 window.addEventListener("error",function(e){if(e&&e.message)showErrorPanel("ページ内でエラーが発生しました","ページを再読み込みしてください。繰り返す場合はエラー内容をサポートへお知らせください。");});
 window.addEventListener("unhandledrejection",function(e){var m=String(e&&e.reason&&e.reason.message||e&&e.reason||"");if(!/abort/i.test(m))showErrorPanel("処理に失敗しました","通信状態を確認して再試行してください。問題が続く場合はページを再読み込みしてください。");});
 document.addEventListener("keydown",function(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openQuick();}if(e.key==="Escape")closeQuick();});
 document.addEventListener("click",function(e){if(e.target.closest("#portal-quick-results a"))closeQuick();});
 updateNetworkStatus();
}
function openQuick(){var o=$("#portal-quick-overlay");if(!o)return;o.hidden=false;renderQuickResults("");var i=$("#portal-quick-input");if(i){i.value="";i.focus();}}
function closeQuick(){var o=$("#portal-quick-overlay");if(o)o.hidden=true;}
function renderQuickResults(q){var box=$("#portal-quick-results");if(!box)return;var items=catalog.concat([{key:"home",title:"ホーム・ダッシュボード",desc:"自分専用のホーム画面",href:"/",icon:"⌂"},{key:"favorites",title:"お気に入り",desc:"保存したページ",href:"/favorites/",icon:"☆"},{key:"history",title:"閲覧履歴",desc:"最近開いたページ",href:"/history/",icon:"◷"},{key:"notifications",title:"お知らせ",desc:"KURO Labのお知らせ",href:"/notifications/",icon:"♧"},{key:"mypage",title:"マイページ",desc:"アカウントと同期",href:"/mypage/",icon:"◎"},{key:"settings",title:"表示設定",desc:"テーマや表示密度を変更",href:"/settings/",icon:"⚙"},]);var s=String(q||"").toLowerCase().trim(),a=items.filter(function(x){return !s||(x.title+" "+x.desc+" "+(x.tags||"")).toLowerCase().indexOf(s)>=0;}).slice(0,12);box.innerHTML=a.length?a.map(function(x){return '<a href="'+esc(x.href)+'"><span>'+x.icon+'</span><div><b>'+esc(x.title)+'</b><small>'+esc(x.desc)+'</small></div><i>↗</i></a>';}).join(""):'<div class="portal-widget-empty">一致するページがありません。</div>';}

async function init(){st.data=load();guest();applyDisplayPrefs();document.body.dataset.transport=useGas?"gas":"direct";document.title=titles[page][0]+"｜KURO Lab";var md=$('meta[name="description"]');if(md)md.content=titles[page][1];$("#portal-desktop-nav").innerHTML=nav.map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'>'+x[1]+'</a>';}).join("");$("#portal-mobile-nav").innerHTML=nav.filter(function(x){return ["home","search","favorites","notifications","mypage"].indexOf(x[0])>=0;}).map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'><span>'+x[2]+'</span><span>'+x[1]+'</span></a>';}).join("");initLogin();initGlobalUI();render();if(!db){console.error("KURO Supabase SDK could not be loaded");return;}db.auth.onAuthStateChange(function(ev,session){st.user=session?session.user:null;updateAccountUI();if(ev==="PASSWORD_RECOVERY"){setRecoveryMode(true);var recoveryModal=$("#portal-login-modal");if(recoveryModal)recoveryModal.hidden=false;}if(ev==="SIGNED_IN"&&st.user)setTimeout(function(){sync(false);},0);render();});try{var ss=await db.auth.getSession();st.user=ss.data&&ss.data.session?ss.data.session.user:null;updateAccountUI();render();if(st.user)sync(false);}catch(authError){console.warn("KURO portal session restore failed",authError);}db.from("portal_announcements").select("id,title,body,href,created_at").eq("published",true).order("created_at",{ascending:false}).limit(20).then(function(a){if(!a.error){st.ann=a.data||[];render();window.dispatchEvent(new Event("kuro:announcements-updated"));}});function recordVisit(item){var h={item_key:item.key,title:item.title,href:item.href,visited_at:new Date().toISOString()},i=st.data.history.findIndex(function(x){return x.item_key===item.key;});if(i>=0)st.data.history.splice(i,1);st.data.history.unshift(h);st.data.history=st.data.history.slice(0,100);save();if(st.user)db.from("portal_history").upsert(Object.assign({user_id:st.user.id},h),{onConflict:"user_id,item_key"});}var item=catalog.find(function(x){return x.href.slice(0,-1)===path;});if(item)recordVisit(item);document.addEventListener("click",function(e){var a=e.target.closest("a[href]");if(!a)return;var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;var destination=catalog.find(function(x){return x.href===u.pathname;});if(destination)recordVisit(destination);});render();}init().catch(function(e){console.error(e);render();});
})();

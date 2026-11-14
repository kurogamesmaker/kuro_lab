
(async function(){
"use strict";
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
if(requestedTransport==="gas")localStorage.setItem("kuro_portal_transport","gas");
if(requestedTransport==="direct")localStorage.setItem("kuro_portal_transport","direct");
var useGas=(requestedTransport||localStorage.getItem("kuro_portal_transport")||"direct")==="gas";
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
var db=supabaseReady?window.supabase.createClient(SUPABASE_URL,PUBLISHABLE_KEY,useGas?{global:{fetch:gasFetch}}:{}):null;
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
var nav=[["home","ホーム","⌂","/"],["search","検索","⌕","/search/"],["favorites","お気に入り","☆","/favorites/"],["history","履歴","◷","/history/"],["notifications","お知らせ","♧","/notifications/"],["mypage","マイページ","◎","/mypage/"]];
var st={user:null,ann:[],data:null,sync:false};
function $(s,r){return (r||document).querySelector(s);}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fmt(v){try{return new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v));}catch(e){return "";}}
function uuid(){return crypto.randomUUID();}
function guest(){var x=localStorage.getItem(G);if(!x){x=uuid();localStorage.setItem(G,x);}return x;}
function defaults(){return {favorites:[],history:[],preferences:{theme:"light"},updatedAt:0};}
function load(){try{var x=JSON.parse(localStorage.getItem(S)||"null");return Object.assign(defaults(),x||{},{preferences:Object.assign({theme:"light"},x&&x.preferences||{})});}catch(e){return defaults();}}
function save(){st.data.updatedAt=Date.now();localStorage.setItem(S,JSON.stringify(st.data));document.body.dataset.theme=st.data.preferences.theme||"light";}
function toast(t){var e=$("#portal-toast");e.textContent=t;e.classList.add("show");clearTimeout(window.ptimer);window.ptimer=setTimeout(function(){e.classList.remove("show");},2200);}
function has(k){return st.data.favorites.some(function(x){return x.item_key===k;});}
function favBtn(x){return '<button class="portal-fav" data-fav="'+esc(x.key)+'" aria-pressed="'+has(x.key)+'">'+(has(x.key)?"★ 保存済み":"☆ お気に入り")+'</button>';}
function card(x){return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+x.icon+'</div><div><span class="portal-kicker">'+(x.type==="game"?"GAME":x.type==="page"?"INFO":"SERVICE")+'</span><h3>'+esc(x.title)+'</h3></div></div><p>'+esc(x.desc)+'</p><div class="portal-card-actions"><a class="portal-btn primary small" href="'+x.href+'">開く →</a>'+favBtn(x)+'</div></article>';}
function head(t,d,k){return '<div class="portal-page-heading"><span class="portal-eyebrow">'+(k||"KURO PORTAL")+'</span><h1>'+t+'</h1><p>'+d+'</p></div>';}
function hist(a){if(!a.length)return '<div class="portal-empty"><strong>まだ履歴はありません</strong>サービスやゲームを開くと、ここに表示されます。</div>';return '<div class="portal-list">'+a.map(function(x){return '<div class="portal-list-item"><div class="portal-icon">◷</div><div class="grow"><strong>'+esc(x.title)+'</strong><small>'+fmt(x.visited_at)+'</small></div><a class="portal-btn small" href="'+esc(x.href)+'">開く</a></div>';}).join("")+'</div>';}
function announcements(){if(!st.ann.length)return '<div class="portal-empty"><strong>新しいお知らせはありません</strong>重要なお知らせはここに表示されます。</div>';return '<div class="portal-list">'+st.ann.map(function(a){return '<article class="portal-card portal-announcement"><time>'+fmt(a.created_at)+'</time><h3>'+esc(a.title)+'</h3><p>'+esc(a.body)+'</p>'+(a.href?'<a class="portal-btn small" href="'+esc(a.href)+'">詳しく見る →</a>':"")+'</article>';}).join("")+'</div>';}
function home(){return '<div class="portal-dashboard"><aside class="portal-side"><a class="portal-side-brand" href="/"><img src="/icon-192.png" alt=""><span><b>KURO Lab</b><small>PLAY · CREATE · CONNECT</small></span></a><div class="portal-side-label">MENU</div><a class="portal-side-link active" href="/"><span>⌂</span>ダッシュボード</a><a class="portal-side-link" href="/games/"><span>▣</span>ゲーム</a><a class="portal-side-link" href="/search/"><span>⌕</span>検索</a><a class="portal-side-link" href="/favorites/"><span>☆</span>お気に入り</a><a class="portal-side-link" href="/notifications/"><span>♧</span>お知らせ</a><div class="portal-side-spacer"></div><a class="portal-side-link" href="/about/"><span>ⓘ</span>KURO Labについて</a><a class="portal-side-link" href="/settings/"><span>⚙</span>設定</a><div class="portal-side-support"><a href="/contact/">SUPPORT</a><a href="/chat/">CHAT</a></div></aside><div class="portal-center"><div class="portal-welcome"><div><span class="portal-eyebrow">WELCOME TO KURO LAB</span><h1>好きなことを、<em>ここから。</em></h1><p>ゲームもサービスも、KURO Labの楽しさをひとつの場所に。</p></div><a class="portal-btn primary" href="/games/">ゲームを探す ↗</a></div><div class="portal-feature-row"><a class="portal-feature-card feature-sushi" href="/game/kaiten-sushi-typing/"><span class="portal-feature-tag">PICK UP GAME</span><strong>回転寿司<br>タイピング</strong><small>回して、打って、ハイスコアへ。</small><b class="feature-go">PLAY NOW ↗</b><span class="feature-art">🍣</span></a><a class="portal-feature-card feature-quest" href="/game/block-blast/"><span class="portal-feature-tag">DAILY CHALLENGE</span><strong>ブロックを<br>並べて消そう！</strong><small>今日の気分でパズルに挑戦。</small><b class="feature-go">PLAY NOW ↗</b><span class="feature-art">🧩</span></a></div><div class="portal-section portal-home-games"><div class="portal-section-head"><div><h2>お気に入りのゲームを見つけよう</h2><p>PLAY SOMETHING FUN TODAY</p></div><a class="portal-text-link" href="/games/">すべて見る →</a></div><div class="portal-game-grid"><a class="portal-game-tile tile-sushi" href="/game/kaiten-sushi-typing/"><span class="tile-art">🍣</span><b>回転寿司タイピング</b><small>タイピング · GAME</small></a><a class="portal-game-tile tile-block" href="/game/block-blast/"><span class="tile-art">🧩</span><b>ブロックブラスト</b><small>パズル · GAME</small></a><a class="portal-game-tile tile-sns" href="/sns/"><span class="tile-art">💬</span><b>KURO SNS</b><small>COMMUNITY</small></a><a class="portal-game-tile tile-chat" href="/chat/"><span class="tile-art">🗨️</span><b>オープンチャット</b><small>CHAT</small></a></div></div><div class="portal-section portal-home-bottom"><div class="portal-section-head"><div><h2>KURO Labからのお知らせ</h2><p>WHAT IS NEW</p></div><a class="portal-text-link" href="/notifications/">一覧を見る →</a></div>'+announcements()+'</div></div><aside class="portal-right"><div class="portal-profile-card"><div class="portal-profile-head"><img src="/icon-192.png" alt=""><div><b>KURO Lab</b><small>YOUR DIGITAL SPACE</small></div></div><p>ゲストのままでも利用できます。ログインするとお気に入りや履歴を同期できます。</p><a href="/mypage/" class="portal-btn primary small">マイページへ →</a></div><div class="portal-right-section"><div class="portal-right-heading"><b>クイックアクセス</b><span>SHORTCUTS</span></div><a class="portal-quick-link" href="/sns/"><span>💬</span><b>KURO SNS</b><i>↗</i></a><a class="portal-quick-link" href="/chat/"><span>🗨️</span><b>オープンチャット</b><i>↗</i></a><a class="portal-quick-link" href="/request/"><span>✉️</span><b>リクエストBOX</b><i>↗</i></a></div><div class="portal-right-section"><div class="portal-right-heading"><b>最近使ったページ</b><a href="/history/">すべて</a></div>'+hist(st.data.history.slice(0,3))+'</div><div class="portal-right-promo"><span>KURO LAB COMMUNITY</span><b>アイデアを、<br>かたちにしよう。</b><a href="/about/">KURO Labについて ↗</a></div></aside></div>';}

function achievements(){var n=st.data.history.length,f=st.data.favorites.length;return [{n:"はじめの一歩",d:"サービスを1つ開く",i:"🌱",ok:n>=1},{n:"サービス探検家",d:"3つ以上のサービス・ゲームを利用",i:"🧭",ok:n>=3},{n:"お気に入りコレクター",d:"お気に入りを3つ保存",i:"⭐",ok:f>=3},{n:"KURO Labリピーター",d:"5つ以上のページを履歴に記録",i:"🏅",ok:n>=5}];}
function render(){var m=$("#portal-main"),v={
home:home,
search:function(){return head("KURO Lab内を検索","サービス・ゲーム・ガイドをまとめて検索できます。","DISCOVER")+'<form id="portal-search-form" class="portal-search"><input id="portal-search-input" class="portal-input" type="search" placeholder="例：タイピング、チャット、ゲーム…"><button class="portal-btn primary">検索する</button></form><section class="portal-section"><div id="portal-search-results" class="portal-grid">'+catalog.map(card).join("")+'</div></section>';},
notifications:function(){return head("お知らせ","KURO Labからの更新や案内を確認できます。","NOTIFICATIONS")+announcements()+'<section class="portal-section"><div class="portal-card"><h3>KURO SNSの通知</h3><p>フォローやチャットなどの通知はKURO SNS内で確認できます。</p><a class="portal-btn primary small" href="/sns/">KURO SNSの通知を開く →</a></div></section>';},
favorites:function(){return head("お気に入り","保存したサービスやゲームを確認できます。","YOUR COLLECTION")+(st.data.favorites.length?'<div class="portal-grid">'+st.data.favorites.map(function(x){var c=catalog.find(function(y){return y.key===x.item_key;})||x;return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+(c.icon||"☆")+'</div><h3>'+esc(x.title)+'</h3></div><a class="portal-btn primary small" href="'+esc(x.href)+'">開く →</a> <button class="portal-fav" data-fav="'+esc(x.item_key)+'" aria-pressed="true">★ 保存済み</button></article>';}).join("")+'</div>':'<div class="portal-empty"><strong>お気に入りはまだありません</strong>サービスカードの「お気に入り」から保存できます。</div>');},
history:function(){return head("閲覧履歴","最近開いたサービスやゲームを確認できます。","RECENTLY USED")+hist(st.data.history)+'<div class="portal-card-actions"><button id="portal-clear-history" class="portal-btn small">履歴を消去</button></div>';},
achievements:function(){return head("実績","利用履歴やお気に入りに応じて解放される利用記録です。","ACHIEVEMENTS")+'<div class="portal-grid">'+achievements().map(function(x){return '<article class="portal-card"><div class="portal-card-top"><div class="portal-icon">'+(x.ok?x.i:"🔒")+'</div><div><span class="portal-kicker">'+(x.ok?"UNLOCKED":"LOCKED")+'</span><h3>'+x.n+'</h3></div></div><p>'+x.d+'</p><p class="portal-muted">'+(x.ok?"解放済み":"未解放")+'</p></article>';}).join("")+'</div><p class="portal-muted">端末の利用記録に基づく実績です。ランキング用スコアではありません。</p>';},
mypage:function(){return head("マイページ","アカウントと利用状況を確認できます。","MY KURO")+'<section class="portal-card"><h2>アカウント</h2><p>'+(st.user?"ログイン中："+esc(st.user.email||"アカウント"):"ゲストとして利用中。この端末にデータを保存しています。")+'</p><p class="portal-muted">ログインするとゲストデータとアカウントデータを統合します。</p><div class="portal-card-actions">'+(st.user?'<button id="portal-sync-now" class="portal-btn primary">今すぐ同期</button><button id="portal-signout" class="portal-btn">ログアウト</button>':'<button id="portal-open-login" class="portal-btn primary">ログイン・新規登録</button>')+'</div></section><section class="portal-section"><div class="portal-grid"><article class="portal-card"><h3>'+st.data.favorites.length+' 件</h3><p>お気に入り</p><a class="portal-btn small" href="/favorites/">確認する</a></article><article class="portal-card"><h3>'+st.data.history.length+' 件</h3><p>閲覧履歴</p><a class="portal-btn small" href="/history/">確認する</a></article><article class="portal-card"><h3>'+achievements().filter(function(x){return x.ok;}).length+' / 4</h3><p>実績</p><a class="portal-btn small" href="/achievements/">確認する</a></article></div></section>';},
request:function(){return head("リクエストBOX","追加してほしい機能や改善してほしい点を送ってください。","FEEDBACK")+'<form id="portal-request-form" class="portal-form"><div class="portal-field"><label for="portal-request-message">リクエスト内容</label><textarea id="portal-request-message" class="portal-textarea" minlength="5" maxlength="500" required placeholder="追加してほしい機能、改善してほしい点など"></textarea><small>5〜500文字。住所・電話番号・学校名・パスワードなどは書かないでください。</small></div><div style="position:absolute;left:-9999px" aria-hidden="true"><input id="portal-request-website" tabindex="-1"></div><button class="portal-btn primary">リクエストを送信</button><p id="portal-request-status" role="status" class="portal-muted"></p></form>';},
settings:function(){var t=st.data.preferences.theme||"light";return head("設定","ポータルの見た目や保存データを管理できます。","PREFERENCES")+'<section class="portal-card"><div class="portal-settings-row"><div><strong>テーマ</strong><small>ライト・ダークを切り替えます</small></div><select id="portal-theme" class="portal-select" style="max-width:170px"><option value="light" '+(t==="light"?"selected":"") +'>ライト</option><option value="dark" '+(t==="dark"?"selected":"") +'>ダーク</option></select></div><div class="portal-settings-row"><div><strong>端末データ</strong><small>この端末のお気に入り・履歴・設定を消去します</small></div><button id="portal-reset-local" class="portal-btn small">消去</button></div><div class="portal-settings-row"><div><strong>アカウント同期</strong><small>ログインすると複数端末で同期できます。</small></div><a href="/mypage/" class="portal-btn small">アカウント設定</a></div></section>';}
};m.innerHTML=(v[page]||home)();bind();}
function bindFav(){document.querySelectorAll("[data-fav]").forEach(function(b){b.onclick=function(){var k=b.dataset.fav,x=catalog.find(function(y){return y.key===k;})||st.data.favorites.find(function(y){return y.item_key===k;});if(!x)return;var i=st.data.favorites.findIndex(function(y){return y.item_key===k;});if(i>=0){st.data.favorites.splice(i,1);save();if(st.user)db.from("portal_favorites").delete().eq("user_id",st.user.id).eq("item_key",k);}else{st.data.favorites.unshift({item_key:k,item_type:x.type,title:x.title,href:x.href,created_at:new Date().toISOString()});save();if(st.user)sync();}render();};});}
function bind(){bindFav();var sf=$("#portal-search-form");if(sf){var i=$("#portal-search-input"),run=function(){var q=i.value.toLowerCase().trim(),a=catalog.filter(function(x){return (x.title+" "+x.desc+" "+x.tags).toLowerCase().indexOf(q)>=0;});$("#portal-search-results").innerHTML=a.length?a.map(card).join(""):'<div class="portal-empty" style="grid-column:1/-1">該当する項目がありません</div>';bindFav();};sf.onsubmit=function(e){e.preventDefault();run();};i.oninput=run;}
var cl=$("#portal-clear-history");if(cl)cl.onclick=async function(){if(!confirm("閲覧履歴を消去しますか？"))return;st.data.history=[];save();if(st.user)await db.from("portal_history").delete().eq("user_id",st.user.id);render();};
var sy=$("#portal-sync-now");if(sy)sy.onclick=sync;var op=$("#portal-open-login");if(op)op.onclick=openLogin;var so=$("#portal-signout");if(so)so.onclick=function(){db.auth.signOut();};
var th=$("#portal-theme");if(th)th.onchange=function(e){st.data.preferences.theme=e.target.value;save();if(st.user)sync();};
var rs=$("#portal-reset-local");if(rs)rs.onclick=function(){if(!confirm("この端末のデータを消去しますか？アカウント側のデータは消えません。"))return;st.data=defaults();save();render();};
var rf=$("#portal-request-form");if(rf)rf.onsubmit=sendRequest;}
async function sync(){if(!st.user||st.sync)return;st.sync=true;try{var id=st.user.id,r=await Promise.all([db.from("portal_preferences").select("*").eq("user_id",id).maybeSingle(),db.from("portal_favorites").select("*").eq("user_id",id),db.from("portal_history").select("*").eq("user_id",id).order("visited_at",{ascending:false}).limit(100)]);r.forEach(function(x){if(x.error)throw x.error;});var p=r[0].data,guestNew=(st.data.updatedAt||0)>(p&&p.updated_at?new Date(p.updated_at).getTime():0),prefs=guestNew?st.data.preferences:(p&&p.preferences||st.data.preferences),fm=new Map(),hm=new Map();(r[1].data||[]).concat(st.data.favorites).forEach(function(x){fm.set(x.item_key,x);});(r[2].data||[]).concat(st.data.history).forEach(function(x){var old=hm.get(x.item_key);if(!old||new Date(x.visited_at||0)>new Date(old.visited_at||0))hm.set(x.item_key,x);});var f=Array.from(fm.values()),h=Array.from(hm.values()).sort(function(a,b){return new Date(b.visited_at)-new Date(a.visited_at);}).slice(0,100);if(guestNew||!p){var pr=await db.from("portal_preferences").upsert({user_id:id,preferences:prefs,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(pr.error)throw pr.error;}if(f.length){var fr=await db.from("portal_favorites").upsert(f.map(function(x){return {user_id:id,item_key:x.item_key,item_type:x.item_type,title:x.title,href:x.href,created_at:x.created_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"});if(fr.error)throw fr.error;}if(h.length){var hr=await db.from("portal_history").upsert(h.map(function(x){return {user_id:id,item_key:x.item_key,title:x.title,href:x.href,visited_at:x.visited_at||new Date().toISOString()};}),{onConflict:"user_id,item_key"});if(hr.error)throw hr.error;}st.data.favorites=f;st.data.history=h;st.data.preferences=prefs;save();toast("ゲストとアカウントのデータを統合しました");}catch(e){console.warn(e);toast("同期できませんでした。端末データは保持しています");}finally{st.sync=false;render();}}
async function sendRequest(e){e.preventDefault();var msg=$("#portal-request-message").value.trim(),s=$("#portal-request-status");if($("#portal-request-website").value){s.textContent="送信できませんでした。";return;}var last=Number(localStorage.getItem("kuro_portal_request_at")||0);if(Date.now()-last<60000){s.textContent="送信は1分ほど空けてからお試しください。";return;}var a=await db.auth.getUser(),data={message:msg,guest_id:guest()};if(a.data&&a.data.user)data.user_id=a.data.user.id;var r=await db.from("portal_requests").insert(data);if(r.error){s.textContent="送信できませんでした。時間をおいて再度お試しください。";return;}localStorage.setItem("kuro_portal_request_at",Date.now());$("#portal-request-message").value="";s.textContent="送信しました。ありがとうございます。";}
function openLogin(){var modal=$("#portal-login-modal");if(!modal)return;modal.hidden=false;var email=$("#portal-login-email");if(email)email.focus();}
function setRecoveryMode(active){
 $("#portal-login-form").hidden=active;$("#portal-auth-help").hidden=active;$("#portal-register-switch").hidden=active;$(".portal-oauth").hidden=active;$(".portal-oauth-note").hidden=active;$("#portal-recovery-form").hidden=!active;
 if(active){$("#portal-login-title").textContent="新しいパスワードを設定";$("#portal-login-error").textContent="";$("#portal-recovery-error").textContent="メールのリンクを確認しました。新しいパスワードを入力してください。";}
}
function initLogin(){
 $("#portal-account-button").onclick=function(){if(st.user)location.href="/mypage/";else openLogin();};
 $("#portal-transport-button").textContent=useGas?"通常版":"GAS版";
 $("#portal-transport-button").onclick=function(){var next=useGas?"direct":"gas";localStorage.setItem("kuro_portal_transport",next);var u=new URL(location.href);if(next==="gas")u.searchParams.set("transport","gas");else u.searchParams.delete("transport");location.href=u.pathname+u.search;};
 $("#portal-login-close").onclick=function(){$("#portal-login-modal").hidden=true;};
 function showLoginError(message){$("#portal-login-error").textContent=message;}
 $("#portal-forgot-password").onclick=async function(){
  var email=$("#portal-login-email").value.trim();if(!email){showLoginError("先にメールアドレスを入力してください。");$("#portal-login-email").focus();return;}
  var b=this;b.disabled=true;showLoginError("");
  try{var r=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/mypage/"});if(r.error)throw r.error;showLoginError("パスワード再設定メールを送信しました。メール内のリンクを開いてください。");}
  catch(e){showLoginError("再設定メールを送信できませんでした："+(e.message||"時間をおいて再度お試しください。"));}
  b.disabled=false;
 };
 $("#portal-email-link").onclick=async function(){
  var email=$("#portal-login-email").value.trim();if(!email){showLoginError("先にメールアドレスを入力してください。");$("#portal-login-email").focus();return;}
  var b=this;b.disabled=true;showLoginError("");
  try{var r=await db.auth.signInWithOtp({email:email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+"/mypage/"}});if(r.error)throw r.error;showLoginError("ログイン用リンクを送信しました。メールを確認してください。");}
  catch(e){showLoginError("メールリンクを送信できませんでした："+(e.message||"時間をおいて再度お試しください。"));}
  b.disabled=false;
 };
 $("#portal-recovery-form").onsubmit=async function(e){
  e.preventDefault();var b=$("#portal-recovery-submit"),password=$("#portal-new-password").value;b.disabled=true;$("#portal-recovery-error").textContent="";
  try{var r=await db.auth.updateUser({password:password});if(r.error)throw r.error;$("#portal-login-modal").hidden=true;setRecoveryMode(false);toast("パスワードを更新しました。");}
  catch(err){$("#portal-recovery-error").textContent=err.message||"パスワードを更新できませんでした。";}
  b.disabled=false;
 };
 $("#portal-open-login")?.addEventListener("click",function(){$("#portal-login-modal").hidden=false;});
 async function oauth(provider){
  var id=provider==="google"?"portal-google-login":"portal-apple-login",button=$("#"+id);
  button.disabled=true;$("#portal-login-error").textContent="";
  try{
   var r=await db.auth.signInWithOAuth({provider:provider,options:{redirectTo:location.origin+"/"}});
   if(r.error)throw r.error;
  }catch(e){
   var msg=String(e&&e.message||"");
   $("#portal-login-error").textContent=provider==="apple"&&/provider is not enabled|unsupported provider|apple/i.test(msg)?"AppleログインはSupabase側で未設定です。Googleまたはメールでログインしてください。":(msg||"ログインを開始できませんでした。");
   button.disabled=false;
  }
 }
 $("#portal-google-login").onclick=function(){oauth("google");};
 $("#portal-apple-login").onclick=function(){oauth("apple");};

 $("#portal-login-modal").onclick=function(e){if(e.target.id==="portal-login-modal")e.currentTarget.hidden=true;};
 $("#portal-register-switch").onclick=function(){var form=$("#portal-login-form"),reg=form.dataset.mode!=="register";$("#portal-auth-help").hidden=reg;$("#portal-google-login").hidden=reg;$("#portal-apple-login").hidden=reg;$("#portal-login-modal .portal-oauth-note").hidden=reg;form.dataset.mode=reg?"register":"login";$("#portal-login-title").textContent=reg?"KURO Labに新規登録":"KURO Labにログイン";$("#portal-login-submit").textContent=reg?"アカウントを作成":"ログイン";$("#portal-register-switch").textContent=reg?"ログインに戻る":"新規アカウント作成";$("#portal-login-password").autocomplete=reg?"new-password":"current-password";$("#portal-login-password").minLength=reg?8:1;$("#portal-login-error").textContent=reg?"メールアドレスと8文字以上のパスワードで登録できます。":"";};
 $("#portal-login-form").onsubmit=async function(e){
  e.preventDefault();var b=$("#portal-login-submit"),reg=this.dataset.mode==="register",email=$("#portal-login-email").value.trim(),password=$("#portal-login-password").value;
  b.disabled=true;$("#portal-login-error").textContent="";
  try{
   if(!db)throw new Error("認証ライブラリを読み込めませんでした。ページを再読み込みしてお試しください。");
   var r=reg?await db.auth.signUp({email:email,password:password,options:{emailRedirectTo:location.origin+"/mypage/"}}):await db.auth.signInWithPassword({email:email,password:password});
   if(r.error)throw r.error;
   $("#portal-login-password").value="";
   if(reg&&!r.data.session){$("#portal-login-error").textContent="確認メールを送信しました。メール内のリンクから登録を完了してください。";return;}
   $("#portal-login-modal").hidden=true;toast(reg?"アカウントを作成しました。同期しています…":"ログインしました。同期しています…");
  }catch(err){
   var msg=String(err&&err.message||err||"通信エラー");
   $("#portal-login-error").textContent=(reg?"新規登録できませんでした：":"ログインできませんでした：")+msg+(useGas?"（GAS中継通信）":"");
   console.error("KURO portal auth error",err);
  }finally{b.disabled=false;}
 };
}
async function init(){st.data=load();guest();document.body.dataset.theme=st.data.preferences.theme||"light";document.body.dataset.transport=useGas?"gas":"direct";document.title=titles[page][0]+"｜KURO Lab";var md=$('meta[name="description"]');if(md)md.content=titles[page][1];$("#portal-desktop-nav").innerHTML=nav.map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'>'+x[1]+'</a>';}).join("");$("#portal-mobile-nav").innerHTML=nav.filter(function(x){return ["home","search","favorites","notifications","mypage"].indexOf(x[0])>=0;}).map(function(x){return '<a href="'+x[3]+'" '+(x[0]===page?'aria-current="page"':"")+'><span>'+x[2]+'</span><span>'+x[1]+'</span></a>';}).join("");initLogin();render();if(!db){console.error("KURO Supabase SDK could not be loaded");return;}var a=await db.from("portal_announcements").select("id,title,body,href,created_at").eq("published",true).order("created_at",{ascending:false}).limit(20);if(!a.error)st.ann=a.data||[];var ss=await db.auth.getSession();st.user=ss.data&&ss.data.session?ss.data.session.user:null;if(st.user)await sync();db.auth.onAuthStateChange(function(ev,session){st.user=session?session.user:null;if(ev==="PASSWORD_RECOVERY"){setRecoveryMode(true);$("#portal-login-modal").hidden=false;}if(ev==="SIGNED_IN"&&st.user)setTimeout(sync,0);render();});function recordVisit(item){var h={item_key:item.key,title:item.title,href:item.href,visited_at:new Date().toISOString()},i=st.data.history.findIndex(function(x){return x.item_key===item.key;});if(i>=0)st.data.history.splice(i,1);st.data.history.unshift(h);st.data.history=st.data.history.slice(0,100);save();if(st.user)db.from("portal_history").upsert(Object.assign({user_id:st.user.id},h),{onConflict:"user_id,item_key"});}
var item=catalog.find(function(x){return x.href.slice(0,-1)===path;});if(item)recordVisit(item);document.addEventListener("click",function(e){var a=e.target.closest("a[href]");if(!a)return;var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;var destination=catalog.find(function(x){return x.href===u.pathname;});if(destination)recordVisit(destination);});render();}
init().catch(function(e){console.error(e);render();});
})();

(function(){
"use strict";
var root=null,active=null,clockTimer=null,feeds=[],newsCache=null,isToolPage=false;
var defaults=[
 {id:"weather",icon:"🌦️",name:"天気予報",desc:"地域ごとの現在の天気と今日の予報"},
 {id:"news",icon:"📰",name:"ニュースまとめ",desc:"複数メディアの最新記事をまとめて確認"},
 {id:"worldclock",icon:"🌐",name:"世界時計",desc:"世界の主要都市の現在時刻"},
 {id:"convert",icon:"💱",name:"為替・単位変換",desc:"最新為替レートと日常単位の変換"},
 {id:"rss",icon:"📡",name:"RSSリーダー",desc:"好きなサイトのフィードを登録して読む"},
 {id:"status",icon:"📶",name:"サイト稼働状況",desc:"Webサイトの応答状態と速度を確認"}
];
var requestedTool=new URLSearchParams(location.search).get("tool");
if(defaults.some(function(x){return x.id===requestedTool;})){active=requestedTool;isToolPage=true;}
var newsSources=[
 {name:"NHK 主要ニュース",url:"https://www3.nhk.or.jp/rss/news/cat0.xml"},
 {name:"BBC World",url:"https://feeds.bbci.co.uk/news/world/rss.xml"}
];
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function safeUrl(v){try{var u=new URL(String(v||"").trim());return (u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password?u.href:"";}catch(e){return "";}}
function readLocal(key,fallback){try{var value=localStorage.getItem(key);return value==null?fallback:value;}catch(e){return fallback;}}
function loadFeeds(){try{var x=JSON.parse(readLocal("kuro_toolbox_rss","[]"));return Array.isArray(x)?x.filter(function(f){return f&&safeUrl(f.url);}).slice(0,12).map(function(f,i){return {id:String(f.id||("feed_"+i)).slice(0,64),url:safeUrl(f.url),title:String(f.title||"").slice(0,160)};}):[];}catch(e){return [];}}
function saveFeeds(){try{localStorage.setItem("kuro_toolbox_rss",JSON.stringify(feeds));}catch(e){console.warn("KURO Toolbox: RSS settings could not be saved",e);}}
function shell(){
 var panel='<section class="tb-panel" id="tb-panel" aria-live="polite"></section>';
 var note='<p class="tb-footnote">一部の情報は外部サービスから取得します。取得できない場合は、時間をおいて再試行してください。</p>';
 if(isToolPage){
  return '<div class="tb-tool-page-top"><a class="tb-back-link" href="/tools/">← ツール一覧</a><span class="tb-page-index">KURO LAB / TOOLBOX</span></div>'+panel+note;
 }
 return '<section class="tb-hero"><div><span class="tb-eyebrow">KURO LAB / TOOLBOX</span><h2>毎日の作業を、ここから。</h2><p>情報収集・時刻確認・変換など、使いたいツールを選んでください。</p><div class="tb-hero-meta"><span>6 TOOLS</span><span>各ツールは専用ページで開きます</span></div></div><div class="tb-hero-mark">⌘</div></section><div class="tb-directory-heading"><div><b>ツール一覧</b><small>使いたい機能を選択</small></div><span>6 SERVICES</span></div><div class="tb-tool-grid" role="list">'+defaults.map(function(x){return '<a href="/tools/?tool='+x.id+'" class="tb-tool-card" role="listitem"><span class="tb-tool-icon">'+x.icon+'</span><span class="tb-tool-copy"><b>'+x.name+'</b><small>'+x.desc+'</small></span><span class="tb-tool-arrow">↗</span></a>';}).join("")+'</div><p class="tb-directory-note">ツールを選ぶと、専用画面に移動します。入力したRSSフィードや地域設定は、このブラウザーに保存されます。</p>';
}
function panelHead(icon,title,desc){return '<div class="tb-panel-head"><div class="tb-panel-icon">'+icon+'</div><div><h3>'+title+'</h3><p>'+desc+'</p></div></div>';}
function renderPanel(){
 if(clockTimer){clearInterval(clockTimer);clockTimer=null;}
 if(!root||!isToolPage||!active)return;
 var panel=root.querySelector("#tb-panel");if(!panel)return;
 var html="";
 if(active==="weather")html=weatherPanel();
 if(active==="news")html=newsPanel();
 if(active==="worldclock")html=clockPanel();
 if(active==="convert")html=convertPanel();
 if(active==="rss")html=rssPanel();
 if(active==="status")html=statusPanel();
 panel.innerHTML=html;bindPanel();
 if(active==="worldclock"){updateClocks();clockTimer=setInterval(updateClocks,1000);}
 if(active==="news")loadNews(false);
 if(active==="rss")feeds.forEach(function(f){loadFeed(f.id,false);});
}
function weatherPanel(){
 var city=readLocal("kuro_toolbox_city","東京")||"東京";
 return panelHead("🌦️","天気予報","地域を検索して、現在の天気と5日間の予報を確認できます。")+
 '<form class="tb-inline-form" id="tb-weather-form"><label class="tb-field-grow"><span>地域名</span><input id="tb-weather-city" value="'+esc(city)+'" maxlength="40" placeholder="例：東京、大阪、札幌" required></label><button class="tb-primary">天気を取得</button></form>'+
 '<div id="tb-weather-result" class="tb-result"><div class="tb-loading">天気情報を読み込んでいます…</div></div><small class="tb-source">気象データ：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>。予報は目安としてご利用ください。</small>';
}
function newsPanel(){
 return panelHead("📰","ニュースまとめ","公開ニュースフィードの記事を集めて、新着順に表示します。")+
 '<div class="tb-news-toolbar"><label class="tb-news-search"><span>記事を検索</span><input id="tb-news-search" type="search" placeholder="キーワードを入力…"></label><button type="button" class="tb-secondary" id="tb-news-refresh">更新する</button></div>'+
 '<div id="tb-news-result" class="tb-news-list"><div class="tb-loading">ニュースを読み込んでいます…</div></div><small class="tb-source">NHK・BBCの公開RSSを利用します。記事の詳細は各配信元でご確認ください。</small>';
}
function clockPanel(){var zones=[["東京","Asia/Tokyo"],["ロンドン","Europe/London"],["ニューヨーク","America/New_York"],["ロサンゼルス","America/Los_Angeles"],["シンガポール","Asia/Singapore"],["シドニー","Australia/Sydney"],["ドバイ","Asia/Dubai"],["パリ","Europe/Paris"]];return panelHead("🌐","世界時計","都市ごとの現地時刻をリアルタイム表示します。")+'<div class="tb-clock-grid">'+zones.map(function(z){return '<div class="tb-clock-card"><span>'+z[0]+'</span><b data-tz="'+z[1]+'">--:--:--</b><small>'+z[1]+'</small></div>';}).join("")+'</div>';}
function convertPanel(){
 return panelHead("💱","為替・単位変換","為替は公開レートを取得し、単位変換は端末内で計算します。")+
 '<div class="tb-convert-columns"><section class="tb-subtool"><h4>為替レート</h4><div class="tb-convert-row"><label>金額<input id="tb-fx-amount" type="number" min="0" step="any" value="100"></label><label>変換元<select id="tb-fx-base"><option>JPY</option><option selected>USD</option><option>EUR</option><option>GBP</option><option>AUD</option><option>CAD</option><option>CNY</option><option>KRW</option></select></label></div><div class="tb-convert-row"><label>変換先<select id="tb-fx-target"><option selected>JPY</option><option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option><option>CAD</option><option>CNY</option><option>KRW</option></select></label><button type="button" class="tb-primary" id="tb-fx-run">換算する</button></div><button type="button" class="tb-swap" id="tb-fx-swap">⇄ 通貨を入れ替える</button><div id="tb-fx-result" class="tb-convert-result">換算額を表示します</div><small class="tb-source">Frankfurter 公開為替データ。市場価格とは異なる場合があります。</small></section>'+
 '<section class="tb-subtool"><h4>単位変換</h4><label class="tb-wide-label">種類<select id="tb-unit-kind"><option value="length">長さ</option><option value="weight">重さ</option><option value="temperature">温度</option><option value="volume">体積</option></select></label><div class="tb-convert-row"><label>数値<input id="tb-unit-value" type="number" step="any" value="1"></label><label>変換元<select id="tb-unit-from"></select></label></div><div class="tb-convert-row"><label>変換先<select id="tb-unit-to"></select></label><button type="button" class="tb-primary" id="tb-unit-run">変換する</button></div><button type="button" class="tb-swap" id="tb-unit-swap">⇄ 単位を入れ替える</button><div id="tb-unit-result" class="tb-convert-result">変換結果を表示します</div></section></div>';
}
function rssPanel(){return panelHead("📡","RSSリーダー","ニュースサイトやブログの公開RSS / Atomフィードを登録できます。")+'<form id="tb-rss-form" class="tb-inline-form"><label class="tb-field-grow"><span>フィードURL</span><input id="tb-rss-url" type="url" placeholder="https://example.com/feed.xml" required></label><button class="tb-primary">追加</button></form><div id="tb-rss-list" class="tb-rss-list">'+(feeds.length?feeds.map(function(f){return '<section class="tb-rss-feed" data-feed="'+esc(f.id)+'"><div class="tb-feed-head"><b>'+esc(f.title||f.url)+'</b><div><button type="button" class="tb-secondary" data-feed-refresh="'+esc(f.id)+'">更新</button><button type="button" class="tb-remove" data-feed-remove="'+esc(f.id)+'" aria-label="削除">×</button></div></div><div class="tb-feed-items" id="tb-feed-items-'+esc(f.id)+'"><div class="tb-loading">読み込み中…</div></div></section>';}).join(""):'<div class="tb-empty">まだフィードがありません。上の欄にRSS / AtomのURLを入力してください。</div>')+'</div><small class="tb-source">公開フィードのみ対応。ログインが必要なURLや秘密情報を含むURLは登録しないでください。</small>';}
function statusPanel(){
 return panelHead("📶","サイト稼働状況","公開Webサイトに接続し、HTTP応答と応答時間をその場で確認します。")+
 '<form id="tb-status-form" class="tb-inline-form"><label class="tb-field-grow"><span>確認するサイト（HTTPS推奨）</span><input id="tb-status-url" type="url" value="https://kurolab.cc.cd/" placeholder="https://example.com/" required></label><button class="tb-primary">チェックする</button></form>'+
 '<div id="tb-status-result" class="tb-result"><div class="tb-muted">URLを入力してチェックしてください。</div></div><small class="tb-source">単発の応答チェックです。常時監視や障害通知ではありません。公開サイトのHTTP / HTTPS URLのみ確認できます。</small>';
}
function parseFeed(xml){var doc=new DOMParser().parseFromString(xml,"application/xml");if(doc.getElementsByTagName("parsererror").length)throw new Error("RSS / Atomの形式を読み取れませんでした");function first(node,names){return Array.from(node.getElementsByTagName("*")).find(function(el){var name=String(el.localName||el.nodeName.split(":").pop()).toLowerCase();return names.indexOf(name)>=0;})||null;}var title=first(doc,["title"]);var nodes=Array.from(doc.getElementsByTagName("*")).filter(function(el){var name=String(el.localName||el.nodeName.split(":").pop()).toLowerCase();return name==="item"||name==="entry";}).slice(0,10);var items=nodes.map(function(n){var t=first(n,["title"]),l=first(n,["link"]),d=first(n,["pubdate","published","updated","date"]),desc=first(n,["description","summary","content"]);var href=l?(l.getAttribute("href")||l.textContent.trim()):"";return {title:t?(t.textContent||"").trim():"（タイトルなし）",url:safeUrl(href),date:d?(d.textContent||"").trim():"",summary:desc?(desc.textContent||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,240):""};}).filter(function(x){return x.url;});return {title:title?(title.textContent||"").trim():"",items:items};}
function fetchFeed(url){return fetch("/api/workspace-rss?url="+encodeURIComponent(url),{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("フィード取得エラー（"+r.status+"）");return r.text();}).then(parseFeed);}
function articleMarkup(x,source){
 var searchText=(source+" "+x.title+" "+x.summary).toLowerCase();
 return '<article class="tb-news-item" data-search="'+esc(searchText)+'"><div><span class="tb-news-source">'+esc(source)+'</span>'+(x.date?'<time>'+esc(x.date.slice(0,32))+'</time>':"")+'</div><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.title)+'</a>'+(x.summary?'<p>'+esc(x.summary)+'</p>':"")+'</article>';
}
function hasJapanese(text){return /[ぁ-ゖァ-ヺー]/.test(String(text||""));}
function translateNewsItem(item){
 if(hasJapanese(item.title))return Promise.resolve(item);
 var marker="\n---KURO-SUMMARY---\n";
 var text=String(item.title||"")+(item.summary?marker+item.summary:"");
 var url="https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q="+encodeURIComponent(text);
 return fetch(url,{cache:"force-cache"}).then(function(r){if(!r.ok)throw new Error("翻訳サービスに接続できません");return r.json();}).then(function(data){
  var translated=(data[0]||[]).map(function(part){return part[0]||"";}).join("");
  if(!translated)return item;
  var pieces=translated.split(marker);
  return Object.assign({},item,{title:pieces[0]||item.title,summary:pieces.length>1?pieces.slice(1).join(marker):item.summary});
 }).catch(function(){return item;});
}
function translateNewsItems(items){
 var next=0,workers=[];
 for(var w=0;w<3;w++)workers.push((function(){return new Promise(function(resolve){function run(){if(next>=items.length){resolve();return;}var i=next++;translateNewsItem(items[i]).then(function(result){items[i]=result;run();});}run();});})());
 return Promise.all(workers).then(function(){return items;});
}
function loadNews(force){
 var box=document.getElementById("tb-news-result");if(!box)return;
 if(newsCache&&!force&&Date.now()-newsCache.at<300000){box.innerHTML=newsCache.html;filterNews();return;}
 box.innerHTML='<div class="tb-loading">ニュースを取得しています…</div>';
 Promise.all(newsSources.map(function(src){return fetchFeed(src.url).then(function(data){return {name:src.name,data:data};}).catch(function(e){return {name:src.name,error:e};});})).then(function(results){
  var all=[],errors=[];
  results.forEach(function(r){if(r.data)r.data.items.forEach(function(x){all.push({item:x,source:r.data.title||r.name});});else errors.push(r.name+"： "+(r.error&&r.error.message||"取得できませんでした"));});
  all.sort(function(a,b){var da=Date.parse(a.item.date)||0,db=Date.parse(b.item.date)||0;return db-da;});
  var errorHtml=errors.length?'<div class="tb-feed-warning">'+errors.map(esc).join(" / ")+'</div>':"";
  var current=document.getElementById("tb-news-result");
  if(current)current.innerHTML='<div class="tb-loading">英語の記事を日本語に翻訳しています…</div>';
  translateNewsItems(all.slice(0,24).map(function(x){return x.item;})).then(function(translated){
   var html=all.length?'<div class="tb-news-summary"><b>最新 '+Math.min(all.length,24)+' 件</b><span>英語記事は日本語訳で表示</span></div>'+errorHtml+all.slice(0,24).map(function(x,i){return articleMarkup(translated[i],x.source);}).join(""):errorHtml+'<div class="tb-empty">ニュースを取得できませんでした。時間をおいて再試行してください。</div>';
   newsCache={at:Date.now(),html:html};
   var box=document.getElementById("tb-news-result");if(box){box.innerHTML=html;filterNews();}
  });
 });
}
function filterNews(){
 var input=document.getElementById("tb-news-search"),box=document.getElementById("tb-news-result");if(!box)return;
 var query=String(input&&input.value||"").trim().toLowerCase();
 box.querySelectorAll(".tb-news-item").forEach(function(item){item.hidden=!!query&&String(item.dataset.search||"").indexOf(query)<0;});
 var visible=Array.from(box.querySelectorAll(".tb-news-item")).some(function(item){return !item.hidden;});
 var old=box.querySelector(".tb-news-no-match");if(old)old.remove();
 if(query&&!visible){var empty=document.createElement("div");empty.className="tb-empty tb-news-no-match";empty.textContent="一致する記事がありません。";box.appendChild(empty);}
}
function loadFeed(id,force){var f=feeds.find(function(x){return x.id===id;});if(!f)return;var box=document.getElementById("tb-feed-items-"+id);if(!box)return;box.innerHTML='<div class="tb-loading">読み込み中…</div>';fetchFeed(f.url).then(function(data){if(data.title)f.title=data.title;saveFeeds();if(box)box.innerHTML=data.items.length?data.items.map(function(x){return articleMarkup(x,f.title||f.url);}).join(""):'<div class="tb-empty">新着記事がありません。</div>';var feedCard=Array.from(document.querySelectorAll("[data-feed]")).find(function(el){return el.dataset.feed===id;});var head=feedCard&&feedCard.querySelector(".tb-feed-head b");if(head)head.textContent=f.title||f.url;}).catch(function(e){if(box)box.innerHTML='<div class="tb-empty">'+esc(e.message||"フィードを取得できませんでした")+'</div>';});}
function weatherCode(code){var m={0:"快晴",1:"晴れ",2:"晴れ時々くもり",3:"くもり",45:"霧",48:"霧",51:"弱い霧雨",53:"霧雨",55:"強い霧雨",61:"弱い雨",63:"雨",65:"強い雨",71:"弱い雪",73:"雪",75:"大雪",80:"にわか雨",81:"雨",82:"強い雨",95:"雷雨",96:"ひょうを伴う雷雨",99:"激しい雷雨"};return m[code]||"天気情報";}
function getWeather(){
 var input=document.getElementById("tb-weather-city"),box=document.getElementById("tb-weather-result");
 var city=input&&input.value.trim();if(!city||!box)return;
 try{localStorage.setItem("kuro_toolbox_city",city);}catch(e){}
 box.innerHTML='<div class="tb-loading">'+esc(city)+'の天気を取得しています…</div>';
 fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(city)+"&count=5&language=ja&format=json")
 .then(function(r){if(!r.ok)throw new Error("地域を検索できませんでした");return r.json();})
 .then(function(g){
  var place=(g.results||[]).find(function(x){return x.country_code==="JP";})||(g.results||[])[0];
  if(!place)throw new Error("地域が見つかりません。別の表記で試してください。");
  var q="https://api.open-meteo.com/v1/forecast?latitude="+place.latitude+"&longitude="+place.longitude+"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5";
  return fetch(q).then(function(r){if(!r.ok)throw new Error("天気データを取得できませんでした");return r.json();}).then(function(d){return {place:place,data:d};});
 })
 .then(function(x){
  var c=x.data.current||{},d=x.data.daily||{};
  var emoji=function(code){return code===0||code===1?"☀️":code===2?"🌤️":code===3?"☁️":code>=95?"⛈️":code>=71&&code<=77?"❄️":code>=51?"🌧️":"🌫️";};
  var days=(d.time||[]).map(function(day,i){
   var label;try{label=new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",weekday:"short"}).format(new Date(day+"T00:00:00"));}catch(e){label=day;}
   return '<div class="tb-forecast-day"><small>'+esc(label)+'</small><b>'+emoji(d.weather_code&&d.weather_code[i])+'</b><strong>'+Math.round(d.temperature_2m_max&&d.temperature_2m_max[i])+'°</strong><span>'+Math.round(d.temperature_2m_min&&d.temperature_2m_min[i])+'°</span><i>☂ '+(d.precipitation_probability_max&&d.precipitation_probability_max[i]!=null?Math.round(d.precipitation_probability_max[i]):"—")+'%</i></div>';
  }).join("");
  box.innerHTML='<div class="tb-weather-main"><div><span>'+esc(x.place.name)+' / '+esc(x.place.country||"")+'</span><strong>'+Math.round(c.temperature_2m)+'°</strong><b>'+emoji(c.weather_code)+' '+weatherCode(c.weather_code)+'</b></div><div class="tb-weather-symbol">'+emoji(c.weather_code)+'</div></div><div class="tb-weather-stats"><div><small>最高気温</small><b>'+Math.round(d.temperature_2m_max&&d.temperature_2m_max[0])+'°</b></div><div><small>最低気温</small><b>'+Math.round(d.temperature_2m_min&&d.temperature_2m_min[0])+'°</b></div><div><small>降水確率</small><b>'+Math.round(d.precipitation_probability_max&&d.precipitation_probability_max[0]||0)+'%</b></div><div><small>風速</small><b>'+Math.round(c.wind_speed_10m||0)+' km/h</b></div><div><small>体感温度</small><b>'+Math.round(c.apparent_temperature)+'°</b></div></div><div class="tb-forecast-wrap"><div class="tb-section-label">5日間の予報</div><div class="tb-weather-forecast">'+days+'</div></div>';
 })
 .catch(function(e){box.innerHTML='<div class="tb-empty">'+esc(e.message||"天気を取得できませんでした")+'</div>';});
}
function updateClocks(){document.querySelectorAll("[data-tz]").forEach(function(el){try{el.textContent=new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:el.dataset.tz}).format(new Date());}catch(e){}});}
function fxConvert(){var amountInput=document.getElementById("tb-fx-amount"),baseInput=document.getElementById("tb-fx-base"),targetInput=document.getElementById("tb-fx-target"),out=document.getElementById("tb-fx-result");if(!amountInput||!baseInput||!targetInput||!out)return;var raw=amountInput.value,amount=Number(raw),base=baseInput.value,target=targetInput.value;if(raw.trim()===""||!Number.isFinite(amount)||amount<0){out.textContent="0以上の金額を入力してください";return;}if(base===target){out.textContent=amount.toLocaleString("ja-JP")+" "+target;return;}out.textContent="レート取得中…";fetch("https://api.frankfurter.dev/v1/latest?base="+encodeURIComponent(base)+"&symbols="+encodeURIComponent(target)).then(function(r){if(!r.ok)throw new Error("為替レートを取得できません");return r.json();}).then(function(d){var rate=Number(d&&d.rates&&d.rates[target]),converted=amount*rate;if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(converted))throw new Error("有効な為替レートが返されませんでした");out.innerHTML='<strong>'+esc(converted.toLocaleString("ja-JP",{maximumFractionDigits:4}))+' '+esc(target)+'</strong><small>1 '+esc(base)+' = '+esc(rate)+' '+esc(target)+' / '+esc(d.date||"")+'</small>';}).catch(function(e){out.textContent=e.message||"為替レートを取得できませんでした";});}
var units={length:{mm:0.001,cm:0.01,m:1,km:1000,in:0.0254,ft:0.3048,mi:1609.344},weight:{mg:0.000001,g:0.001,kg:1,t:1000,oz:0.028349523125,lb:0.45359237},volume:{ml:0.001,l:1,m3:1000,gal:3.785411784},temperature:null};
var unitLabels={mm:"mm",cm:"cm",m:"m",km:"km",in:"インチ",ft:"フィート",mi:"マイル",mg:"mg",g:"g",kg:"kg",t:"t",oz:"oz",lb:"lb",ml:"mL",l:"L",m3:"m³",gal:"US gal",c:"℃",f:"℉",k:"K"};
function setUnitOptions(){var kind=document.getElementById("tb-unit-kind"),from=document.getElementById("tb-unit-from"),to=document.getElementById("tb-unit-to");if(!kind||!from||!to)return;var keys=kind.value==="temperature"?["c","f","k"]:Object.keys(units[kind.value]);var opts=keys.map(function(k){return '<option value="'+k+'">'+unitLabels[k]+'</option>';}).join("");from.innerHTML=opts;to.innerHTML=opts;to.selectedIndex=Math.min(1,keys.length-1);}
function unitConvert(){var kindInput=document.getElementById("tb-unit-kind"),valueInput=document.getElementById("tb-unit-value"),fromInput=document.getElementById("tb-unit-from"),toInput=document.getElementById("tb-unit-to"),out=document.getElementById("tb-unit-result");if(!kindInput||!valueInput||!fromInput||!toInput||!out)return;var kind=kindInput.value,raw=valueInput.value,n=Number(raw),from=fromInput.value,to=toInput.value;if(raw.trim()===""||!Number.isFinite(n)){out.textContent="有効な数値を入力してください";return;}var v;if(kind==="temperature"){var c=from==="c"?n:from==="f"?(n-32)*5/9:n-273.15;v=to==="c"?c:to==="f"?c*9/5+32:c+273.15;}else if(units[kind]&&units[kind][from]!=null&&units[kind][to]!=null){v=n*units[kind][from]/units[kind][to];}else{out.textContent="この単位の組み合わせには対応していません";return;}if(!Number.isFinite(v)){out.textContent="数値が大きすぎるため変換できません";return;}out.innerHTML='<strong>'+esc(Number(v.toPrecision(10)).toLocaleString("ja-JP"))+' '+esc(unitLabels[to]||to)+'</strong>';}
function checkSite(){var url=safeUrl(document.getElementById("tb-status-url").value),out=document.getElementById("tb-status-result");if(!url){out.innerHTML='<div class="tb-empty">有効なHTTP / HTTPS URLを入力してください。</div>';return;}out.innerHTML='<div class="tb-loading">サイトに接続しています…</div>';fetch("/api/site-status?url="+encodeURIComponent(url),{cache:"no-store"}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"チェックできませんでした");return j;});}).then(function(d){out.innerHTML='<div class="tb-status-card '+(d.ok?"is-up":"is-down")+'"><span class="tb-status-dot"></span><div><b>'+(d.ok?"応答あり":"エラー応答")+'</b><small>'+esc(d.finalUrl||url)+'</small></div><strong>'+d.status+'</strong></div><div class="tb-status-stats"><div><small>応答時間</small><b>'+d.elapsedMs+' ms</b></div><div><small>HTTPステータス</small><b>'+d.status+'</b></div><div><small>確認日時</small><b>'+new Date().toLocaleTimeString("ja-JP")+'</b></div></div>';}).catch(function(e){out.innerHTML='<div class="tb-status-card is-down"><span class="tb-status-dot"></span><div><b>接続できませんでした</b><small>'+esc(e.message||"ネットワークエラー")+'</small></div></div>';});}
function bindPanel(){
 var wf=document.getElementById("tb-weather-form");if(wf)wf.onsubmit=function(e){e.preventDefault();getWeather();};
 var nr=document.getElementById("tb-news-refresh");if(nr)nr.onclick=function(){newsCache=null;loadNews(true);};
 var nf=document.getElementById("tb-news-search");if(nf)nf.oninput=filterNews;
 var ff=document.getElementById("tb-fx-run");if(ff)ff.onclick=fxConvert;
 var fs=document.getElementById("tb-fx-swap");if(fs)fs.onclick=function(){var a=document.getElementById("tb-fx-base"),b=document.getElementById("tb-fx-target"),v=a.value;a.value=b.value;b.value=v;fxConvert();};
 var uk=document.getElementById("tb-unit-kind");if(uk)uk.onchange=function(){setUnitOptions();unitConvert();};
 var ur=document.getElementById("tb-unit-run");if(ur)ur.onclick=unitConvert;
 var us=document.getElementById("tb-unit-swap");if(us)us.onclick=function(){var a=document.getElementById("tb-unit-from"),b=document.getElementById("tb-unit-to"),v=a.value;a.value=b.value;b.value=v;unitConvert();};
 if(active==="convert")setUnitOptions();
 var rf=document.getElementById("tb-rss-form");if(rf)rf.onsubmit=function(e){e.preventDefault();var url=safeUrl(document.getElementById("tb-rss-url").value);if(!url||!/^https:\/\//i.test(url)){alert("HTTPSの公開フィードURLを入力してください");return;}if(feeds.some(function(f){return f.url===url;})){alert("このフィードは登録済みです");return;}if(feeds.length>=12){alert("フィードは最大12件までです");return;}var f={id:"feed_"+Date.now(),url:url,title:new URL(url).hostname};feeds.push(f);saveFeeds();renderPanel();};
 var sf=document.getElementById("tb-status-form");if(sf)sf.onsubmit=function(e){e.preventDefault();checkSite();};
 var panel=document.getElementById("tb-panel");if(panel)panel.onclick=function(e){var r=e.target.closest("[data-feed-refresh]");if(r){loadFeed(r.dataset.feedRefresh,true);return;}var d=e.target.closest("[data-feed-remove]");if(d){feeds=feeds.filter(function(f){return f.id!==d.dataset.feedRemove;});saveFeeds();renderPanel();}};
 if(active==="weather")getWeather();
 if(active==="convert"){fxConvert();unitConvert();}
}
function mount(){
 var path=location.pathname.replace(/\/+$/,"")||"/";
 var node=document.getElementById("kuro-toolbox-root");
 if(!node&&path==="/tools")node=document.getElementById("portal-main");
 if(!node)return;
 if(clockTimer){clearInterval(clockTimer);clockTimer=null;}
 root=node;feeds=loadFeeds();root.innerHTML=shell();
 if(isToolPage){
  var selected=defaults.find(function(x){return x.id===active;});
  if(selected){document.title=selected.name+"｜ツールボックス｜KURO Lab";renderPanel();}
 }else{document.title="ツールボックス｜KURO Lab";}
}
window.addEventListener("kuro:portal-rendered",mount);
window.addEventListener("kuro:portal-api-ready",mount);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
window.addEventListener("pagehide",function(){if(clockTimer)clearInterval(clockTimer);});
})();
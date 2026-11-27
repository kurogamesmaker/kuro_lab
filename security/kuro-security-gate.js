(function(){
"use strict";
const STYLE_ID="kuro-security-gate-style";
function ensureStyle(){
 if(document.getElementById(STYLE_ID))return;
 const style=document.createElement("style");style.id=STYLE_ID;
 style.textContent=`
 #kuroSecurityGateOverlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 20%,#172a48 0%,#080d18 64%);color:#eef6ff;font:14px/1.6 Inter,"Noto Sans JP",system-ui,sans-serif}
 #kuroSecurityGateOverlay .ksg-card{width:min(440px,100%);padding:28px;border:1px solid #344a68;border-radius:22px;background:linear-gradient(145deg,#121e30,#0c1421);box-shadow:0 28px 90px #0009;text-align:center}
 #kuroSecurityGateOverlay .ksg-icon{width:68px;height:68px;margin:0 auto 18px;display:grid;place-items:center;border:1px solid #3978a5;border-radius:20px;background:#102a42;color:#73d2ff;font-size:32px}
 #kuroSecurityGateOverlay h2{margin:0;font-size:20px;letter-spacing:.04em}
 #kuroSecurityGateOverlay .ksg-sub{margin:5px 0 19px;color:#8fa8c5;font-size:10px;letter-spacing:.18em}
 #kuroSecurityGateOverlay .ksg-message{min-height:44px;color:#d3dfef;font-size:12px}
 #kuroSecurityGateOverlay .ksg-line{height:5px;margin:20px 0 12px;overflow:hidden;border-radius:99px;background:#22344b}
 #kuroSecurityGateOverlay .ksg-line:after{content:"";display:block;width:38%;height:100%;border-radius:99px;background:linear-gradient(90deg,#3887b8,#78e0ff);animation:ksg-scan 1.15s ease-in-out infinite}
 #kuroSecurityGateOverlay .ksg-state{color:#79d4ff;font-size:10px;font-weight:900;letter-spacing:.12em}
 #kuroSecurityGateOverlay[data-state="deny"] .ksg-icon{border-color:#87495a;background:#361a29;color:#ff9ba9}
 #kuroSecurityGateOverlay[data-state="deny"] .ksg-state{color:#ff9ba9}
 #kuroSecurityGateOverlay[data-state="ok"] .ksg-icon{border-color:#3b8d72;background:#12352e;color:#7be2bd}
 #kuroSecurityGateOverlay[data-state="ok"] .ksg-state{color:#7be2bd}
 @keyframes ksg-scan{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}
 `;
 document.head.appendChild(style);
}
function show(message,state){
 ensureStyle();
 let el=document.getElementById("kuroSecurityGateOverlay");
 if(!el){
  el=document.createElement("div");el.id="kuroSecurityGateOverlay";el.setAttribute("role","status");el.setAttribute("aria-live","polite");
  el.innerHTML='<div class="ksg-card"><div class="ksg-icon" id="ksgIcon">◈</div><h2>KURO SECURITY GATE</h2><div class="ksg-sub">INTELLIGENT ACCESS VERIFICATION</div><div class="ksg-message" id="ksgMessage"></div><div class="ksg-line"></div><div class="ksg-state" id="ksgState">VERIFYING ACCESS</div></div>';
  document.body.appendChild(el);
 }
 el.dataset.state=state||"checking";
 const m=document.getElementById("ksgMessage"),s=document.getElementById("ksgState"),i=document.getElementById("ksgIcon");
 if(m)m.textContent=message||"アカウント、管理権限、セッション、接続環境を確認しています。";
 if(s)s.textContent=state==="deny"?"ACCESS BLOCKED":state==="ok"?"VERIFIED":"VERIFYING ACCESS";
 if(i)i.textContent=state==="deny"?"!":state==="ok"?"✓":"◈";
 return el;
}
function hide(){const el=document.getElementById("kuroSecurityGateOverlay");if(el)el.remove();}
async function verify(client,tool,options){
 const opts=options||{};
 if(!client||!client.functions)throw new Error("セキュリティ検証を開始できません。");
 if(opts.overlay!==false)show("アカウント・権限・セッション・接続環境を検証しています。","checking");
 try{
  const {data:sessionData,error:sessionError}=await client.auth.getSession();
  if(sessionError)throw sessionError;
  if(!sessionData.session?.access_token)throw new Error("ログイン状態を確認できません。再ログインしてください。");
  const {data,error}=await client.functions.invoke("kuro-security-gate",{body:{action:"check",tool:tool}});
  if(error)throw new Error(error.message||"セキュリティ検証に失敗しました。");
  if(!data||data.allowed!==true){
   const message=data?.message||"安全性を確認できないため、アクセスを拒否しました。";
   if(opts.overlay!==false){show(message,"deny");await new Promise(resolve=>setTimeout(resolve,900));hide();}
   throw new Error(message);
  }
  if(opts.overlay!==false){show(data.message||"セキュリティ検証に合格しました。","ok");await new Promise(resolve=>setTimeout(resolve,280));hide();}
  return data;
 }catch(error){
  if(opts.overlay!==false&&document.getElementById("kuroSecurityGateOverlay"))hide();
  throw error;
 }
}
window.KuroSecurityGate=Object.freeze({verify:verify});
})();
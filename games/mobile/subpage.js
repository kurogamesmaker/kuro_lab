"use strict";
(function(){
  const root=document.querySelector(".subpage-shell");
  if(!root)return;
  const page=root.dataset.page||"";
  const source=root.dataset.source||"";
  const frame=document.getElementById("subpageFrame");
  const loading=document.getElementById("subpageLoading");
  if(!frame||!source)return;

  function installFrameBridge(){
    try{
      const doc=frame.contentDocument;
      if(!doc)return;
      const style=doc.createElement("style");
      const hideHeader=page==="ranking"?".site-header{display:none!important}":"header{display:none!important}";
      const hideFooter=page==="mypage"?"footer{display:none!important}":"";
      style.textContent="html,body{min-height:100%!important}body{padding-bottom:calc(78px + env(safe-area-inset-bottom))!important}"+hideHeader+hideFooter;
      doc.head.appendChild(style);

      if(!doc.documentElement.dataset.kuroMobileAppBridge){
        doc.documentElement.dataset.kuroMobileAppBridge="1";
        doc.addEventListener("click",function(event){
          const link=event.target&&event.target.closest?event.target.closest("a[href]"):null;
          if(!link)return;
          let url;
          try{url=new URL(link.href,location.origin);}catch(_){return;}
          if(url.origin!==location.origin||!url.pathname.startsWith("/games/play/"))return;
          const gameId=url.searchParams.get("id");
          if(!gameId)return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          window.top.location.href="/games/mobile/play/?id="+encodeURIComponent(gameId);
        },true);
      }
    }catch(error){
      console.warn("[KURO GAMES MOBILE] subpage bridge unavailable:",error);
    }
  }

  frame.addEventListener("load",function(){
    if(loading)loading.hidden=true;
    installFrameBridge();
  });
  frame.src=source;

  document.querySelectorAll(".subpage-nav-item").forEach(item=>{
    if(item.dataset.page===page)item.classList.add("is-current");
  });
})();
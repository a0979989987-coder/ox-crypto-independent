(() => {
  "use strict";
  const themeLabel=v=>({dark:"深色",light:"淺色",system:"自動"}[v]||"自動");
  const marketLabel=v=>({crypto:"加密"}[v]||"加密");
  window.syncAccountSummary=function(){
    const email=typeof currentLocalAccountEmail==="function"?currentLocalAccountEmail():"";
    const root=document.getElementById("ox-account-summary");if(!root)return;
    root.hidden=!email;if(!email)return;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};
    let watch=0;try{watch=typeof getWatchlistRecords==="function"?getWatchlistRecords().length:0}catch{}
    set("ox-account-watch-count",String(watch));
    set("ox-account-theme",themeLabel(localStorage.getItem("ox-ui-theme")||"system"));
    set("ox-account-notify",localStorage.getItem("ox-control-notifications-enabled")==="1"?"開啟":"關閉");
    set("ox-account-market",marketLabel(localStorage.getItem("ox-active-market")||"crypto"));
    const tier=(localStorage.getItem("ox-scanner-tier-filter")||"t1").toUpperCase();
    const dir=localStorage.getItem("ox-scanner-direction-filter")==="short"?"空":"多";
    set("ox-account-radar",`${tier} · ${dir}`);
    const freq=localStorage.getItem("ox-setting-frequency")||"1h";
    set("ox-account-frequency",({"1h":"每 1 小時","daily":"每日","weekly":"每週"}[freq]||freq));
    set("ox-account-pref-state","收藏、主題、通知、雷達與市場偏好已綁定");
  };
  document.addEventListener("ox:themechange",()=>window.syncAccountSummary?.());
  document.addEventListener("ox:marketchange",()=>window.syncAccountSummary?.());
  document.addEventListener("click",e=>{
    if(e.target.closest?.("[data-watch-symbol],#ox-control-notify-toggle,#ox-control-sound-toggle,[data-theme-choice],[data-control-theme],[data-market-choice]"))
      setTimeout(()=>window.syncAccountSummary?.(),0);
  },true);
  window.addEventListener("storage",()=>window.syncAccountSummary?.());
  document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.syncAccountSummary?.(),80),{once:true});
})();

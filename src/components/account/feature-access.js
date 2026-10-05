/* Product access UX. Server/API authorization remains independent. No policy cache. */
(() => {
  if(window.OXCanonicalRedirecting)return;
  const ids=['crypto.home','crypto.radar','crypto.patterns','crypto.bubbles','crypto.strength','crypto.heatmap','crypto.rotation','crypto.flow','news.feed','news.calendar','media'];
  let policies=null,pending=null,loading=null,epoch=0,requestEpoch=0,currentFeature=null,newsSelected='calendar',sessionUsable=false,policyState='pending';
  const selected={crypto:'patterns'};
  const landing=new URL(location.href),returnId=landing.searchParams.get('ox_feature');
  let returning=ids.includes(returnId), started=false, lastRefresh=0;
  let panel,progress;
  const style=document.createElement('style');
  style.textContent='body.ox-feature-blocked main.wrap,body.ox-feature-blocked #market-unavailable-card{display:none!important}#ox-feature-gate{max-width:640px;margin:32px auto;padding:24px;border:1px solid #d5d0c6;border-radius:16px;background:#fffaf2;color:#24282b}#ox-feature-gate button{font:inherit;padding:10px 16px;margin:8px 10px 0 0;border:1px solid #b8afa0;border-radius:9px;background:#fff;color:inherit}@media(max-width:650px){#ox-feature-gate{margin:20px 12px}}';document.head.append(style);
  function showPending(){
    document.body?.classList.add('ox-feature-blocked');
    if(panel){panel.hidden=true;panel.style.display='none';}
    if(!progress){progress=document.createElement('div');progress.id='ox-feature-progress';progress.setAttribute('role','status');progress.textContent='載入中…';progress.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:6px 12px;font:12px system-ui;color:inherit;opacity:.7;pointer-events:none';document.body?.append(progress);}
    progress.hidden=false;
  }
  function gate(message,login=false){
    if(!policies&&policyState==='pending'){showPending();return;}
    if(progress)progress.hidden=true;
    document.body?.classList.add('ox-feature-blocked');
    if(!panel){panel=document.createElement('section');panel.id='ox-feature-gate';panel.setAttribute('role','status');
      const text=document.createElement('p');text.id='ox-feature-message';
      const sign=document.createElement('button');sign.id='ox-feature-login';sign.textContent='註冊／登入後繼續';sign.onclick=()=>window.OXAccount?.open();
      const retry=document.createElement('button');retry.textContent='重新讀取設定';retry.onclick=refresh;
      const home=document.createElement('button');home.textContent='回首頁';home.onclick=()=>{pending=null;window.switchAppView?.('home');};
      const choose=document.createElement('select');choose.id='ox-feature-choose';choose.setAttribute('aria-label','前往其他產品功能');choose.onchange=()=>{const id=choose.value;if(ids.includes(id)){const apply=()=>navigate(id);if(enter(id,apply))apply();}};
      panel.append(text,sign,retry,home,choose);document.body?.append(panel);}
    panel.hidden=false;panel.style.display='block';panel.querySelector('p').textContent=message;
    panel.querySelector('#ox-feature-login').hidden=!login;
    const choose=panel.querySelector('select');choose.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='前往其他功能';choose.append(placeholder);for(const row of policies?.values()||[]){const option=document.createElement('option');option.value=row.id;option.textContent=`${row.label}（${row.mode==='public'?'公開':'需登入'}）`;choose.append(option);}choose.hidden=!policies;
  }
  function reveal(){if(progress)progress.hidden=true;document.body?.classList.remove('ox-feature-blocked');if(panel){panel.hidden=true;panel.style.display='none';}}
  function viewFeature(view,market=document.body?.dataset.market||'crypto'){
    if(view==='strength')return market+'.'+selected[market];
    if(['home','radar'].includes(view))return market+'.'+view;
    if(['data','news'].includes(view))return newsSelected==='calendar'?'news.calendar':'news.feed';
    if(view==='media')return 'media';
    return null; // Login/settings/private Account are never part of this switch.
  }
  function allowed(id){const row=policies?.get(id);return !!row&&(row.mode==='public'||sessionUsable&&!!window.OXAuth?.user);}
  const policyMessage=()=>loading?'正在確認功能設定…':'功能設定暫時無法確認，已暫停此功能；請稍後重試。';
  function markReturn(id){const u=new URL(location.href);u.searchParams.set('ox_feature',id);history.replaceState(history.state,'',u.pathname+u.search+u.hash);}
  function cleanReturn(){const u=new URL(location.href);u.searchParams.delete('ox_feature');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}
  function enter(id,resume){
    if(!ids.includes(id))return false;
    if(started)returning=false;
    if(allowed(id)){currentFeature=id;pending=null;cleanReturn();reveal();return true;}
    pending={id,resume,epoch:++requestEpoch};markReturn(id);
    gate(policies?`「${policies.get(id)?.label||id}」需要註冊登入。無需綁定交易所或代理資格。`:policyMessage(),!!policies);
    return false;
  }
  function enterView(view){const id=viewFeature(view);if(!id){pending=null;currentFeature=null;reveal();return true;}return enter(id,()=>window.switchAppView?.(view));}
  function enterTool(tool,attribute,resume){
    const market=attribute==='data-crypto-tool'?'crypto':null;
    const id=market?market+'.'+tool:attribute==='data-news-tab'?(tool==='calendar'?'news.calendar':'news.feed'):null;
    if(!id||!ids.includes(id))return true;
    if(!enter(id,resume))return false;if(market)selected[market]=tool;else if(attribute==='data-news-tab')newsSelected=tool;return true;
  }
  function replay(){
    if(!document.body)return;
    if(pending&&allowed(pending.id)){
      const action=pending.resume;pending=null;cleanReturn();reveal();action?.();return;
    }
    if(pending){gate(policies?'此功能需要註冊登入，登入後可回到原功能。':policyMessage(),!!policies);return;}
    const id=currentFeature||viewFeature(document.body.dataset.view||'radar');
    if(id&&!allowed(id))gate(policies?'此功能需要註冊登入，登入後可回到原功能。':policyMessage(),!!policies);else reveal();
  }
  async function refresh(){
    if(loading)return loading;
    policyState='pending';if(!policies)showPending();const token=++epoch;
    lastRefresh=Date.now();
    loading=(async()=>{try{
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
      let response,data;try{[response,data]=await Promise.race([(async()=>{const r=await fetch('/api/v1/account/feature-access',{credentials:'same-origin',cache:'no-store',signal:abort.signal});return [r,await r.json()];})(),new Promise((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(new Error('policy timeout')),{once:true});})]);}finally{clearTimeout(timer);}
      if(Array.isArray(data.features))data.features=data.features.filter(f=>ids.includes(f.id));
      if(!response.ok||!data.ok||!Array.isArray(data.features)||data.features.length!==ids.length||new Set(data.features.map(f=>f.id)).size!==ids.length||data.features.some(f=>!ids.includes(f.id)||!['public','login'].includes(f.mode)))throw Error('invalid');
      if(token===epoch){policies=new Map(data.features.map(f=>[f.id,f]));policyState='ready';document.dispatchEvent(new CustomEvent('ox:feature-policy-ready'));}
    }catch{if(token===epoch){policies=null;policyState='error';}}finally{loading=null;replay();}
    // Public policy is independent of session availability; login products fail closed.
    if(token===epoch&&policies){
      sessionUsable=false;replay();
      void (async()=>{if(window.OXAuth?.user&&window.OXAuth.getCurrent){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);try{const user=await window.OXAuth.getCurrent({signal:abort.signal});if(token===epoch)sessionUsable=!!user&&!!window.OXAuth.user;}catch{if(token===epoch)sessionUsable=false;}finally{clearTimeout(timer);}}
      else sessionUsable=!!window.OXAuth?.user;
      if(token===epoch)replay();})();
    }
    })();return loading;
  }
  function navigate(id){
    const market=id.split('.')[0];
    if(['crypto'].includes(market))window.OXMarketController?.setMarket?.(market);
    if(id.startsWith('news.')){newsSelected=id==='news.calendar'?'calendar':'key';window.OXNews?.openMarket();document.dispatchEvent(new CustomEvent('ox:feature-news-return',{detail:{tab:newsSelected}}));}
    else if(id==='media')window.switchAppView?.('media');
    else {const tool=id.split('.')[1];const view=['home','radar'].includes(tool)?tool:'strength';if(view==='strength')selected[market]=tool;window.switchAppView?.(view);if(view==='strength')document.dispatchEvent(new CustomEvent('ox:feature-tool-return',{detail:{market,tool}}));}
  }
  function restore(){if(!returning||!started)return;returning=false;const apply=()=>navigate(returnId);if(enter(returnId,apply))apply();}
  window.OXFeatures=Object.freeze({enter,enterView,enterTool,refresh,canPreload:id=>policies?.get(id)?.mode==='public',selectedTool:market=>selected[market],get returning(){return returning;},get ready(){return !!policies;},get newsTab(){return newsSelected;}});
  document.addEventListener('ox:accountchange',()=>{sessionUsable=!!window.OXAuth?.user;replay();if(returning)restore();});
  document.addEventListener('ox:marketchange',()=>{const id=viewFeature(document.body.dataset.view||'radar');if(id)enter(id,()=>window.switchAppView?.(document.body.dataset.view||'radar'));});
  document.addEventListener('ox:viewchange',()=>replay());
  document.addEventListener('ox:runtime-ready',()=>{const parts=currentFeature?.split('.');if(parts&&['crypto'].includes(parts[0])&&document.body.dataset.view==='strength')document.dispatchEvent(new CustomEvent('ox:feature-tool-return',{detail:{market:parts[0],tool:parts[1]}}));});
  // Start the shared policy request before blocking styles or the runtime graph.
  const initial=refresh();
  // Queue the requested entry even while policy is pending, so a later replay
  // cannot replace it with the shell's default radar request.
  const start=()=>{started=true;if(progress&&!progress.isConnected)document.body.append(progress);if(!policies&&policyState==='pending')showPending();if(returning)restore();initial.then(replay);};
  // DOMContentLoaded reaches document before the shell's window listener.
  // A cached policy can resume in between those listeners, before initChart
  // and MarketController.init. Restore in the next task, after shell setup.
  const scheduleStart=()=>setTimeout(start,0);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleStart,{once:true});else scheduleStart();
  const resume=()=>{if(Date.now()-lastRefresh>30000)refresh();};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  document.body?.classList.add('ox-feature-blocked');
})();

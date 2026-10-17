/* Product access UX. Server/API authorization remains independent.
 * The public/login policy list is not personal data. The last verified list is
 * kept for this tab (sessionStorage) and in memory, so a slow or failed policy
 * check never blanks the page: public products keep rendering from the last
 * verified policy and only login products show a retryable gate.
 * Without any verified policy, each product uses its provisional default from
 * the shared catalog (src/generated/feature-defaults.js, built from
 * server/account/feature-catalog.js). Public is never inferred. */
(() => {
  if(window.OXCanonicalRedirecting)return;
  const ids=['crypto.home','crypto.radar','crypto.patterns','crypto.bubbles','crypto.strength','crypto.heatmap','crypto.rotation','crypto.flow','news.feed','news.calendar','media'];
  const CACHE_KEY='ox-feature-policy-v1',CACHE_MAX_AGE=12*3600000,FIRST_TIMEOUT=4000,REQUEST_TIMEOUT=20000,POLL_MS=600000,RESUME_MS=60000,RETRY_MAX=600000;
  const DEFAULTS=globalThis.OXFeatureDefaults||{};
  const defaultMode=id=>DEFAULTS[id]?.mode==='public'?'public':'login';
  // pending: nothing known yet (first 4 s of a first visit); ready: verified on
  // this page load; stale: last verified list in use (cached or latest check
  // failed); provisional: nothing verified yet (slow or failed check), so the
  // catalog's provisional defaults apply until a verified answer arrives.
  let policies=null,pending=null,loading=null,epoch=0,requestEpoch=0,currentFeature=null,newsSelected='calendar',sessionUsable=false,policyState='pending',verifiedAt=0,failures=0,retryTimer=0,sessionToken=0;
  const selected={crypto:'patterns'};
  const landing=new URL(location.href),returnId=landing.searchParams.get('ox_feature');
  let returning=ids.includes(returnId), started=false, lastRefresh=0;
  let panel,progress;
  const style=document.createElement('style');
  style.textContent='body.ox-feature-blocked main.wrap,body.ox-feature-blocked #market-unavailable-card{display:none!important}#ox-feature-gate{max-width:640px;margin:32px auto;padding:24px;border:1px solid #d5d0c6;border-radius:16px;background:#fffaf2;color:#24282b}#ox-feature-gate button{font:inherit;padding:10px 16px;margin:8px 10px 0 0;border:1px solid #b8afa0;border-radius:9px;background:#fff;color:inherit}@media(max-width:650px){#ox-feature-gate{margin:20px 12px}}';document.head.append(style);
  function validFeatures(features){
    if(!Array.isArray(features))return null;
    const rows=features.filter(f=>ids.includes(f?.id));
    if(rows.length!==ids.length||new Set(rows.map(f=>f.id)).size!==ids.length||rows.some(f=>!['public','login'].includes(f.mode)))return null;
    return rows;
  }
  function readCache(){
    try{const saved=JSON.parse(sessionStorage.getItem(CACHE_KEY)||'null');const rows=validFeatures(saved?.features);
      if(!rows||!Number.isFinite(saved.at)||Date.now()-saved.at>CACHE_MAX_AGE||saved.at>Date.now()+60000)return null;
      return {rows,at:saved.at};}catch{return null;}
  }
  function writeCache(rows){try{sessionStorage.setItem(CACHE_KEY,JSON.stringify({at:Date.now(),features:rows.map(({id,label,mode,version})=>({id,label,mode,version}))}));}catch{}}
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
      const retry=document.createElement('button');retry.id='ox-feature-retry';retry.textContent='重新讀取設定';retry.onclick=()=>refresh();
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
  function modeOf(id){
    if(policies)return policies.get(id)?.mode||null;
    return policyState==='provisional'&&ids.includes(id)?defaultMode(id):null;
  }
  function allowed(id){const mode=modeOf(id);return !!mode&&(mode==='public'||sessionUsable&&!!window.OXAuth?.user);}
  const loginMessage=id=>{
    const label=policies?.get(id)?.label||DEFAULTS[id]?.label||id;
    if(!policies)return `「${label}」的功能設定仍在確認，確認前需註冊／登入才能使用。可稍後重新讀取。`;
    return policyState==='stale'&&failures?`「${label}」需要註冊登入。功能設定暫時無法重新確認，可稍後重新讀取。`:`「${label}」需要註冊登入。無需綁定交易所或代理資格。`;
  };
  function markReturn(id){const u=new URL(location.href);u.searchParams.set('ox_feature',id);history.replaceState(history.state,'',u.pathname+u.search+u.hash);}
  function cleanReturn(){const u=new URL(location.href);if(!u.searchParams.has('ox_feature'))return;u.searchParams.delete('ox_feature');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}
  function enter(id,resume){
    if(!ids.includes(id))return false;
    if(started)returning=false;
    if(allowed(id)){currentFeature=id;pending=null;cleanReturn();reveal();return true;}
    pending={id,resume,epoch:++requestEpoch};markReturn(id);
    gate(loginMessage(id),!!modeOf(id));
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
    if(pending){gate(loginMessage(pending.id),!!modeOf(pending.id));return;}
    const id=currentFeature||viewFeature(document.body.dataset.view||'radar');
    if(id&&!allowed(id)){if(!policies&&policyState==='pending')showPending();else gate(loginMessage(id),!!modeOf(id));}else reveal();
  }
  function announce(){document.dispatchEvent(new CustomEvent('ox:feature-policy-ready'));}
  function apply(rows,state){policies=new Map(rows.map(f=>[f.id,f]));policyState=state;}
  // Public policy is independent of session availability; login products are
  // unlocked only by a verified session. Keep the previous verdict while the
  // check is in flight so a periodic refresh never flashes a login gate.
  function verifySession(){
    const token=++sessionToken;
    if(!(window.OXAuth?.user&&window.OXAuth.getCurrent)){sessionUsable=!!window.OXAuth?.user;replay();return;}
    replay();
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
    void window.OXAuth.getCurrent({signal:abort.signal}).then(user=>{if(token===sessionToken)sessionUsable=!!user&&!!window.OXAuth.user;},()=>{if(token===sessionToken)sessionUsable=false;}).finally(()=>{clearTimeout(timer);if(token===sessionToken)replay();});
  }
  function scheduleRetry(){
    clearTimeout(retryTimer);
    const delay=Math.min(RETRY_MAX,30000*2**Math.max(0,failures-1));
    retryTimer=setTimeout(()=>{retryTimer=0;if(document.hidden)return;refresh();},delay);
  }
  async function refresh(){
    if(loading)return loading;
    if(!policies&&policyState==='pending')showPending();
    const token=++epoch;
    lastRefresh=Date.now();
    // On a first visit the deadline only lifts the page block (provisional
    // defaults); it never cancels the request, so a late answer is adopted.
    const lift=!policies&&policyState==='pending'?setTimeout(()=>{if(token===epoch&&!policies&&policyState==='pending'){policyState='provisional';announce();verifySession();}},FIRST_TIMEOUT):0;
    loading=(async()=>{let verified=false;try{
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),REQUEST_TIMEOUT);
      let response,data;try{[response,data]=await Promise.race([(async()=>{const r=await fetch('/api/v1/account/feature-access',{credentials:'same-origin',cache:'no-store',signal:abort.signal});return [r,await r.json()];})(),new Promise((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(new Error('policy timeout')),{once:true});})]);}finally{clearTimeout(timer);}
      const rows=response.ok&&data?.ok?validFeatures(data.features):null;
      if(!rows)throw Error('invalid');
      if(token===epoch){apply(rows,'ready');verifiedAt=Date.now();failures=0;clearTimeout(retryTimer);retryTimer=0;writeCache(rows);verified=true;}
    }catch{
      // Never discard the last verified policy because one check failed.
      if(token===epoch){failures++;policyState=policies?'stale':'provisional';scheduleRetry();}
    }finally{clearTimeout(lift);loading=null;}
    if(token!==epoch)return;
    announce();verifySession();
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
  window.OXFeatures=Object.freeze({enter,enterView,enterTool,refresh,canPreload:id=>policies?.get(id)?.mode==='public',selectedTool:market=>selected[market],get returning(){return returning;},get ready(){return !!policies||policyState==='provisional';},get state(){return policyState;},get verifiedAt(){return verifiedAt;},get newsTab(){return newsSelected;}});
  document.addEventListener('ox:accountchange',()=>{sessionUsable=!!window.OXAuth?.user;replay();if(returning)restore();});
  document.addEventListener('ox:marketchange',()=>{const id=viewFeature(document.body.dataset.view||'radar');if(id)enter(id,()=>window.switchAppView?.(document.body.dataset.view||'radar'));});
  document.addEventListener('ox:viewchange',()=>replay());
  document.addEventListener('ox:runtime-ready',()=>{const parts=currentFeature?.split('.');if(parts&&['crypto'].includes(parts[0])&&document.body.dataset.view==='strength')document.dispatchEvent(new CustomEvent('ox:feature-tool-return',{detail:{market:parts[0],tool:parts[1]}}));});
  // The last verified policy of this tab renders immediately; the network
  // check still runs in the background and replaces it when it succeeds.
  const cached=readCache();
  if(cached)apply(cached.rows,'stale');
  // Start the shared policy request before blocking styles or the runtime graph.
  const initial=refresh();
  // Queue the requested entry even while policy is pending, so a later replay
  // cannot replace it with the shell's default radar request.
  const start=()=>{started=true;if(progress&&!progress.isConnected)document.body.append(progress);if(!policies&&policyState==='pending')showPending();if(returning)restore();if(policies){announce();verifySession();}initial.then(replay);};
  // DOMContentLoaded reaches document before the shell's window listener.
  // A cached policy can resume in between those listeners, before initChart
  // and MarketController.init. Restore in the next task, after shell setup.
  const scheduleStart=()=>setTimeout(start,0);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleStart,{once:true});else scheduleStart();
  const resume=()=>{if(!document.hidden&&Date.now()-lastRefresh>RESUME_MS)refresh();};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  setInterval(()=>{if(!document.hidden)refresh();},POLL_MS);
  if(!policies)document.body?.classList.add('ox-feature-blocked');
})();

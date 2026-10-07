(() => {
  'use strict';
  const SAVED_KEY = 'ox-news-preferences-v1';
  const initialNewsHash = /^#news(?:\/[^?]*)?(?:\?|$)/.test(location.hash || '') ? location.hash : '';
  let restoringInitialRoute = Boolean(initialNewsHash);
  const state = { snapshot: null, candidate: null, pending: null, lastError: null, request: 0, previous: null, route: {}, navigating: false, workspace: null, scope: null, loadedAt:0, workspaceError:null };
  const markets = ['crypto'];
  const currentMarket = () => markets.includes(document.body.dataset.market) ? document.body.dataset.market : 'crypto';
  const preferences = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}'); } catch { return {}; } };
  const save = patch => { try { localStorage.setItem(SAVED_KEY, JSON.stringify({ ...preferences(), ...patch })); } catch {} };
  const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
  const dayKey = now => { const p = dayFormatter.formatToParts(now); return ['year', 'month', 'day'].map(n => p.find(t => t.type === n).value).join('-'); };
  function unlockCountdown(item, now = new Date()) {
    if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      const days = Math.round((Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${dayKey(now)}T00:00:00Z`)) / 86400000);
      return Number.isFinite(days) && days >= 0 ? `距官方預估日期 ${days} 天・時間待公布` : '預估日期已過，待官方更新';
    }
    if (item.status !== 'confirmed' || !Number.isFinite(Date.parse(item.occursAt))) return '解鎖時間待官方確認';
    const seconds = Math.max(0, Math.floor((Date.parse(item.occursAt) - now.getTime()) / 1000));
    if (!seconds) return '預定時間已到，待官方確認實際解鎖';
    return `倒數 ${Math.floor(seconds / 86400)} 天 ${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  let workspaceModule=null, workspaceAttempt=0;
  function loadWorkspace() {
    if(state.workspaceError)return Promise.reject(state.workspaceError);
    if(!workspaceModule){let timeout;workspaceModule=Promise.race([import(`../../generated/tool-news.js?v=20261007-ux-replay4&attempt=${workspaceAttempt}`),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('資訊介面下載逾時')),12000);})]).catch(error=>{workspaceModule=null;state.workspaceError=error;throw error;}).finally(()=>clearTimeout(timeout));}
    return workspaceModule;
  }
  function refresh(force = false, {priority='high'}={}) {
    if (state.pending) return state.pending;
    if (state.snapshot && !force && Date.now()-state.loadedAt<300000) return Promise.resolve(state.snapshot);
    const request = ++state.request, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    state.pending = fetch(`data/news.json${force ? `?t=${Date.now()}` : ''}`, { signal: controller.signal, cache: force ? 'reload' : 'default', priority })
      .then(async response => { if (!response.ok) throw Error(`HTTP ${response.status}`); const data = await response.json(); if (data.schemaVersion !== 1 || !Array.isArray(data.news) || !Array.isArray(data.events)) throw Error('新聞資料格式不正確'); return data; })
      .then(data => { if (request !== state.request) return state.snapshot; state.lastError = null; state.loadedAt=Date.now();
        if (state.snapshot && data.generatedAt !== state.snapshot.generatedAt) state.candidate = data;
        else if (!state.snapshot) state.snapshot = data;
        render(); refreshMacro(force,priority); return state.snapshot;
      }).catch(error => { if (request === state.request) { state.lastError = error; render(); } return state.snapshot; })
      .finally(() => { clearTimeout(timeout); state.pending = null; render(); });
    render(); return state.pending;
  }
  let macroPending = false;
  async function refreshMacro(force,priority='high') {
    if (macroPending) return; macroPending = true;
    try {
      const [response, { mergeMacroResults }] = await Promise.all([fetch(`data/macro-results.json${force ? `?t=${Date.now()}` : ''}`, { cache: force ? 'reload' : 'default', signal: AbortSignal.timeout(8000), priority }), import('./macro.js?v=20261005-weeklist4')]);
      if (!response.ok) return;
      const supplement = await response.json();
      if (state.snapshot) state.snapshot = mergeMacroResults(state.snapshot, supplement);
      if (state.candidate) state.candidate = mergeMacroResults(state.candidate, supplement);
      render();
    } catch { /* Keep the calendar and its last successful official values. */ }
    finally { macroPending = false; }
  }
  let generation = 0;
  async function render() {
    const token = ++generation;
    const view = document.querySelector('.app-view.active')?.dataset.appView;
    if (!['news', 'data'].includes(view)) { state.workspace?.suspend(); return; }
    // US keeps its existing Data workspace. Cross-market news remains available from the news menu.
    const scope = document.body.dataset.newsMode === '1' ? 'all' : currentMarket();
    const host = document.querySelector(`[data-news-surface="${scope === 'all' ? 'all' : 'market'}"]`);
    if (!host) return;
    let mountNewsWorkspace;
    try { ({mountNewsWorkspace}=await loadWorkspace()); }
    catch(error) {
      if(token!==generation||!host.isConnected)return;
      host.replaceChildren();const message=document.createElement('p'), retry=document.createElement('button');
      message.textContent='資訊介面暫時無法載入，請重試。';retry.textContent='重試';
      retry.addEventListener('click',()=>{state.workspaceError=null;workspaceAttempt++;void render();},{once:true});host.append(message,retry);return;
    }
    if (token !== generation || !host.isConnected) return;
    if (state.scope !== scope || state.workspace?.host !== host) {
      state.workspace?.destroy(); state.scope = scope;
      state.workspace = mountNewsWorkspace(host, { scope, preferences, save, navigate, back: detailBack, exit: scope === 'all' ? () => close({ useHistory: true }) : exitMarket, refresh: () => refresh(true), applyUpdate() { state.snapshot = state.candidate; state.candidate = null; render(); }, unlockCountdown });
    }
    state.workspace.update({ snapshot: state.snapshot, error: state.lastError, pending: Boolean(state.pending), candidate: Boolean(state.candidate), route: state.route });
  }
  function currentView() { return document.querySelector('.app-view.active')?.dataset.appView || 'radar'; }
  const baseURL = () => (location.pathname || '/') + (location.search || '');
  function capturePrevious() { return { view: currentView(), market: currentMarket(), scroll: window.scrollY || 0 }; }
  function switchTo(view, market = currentMarket()) {
    state.navigating = true;
    if (market !== currentMarket()) window.OXMarketController?.setMarket?.(market);
    document.body.dataset.newsMode = view === 'news' ? '1' : '0';
    window.switchAppView?.(view); state.navigating = false;
  }
  function open({ historyEntry = true, previous = null } = {}) {
    if(window.OXFeatures&&!window.OXFeatures.enterView('news'))return;
    if (document.body.dataset.newsMode !== '1') state.previous = previous || capturePrevious();
    if (historyEntry && !history.state?.oxNews) history.replaceState?.({ ...history.state, oxView: state.previous.view, oxMarket: state.previous.market, oxScroll: state.previous.scroll }, '', baseURL() + (location.hash || ''));
    state.route = {}; switchTo('news');
    if (historyEntry) history.pushState({ oxNews: true, oxPrevious: state.previous }, '', '#news');
    refresh(); render();
  }
  function openMarket({ historyEntry = true, market = currentMarket() } = {}) {
    // Retry the complete route after policy loading, preserving its explicit market.
    if(window.OXFeatures&&!window.OXFeatures.enter(window.OXFeatures.newsTab==='calendar'?'news.calendar':'news.feed',()=>openMarket({historyEntry,market})))return;
    const previous = !historyEntry && history.state?.oxPrevious || capturePrevious(); state.previous = previous; state.route = {};
    if (historyEntry) history.replaceState?.({ ...history.state, oxView: previous.view, oxMarket: previous.market, oxScroll: previous.scroll }, '', baseURL() + (location.hash || ''));
    switchTo('data', market);
    if (historyEntry) history.pushState({ oxView: 'data', oxMarket: market, oxMarketNews: true, oxPrevious: previous }, '', `#news/${market}`);
    refresh(); render(); window.scrollTo?.(0, 0);
  }
  function restore(previous) {
    const p = previous || { view: 'radar', market: currentMarket(), scroll: 0 };
    state.route = {}; switchTo(p.view === 'news' ? 'data' : p.view || 'radar', p.market);
    requestAnimationFrame(() => window.scrollTo?.(0, p.scroll || 0));
  }
  function close({ useHistory = false } = {}) {
    if (useHistory && history.state?.oxNews && history.state?.oxPrevious) { history.back(); return; }
    restore(state.previous); history.replaceState?.({ oxView: currentView(), oxMarket: currentMarket() }, '', baseURL());
  }
  function exitMarket() {
    if (history.state?.oxMarketNews && history.state.oxPrevious) history.back();
    else { restore(state.previous); history.replaceState?.({ oxView: currentView(), oxMarket: currentMarket() }, '', baseURL()); }
  }
  function navigate(route) {
    state.route = route;
    const entry = { ...history.state, oxNews: document.body.dataset.newsMode === '1', oxView: currentView(), oxMarket: currentMarket(), oxNewsRoute: route, oxNewsDepth: (history.state?.oxNewsDepth || 0) + 1 };
    const hash = entry.oxNews ? '#news' : `#news/${currentMarket()}`;
    const query = new URLSearchParams(); if (route.day) query.set('date', route.day); if (route.event) query.set('event', route.event);
    history.pushState(entry, '', hash + (query.size ? `?${query}` : '')); render();
  }
  function detailBack() {
    if (history.state?.oxNewsDepth) history.back();
    else { state.route = state.route.event && state.route.day ? { day: state.route.day } : {}; history.replaceState?.({ ...history.state, oxNewsRoute: state.route }, '', document.body.dataset.newsMode === '1' ? '#news' : `#news/${currentMarket()}`); render(); }
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-cross-news], #ox-open-news')) { event.preventDefault(); open(); document.getElementById('ox-control-close')?.click(); }
  });
  document.addEventListener('ox:marketchange', () => { if (!state.navigating) { state.route = {}; render(); } });
  document.addEventListener('ox:viewchange', event => {
    const view = event.detail?.to;
    if (!restoringInitialRoute && !state.navigating && view && view !== 'news' && document.body.dataset.newsMode === '1') {
      document.body.dataset.newsMode = '0'; state.route = {}; history.pushState({ oxView: view, oxMarket: currentMarket() }, '', baseURL());
    } else if (!restoringInitialRoute && !state.navigating && view && !['data', 'news'].includes(view) && history.state?.oxMarketNews) {
      state.route = {}; history.pushState({ oxView: view, oxMarket: currentMarket() }, '', baseURL());
    }
    if (view === 'data' || view === 'news') refresh(); render();
  });
  window.addEventListener('popstate', event => {
    const entry = event.state;
    state.route = entry?.oxNewsRoute || {};
    if (entry?.oxNews) { state.previous = entry.oxPrevious; switchTo('news', entry.oxMarket); refresh(); render(); }
    else if (entry?.oxView) { state.previous = entry.oxPrevious; switchTo(entry.oxView, entry.oxMarket); render(); if (!state.route.day && !state.route.event) requestAnimationFrame(() => window.scrollTo?.(0, entry.oxScroll || 0)); }
    else if (document.body.dataset.newsMode === '1' || currentView() === 'data') restore(state.previous);
  });
  async function preload({signal}={}) {
    if(signal?.aborted)return;
    await loadWorkspace();
    if(signal?.aborted)return;
    await refresh(false,{priority:'low'});
  }
  window.OXNews = Object.freeze({ open, openMarket, close, refresh, render, unlockCountdown, preload });
  const restoreInitialRoute = () => setTimeout(() => {
    const [path, query = ''] = initialNewsHash.split('?'), market = path.split('/')[1];
    if (markets.includes(market)) openMarket({ historyEntry: false, market }); else open({ historyEntry: false, previous: history.state?.oxPrevious });
    const params = new URLSearchParams(query); state.route = { day: params.get('date'), event: params.get('event') };
    // A directly opened/reloaded URL needs a real base history entry as well.
    // Otherwise Back from its first event restores the unrelated boot radar.
    history.replaceState?.({ ...history.state, oxNews: document.body.dataset.newsMode==='1', oxMarketNews:markets.includes(market), oxView:currentView(), oxMarket:currentMarket(), oxPrevious:history.state?.oxPrevious||state.previous, oxNewsRoute:state.route, oxNewsDepth:history.state?.oxNewsDepth||0 },'',baseURL()+initialNewsHash);
    restoringInitialRoute = false;
    render();
  }, 0);
  // The legacy boot briefly selects radar. During reload that must not push a
  // new history entry or erase the deep link before its route is restored.
  if (initialNewsHash) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreInitialRoute, { once: true });
    else restoreInitialRoute();
  }
  else render();
})();

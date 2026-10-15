import { marketRouter } from "./marketRouter.js?v=20261002-nav6";
import './storage-migrations.js?v=20261004-markets2';
import { loadToolModule } from '../components/load-tool-module.js';
import { createToolWarmup, idleWarmAllowed } from '../components/tool-warmup.js';
import { cryptoModule } from "../markets/crypto/index.js";

export function bootOXModules(modules = []) {
  modules.forEach(module => marketRouter.register(module));
  return marketRouter;
}

const router = bootOXModules([cryptoModule]);
let currentView = document.body.dataset.view || "home";
let renderToken = 0;
const isMarketView = () => ["home", "strength", "radar"].includes(currentView);

function scheduleMarketView() {
  const token = ++renderToken;
  const activate = () => {
    if (token !== renderToken || !isMarketView()) return;
    const market = document.body.dataset.market || "crypto";
    const onFailure = error => {
      if (token !== renderToken || document.body.dataset.market !== market) return;
      document.dispatchEvent(new CustomEvent("ox:marketerror", { detail: { market, message: error?.message || "市場介面啟動失敗" } }));
    };
    if (router.current() !== market) router.activate(market, { view: currentView }).then(() => {
      if (token !== renderToken) return;
      if (!isMarketView()) {
        const host = document.getElementById("market-unavailable-card");
        if (host) host.hidden = true;
        return;
      }
      if (document.body.dataset.market !== market) scheduleMarketView();
    }).catch(onFailure);
    else {
      try {
        Promise.resolve(router.get(market)?.view?.(currentView)).catch(onFailure);
      } catch (error) { onFailure(error); }
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(activate));
}

document.addEventListener("ox:viewchange", event => {
  currentView = event.detail?.to || currentView;
  // Market modules live outside .app-view; hide them synchronously when a
  // Data, News, Media or Settings page opens, even if activation is pending.
  if (!isMarketView()) {
    ++renderToken;
    for (const id of ["market-unavailable-card"]) {
      const root = document.getElementById(id);
      if (root) root.hidden = true;
    }
  }
  scheduleMarketView();
});

document.addEventListener("ox:marketchange", event => {
  scheduleMarketView();
});

window.OXModules = Object.freeze({ router });

// A slow module graph may finish after the user already selected a market.
// Restore the actual DOM context instead of requiring another market gesture.
const restoreMarketView = () => {
  currentView = document.body.dataset.view || currentView;
  scheduleMarketView();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restoreMarketView, { once: true });
else restoreMarketView();

// Staged preparation of tool code/CSS only. Tool data (news.json, the 6 MB
// crypto-tools snapshot, the pattern index, flow history) is fetched by each
// tool when the user first opens it, and refreshed by that tool only while it
// is visible. Nothing re-downloads tool data in the background.
const modules = new Map();
const prepareModule = async (kind, path, signal) => {
  const module = await loadToolModule(new URL(path, import.meta.url).href, { current: () => !signal.aborted });
  modules.set(kind, module); return module;
};
const warmJobs = [
  { id:'bubbles-assets', features:['bubbles'], run:async signal => (await prepareModule('bubbles','../markets/crypto/bubbles/view.js',signal)).preloadBubblesStyles() },
  { id:'analytics-assets', features:['heatmap','rotation','flow'], run:async signal => (await prepareModule('analytics','../markets/crypto/analytics/flow-view.js',signal)).preloadAnalyticsStyles() },
  { id:'news-assets', features:['news.calendar','news.feed'], run:signal => window.OXNews.preload({signal}) },
  { id:'patterns-assets', features:['patterns'], run:async signal => (await prepareModule('patterns','../markets/crypto/patterns/view.js',signal)).preloadPatternStyles() }
];
const idleSchedule = (fn, ms) => {
  const handle = { timeout: 0, idle: 0 };
  handle.timeout = setTimeout(() => {
    handle.timeout = 0;
    if (typeof requestIdleCallback === 'function') handle.idle = requestIdleCallback(() => { handle.idle = 0; fn(); }, { timeout: 5000 });
    else fn();
  }, ms);
  return handle;
};
const idleUnschedule = handle => { if (!handle) return; clearTimeout(handle.timeout); if (handle.idle && typeof cancelIdleCallback === 'function') cancelIdleCallback(handle.idle); };
const warmup = createToolWarmup({ jobs:warmJobs, schedule:idleSchedule, unschedule:idleUnschedule,
  enabled:() => !document.hidden && document.body.dataset.market === 'crypto' && idleWarmAllowed(), eligible:job => {
  if (document.hidden || document.body.dataset.market !== 'crypto' || !idleWarmAllowed() || !job.features.some(id => window.OXFeatures?.canPreload?.(id.includes('.')?id:'crypto.'+id))) return false;
  const feed = globalThis.OXPublicFeed?.stats();
  if (feed?.priorityActive || feed?.priorityQueued) return false;
  // Do not move initial chart/radar waiting into a wave of speculative work.
  if (typeof state === 'undefined' || !state.candleData?.length || !state.tickers?.length) return false;
  if (document.body.dataset.view === 'radar' && !state.analyzedCache?.size && !state.radarSnapshotReady) return false;
  const loading = document.querySelector('#ox-crypto-tools-inline > .ox-tool-loading');
  return !loading || loading.hidden || document.body.dataset.view !== 'strength';
} });
globalThis.OXToolWarmup = Object.freeze({ stats:warmup.stats });
for (const event of ['ox:feature-policy-ready','ox:marketchange','ox:viewchange','visibilitychange','online']) document.addEventListener(event, () => warmup.poke());
document.addEventListener('ox:crypto-toolchange', () => warmup.poke({interaction:true}));
globalThis.navigator?.connection?.addEventListener?.('change', () => warmup.poke());
for (const event of ['pointerdown','keydown','wheel']) document.addEventListener(event, () => warmup.poke({interaction:true}), {passive:true});

import { marketRouter } from "./marketRouter.js?v=20261002-nav6";
import './storage-migrations.js?v=20261004-markets2';
import { loadToolModule } from '../components/load-tool-module.js';
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

// Public Crypto board warms gradually after initial paint; protected tools never preload.
let cryptoWarmTimer=0,warmModule=null;
const warmAllowed=()=>!document.hidden&&document.body.dataset.market==='crypto'&&document.body.dataset.view!=='strength'&&window.OXFeatures?.canPreload?.('crypto.patterns');
const scheduleCryptoWarm=()=>{clearTimeout(cryptoWarmTimer);if(!warmAllowed()){warmModule?.stopPatternPreload();return;}cryptoWarmTimer=setTimeout(async()=>{
  if(!warmAllowed())return;
  if(globalThis.OXPublicFeed?.stats().priorityActive){scheduleCryptoWarm();return;}
  try{warmModule=await loadToolModule(new URL('../markets/crypto/patterns/view.js',import.meta.url).href,{current:warmAllowed});if(warmAllowed())void warmModule.preloadPatternSearch();}catch{/* Foreground loading has finite recovery UI. */}
},2500);};
document.addEventListener('ox:feature-policy-ready',scheduleCryptoWarm);
document.addEventListener('ox:marketchange',scheduleCryptoWarm);
document.addEventListener('ox:viewchange',scheduleCryptoWarm);
document.addEventListener('visibilitychange',scheduleCryptoWarm);
scheduleCryptoWarm();

function resizeChartToContainer(force = false) {
  const container = document.getElementById("chart");
  if (!state.chart || !container) return;
  // 手機旋轉的全圖模式使用 layout 尺寸，避免 transform 後 bounding rect 寬高互換造成只畫半屏。
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width > 0 && height > 0) {
    const last = state.lastChartContainerSize;
    if (!force && last?.chart === state.chart && last.width === width && last.height === height) return;
    state.lastChartContainerSize = { chart: state.chart, width, height };
    const range = state.chart.timeScale().getVisibleLogicalRange();
    state.chart.resize(Math.round(width), Math.round(height), true);
    if (range) state.chart.timeScale().setVisibleLogicalRange(range);
    requestAnimationFrame(updateKeyLevelVisualLabels);
  }
}

function updateChartExpandButton() {
  const button = document.getElementById("btn-chart-fullscreen");
  if (!button) return;
  const expanded = document.body.classList.contains("chart-focus") || !!document.fullscreenElement;
  button.setAttribute("aria-label", expanded ? "收合圖表" : "展開圖表");
  button.setAttribute("aria-pressed", String(expanded));
  button.title = expanded ? "收合圖表" : "展開圖表";
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${expanded ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'}"/></svg>`;
}

function createCoinLogo(symbol) {
  if (globalThis.OXCoinLogo) return globalThis.OXCoinLogo.element(symbol, { cls: "ox-coin-logo", size: 24 });
  const base = String(symbol || "").replace(/USDT$/, "");
  const key = base.replace(/^1000(?=[A-Z])/, "").toLowerCase();
  const badge = document.createElement("span");
  badge.className = "ox-coin-logo";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = base.slice(0, 2);
  const source = OX_COIN_LOGOS[key];
  if (source) {
    const img = document.createElement("img");
    img.src = source; img.alt = ""; img.width = 24; img.height = 24; img.decoding = "async";
    img.addEventListener("error", () => img.remove(), { once: true });
    badge.append(img);
  }
  return badge;
}

function setChartFocus(enabled) {
  const range = state.chart?.timeScale().getVisibleLogicalRange();
  const chartBox = document.querySelector('#view-radar .chart-box');
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  document.body.classList.toggle("chart-focus", enabled);
  updateChartExpandButton();
  state.volumeSeries?.applyOptions({ visible: !enabled && !!document.getElementById("chk-vol")?.checked });
  if (enabled) {
    state.candleSeries?.setMarkers([]);
    clearKeyLevelPriceLines();
  } else {
    renderKeyLevelPriceLinesFromState();
    if (state.candleData?.length) renderChartData(state.candleData, false, range);
  }
  requestAnimationFrame(() => {
    resizeChartToContainer(true);
    if (chartBox && !prefersReducedMotion && typeof chartBox.animate === 'function') {
      // "none scale(.965)" is not a valid transform and the browser dropped the whole animation.
      const transform = getComputedStyle(chartBox).transform, prefix = transform === 'none' ? '' : `${transform} `;
      chartBox.animate(
        enabled
          ? [{ transform: `${prefix}scale(.965)`, opacity: .86 }, { transform, opacity: 1 }]
          : [{ transform, opacity: 1 }, { transform: `${prefix}scale(.985)`, opacity: .9 }],
        { duration: enabled ? 520 : 360, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' }
      ).onfinish = () => { chartBox.getAnimations().forEach(animation => animation.cancel()); };
    }
  });
  [100, 300].forEach(ms => setTimeout(() => { resizeChartToContainer(true); updatePriceTimer(); }, ms));
}

// Pages: the dock's 首頁／行情／畫板／型態／資訊, the 個股 page, and 設定／媒體 from the
// drawer. 畫板 (board), 型態 (compare), 個股 and 行情 → 圖表 (both chart) share #view-radar;
// the page picks its mode. 個股 is a page you step into: it gets a history entry, so the
// phone's back gesture (and the page's ‹) returns to wherever it was opened from.
// 圖表 (view chart) is 行情's first tab, the original radar page: the chart with the
// T1／T2／T3 list beside it (analytics/entry.js moves the list there); the dock shows 行情.
const APP_VIEWS = ['home','strength','chart','radar','pattern','stock','data','media','settings','news'];
const VIEW_SECTION = { pattern: 'radar', stock: 'radar', chart: 'radar' };
const RADAR_MODE = { radar: 'board', pattern: 'compare', stock: 'chart', chart: 'chart' };
const DOCK_VIEW = { chart: 'strength' };
let stockReturn = 'strength', ignoreStockPop = false, poppingStock = false;
function switchAppView(view) {
  if (!APP_VIEWS.includes(view)) return;
  // 行情 opens on the tab it shows last; 圖表 is its own view.
  if (view === 'strength' && window.OXMarketTabs?.current?.() === 'chart') view = 'chart';
  else if (view === 'chart' && window.OXMarketTabs && window.OXMarketTabs.current() !== 'chart') { window.OXMarketTabs.select('chart'); if (state.activeView === 'chart') return; }
  if (window.OXFeatures && !window.OXFeatures.enterView(view)) return;
  if (document.body.classList.contains('chart-focus')) setChartFocus(false);

  const previous = state.activeView;
  const radar = document.getElementById('view-radar');
  if (view === 'stock' && previous !== 'stock') {
    stockReturn = previous && previous !== 'stock' ? previous : 'strength';
    // Before ox:viewchange, so the news page sees this entry and adds none of its own.
    try { history.pushState({ oxStock: 1 }, ''); } catch {}
  } else if (previous === 'stock' && view !== 'stock' && !poppingStock && history.state?.oxStock) {
    ignoreStockPop = true; history.back();
  }
  if (radar && RADAR_MODE[view] && radar.dataset.radarMode !== RADAR_MODE[view]) radar.dataset.radarMode = RADAR_MODE[view];
  const section = VIEW_SECTION[view] || view;
  const order = ['home','strength','radar','pattern','data','media','settings'], place = v => order.indexOf(DOCK_VIEW[v] || v);
  const direction = Math.sign(place(view) - place(previous));
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  // Switch immediately: holding the old page for its exit animation blocks taps and scrolling.
  document.querySelectorAll('.app-view.ox-view-entering').forEach(el => el.classList.remove('ox-view-entering'));
  document.querySelectorAll('.app-view.ox-mobile-view-in').forEach(el => el.classList.remove('ox-mobile-view-in'));
  {
    state.activeView = view;
    document.body.dataset.view = view;
    document.querySelectorAll('[data-app-view]').forEach(el => el.classList.toggle('active', el.dataset.appView === section));
    document.querySelectorAll('[data-view-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.viewTarget === (DOCK_VIEW[view] || view)));

    const incoming = document.querySelector(`[data-app-view="${section}"]`);
    // A brief opacity entrance leaves touch and scrolling available immediately.
    if (incoming && previous !== view && !reduced) incoming.classList.add('ox-mobile-view-in');

    MarketController.syncPlaceholder();
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'auto' });
    document.dispatchEvent(new CustomEvent('ox:viewchange', { detail: { from: previous, to: view, direction } }));
    // Schedule view-specific work after the new page has had a chance to paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.activeView !== view) return;
      if (view === 'strength' && state.activeMarket === 'crypto') { renderMarketStrength(); }
      if (view === 'home' && state.activeMarket === 'crypto') { renderHomeOverview(); HomeMiniChart.ensureAndLoad(false); }
      if ((view === 'stock' || view === 'chart') && state.activeMarket === 'crypto') {
        resizeChartToContainer();
        updateHeaderHUD();
        renderBenchmarkBar();
      }
    }));
  }
}


// The phone's back gesture on the 個股 page returns to the page it was opened from.
// Registered before the news page's own listener, which it keeps out of this step.
window.addEventListener('popstate', event => {
  if (ignoreStockPop) { ignoreStockPop = false; event.stopImmediatePropagation(); return; }
  if (state.activeView !== 'stock') return;
  event.stopImmediatePropagation();
  poppingStock = true;
  try { switchAppView(stockReturn === 'stock' ? 'strength' : stockReturn); } finally { poppingStock = false; }
});
window.OXBack = () => { if (history.state?.oxStock) history.back(); else switchAppView(stockReturn === 'stock' ? 'strength' : stockReturn); };

// 首頁 numbers. A price comes from the live quote stream while 首頁 shows (home-feed.js
// subscribes BTC, ETH and SOL), else from the ticker list, which the hourly radar snapshot
// fills before Bitget answers, so the page has numbers within about a second.
function homeQuote(symbol) {
  const live = globalThis.OXCryptoQuotes?.get?.(symbol);
  if (live) return live;
  if (symbol === "BTCUSDT" && state.btcTicker) return state.btcTicker;
  if (symbol === "ETHUSDT" && state.ethTicker) return state.ethTicker;
  return state.tickers.find(t => t.symbol === symbol) || null;
}
// 市場寬度: every eligible USDT perpetual's 24H change (the radar's own ticker list).
function homeBreadth(tickers = state.tickers) {
  const changes = tickers.map(t => Number(t.change24h)).filter(Number.isFinite);
  const sorted = [...changes].sort((a, b) => a - b), mid = sorted.length >> 1;
  return {
    up: changes.filter(v => v > 0).length, down: changes.filter(v => v < 0).length, total: changes.length,
    median: sorted.length ? sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : null
  };
}
// 24H change as 「-2,735.6（-3.44%）」: the amount from the 24H change ratio.
function homeChangeText(quote) {
  const last = Number(quote?.lastPr), ratio = Number(quote?.change24h);
  if (!Number.isFinite(last) || !Number.isFinite(ratio) || last <= 0 || ratio <= -1) return "—";
  const amount = last - last / (1 + ratio), sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount) > 0 ? fmtPrice(Math.abs(amount)) : "0"}（${fmtPct(ratio)}）`;
}
function renderHomeQuotes() {
  const setText = (id, value) => { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; };
  const setTone = (id, value, text) => {
    const el = document.getElementById(id); if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    const tone = Number.isFinite(value) && text !== "—" ? value > 0 ? "up" : value < 0 ? "down" : "" : "";
    if (el.className !== tone) el.className = tone;
  };
  const btc = homeQuote("BTCUSDT");
  setText("home-btc-price", btc ? fmtPrice(btc.lastPr) : "—");
  setTone("home-btc-change", Number(btc?.change24h), btc ? homeChangeText(btc) : "—");
  for (const coin of ["eth", "sol"]) {
    const quote = homeQuote(`${coin.toUpperCase()}USDT`), change = Number(quote?.change24h);
    setText(`home-${coin}-price`, quote ? fmtPrice(quote.lastPr) : "—");
    setTone(`home-${coin}-change`, change, quote && Number.isFinite(change) ? fmtPct(change) : "—");
  }
  const breadth = homeBreadth();
  setText("home-breadth-up", breadth.total ? String(breadth.up) : "—");
  setText("home-breadth-down", breadth.total ? String(breadth.down) : "—");
  setTone("home-breadth-median", breadth.median, breadth.median == null ? "—" : fmtPct(breadth.median));
  const bar = document.getElementById("home-breadth-bar");
  if (bar) bar.style.width = `${breadth.up + breadth.down ? (breadth.up / (breadth.up + breadth.down) * 100).toFixed(1) : 50}%`;
}

function renderHomeOverview() {
  renderHomeQuotes();
  // The paired lists read the radar's independent long and short rankings.
  for (const [side, label] of [["long", "上漲"], ["short", "下跌"]]) {
    const rows = ["t1","t2","t3"].flatMap(tier => state.tierMapBySide?.[side]?.[tier] || []).filter(candidate =>
      side === "long" ? num(candidate.change24h) > 0 : num(candidate.change24h) < 0
    );
    const box = document.getElementById(`home-t1-${side}-list`);
    if (!box) continue;
    const existing=new Map([...box.querySelectorAll('.ox-home-t1-row')].map(row=>[row.dataset.homeSymbol,row]));
    const displayed=[];
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.className = "ox-home-t1-empty";
      empty.textContent = `等待${label}候選`;
      box.replaceChildren(empty);
      continue;
    }
    let previousTier=null;
    for (const candidate of rows.slice(0, 30)) {
      // .ox-home-t1-row keeps the double tap / long press K-line preview (home-preview.js).
      const row = existing.get(candidate.symbol) || document.createElement("button");
      row.type = "button";
      row.className = "ox-home-t1-row";
      row.dataset.homeSymbol = candidate.symbol;
      row.dataset.homeSide = side;
      row.dataset.homeTier = candidate.displayTier || candidate.tier;
      const startsTier=row.dataset.homeTier!==previousTier;
      previousTier=row.dataset.homeTier;
      row.classList.toggle('is-tier-start',startsTier);
      row.dataset.groupStart=String(startsTier);
      const identity = row.querySelector('.ox-home-t1-identity') || document.createElement("span");
      if(!identity.children.length){
        const symbol = document.createElement("strong");
        symbol.textContent = String(candidate.symbol || "—").replace(/USDT$/, "");
        identity.className = "ox-home-t1-identity";
        identity.append(createCoinLogo(candidate.symbol), symbol);
      }
      const score = row.querySelector('small:not(.ox-home-row-tier)') || document.createElement("small");
      score.textContent = `OX ${candidate.oxScore ?? "—"}`;
      const tier = row.querySelector('.ox-home-row-tier') || document.createElement("small");
      tier.className = 'ox-home-row-tier';
      tier.textContent = row.dataset.homeTier.toUpperCase();
      tier.hidden=!startsTier;
      const change = row.querySelector('em') || document.createElement("em");
      change.className = num(candidate.change24h) > 0 ? "up" : "down";
      change.textContent = fmtPct(candidate.change24h);
      if(!row.children.length)row.append(tier,identity,score,change);
      displayed.push(row);
    }
    // Reuse buttons during ticker refreshes so a held touch and scroll position
    // survive live updates. Only move rows when the actual ranking changes.
    displayed.forEach((row,index)=>{if(box.children[index]!==row)box.insertBefore(row,box.children[index]||null);});
    for(const child of [...box.children])if(!displayed.includes(child))child.remove();
  }
}

function renderOxLive() {
  const el = document.getElementById("ox-live-text");
  if (!el) return;
  if (state.activeMarket && state.activeMarket !== "crypto") {
    el.textContent = ({
      crypto: "加密市場行情已連線"
    })[state.activeMarket] || "市場資料切換中";
    el.title = el.textContent;
    return;
  }
  const parts = [];

  // 跑馬燈只選 T1 的十則快訊；雷達榜單各 T 分級可顯示最多三十檔。
  const t1Coins = (state.tierMap.t1 || []).slice(0, 10);
  if (t1Coins.length) {
    const t1Text = t1Coins.map((c, idx) => {
      const symbol = String(c.symbol || "").replace(/USDT$/, "") || "—";
      return `#${idx + 1} ${symbol} OX ${c.oxScore ?? "—"} ${fmtPct(c.change24h)}`;
    }).join("　·　");
    parts.push(`⚡ T1 精選快訊 · T1 最多 10 檔，T2／T3 各最多 15 檔　${t1Text}`);
  } else {
    parts.push("⚡ T1 最多 10 檔，T2／T3 各最多 15 檔 · 輪巡整理中");
  }

  const surge = (state.tierMap.surge || [])[0];
  if (surge) parts.push(`🔥 ${surge.symbol.replace(/USDT$/, "")} 異常活躍 · OX ${surge.oxScore ?? "—"} · 24H ${fmtPct(surge.change24h)}`);
  if (state.btcTicker) parts.push(`BTC ${fmtPrice(state.btcTicker.lastPr)} · ${fmtPct(state.btcTicker.change24h)}`);
  const strength = computeMarketStrength();
  if (Number.isFinite(strength.btcRaw)) parts.push(`BTC 強度 ${Math.round(strength.btcRaw)}`);
  if (Number.isFinite(strength.altRaw)) parts.push(`小幣強度 ${Math.round(strength.altRaw)}`);
  parts.push("新聞功能預留");

  const liveText = parts.join("　｜　");
  const next = liveText || "正在整理市場即時資訊…";
  if (el.textContent !== next) el.textContent = next;
  if (el.title !== liveText) el.title = liveText;
}

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");

function getSavedThemeMode() {
  const saved = localStorage.getItem("ox-ui-theme");
  return ["dark", "light", "system"].includes(saved) ? saved : "dark";
}

let themeTransition = null, themeChangeVersion = 0, themeInitialized = false, themeFallbackTimer;
function applyTheme(themeMode = "system") {
  const version = ++themeChangeVersion;
  const light = themeMode === 'light' || themeMode === 'system' && systemThemeQuery.matches;
  const changed = document.body.classList.contains('theme-light') !== light;
  const animate = themeInitialized && changed && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  themeInitialized = true;
  themeTransition?.skipTransition();
  const update = () => { if(version === themeChangeVersion)applyThemeNow(themeMode); };
  if(!animate){update();return;}
  if(typeof document.startViewTransition === 'function') {
    themeTransition = document.startViewTransition(update);
    themeTransition.finished.catch(()=>{});
  } else {
    document.body.classList.add('ox-theme-changing');
    requestAnimationFrame(update);
    clearTimeout(themeFallbackTimer);
    themeFallbackTimer = setTimeout(()=>document.body.classList.remove('ox-theme-changing'),550);
  }
}
function applyThemeNow(themeMode = "system") {
  const mode = ["dark", "light", "system"].includes(themeMode) ? themeMode : "system";
  const resolved = mode === "system" ? (systemThemeQuery.matches ? "light" : "dark") : mode;
  const light = resolved === "light";

  document.body.classList.toggle("theme-light", light);
  document.body.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolved);
  document.querySelectorAll("[data-theme-choice]").forEach(btn => btn.classList.toggle("active", btn.dataset.themeChoice === mode));
  document.dispatchEvent(new CustomEvent("ox:themechange", { detail: { mode, resolved } }));

  if (state.candleSeries) {
    const up = light ? "#4598df" : "#00b8d4", down = light ? "#e86480" : "#ff3078";
    state.candleSeries.applyOptions({upColor:up,downColor:down,wickUpColor:up,wickDownColor:down,borderUpColor:up,borderDownColor:down});
  }
  for (const line of state.classicLevelSeries || []) line.applyOptions({color:light?"#8d712e":"#eee7df"});
  if (state.chart) {
    state.chart.applyOptions({
      layout: { background: { type: "solid", color: light ? "#ffffff" : "#121417" }, textColor: light ? "#616d7c" : "#929995" },
      grid: { vertLines: { color: light ? "rgba(148,163,184,.16)" : "#202725" }, horzLines: { color: light ? "rgba(148,163,184,.16)" : "#202725" } },
      crosshair: { vertLine:{labelBackgroundColor:light?"#8d712e":"#4c525e"}, horzLine:{labelBackgroundColor:light?"#8d712e":"#4c525e"} },
      rightPriceScale: { borderColor: light ? "#d7dee7" : "#343b37" },
      timeScale: { borderColor: light ? "#d7dee7" : "#343b37" }
    });
  }
}

function flashSettingsSaved() {
  const el = document.getElementById("settings-status");
  if (!el) return;
  el.textContent = "已儲存在這台裝置。";
  clearTimeout(flashSettingsSaved._t);
  flashSettingsSaved._t = setTimeout(() => { el.textContent = "設定會自動保存在目前瀏覽器。"; }, 1800);
}

function initSettings() {
  const theme = getSavedThemeMode();
  applyTheme(theme);

  const email = document.getElementById("setting-email");
  const phone = document.getElementById("setting-phone");
  const freq = document.getElementById("setting-frequency");
  if (email) email.value = localStorage.getItem("ox-setting-email") || "";
  if (phone) phone.value = localStorage.getItem("ox-setting-phone") || "";
  if (freq) freq.value = localStorage.getItem("ox-setting-frequency") || "1h";

  email?.addEventListener("change", () => { localStorage.setItem("ox-setting-email", email.value.trim()); flashSettingsSaved(); });
  phone?.addEventListener("change", () => { localStorage.setItem("ox-setting-phone", phone.value.trim()); flashSettingsSaved(); });
  freq?.addEventListener("change", () => { localStorage.setItem("ox-setting-frequency", freq.value); flashSettingsSaved(); });

  document.querySelectorAll("[data-setting-key]").forEach(input => {
    const key = `ox-setting-${input.dataset.settingKey}`;
    const stored = localStorage.getItem(key);
    if (stored !== null) input.checked = stored === "1";
    if (input.dataset.settingKey === "oxLive") document.documentElement.classList.toggle("ox-live-disabled", !input.checked);
    input.addEventListener("change", () => {
      localStorage.setItem(key, input.checked ? "1" : "0");
      if (input.dataset.settingKey === "oxLive") {
        document.documentElement.classList.toggle("ox-live-disabled", !input.checked);
        document.querySelectorAll('[data-setting-key="oxLive"]').forEach(other => { other.checked = input.checked; });
      }
      flashSettingsSaved();
    });
  });

  document.querySelectorAll("[data-theme-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      localStorage.setItem("ox-ui-theme", btn.dataset.themeChoice);
      applyTheme(btn.dataset.themeChoice);
      flashSettingsSaved();
    });
  });

  const requestNotificationBtn = document.getElementById("btn-request-notification");
  const testNotificationBtn = document.getElementById("btn-test-notification");
  const testSoundBtn = document.getElementById("btn-test-sound");
  requestNotificationBtn?.addEventListener("click", async () => {
    await primeAlertAudio(true);
    const permission = await maybeRequestNotificationPermission({ interactive: true });
    if (permission === "granted") {
      localStorage.setItem("ox-control-notifications-enabled", "1");
      showToast("瀏覽器通知已授權");
    } else if (permission === "denied") {
      showToast("通知已被瀏覽器封鎖，請到網站 / 系統權限重新允許");
    } else {
      showToast("此環境目前無法取得瀏覽器通知權限");
    }
    syncNotificationPermissionUI();
  });
  testNotificationBtn?.addEventListener("click", async () => {
    await primeAlertAudio(true);
    let permission = notificationPlatformInfo().permission;
    if (permission === "default") permission = await maybeRequestNotificationPermission({ interactive: true });
    if (permission !== "granted") {
      syncNotificationPermissionUI();
      return showToast("尚未取得瀏覽器通知權限");
    }
    const sent = await sendBrowserNotification("OX 通知測試", { body: "如果你看到這則通知，瀏覽器 Notification API 已正常工作。", icon: "ox-logo.png", tag: "ox-test-notification" }, { bypassMaster: true });
    showToast(sent ? "測試通知已送出" : "瀏覽器沒有成功顯示通知；請查看下方權限狀態");
  });
  testSoundBtn?.addEventListener("click", async () => {
    const unlocked = await primeAlertAudio(true);
    const played = unlocked ? await playAlertTone("high") : false;
    showToast(played ? "🔔 測試鈴聲已播放" : "瀏覽器尚未解鎖音效，請再點一次或檢查靜音 / 音量");
  });
  syncNotificationPermissionUI();
}

// 系統深淺色改變時，若使用者選擇「隨系統」，即時跟著切換，不需重新整理。
const onSystemThemeChange = () => {
  if (getSavedThemeMode() === "system") applyTheme("system");
};
if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener("change", onSystemThemeChange);
else if (systemThemeQuery.addListener) systemThemeQuery.addListener(onSystemThemeChange);



/* ===== Asset Classification: Crypto radar must be crypto-only before OX analysis ===== */

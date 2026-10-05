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
      const transform = getComputedStyle(chartBox).transform;
      chartBox.animate(
        enabled
          ? [{ transform: `${transform} scale(.965)`, opacity: .86 }, { transform, opacity: 1 }]
          : [{ transform, opacity: 1 }, { transform: `${transform} scale(.985)`, opacity: .9 }],
        { duration: enabled ? 520 : 360, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'both' }
      ).onfinish = () => { chartBox.getAnimations().forEach(animation => animation.cancel()); };
    }
  });
  [100, 300].forEach(ms => setTimeout(() => { resizeChartToContainer(true); updatePriceTimer(); }, ms));
}

function switchAppView(view) {
  if (window.OXFeatures && !window.OXFeatures.enterView(view)) return;
  if (!['home','strength','radar','data','media','settings','news'].includes(view)) return;
  if (document.body.classList.contains('chart-focus')) setChartFocus(false);

  const previous = state.activeView;
  if (view === 'radar' && previous !== 'radar' && state.activeMarket === 'crypto') {
    state.directionFilter = 'long';
    state.currentTab = 'all';
    const radar = document.getElementById('view-radar');
    if (radar) { delete radar.dataset.selectedSymbol; delete radar.dataset.priceDirection; delete radar.dataset.glowLevel; }
    syncScannerFilterUI();
  }
  const order = ['home','strength','radar','data','media','settings'];
  const direction = Math.sign(order.indexOf(view) - order.indexOf(previous));
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  // Switch immediately: holding the old page for its exit animation blocks taps and scrolling.
  document.querySelectorAll('.app-view.ox-view-entering').forEach(el => el.classList.remove('ox-view-entering'));
  document.querySelectorAll('.app-view.ox-mobile-view-in').forEach(el => el.classList.remove('ox-mobile-view-in'));
  {
    state.activeView = view;
    document.body.dataset.view = view;
    document.querySelectorAll('[data-app-view]').forEach(el => el.classList.toggle('active', el.dataset.appView === view));
    document.querySelectorAll('[data-view-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.viewTarget === view));

    const incoming = document.querySelector(`[data-app-view="${view}"]`);
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
      if (view === 'radar' && state.activeMarket === 'crypto') {
        resizeChartToContainer();
        renderCurrentTab();
        renderBenchmarkBar();
      }
    }));
  }
}


function homeStrengthLabel(v) {
  const n = clamp(Math.round(num(v)));
  if (n >= 80) return "強";
  if (n >= 65) return "偏強";
  if (n >= 45) return "中性";
  if (n >= 30) return "偏弱";
  return "弱";
}

function homeMarketState(strength) {
  const btc = num(strength.btcRaw), alt = num(strength.altRaw);
  if (btc >= 68 && alt >= 65) return "偏多趨勢";
  if (btc >= 68 && alt < 52) return "BTC 主導";
  if (alt >= 68 && alt - btc >= 8) return "小幣轉強";
  if (btc <= 38 && alt <= 40) return "偏空環境";
  return "中性整理";
}

function homeStructureText(a, ticker) {
  if (a?.structureLabel) return a.structureLabel;
  if (a?.side === "LONG") return "結構偏多";
  if (a?.side === "SHORT") return "結構偏空";
  if (ticker) return num(ticker.change24h) >= 0 ? "24H 偏強" : "24H 偏弱";
  return "等待分析";
}

function renderHomeOverview() {
  const btc = state.btcTicker;
  const eth = state.ethTicker;
  const btcA = state.analyzedCache.get("BTCUSDT");
  const ethA = state.analyzedCache.get("ETHUSDT");
  const strength = computeMarketStrength();
  const btcStrength = clamp(Math.round(num(strength.btcRaw)));
  const altStrength = clamp(Math.round(num(strength.altRaw)));
  const marketScore = Math.round((btcStrength + altStrength) / 2);
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const setWidth = (id, value) => { const el = document.getElementById(id); if (el) { el.style.width = `${clamp(value)}%`; el.style.setProperty("--meter-color", value < 40 ? "var(--meter-weak)" : value < 60 ? "var(--meter-mid)" : "var(--meter-strong)"); } };
  const setChange = (id, ticker) => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = ticker ? fmtPct(ticker.change24h) : "—";
    el.className = ticker ? (num(ticker.change24h) >= 0 ? "positive" : "negative") : "";
  };

  const marketStateText = homeMarketState(strength);
  setText("home-market-state", marketStateText);
  setText("home-market-score", marketScore);
  setText("home-t1-count", (state.tierMap.t1 || []).length);
  setText("home-t2-count", (state.tierMap.t2 || []).length);
  setText("home-surge-count", (state.tierMap.surge || []).length);
  setText("home-side-market-state", marketStateText);
  setText("home-side-market-score", marketScore);
  setWidth("home-market-meter", marketScore);
  setText("home-side-t1", (state.tierMap.t1 || []).length);
  setText("home-side-t2", (state.tierMap.t2 || []).length);
  setText("home-side-surge", (state.tierMap.surge || []).length);

  // The paired T1 board reads the radar's independent long and short rankings.
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
      change.className = num(candidate.change24h) > 0 ? "positive" : "negative";
      change.textContent = fmtPct(candidate.change24h);
      if(!row.children.length)row.append(tier,identity,score,change);
      displayed.push(row);
    }
    // Reuse buttons during ticker refreshes so a held touch and scroll position
    // survive live updates. Only move rows when the actual ranking changes.
    displayed.forEach((row,index)=>{if(box.children[index]!==row)box.insertBefore(row,box.children[index]||null);});
    for(const child of [...box.children])if(!displayed.includes(child))child.remove();
    const firstFive=displayed.slice(0,5);
    const height=firstFive.reduce((sum,row)=>sum+(row.dataset.groupStart==='true'?64:51),0)+Math.max(0,firstFive.length-1)*9;
    box.style.setProperty('--home-five-rows',`${height}px`);
  }

  setText("home-btc-price", btc ? fmtPrice(btc.lastPr) : "—"); setChange("home-btc-change", btc);
  setText("home-btc-volume", btc ? `${fmtCryptoVolume(btc.usdtVolume)} USDT` : "—");
  const btcHigh24 = btc ? num(btc.high24h ?? btc.high24H ?? btc.highPr ?? btc.highPrice24h) : NaN;
  const btcLow24 = btc ? num(btc.low24h ?? btc.low24H ?? btc.lowPr ?? btc.lowPrice24h) : NaN;
  setText("home-btc-high", Number.isFinite(btcHigh24) && btcHigh24 > 0 ? fmtPrice(btcHigh24) : "—");
  setText("home-btc-low", Number.isFinite(btcLow24) && btcLow24 > 0 ? fmtPrice(btcLow24) : "—");
  setText("home-btc-hero-strength", btcStrength);
  setText("home-btc-market-state", marketStateText);
  setText("home-btc-note", `${homeStructureText(btcA, btc)}${btcA ? ` · OX ${btcA.oxScore}` : ""}`);

  setText("home-eth-price", eth ? fmtPrice(eth.lastPr) : "—"); setChange("home-eth-change", eth);
  setText("home-eth-note", `${homeStructureText(ethA, eth)}${ethA ? ` · OX ${ethA.oxScore}` : ""}`);
  setWidth("home-eth-meter", ethA?.oxScore ?? clamp(50 + num(eth?.change24h) * 350));

  setText("home-btc-strength", btcStrength); setText("home-btc-strength-label", homeStrengthLabel(btcStrength));
  setText("home-btc-strength-note", btcA ? `結構 ${qualitative(btcA.structScore)} · 資金 ${qualitative(btcA.flowScore)} · Setup ${qualitative(btcA.setupScore)}` : "結構 / 資金 / 動能 / Trigger");
  setWidth("home-btc-strength-meter", btcStrength);

  setText("home-alt-strength", altStrength); setText("home-alt-strength-label", homeStrengthLabel(altStrength));
  const altP = strength.altParts;
  setText("home-alt-note", altP ? `已分析 ${strength.sampleSize} · 結構廣度 ${Math.round(altP.structureBreadth)}% · 資金活躍 ${Math.round(altP.moneyBreadth)}%` : `已分析 ${strength.sampleSize} 檔 · 等待更多樣本`);
  setWidth("home-alt-meter", altStrength);
  for (const [id, score] of [["home-btc-arc", btcStrength], ["home-alt-arc", altStrength]]) {
    document.getElementById(id)?.style.setProperty("--meter-color", score < 40 ? "var(--meter-weak)" : score < 60 ? "var(--meter-mid)" : "var(--meter-strong)");
  }
  document.getElementById("home-btc-arc")?.setAttribute("stroke-dasharray", `${btcStrength} 100`);
  document.getElementById("home-alt-arc")?.setAttribute("stroke-dasharray", `${altStrength} 100`);

  // 重要資訊：只從現有 analyzedCache / tierMap 產生，不塞假資料
  const events = [];
  const seen = new Set();
  const pushEvent = (coin, type, reason, tag, icon) => {
    if (!coin?.symbol || seen.has(`${coin.symbol}:${type}`) || events.length >= 6) return;
    seen.add(`${coin.symbol}:${type}`); events.push({ symbol:coin.symbol, type, reason, tag, icon });
  };
  for (const c of (state.tierMap.t1 || []).slice(0, 3)) pushEvent(c, "進入 T1", c.triggerType || c.statusText || "Trigger 已確認", "T1", "⚡");
  for (const c of (state.tierMap.surge || []).slice(0, 3)) pushEvent(c, "異常活躍", `1H 放量 ${c.volRatio1h ?? "—"}x · 24H ${fmtPct(c.change24h)}`, "SURGE", "🔥");
  for (const c of (state.tierMap.t2 || []).slice(0, 3)) pushEvent(c, "接近 Trigger", c.setupName || "結構已就緒", "T2", "◎");
  const rsCandidates = Array.from(state.analyzedCache.values()).filter(c => !benchmarkSymbols.has(c.symbol) && num(c.rsScore) >= 75).sort((a,b)=>num(b.rsScore)-num(a.rsScore));
  for (const c of rsCandidates.slice(0,2)) pushEvent(c, "相對 BTC 轉強", `Relative Strength ${c.rsScore}`, "RS", "↗");
  const eventBox = document.getElementById("home-events");
  if (eventBox) eventBox.innerHTML = events.length ? events.map(e => `<button class="v33-event-row" type="button" data-home-symbol="${e.symbol}"><span class="v33-event-icon">${e.icon}</span><span class="v33-row-main"><b>${e.symbol.replace(/USDT$/,"")} · ${e.type}</b><small>${e.reason}</small></span><span class="v33-row-pill">${e.tag}</span></button>`).join("") : `<div class="v33-list-empty">全市場輪巡進行中</div>`;

  // OX 重點觀察：T1 / T2 最多三個
  const watch = [...(state.tierMap.t1 || []), ...(state.tierMap.t2 || [])].filter((c,i,a)=>a.findIndex(x=>x.symbol===c.symbol)===i).slice(0,3);
  const watchBox = document.getElementById("home-watchlist");
  if (watchBox) watchBox.innerHTML = watch.length ? watch.map(c => `<button class="v33-watch-row" type="button" data-home-symbol="${c.symbol}"><span class="v33-row-main"><b>${c.symbol.replace(/USDT$/,"")} · ${c.setupName || "Setup 分析中"}</b><small>${c.structureLabel || c.side || "結構分析中"}</small><span class="v33-watch-stage">${c.tier === "t1" ? "T1 · 即戰力" : "T2 · 蹲點準備"}</span></span><span class="v33-watch-score">OX ${c.oxScore ?? "—"}</span></button>`).join("") : `<div class="v33-list-empty">等待 T1 / T2 候選標的</div>`;

  // 強弱榜：直接讀現有 ticker 排名結果
  const renderRank = (id, list) => {
    const box = document.getElementById(id); if (!box) return;
    const rows = (list || []).slice(0,5);
    box.innerHTML = rows.length ? rows.map((t,i)=>`<button class="v33-rank-row" type="button" data-home-symbol="${t.symbol}"><span class="v33-rank-no">#${i+1}</span><span class="v33-rank-symbol">${t.symbol.replace(/USDT$/,"")}</span><span class="v33-rank-change ${num(t.change24h)>=0?"positive":"negative"}">${fmtPct(t.change24h)}</span></button>`).join("") : `<div class="v33-list-empty">等待 Ticker</div>`;
  };
  renderRank("home-gainers", state.tierMap.gainers);
  renderRank("home-losers", state.tierMap.losers);

  setText("home-radar-t1", (state.tierMap.t1 || []).length);
  setText("home-radar-t2", (state.tierMap.t2 || []).length);
  setText("home-radar-t3", (state.tierMap.t3 || []).length);
  setText("home-radar-surge", (state.tierMap.surge || []).length);
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

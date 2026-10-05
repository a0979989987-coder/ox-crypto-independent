const { createServer } = require("node:http");
const { readFileSync, existsSync, statSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { chromium } = require("playwright");

const root = join(__dirname, "..");
const testPort = Number(process.env.OX_E2E_PORT || 4173);
const testBase = `http://127.0.0.1:${testPort}`;
const html = readFileSync(join(root, "index.html"), "utf8");
const expectedCss = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1].split("?")[0]);
const classifiedCss = expectedCss;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
});

const chartStub = `
(() => {
  const series = el => ({
    setData(data){ el.dataset.seriesPoints = String(data?.length || 0); },
    update(){}, coordinateToPrice(){return 100}, setMarkers(){}, applyOptions(){}, priceScale(){return {applyOptions(){}, width(){return 60}, options(){return {scaleMargins:{top:.15,bottom:.2}}}}},
    createPriceLine(){return {}}, removePriceLine(){}, priceToCoordinate(){return 50}
  });
  const scale = { height(){return 30}, fitContent(){}, setVisibleLogicalRange(){}, getVisibleLogicalRange(){return {from:0,to:50}}, subscribeVisibleLogicalRangeChange(){}, unsubscribeVisibleLogicalRangeChange(){}, timeToCoordinate(){return 50}, coordinateToTime(){return 1}, scrollToRealTime(){}, applyOptions(){} };
  window.LightweightCharts = {
    CrosshairMode:{Normal:0}, LineStyle:{Dashed:1,Dotted:2},
    createChart(el){
      el.dataset.chartInitialized = "true";
      return {
        addCandlestickSeries(){return series(el)}, addHistogramSeries(){return series(el)}, addLineSeries(){return series(el)},
        timeScale(){return scale}, priceScale(){return {applyOptions(){}, width(){return 60}, options(){return {scaleMargins:{top:.15,bottom:.2}}}}}, applyOptions(){}, resize(){},
        subscribeClick(){}, subscribeCrosshairMove(){}, remove(){}
      };
    }
  };
})();`;

const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT"];
const tickers = symbols.map((symbol, index) => ({
  symbol,
  lastPr: String(index === 0 ? 63250 : 3200 / (index + 1)),
  change24h: String((index % 2 ? -1 : 1) * (0.012 + index * 0.002)),
  usdtVolume: String(index===7 ? 500000 : 900000000 - index * 50000000),
  baseVolume: String(200000 - index * 10000),
  high24h: "65000", low24h: "61000"
}));
const contracts = symbols.map(symbol => ({ symbol, baseCoin: symbol.replace("USDT", ""), quoteCoin: "USDT", symbolStatus: "normal", symbolType: "perpetual" }));
const instruments = symbols.map(symbol => ({ symbol, symbolType: "crypto",type:"perpetual",status:"online",quoteCoin:"USDT", isRwa: false }));
const now = Date.now();
// Directional volume and tested pressure are required by the real scanner.
// These explicit synthetic quotes/series deliberately alternate long and short.
function candlesFor(url){
  const symbol=url.searchParams.get('symbol')||'BTCUSDT',index=Math.max(0,symbols.indexOf(symbol));
  const granularity=url.searchParams.get('granularity')||'1H';
  const amount=parseInt(granularity)||1,unit=granularity.replace(/^[0-9]+/,'').replace(/utc$/,'');
  const duration=amount*({m:60000,H:3600000,D:86400000,W:604800000,M:30*86400000}[unit]||3600000);
  const boundary=Math.floor(now/duration)*duration,values=[];
  const bullish=index%2===0,last=bullish?99.325:100.675,scale=Number(tickers[index].lastPr)/last;
  for(let i=0;i<72;i++){
    let close=i>=56?94+(i-56)*.355:95+Math.sin(i*Math.PI/8)*2;
    const open=values.at(-1)?.close??close-.2;
    values.push({open,close,high:[12,28,44].includes(i)?100:Math.max(open,close)+.25,low:Math.min(open,close)-.25});
  }
  return values.map((c,i)=>{
    const bar=bullish?c:{open:200-c.open,close:200-c.close,high:200-c.low,low:200-c.high};
    return [boundary-(72-i)*duration,bar.open*scale,bar.high*scale,bar.low*scale,bar.close*scale,i>=65?1800:1000,bar.close*scale*(i>=65?1800:1000)].map(String);
  });
}

function bitgetBody(url) {
  if (url.pathname.includes("/api/v3/market/instruments")) return { code: "00000", data: instruments };
  if (url.pathname.endsWith("/contracts")) return { code: "00000", data: contracts };
  if (url.pathname.endsWith("/tickers")) return { code: "00000", data: tickers };
  if (url.pathname.endsWith("/ticker")) {
    const symbol = url.searchParams.get("symbol") || "BTCUSDT";
    return { code: "00000", data: [tickers.find(row => row.symbol === symbol) || tickers[0]] };
  }
  if (url.pathname.endsWith("/candles")) return { code: "00000", data: candlesFor(url) };
  return { code: "00000", data: [] };
}

async function preparePage(context, viewport, { holdCandle } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const audit = { pageErrors: [], consoleErrors: [], assetWarnings: [], localFailures: [], localHttpErrors: [], cssResponses: new Map() };
  page.on("pageerror", error => audit.pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    const row = `${message.text()} @ ${message.location().url || "unknown"}`;
    audit.consoleErrors.push(row);
  });
  page.on("requestfailed", request => { if (request.url().startsWith(testBase)) audit.localFailures.push(`${request.url()}: ${request.failure()?.errorText}`); });
  page.on("response", response => {
    const url = response.url();
    if (url.startsWith(`${testBase}/`) && response.status() >= 400) audit.localHttpErrors.push(`${response.status()} ${new URL(url).pathname}`);
    if (url.startsWith(`${testBase}/`) && new URL(url).pathname.endsWith(".css")) audit.cssResponses.set(new URL(url).pathname.slice(1), response.status());
  });
  await page.addInitScript(() => {
    window.__oxRuntimeAudit = { intervals: [], duplicateIntervals: [], duplicateListeners: [] };
    class AuditWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) { super(); this.url = String(url); this.readyState = AuditWebSocket.OPEN; queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
      send() {} close() { this.readyState = AuditWebSocket.CLOSED; this.dispatchEvent(new CloseEvent("close")); }
    }
    window.WebSocket = AuditWebSocket;
    const callbackIds = new WeakMap();
    let nextId = 1;
    const idFor = callback => {
      if ((typeof callback !== "function" && typeof callback !== "object") || callback === null) return String(callback);
      if (!callbackIds.has(callback)) callbackIds.set(callback, nextId++);
      return callbackIds.get(callback);
    };
    const intervalKeys = new Set();
    const originalInterval = window.setInterval;
    window.setInterval = function(callback, delay, ...args) {
      const key = `${idFor(callback)}:${Number(delay) || 0}`;
      if (intervalKeys.has(key)) window.__oxRuntimeAudit.duplicateIntervals.push(key);
      intervalKeys.add(key);
      window.__oxRuntimeAudit.intervals.push({ key, delay: Number(delay) || 0 });
      return originalInterval.call(this, callback, delay, ...args);
    };
    const registrations = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (listener) {
        let targetMap = registrations.get(this);
        if (!targetMap) { targetMap = new Set(); registrations.set(this, targetMap); }
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        const key = `${type}:${capture}:${idFor(listener)}`;
        if (targetMap.has(key)) window.__oxRuntimeAudit.duplicateListeners.push(key);
        targetMap.add(key);
      }
      return originalAdd.call(this, type, listener, options);
    };
  });
  await page.route("https://unpkg.com/**", route => route.fulfill({ status: 200, contentType: "text/javascript", body: chartStub }));
  // Static preview has no server functions. Model the unconfigured guest state;
  // real auth handlers and configured account UI are tested separately.
  await page.route("**/api/v1/account/config", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ configured: false, providerConnectionVerified: false, databaseConnected: false })
  }));
  await page.route("https://api.bitget.com/**", async route => {
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/candles')&&holdCandle)await holdCandle(url);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bitgetBody(url)) });
  });
  await page.route("https://fapi.binance.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ symbol: "BTCUSDT", lastPrice: "63250", priceChangePercent: "1.2", quoteVolume: "900000000", volume: "12000" }) }));
  await page.route("https://api.bybit.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ retCode: 0, result: { list: [{ lastPrice: "63250", price24hPcnt: ".012", turnover24h: "900000000", volume24h: "12000" }] } }) }));
  await page.route("https://ox-crypto-screener.vercel.app/api/v1/tw/**", route => {
    const url = new URL(route.request().url());
    const symbol = url.searchParams.get("symbol") || "2330";
    const data = url.pathname.endsWith("/quote")
      ? { symbol, name: symbol === "2330" ? "台積電" : "測試個股", market: symbol === "6488" ? "TPEX" : "TWSE", price: 123.5, changePct: 1.25, volume: 10000, turnoverTwd: 1235000, dataDate: "2026-09-23" }
      : url.pathname.endsWith("/radar") ? {items:[{symbol:"2330",name:"台積電",market:"TWSE",price:123.5,changePct:1.25,score:90,tier:"T1",volume:10000,turnoverTwd:1235000,dataDate:"2026-09-23"}]} : {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  await page.route("https://www.tradingview-widget.com/**", route => route.fulfill({contentType:"text/html",body:"<p>Isolated widget fixture, no prices</p>"}));
  return { page, audit };
}

async function loadApp(page) {
  await page.goto(testBase, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#chart")?.dataset.chartInitialized === "true");
  await page.waitForFunction(() => document.querySelectorAll("#view-radar .coin-card").length > 0, null, { timeout: 15000 });
}

async function cssAudit(page, audit) {
  const result = await page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => new URL(link.href).pathname.slice(1)),
    sheets: [...document.styleSheets].map(sheet => ({ href: sheet.href ? new URL(sheet.href).pathname.slice(1) : null, rules: (() => { try { return sheet.cssRules.length; } catch { return -1; } })() }))
  }));
  assert(JSON.stringify(result.hrefs.slice(0, expectedCss.length)) === JSON.stringify(expectedCss), "CSS link order differs from RC2 definition");
  assert(classifiedCss.length === 42, `Expected 42 classified CSS modules in current main, found ${classifiedCss.length}`);
  for (const path of expectedCss) {
    assert(audit.cssResponses.get(path) === 200, `CSS did not return HTTP 200: ${path}`);
    const sheet = result.sheets.find(row => row.href === path);
    assert(sheet && sheet.rules > 0, `CSS has no readable rules: ${path}`);
  }
  return { classified: classifiedCss.length, total: expectedCss.length, rules: result.sheets.reduce((sum, row) => sum + Math.max(0, row.rules), 0) };
}

async function openControl(page) {
  if (await page.locator("#ox-control-overlay").getAttribute("aria-hidden") !== "false") await page.click("#ox-control-open");
  await page.waitForSelector("#ox-control-overlay.is-open");
}

async function selectMarket(page, market) {
  await openControl(page);
  await page.click(`[data-market-choice="${market}"]`);
}

async function tierCapacityRegression(page) {
  // Ranking capacity uses explicit qualified fixtures after the real scanner's
  // OHLCV qualification check; no fixture is sent to a provider or persisted.
  const report = await page.evaluate(() => globalThis.eval(`(() => {
    const previous={cache:state.analyzedCache,tickers:state.tickers,tab:state.currentTab,side:state.directionFilter};
    const templates=['long','short'].map(side=>Object.values(state.tierMapBySide[side]).flat()[0]);
    const reports=[];
    try {
      for(const quality of ['T1','T3','OBSERVATION']) {
        const input=templates.flatMap((base,sideIndex)=>Array.from({length:55},(_,i)=>{
          const symbol='QACAP'+sideIndex+'X'+i+'USDT',side=base.side.toLowerCase();
          const signal={...base.classicSignal,tier:quality==='OBSERVATION'?null:quality,
            ...(quality==='OBSERVATION'?{eligible:false,observationEligible:true}:{}),
            qualityScore:(quality==='T1'?95:70)-i/100};
          return {...base,symbol,at:Date.now(),tier:quality.toLowerCase(),classic:{...base.classic,[side]:signal},classicSignal:signal};
        }));
        state.analyzedCache=new Map(input.map(row=>[row.symbol,row]));
        state.tickers=input.map(row=>({...row.ticker,symbol:row.symbol,lastPr:String(row.lastPrice)}));
        rebuildTierLists();
        const counts={};
        for(const side of ['long','short']) {
          state.directionFilter=side;
          counts[side]={};
          for(const tier of ['t1','t2','t3']) {
            state.currentTab=tier;renderCurrentTab();
            counts[side][tier]=document.querySelectorAll('#screener-list .coin-card').length;
          }
        }
        reports.push({quality,counts});
      }
    } finally {
      state.analyzedCache=previous.cache;state.tickers=previous.tickers;
      state.currentTab=previous.tab;state.directionFilter=previous.side;
      rebuildTierLists();renderCurrentTab();
    }
    return reports;
  })()`));
  for (const {quality,counts} of report) for (const side of ['long','short']) {
    assert(counts[side].t1 === (quality === 'T1' ? 10 : 0), `${side}: strict T1 capacity or exclusion failed`);
    assert(counts[side].t2 === 15 && counts[side].t3 === 15, `${side}: native T2/T3 did not render 15/15 cards`);
  }
  console.log(`Native tier capacity passed at ${page.viewportSize().width}px: strict T1, T2=15, T3=15, separated long/short`);
}

async function selectView(page, view) {
  const desktop = page.locator(`.ox-desktop-nav [data-view-target="${view}"]`);
  if (await desktop.isVisible()) await desktop.click();
  else await page.click(`.app-dock [data-view-target="${view}"]`);
  if (await page.locator("body").getAttribute("data-market") === "tw")
    await page.waitForFunction(view => document.body.dataset.view === view && !document.querySelector("#market-unavailable-card")?.hidden, view);
  else await page.waitForSelector(`#view-${view}.active`);
}

async function desktopRegression(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: [] });
  const { page, audit } = await preparePage(context, { width: 1440, height: 1000 });
  await loadApp(page);

  await selectView(page, "home");
  assert(await page.locator("#view-home").isVisible(), "Desktop Home is not visible");
  await page.waitForFunction(() => document.querySelector("#home-btc-mini-chart")?.dataset.chartInitialized === "true", null, { timeout: 10000 });
  assert(await page.locator("#home-btc-mini-chart").getAttribute("data-chart-initialized") === "true", "Desktop BTC Home chart did not initialize");
  await selectView(page, "strength");
  assert(await page.locator("#view-strength").isVisible(), "Desktop Strength is not visible");
  await selectView(page, "radar");
  assert(await page.locator("#view-radar").isVisible(), "Desktop Radar is not visible");
  assert(await page.locator("#chart").getAttribute("data-chart-initialized") === "true", "Desktop BTC chart did not initialize");
  const memberships=await page.evaluate(()=>globalThis.eval(`({long:Object.values(state.tierMapBySide.long).flat().map(c=>({symbol:c.symbol,side:c.side,eligible:c.classicSignal.eligible})),short:Object.values(state.tierMapBySide.short).flat().map(c=>({symbol:c.symbol,side:c.side,eligible:c.classicSignal.eligible}))})`));
  assert(memberships.long.length>1&&memberships.long.every(c=>c.eligible&&c.side==='LONG'),'Long ranking includes only qualified upward structures');
  assert(memberships.short.length>1&&memberships.short.every(c=>c.eligible&&c.side==='SHORT'),'Short ranking remains separate');
  await tierCapacityRegression(page);
  await page.evaluate(() => globalThis.eval('setScannerDirectionFilter("long")'));
  await page.waitForFunction(() => !document.querySelector("#view-radar")?.classList.contains("ox-filter-short"));
  await page.waitForFunction(() => {
    const rgb = getComputedStyle(document.querySelector("#view-radar .market-line-card")).borderTopColor.match(/[\d.]+/g)?.slice(0,3).map(Number);
    return rgb && Math.min(...rgb) > 80;
  });
  const longGlass = await page.locator("#view-radar .market-line-card").evaluate(el => getComputedStyle(el).borderTopColor.match(/[\d.]+/g)?.slice(0,3).map(Number));
  assert(longGlass && Math.min(...longGlass) > 80, `Long ranking glass lacks current white border: ${longGlass}`);
  await page.evaluate(() => globalThis.eval('setScannerDirectionFilter("short")'));
  await page.waitForFunction(() => document.querySelector("#view-radar")?.classList.contains("ox-filter-short"));
  await page.waitForFunction(() => {
    const rgb = getComputedStyle(document.querySelector("#view-radar .market-line-card")).borderTopColor.match(/[\d.]+/g)?.slice(0,3).map(Number);
    return rgb && Math.min(...rgb) > 80;
  });
  const shortState = await page.evaluate(() => {
    const radar = document.querySelector("#view-radar"), toggle = document.querySelector("#direction-toggle"), card = document.querySelector("#view-radar .market-line-card");
    return { radar: radar.className, toggle: toggle.className, border: getComputedStyle(card).borderTopColor, rgb: getComputedStyle(card).borderTopColor.match(/[\d.]+/g)?.slice(0,3).map(Number) };
  });
  assert(shortState.rgb && Math.min(...shortState.rgb) > 80, `Short ranking glass lacks current white border: ${JSON.stringify(shortState)}`);
  await page.evaluate(() => globalThis.eval('setScannerDirectionFilter("long")'));
  await page.waitForFunction(() => !document.querySelector("#view-radar")?.classList.contains("ox-filter-short"));

  const cards = page.locator("#view-radar .coin-card");
  assert(await cards.count() > 1, "Radar did not render switchable Crypto symbols");
  const targetSymbol = await cards.nth(1).getAttribute("data-symbol");
  await cards.nth(1).click();
  await page.waitForFunction(symbol => document.querySelector("#ticker-pair")?.textContent.includes(symbol), targetSymbol);
  await page.click('.btn-tf[data-tf="4H"]');
  assert(await page.locator('.btn-tf[data-tf="4H"]').evaluate(el => el.classList.contains("active")), "Timeframe did not switch to 4H");

  await selectMarket(page, "tw");
  assert(await page.locator("#market-unavailable-card").isVisible(), "TW market placeholder did not display");
  await page.click("#ox-control-close");
  await page.locator('[data-twr-mode="chart"]').click();
  assert(await page.locator('.twcr-scanner .ox-loading-ring').count()===0,'TW radar must not animate its background data loading');
  await page.locator('.twcr-search-open').click();
  await page.waitForSelector(".twcr-search-dialog input");
  await page.fill(".twcr-search-dialog input", "2330");
  await page.waitForSelector('.twcr-search-results [data-search-symbol="2330"]');
  assert((await page.locator('.twcr-search-results [data-search-symbol="2330"]').innerText()).includes("2330"), "TW stock search did not display the selected official snapshot symbol");
  await page.locator('.twcr-search-dialog [data-action="search-close"]').click();
  await selectView(page, "strength");
  await page.locator('[data-tw-tool="bubbles"]').click();
  await page.waitForFunction(() => Number(document.querySelector('#ox-tw-patterns')?.shadowRoot?.querySelector('canvas')?.dataset.coins) > 0);
  assert(await page.locator('[data-tw-tool]').count() === 3, "Taiwan indicators must have three aligned tools");
  assert(await page.locator('.ox-data-loading').count() === 0, "Loading must stay inside the data area");
  await selectView(page, "radar");
  await selectMarket(page, "crypto");
  assert(await page.locator("#view-radar").isVisible(), "Crypto market did not restore");

  await openControl(page);
  assert(await page.locator("#ox-control-panel").isVisible(), "Control Panel did not open");
  await page.click('[data-control-theme="light"]');
  assert(await page.locator("body").evaluate(el => el.classList.contains("theme-light")), "Light theme did not apply");
  assert(await page.evaluate(() => localStorage.getItem("ox-ui-theme")) === "light", "Light theme preference was not saved");
  await page.click("#ox-control-close");
  await selectView(page, "home");
  const lightHero = await page.locator('.ox-home-chart').evaluate(el => {
    const background = getComputedStyle(el).backgroundColor;
    const foreground = getComputedStyle(el.querySelector('.ox-home-ticker')).color;
    return {background,foreground};
  });
  assert(lightHero.background !== lightHero.foreground, "Light Home text must contrast its background");
  await openControl(page);
  await page.click('[data-control-theme="dark"]');
  assert(!(await page.locator("body").evaluate(el => el.classList.contains("theme-light"))), "Dark theme did not apply");

  const search = page.locator("#ox-feature-search-input-v38");
  await search.fill("通知");
  assert(await page.locator('#ox-feature-results-v38 [data-feature-id="notifications"]').isVisible(), "Feature search did not find notification settings");
  await page.click('#ox-feature-results-v38 [data-feature-id="notifications"]');
  await page.waitForSelector("#view-settings.active");
  assert(await page.locator("#notification-permission-state").isVisible(), "Notification UI is not visible");

  await page.fill("#setting-email", "regression@example.com");
  await page.locator("#setting-email").dispatchEvent("change");
  await page.click('[data-theme-choice="light"]');
  await page.waitForTimeout(50);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#chart")?.dataset.chartInitialized === "true");
  assert(await page.evaluate(() => localStorage.getItem("ox-ui-theme")) === "light", "Theme LocalStorage preference was lost after reload");
  assert(await page.inputValue("#setting-email") === "regression@example.com", "Settings LocalStorage preference was lost after reload");

  const css = await cssAudit(page, audit);
  const runtime = await page.evaluate(() => window.__oxRuntimeAudit);
  assert(runtime.duplicateIntervals.length === 0, `Duplicate intervals detected: ${runtime.duplicateIntervals.join(",")}`);
  assert(runtime.duplicateListeners.length === 0, `Duplicate event listeners detected: ${runtime.duplicateListeners.join(",")}`);
  assert(audit.pageErrors.length === 0, `Desktop page errors: ${audit.pageErrors.join(" | ")}`);
  assert(audit.consoleErrors.length === 0, `Desktop console errors: ${audit.consoleErrors.join(" | ")}`);
  assert(audit.localFailures.length === 0, `Desktop local request failures: ${audit.localFailures.join(" | ")}`);
  assert(audit.localHttpErrors.length === 0, `Desktop local HTTP errors: ${audit.localHttpErrors.join(" | ")}`);
  await context.close();
  return { cards: 3, css, intervals: runtime.intervals.length };
}

async function mobileRegression(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, permissions: [] });
  const { page, audit } = await preparePage(context, { width: 390, height: 844 });
  await loadApp(page);

  await selectView(page, "home");
  const homeLayout = await page.evaluate(() => {
    const hero = document.querySelector(".v34-home-btc-primary, .btc-premium-card, #home-btc-mini-chart")?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, heroWidth: hero?.width || 0, heroLeft: hero?.left || 0, heroRight: hero?.right || 0 };
  });
  assert(homeLayout.overflow <= 2, `Mobile Home horizontal overflow: ${homeLayout.overflow}px`);
  assert(homeLayout.heroWidth > 0 && homeLayout.heroLeft >= -2 && homeLayout.heroRight <= 392, "Mobile BTC Hero is outside the viewport");
  assert(await page.locator(".app-dock .dock-btn").count() === 5, "Mobile bottom navigation is incomplete");
  assert(await page.locator(".app-dock").isVisible(), "Mobile bottom navigation is not visible");

  await selectView(page, "radar");
  assert(await page.locator("#view-radar").isVisible(), "Mobile Radar is not visible");
  const chartRect = await page.locator("#chart").boundingBox();
  assert(chartRect && chartRect.width > 200 && chartRect.height > 200, `Mobile chart layout is invalid: ${JSON.stringify(chartRect)}`);
  const railRect = await page.locator("#view-radar .workspace > aside").boundingBox();
  assert(railRect && Math.abs(railRect.y - chartRect.y) < 450 && railRect.x >= chartRect.x + chartRect.width - 2,
    `Mobile chart and ranked coins are not side by side: ${JSON.stringify({ chartRect, railRect })}`);
  const mobileCoin = page.locator("#view-radar .coin-card").nth(1);
  await mobileCoin.waitFor({state:'visible'});
  await tierCapacityRegression(page);
  const mobileSymbol = await mobileCoin.getAttribute("data-symbol");
  await mobileCoin.click();
  await page.waitForFunction(symbol => document.querySelector("#ticker-pair")?.textContent.includes(symbol), mobileSymbol);
  assert(await page.locator("#view-radar .workspace > aside").isVisible(), "Ranking disappeared after selecting a coin");
  await page.click("#radar-scanner-toggle");
  await page.click("#btn-chart-fullscreen");
  await page.waitForFunction(() => document.body.classList.contains("chart-focus"));
  assert(await page.locator("body").evaluate(el => el.classList.contains("chart-focus")), "Mobile chart fullscreen did not open");
  const focusClarity = await page.evaluate(() => ({
    boxFilter: getComputedStyle(document.querySelector(".chart-box")).filter,
    boxBackdrop: getComputedStyle(document.querySelector(".chart-box")).backdropFilter,
    chartFilter: getComputedStyle(document.querySelector("#chart")).filter,
    chartOpacity: getComputedStyle(document.querySelector("#chart")).opacity
  }));
  assert(focusClarity.boxFilter === "none" && focusClarity.chartFilter === "none" && focusClarity.chartOpacity === "1", `Mobile fullscreen clarity styles invalid: ${JSON.stringify(focusClarity)}`);
  await page.click("#btn-chart-exit-overlay");
  await page.waitForFunction(() => !document.body.classList.contains("chart-focus"));

  await openControl(page);
  assert(await page.locator("#ox-control-panel").isVisible(), "Mobile Control Panel did not open");
  await page.click('[data-control-theme="light"]');
  assert(await page.locator("body").evaluate(el => el.classList.contains("theme-light")), "Mobile light theme did not apply");
  await page.click('[data-control-theme="dark"]');
  assert(!(await page.locator("body").evaluate(el => el.classList.contains("theme-light"))), "Mobile dark theme did not apply");
  await page.click('[data-market-choice="tw"]');
  assert(await page.locator("#market-unavailable-card").isVisible(), "Mobile market switch to TW failed");
  await page.click("#ox-control-close");
  await page.locator('[data-twr-mode="chart"]').click();
  await page.locator('.twcr-search-open').click();
  await page.waitForSelector('.twcr-search-dialog input');
  await page.fill('.twcr-search-dialog input', '2330');
  await page.waitForSelector('.twcr-search-results [data-search-symbol="2330"]');
  assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 2, "Mobile TW chart radar overflowed");
  await page.locator('.twcr-search-dialog [data-action="search-close"]').click();
  await selectView(page, "strength");
  await page.locator('[data-tw-tool="bubbles"]').click();
  await page.waitForFunction(() => Number(document.querySelector('#ox-tw-patterns')?.shadowRoot?.querySelector('canvas')?.dataset.coins) > 0);
  assert(await page.locator('[data-tw-tool]').count() === 3, "Taiwan indicators must have three aligned tools");
  assert(await page.locator('.ox-data-loading').count() === 0, "Loading must stay inside the data area");
  await selectView(page, "radar");
  await selectMarket(page, "crypto");
  assert(await page.locator("#view-radar").isVisible(), "Mobile market switch back to Crypto failed");
  await page.click("#ox-control-close");
  await page.waitForSelector("#ox-control-overlay:not(.is-open)");

  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    bodyOverflow: document.body.scrollWidth - window.innerWidth,
    offenders: [...document.querySelectorAll("body *")].map(el => ({ el, rect: el.getBoundingClientRect(), style: getComputedStyle(el) }))
      .filter(x => x.style.position !== "fixed" && x.rect.width > 0 && x.rect.right > window.innerWidth + 2)
      .slice(0, 5).map(x => `${x.el.id || x.el.className || x.el.tagName}:${Math.round(x.rect.right)}`)
  }));
  assert(layout.overflow <= 2, `Mobile layout regression: html=${layout.overflow}px body=${layout.bodyOverflow}px offenders=${layout.offenders.join(",")}`);
  const css = await cssAudit(page, audit);
  const runtime = await page.evaluate(() => window.__oxRuntimeAudit);
  assert(runtime.duplicateIntervals.length === 0, `Mobile duplicate intervals detected: ${runtime.duplicateIntervals.join(",")}`);
  assert(runtime.duplicateListeners.length === 0, `Mobile duplicate event listeners detected: ${runtime.duplicateListeners.join(",")}`);
  assert(audit.pageErrors.length === 0, `Mobile page errors: ${audit.pageErrors.join(" | ")}`);
  assert(audit.consoleErrors.length === 0, `Mobile console errors: ${audit.consoleErrors.join(" | ")}`);
  assert(audit.localFailures.length === 0, `Mobile local request failures: ${audit.localFailures.join(" | ")}`);
  assert(audit.localHttpErrors.length === 0, `Mobile local HTTP errors: ${audit.localHttpErrors.join(" | ")}`);
  await context.close();
  return { overflow: layout.overflow, css, intervals: runtime.intervals.length };
}

module.exports = { server, preparePage, selectMarket, selectView, testBase, bitgetBody };
async function progressiveRadarRegression(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  let release;const pending=new Promise(resolve=>release=resolve);
  const {page,audit}=await preparePage(context,{width:390,height:844},{holdCandle:url=>url.searchParams.get('symbol')==='DOGEUSDT'?pending:Promise.resolve()});
  try {
    await page.goto(testBase,{waitUntil:'domcontentloaded'});
    await page.locator('#view-radar .coin-card[data-symbol="SOLUSDT"]').waitFor({timeout:10000});
    assert(await page.evaluate(()=>globalThis.eval('!state.radarSnapshotReady')),'A cold scan must publish before the full pass finishes');
    assert(await page.locator('#view-radar .coin-card[data-symbol="DOGEUSDT"]').count()===0,'Pending analysis cannot enter the radar');
    assert(await page.locator('#radar-scanner-panel .ox-loading-ring').count()===0,'Incremental radar must not show loading animation');
    assert(!(await page.locator('#radar-scanner-panel').innerText()).includes('正在整理全市場榜單'),'A pending request cannot replace the available ranking');
    release();
    await page.locator('#view-radar .coin-card[data-symbol="DOGEUSDT"]').waitFor({timeout:10000});
    assert(await page.locator('#view-radar .coin-card[data-symbol="SOLUSDT"]').count()===1,'Earlier results remain available when a later result is added');
    assert(audit.pageErrors.length===0,'Incremental rendering raised a runtime error');
    console.log('Progressive radar passed: available results render during a blocked candle request, then the completed symbol joins without a loading animation');
  } finally {release();await context.close();}
}
if (require.main === module) (async () => {
  await new Promise(resolve => server.listen(testPort, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.OX_BROWSER_PATH ? {executablePath:process.env.OX_BROWSER_PATH} : {}) })
    .catch(() => chromium.launch({ channel: "chrome", headless: true }));
  try {
    await progressiveRadarRegression(browser);
    const desktop = await desktopRegression(browser);
    const mobile = await mobileRegression(browser);
    console.log(`Desktop regression passed: Crypto cards=${desktop.cards}, CSS=${desktop.css.classified}/${desktop.css.total}, rules=${desktop.css.rules}, intervals=${desktop.intervals}`);
    console.log(`Mobile regression passed: 390x844, overflow=${mobile.overflow}px, CSS=${mobile.css.classified}/${mobile.css.total}, intervals=${mobile.intervals}`);
    console.log("Console/runtime audit passed: no page errors, console errors, local 404s, duplicate listeners, or duplicate intervals");
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exit(1);
});

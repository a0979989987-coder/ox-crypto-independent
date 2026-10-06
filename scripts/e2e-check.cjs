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
  await page.route("https://www.tradingview-widget.com/**", route => route.fulfill({contentType:"text/html",body:"<p>Isolated widget fixture, no prices</p>"}));
  return { page, audit };
}

// Compatibility helpers used by dedicated Crypto UI checks.
async function selectMarket(page,market){if(market!=='crypto')throw Error('Only Crypto is available');await page.evaluate(()=>OXMarketController.setMarket('crypto'));}
async function selectView(page,view){await page.evaluate(view=>switchAppView(view),view);await page.waitForSelector(`#view-${view}.active`);}
module.exports={server,preparePage,selectMarket,selectView,testBase,bitgetBody};
if(require.main===module)import('./independent-ui-check.mjs').catch(error=>{console.error(error);process.exitCode=1;});

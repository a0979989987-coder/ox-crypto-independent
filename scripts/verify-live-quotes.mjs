import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
process.env.OX_E2E_PORT='4308';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(r=>server.listen(4308,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'}),{page,audit}=await preparePage(context,{width,height:900});const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{window.__quoteSockets=[];class WS extends EventTarget{static OPEN=1;static CLOSED=3;constructor(url){super();this.url=url;this.readyState=0;this.sent=[];window.__quoteSockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.dispatchEvent(new Event('open'));});}send(s){this.sent.push(s);}close(){this.readyState=3;this.onclose?.();this.dispatchEvent(new Event('close'));}push(symbol,change,price,ts){this.onmessage?.({data:JSON.stringify({arg:{instType:'USDT-FUTURES',channel:'ticker',instId:symbol},data:[{symbol,lastPr:price,change24h:change,quoteVolume:123456789,ts}],ts})});}}window.WebSocket=WS;});
 await page.route('**/api/v1/account/**',r=>{const endpoint=new URL(r.request().url()).pathname.split('/').at(-1);return r.fulfill({json:endpoint==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:endpoint==='session'?{ok:true,user:null}:{configured:false}});});
 await page.route('https://api.bitget.com/**',r=>r.fulfill({json:fixtureBody(r.request().url())}));await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));await routeSnapshots(page);
 await page.goto(testBase,{waitUntil:'networkidle'});
 // Attribute work when it enters the shared scheduler. A request which was
 // already queued by the radar can start while an unrelated quote is painted.
 await page.evaluate(()=>{
   window.__quoteCandleCalls=[];const feed=globalThis.OXPublicFeed;
   globalThis.OXPublicFeed={...feed,json(url,options){
     const stack=new Error().stack||'';
     if(String(url).includes('/candles?')&&stack.includes('/crypto/live-quotes.js'))window.__quoteCandleCalls.push(String(url));
     return feed.json(url,options);
   }};
 });
 await page.evaluate(()=>switchAppView('strength'));
 // Classification comparisons need the completed index; progressive ranking
 // can legitimately replace or reorder the first card while it is filling.
 await page.locator('#ox-crypto-tools-inline .px[data-index-state="ready"]').filter({visible:true}).waitFor({timeout:30000});
 const first=page.locator('#ox-crypto-tools-inline .px-card').filter({visible:true}).first();await first.waitFor();
 const resultKey=await first.getAttribute('data-result');
 const card=page.locator('#ox-crypto-tools-inline .px-card[data-result="'+resultKey+'"]').filter({visible:true});await card.evaluate(el=>el.scrollIntoView({block:'center'}));
 const symbol=(await card.getAttribute('data-result')).split(':')[0];
 await page.waitForFunction(symbol=>window.__quoteSockets.some(ws=>ws.readyState===1&&ws.sent.some(s=>s!=='ping'&&JSON.parse(s).op==='subscribe'&&JSON.parse(s).args.some(a=>a.channel==='ticker'&&a.instId===symbol))),symbol);
 const before=await card.evaluate(el=>({tier:el.dataset.tier,ox:el.querySelector('.px-energy strong').textContent}));
 const started=Date.now();await page.evaluate(symbol=>{const ws=window.__quoteSockets.findLast(ws=>ws.readyState===1&&ws.sent.some(s=>s!=='ping'&&JSON.parse(s).args?.some(a=>a.channel==='ticker'&&a.instId===symbol)));window.__activeQuoteSocket=ws;window.__pushStamp=Date.now()+1000;ws.push(symbol,.1234,123456,window.__pushStamp);},symbol);
 await assert.doesNotReject(()=>card.locator('.px-change').filter({hasText:'+12.34%'}).waitFor({timeout:1500}));const patternLatencyMs=Date.now()-started;
 assert.equal(await card.getAttribute('data-tier'),before.tier);assert.equal(await card.locator('.px-energy strong').textContent(),before.ox);
 await page.evaluate(symbol=>window.__activeQuoteSocket.push(symbol,.01,1,window.__pushStamp-1),symbol);assert.equal(await card.locator('.px-change').textContent(),'+12.34%');
 await page.evaluate(()=>{switchAppView('radar');eval("state.currentTab='surge'");renderCurrentTab();});const radar=page.locator('#screener-list .coin-card[data-symbol="BTCUSDT"]');await radar.waitFor();
 // Progressive scans replace cards; do not hold a stale element while
 // Playwright waits for scroll-animation stability. Resolve the locator at
 // scroll time, then verify the actual quote subscription and visible text.
 await radar.evaluate(el=>el.scrollIntoView({block:'center'}));
 await page.waitForFunction(()=>window.__quoteSockets.some(ws=>ws.readyState===1&&ws.sent.some(s=>s!=='ping'&&JSON.parse(s).op==='subscribe'&&JSON.parse(s).args.some(a=>a.channel==='ticker'&&a.instId==='BTCUSDT'))));const radarBefore=requests.length,radarStart=Date.now();await page.evaluate(()=>{const ws=window.__quoteSockets.findLast(ws=>ws.readyState===1&&ws.sent.some(s=>s!=='ping'&&JSON.parse(s).args?.some(a=>a.channel==='ticker'&&a.instId==='BTCUSDT')));ws.push('BTCUSDT',-.0567,123456,Date.now()+2000);});
 await radar.locator('.turnover-change').filter({hasText:'-5.67%'}).waitFor({timeout:1500});assert.match(await radar.locator('.turnover-price').textContent(),/123.?456/);const quoteCandleCalls=await page.evaluate(()=>window.__quoteCandleCalls);assert.deepEqual(quoteCandleCalls,[],'ticker delivery and rendering must not enqueue candle downloads');
 const radarLatencyMs=Date.now()-radarStart,concurrentBackgroundCandleRequests=requests.slice(radarBefore).filter(u=>u.includes('/candles?')).length;
 // Positive control: prove this assertion would catch a candle request made
 // by a quote subscriber, without cancelling ordinary background work.
 await page.evaluate(()=>{
   let sent=false;window.__quoteProbe=OXCryptoQuotes.subscribe(['BTCUSDT'],()=>{if(sent)return;sent=true;
     OXPublicFeed.json('https://api.bitget.com/api/v2/mix/market/candles?symbol=BTCUSDT&granularity=1m&productType=USDT-FUTURES&limit=2').catch(()=>{});
   });
 });
 await page.waitForFunction(()=>window.__quoteCandleCalls.length===1);await page.evaluate(()=>window.__quoteProbe.stop());
 results.push({width,simulatedTickerPush:true,patternLatencyMs,radarLatencyMs,classificationUntouched:true,quoteTriggeredCandleRequests:quoteCandleCalls.length,concurrentBackgroundCandleRequests,requestAttributionPositiveControl:true,errors:audit.pageErrors});assert.deepEqual(audit.pageErrors,[]);await context.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await writeFile('docs/performance/live-quotes-browser.json',JSON.stringify({note:'Browser timings use injected WebSocket ticker messages and fixed HTTP fixtures; not a physical iPhone or protected Vercel preview.',results},null,2)+'\n');console.log(JSON.stringify(results));

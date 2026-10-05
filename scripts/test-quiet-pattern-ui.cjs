// Recorded exchange data verifies cold indexing versus silent return visits.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict'),{spawn}=require('child_process');
const base='http://127.0.0.1:4198',snapshot=JSON.parse(fs.readFileSync('previews/data/crypto-tools-snapshot.json'));
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','4198']);
(async()=>{await new Promise(r=>server.stdout.once('data',r));const browser=await chromium.launch({executablePath:process.env.OX_CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(base+'/__quiet',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:10px;background:#101416;color:white}</style><script src="/src/components/loading-state.js"></script><div id="host"></div>'}));
 for(const market of ['crypto','tw']){
  await page.goto(base+'/__quiet');await page.evaluate(async({snapshot,market})=>{
   const {mountPatternSearch}=await import('/src/markets/crypto/patterns/view.js?v=20261002-quiet1');
   const {parseCandles}=await import('/src/markets/crypto/patterns/source.js?v=20261002-rank8');
   const {prepareCandles,indexPrepared}=await import('/src/markets/crypto/patterns/matcher.js?v=20261002-rank8');
   const candles=parseCandles(snapshot.candles.BTCUSDT.response.data,'15m',snapshot.requestTime),indexed=indexPrepared(prepareCandles(candles));
   const data={symbol:'BTCUSDT',frame:'15m',market,source:'Recorded exchange fixture',candles,serverTime:snapshot.requestTime,turnover:1e9,change:1,preclassified:indexed.matches,classic:indexed.classic};
   window.metrics={calls:0,loads:0};const original=OXLoading.begin;window.OXLoading={...OXLoading,begin:(...a)=>{metrics.loads++;return original(...a);}};
   const pool={serverTime:snapshot.requestTime,tickers:[{symbol:'BTCUSDT'}]};
   window.opts={source:{id:market,defaultFrames:['15m'],TIMEFRAMES:{'15m':900},fetchUniverse:async()=>pool,primeCandleCache(){},fetchSeries:async()=>data,scanCurrent:()=>false,scanUniverse:async(_,frames,{onSeries,onProgress})=>{
    metrics.calls++;await new Promise(r=>window.releaseSeries=r);await onSeries(data);onProgress({done:1,total:2,failed:0,coinsDone:1,coinsTotal:2});await new Promise(r=>window.releaseScan=r);onProgress({done:2,total:2,failed:0,coinsDone:2,coinsTotal:2});
   }},cache:{INDEX_VERSION:9,readIndex:async()=>[],saveIndex(){},pruneIndex(){},entryCurrent:()=>true}};
   window.mount=()=>window.api=mountPatternSearch(document.querySelector('#host'),opts);mount();
  },{snapshot,market});
  await page.locator('.px-board.is-scanning').waitFor();assert.equal(await page.evaluate(()=>metrics.loads),1);
  await page.evaluate(()=>releaseSeries());await page.waitForFunction(()=>!!window.releaseScan);await page.waitForTimeout(300);
  assert.equal(await page.locator('.px-status-row').isVisible(),true,'initial scan remains visible after indexing starts');
  const position=await page.evaluate(()=>{const s=document.querySelector('#host').shadowRoot;return {status:s.querySelector('.px-status-row').getBoundingClientRect().bottom,grid:s.querySelector('.px-grid').getBoundingClientRect().top};});assert(position.status<=position.grid);
  await page.evaluate(()=>releaseScan());await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('.px').dataset.indexState!=='loading');
  assert.equal(await page.locator('.px-status-row').isVisible(),false);assert(await page.locator('.px-card').count()>0);
  await page.evaluate(()=>{api.destroy();mount();});await page.waitForFunction(()=>metrics.calls===2);
  assert.equal(await page.evaluate(()=>metrics.loads),1,'remount starts background scan without loader');assert.equal(await page.locator('.is-scanning').count(),0);assert.equal(await page.locator('.px-status-row').isVisible(),false);assert(await page.locator('.px-card').count()>0,'classified results remain visible during background refresh');
  for(const width of [320,390,1363]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('[data-tier-filter="3"]').click();assert.equal(await page.locator('.px-status-row').isVisible(),false);}
  await page.screenshot({path:'/tmp/ox-quiet-'+market+'.png'});await page.evaluate(()=>{releaseSeries();releaseScan();api.destroy();});console.log('PASS '+market+': cold progress, retained classification, silent remount, no status/card overlap at 320/390/1363');
 }
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');await page.route(base+'/__home',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(base+'/__home');await page.evaluate(()=>{document.body.dataset.view='home';document.querySelectorAll('.app-view').forEach(el=>el.classList.toggle('active',el.id==='view-home'));for(const list of document.querySelectorAll('.ox-home-t1-list'))list.innerHTML=Array.from({length:30},(_,i)=>`<div class="ox-home-t1-row"><span class="ox-home-t1-identity">${i} BTC</span><small>OX 79</small><em>+1%</em></div>`).join('');});
 for(const width of [390,1363]){await page.setViewportSize({width,height:844});await page.waitForTimeout(120);assert.equal(await page.locator('header .live').count(),0);assert.equal(await page.locator('header .ox-ui-mode').count(),0);assert.equal(await page.locator('header #btn-force-rescan').count(),0);const lists=await page.locator('#view-home .ox-home-t1-list').evaluateAll(ls=>ls.map(l=>{l.scrollTop=100;const c=getComputedStyle(l);return {scroll:l.scrollTop,style:c.scrollbarWidth};}));assert(lists.length);assert(lists.every(x=>x.scroll>0&&x.style==='none'));}
 assert.deepEqual(errors,[]);console.log('PASS homepage scroll still works, scrollbar hidden, header controls absent');
}finally{await browser.close();server.kill();}})().catch(e=>{console.error(e);server.kill();process.exitCode=1;});

// Same fixture, network delays and idle window on the previous and new tree.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
const root=resolve(process.env.OX_BENCH_ROOT||new URL('..',import.meta.url).pathname),out=process.env.OX_BENCH_OUT||'/tmp/ox-round3-after.json';
process.env.OX_E2E_PORT=process.env.OX_E2E_PORT||'4310';
const {server,preparePage,testBase}=createRequire(resolve(root,'package.json'))('./scripts/e2e-check.cjs');
const {FEATURE_CATALOG}=await import(resolve(root,'server/account/feature-catalog.js'));
await new Promise(r=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',hasTouch:width<700});
  const {page,audit}=await preparePage(context,{width,height:900}),cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const requests=[],bodies=[];page.on('request',r=>requests.push({url:r.url(),at:Date.now()}));
  page.on('response',r=>bodies.push((async()=>{try{return {url:r.url(),at:Date.now(),bytes:(await r.body()).length};}catch{return {url:r.url(),bytes:0};}})()));
  await page.route('**/api/v1/account/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('feature-access')?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:{ok:true,user:null,configured:false}}));
  await page.route('https://api.bitget.com/**',async r=>{await new Promise(resolve=>setTimeout(resolve,150));await r.fulfill({json:fixtureBody(r.request().url())});});
  await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));await routeSnapshots(page);
  await page.route('**/src/generated/tool-*.js*',async r=>{await new Promise(resolve=>setTimeout(resolve,350));await r.continue();});
  await page.route(/\/src\/(?:markets\/crypto\/(?:bubbles|patterns|analytics)\/(?:bubbles|patterns|flow)(?:-light)?|styles\/themes\/light-tool-roles)\.css/,async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.continue();});
  const start=Date.now();await page.goto(testBase,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>eval('state.candleData').length>0);const chartMs=Date.now()-start;
  await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});const radarMs=Date.now()-start;
  await page.waitForTimeout(15000);
  async function metrics(){await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));}
  const idleMetrics=await metrics(),prepared=await page.evaluate(()=>globalThis.OXToolWarmup?.stats()||null),beforeVisit=requests.length;
  const samples=[];await page.evaluate(()=>switchAppView('strength'));
  for(const id of ['bubbles','heatmap','rotation','patterns']){
   const before=requests.length,m0=await metrics(),begin=Date.now();await page.locator('#ox-crypto-tools-nav [data-crypto-tool="'+id+'"]').click();
   const selector=id==='bubbles'?'.oxb-asset-grid button':id==='heatmap'?'.cfx-heat-list button':id==='rotation'?'.cfx-replay':'.px-board';
   await page.locator('#ox-crypto-tools-inline '+selector).filter({visible:true}).first().waitFor({timeout:35000});const controlsMs=Date.now()-begin;
   let freshMs=controlsMs,completeMs=null;
   if(['heatmap','rotation'].includes(id)){
    await page.waitForFunction(()=>[...document.querySelector('#ox-crypto-tools-inline').children].some(h=>!h.hidden&&['partial','complete'].includes(h.shadowRoot?.querySelector('.cfx')?.dataset.scanState)),null,{timeout:35000});freshMs=Date.now()-begin;
    await page.waitForFunction(()=>[...document.querySelector('#ox-crypto-tools-inline').children].some(h=>!h.hidden&&h.shadowRoot?.querySelector('.cfx')?.dataset.scanState==='complete'),null,{timeout:35000});completeMs=Date.now()-begin;
   }
   if(id==='patterns'){await page.locator('#ox-crypto-tools-inline .px-card').filter({visible:true}).first().waitFor({timeout:35000});freshMs=Date.now()-begin;await page.locator('#ox-crypto-tools-inline .px[data-index-state="ready"]').filter({visible:true}).waitFor({timeout:45000});completeMs=Date.now()-begin;}
   const m1=await metrics(),during=requests.slice(before);samples.push({tool:id,controlsMs,freshMs,completeMs,newRequests:during.length,newAssets:during.filter(r=>/tool-(?:patterns|bubbles|analytics)\.js|(?:patterns|bubbles|flow)(?:-light)?\.css/.test(r.url)).length,marketRequests:during.filter(r=>r.url.includes('api.bitget.com')).length,cpuMs:1000*(m1.TaskDuration-m0.TaskDuration),heap:m1.JSHeapUsedSize});
   console.log(width,id,JSON.stringify(samples.at(-1)));
  }
  const final=await metrics();assert.deepEqual(audit.pageErrors,[]);results.push({width,chartMs,radarMs,prepared,idle:{heap:idleMetrics.JSHeapUsedSize,requests:beforeVisit},samples,final:{heap:final.JSHeapUsedSize,nodes:final.Nodes,requests:requests.length},requests,bodies:await Promise.all(bodies),errors:audit.pageErrors});await context.close();
 }
 await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify({conditions:{apiLatencyMs:150,moduleLatencyMs:350,cssLatencyMs:250,idleAfterFirstRadarMs:15000,fixtureSymbols:8,cache:'HTTP cache disabled by Playwright routes; application caches enabled',heap:'JS heap after GC, excludes worker and GPU memory',browser:await browser.version(),iphonePhysical:false},results},null,2));console.log(out);
} finally {await browser.close();await new Promise(r=>server.close(r));}

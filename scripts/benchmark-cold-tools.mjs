// Each tool gets a new browser context: no prior tool, storage, or market cache.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
const root=resolve(process.env.OX_BENCH_ROOT||new URL('..',import.meta.url).pathname);
process.env.OX_E2E_PORT=process.env.OX_E2E_PORT||'4307';
const {server,preparePage,testBase}=createRequire(resolve(root,'package.json'))('./scripts/e2e-check.cjs');
const {FEATURE_CATALOG}=await import(resolve(root,'server/account/feature-catalog.js'));
await new Promise(r=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const samples=[];
try{
 for(const width of [390,1440])for(const tool of ['radar','patterns','bubbles','heatmap','rotation','flow']){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'});
  const {page,audit}=await preparePage(context,{width,height:900});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000));
  await page.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:endpoint==='session'?{ok:true,user:null}:{configured:false}});});
  await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));
  await page.route('https://api.bitget.com/**',async r=>{await new Promise(resolve=>setTimeout(resolve,80));return r.fulfill({headers:{'Timing-Allow-Origin':'*','Access-Control-Allow-Origin':'*'},json:fixtureBody(r.request().url())});});
  await routeSnapshots(page);
  const start=Date.now();await page.goto(testBase,{waitUntil:'domcontentloaded'});
  let openedMs=0,firstMs,effectiveMs,completeMs=null;
  if(tool==='radar'){
   await page.locator('#view-radar .coin-card').first().waitFor({timeout:45000});firstMs=effectiveMs=Date.now()-start;
   await page.waitForFunction(()=>eval('state.radarSnapshotReady'),null,{timeout:45000});completeMs=Date.now()-start;
  }else{
   await page.waitForFunction(()=>typeof switchAppView==='function',null,{timeout:45000});
   await page.evaluate(()=>switchAppView('strength'));
   await page.locator('#ox-crypto-tools-nav [data-crypto-tool="'+tool+'"]').click();openedMs=Date.now()-start;
   const selector=tool==='patterns'?'.px-card':tool==='bubbles'?'.oxb-asset-grid button':tool==='heatmap'?'.cfx-heat-list button':tool==='rotation'?'.cfx-replay':'.cfx-flow-data';
   await page.locator('#ox-crypto-tools-inline '+selector).filter({visible:true}).first().waitFor({timeout:45000});firstMs=effectiveMs=Date.now()-start;
   if(tool==='patterns'){await page.locator('#ox-crypto-tools-inline .px[data-index-state="ready"]').filter({visible:true}).waitFor({timeout:45000});completeMs=Date.now()-start;}
   if(['heatmap','rotation','flow'].includes(tool)){
    for(const complete of [false,true]){
     await page.waitForFunction(({tool,complete})=>{
      const host=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot?.querySelector('.cfx'));
      const el=host?.shadowRoot.querySelector('.cfx');if(!el)return false;
      const rows=el.querySelectorAll(tool==='heatmap'?'.cfx-heat-list button':tool==='rotation'?'.cfx-rank-row':'.cfx-flow-data tbody tr').length;
      const fresh=el.dataset.scanState?complete?el.dataset.scanState==='complete':['partial','complete'].includes(el.dataset.scanState):/Bitget (?:行情)?更新|手動取得/.test(el.querySelector('[data-slot="source"]')?.textContent||'');
      return rows>0&&fresh;
     },{tool,complete},{timeout:45000});
     if(complete)completeMs=Date.now()-start;else effectiveMs=Date.now()-start;
    }
   }
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const resource=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,end:r.responseEnd,duration:r.duration,bytes:r.encodedBodySize,transfer:r.transferSize})));
  const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  assert.deepEqual(audit.pageErrors,[]);
  const sample={width,tool,openedMs,firstMs,effectiveMs,completeMs,resourceCount:resource.length,bytes:resource.reduce((n,r)=>n+r.bytes,0),marketRequestCount:resource.filter(r=>r.name.includes('api.bitget.com')).length,heap:metrics.JSHeapUsedSize,cpuMs:metrics.TaskDuration*1000,resource,errors:audit.pageErrors};
  samples.push(sample);console.log(JSON.stringify({...sample,resource:undefined}));await context.close();
 }
 await writeFile(process.env.OX_BENCH_OUT||resolve(root,'docs/performance/cold-after.json'),JSON.stringify({conditions:{apiLatencyMs:80,fixtureSymbols:8,context:'new context for every tool; includes shell startup and concurrently active radar',navigation:'strength opens default patterns before requested tab; real application behavior',cache:'HTTP cache disabled by routing; empty storage and application caches each case',fresh:'effectiveMs requires fresh REST results; initial recorded snapshot is only firstMs',runs:1,browser:await browser.version(),heap:'main JS heap after forced GC; worker/GPU excluded',iphonePhysical:false},samples},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

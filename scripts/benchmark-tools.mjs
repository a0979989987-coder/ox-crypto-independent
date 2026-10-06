// Deterministic browser benchmark; fixture data never reaches the product.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const root=resolve(process.env.OX_BENCH_ROOT||new URL('..',import.meta.url).pathname);
process.env.OX_E2E_PORT=process.env.OX_E2E_PORT||'4301';
const {server,preparePage,testBase,bitgetBody}=createRequire(resolve(root,'package.json'))('./scripts/e2e-check.cjs');
const {FEATURE_CATALOG}=await import(resolve(root,'server/account/feature-catalog.js'));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
await new Promise(r=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',r));
const results=[];
const tools=['patterns','bubbles','heatmap','rotation','flow'];
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'});
  const {page,audit}=await preparePage(context,{width,height:900});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  await page.addInitScript(()=>{
   performance.setResourceTimingBufferSize(10000);const timings=[],workers=[];window.__bench={timings,workers};let feed;
   const originalFetch=window.fetch;
   window.fetch=async(...args)=>{const url=String(args[0]),start=performance.now();const result=await originalFetch(...args);const decode=result.json.bind(result);result.json=async()=>{const data=await decode();timings.push({type:'network',url,start,end:performance.now()});return data;};return result;};
   Object.defineProperty(window,'OXPublicFeed',{configurable:true,get:()=>feed,set:value=>{feed={...value,json:(url,options)=>{const start=performance.now();return value.json(url,options).finally(()=>timings.push({type:'queue+network',url:String(url),start,end:performance.now()}));}};}});
   const NativeWorker=window.Worker;
   window.Worker=class extends NativeWorker{constructor(...args){super(...args);const jobs=new Map();const send=this.postMessage.bind(this);this.postMessage=(data,...rest)=>{jobs.set(data.id,performance.now());return send(data,...rest);};this.addEventListener('message',({data})=>{if(jobs.has(data.id)){workers.push(performance.now()-jobs.get(data.id));jobs.delete(data.id);}});}};
  });
  await page.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:endpoint==='session'?{ok:true,user:null}:{configured:false}});});
  await page.route('https://api.coingecko.com/**',route=>route.fulfill({json:[]}));
  await page.route('https://api.bitget.com/**',async route=>{await new Promise(r=>setTimeout(r,80));await route.fulfill({headers:{'Timing-Allow-Origin':'*','Access-Control-Allow-Origin':'*'},json:fixtureBody(route.request().url())});});
  await routeSnapshots(page);
  const initial=Date.now();await page.goto(testBase,{waitUntil:'domcontentloaded'});
  await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});
  const firstRadar=Date.now()-initial;
  await page.waitForFunction(()=>eval('state.radarSnapshotReady'),null,{timeout:45000});
  const fullRadar=Date.now()-initial;
  async function stats(){await cdp.send('HeapProfiler.collectGarbage');const resource=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,bytes:r.encodedBodySize,transfer:r.transferSize,start:r.startTime,end:r.responseEnd})));const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));return {resource,heap:metrics.JSHeapUsedSize,nodes:metrics.Nodes,tasks:metrics.TaskDuration,bench:await page.evaluate(()=>__bench)};}
  const base=await stats();const samples=[{tool:'radar',mode:'cold',firstMs:firstRadar,completeMs:fullRadar,...base}];
  await page.evaluate(()=>switchAppView('strength'));
  for(const mode of ['first','evicted-return'])for(const tool of tools){
   console.log(width,mode,tool);const before=await stats(),start=Date.now();
   await page.locator('#ox-crypto-tools-nav [data-crypto-tool="'+tool+'"]').click();
   const visible=page.locator('#ox-crypto-tools-inline');
   const selector=tool==='patterns'?'.px-card':tool==='bubbles'?'.oxb-asset-grid button':tool==='heatmap'?'.cfx-heat-list button':tool==='rotation'?'.cfx-replay':'.cfx-flow-data';
   await visible.locator(selector).filter({visible:true}).first().waitFor({timeout:35000});
   const firstMs=Date.now()-start;let effectiveMs=firstMs;
   if(tool==='patterns')await visible.locator('.px[data-index-state="ready"]').filter({visible:true}).waitFor({timeout:45000});
   let completeMs=tool==='patterns'?Date.now()-start:null;
   if(['heatmap','rotation','flow'].includes(tool)){
    const isAfter=await page.evaluate(()=>document.querySelector('#ox-crypto-tools-inline').querySelectorAll('div').length>0&&[...document.querySelector('#ox-crypto-tools-inline').children].some(h=>h.shadowRoot?.querySelector('.cfx')?.dataset.scanState));
    await page.waitForFunction(({tool,isAfter,complete})=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot?.querySelector('.cfx')),el=h?.shadowRoot?.querySelector('.cfx');if(!el)return false;const status=el.querySelector('[data-slot="source"]')?.textContent||'',rows=el.querySelectorAll(tool==='heatmap'?'.cfx-heat-list button':tool==='rotation'?'.cfx-rank-row':'.cfx-flow-data tbody tr').length;return rows>0&&(isAfter?complete?el.dataset.scanState==='complete':['partial','complete'].includes(el.dataset.scanState):/Bitget (?:行情)?更新|手動取得/.test(status));},{tool,isAfter,complete:false},{timeout:35000});effectiveMs=Date.now()-start;
    await page.waitForFunction(({tool,isAfter})=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot?.querySelector('.cfx')),el=h?.shadowRoot?.querySelector('.cfx');return isAfter?el?.dataset.scanState==='complete':/Bitget (?:行情)?更新|手動取得/.test(el?.querySelector('[data-slot="source"]')?.textContent||'');},{tool,isAfter},{timeout:35000});completeMs=Date.now()-start;
   }

   const after=await stats();samples.push({tool,mode,firstMs,effectiveMs,completeMs,requestDelta:after.resource.length-before.resource.length,bytesDelta:after.resource.reduce((s,r)=>s+r.bytes,0)-before.resource.reduce((s,r)=>s+r.bytes,0),heap:after.heap,nodes:after.nodes,cpuMs:(after.tasks-before.tasks)*1000,workerMs:after.bench.workers.slice(before.bench.workers.length).reduce((s,n)=>s+n,0),marketCalls:after.bench.timings.slice(before.bench.timings.length),resource:after.resource.slice(before.resource.length)});
   if(mode==='first'){await page.locator('#ox-crypto-tools-nav [data-crypto-tool="strength"]').click();const hotBefore=await stats(),hotStart=Date.now();await page.locator('#ox-crypto-tools-nav [data-crypto-tool="'+tool+'"]').click();await visible.locator(selector).filter({visible:true}).first().waitFor();const hotMs=Date.now()-hotStart,hotAfter=await stats();samples.push({tool,mode:'retained-return',firstMs:hotMs,completeMs:null,requestDelta:hotAfter.resource.length-hotBefore.resource.length,bytesDelta:hotAfter.resource.reduce((s,r)=>s+r.bytes,0)-hotBefore.resource.reduce((s,r)=>s+r.bytes,0),heap:hotAfter.heap,resource:hotAfter.resource.slice(hotBefore.resource.length)});}
  }
  results.push({width,samples,errors:audit.pageErrors,final:await stats()});await context.close();
 }
 const out=process.env.OX_BENCH_OUT||resolve(root,'docs/performance/after.json');await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify({conditions:{apiLatencyMs:80,fixtureSymbols:8,heap:'CDP JSHeapUsedSize after forced GC; worker/GPU memory excluded',chart:'real bundled LightweightCharts',browser:await browser.version(),cache:'HTTP cache disabled by Playwright routes; in-memory application caches enabled',iphonePhysical:false},results},null,2));console.log(out);
}finally{await browser.close();await new Promise(r=>server.close(r));}

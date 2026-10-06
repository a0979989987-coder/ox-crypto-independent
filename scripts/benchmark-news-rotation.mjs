// Same recorded news and synthetic 80 ms market responses on both commits.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
import {fixtureBody,fixtureSnapshots} from './performance-fixtures.mjs';
const target=process.argv[2]||'after',root=target==='before'?'/tmp/ox-r4-baseline':new URL('../',import.meta.url).pathname;
process.env.OX_E2E_PORT='4310';const {server,preparePage,testBase}=createRequire(root+'/package.json')('./scripts/e2e-check.cjs');
await new Promise(r=>server.listen(4310,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const news=JSON.parse(await readFile(new URL('../data/news.json',import.meta.url),'utf8')),now=Date.now(),{market,flow}=fixtureSnapshots(now),reports=[];
try{
 for(const width of [390,1440])for(const warm of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'}),{page,audit}=await preparePage(context,{width,height:900});const requests=[];
  page.on('request',r=>requests.push(r.url()));
  await page.route('**/api/v1/account/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('feature-access')?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:{ok:true,user:null,configured:false}}));
  await page.route('https://api.bitget.com/**',async r=>{await new Promise(done=>setTimeout(done,80));return r.fulfill({json:fixtureBody(r.request().url(),now)});});
  await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));
  for(const [name,data] of [['crypto-tools',market],['crypto-flow',flow]])await page.route('**/previews/data/'+name+'-snapshot.json',r=>r.fulfill({json:data}));
  await page.route('**/data/news.json*',async r=>{await new Promise(done=>setTimeout(done,80));return r.fulfill({json:news});});
  await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});
  if(warm)await page.waitForFunction(()=>OXToolWarmup.stats().every(j=>j.status==='ready'),null,{timeout:45000});
  const beforeRequests=requests.length,start=Date.now();await page.evaluate(()=>OXNews.openMarket());await page.locator('.oxn-event-row').first().waitFor({timeout:15000});const firstNewsMs=Date.now()-start;
  const newsRequests=requests.slice(beforeRequests).length;
  await page.evaluate(()=>switchAppView('radar'));const returnStart=Date.now();await page.evaluate(()=>OXNews.openMarket());await page.locator('.oxn-event-row').first().waitFor();const newsReturnMs=Date.now()-returnStart;
  await page.evaluate(()=>switchAppView('strength'));const rotationStart=Date.now();await page.locator('[data-crypto-tool="rotation"]').click();const rootLocator=page.locator('#ox-crypto-tools-inline .cfx').filter({visible:true});await rootLocator.locator('canvas').waitFor();const rotationEntryMs=Date.now()-rotationStart;
  const canvas=rootLocator.locator('canvas');await canvas.evaluate(c=>c.dataset.probe='same');const filterStart=Date.now();await rootLocator.locator('[data-control="period"]').selectOption('4h');await rootLocator.locator('canvas').waitFor();const periodChangeMs=Date.now()-filterStart,sameCanvas=await rootLocator.locator('canvas').getAttribute('data-probe')==='same';
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const heap=(await cdp.send('Runtime.getHeapUsage')).usedSize;
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\.(js|css)(\?|$)/.test(r.name)).map(r=>({name:r.name,duration:r.duration,bytes:r.encodedBodySize})));
  reports.push({target,width,warm,firstNewsMs,newsReturnMs,newsRequests,rotationEntryMs,periodChangeMs,sameCanvas,jsCssBodyBytes:resources.reduce((n,r)=>n+r.bytes,0),jsCssRequests:resources.length,heapAfterGc:heap,errors:audit.pageErrors});await context.close();console.log(JSON.stringify(reports.at(-1)));
 }
 await writeFile(`docs/performance/round4-${target}.json`,JSON.stringify({conditions:{apiLatencyMs:80,news:news.news.length,events:news.events.length,fixtureMarketSymbols:market.tickers.length,heap:'JS heap only; excludes workers/GPU; not a physical iPhone'},runs:reports},null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}

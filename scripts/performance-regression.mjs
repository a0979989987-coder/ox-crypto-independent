import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
process.env.OX_E2E_PORT='4305';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(r=>server.listen(4305,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const reports=[];await mkdir('docs/performance/screenshots',{recursive:true});
async function pageFor(width,{workerFail=false,cssFail=false,moduleFail=false,limited=false,slow=false,stayRadar=false}={}){
 const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',hasTouch:width<600});const {page,audit}=await preparePage(context,{width,height:900});let requests=[],timeline=[],blocked=cssFail,failModule=moduleFail,limitedCalls=0;
 page.on('request',r=>{requests.push(r.url());timeline.push({url:r.url(),at:Date.now()});});
 await page.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:endpoint==='session'?{ok:true,user:null}:{configured:false}});});
 await page.route('https://api.bitget.com/**',async r=>{if(limited&&++limitedCalls===1)return r.fulfill({status:429,headers:{'Retry-After':'1'}});await new Promise(resolve=>setTimeout(resolve,slow?350:40));return r.fulfill({json:fixtureBody(r.request().url())});});
 await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));await routeSnapshots(page);
 if(workerFail)await page.route('**/src/generated/pattern-worker.js*',r=>r.abort('failed'));
 if(cssFail)await page.route('**/patterns-light.css*',r=>blocked?r.fulfill({status:503,body:'unavailable'}):r.continue());
 if(moduleFail)await page.route('**/src/generated/tool-bubbles.js*',r=>failModule?r.abort('failed'):r.continue());
 await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});
 if(!stayRadar)await page.evaluate(()=>switchAppView('strength'));
 return {page,context,audit,requests,timeline,unblock(){blocked=failModule=false;},calls:()=>limitedCalls};
}
const tool=(p,id)=>p.locator('#ox-crypto-tools-nav [data-crypto-tool="'+id+'"]').click();
const active=(p,s)=>p.locator('#ox-crypto-tools-inline '+s).filter({visible:true});
try{
 for(const width of [390,1440]){
  const {page,context,audit,requests,timeline}=await pageFor(width,{stayRadar:true});
  await page.waitForFunction(()=>OXToolWarmup.stats().every(job=>job.status==='ready'),null,{timeout:35000});
  const starts=timeline.filter(r=>/tool-(?:bubbles|analytics|patterns)\.js/.test(r.url));
  assert.deepEqual(starts.map(r=>/tool-(\w+)/.exec(r.url)[1]),['bubbles','analytics','patterns']);
  assert.ok(starts.slice(1).every((r,i)=>r.at-starts[i].at>=650),'each tool leaves an idle gap');
  assert.equal(await page.locator('#ox-crypto-tools-inline').evaluate(el=>[...el.children].filter(h=>h.shadowRoot).length),0,'preparation never builds hidden charts');
  const before=requests.length;await page.evaluate(()=>switchAppView('strength'));
  await tool(page,'heatmap');await active(page,'.cfx[data-scan-state="complete"]').waitFor();
  await tool(page,'rotation');await active(page,'.cfx[data-scan-state="complete"]').waitFor();
  assert.equal(requests.slice(before).filter(u=>u.includes('granularity=15m')&&u.includes('limit=200')).length,0,'both tools reuse the same fresh complete pool');
  for(const id of ['bubbles','patterns','rotation','bubbles'])await tool(page,id);
  await active(page,'.oxb-asset-grid button').first().waitFor();assert.equal(await active(page,'.cfx:not(.oxb),.px').count(),0,'old async work cannot replace latest tool');
  assert.deepEqual(audit.pageErrors,[]);reports.push({width,stagedWarmup:true,order:starts.map(r=>/tool-(\w+)/.exec(r.url)[1]),noOffscreenCharts:true,sharedFreshPool:true});await context.close();
 }
 for(const width of [390,1440]){
  const {page,context,audit,requests}=await pageFor(width);const root=active(page,'.px');await root.waitFor();await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return h?.shadowRoot.querySelector('.px')?.dataset.indexState==='ready';},{},{timeout:35000});
  assert.ok((await page.evaluate(()=>OXToolWarmup.stats().filter(j=>j.status==='running').length))<=1,'background preparation is sequential while a foreground tool is open');
  await root.evaluate(el=>el.dataset.retentionProbe='original');
  // The actual drawing canvas and its preferences must survive a neighbouring tool.
  const board=active(page,'.px-board canvas');await board.scrollIntoViewIfNeeded();const box=await board.boundingBox();await page.mouse.move(box.x+20,box.y+70);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+30);await page.mouse.move(box.x+box.width*.65,box.y+80);await page.mouse.move(box.x+box.width-20,box.y+30);await page.mouse.up();
  const pixels=await board.evaluate(c=>c.toDataURL());
  await tool(page,'bubbles');await active(page,'.oxb-asset-grid button').first().waitFor();
  const before=requests.length;await tool(page,'patterns');assert.equal(await root.getAttribute('data-retention-probe'),'original');assert.ok(await board.evaluate(c=>c.toDataURL()).then(s=>s.length>100));assert.equal(requests.slice(before).some(u=>u.includes('/candles?')),false,'return must not start full scan');assert.equal(await active(page,'[data-action="undo"]').isEnabled(),true,'drawing preserved');
  await tool(page,'bubbles');await active(page,'select[aria-label="泡泡數量"]').selectOption('30');await active(page,'[data-action="in"]').click();
  const bubbleBefore=await active(page,'canvas').getAttribute('data-zoom');await tool(page,'heatmap');try{await active(page,'.cfx-heat-list button').first().waitFor();}catch(error){const detail=await active(page,'.cfx').evaluate(el=>({scan:el.dataset.scanState,mode:el.querySelector('.cfx-content')?.dataset.mode,coverage:el.querySelector('[data-slot="heat-coverage"]')?.textContent,notice:el.querySelector('.cfx-notice')?.textContent,content:el.querySelector('.cfx-content')?.textContent?.slice(0,180)}));throw new Error(`熱力圖切換未準備：${JSON.stringify(detail)}；行情請求 ${requests.filter(u=>u.includes('/candles?')).length}；頁面錯誤 ${JSON.stringify(audit.pageErrors)}`,{cause:error});}await active(page,'[data-control="period"]').selectOption('1h');
  await tool(page,'rotation');await active(page,'[data-action="replay-toggle"]').click();await active(page,'.cfx-replay').waitFor();await active(page,'[data-action="zoom-in"]').click();
  await tool(page,'flow');await active(page,'.cfx-research-panel').waitFor();await active(page,'[data-control="period"]').selectOption('4h');await active(page,'[data-control="period"]').selectOption('15m');await active(page,'[data-control="period"]').selectOption('1h');
  // All tools visited exceeds the retained-view budget: small preferences restore on remount.
  await tool(page,'bubbles');await active(page,'.oxb-asset-grid button').first().waitFor();assert.equal(await active(page,'select[aria-label="泡泡數量"]').inputValue(),'30');
  await tool(page,'heatmap');await active(page,'.cfx-heat-list button').first().waitFor();assert.equal(await active(page,'[data-control="period"]').inputValue(),'1h');
  const hosts=await page.locator('#ox-crypto-tools-inline').evaluate(el=>[...el.children].filter(c=>c.shadowRoot).length);assert.ok(hosts<=(width<700?2:3),'bounded retained hosts');
  // Fast navigation may finish old downloads, but only the newest tool mounts visibly.
  for(const id of ['patterns','bubbles','heatmap','rotation','flow','patterns'])await tool(page,id);
  await active(page,'.px-board').waitFor();assert.equal(await active(page,'.oxb-shell,.cfx').count(),0);
  await page.evaluate(()=>{switchAppView('radar');switchSymbol('ETHUSDT');switchSymbol('SOLUSDT');switchSymbol('BTCUSDT');});
  await page.evaluate(()=>{for(const tf of ['1H','4H','1D'])document.querySelector('#chart-timeframe-strip [data-tf="'+tf+'"]')?.click();});
  await page.waitForFunction(()=>eval('state.symbol')==='BTCUSDT'&&eval('state.candleData').length>0&&Number(eval('state.candleData').at(-1).close)>60000);
  assert.equal(await page.evaluate(()=>eval('state.period')),'1D');
  // Visibility and offline/online signals are synthetic, not an actual iPhone suspension.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await context.setOffline(true);await context.setOffline(false);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
  await page.evaluate(()=>switchAppView('strength'));await active(page,'.px-board').waitFor();
  assert.deepEqual(audit.pageErrors,[]);assert.equal(requests.some(u=>/\/api\/v1\/tw\/|\/data\/tw-/.test(u)),false);
  reports.push({width,retainedHosts:hosts,stateRestore:true,rapidNavigation:true,syntheticVisibilityAndReconnect:true,errors:audit.pageErrors});await context.close();
 }
 for(const kind of ['css','module','worker','slow429']){
  const setup=await pageFor(390,{cssFail:kind==='css',moduleFail:kind==='module',workerFail:kind==='worker',limited:kind==='slow429',slow:kind==='slow429'}),{page,context,requests}=setup;
  if(kind==='css'){await active(page,'.ox-style-loading button').waitFor({timeout:15000});assert.ok(requests.filter(u=>u.includes('patterns-light.css')).length<=2);setup.unblock();await active(page,'.ox-style-loading button').click();await active(page,'.px-card').first().waitFor({timeout:25000});}
  else if(kind==='module'){const before=requests.filter(u=>u.includes('tool-bubbles.js')).length;await tool(page,'bubbles');await active(page,'.ox-tool-load-error button').waitFor({timeout:10000});const calls=requests.filter(u=>u.includes('tool-bubbles.js')).length;assert.ok(calls-before>=1&&calls-before<=2&&calls<=4,'shared warm/foreground module attempts remain bounded');setup.unblock();await active(page,'.ox-tool-load-error button').click();await active(page,'.oxb-asset-grid button').first().waitFor();}
  else {await active(page,'.px-card').first().waitFor({timeout:35000});await active(page,'.px[data-index-state="ready"]').waitFor({timeout:45000});}
  reports.push({fault:kind,recovered:true});await context.close();
 }
 console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

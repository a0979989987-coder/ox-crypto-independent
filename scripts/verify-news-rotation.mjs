import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
process.env.OX_E2E_PORT='4308';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(r=>server.listen(4308,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const reports=[];
const active=(p,s)=>p.locator('#ox-crypto-tools-inline '+s).filter({visible:true});
const tool=(p,id)=>p.locator(`[data-crypto-tool="${id}"]`).click();
async function setup(width,theme='dark'){
 const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'}),{page,audit}=await preparePage(context,{width,height:900});
 const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(theme=>localStorage.setItem('ox-ui-theme',theme),theme);
 await page.route('**/api/v1/account/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('feature-access')?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:{ok:true,user:null,configured:false}}));
 await page.route('https://api.bitget.com/**',async r=>{await new Promise(done=>setTimeout(done,80));return r.fulfill({json:fixtureBody(r.request().url())});});
 await routeSnapshots(page);await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));
 await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});await page.evaluate(()=>switchAppView('strength'));
 return {page,context,audit,requests};
}
try{
 for(const [width,theme] of [[320,'dark'],[390,'dark'],[390,'light'],[1440,'dark'],[1440,'light']]){
  const {page,context,audit,requests}=await setup(width,theme);
  await tool(page,'rotation');await active(page,'.cfx-research-panel').waitFor();
  const canvas=active(page,'.cfx-plot canvas');await canvas.evaluate(c=>c.dataset.identity='original');
  const plot=await active(page,'.cfx-plot').boundingBox();assert.ok(plot.height>=500);assert.ok(plot.width<=width);
  assert.ok(await active(page,'.cfx-chart-meta').evaluate(el=>el.compareDocumentPosition(el.parentElement.querySelector('.cfx-plot'))&Node.DOCUMENT_POSITION_PRECEDING),'coverage caption follows the plot');
  const periods=await active(page,'select[data-control="period"]').evaluate(el=>[...el.options].map(o=>o.value));for(const period of ['15m','30m','1h','2h','4h','6h','12h','1d'])assert.ok(periods.includes(period));
  const toolbar=active(page,'.cfx-research-toolbar'),toolbarSize=await toolbar.evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,controls:[...e.children].map(c=>({text:c.textContent,width:c.getBoundingClientRect().width}))}));assert.ok(toolbarSize.scroll<=toolbarSize.client+1,`single toolbar row fits at ${width}px: ${JSON.stringify(toolbarSize)}`);
  await active(page,'[data-action="zoom-in"]').click();const zoom=await active(page,'[data-slot="zoom"]').textContent();assert.equal(zoom,'150%');
  await active(page,'[data-action="picker"]').click();
  assert.equal(await active(page,'.cfx-picker-group').count(),31,'all first-level groups remain selectable');
  await active(page,'[data-topic-group="meme"] summary').click();
  await active(page,'[data-topic-group="meme"] .cfx-topic').first().waitFor();
  assert.equal(await active(page,'[data-topic-group="meme"] .cfx-topic').count(),19,'second-level topics expand on demand');
  assert.match(await active(page,'[data-topic-group="meme"] .cfx-topic').first().textContent(),/DOGE/);
  await active(page,'[data-action="select-none"]').click();await active(page,'[data-item]').first().check();await active(page,'[data-action="close-picker"]').click();
  await active(page,'[data-action="view-rank"]').click();await active(page,'.cfx-rotation-table').waitFor();await active(page,'[data-action="view-bubbles"]').click();
  if(width===390&&theme==='dark'){
   await active(page,'[data-action="settings"]').first().click();
   assert.equal(await active(page,'[data-action="trails"]').getAttribute('aria-pressed'),'false');
   await active(page,'[data-action="trails"]').click();assert.equal(await active(page,'[data-action="trails"]').getAttribute('aria-pressed'),'true');
   await active(page,'[data-action="trails"]').click();assert.equal(await active(page,'[data-action="trails"]').getAttribute('aria-pressed'),'false');
   await active(page,'[data-action="close-settings"]').click();
  }
  await active(page,'[data-action="replay-toggle"]').click();
  await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);const r=h?.shadowRoot.querySelector('[data-control="frame"]');return r&&Number(r.value)>0&&Number(r.value)%1>0;});
  await active(page,'[data-action="play"]').click();
  assert.equal(await canvas.getAttribute('data-identity'),'original','controls and replay never replace the canvas');assert.equal(await active(page,'[data-slot="zoom"]').textContent(),zoom);
  await active(page,'[data-control="period"]').selectOption('4h');await active(page,'[data-control="period"]').selectOption('15m');await active(page,'[data-control="period"]').selectOption('1h');
  if(width===390&&theme==='dark'){await active(page,'[data-control="period"]').selectOption('1d');try{await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return /有效 \d+\/31/.test(h?.shadowRoot.querySelector('[data-slot="rotation-coverage"]')?.textContent||'')&&h?.shadowRoot.querySelector('[data-action="play"]')?.disabled===false;},{},{timeout:35000});}catch(error){const detail=await active(page,'.cfx-research-panel').evaluate(el=>({coverage:el.querySelector('[data-slot="rotation-coverage"]')?.textContent,notice:el.closest('.cfx').querySelector('.cfx-notice')?.textContent,period:el.querySelector('[data-control="period"]')?.value,playDisabled:el.querySelector('[data-action="play"]')?.disabled}));throw new Error(`日線回歸：${JSON.stringify(detail)}；請求 ${requests.filter(u=>u.includes('1Dutc')).length}；瀏覽器錯誤 ${JSON.stringify(audit.pageErrors)}`,{cause:error});}await active(page,'[data-control="period"]').selectOption('1h');}
  assert.equal(await canvas.getAttribute('data-identity'),'original','period switch updates canvas');
  await tool(page,'heatmap');await active(page,'.cfx-heatmap canvas').waitFor();await tool(page,'rotation');assert.equal(await canvas.getAttribute('data-identity'),'original','return to retained tool preserves canvas');
  if(width===390&&theme==='dark'){
   await active(page,'[data-action="picker"]').click();await active(page,'[data-action="select-all"]').click();await active(page,'[data-action="close-picker"]').click();
   await active(page,'[data-action="view-rank"]').click();await active(page,'.cfx-rank-row').first().click();
   const member=active(page,'.cfx-sidebar [data-open-chart]').first(),symbol=await member.getAttribute('data-open-chart');await member.click();
   await page.locator('#view-radar[data-selected-symbol]').waitFor();assert.equal(await page.locator('#view-radar').getAttribute('data-selected-symbol'),symbol,'sector member opens the correct radar K line');
   await page.evaluate(()=>switchAppView('strength'));await tool(page,'flow');
   await active(page,'.cfx-research-panel').waitFor();
   const flowCanvas=active(page,'.cfx-plot canvas');await flowCanvas.evaluate(c=>c.dataset.identity='flow-original');
   await active(page,'[data-action="zoom-in"]').click();
   await active(page,'.cfx[data-scan-state="partial"]').waitFor({timeout:10000});
   await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:20000});
   assert.ok(await active(page,'.cfx-flow-symbols button').count()>1,'ETH and other valid symbols stay visible alongside BTC');
   const modes=await active(page,'[data-control="flow-mode"]').evaluate(el=>[...el.options].map(o=>o.value));assert.deepEqual(modes,['volume','gain','net','score']);
   await active(page,'[data-control="flow-mode"]').selectOption('gain');await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:60000});
   await active(page,'[data-action="picker"]').click();assert.ok(await active(page,'[data-item]').count()>1);await active(page,'[data-action="close-picker"]').click();
   await active(page,'[data-control="flow-mode"]').selectOption('volume');await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:60000});
   await active(page,'[data-action="view-rank"]').click();await active(page,'[data-flow-detail]').first().click();
   assert.ok(await active(page,'.cfx-asset-dialog [data-open-chart]').count()>0,'flow detail links to the K line');await active(page,'[data-action="close-asset"]').click();await active(page,'[data-action="view-bubbles"]').click();
   assert.ok((await active(page,'select[data-control="period"]').evaluate(el=>[...el.options].map(o=>o.value))).includes('1d'));
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original','partial/final batches update the same canvas');assert.equal(await active(page,'[data-slot="zoom"]').textContent(),'150%');
   await active(page,'[data-action="view-rank"]').click();await active(page,'.cfx-table tbody tr').first().waitFor();await active(page,'[data-watch]').first().click();await active(page,'[data-action="scope-watch"]').click();assert.equal(await active(page,'.cfx-table tbody tr').count(),1);
   await active(page,'[data-action="scope-all"]').click();
   for(const period of ['4h','15m','1h'])await active(page,'[data-control="period"]').selectOption(period);
   assert.equal(await active(page,'[data-control="period"]').inputValue(),'1h');
   await active(page,'[data-action="view-bubbles"]').click();
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original');
   await active(page,'[data-action="replay-toggle"]').click();
   await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);const v=Number(h?.shadowRoot.querySelector('[data-control="frame"]')?.value);return v>0&&v%1>0;});
   await active(page,'[data-action="play"]').click();
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original','主動買賣回放沿用畫布');
   await tool(page,'patterns');await active(page,'.px-board').waitFor();
   assert.equal(await active(page,'.px-status-row').count(),0,'board scan text is hidden');
   const alignment=await active(page,'.px-refresh-pill').evaluate(el=>{const r=el.getBoundingClientRect(),g=el.querySelector('.px-refresh-glyph').getBoundingClientRect();return {x:Math.abs(r.x+r.width/2-g.x-g.width/2),y:Math.abs(r.y+r.height/2-g.y-g.height/2)};});assert.ok(alignment.x<.6&&alignment.y<.6);
   assert.equal(await active(page,'.px-refresh-glyph svg').evaluate(el=>getComputedStyle(el).animationName),'none');
  }
  const started=Date.now();await page.evaluate(()=>OXNews.openMarket());await page.locator('.oxn-event-row').first().waitFor();const newsEntryMs=Date.now()-started;
  await page.locator('[data-news-tab="key"]').click();await page.locator('.oxn-news-row').first().waitFor();
  const titles=await page.locator('.oxn-news-row h3').allTextContents();assert.ok(titles.length>0);assert.ok(titles.every(t=>/[\u4e00-\u9fff]/.test(t)));
  assert.deepEqual(audit.pageErrors,[]);assert.equal(requests.some(u=>/\/markets\/tw\/|\/api\/v1\/tw\//.test(u)),false);
  reports.push({width,theme,plotHeight:Math.round(plot.height),toolbarFits:true,sameCanvas:true,continuousReplay:true,statePreserved:true,newsEntryMs,errors:audit.pageErrors});await context.close();
 }
 const {page,context,audit,requests}=await setup(390);let blocked=true;
 await page.route('**/src/generated/tool-news.js*',r=>blocked?r.abort('failed'):r.continue());
 await page.evaluate(()=>OXNews.openMarket());await page.getByRole('button',{name:'重試',exact:true}).waitFor();
 const failedCalls=requests.filter(u=>u.includes('tool-news.js')).length;assert.ok(failedCalls<=2,'failed module cannot trigger unlimited imports');blocked=false;
 await page.getByRole('button',{name:'重試',exact:true}).click();await page.locator('.oxn-event-row').first().waitFor();assert.deepEqual(audit.pageErrors,[]);
 reports.push({fault:'news-module',failedCalls,recovered:true});await context.close();
 await writeFile('docs/performance/round4-ui.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

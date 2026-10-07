import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
process.env.OX_E2E_PORT='4308';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(r=>server.listen(4308,'127.0.0.1',r));
const browserName=process.env.OX_UI_BROWSER||'chromium';
const browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true,...(browserName==='chromium'?{executablePath:process.env.OX_TEST_BROWSER,args:['--no-sandbox']}: {})});
const imagePrefix=browserName==='webkit'?'bubble-webkit':'bubble';
const reports=[];
const active=(p,s)=>p.locator('#ox-crypto-tools-inline '+s).filter({visible:true});
const tool=(p,id)=>p.locator(`button[data-crypto-tool="${id}"]`).click();
async function setup(width,theme='dark',clockTime=null){
 const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW',...(browserName==='webkit'&&width<600?{isMobile:true,hasTouch:true}: {})}),{page,audit}=await preparePage(context,{width,height:900});
 if(clockTime)await page.clock.install({time:clockTime});
 const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(theme=>localStorage.setItem('ox-ui-theme',theme),theme);
 await page.addInitScript(()=>{
  const arc=CanvasRenderingContext2D.prototype.arc,clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillText,rect=CanvasRenderingContext2D.prototype.rect;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('.cfx-plot')){this.canvas.__bubblePoints=[];this.canvas.__bubbleLabels=[];this.canvas.__plotClips=[];this.canvas.__plotText=[];}return clear.apply(this,args);};
  CanvasRenderingContext2D.prototype.arc=function(x,y,r,...rest){if(r>=9&&this.canvas.closest('.cfx-plot'))(this.canvas.__bubblePoints||=[]).push({x,y,r});return arc.call(this,x,y,r,...rest);};
  CanvasRenderingContext2D.prototype.rect=function(x,y,w,h){if(w>100&&h>100&&this.canvas.closest('.cfx-plot'))(this.canvas.__plotClips||=[]).push({x,y,w,h});return rect.call(this,x,y,w,h);};
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(this.canvas.closest('.cfx-plot'))(this.canvas.__plotText||=[]).push({text,x,y,baseline:this.textBaseline});if(this.textBaseline==='middle'&&this.canvas.closest('.cfx-plot'))(this.canvas.__bubbleLabels||=[]).push({text,x,y,width:this.measureText(text).width,font:this.font});return fill.call(this,text,x,y,...rest);};
 });
 await page.route('**/api/v1/account/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('feature-access')?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:{ok:true,user:null,configured:false}}));
 await page.route('https://api.bitget.com/**',async r=>{await new Promise(done=>setTimeout(done,80));return r.fulfill({json:fixtureBody(r.request().url())});});
 await routeSnapshots(page);await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));
 await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});await page.evaluate(()=>switchAppView('strength'));
 return {page,context,audit,requests};
}
async function verifyExpandedResearch(page){
 const geometry=await active(page,'.cfx-research-panel').evaluate(panel=>{const main=panel.closest('.cfx'),content=panel.parentElement,canvas=panel.querySelector('canvas'),a=main.getBoundingClientRect(),b=canvas.getBoundingClientRect();return {outerBorder:parseFloat(getComputedStyle(main).borderLeftWidth),panelBorder:parseFloat(getComputedStyle(panel).borderLeftWidth),radius:parseFloat(getComputedStyle(panel).borderTopLeftRadius),padding:parseFloat(getComputedStyle(content).paddingLeft),mainWidth:a.width,canvasWidth:b.width};});
 assert.equal(geometry.outerBorder,0,'only the outermost research frame is removed');assert.equal(geometry.panelBorder,1,'one chart frame remains');assert.equal(geometry.radius,14);assert.equal(geometry.padding,0);assert.ok(Math.abs(geometry.mainWidth-geometry.canvasWidth-2)<1,'canvas fills the width within the single border');
 assert.equal(await active(page,'[data-control="period"]').count(),1);assert.equal(await active(page,'[data-control="replay-range"]').count(),0,'one header menu owns periods and replay ranges');
}
async function verifyDialogBounds(page,selector){
 const dialog=active(page,selector);await dialog.waitFor();
 const inspect=()=>dialog.evaluate(el=>{const r=el.getBoundingClientRect(),button=el.querySelector('.cfx-close'),b=button.getBoundingClientRect(),s=getComputedStyle(button);return {r:{x:r.x,y:r.y,w:r.width,h:r.height},b:{x:b.x,y:b.y,w:b.width,h:b.height},vw:innerWidth,vh:innerHeight,overflow:el.scrollWidth-el.clientWidth,bottomGap:r.bottom-el.lastElementChild.getBoundingClientRect().bottom,outline:parseFloat(s.outlineWidth),border:parseFloat(s.borderTopWidth),radius:parseFloat(s.borderTopLeftRadius),transform:getComputedStyle(el).transform};});
 for(const scrolled of [false,true]){
  if(scrolled)await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);
  const g=await inspect();
  assert.ok(g.r.x>=11&&g.r.x+g.r.w<=g.vw-11&&g.r.y>=15&&g.r.y+g.r.h<=g.vh-15,`${selector} fits viewport: ${JSON.stringify(g)}`);
  assert.ok(Math.abs(g.r.x+g.r.w/2-g.vw/2)<1&&Math.abs(g.r.y+g.r.h/2-g.vh/2)<1,`${selector} stays centered`);
  if(selector==='.cfx-settings-dialog')assert.ok(g.bottomGap<=24,'settings dialog fits its content without a tall empty area');
  assert.ok(g.b.x>=g.r.x&&g.b.x+g.b.w<=g.r.x+g.r.w&&g.b.y>=g.r.y&&g.b.y+g.b.h<=g.r.y+g.r.h,`${selector} close stays visible while scrolling`);
  assert.equal(g.b.w,44);assert.equal(g.b.h,44);assert.equal(g.border,0);assert.equal(g.outline,0);assert.ok(g.radius>=22,`exit has no square outline: ${JSON.stringify(g)}`);assert.ok(g.overflow<=1,'popup has no horizontal overflow');assert.equal(g.transform,'none');
 }
 await dialog.evaluate(el=>el.scrollTop=0);
 // Native dialog autofocus must not create a black square around the close.
 assert.equal(await dialog.evaluate(el=>el.getRootNode().activeElement===el.querySelector('.cfx-dialog-head')),true);
 await dialog.locator('.cfx-close').focus();assert.equal((await inspect()).outline,0);await dialog.locator('.cfx-dialog-head').focus();
}
async function verifyGeneralPopups(page,width,theme){
 await active(page,'[data-action="settings"]').click();await verifyDialogBounds(page,'.cfx-settings-dialog');
 if(width===390&&theme==='light'){
  await page.setViewportSize({width,height:500});await verifyDialogBounds(page,'.cfx-settings-dialog');await page.setViewportSize({width,height:900});
 }
 await page.screenshot({path:`docs/performance/${imagePrefix}-settings-${width}-${theme}.png`});
 await active(page,'[data-action="close-settings"]').click();
 await active(page,'[data-action="help"]').last().click();await verifyDialogBounds(page,'.cfx-dialog:not(.cfx-settings-dialog):not(.cfx-picker-dialog):not(.cfx-sector-dialog)');
 await active(page,'[data-action="close-help"]').click();
}
async function chartScene(page){
 return active(page,'.cfx-plot canvas').evaluate(async c=>{
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const panel=c.closest('.cfx-research-panel');
  return {points:c.__bubblePoints,labels:c.__bubbleLabels,axes:c.__plotText?.filter(t=>t.baseline==='alphabetic'),frame:panel.querySelector('[data-control="frame"]').value,max:panel.querySelector('[data-control="frame"]').max,zoom:panel.querySelector('[data-slot="zoom"]').textContent,coverage:panel.querySelector('[data-slot="replay-coverage"]').textContent,timestamp:c.getRootNode().querySelector('[data-slot="period"]').textContent};
 });
}
async function verifyIdleUpdates(){
 let feedTime=Date.now(),phase=0,returned=0,release,partialReady;
 let gate=new Promise(r=>release=r),partial=new Promise(r=>partialReady=r);
 const {page,context,audit}=await setup(390,'light',feedTime);
 await page.route('https://api.bitget.com/**',async route=>{
  const url=new URL(route.request().url()),native=url.searchParams.get('granularity')==='12Hutc'&&url.searchParams.get('limit')==='32',taker=url.pathname.endsWith('/taker-buy-sell');
  const held=native||phase>=2&&taker;
  if(held&&url.searchParams.get('symbol')==='ETHUSDT')await gate;
  const body=fixtureBody(url.href,feedTime);
  if(phase>0&&native&&url.searchParams.get('symbol')==='ETHUSDT')body.data=body.data.map((r,i)=>{const a=[...r];a[4]=String(Number(a[4])*(1+(i%3)*.02));a[2]=String(Math.max(Number(a[1]),Number(a[4]))*1.01);a[3]=String(Math.min(Number(a[1]),Number(a[4]))*.99);return a;});
  if(phase>=2&&taker)body.data=body.data.map((r,i)=>({...r,buyVolume:String(Number(r.buyVolume)+(i%3)*17)}));
  await route.fulfill({json:body});if(held&&++returned===3)partialReady();
 });
 const waitPartial=()=>Promise.race([partial,new Promise((_,reject)=>setTimeout(()=>reject(Error('background refresh did not reach three staged responses')),15000))]);
 const pointsReady=()=>page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return Number(h?.shadowRoot.querySelector('canvas')?.dataset.points)>0;},{},{timeout:20000});
 try{
  await tool(page,'rotation');await active(page,'.cfx-research-panel').waitFor();await active(page,'[data-control="period"]').selectOption('12h');await waitPartial();
  await pointsReady();assert.ok(!(await active(page,'.cfx-plot-loading').isVisible()),'complete 15m windows render the selected period while the native batch is staged');
  release();await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return h?.shadowRoot.querySelector('.cfx-notice')?.hidden===true;},{},{timeout:20000});await pointsReady();const nativeLatest=(await chartScene(page)).timestamp;await active(page,'[data-action="zoom-in"]').click();
  await active(page,'[data-action="replay-toggle"]').click();
  await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),v=Number(h?.shadowRoot.querySelector('[data-control="frame"]')?.value);return v>0&&v%1>0;});await active(page,'[data-action="play"]').click();
  const paused=await chartScene(page);phase=1;returned=0;gate=new Promise(r=>release=r);partial=new Promise(r=>partialReady=r);feedTime+=13*3600000;await page.clock.setSystemTime(feedTime);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await waitPartial();assert.deepEqual(await chartScene(page),paused,'paused rotation keeps its positions, scale and fractional cursor during partial responses');
  release();await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return h?.shadowRoot.querySelector('.cfx-notice')?.hidden===true;},{},{timeout:20000});
  assert.deepEqual(await chartScene(page),paused,'completed background data cannot replace a paused replay cohort');await active(page,'[data-action="latest"]').click();assert.notDeepEqual(await chartScene(page),paused,'latest explicitly adopts the completed cohort');assert.notEqual((await chartScene(page)).timestamp,nativeLatest,'latest advances to the newly closed native period');
  assert.equal(await active(page,'[data-slot="zoom"]').textContent(),'150%');
  phase=2;returned=0;gate=new Promise(r=>release=r);partial=new Promise(r=>partialReady=r);feedTime+=6*60000;await page.clock.setSystemTime(feedTime);
  await tool(page,'flow');await active(page,'.cfx-research-panel').waitFor();await active(page,'[data-control="period"]').selectOption('1h');await waitPartial();release();await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:30000});await pointsReady();const flowLatest=(await chartScene(page)).timestamp;
  await active(page,'[data-action="replay-toggle"]').click();await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),v=Number(h?.shadowRoot.querySelector('[data-control="frame"]')?.value);return v>0&&v%1>0;});await active(page,'[data-action="play"]').click();
  const pausedFlow=await chartScene(page);phase=3;returned=0;gate=new Promise(r=>release=r);partial=new Promise(r=>partialReady=r);feedTime+=2*3600000;await page.clock.setSystemTime(feedTime);await active(page,'[data-action="refresh-flow"]').click();await waitPartial();assert.deepEqual(await chartScene(page),pausedFlow,'taker partial responses leave paused observations stable');
  release();await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:30000});assert.deepEqual(await chartScene(page),pausedFlow,'a completed taker batch preserves paused playback');await active(page,'[data-action="latest"]').click();assert.notDeepEqual(await chartScene(page),pausedFlow);assert.notEqual((await chartScene(page)).timestamp,flowLatest,'latest advances to the newly closed taker period');assert.deepEqual(audit.pageErrors,[]);
  reports.push({browser:browserName,idleNativeCohortStable:true,idleTakerCohortStable:true,pausedFractionPreserved:true,explicitLatest:true});
 }finally{release();await context.close();}
}
async function verifySectorDialog(page,width,theme){
 await active(page,'[data-action="picker"]').click();await active(page,'[data-action="select-all"]').click();await active(page,'[data-action="close-picker"]').click();
 await active(page,'[data-action="view-bubbles"]').click();
 const bubbleCanvas=active(page,'.cfx-plot canvas');await bubbleCanvas.scrollIntoViewIfNeeded();
 const drawn=await bubbleCanvas.evaluate(c=>({points:c.__bubblePoints||[],labels:c.__bubbleLabels||[],width:c.clientWidth,height:c.clientHeight,clips:c.__plotClips||[],text:c.__plotText||[]}));assert.ok(drawn.points.every(p=>p.r>=(width<600?26:30)&&p.r<=(width<600?44:60)),'weak bubbles preserve their readable minimum size');
 assert.ok(drawn.clips.some(c=>c.x===0&&c.y===0&&Math.abs(c.w-drawn.width)<1&&Math.abs(c.h-drawn.height)<1),'grid fills the entire canvas');
 const coordinates=drawn.text.filter(t=>t.baseline==='alphabetic'&&/^[+−-]?\d/.test(t.text));assert.ok(coordinates.some(t=>t.x===8),'left ticks overlay the grid');assert.ok(coordinates.some(t=>Math.abs(t.y-(drawn.height-27))<1),'bottom ticks overlay the grid');assert.ok(coordinates.every(t=>t.x>=0&&t.x<=drawn.width&&t.y>0&&t.y<drawn.height));
 assert.ok(drawn.labels.length,'bubble labels render');
 for(const label of drawn.labels){const size=Number(/([\d.]+)px/.exec(label.font)?.[1]);assert.doesNotMatch(label.font,/bold|600|700/);assert.ok(drawn.points.some(p=>Math.abs(p.x-label.x)<.1&&Math.hypot(label.width/2,Math.abs(label.y-p.y)+size/2)<=p.r+.1),'text stays inside a bubble');}
 await active(page,'.cfx-research-panel').screenshot({path:`docs/performance/${imagePrefix}-${width}-${theme}.png`});
 const point=drawn.points.find(p=>p.x>35&&p.x<drawn.width-15&&p.y>60&&p.y<drawn.height-60);assert.ok(point,'actual sector bubbles are drawn');
 await bubbleCanvas.click({position:{x:point.x,y:point.y}});await active(page,'.cfx-sector-dialog').waitFor();await active(page,'[data-action="close-sector"]').click();
 await active(page,'[data-action="view-rank"]').click();await active(page,'.cfx-rank-row').first().click();
 const dialog=active(page,'.cfx-sector-dialog');await dialog.waitFor();await verifyDialogBounds(page,'.cfx-sector-dialog');
 const bounds=await dialog.boundingBox();assert.ok(bounds.width<=width-12,'framed sector popup fits the viewport');
 assert.notEqual(await dialog.evaluate(el=>getComputedStyle(el).borderTopStyle),'none');
 const row=active(page,'.cfx-sector-dialog [data-member-detail]').first(),symbol=await row.getAttribute('data-member-detail');
 await row.locator('td').nth(1).click();
 const detail=active(page,'.cfx-asset-dialog');await detail.waitFor();await verifyDialogBounds(page,'.cfx-asset-dialog');
 await active(page,`.cfx-asset-chart canvas[data-symbol="${symbol}"]`).waitFor({timeout:15000});
 assert.ok(await active(page,'.cfx-asset-dialog .cfx-detail-metrics').count());
 await active(page,'[data-control="asset-period"]').selectOption('1d');await active(page,'[data-control="asset-period"]').selectOption('5m');await active(page,'[data-control="asset-period"]').selectOption('1h');
 await active(page,`.cfx-asset-chart canvas[data-symbol="${symbol}"][data-period="1h"]`).waitFor({timeout:15000});
 await active(page,'[data-action="close-asset"]').click();assert.ok(await dialog.isVisible(),'closing coin detail returns to the sector popup');
 await row.focus();await row.press('Enter');await detail.waitFor();await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());
 await active(page,'.cfx-sector-dialog [data-open-chart]').first().click();
 await page.waitForFunction(s=>document.querySelector('#view-radar')?.dataset.selectedSymbol===s,symbol);
 assert.equal(await page.locator('#view-radar').getAttribute('data-selected-symbol'),symbol,'coin-name text opens the correct main K line');
 await page.evaluate(()=>switchAppView('strength'));await tool(page,'rotation');await active(page,'.cfx-research-panel').waitFor();
 return {framedPopup:true,coinDetailCandles:true,directNameChart:true,rapidPeriods:true,keyboardReturn:true};
}
try{
 for(const [width,theme] of (browserName==='webkit'?[[320,'light'],[390,'dark'],[390,'light']]:[[320,'dark'],[390,'dark'],[390,'light'],[1440,'dark'],[1440,'light']])){
  const {page,context,audit,requests}=await setup(width,theme);
  for(const id of ['patterns','bubbles','strength','heatmap','rotation']){
   await tool(page,id);
   if(id==='strength')await page.locator('.strength-compare-panel').waitFor();
   else await active(page,id==='patterns'?'.px-board':id==='bubbles'?'.oxb-shell':'.cfx').waitFor();
   const gap=await page.evaluate(id=>{const nav=document.querySelector('#ox-crypto-tools-nav'),content=document.querySelector(id==='strength'?'.strength-compare-panel':'#ox-crypto-tools-inline');return content.getBoundingClientRect().top-nav.getBoundingClientRect().bottom;},id);
   assert.ok(Math.abs(gap-4)<=1,`${id} content gap is 4px at ${width}px, received ${gap}`);
  }
  await tool(page,'rotation');await active(page,'.cfx-research-panel').waitFor();
  await verifyExpandedResearch(page);
  const canvas=active(page,'.cfx-plot canvas');await canvas.evaluate(c=>c.dataset.identity='original');
  const plot=await active(page,'.cfx-plot').boundingBox();assert.ok(plot.height>=220&&plot.height<=620,`research plot uses the compact viewport height: ${plot.height}px at ${width}px`);assert.ok(plot.width<=width);
  assert.equal(await active(page,'.cfx-chart-meta').count(),0,'removed coverage text leaves no metadata panel');
  const periods=await active(page,'select[data-control="period"]').evaluate(el=>[...el.options].map(o=>o.value));for(const period of ['15m','30m','1h','2h','4h','6h','12h','1d'])assert.ok(periods.includes(period));
  const toolbar=active(page,'.cfx-research-toolbar'),toolbarSize=await toolbar.evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,controls:[...e.children].map(c=>({text:c.textContent,width:c.getBoundingClientRect().width}))}));assert.ok(toolbarSize.scroll<=toolbarSize.client+1,`single toolbar row fits at ${width}px: ${JSON.stringify(toolbarSize)}`);
  await active(page,'[data-action="zoom-in"]').click();const zoom=await active(page,'[data-slot="zoom"]').textContent();assert.equal(zoom,'150%');
  await verifyGeneralPopups(page,width,theme);
  await active(page,'[data-action="picker"]').click();
  await verifyDialogBounds(page,'.cfx-picker-dialog');
  assert.equal(await active(page,'.cfx-picker-group').count(),31,'all first-level groups remain selectable');
  await active(page,'[data-topic-group="meme"] summary').click();
  await active(page,'[data-topic-group="meme"] .cfx-topic').first().waitFor();
  assert.ok(await active(page,'[data-topic-group="meme"] .cfx-topic').count()>0,'available topic members expand on demand');assert.doesNotMatch(await active(page,'.cfx-picker-dialog').textContent(),/幣已驗證|候選不等於/);
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
  assert.deepEqual(await active(page,'[data-control="period"]').evaluate(el=>[...el.options].filter(o=>o.value.startsWith('range:')).map(o=>o.text)),['最近七天','最近一個月','最近一季','最近一年']);
  assert.ok(await active(page,'.cfx-replay').evaluate(e=>Math.abs(e.getBoundingClientRect().top-e.parentElement.querySelector('.cfx-plot').getBoundingClientRect().bottom)<2),'replay controls follow the plot without empty space');
  await active(page,'.cfx-stage-times time[aria-current="step"]').waitFor();
  const stages=await active(page,'[data-slot="replay-stage"]').textContent();assert.match(stages,/目前第 \d+\/\d+ 期 · UTC\+8/,'replay shows the current period');assert.ok(await active(page,'.cfx-stage-times time').count()<=3,'timeline shows adjacent periods');
  const playAlignment=await active(page,'[data-action="play"]').evaluate(b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return {x:Math.abs(s.x+s.width/2-r.x-r.width/2),y:Math.abs(s.y+s.height/2-r.y-r.height/2)};});assert.ok(playAlignment.x<.6&&playAlignment.y<.6,'replay icon is centered inside its button');
  await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);const r=h?.shadowRoot.querySelector('[data-control="frame"]');return r&&Number(r.value)>0&&Number(r.value)%1>0;});
  await active(page,'[data-action="play"]').click();
  await active(page,'[data-control="period"]').selectOption('range:7d');
  assert.equal(await active(page,'[data-control="period"]').inputValue(),'range:7d');
  assert.ok(await active(page,'.cfx-replay').isVisible(),'choosing a range opens the replay controls');
  const rangeFits=await active(page,'.cfx-research-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth+1);assert.ok(rangeFits,`history selection fits the toolbar at ${width}px`);
  await active(page,'[data-control="period"]').selectOption('1h');
  if(width===390&&theme==='dark'){
   for(const range of ['7d','1m','3m','1y']){
    await active(page,'[data-control="period"]').selectOption('range:'+range);
    assert.equal(await active(page,'[data-control="period"]').inputValue(),'range:'+range);
    assert.equal(await canvas.getAttribute('data-period'),'1d');
   }
   await active(page,'[data-control="period"]').selectOption('1h');
  }
  assert.equal(await canvas.getAttribute('data-identity'),'original','controls and replay never replace the canvas');assert.equal(await active(page,'[data-slot="zoom"]').textContent(),zoom);
  await active(page,'[data-control="period"]').selectOption('4h');await active(page,'[data-control="period"]').selectOption('15m');await active(page,'[data-control="period"]').selectOption('1h');
  if(width===390&&theme==='dark'){await active(page,'[data-control="period"]').selectOption('1d');try{await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);return Number(h?.shadowRoot.querySelector('[data-control="frame"]')?.max)>0&&h?.shadowRoot.querySelector('[data-action="play"]')?.disabled===false;},{},{timeout:35000});}catch(error){const detail=await active(page,'.cfx-research-panel').evaluate(el=>({coverage:el.querySelector('[data-slot="replay-coverage"]')?.textContent,notice:el.closest('.cfx').querySelector('.cfx-notice')?.textContent,period:el.querySelector('[data-control="period"]')?.value,playDisabled:el.querySelector('[data-action="play"]')?.disabled}));throw new Error(`日線回歸：${JSON.stringify(detail)}；請求 ${requests.filter(u=>u.includes('1Dutc')).length}；瀏覽器錯誤 ${JSON.stringify(audit.pageErrors)}`,{cause:error});}await active(page,'[data-control="period"]').selectOption('1h');}
  if(width===390&&theme==='dark'){
   // The picker test selects Meme, which has only DOGE in this fixture and
   // correctly cannot form a sector. Restore all sectors for loading checks.
   await active(page,'[data-action="picker"]').click();await active(page,'[data-action="select-all"]').click();await active(page,'[data-action="close-picker"]').click();
   for(const period of ['30m','2h','4h','6h','12h']){
    await active(page,'[data-control="period"]').selectOption(period);
    try{await page.waitForFunction(p=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),c=h?.shadowRoot.querySelector('canvas');return c?.dataset.period===p&&Number(c.dataset.points)>0;},period,{timeout:15000});}catch(error){throw new Error(`級別 ${period}：${await active(page,'.cfx').evaluate(el=>JSON.stringify({text:el.innerText,canvas:{...el.querySelector('canvas')?.dataset}}))}；請求 ${JSON.stringify(requests.filter(u=>u.includes('/candles')).slice(-35))}；錯誤 ${JSON.stringify(audit.pageErrors)}`,{cause:error});}
   }
   for(const period of ['12h','6h','2h','1h'])await active(page,'[data-control="period"]').selectOption(period);
   await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),c=h?.shadowRoot.querySelector('canvas');return c?.dataset.period==='1h'&&Number(c.dataset.points)>0;});
  }
  assert.equal(await canvas.getAttribute('data-identity'),'original','period switch updates canvas');
  await tool(page,'heatmap');await active(page,'.cfx-heatmap canvas').waitFor();await tool(page,'rotation');assert.equal(await canvas.getAttribute('data-identity'),'original','return to retained tool preserves canvas');
  const dialogResults=await verifySectorDialog(page,width,theme);
  if(width===390&&theme==='dark'){
   await tool(page,'flow');
   await active(page,'.cfx-research-panel').waitFor();
   await verifyExpandedResearch(page);
   const flowCanvas=active(page,'.cfx-plot canvas');await flowCanvas.evaluate(c=>c.dataset.identity='flow-original');
   await active(page,'[data-action="zoom-in"]').click();
   await active(page,'.cfx[data-scan-state="partial"]').waitFor({timeout:10000});
   await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:20000});
   assert.ok(await active(page,'.cfx-flow-symbols button').count()>1,'ETH and other valid symbols stay visible alongside BTC');
   const modes=await active(page,'[data-control="flow-mode"]').evaluate(el=>[...el.options].map(o=>o.value));assert.deepEqual(modes,['volume','gain','net','score']);
   await active(page,'[data-control="flow-mode"]').selectOption('gain');await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:60000});
   await active(page,'[data-action="picker"]').click();assert.ok(await active(page,'[data-item]').count()>1);await active(page,'[data-action="close-picker"]').click();
   await active(page,'[data-control="flow-mode"]').selectOption('volume');await active(page,'.cfx[data-scan-state="complete"]').waitFor({timeout:60000});
   await active(page,'[data-action="view-rank"]').click();await active(page,'[data-member-detail]').first().locator('td').nth(1).click();
   await active(page,'.cfx-asset-chart canvas[data-symbol]').waitFor({timeout:15000});assert.ok(await active(page,'.cfx-asset-dialog [data-open-chart]').count()>0,'flow detail includes candles and links to the K line');await active(page,'[data-action="close-asset"]').click();await active(page,'[data-action="view-bubbles"]').click();
   assert.ok((await active(page,'select[data-control="period"]').evaluate(el=>[...el.options].map(o=>o.value))).includes('1d'));
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original','partial/final batches update the same canvas');assert.equal(await active(page,'[data-slot="zoom"]').textContent(),'150%');
   await active(page,'[data-action="view-rank"]').click();await active(page,'.cfx-table tbody tr').first().waitFor();await active(page,'[data-watch]').first().click();await active(page,'[data-action="scope-watch"]').click();assert.equal(await active(page,'.cfx-table tbody tr').count(),1);
   await active(page,'[data-action="scope-all"]').click();
   for(const period of ['5m','30m','2h','6h','12h','1d']){
    await active(page,'[data-control="period"]').selectOption(period);
    await page.waitForFunction(p=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),c=h?.shadowRoot.querySelector('canvas');return c?.dataset.period===p&&Number(c.dataset.points)>0;},period,{timeout:20000});
   }
   for(const period of ['4h','15m','1h'])await active(page,'[data-control="period"]').selectOption(period);
   assert.equal(await active(page,'[data-control="period"]').inputValue(),'1h');
   await active(page,'[data-action="view-bubbles"]').click();
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original');
   await active(page,'[data-action="replay-toggle"]').click();
  assert.deepEqual(await active(page,'[data-control="period"]').evaluate(el=>[...el.options].filter(o=>o.value.startsWith('range:')).map(o=>o.text)),['最近七天','最近一個月','最近一季','最近一年']);
   await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot);const v=Number(h?.shadowRoot.querySelector('[data-control="frame"]')?.value);return v>0&&v%1>0;});
   await active(page,'[data-action="play"]').click();
   assert.equal(await flowCanvas.getAttribute('data-identity'),'flow-original','主動買賣回放沿用畫布');
   await active(page,'[data-control="period"]').selectOption('range:7d');
   await page.waitForFunction(()=>{const h=[...document.querySelector('#ox-crypto-tools-inline').children].find(h=>!h.hidden&&h.shadowRoot),c=h?.shadowRoot.querySelector('canvas');return c?.dataset.period==='1d'&&Number(c.dataset.points)>0;},{},{timeout:20000});
   assert.equal(await active(page,'[data-control="period"]').inputValue(),'range:7d');await verifyExpandedResearch(page);
   await active(page,'[data-control="period"]').selectOption('1h');
   await tool(page,'patterns');await active(page,'.px-board').waitFor();
   assert.equal(await active(page,'.px-status-row').count(),0,'board scan text is hidden');
   const alignment=await active(page,'.px-refresh-pill').evaluate(el=>{const r=el.getBoundingClientRect(),g=el.querySelector('.px-refresh-glyph').getBoundingClientRect();return {x:Math.abs(r.x+r.width/2-g.x-g.width/2),y:Math.abs(r.y+r.height/2-g.y-g.height/2)};});assert.ok(alignment.x<.6&&alignment.y<.6);
   assert.equal(await active(page,'.px-refresh-glyph svg').evaluate(el=>getComputedStyle(el).animationName),'none');
  }
  const started=Date.now();await page.evaluate(()=>OXNews.openMarket());await page.locator('.oxn-event-row').first().waitFor();const newsEntryMs=Date.now()-started;
  await page.locator('[data-news-tab="key"]').click();await page.locator('.oxn-news-row').first().waitFor();
  const titles=await page.locator('.oxn-news-row h3').allTextContents();assert.ok(titles.length>0);assert.ok(titles.every(t=>/[\u4e00-\u9fff]/.test(t)));
  assert.deepEqual(audit.pageErrors,[]);assert.equal(requests.some(u=>/\/markets\/tw\/|\/api\/v1\/tw\//.test(u)),false);
  reports.push({width,theme,plotHeight:Math.round(plot.height),toolbarFits:true,sameCanvas:true,continuousReplay:true,statePreserved:true,...dialogResults,newsEntryMs,errors:audit.pageErrors});await context.close();
 }
 await verifyIdleUpdates();
 const faultSetup=await setup(390);const fp=faultSetup.page;let failed=true,candleAttempts=0;
 await fp.route('https://api.bitget.com/**',async r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/candles')&&url.searchParams.get('granularity')==='1m'&&url.searchParams.get('limit')==='200'){candleAttempts++;if(failed)return r.fulfill({status:429,headers:{'Retry-After':'0'},json:{code:'429'}});}return r.fulfill({json:fixtureBody(r.request().url())});});
 await tool(fp,'rotation');await active(fp,'.cfx-research-panel').waitFor();await active(fp,'[data-action="view-rank"]').click();await active(fp,'.cfx-rank-row').first().click();await active(fp,'.cfx-sector-dialog [data-member-detail]').first().locator('td').nth(1).click();
 await active(fp,'.cfx-asset-chart canvas[data-symbol]').waitFor();await active(fp,'[data-control="asset-period"]').selectOption('1m');await active(fp,'[data-action="retry-asset"]').waitFor({timeout:16000});assert.equal(candleAttempts,2,'one initial request and one bounded 429 retry');
 failed=false;await active(fp,'[data-action="retry-asset"]').click();try{await active(fp,'.cfx-asset-chart canvas[data-period="1m"]').waitFor({timeout:15000});}catch(error){throw new Error(`幣種 K 線恢復：${await active(fp,'.cfx-asset-chart-status').textContent()}；請求 ${candleAttempts}`,{cause:error});}assert.equal(candleAttempts,3);assert.deepEqual(faultSetup.audit.pageErrors,[]);reports.push({fault:'detail-429',boundedAttempts:2,manualRecovery:true});await faultSetup.context.close();
 const {page,context,audit,requests}=await setup(390);let blocked=true;
 await page.route('**/src/generated/tool-news.js*',r=>blocked?r.abort('failed'):r.continue());
 await page.evaluate(()=>OXNews.openMarket());await page.getByRole('button',{name:'重試',exact:true}).waitFor();
 const failedCalls=requests.filter(u=>u.includes('tool-news.js')).length;assert.ok(failedCalls<=2,'failed module cannot trigger unlimited imports');blocked=false;
 await page.getByRole('button',{name:'重試',exact:true}).click();await page.locator('.oxn-event-row').first().waitFor();assert.deepEqual(audit.pageErrors,[]);
 reports.push({fault:'news-module',failedCalls,recovered:true});await context.close();
 await writeFile('docs/performance/round4-ui.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{readFileSync,mkdirSync}=require('node:fs'),{chromium}=require('playwright');
const {preparePage,selectMarket,selectView}=require('./e2e-check.cjs');
const port=4194,base=`http://127.0.0.1:${port}`,snapshot=JSON.parse(readFileSync('data/tw-radar.json','utf8'));
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port',String(port)],{stdio:['ignore','pipe','inherit']});let browser;
async function bounds(page,selector){return page.locator(selector).evaluate(e=>{const b=e.getBoundingClientRect(),s=e.querySelector('svg')?.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,cx:s?Math.abs(s.x+s.width/2-b.x-b.width/2):0,cy:s?Math.abs(s.y+s.height/2-b.y-b.height/2):0};});}
(async()=>{try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',code=>reject(Error('server exit '+code)));});
 browser=await chromium.launch({executablePath:process.env.OX_BROWSER_PATH,headless:true,args:['--no-sandbox']});mkdirSync('/tmp/ox-timeframe-qa',{recursive:true});
 for(const width of [390,430,1363]){
  const context=await browser.newContext({viewport:{width,height:932},hasTouch:true,isMobile:width<600});const {page,audit}=await preparePage(context,{width,height:932});let radarCalls=0;
  if(process.env.OX_REAL_CHART)await page.route('https://unpkg.com/**',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(process.env.OX_REAL_CHART,'utf8')}));
  await page.route('**/api/v1/tw/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);if(endpoint==='radar'&&++radarCalls>1)return route.fulfill({json:{ok:true,data:snapshot.data}});return route.fulfill({status:403,json:{ok:false,error:{code:'TW_DATA_HTTP_ERROR',message:'QA temporary source outage'}}});});
  await page.route('https://www.tradingview-widget.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Provider frame test boundary</title><body>TradingView frame boundary</body>'}));
  await page.goto(base);await selectView(page,'radar');
  await page.locator('#chart-indicator-open').click();await page.locator('[data-filter-mode="timeframes"]').click();
  const crypto=page.locator('#crypto-tier-combination');await crypto.locator('[data-tier-add]').click();await crypto.locator('[data-tier-frame="1"]').selectOption('4H');await crypto.locator('[data-tier-value="1"]').selectOption('T2');
  assert.equal(await crypto.locator('.chart-tier-rule').count(),2);assert.equal(await crypto.locator('.chart-tier-combination').isVisible(),true);let close=await bounds(page,'[data-chart-tools-close]');assert(close.cx<=1&&close.cy<=1);await page.screenshot({path:`/tmp/ox-timeframe-qa/crypto-${width}.png`});
  await page.locator('[data-chart-tools-close]').click();await selectMarket(page,'tw');await page.locator('#ox-control-close').click();
  const start=Date.now();await page.locator('[data-twr-mode="risk"]').click();await page.locator('.tw-stock-card').first().waitFor({state:'visible',timeout:10000});const firstPaint=Date.now()-start;
  assert.equal(await page.locator('.tw-stock-card').count(),40);assert.equal(await page.locator('#twr-result-count').innerText(),String(snapshot.data.modes.risk.length));assert.equal(await page.locator('.tw-stock-skeleton').count(),0);
  await page.waitForFunction(()=>!document.querySelector('#twr-source-notice')?.textContent.includes('目前顯示上次成功資料'),{},{timeout:15000});assert(radarCalls>=2,'Recovers without exiting the market');
  await page.locator('[data-twr-mode="disposal"]').click();await page.locator('.tw-stock-card').first().click();const detail=page.locator('.tw-stock-detail-panel');await detail.waitFor();
  assert.equal(await detail.locator('.tw-risk-announcement').getAttribute('open'),null);
  assert(await detail.evaluate(p=>p.querySelector('.tw-risk-quote-grid').offsetTop<p.querySelector('.tw-risk-metrics').offsetTop&&p.querySelector('.tw-risk-metrics').offsetTop<p.querySelector('.tw-risk-announcement').offsetTop));
  await page.screenshot({path:`/tmp/ox-timeframe-qa/detail-${width}.png`});await detail.locator('.tw-risk-announcement summary').click();assert.equal(await detail.locator('.tw-risk-announcement').getAttribute('open'),'');await detail.locator('[data-twr-close]').click();
  await page.locator('[data-twr-mode="chart"]').click();await page.locator('.twcr-card').first().waitFor();assert.equal(await page.locator('.twcr-history-bar,[data-action="history-all"],[data-action="history-recent"]').count(),0);
  await page.locator('.twcr-tools [data-tw-tier-filter]').waitFor({state:'attached'});await page.locator('.twcr-chart-box [data-action="indicators"]').click();const tw=page.locator('[data-tw-tier-filter]');await tw.locator('[data-tier-mode="combined"]').click();await tw.locator('[data-tier-add]').click();await tw.locator('[data-tier-frame="1"]').selectOption('1W');await tw.locator('[data-tier-value="1"]').selectOption('T2');
  close=await bounds(page,'.twcr-tools [data-action="tools-close"]');assert(close.cx<=1&&close.cy<=1);assert(close.y>=0&&close.y+close.h<=932);await page.screenshot({path:`/tmp/ox-timeframe-qa/tw-${width}.png`});await page.locator('.twcr-tools [data-action="tools-close"]').click();
  await page.waitForFunction(()=>document.querySelector('.twcr-results')?.childElementCount>0);const matched=await page.evaluate(()=>[...document.querySelectorAll('.twcr-card')].map(e=>e.dataset.symbol));
  const valid=await page.evaluate(async symbols=>{const {bundleState,bundleClassification}=await import('/src/markets/tw/patterns/bundle.js?v=20261001-twhome1');const {patternFrameTier}=await import('/src/markets/tw/timeframe-tiers.js?v=20261001-tiercomb1');return symbols.every(symbol=>patternFrameTier(bundleClassification(symbol,'1D',bundleState().date),'long')?.tier==='T1'&&patternFrameTier(bundleClassification(symbol,'1W',bundleState().date),'long')?.tier==='T2');},matched);assert(valid);
  await selectView(page,'home');await page.waitForSelector('.twx-home-toolbar');await page.locator('[data-home-refresh]').click({force:true});await page.waitForTimeout(200);assert.equal(await page.locator('.twx-market .ox-loading,.twx .ox-region-loading').count(),0);
  assert.deepEqual(audit.pageErrors,[]);console.log(JSON.stringify({width,cachedRiskFirstPaintMs:firstPaint,automaticRadarRequests:radarCalls,timeframeMatches:matched.length,historyControlsRemoved:true,homeLoaderRemoved:true,errors:audit.pageErrors}));await context.close();
 }
}finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});

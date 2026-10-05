const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {server,preparePage,selectMarket,selectView,testBase}=require('./e2e-check.cjs');
(async()=>{
 await new Promise(r=>server.listen(4173,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.OX_BROWSER_PATH});
 let release;const blocked=new Promise(r=>release=r);
 try{
  const context=await browser.newContext(),{page,audit}=await preparePage(context,{width:1440,height:1000});
  const manifest=JSON.parse(fs.readFileSync('data/tw-patterns/manifest.json'));
  const file=manifest.chunks[0].file,bytes=fs.readFileSync('data/tw-patterns/'+file);
  const payload=JSON.parse(file.endsWith('.gz')?zlib.gunzipSync(bytes):bytes);
  const actual=payload.entries.slice(0,50),symbols=new Set(actual.map(e=>e.data.symbol));
  manifest.stocks=manifest.stocks.filter(s=>symbols.has(s.symbol));manifest.total=manifest.classified=50;manifest.unavailable=[];
  manifest.chunks=[{file:'daily-0.json',count:25},{file:'daily-1.json',count:25}];
  let chunkCalls=0;
  await page.route('**/data/tw-patterns/manifest.json',r=>r.fulfill({json:manifest}));
  await page.route('**/data/tw-patterns/daily-*.json?*',async r=>{chunkCalls++;const late=new URL(r.request().url()).pathname.endsWith('daily-1.json');if(late)await blocked;await r.fulfill({json:{...payload,entries:late?actual.slice(25):actual.slice(0,25)}});});
  await page.goto(testBase,{waitUntil:'domcontentloaded'});
  await page.locator('#view-radar .coin-card').first().waitFor({timeout:20000});
  // Recreate the user's return after the scanner has paused for more than five minutes.
  await selectView(page,'home');
  await page.evaluate(()=>globalThis.eval('for(const row of state.analyzedCache.values())row.at=Date.now()-360000;'));
  await selectView(page,'radar');
  assert(await page.locator('#view-radar .coin-card').count()>0,'Paused qualified radar rows disappeared');
  await selectMarket(page,'tw');await page.click('#ox-control-close');await selectView(page,'strength');
  const cards=page.locator('#ox-tw-patterns .px-card');
  await cards.first().waitFor({timeout:20000});
  assert(await page.locator('#ox-tw-patterns .px').getAttribute('data-index-state')==='loading','TW card must precede the blocked final chunk');
  const available=await cards.count();assert(available>0);
  const raw=actual[0].data.candles.slice(-61),lo=Math.min(...raw.map(c=>c.close)),hi=Math.max(...raw.map(c=>c.close));
  const board=page.locator('#ox-tw-patterns .px-board canvas');await board.scrollIntoViewIfNeeded();const box=await board.boundingBox();
  const controls=await page.locator('#ox-tw-patterns .px-controls').boundingBox(),bottom=await page.locator('#ox-tw-patterns .px-board-bottom').boundingBox();
  const top=controls.y+controls.height+10,base=bottom.y-10,x=i=>box.x+18+i/(raw.length-1)*(box.width-36),y=c=>top+(1-(c.close-lo)/(hi-lo))*(base-top);
  await page.mouse.move(x(0),y(raw[0]));await page.mouse.down();for(let i=1;i<raw.length;i++)await page.mouse.move(x(i),y(raw[i]));await page.mouse.up();
  await page.waitForTimeout(1500);
  if(await page.locator('#ox-tw-patterns .px-mode-toggle').isVisible() && await page.locator('#ox-tw-patterns [data-mode-label]').innerText()==='型態條件')await page.locator('#ox-tw-patterns .px-mode-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#ox-tw-patterns')?.shadowRoot?.querySelector('.px-card .px-match')?.textContent.includes('相似'),{},{timeout:10000});
  assert.equal(await page.locator('#ox-tw-patterns .px').getAttribute('data-index-state'),'loading','Handdrawn matches must also precede the final chunk');
  const before=await cards.count();assert(before>0);

  await selectView(page,'radar');await selectView(page,'strength');
  await cards.first().waitFor({timeout:3000});assert(await cards.count()>=before,'Partial results lost on return');
  await selectView(page,'radar');release();await page.waitForTimeout(1000);await selectView(page,'strength');
  await page.waitForFunction(()=>document.querySelector('#ox-tw-patterns')?.shadowRoot?.querySelector('.px')?.dataset.indexState==='ready',{},{timeout:20000});
  const finished=await cards.count(),requests=chunkCalls;
  await selectView(page,'radar');await selectView(page,'strength');
  await cards.first().waitFor({timeout:3000});assert.equal(await cards.count(),finished);
  assert.equal(await page.locator('#ox-tw-patterns .px').getAttribute('data-index-state'),'ready');
  assert.equal(chunkCalls,requests,'Returning to a completed canvas downloads again');
  assert.equal(audit.pageErrors.length,0,JSON.stringify(audit.pageErrors));
  console.log(JSON.stringify({pausedRadar:'retained',partialCards:before,completedCards:finished,chunkCalls,return:'cached',runtimeErrors:0}));
  await context.close();
 }finally{release();await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

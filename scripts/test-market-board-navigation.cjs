// Two-market release acceptance using actual deployed assets and data.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const base=process.env.OX_BOARD_BASE||'http://127.0.0.1:4188';
const server=process.env.OX_BOARD_BASE?null:spawn(process.execPath,['scripts/dev-server.mjs','--port','4188'],{stdio:['ignore','pipe','inherit']});
(async()=>{let browser;
 try{
  if(server)await new Promise(resolve=>server.stdout.once('data',resolve));
  browser=await chromium.launch({executablePath:process.env.OX_BROWSER_PATH,headless:true,args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}:undefined});
  for(const width of [390,1366]){
   const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width,height:932},isMobile:width<800,hasTouch:true});
   const errors=[],retiredRequests=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(/\/v1\/us\/|\/markets\/us\/|\/data\/us-/.test(r.url()))retiredRequests.push(r.url());});
   await page.addInitScript(()=>{localStorage.setItem('ox-active-market','us');localStorage.setItem('ox-us-v2:watchlist','[]');});
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OXMarketController);
   await page.click('#ox-control-open');
   assert.deepEqual(await page.locator('[data-market-choice]').evaluateAll(nodes=>nodes.map(n=>n.dataset.marketChoice)),['crypto','tw']);
   await page.click('#ox-control-close');
   await page.waitForFunction(()=>localStorage.getItem('ox-us-v2:watchlist')===null);
   assert.equal(await page.locator('body').getAttribute('data-market'),'crypto');
   const nav=(width<800?'.app-dock':'.ox-desktop-nav');
   for(const market of ['crypto','tw']){
    await page.click('#ox-control-open');await page.click('[data-market-choice="'+market+'"]');await page.click('#ox-control-close');
    for(const view of ['home','radar','strength','data','media']){
     await page.locator(nav+' [data-view-target="'+view+'"]').click();
     await page.waitForFunction(v=>document.body.dataset.view===v,view);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
    }
   }
   await page.locator(nav+' [data-view-target="strength"]').click();
   const tw=page.locator('#ox-tw-patterns');
   await tw.locator('.px-card').first().waitFor({timeout:120000});
   await tw.locator('.px-card').first().click();
   const title=await tw.locator('.px-detail-title').innerText();
   await tw.locator('[data-action="open-radar"]').click();
   await page.waitForFunction(()=>document.body.dataset.view==='radar'&&!!document.querySelector('#twr-chart-radar'));
   assert.ok((await page.locator('#twr-chart-radar').innerText()).includes(title.match(/\d{4}/)[0]));
   assert.deepEqual(errors,[]);assert.deepEqual(retiredRequests,[]);
   await page.screenshot({path:'/tmp/ox-two-markets-'+width+'.png',fullPage:true});
   console.log(JSON.stringify({width,markets:['crypto','tw'],navigation:true,boardToRadar:true,retiredRequests,errors}));await page.close();
  }
 }finally{await browser?.close();server?.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});

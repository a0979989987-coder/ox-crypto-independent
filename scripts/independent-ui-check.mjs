import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { FEATURE_CATALOG } from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT='4298';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(4298,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||undefined,args:['--no-sandbox']});
try{
  for(const theme of ['dark','light'])for(const width of [390,1440]){
    const context=await browser.newContext({locale:'zh-TW',viewport:{width,height:900}});
    const {page,audit}=await preparePage(context,{width,height:900});
    await page.addInitScript(theme=>localStorage.setItem('ox-ui-theme',theme),theme);
    const urls=[];page.on('request',r=>urls.push(r.url()));
    await page.route('**/api/v1/account/**',route=>{
      const id=new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({json:id==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}:id==='session'?{ok:true,user:null}:{configured:false}});
    });
    await page.goto(testBase,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>OXFeatures.ready&&globalThis.OXToolModules);
    await page.locator('#view-radar .coin-card').first().waitFor({timeout:15000});
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    assert.deepEqual(await page.evaluate(()=>OXModules.router.list().map(m=>m.id)),['crypto']);
    assert.equal(await page.locator('[data-market-choice="tw"],[data-tw-tool]').count(),0);
    await page.evaluate(()=>OXMarketController.setMarket('tw'));
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    await page.evaluate(()=>switchAppView('strength'));
    await page.locator('#ox-crypto-tools-nav').waitFor();
    for(const tool of ['patterns','bubbles','strength','heatmap','rotation','flow']){
      try { await page.locator(`#ox-crypto-tools-nav [data-crypto-tool="${tool}"]`).click({timeout:5000}); }
      catch(error){console.log(await page.evaluate(()=>({view:document.body.dataset.view,market:document.body.dataset.market,classes:document.body.className,gate:document.getElementById('ox-feature-gate')?.textContent,navHidden:document.getElementById('ox-crypto-tools-nav')?.hidden,active:[...document.querySelectorAll('.app-view.active')].map(e=>e.id)})));await page.screenshot({path:'/workspace/scratch/ac5c466affa8/smoke-failure.png'});throw error;}
      await page.waitForFunction(t=>document.querySelector('#view-strength .strength-page').dataset.cryptoTool===t,tool);
      if(tool==='patterns')await page.locator('#ox-crypto-tools-inline .px-board').waitFor();
      else if(tool==='bubbles')await page.locator('#ox-crypto-tools-inline .oxb-stage canvas').waitFor();
      else if(tool!=='strength')await page.locator('#ox-crypto-tools-inline .cfx-content').filter({visible:true}).waitFor();
      assert.equal(await page.locator('#ox-crypto-tools-loading .ox-tool-load-error').count(),0);
    }
    await page.evaluate(()=>OXNews.openMarket());
    if(width<600)await page.locator('.oxn-month-expand').click();
    await page.locator('.oxn-calendar').waitFor();
    assert.equal(await page.locator('.oxn-day').count()>27,true);
    await page.locator('[data-news-tab="key"]').click();
    await page.locator('.oxn-root').waitFor();
    await page.evaluate(()=>switchAppView('media'));
    await page.locator('#view-media.active').waitFor();
    const opener=page.locator('#ox-control-open,#ox-dock-menu').filter({visible:true}).first();
    await opener.click();await page.locator('#ox-control-account-open').click();
    await page.locator('#ox-account-overlay.is-open').waitFor();
    assert.equal(await page.locator('#ox-account-google').isVisible(),true);
    assert.equal(await page.locator('#ox-account-email').isVisible(),true);
    assert.equal(urls.some(u=>/\/markets\/tw\/|\/api\/v1\/tw\/|\/data\/tw-/.test(u)),false);
    assert.deepEqual(audit.pageErrors,[]);
    assert.deepEqual(audit.localHttpErrors,[]);
    assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('theme-light')),theme==='light');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    console.log(JSON.stringify({theme,width,cryptoTools:6,radar:true,calendar:true,news:true,media:true,accountEntry:true,taiwanRequests:0,runtimeErrors:audit.pageErrors,localHttpErrors:audit.localHttpErrors}));
    await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

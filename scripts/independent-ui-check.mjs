import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { FEATURE_CATALOG } from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT='4298';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(4298,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||undefined,args:['--no-sandbox']});
try{
  for(const theme of ['dark','light','midnight'])for(const width of [390,1440]){
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
    // Midnight Ink: decided before first paint, downloaded only for its viewers.
    const midnightCss=urls.filter(u=>/midnight-ink(?:-tools)?\.css/.test(u));
    const palette=await page.evaluate(()=>({html:document.documentElement.classList.contains('theme-midnight'),body:document.body.classList.contains('theme-midnight'),bg:getComputedStyle(document.body).backgroundColor,bar:document.querySelector('meta[name="theme-color"]')?.content,hosts:[...document.querySelectorAll('#ox-crypto-tools-inline > *')].filter(h=>h.shadowRoot).map(h=>h.dataset.oxPalette||'')}));
    if(theme==='midnight'){
      assert.equal(palette.html&&palette.body,true);
      assert.equal(palette.bg,'rgb(10, 14, 22)');
      assert.equal(palette.bar,'#0a0e16');
      assert.ok(palette.hosts.length&&palette.hosts.every(p=>p==='midnight'),'tool shadow roots follow the palette');
      assert.equal(midnightCss.filter(u=>/midnight-ink\.css/.test(u)).length,1,'document layer is fetched once');
    }else{
      assert.equal(palette.html||palette.body,false);
      assert.deepEqual(midnightCss,[],'other themes never download Midnight Ink');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    console.log(JSON.stringify({theme,width,cryptoTools:6,radar:true,calendar:true,news:true,media:true,accountEntry:true,taiwanRequests:0,runtimeErrors:audit.pageErrors,localHttpErrors:audit.localHttpErrors}));
    await context.close();
  }
  // Switching: the four-way control loads Midnight Ink on demand and returns cleanly.
  {
    const context=await browser.newContext({locale:'zh-TW',viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const {page,audit}=await preparePage(context,{width:390,height:844});
    await page.route('**/api/v1/account/**',route=>route.fulfill({json:{ok:true,user:null,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}}));
    await page.goto(testBase,{waitUntil:'domcontentloaded'});
    await page.locator('#view-radar .coin-card').first().waitFor({timeout:15000});
    await page.locator('#ox-dock-menu').click();
    await page.locator('#ox-control-overlay.is-open').waitFor();await page.waitForTimeout(700);
    assert.equal(await page.locator('.ox-theme-segment button').count(),4);
    const segment=await page.locator('.ox-theme-segment').boundingBox(),first=await page.locator('.ox-theme-segment button').first().boundingBox(),last=await page.locator('.ox-theme-segment button').last().boundingBox();
    assert.ok(Math.abs(first.y-last.y)<1&&segment.height<=44,'four theme pills stay on one row');
    // Same pill size as the Taiwan site: 10px/600 text, 30px pills, ~164px track; widths never change with the theme.
    const pills=()=>page.evaluate(()=>[...document.querySelectorAll('.ox-theme-segment button')].map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return [Math.round(r.width*10)/10,Math.round(r.height),s.fontSize,s.fontWeight].join('/');}).join(' ')+' '+Math.round(document.querySelector('.ox-theme-segment').getBoundingClientRect().width));
    const darkPills=await pills();
    assert.match(darkPills,/^(\S+\/30\/10px\/600 ){4}1[56]\d$/,'theme pills: '+darkPills);
    // Small controls keep their look but get a taller invisible touch target.
    const hit=await page.evaluate(()=>[...document.querySelectorAll('.ox-theme-segment button,.ox-control-toggle,.ox-market-chip')].filter(el=>el.getBoundingClientRect().height>0).map(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2;const reach=d=>{const e=document.elementFromPoint(x,d);return e===el||el.contains(e);};let up=0;while(up<12&&reach(r.top-up-1))up++;let down=0;while(down<12&&reach(r.bottom+down))down++;return Math.round(r.height+up+down);}));
    assert.ok(hit.every(h=>h>=30),'control-panel targets are at least 30px tall: '+hit);
    assert.ok(await page.locator('.ox-control-toggle [data-setting-key="oxLive"]').getAttribute('aria-label'),'switch inputs have a name');
    await page.locator('[data-control-theme="midnight"]').click();
    await page.waitForFunction(()=>document.documentElement.classList.contains('theme-midnight')&&getComputedStyle(document.body).backgroundColor==='rgb(10, 14, 22)');
    assert.equal(await page.evaluate(()=>localStorage.getItem('ox-ui-theme')),'midnight');
    assert.equal(await page.locator('[data-control-theme="midnight"]').getAttribute('aria-pressed'),'true');
    await page.waitForTimeout(300);assert.equal(await pills(),darkPills,'Midnight Ink selection keeps every pill width');
    await page.locator('[data-control-theme="light"]').click();
    await page.waitForFunction(()=>document.body.classList.contains('theme-light')&&!document.documentElement.classList.contains('theme-midnight'));
    await page.waitForTimeout(300);assert.equal(await pills(),darkPills,'platinum selection keeps every pill width');
    await page.locator('[data-control-theme="dark"]').click();
    await page.waitForFunction(()=>!document.body.classList.contains('theme-light')&&!document.documentElement.classList.contains('theme-midnight'));
    assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(10, 14, 22)');
    assert.deepEqual(audit.pageErrors,[]);
    console.log(JSON.stringify({themeSwitch:['midnight','light','dark'],pills:4}));
    await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

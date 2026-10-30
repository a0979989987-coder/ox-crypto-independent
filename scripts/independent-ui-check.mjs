import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { FEATURE_CATALOG } from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT='4298';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(4298,'127.0.0.1',resolve));
// A small 對比 record (the real one is written by scripts/collect-crypto-breakouts.mjs):
// the newest 4H close with SOL still waiting, an older one with XRP's 4 小時 and 1 天 in.
const STEP=14400,latest=Math.floor(Date.now()/1000/STEP)*STEP;
const taipei=at=>{const d=new Date((at+28800)*1000);return `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:00`;};
const compareTimes=()=>[latest,latest-STEP,latest-7*STEP].map(taipei);
function compareLog(){
  const older=latest-7*STEP,pick=(s,t,p,price,c)=>({s,p,t,st:'已收 K 確認突破',pts:[[latest-40*STEP,price*1.02],[latest-24*STEP,price*.97],[latest-12*STEP,price*1.01],[latest-STEP,price*.99]],c});
  return {version:1,updatedAt:new Date((latest+420)*1000).toISOString(),frame:'4H',step:STEP,periods:[1,6,18],at:latest,method:'突破 K 收盤 → 之後第 1／6／18 根 4 小時 K 收盤；BTC 為同期漲跌',
    btc:{[older]:60000,[older+STEP]:60600,[older+6*STEP]:59400},
    points:[{at:older,pool:8,scanned:8,picks:[pick('XRPUSDT',2,'trend-down',800,[10,11,10.5,10.4,10.3,10.2,9.5,9.6])]},{at:latest-STEP,pool:8,scanned:8,picks:[]},{at:latest,pool:8,scanned:8,picks:[pick('SOLUSDT',1,'w',1066,[1066])]}],history:[]};
}
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
    // 畫板 opens on the pattern board; 盤面 holds the chart and the T1/T2/T3 list.
    assert.equal(await page.evaluate(()=>document.getElementById('view-radar').dataset.radarMode),'board');
    await page.locator('#ox-radar-board .px-board').waitFor({timeout:15000});
    await page.evaluate(()=>OXRadarModes.set('chart'));
    await page.locator('#view-radar .coin-card').first().waitFor({timeout:15000});
    // 型態 (was 對比) sits between 畫板 and 盤面: the recorded 4H breakouts, newest first; a coin opens
    // 型態詳情, and its button opens the coin on 盤面 at 4H.
    assert.deepEqual(await page.locator('.ox-radar-mode-rail [data-radar-tab]').evaluateAll(tabs=>tabs.map(t=>t.textContent.trim())),['畫板','型態','盤面','自選']);
    await page.route('**/data/crypto-breakouts.json*',route=>route.fulfill({json:compareLog()}));
    await page.locator('#ox-radar-tab-compare').click();
    await page.locator('#ox-radar-compare .ox-cmp-point.is-open .ox-cmp-mini svg').first().waitFor({timeout:15000});
    assert.deepEqual(await page.locator('#ox-radar-compare .ox-cmp-point').evaluateAll(list=>list.map(p=>p.querySelector('.ox-cmp-when b').textContent)),compareTimes());
    assert.match(await page.locator('#ox-radar-compare .ox-cmp-point.is-open').innerText(),/SOL[\s\S]*W 底・雙底[\s\S]*4 小時[\s\S]*還沒到/);
    await page.locator('#ox-radar-compare .ox-cmp-point:not(.is-open):not(.is-none) .ox-cmp-head').first().click();
    assert.match(await page.locator('#ox-radar-compare .ox-cmp-point.is-open').nth(1).innerText(),/XRP[\s\S]*\+10\.00%[\s\S]*BTC \+1\.00%[\s\S]*3 天[\s\S]*還沒到/);
    await page.locator('#ox-radar-compare .ox-cmp-pick[data-cmp-symbol="SOLUSDT"]').click();
    await page.locator('dialog.ox-pd[open] .ox-pd-chart svg').waitFor({timeout:15000});
    assert.match(await page.locator('dialog.ox-pd[open]').innerText(),/SOL[\s\S]*W 底・雙底[\s\S]*突破價[\s\S]*之後 4 小時[\s\S]*還沒到[\s\S]*開啟盤面看完整 K 線/);
    await page.locator('dialog.ox-pd[open] [data-pd-open]').click();
    assert.equal(await page.locator('dialog.ox-pd').count(),0);
    await page.waitForFunction(()=>document.getElementById('view-radar').dataset.radarMode==='chart'&&state.symbol==='SOLUSDT'&&state.period==='4H');
    assert.equal(await page.locator('#chart-timeframe-strip .btn-tf.active').getAttribute('data-tf'),'4H');
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    assert.deepEqual(await page.evaluate(()=>OXModules.router.list().map(m=>m.id)),['crypto']);
    assert.equal(await page.locator('[data-market-choice="tw"],[data-tw-tool]').count(),0);
    await page.evaluate(()=>OXMarketController.setMarket('tw'));
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    await page.evaluate(()=>switchAppView('strength'));
    await page.locator('#ox-crypto-tools-nav').waitFor();
    assert.equal(await page.locator('#ox-crypto-tools-nav [data-crypto-tool="patterns"]').count(),0);
    for(const tool of ['bubbles','strength','heatmap','rotation','flow']){
      try { await page.locator(`#ox-crypto-tools-nav [data-crypto-tool="${tool}"]`).click({timeout:5000}); }
      catch(error){console.log(await page.evaluate(()=>({view:document.body.dataset.view,market:document.body.dataset.market,classes:document.body.className,gate:document.getElementById('ox-feature-gate')?.textContent,navHidden:document.getElementById('ox-crypto-tools-nav')?.hidden,active:[...document.querySelectorAll('.app-view.active')].map(e=>e.id)})));await page.screenshot({path:'/workspace/scratch/ac5c466affa8/smoke-failure.png'});throw error;}
      await page.waitForFunction(t=>document.querySelector('#view-strength .strength-page').dataset.cryptoTool===t,tool);
      if(tool==='bubbles')await page.locator('#ox-crypto-tools-inline .oxb-stage canvas').waitFor();
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
    // One login system: the Google member card sits in 設定's account slot; the old OX ACCOUNT entry stays hidden.
    await opener.click();await page.locator('#view-settings.active #ox-settings-account #ox-member-account').waitFor({state:'visible'});
    assert.equal(await page.locator('#ox-control-account-open').isVisible(),false);
    assert.equal(await page.locator('[data-setting-key="oxLive"],[data-market-choice]').count(),0);
    assert.match(await page.locator('#ox-member-account').innerText(),/會員功能尚未開放/);
    assert.equal(await page.locator('#ox-account-overlay.is-open').count(),0);
    assert.equal(urls.some(u=>/\/markets\/tw\/|\/api\/v1\/tw\/|\/data\/tw-/.test(u)),false);
    assert.deepEqual(audit.pageErrors,[]);
    assert.deepEqual(audit.localHttpErrors,[]);
    assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('theme-light')),theme==='light');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    console.log(JSON.stringify({theme,width,cryptoTools:5,patternBoard:true,compare:true,radar:true,calendar:true,news:true,media:true,accountEntry:true,taiwanRequests:0,runtimeErrors:audit.pageErrors,localHttpErrors:audit.localHttpErrors}));
    await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

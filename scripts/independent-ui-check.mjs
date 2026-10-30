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
    // The dock: 首頁／行情／畫板／型態／資訊. 畫板 is the pattern board alone.
    assert.deepEqual(await page.locator('.app-dock .dock-btn').evaluateAll(list=>list.map(b=>b.textContent.trim())),['首頁','行情','畫板','型態','資訊']);
    assert.equal(await page.evaluate(()=>document.getElementById('view-radar').dataset.radarMode),'board');
    await page.locator('#ox-radar-board .px-board').waitFor({timeout:15000});
    // 行情 opens on 雷達, the T1/T2/T3 list at full width; 自選 and 排行 are coin lists.
    await page.evaluate(()=>switchAppView('strength'));
    assert.deepEqual(await page.locator('#ox-crypto-tools-nav [data-crypto-tool]').evaluateAll(list=>list.map(b=>b.textContent.trim())),['雷達','自選','排行','泡泡圖','強弱對比','熱力圖','板塊輪動','主動買賣']);
    await page.locator('#ox-market-radar #screener-list .coin-card').first().waitFor({timeout:15000});
    await page.locator('#ox-crypto-tools-nav [data-crypto-tool="rank"]').click();
    await page.locator('#ox-market-list .ml-row').first().waitFor({timeout:15000});
    assert.match(await page.locator('#ox-market-list .ml-ratio-t').innerText(),/漲 \d+[\s\S]*跌 \d+/);
    // A coin opens its 個股 page; ‹ (the history entry) returns to 行情.
    await page.locator('#ox-market-list .ml-row').first().click();
    await page.waitForFunction(()=>document.body.dataset.view==='stock'&&document.getElementById('view-radar').dataset.radarMode==='chart'&&history.state?.oxStock);
    assert.equal(await page.locator('.ox-stock-bar').isVisible(),true);
    assert.equal(await page.locator('nav.app-dock').isVisible(),false);
    await page.locator('.ox-stock-bar [data-stock-act="back"]').click();
    await page.waitForFunction(()=>document.body.dataset.view==='strength');
    // 型態: 每 4 小時突破 opens on the newest close with a result (XRP); the newer SOL close waits
    // for its first close; a coin opens 型態詳情, and its button opens the coin's 個股 page at 4H.
    await page.route('**/data/crypto-breakouts.json*',route=>route.fulfill({json:compareLog()}));
    await page.evaluate(()=>switchAppView('pattern'));
    await page.locator('#ox-radar-compare .ox-cmp-picks .ox-cmp-mini svg').first().waitFor({timeout:15000});
    const [older,,newest]=[...compareTimes()].reverse();
    assert.match(await page.locator('#ox-radar-compare .ox-cmp-title').innerText(),new RegExp(older.replace(/\//g,'\\/')+' 突破'));
    assert.match(await page.locator('#ox-radar-compare .ox-cmp').innerText(),/XRP[\s\S]*\+10\.00%[\s\S]*BTC \+1\.00%[\s\S]*3 天[\s\S]*還沒到/);
    await page.locator('#ox-radar-compare .ox-cmp-pending').click();
    assert.match(await page.locator('#ox-radar-compare .ox-cmp-title').innerText(),new RegExp(newest.replace(/\//g,'\\/')+' 突破'));
    assert.match(await page.locator('#ox-radar-compare .ox-cmp-picks').innerText(),/SOL[\s\S]*W 底・雙底[\s\S]*4 小時[\s\S]*還沒到/);
    await page.locator('#ox-radar-compare .ox-cmp-nav [data-cmp-step="1"]').click();
    assert.match(await page.locator('#ox-radar-compare .ox-cmp').innerText(),/沒有突破/);
    await page.locator('#ox-radar-compare .ox-cmp-nav [data-cmp-step="-1"]').click();
    for(const tab of ['stats','history']){await page.locator(`#ox-radar-compare [data-cmp-tab="${tab}"]`).click();await page.locator('#ox-radar-compare .ox-cmp-foot').waitFor();}
    await page.locator('#ox-radar-compare [data-cmp-tab="point"]').click();
    // 分享圖片: the picture button by the tier opens a preview (a modal dialog) and closes again.
    await page.locator('#ox-radar-compare .ox-cmp-pick[data-cmp-symbol="SOLUSDT"] [data-cmp-share]').click();
    await page.locator('dialog.ox-share-preview[open] img').waitFor({timeout:15000});
    assert.match(await page.locator('dialog.ox-share-preview[open]').innerText(),/存圖[\s\S]*關閉/);
    await page.locator('dialog.ox-share-preview[open] [data-share-close]').click();
    assert.equal(await page.locator('dialog.ox-share-preview').count(),0);
    await page.locator('#ox-radar-compare .ox-cmp-pick[data-cmp-symbol="SOLUSDT"]').click();
    await page.locator('dialog.ox-pd[open] .ox-pd-chart svg').waitFor({timeout:15000});
    assert.match(await page.locator('dialog.ox-pd[open]').innerText(),/SOL[\s\S]*W 底・雙底[\s\S]*突破價[\s\S]*之後 4 小時[\s\S]*還沒到[\s\S]*看個股完整 K 線/);
    // The sheet's own picture button: the preview opens above the sheet, which stays open.
    await page.locator('dialog.ox-pd[open] [data-pd-share]').click();
    await page.locator('dialog.ox-share-preview[open] img').waitFor({timeout:15000});
    await page.locator('dialog.ox-share-preview[open] [data-share-close]').click();
    assert.equal(await page.locator('dialog.ox-pd[open]').count(),1);
    await page.locator('dialog.ox-pd[open] [data-pd-open]').click();
    assert.equal(await page.locator('dialog.ox-pd').count(),0);
    await page.waitForFunction(()=>document.body.dataset.view==='stock'&&document.getElementById('view-radar').dataset.radarMode==='chart'&&state.symbol==='SOLUSDT'&&state.period==='4H');
    assert.equal(await page.locator('#chart-timeframe-strip .btn-tf.active').getAttribute('data-tf'),'4H');
    // 首頁: BTC with 畫型態, 市場寬度 and 主流, 今日突破 from the same record, both radar lists, 此刻發生.
    await page.evaluate(()=>{setChartPeriod('1D',{load:false});switchSymbol('BTCUSDT');switchAppView('home');});
    await page.locator('#view-home .oxh-break[data-home-break="SOLUSDT"]').waitFor({timeout:15000});
    assert.match(await page.locator('#home-btc-price').innerText(),/^[\d,.]+$/);
    assert.match(await page.locator('#home-btc-change').innerText(),/^[+-]?[\d,.]+（[+-]\d+\.\d\d%）$/);
    assert.match(await page.locator('#home-breadth-up').innerText(),/^\d+$/);
    assert.match(await page.locator('#home-eth-change').innerText(),/^[+-]\d+\.\d\d%$/);
    assert.match(await page.locator('#view-home [data-home-breaks-time]').innerText(),/^\d+\/\d+ \d\d:00 突破・1 個$/);
    assert.match(await page.locator('#view-home .oxh-break[data-home-break="SOLUSDT"]').innerText(),/SOL[\s\S]*T1[\s\S]*W 底・雙底[\s\S]*突破後/);
    await page.locator('#view-home .oxh-break[data-home-break="SOLUSDT"] .oxh-mini svg').waitFor();
    await page.locator('#home-t1-long-list [data-home-symbol], #home-t1-short-list [data-home-symbol]').first().waitFor({timeout:15000});
    await page.waitForFunction(()=>!/載入新聞/.test(document.querySelector('#view-home [data-home-news-list]').textContent),null,{timeout:20000});
    assert.equal(await page.locator('#home-btc-mini-chart, #home-btc-strength, #home-market-score').count(),0);
    await page.locator('#view-home .ox-home-share').click();
    await page.locator('dialog.ox-share-preview[open] img').waitFor({timeout:15000});
    await page.locator('dialog.ox-share-preview[open] [data-share-close]').click();
    // The top bar sits above the home content; one share button and one radar label on 首頁.
    assert.deepEqual(await page.evaluate(()=>({shares:document.querySelectorAll('#view-home .ox-home-share').length,labels:document.querySelectorAll('#view-home [data-radar-freshness]').length,clear:document.getElementById('ox-topbar').getBoundingClientRect().bottom<=document.querySelector('#view-home .oxh > *').getBoundingClientRect().top+0.5})),{shares:1,labels:1,clear:true});
    await page.locator('#view-home [data-home-go="board"]').click();
    await page.waitForFunction(()=>document.body.dataset.view==='radar'&&document.getElementById('view-radar').dataset.radarMode==='board');
    await page.evaluate(()=>switchAppView('home'));
    await page.locator('#view-home [data-home-go="compare"]').click();
    await page.waitForFunction(()=>document.body.dataset.view==='pattern'&&document.getElementById('view-radar').dataset.radarMode==='compare');
    await page.evaluate(()=>switchAppView('home'));
    await page.locator('#view-home .oxh-break[data-home-break="SOLUSDT"]').click();
    await page.waitForFunction(()=>document.body.dataset.view==='stock'&&document.getElementById('view-radar').dataset.radarMode==='chart'&&state.symbol==='SOLUSDT'&&state.period==='4H');
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    assert.deepEqual(await page.evaluate(()=>OXModules.router.list().map(m=>m.id)),['crypto']);
    assert.equal(await page.locator('[data-market-choice="tw"],[data-tw-tool]').count(),0);
    await page.evaluate(()=>OXMarketController.setMarket('tw'));
    assert.equal(await page.evaluate(()=>document.body.dataset.market),'crypto');
    await page.evaluate(()=>switchAppView('strength'));
    await page.locator('#ox-crypto-tools-nav').waitFor();
    assert.equal(await page.locator('#ox-crypto-tools-nav [data-crypto-tool="patterns"]').count(),0);
    for(const tool of ['radar','watch','rank','bubbles','strength','heatmap','rotation','flow']){
      try { await page.locator(`#ox-crypto-tools-nav [data-crypto-tool="${tool}"]`).click({timeout:5000}); }
      catch(error){console.log(await page.evaluate(()=>({view:document.body.dataset.view,market:document.body.dataset.market,classes:document.body.className,gate:document.getElementById('ox-feature-gate')?.textContent,navHidden:document.getElementById('ox-crypto-tools-nav')?.hidden,active:[...document.querySelectorAll('.app-view.active')].map(e=>e.id)})));await page.screenshot({path:'/workspace/scratch/ac5c466affa8/smoke-failure.png'});throw error;}
      await page.waitForFunction(t=>document.querySelector('#view-strength .strength-page').dataset.cryptoTool===t,tool);
      if(tool==='radar')await page.locator('#ox-market-radar #screener-list').waitFor();
      else if(tool==='watch'||tool==='rank')await page.locator('#ox-market-list .ml').waitFor();
      else if(tool==='bubbles'){await page.locator('#ox-crypto-tools-inline .oxb-stage canvas').waitFor();
        // N 日漲跌 above the names: 5 天 unless this device chose otherwise.
        assert.equal(await page.locator('#ox-crypto-tools-inline .oxb-period [aria-pressed="true"]').getAttribute('data-period'),'5');}
      else if(tool!=='strength')await page.locator('#ox-crypto-tools-inline .cfx-content').filter({visible:true}).waitFor();
      if(tool!=='radar')assert.equal(await page.locator('#ox-market-radar').isVisible(),false);
      assert.equal(await page.locator('#ox-crypto-tools-loading .ox-tool-load-error').count(),0);
    }
    await page.evaluate(()=>OXNews.openMarket());
    if(width<600)await page.locator('.oxn-month-expand').click();
    await page.locator('.oxn-calendar').waitFor();
    assert.equal(await page.locator('.oxn-day').count()>27,true);
    await page.locator('[data-news-tab="key"]').click();
    await page.locator('.oxn-root').waitFor();
    await page.locator('.oxn-share-pic').waitFor();
    await page.evaluate(()=>switchAppView('media'));
    await page.locator('#view-media.active').waitFor();
    // The avatar opens the left drawer (首頁's top bar on phones, the header on wide screens); 設定 opens from it.
    await page.evaluate(()=>switchAppView('home'));
    await page.locator('[data-oc="drawer"]').filter({visible:true}).first().click();
    await page.locator('.oc-drawer [data-dr="settings"]').waitFor({state:'visible'});
    assert.match(await page.locator('.oc-drawer').innerText(),/我的自選[\s\S]*通知[\s\S]*意見回饋[\s\S]*使用說明[\s\S]*加入 LINE 社群[\s\S]*OX Journal[\s\S]*最近使用[\s\S]*設定[\s\S]*取得幫助/);
    // One login system: the Google member card sits in 設定's account slot; the old OX ACCOUNT entry stays hidden.
    await page.locator('.oc-drawer [data-dr="settings"]').click();await page.locator('#view-settings.active #ox-settings-account #ox-member-account').waitFor({state:'visible'});
    assert.equal(await page.locator('#view-settings .oc-subhead h1').innerText(),'設定');
    assert.equal(await page.locator('#ox-control-account-open').isVisible(),false);
    assert.equal(await page.locator('[data-setting-key="oxLive"],[data-market-choice]').count(),0);
    assert.match(await page.locator('#ox-member-account').innerText(),/會員功能尚未開放/);
    assert.equal(await page.locator('#ox-account-overlay.is-open').count(),0);
    assert.equal(urls.some(u=>/\/markets\/tw\/|\/api\/v1\/tw\/|\/data\/tw-/.test(u)),false);
    assert.deepEqual(audit.pageErrors,[]);
    assert.deepEqual(audit.localHttpErrors,[]);
    assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('theme-light')),theme==='light');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    console.log(JSON.stringify({theme,width,marketTabs:8,patternBoard:true,pattern:true,stockPage:true,calendar:true,news:true,media:true,drawer:true,accountEntry:true,taiwanRequests:0,runtimeErrors:audit.pageErrors,localHttpErrors:audit.localHttpErrors}));
    await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

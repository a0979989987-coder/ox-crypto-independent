const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {server,preparePage,testBase,selectView}=require('./e2e-check.cjs');
const audit=JSON.parse(fs.readFileSync('tests/fixtures/crypto-radar-audit-20261001.json'));
const mon=JSON.parse(fs.readFileSync('tests/fixtures/crypto-mon-20261001.json'));
const reversal=JSON.parse(fs.readFileSync('tests/fixtures/crypto-classic-reversals-20261001.json'));
const responses={...reversal.responses,...audit.responses,MONUSDT:mon.responses};
const symbols=Object.keys(responses),tickers=audit.tickers,contracts=audit.contracts;
const tickerRows=[...new Map([...tickers.data,...reversal.tickers.data]
  .filter(t=>symbols.includes(t.symbol)).map(t=>[t.symbol,t])).values()].map(t=>({
  ...t,lastPr:String(responses[t.symbol]['1H'].data.at(-1)[4])
}));
const contractRows=[...new Map([...contracts.data,...reversal.contracts.data]
  .filter(c=>symbols.includes(c.symbol)).map(c=>[c.symbol,c])).values()];
(async()=>{
  await new Promise(r=>server.listen(4173,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.OX_BROWSER_PATH});
  try{
    assert.equal(tickerRows.length,symbols.length);
    assert.equal(contractRows.length,symbols.length);
    const context=await browser.newContext(),{page,audit:runtime}=await preparePage(context,{width:390,height:844});
    const now=Math.max(...Object.values(responses).flatMap(frames=>Object.values(frames).map(r=>Number(r.requestTime))));
    await page.clock.setFixedTime(new Date(now));
    await page.route('https://api.bitget.com/**',route=>{
      const u=new URL(route.request().url());
      let result={code:'00000',requestTime:now,data:[]};
      if(u.pathname.endsWith('/tickers'))result={...tickers,data:tickerRows};
      else if(u.pathname.endsWith('/contracts'))result={...contracts,data:contractRows};
      else if(u.pathname.endsWith('/candles'))result=responses[u.searchParams.get('symbol')]?.[u.searchParams.get('granularity')]||result;
      return route.fulfill({json:result});
    });
    await page.goto(testBase,{waitUntil:'domcontentloaded'});
    try{await page.waitForFunction(count=>state.radarSnapshotReady&&state.analyzedCache.size===count,symbols.length,{timeout:30000});}
    catch(error){console.error('Radar scan state',await page.evaluate(()=>({tickers:state.tickers.map(t=>t.symbol),queue:state.scanQueue,
      index:state.scanIndex,ready:state.radarSnapshotReady,analyzed:[...state.analyzedCache.keys()],status:document.querySelector('#scan-status')?.textContent})));
      throw error;}
    const list=await page.locator('#screener-list .coin-card').evaluateAll(rows=>rows.map(row=>({
      symbol:row.dataset.symbol,tier:row.dataset.tier,score:Number(row.querySelector('.coin-ox-value')?.textContent)
    })));
    assert.deepEqual(list.map(row=>row.symbol).sort(),['CAPUSDT','龙虾USDT'].sort());
    assert(list.every(row=>row.tier==='t2'));
    const lobster=list.find(row=>row.symbol==='龙虾USDT');
    await page.locator('#screener-list .coin-card[data-symbol="龙虾USDT"]').click();
    await page.waitForFunction(()=>document.querySelector('#detail-tier').textContent.includes('放量反轉'));
    assert((await page.locator('#detail-tier').innerText()).includes('4H＋1H'));
    assert.equal(Number(await page.locator('#detail-ox').innerText()),lobster.score);
    await selectView(page,'home');await selectView(page,'radar');
    assert.equal(await page.locator('#screener-list .coin-card').count(),2);
    assert.equal(runtime.pageErrors.length,0,JSON.stringify(runtime.pageErrors));
    console.log('Recorded mobile audit:',JSON.stringify(list),'— weak range candidates absent, fresh reversals retain matching detail and return view');
    await context.close();
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});

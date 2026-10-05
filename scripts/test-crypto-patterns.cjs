// UI QA uses recorded exchange responses at their original capture time.
// Synthetic geometry belongs only to the unit suite, never this review or production.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const snapshot=JSON.parse(fs.readFileSync('previews/data/crypto-tools-snapshot.json'));
const origin='http://127.0.0.1:4193';
function aggregate(raw,frame){
  if(frame==='15m')return raw;
  const ms=frame==='1H'?3600000:frame==='4H'?14400000:frame==='30m'?1800000:86400000,buckets=new Map();
  for(const r of [...raw].sort((a,b)=>Number(a[0])-Number(b[0]))){const key=Math.floor(Number(r[0])/ms)*ms;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r.map(Number));}
  return [...buckets].filter(([ts,r])=>r.length===ms/900000&&r[0][0]===ts).map(([ts,r])=>[ts,r[0][1],Math.max(...r.map(x=>x[2])),Math.min(...r.map(x=>x[3])),r.at(-1)[4],r.reduce((s,x)=>s+x[5],0),r.reduce((s,x)=>s+x[6],0)].map(String));
}
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,['scripts/dev-server.mjs','--port','4193']);server.stderr.on('data',s=>process.stderr.write(s));await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exit '+code)));});console.log('Preview ready');
 const browser=await chromium.launch({executablePath:process.env.OX_CHROMIUM_EXECUTABLE||'/workspace/scratch/6827c8da6e73/browser-tools/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox']});
 try{
  console.log('Browser ready');const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[];let candleRequests=0,blockCandles=false;page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(snapshot.requestTime));
  await page.route('https://api.bitget.com/**',route=>{
   const url=new URL(route.request().url());let body;
   if(url.pathname.endsWith('/tickers'))body={code:'00000',requestTime:snapshot.requestTime,data:snapshot.tickers};
   else if(url.pathname.endsWith('/instruments'))body={code:'00000',requestTime:snapshot.requestTime,data:snapshot.instruments};
   else if(url.pathname.endsWith('/contracts'))body={code:'00000',data:snapshot.instruments.map(i=>({...i,symbolStatus:'normal',symbolType:'perpetual'}))};
   else if(url.pathname.endsWith('/candles')){candleRequests++;if(blockCandles)return route.abort();const rows=snapshot.candles[url.searchParams.get('symbol')]?.response.data||[];body={code:'00000',requestTime:snapshot.requestTime,data:aggregate(rows,url.searchParams.get('granularity'))};}
   else return route.abort();
   return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route(/https:\/\/(?!api\.bitget\.com)/,r=>r.abort());
  console.log('Opening page');await page.goto(origin,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'指標',exact:true}).click();await page.locator('.px-board').waitFor();console.log('Pattern page ready');
  assert.deepEqual((await page.locator('#ox-crypto-tools-nav [data-crypto-tool]').allTextContents()).slice(0,3),['型態搜尋','泡泡圖','強弱對比']);
  assert.equal(await page.locator('[data-frame-label]').textContent(),'4H + 1H');
  assert.equal(await page.locator('[data-limit]').inputValue(),'0','all eligible coins by default');
  await page.waitForFunction(()=>document.querySelector('#ox-crypto-tools-inline').firstElementChild.shadowRoot.querySelector('.px').dataset.indexState==='loading');
  await page.waitForTimeout(600);assert.ok(candleRequests>0,'preloads candles before any drawing or preset');
  await page.locator('[data-action="timeframes"]').click();await page.locator('.px-settings [data-frame="15m"]').click();await page.locator('.px-settings [data-frame="4H"]').click();await page.locator('.px-settings [data-frame="1H"]').click();await page.getByRole('button',{name:'關閉時間級別',exact:true}).click();
  await page.locator('[data-action="patterns"]').click();assert.deepEqual((await page.locator('[data-preset]').evaluateAll(es=>es.slice(0,4).map(e=>e.dataset.preset))),['horizontal-resistance','horizontal-support','trend-up','trend-down']);assert.equal(await page.locator('[data-preset]').count(),51);await page.locator('.px-search').fill('階梯');assert.equal(await page.locator('[data-preset]').count(),2);await page.locator('[data-preset="stairs-up"]').click();
  console.log('Scanning recorded 15m data');await page.waitForFunction(()=>{const root=document.querySelector('#ox-crypto-tools-inline').firstElementChild.shadowRoot;return root.querySelector('.px').dataset.indexState!=='loading';},{},{timeout:60000});console.log('Scan complete');
  await page.locator('[data-action="patterns"]').click();await page.waitForTimeout(380);await page.screenshot({path:'/tmp/ox-pattern-menu-v2.png'});await page.getByRole('button',{name:'關閉型態選單',exact:true}).click();await page.locator('[data-action="timeframes"]').click();assert.equal(await page.locator('.px-settings [data-frame]').count(),11);assert.equal(await page.locator('.px-settings [data-frame="1W"]').count(),1);await page.waitForTimeout(380);await page.screenshot({path:'/tmp/ox-pattern-timeframes-v2.png'});await page.getByRole('button',{name:'關閉時間級別',exact:true}).click();
  const requestCount=candleRequests;
  await page.locator('[data-action="patterns"]').click();await page.locator('.px-search').fill('水平阻力');const preCount=Number(await page.locator('[data-count="horizontal-resistance"]').textContent());assert.ok(preCount>0);const start=Date.now();await page.locator('[data-preset="horizontal-resistance"]').click();await page.waitForTimeout(250);assert.equal(candleRequests,requestCount,'preset selection must not request candles');assert.equal(await page.locator('.px-card').count(),Math.min(preCount,24));console.log('Cached preset including close animation ms',Date.now()-start);
  await page.locator('[data-action="patterns"]').click();await page.locator('[data-preset="stairs-up"]').click();await page.waitForTimeout(250);
  assert.ok(await page.locator('.px-card').count()>=2);assert.equal(await page.locator('.px-card strong').first().textContent()==='—',false);
  assert.match(await page.locator('[data-tier-filter="all"]').textContent(),/全部 \d+/);
  assert.ok((await page.locator('.px-card[data-tier]').count())>=2);
  assert.ok((await page.locator('.px-card').first().getAttribute('aria-label')).includes('T'));
  const geometry=await page.locator('.px-grid').evaluate(grid=>({width:grid.getBoundingClientRect().width,gap:parseFloat(getComputedStyle(grid).columnGap),cards:[...grid.querySelectorAll('.px-card')].slice(0,2).map(e=>e.getBoundingClientRect().width)}));
  assert.ok(Math.abs(geometry.cards[0]+geometry.cards[1]+geometry.gap-geometry.width)<2,'Cards occupy two columns even when a tier heading starts a new row');
  const ranks=await page.locator('.px-card').evaluateAll(es=>es.map(e=>({tier:Number(e.dataset.tier),score:Number(e.querySelector('.px-match span:last-child').textContent.replace('相似 ',''))})));
  assert.ok(ranks.every((x,i)=>!i||x.tier>ranks[i-1].tier||x.tier===ranks[i-1].tier&&x.score<=ranks[i-1].score));
  const topCount=Number((await page.locator('[data-tier-filter="1"]').textContent()).trim().split(/\s+/).at(-1));
  await page.locator('[data-tier-filter="1"]').click();assert.equal(await page.locator('.px-card').count(),Math.min(topCount,24));await page.locator('[data-tier-filter="all"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync('/tmp/ox-pattern-review',{recursive:true});await page.screenshot({path:'/tmp/ox-pattern-review/mobile.png',fullPage:true});
  await page.locator('.px-card').first().click();const chart=page.locator('.px-detail canvas');await chart.waitFor();await page.waitForTimeout(150);const before=await chart.evaluate(e=>e.toDataURL());const box=await chart.boundingBox(),session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+100,y:box.y+180,id:1},{x:box.x+230,y:box.y+180,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+60,y:box.y+180,id:1},{x:box.x+280,y:box.y+180,id:2}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);assert.notEqual(await chart.evaluate(e=>e.toDataURL()),before);
  await page.locator('[data-detail-frame="1H"]').click();await page.waitForFunction(()=>document.querySelector('#ox-crypto-tools-inline').firstElementChild.shadowRoot.querySelector('[data-detail-frame="1H"]').getAttribute('aria-pressed')==='true');
  assert.match(await page.locator('.px-detail-title').textContent(),/1H/);assert.match(await page.locator('.px-detail-footer').textContent(),/Bitget · 已收盤/);
  assert.notEqual(await chart.evaluate(e=>e.toDataURL()),before,'the 1H chart redraws from a different candle series');
  await page.locator('[data-detail-frame="15m"]').click();await page.waitForFunction(()=>document.querySelector('#ox-crypto-tools-inline').firstElementChild.shadowRoot.querySelector('[data-detail-frame="15m"]').getAttribute('aria-pressed')==='true');
  await page.screenshot({path:'/tmp/ox-pattern-review/detail.png'});await page.getByRole('button',{name:'關閉圖表',exact:true}).click();
  const afterDetailRequests=candleRequests;
  // Freehand input is drawn from an actual observed window, preserving its capture timestamp.
  await page.locator('.px-board [data-action="undo"]').click();const raw=snapshot.candles.BTCUSDT.response.data.map(r=>r.map(Number)).filter(r=>r[0]+900000<=snapshot.requestTime).sort((a,b)=>a[0]-b[0]).slice(-61),lo=Math.min(...raw.map(r=>r[4])),hi=Math.max(...raw.map(r=>r[4]));
  const board=page.locator('.px-board canvas');await board.scrollIntoViewIfNeeded();const bb=await board.boundingBox();
  const controlBox=await page.locator('.px-controls').boundingBox(),bottomBox=await page.locator('.px-board-bottom').boundingBox();
  assert.ok(controlBox.y>=bb.y&&bottomBox.y+bottomBox.height<=bb.y+bb.height,'floating controls stay within the board');
  const drawTop=controlBox.y+controlBox.height+10,drawBottom=bottomBox.y-10;
  assert.ok(drawBottom-drawTop>=180,'the board retains an unobstructed drawing area');
  const x=i=>bb.x+18+i/(raw.length-1)*(bb.width-36),y=r=>drawTop+(1-(r[4]-lo)/(hi-lo))*(drawBottom-drawTop);
  await page.mouse.move(x(0),y(raw[0]));await page.mouse.down();for(let i=1;i<raw.length;i++)await page.mouse.move(x(i),y(raw[i]));await page.mouse.up();await page.waitForTimeout(1300);await page.waitForFunction(()=>document.querySelector('#ox-crypto-tools-inline').firstElementChild.shadowRoot.querySelector('.px').dataset.indexState!=='loading',{},{timeout:60000});
  assert.ok((await page.locator('.px-card .px-symbol').allTextContents()).some(s=>s.startsWith('BTC')));assert.equal(candleRequests,afterDetailRequests,'freehand search uses already loaded candles');
  // A new stroke replaces the old one without Undo, and the drawing glow is finite.
  await board.scrollIntoViewIfNeeded();const nextBox=await board.boundingBox(),nextControls=await page.locator('.px-controls').boundingBox(),nextY=nextControls.y+nextControls.height+10;
  await page.mouse.move(nextBox.x+20,nextY);await page.mouse.down();assert.ok(await page.locator('.px-board.is-drawing').count());await page.mouse.move(nextBox.x+nextBox.width-20,nextY,{steps:20});await page.mouse.up();await page.waitForTimeout(200);assert.equal(await page.locator('[data-pattern-label]').textContent(),'水平阻力');assert.equal(await page.locator('.px-board.is-drawing').count(),0);
  await page.setViewportSize({width:1440,height:1100});await page.waitForTimeout(250);await page.screenshot({path:'/tmp/ox-pattern-review/desktop.png',fullPage:true});
  await page.locator('#ox-crypto-tools-nav [data-crypto-tool="strength"]').click();assert.ok(await page.locator('.strength-compare-panel').isVisible());assert.equal(await page.locator('.px-board').count(),0);
  await page.locator('#ox-crypto-tools-nav [data-crypto-tool="heatmap"]').click();await page.locator('.cfx-heatmap').waitFor();
  await page.locator('#ox-crypto-tools-nav [data-crypto-tool="patterns"]').click();await page.locator('.px-board').waitFor();
  // A full reload must recover the classified 15m index, even if candle transport is unavailable.
  blockCandles=true;await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'指標',exact:true}).click();await page.locator('.px-board').waitFor();
  await page.locator('[data-action="timeframes"]').click();await page.locator('.px-settings [data-frame="15m"]').click();await page.locator('.px-settings [data-frame="4H"]').click();await page.locator('.px-settings [data-frame="1H"]').click();await page.getByRole('button',{name:'關閉時間級別',exact:true}).click();
  await page.locator('[data-action="patterns"]').click();await page.locator('[data-preset="horizontal-resistance"]').click();await page.locator('.px-card').first().waitFor({timeout:4000});assert.ok(await page.locator('.px-card').count()>0,'persisted classification survives reload');console.log('PASS persisted classified index with candles transport blocked');
  await page.evaluate(()=>{document.body.dataset.market='tw';document.dispatchEvent(new CustomEvent('ox:marketchange'));});assert.equal(await page.locator('#ox-crypto-tools-nav').isVisible(),false);assert.equal(await page.locator('#ox-crypto-tools-inline .px-board').count(),0,'Crypto board is removed when switching to the independent TW board');
  const unexpected=errors.filter(e=>!e.includes('LightweightCharts is not defined'));assert.deepEqual(unexpected,[]);
  console.log('PASS: first tab, 51 presets, default 4H/1H, real recorded candles, OX, two columns, rank, freehand matching, pinch and market navigation cleanup');
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});

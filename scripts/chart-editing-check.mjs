// Exercise real chart coordinates and browser input, including iOS-style touch sequences.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..'),artifacts=resolve(root,'chart-check-artifacts');
await mkdir(artifacts,{recursive:true});
const market=process.env.OX_CHART_MARKET||'crypto',prefix=market==='crypto'?'ox-chart':'ox-tw-independent:tw-chart',period=market==='crypto'?'4H':'1D',symbol=market==='crypto'?'BTCUSDT':'2330';
const fixture=`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles/components/chart-drawings.css"><style>body{margin:0;background:#101216;color:#eee;font-family:system-ui}body.theme-light{background:#fff;color:#222}.chart-box{position:relative;margin:0;height:calc(100dvh - 10px)}.chart-controls{height:46px;display:flex;align-items:center;justify-content:center;gap:20px;font-size:13px}.chart-container{height:calc(100% - 46px);position:relative}canvas{touch-action:none}</style></head><body class="ox-terminal"><main id="view-radar"><div class="${market==='tw'?'tw-chart-radar':''}"><div class="chart-box"><div class="chart-controls">${market==='crypto'?'BTCUSDT':'2330 台積電'}　游標 · 趨勢線 · 圖形設定</div><div id="chart" class="chart-container"></div></div></div></main><script src="/src/vendor/lightweight-charts-4.2.3.js"></script><script src="/src/components/chart/gestures.js"></script><script>
window.fixtureMarket=${JSON.stringify(market)};window.fixturePrefix=${JSON.stringify(prefix)};window.fixtureSymbol=${JSON.stringify(symbol)};window.fixturePeriod=${JSON.stringify(period)};
window.state={symbol:fixtureSymbol,period:fixturePeriod,candleData:[],chart:null,candleSeries:null};
window.rows=Array.from({length:200},(_,i)=>({time:1790000000+i*14400,open:105+Math.sin(i/7)*6,high:115+Math.sin(i/7)*5,low:96+Math.sin(i/7)*5,close:106+Math.sin(i/7)*6}));
const element=document.getElementById('chart');state.chart=LightweightCharts.createChart(element,{autoSize:true,layout:{background:{color:'#101216'},textColor:'#aaa'},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{autoScale:true,scaleMargins:{top:.18,bottom:.18}},handleScroll:{pressedMouseMove:true,horzTouchDrag:false,vertTouchDrag:false},handleScale:{pinch:false,mouseWheel:true},timeScale:{timeVisible:true}});state.candleSeries=state.chart.addCandlestickSeries({upColor:'#00b8d4',downColor:'#ff3078',autoscaleInfoProvider:original=>state.chartPriceViewport?{...original(),priceRange:state.chartPriceViewport,margins:{above:0,below:0}}:original()});
window.setFrame=(p)=>{state.period=p;state.candleData=p===fixturePeriod?rows:rows.filter((_,i)=>i%5===0);state.candleSeries.setData(state.candleData);state.chart.timeScale().setVisibleLogicalRange({from:p===fixturePeriod?30:6,to:p===fixturePeriod?130:26});window.mount?.sync();document.dispatchEvent(new Event('ox:chartdata'));};setFrame(fixturePeriod);
OXChartGestures({container:element,state,formatPrice:String,getRange:()=>({minValue:state.candleSeries.coordinateToPrice(element.clientHeight-28),maxValue:state.candleSeries.coordinateToPrice(0)}),setRange:r=>{state.chartPriceViewport=r;state.candleSeries.applyOptions({});},refreshRange:()=>state.candleSeries.applyOptions({})});
window.legacy={type:'trend',a:{time:rows[60].time,price:103},b:{time:rows[95].time,price:108},color:'#f3f1e9',width:2};
if(!localStorage.getItem(fixturePrefix+'-drawings-v1'))localStorage.setItem(fixturePrefix+'-drawings-v1',JSON.stringify({[fixtureSymbol+':'+fixturePeriod]:[legacy]}));
window.fullscreenExited=false;document.addEventListener('keydown',e=>{if(e.key==='Escape')fullscreenExited=true;});
</script><script src="/src/components/chart/drawings.js"></script><script>if(fixtureMarket==='tw')window.mount=OXChartDrawings({box:document.querySelector('.chart-box'),chartEl:document.getElementById('chart'),state,market:'tw',isExpanded:()=>true});</script></body></html>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);return;}const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error('outside root');res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.css':'text/css'})[extname(file)]||'text/plain'});res.end(await readFile(file));}catch{res.writeHead(404);res.end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||undefined,args:['--no-sandbox']});
const report=[];
try{
 for(const [width,touch,theme] of [[1440,false,'dark'],[1440,false,'light'],[390,true,'dark'],[430,true,'light']]){
  const ctx=await browser.newContext({viewport:{width,height:850},hasTouch:touch,isMobile:touch,locale:'zh-TW'}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>{if(t==='light')document.addEventListener('DOMContentLoaded',()=>document.body.classList.add('theme-light'));},theme);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>document.querySelector('.chart-drawing-tools')&&JSON.parse(localStorage.getItem(fixturePrefix+'-drawings-v2'))?.symbols?.[fixtureSymbol]?.length===1);
  const data=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(fixturePrefix+'-drawings-v2')).symbols[fixtureSymbol]||[]);
  const point=async(d,which='mid')=>page.evaluate(({d,which})=>{const r=document.getElementById('chart').getBoundingClientRect(),ts=state.chart.timeScale(),s=state.candleSeries;const x=t=>{const i=state.candleData.findIndex(v=>v.time>=t);if(i<0)return ts.timeToCoordinate(t);if(state.candleData[i].time===t)return ts.logicalToCoordinate(i);const lo=state.candleData[i-1]?.time??state.candleData[i].time-14400;return ts.logicalToCoordinate(i-1+(t-lo)/(state.candleData[i].time-lo));};const a={x:x(d.a.time),y:s.priceToCoordinate(d.a.price)},b={x:x(d.b.time),y:s.priceToCoordinate(d.b.price)},p=which==='a'?a:which==='b'?b:{x:(a.x+b.x)/2,y:(a.y+b.y)/2};return{x:r.left+p.x,y:r.top+p.y};},{d,which});
  const tap=async p=>touch?page.touchscreen.tap(p.x,p.y):page.mouse.click(p.x,p.y);
  const cdp=touch?await ctx.newCDPSession(page):null;
  const drag=async(a,b)=>{if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y,id:1}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}};
  const initial=(await data())[0];assert.equal(initial.visibility,'all');assert.equal(initial.originPeriod,period);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(fixturePrefix+'-drawings-v1'))[fixtureSymbol+':'+fixturePeriod].length),1);
  let p=await point(initial);await tap(p);await page.locator('.chart-drawing-editor').waitFor({state:'visible'});
  assert.equal(await page.locator('.chart-drawing-tools').getAttribute('data-mode'),'cursor');
  const beforeRange=await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange());await drag(p,{x:p.x+25,y:p.y-24});
  let moved=(await data())[0];assert.notEqual(moved.a.price,initial.a.price);assert.notEqual(moved.a.time,initial.a.time);assert(Math.abs((moved.b.price-moved.a.price)-(initial.b.price-initial.a.price))<1e-8);
  assert.deepEqual(await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange()),beforeRange,'moving a drawing cannot pan the chart');
  await page.locator('.chart-drawing-tools [data-action="undo"]').click();assert.deepEqual((await data())[0].a,initial.a);
  await page.locator('.chart-drawing-tools [data-action="redo"]').click();moved=(await data())[0];p=await point(moved);await tap(p);
  const endpoint=await point(moved,'b');await drag(endpoint,{x:endpoint.x-14,y:endpoint.y+26});const resized=(await data())[0];assert.deepEqual(resized.a,moved.a);assert.notEqual(resized.b.price,moved.b.price);
  await page.locator('.drawing-color input').evaluate(el=>{el.value='#49a5ff';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal((await data())[0].color,'#49a5ff');
  await page.locator('.chart-drawing-editor [data-action="width"]').click();await page.locator('[data-width="4"]').click();assert.equal((await data())[0].width,4);
  await page.locator('.chart-drawing-editor [data-action="dash"]').click();assert.equal((await data())[0].dash,'dashed');
  await page.locator('.chart-drawing-editor [data-action="lock"]').click();const locked=(await data())[0];p=await point(locked);await drag(p,{x:p.x+12,y:p.y-30});assert.deepEqual((await data())[0],locked);
  await page.locator('.chart-drawing-editor [data-action="lock"]').click();
  if(touch){
   const prePinch=await data(),logical=await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange());
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:90,y:370,id:1},{x:230,y:400,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:55,y:355,id:1},{x:265,y:415,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:55,y:355,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:55,y:395,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.deepEqual(await data(),prePinch);assert((await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange())).to-(await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange())).from<logical.to-logical.from);
   await page.evaluate(()=>setFrame(fixturePeriod));
  }
  await page.locator('.chart-drawing-tools [data-action="cursor"]').click();
  // A second tap/click can edit an old line after changing candle aggregation.
  await page.evaluate(()=>setFrame('1W'));assert.equal((await data()).length,1);
  await page.evaluate(()=>setFrame(fixturePeriod));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));p=await point((await data())[0]);await tap(p);await page.locator('.chart-drawing-editor').waitFor({state:'visible'});
  await page.locator('.chart-drawing-editor [data-action="copy"]').click();assert.equal((await data()).length,2);
  await page.locator('.chart-drawing-editor [data-action="delete"]').click();assert.equal((await data()).length,1);
  await page.locator('.chart-drawing-tools [data-action="undo"]').click();assert.equal((await data()).length,2);
  await page.locator('.chart-drawing-tools [data-action="redo"]').click();assert.equal((await data()).length,1);
  await page.locator('.chart-drawing-tools [data-action="menu"]').click();await page.locator('[data-draw="trend"]').click();
  const rect=await page.locator('#chart').boundingBox(),start={x:rect.x+rect.width*.4,y:rect.y+rect.height*.38},end={x:rect.x+rect.width*.65,y:rect.y+rect.height*.6};
  await drag(start,end);assert.equal((await data()).length,2);assert.equal(await page.locator('.chart-drawing-tools').getAttribute('data-mode'),'cursor');
  await page.locator('.chart-drawing-tools [data-action="cursor"]').click();
  const navBefore=await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange());await drag({x:rect.x+rect.width*.55,y:rect.y+rect.height*.77},{x:rect.x+rect.width*.65,y:rect.y+rect.height*.77});assert.notDeepEqual(await page.evaluate(()=>state.chart.timeScale().getVisibleLogicalRange()),navBefore,'cursor mode must allow chart navigation');
  await page.evaluate(()=>setFrame(fixturePeriod));
  // Two-click trend creation is supported in addition to drag creation.
  await page.locator('.chart-drawing-tools [data-action="menu"]').click();await page.locator('[data-draw="trend"]').click();await tap(start);await tap(end);assert.equal((await data()).length,3);
  await page.locator('.chart-drawing-tools [data-action="menu"]').click();await page.locator('[data-draw="rectangle"]').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>fullscreenExited),false);assert.equal(await page.locator('.chart-drawing-tools').getAttribute('data-mode'),'cursor');
  const saved=await data();await page.reload();await page.waitForFunction(()=>document.querySelector('.chart-drawing-tools'));assert.deepEqual(await data(),saved,'all drawings survive reload without duplicated migration');
  p=await point((await data())[0]);await tap(p);await page.locator('.chart-drawing-editor [data-action="settings"]').click();await page.locator('[data-setting="a-price"]').fill('101.25');await page.locator('[data-setting="a-price"]').dispatchEvent('change');assert.equal((await data())[0].a.price,101.25);
  await page.screenshot({path:resolve(artifacts,`${market}-${width}-${theme}.png`)});
  assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  report.push({market,width,theme,touch,migration:true,selection:true,drag:true,endpoint:true,styles:true,lock:true,undoRedo:true,pinch:touch,autoExit:true,navigation:true,clickDrawing:true,reload:true,exactPrice:true,errors});console.log(JSON.stringify(report.at(-1)));await ctx.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));await import('node:fs/promises').then(fs=>fs.writeFile(resolve(artifacts,'results.json'),JSON.stringify(report,null,2)));}

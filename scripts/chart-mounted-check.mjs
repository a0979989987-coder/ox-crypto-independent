// Verify the drawing editor inside each complete app, with real chart/CSS assets.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'..'),market=process.env.OX_CHART_MARKET||'crypto';
const artifacts=resolve(root,'chart-check-artifacts');await mkdir(artifacts,{recursive:true});
const prefix=market==='tw'?'ox-tw-independent:tw-chart':'ox-chart',basePath=market==='tw'?'/ox-tw-independent':'';
let server,preparePage,snapshotEndpoint;
if(market==='crypto'){
 process.env.OX_E2E_PORT='4296';
 ({server,preparePage}=createRequire(import.meta.url)('./e2e-check.cjs'));
}else{
 ({snapshotEndpoint}=await import('../worker/snapshots.js'));
 const assets=resolve(root,'dist/client');
 server=createServer(async(req,res)=>{try{
  let path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(302,{Location:basePath+'/'});res.end();return;}
  if(path.startsWith(basePath+'/'))path=path.slice(basePath.length);
  const file=resolve(assets,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(assets+'/'))throw Error('outside assets');
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}});
}
await new Promise(r=>server.listen(4296,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||undefined,args:['--no-sandbox']});
const results=[];
try{
 for(const [width,touch,theme]of [[390,true,'dark'],[1440,false,'light']]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch,locale:'zh-TW'});
  const page=market==='crypto'?(await preparePage(context,{width,height:900})).page:await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({market,theme})=>{
   localStorage.setItem(market==='tw'?'ox-tw-independent-theme':'ox-ui-theme',theme);
   if(market==='tw')window.OX_TW_DATA_API_BASE=location.origin+'/api';
  },{market,theme});
  // Instrument the real vendor only to expose coordinates; its rendering/input remain intact.
  await page.route('**/lightweight-charts-4.2.3.js*',async route=>{
   const code=await readFile(resolve(root,'src/vendor/lightweight-charts-4.2.3.js'),'utf8');
   await route.fulfill({contentType:'text/javascript',body:code+`;(()=>{const real=LightweightCharts;window.LightweightCharts={...real,createChart(el,...args){const chart=real.createChart(el,...args),qa=el.__chartQA={chart,rows:[]},add=chart.addCandlestickSeries.bind(chart);chart.addCandlestickSeries=(...args)=>{const s=add(...args),set=s.setData.bind(s);qa.series=s;s.setData=rows=>{qa.rows=rows;return set(rows);};return s;};return chart;}};})();`});
  });
  if(market==='crypto'){
   const {FEATURE_CATALOG}=await import('../server/account/feature-catalog.js');
   await page.route('**/api/v1/account/**',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:id==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'chart-check'}))}:id==='session'?{ok:true,user:null}:{configured:false}});});
  }else{
   await page.route('**/api/v1/tw/**',async route=>{
    const url=new URL(route.request().url()),endpoint=url.pathname.split('/').at(-1);
    const data=await snapshotEndpoint(endpoint,url.searchParams,async path=>JSON.parse(await readFile(resolve(root,path),'utf8')));
    // The existing saved daily series supplies the chart; do not query upstream history in a UI check.
    await route.fulfill(data?{json:{ok:true,data}}:{status:503,json:{ok:false,error:{code:'TEST_UPSTREAM_OFFLINE'}}});
   });
  }
  try{
   await page.goto(`http://127.0.0.1:4296${basePath}/`,{waitUntil:'domcontentloaded'});
   const chart=market==='tw'?'#tw-radar-chart':'#chart',box=market==='tw'?'.twcr-chart-box':'#view-radar .chart-box';
   await page.waitForFunction(s=>document.querySelector(s)?.__chartQA?.rows.length>20,chart,{timeout:30000});
   await page.locator(market==='tw'?'.twcr-chart-box [data-action="focus"]':'#btn-chart-fullscreen').click();
   await page.waitForFunction(m=>document.body.classList.contains(m==='tw'?'tw-chart-focus':'chart-focus'),market);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const toolbar=page.locator(box+' .chart-drawing-tools');
   await toolbar.locator('[data-action="menu"]').click();await toolbar.locator('[data-draw="trend"]').click();
   const rect=await page.locator(chart).boundingBox();
   const a={x:rect.x+rect.width*.32,y:rect.y+rect.height*.32},b={x:rect.x+rect.width*.62,y:rect.y+rect.height*.62};
   const tap=p=>touch?page.touchscreen.tap(p.x,p.y):page.mouse.click(p.x,p.y);
   await tap(a);await tap(b);
   assert.equal(await toolbar.getAttribute('data-mode'),'cursor');
   const key=prefix+'-drawings-v2';
   let drawings=await page.evaluate(k=>Object.values(JSON.parse(localStorage.getItem(k)).symbols).flat(),key);assert.equal(drawings.length,1);
   await toolbar.locator('[data-action="cursor"]').click();
   const midpoint=async()=>page.evaluate(({chart,d})=>{
    const el=document.querySelector(chart),r=el.getBoundingClientRect(),{rows,series,chart:c}=el.__chartQA;
    const epoch=t=>typeof t==='number'?t:typeof t==='string'?Date.parse(t)/1000:Date.UTC(t.year,t.month-1,t.day)/1000;
    const x=t=>{let i=rows.findIndex(row=>epoch(row.time)>=t);if(i<0)i=rows.length-1;const hi=epoch(rows[i].time),lo=epoch(rows[Math.max(0,i-1)].time);return c.timeScale().logicalToCoordinate(hi===t?i:i-1+(t-lo)/(hi-lo));};
    return{x:r.x+(x(d.a.time)+x(d.b.time))/2,y:r.y+(series.priceToCoordinate(d.a.price)+series.priceToCoordinate(d.b.price))/2};
   },{chart,d:drawings[0]});
   let p=await midpoint();await tap(p);const editor=page.locator(box+' .chart-drawing-editor');await editor.waitFor({state:'visible'});
   // Mobile selection is followed by a separate drag; desktop can grab the line directly.
   const before=drawings[0],end={x:p.x+12,y:p.y-15};
   if(touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...end,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else{await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();}
   drawings=await page.evaluate(k=>Object.values(JSON.parse(localStorage.getItem(k)).symbols).flat(),key);assert.notEqual(drawings[0].a.price,before.a.price);
   if(!touch){
    const pixels=await page.locator(chart+' .chart-drawing-layer').evaluate(el=>el.toDataURL());
    const axis=await page.locator(chart).boundingBox();await page.mouse.move(axis.x+axis.width-8,axis.y+axis.height*.4);await page.mouse.down();await page.mouse.move(axis.x+axis.width-8,axis.y+axis.height*.52,{steps:8});await page.mouse.up();
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.notEqual(await page.locator(chart+' .chart-drawing-layer').evaluate(el=>el.toDataURL()),pixels,'drawing overlay must follow native price scale changes');
   }
   await editor.locator('[data-action="settings"]').click();const inspector=page.locator(box+' .drawing-tool-inspector');await inspector.waitFor({state:'visible'});
   const bounds=await inspector.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   const timeWidth=await inspector.locator('[data-setting="a-time"]').evaluate(el=>el.clientWidth);assert(timeWidth>200,'date and time field must be readable');
   assert.equal(await page.evaluate(()=>document.body.classList.contains('theme-light')),theme==='light');
   const text=await editor.evaluate(el=>getComputedStyle(el).color);assert.equal(text,theme==='light'?'rgb(38, 53, 68)':'rgb(238, 234, 226)');
   await page.screenshot({path:resolve(artifacts,`${market}-mounted-${width}-${theme}.png`)});
   await inspector.locator('[data-action="close"]').click();await toolbar.locator('[data-action="cursor"]').click();
   // One Escape exits focus after drawing/selection has already been cleared.
   await page.keyboard.press('Escape');await page.waitForFunction(m=>!document.body.classList.contains(m==='tw'?'tw-chart-focus':'chart-focus'),market);
   assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   results.push({market,width,theme,touch,actualApp:true,realChart:true,creation:true,selection:true,drag:true,settings:true,focusExit:true,errors});console.log(JSON.stringify(results.at(-1)));
  }catch(e){await page.screenshot({path:resolve(artifacts,`${market}-mounted-failure-${width}.png`)});console.error(await page.evaluate(()=>({errors:window.__oxRuntimeAudit?.duplicateListeners,classes:document.body.className,chart:document.querySelector('#tw-radar-chart,#chart')?.__chartQA?.rows.length,status:document.querySelector('.twcr-status')?.textContent})));throw e;}
  await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));await writeFile(resolve(artifacts,'mounted-results.json'),JSON.stringify(results,null,2));}

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {webkit,chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.OX_ETF_QA_OUT||'/tmp/ox-etf-loading';
const oldApi=execFileSync('git',['show','16a9b4a22a2a998239bb9aae70fa551bab40c109:src/markets/tw/etf/api.js'],{cwd:root,encoding:'utf8'});
const oldSavings=execFileSync('git',['show','16a9b4a22a2a998239bb9aae70fa551bab40c109:src/markets/tw/etf/savings.js'],{cwd:root,encoding:'utf8'});
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/tw-etf/catalog.json')));
const history=JSON.parse(fs.readFileSync(path.join(root,'data/tw-etf/history.json')));
const html=`<html><meta name="viewport" content="width=device-width"><body style="margin:0;background:#111416;color:#eee"><div id="host"></div><script type="module">
import {mountETF} from '/src/markets/tw/etf/view.js?v=20261002-etffast1';
import {mountSavings} from '/src/markets/tw/etf/savings.js?v=20261002-etffast1';
window.mount=kind=>{window.tool?.destroy();const host=document.querySelector('#host');host.replaceChildren();window.tool=kind==='etf'?mountETF(host):mountSavings(host);};</script></body></html>`;
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/__etf_test'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/json');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 fs.mkdirSync(out,{recursive:true});
 const browser=await(process.env.OX_ETF_ENGINE==='webkit'?webkit:chromium).launch({headless:true,...(process.env.OX_BROWSER_PATH?{executablePath:process.env.OX_BROWSER_PATH}:{})});
 const report=[];
 try{
  for(const baseline of [true,false])for(const width of baseline?[1366]:[375,1366]){
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let apiCalls=0,files=0,release;const gate=new Promise(r=>release=r);
   if(baseline){await page.route('**/etf/api.js*',r=>r.fulfill({contentType:'text/javascript',body:oldApi}));await page.route('**/etf/savings.js*',r=>r.fulfill({contentType:'text/javascript',body:oldSavings}));}
   await page.route('**/data/tw-etf/catalog.json*',async r=>{files++;await gate;await r.continue();});
   await page.route('**/api/v1/tw/etf?*',async r=>{apiCalls++;await new Promise(resolve=>setTimeout(resolve,2000));const q=new URL(r.request().url()).searchParams;await r.fulfill({json:{ok:true,data:q.get('action')==='history'?{rows:(q.get('symbols')||q.get('symbol')||'').split(',').map(s=>history.rows[s]||{symbol:s,unavailable:true})}:catalog}});});
   await page.goto(base+'/__etf_test');await page.waitForFunction(()=>window.mount);
   const started=Date.now();await page.evaluate(()=>window.mount('savings'));
   await page.getByRole('heading',{name:'退休生活規劃',exact:true}).waitFor({timeout:5000});
   const savingsMs=Date.now()-started;
   if(!baseline){assert(savingsMs<1500,'calculator must not wait for its catalog');await page.locator('input[name="age"]').fill('35');}
   release();
   const etfStart=Date.now();await page.evaluate(()=>window.mount('etf'));
   await page.locator(width<=760?'.fund-card [data-detail]':'.etf-table tbody tr [data-detail]').first().waitFor({timeout:5000});const etfMs=Date.now()-etfStart;
   if(!baseline){assert(etfMs<1500);assert.equal(apiCalls,0);assert.equal(files,1);}
   const returnStart=Date.now();await page.evaluate(()=>window.mount('savings'));
   await page.getByRole('heading',{name:'退休生活規劃',exact:true}).waitFor({timeout:5000});const returnMs=Date.now()-returnStart;
   if(!baseline){assert(returnMs<1000);assert.equal(apiCalls,0);assert.equal(files,1);}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
   await page.screenshot({path:path.join(out,`${baseline?'before':'after'}-${width}.png`)});
   report.push({baseline,width,savingsMs,etfMs,returnMs,apiCalls,catalogDownloads:files,errors});assert.deepEqual(errors,[]);await context.close();
  }
  // Keep a form mounted while the catalog finishes; its unsubmitted input
  // must survive the background load.
  const page=await browser.newPage();let release;const gate=new Promise(r=>release=r);
  await page.route('**/data/tw-etf/catalog.json*',async r=>{await gate;await r.continue();});
  await page.goto(base+'/__etf_test');await page.waitForFunction(()=>window.mount);await page.evaluate(()=>window.mount('savings'));
  await page.locator('input[name="age"]').fill('37');
  const received=page.waitForResponse(r=>r.url().includes('/data/tw-etf/catalog.json'));release();await received;
  await page.evaluate(async()=>{const {etfRequest}=await import('/src/markets/tw/etf/api.js?v=20261002-etffast1');await etfRequest('catalog');});
  assert.equal(await page.locator('input[name="age"]').inputValue(),'37');
  await page.getByRole('button',{name:'重新試算',exact:true}).click();
  assert.equal(await page.locator('input[name="age"]').inputValue(),'37');
  await page.getByRole('tab',{name:'相似度比較',exact:true}).click();await page.locator('.compare-summary').waitFor();
  assert(await page.locator('.overlap tbody tr').count()>0);await page.close();
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

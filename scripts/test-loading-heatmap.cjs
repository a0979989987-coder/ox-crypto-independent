const {chromium}=require('playwright'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{mkdirSync}=require('node:fs');
const root=require('node:path').join(__dirname,'..'),port=4186,base=`http://127.0.0.1:${port}`,out=process.env.OX_LOADING_SHOTS||'/tmp/ox-loading-heatmap';
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port',String(port)],{cwd:root});let browser;
(async()=>{
 await new Promise(r=>server.stdout.once('data',r));browser=await chromium.launch({executablePath:process.env.OX_BROWSER_PATH,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(base+'/__heat',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/src/components/loading-state.js"></script><style>body{margin:0;background:#101416;color:#eee}canvas{width:360px;height:500px;display:block;background:#101416;touch-action:none}</style><canvas></canvas>'}));
 await page.goto(base+'/__heat');
 await page.evaluate(async()=>{const {createToolChart}=await import('/src/markets/crypto/analytics/tools-charts.js?v=20261001-loading1');window.chart=createToolChart(document.querySelector('canvas'),{onSelect:s=>window.selected=s});chart.update({type:'heatmap',weight:'volume',grouped:false,rows:[{symbol:'BIG',base:'BIG',price:100,returnPct:1,volume:10000},{symbol:'MID',base:'MID',price:10,returnPct:-2,volume:2000},{symbol:'SMALL',base:'SMALL',price:1,returnPct:3,volume:400}]});});
 const canvas=page.locator('canvas');await page.waitForTimeout(100);await canvas.hover();await page.mouse.wheel(0,-900);await page.waitForTimeout(100);assert.ok(await canvas.evaluate(e=>Number(e.dataset.zoom)>1));
 const v=await page.evaluate(()=>chart.viewport());await page.mouse.move(180,250);await page.mouse.down();await page.mouse.move(225,290,{steps:10});await page.mouse.up();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.selected),undefined);assert.notDeepEqual(await page.evaluate(()=>chart.viewport()),v);
 await page.evaluate(()=>chart.reset());await page.waitForTimeout(650);await canvas.click({position:{x:150,y:100}});assert.equal(await page.evaluate(()=>window.selected),'BIG');await page.evaluate(()=>window.selected=undefined);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:200,id:1},{x:220,y:200,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:50,y:200,id:1},{x:280,y:200,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok(await canvas.evaluate(e=>Number(e.dataset.zoom)>1));assert.equal(await page.evaluate(()=>window.selected),undefined);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await canvas.evaluate((e,w)=>e.style.width=(w-20)+'px',width);await page.waitForTimeout(100);const view=await page.evaluate(()=>chart.viewport());assert.ok(Number.isFinite(view.x)&&Number.isFinite(view.y));}
 await page.evaluate(()=>chart.reset());await page.waitForTimeout(100);assert.equal(await canvas.getAttribute('data-zoom'),'1');
 await page.evaluate(()=>{window.loading=OXLoading.begin('crypto','載入標的',{done:2,total:30,target:document.body});});await page.locator('.ox-loading-count').filter({hasText:'2/30'}).waitFor();await page.evaluate(()=>loading.finish());await page.locator('.ox-region-loading').waitFor({state:'detached'});
 // Cold CSS must cloak the entire menu, including before its styles arrive.
 await page.route('**/radar-ui.css*',async r=>{await new Promise(resolve=>setTimeout(resolve,700));await r.continue();});
 await page.evaluate(async()=>{const {createToolsRail}=await import('/src/components/strength/tools-rail.js?v=20261001-loading1');window.rail=createToolsRail({tabs:[['a','工具 A'],['b','工具 B']],selected:'a',label:'測試工具',onSelect(){}});document.body.append(rail.element);});
 assert.equal(await page.locator('.tw-radar-root').isVisible(),false);assert.equal(await page.locator('.ox-style-loading .ox-loading-ring').count(),1);await page.locator('.tw-radar-root').waitFor({state:'visible'});
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/previews/crypto-flow.html');await page.locator('.cfx-heatmap').count();await page.locator('nav [data-tab="heatmap"]').click();await page.locator('.cfx-heatmap canvas').waitFor({state:'visible'});
 assert.deepEqual(await page.locator('nav [data-tab]').evaluateAll(es=>es.map(e=>e.dataset.tab)),['heatmap','rotation','flow']);
 await page.locator('[data-action="heat-in"]').click();await page.waitForTimeout(100);assert.ok(Number(await page.locator('.cfx-heatmap canvas').getAttribute('data-zoom'))>1);
 await page.locator('[data-action="heat-reset"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('.cfx-heatmap canvas').getAttribute('data-zoom'),'1');
 mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/mobile-heatmap.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: wheel/pinch heatmap zoom, drag without accidental selection, transformed hit testing, reset/resize, real loading counts and cold-style menu cloak.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});

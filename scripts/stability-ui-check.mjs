import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {chromium} from 'playwright';import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT='4291';const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(r=>server.listen(4291,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'/tmp/ox-chromium'});const report=[];
try{
 for(const theme of ['dark','light']){
 const context=await browser.newContext({locale:'zh-TW',viewport:{width:390,height:844}});const {page}=await preparePage(context,{width:390,height:844});let bundleRequests=0,nestedRequests=0,cssFailures=0,failCSS=true;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>{localStorage.setItem('ox-ui-theme',theme);},theme);
 await page.route('**/api/v1/account/**',async route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/feature-access')){await new Promise(r=>setTimeout(r,700));return route.fulfill({json:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}});}return route.fulfill({json:p.endsWith('/session')?{ok:true,user:null}:{configured:false}});});
 await page.route('**/generated/runtime.js*',route=>{bundleRequests++;return bundleRequests<=2?route.fulfill({status:503,contentType:'text/javascript',body:''}):route.continue();});
 await page.route(/\/(matcher|catalog|source)\.js/,route=>{nestedRequests++;return route.abort();});
 await page.route('**/control-menu-compact.css*',route=>{if(failCSS){cssFailures++;return route.fulfill({status:503,contentType:'text/css',body:''});}return route.continue();});
 await page.goto(testBase+'/?ox_feature=crypto.radar');await page.waitForFunction(()=>OXFeatures.ready);
 await page.locator('#ox-runtime-recovery button').waitFor();await page.evaluate(()=>switchAppView('strength'));await page.locator('#ox-runtime-recovery button').click();
 await page.locator('#ox-crypto-tools-inline .px-board').waitFor({timeout:20000});assert.equal(await page.evaluate(()=>document.body.dataset.view),'strength');assert.equal(bundleRequests,3);assert.equal(nestedRequests,0,'nested graph is in atomic runtime, no poisoned child URLs');
 await page.locator('#ox-dock-menu').click();await page.waitForFunction(()=>document.getElementById('ox-control-overlay').dataset.resourceState==='error');assert.equal(await page.locator('#ox-control-panel').isVisible(),false);assert.equal(await page.locator('#ox-control-resource-shell').isVisible(),true);
 failCSS=false;await page.locator('#ox-control-resource-shell').getByRole('button',{name:'重新連線'}).click();await page.waitForFunction(()=>!document.getElementById('ox-control-overlay').hasAttribute('data-resource-state'));assert.equal(await page.locator('#ox-control-panel').isVisible(),true);await page.locator('#ox-control-close').click();
 await page.evaluate(()=>{switchAppView('home');switchAppView('strength');switchAppView('radar');switchAppView('strength');});await page.locator('#ox-crypto-tools-inline .px-board').waitFor();assert.equal(await page.locator('#ox-crypto-tools-nav').count(),1);assert.equal(await page.locator('#ox-crypto-tools-inline .px-board').count(),1);
 await page.locator('#ox-crypto-tools-nav').locator('[data-crypto-tool="bubbles"]').click();await page.locator('#ox-crypto-tools-inline .oxb-stage').waitFor();await page.locator('#ox-crypto-tools-nav').locator('[data-crypto-tool="patterns"]').click();await page.locator('#ox-crypto-tools-inline .px-board').waitFor();
 assert.deepEqual(errors,[]);report.push({theme,width:390,bundleRequests,nestedRequests,cssFailures,originalToolPreserved:true,rapidReturn:true,errors});await context.close();
 }
 console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT=process.env.OX_ACCOUNT_ENTRY_TEST_PORT||'4255';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:844}}),{page}=await preparePage(context,{width,height:844});let requests=0;page.on('pageerror',e=>console.log('Synthetic page error: '+e.message));page.on('console',m=>{if(m.type()==='warning')console.log('Synthetic console: '+m.text().slice(0,350));});
  await page.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='config'?{configured:true}:endpoint==='session'?{ok:true,user:null}:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}});});
  await page.route('**/patterns/view.js*',route=>{requests++;return requests===1?route.fulfill({status:503,contentType:'text/javascript',body:''}):route.continue();});
  await page.goto(testBase+'/');await page.waitForFunction(()=>OXFeatures.ready);const started=Date.now();await page.evaluate(()=>switchAppView('strength'));
  try{await page.locator('#ox-crypto-tools-inline .px-board').waitFor({timeout:15000});}catch(e){console.log(await page.evaluate(()=>({body:document.body.dataset,tool:document.getElementById('ox-crypto-tools-inline')?.textContent,shadow:document.getElementById('ox-crypto-tools-inline')?.firstElementChild?.shadowRoot?.textContent.slice(-800)})));throw e;}
  assert.equal(requests,2);assert.equal(await page.locator('#ox-crypto-tools-inline .ox-tool-loading').isVisible(),false);
  console.log(JSON.stringify({width,recoveredWithoutClick:true,moduleRequests:requests,ms:Date.now()-started}));await context.close();
  const next=await browser.newContext({viewport:{width,height:844}}),late=(await preparePage(next,{width,height:844})).page;
  await late.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='config'?{configured:true}:endpoint==='session'?{ok:true,user:null}:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}});});
  await late.route('**/patterns/view.js*',async route=>{await new Promise(r=>setTimeout(r,700));const source=readFileSync(new URL('../src/markets/crypto/patterns/view.js',import.meta.url),'utf8').replace('export function mountPatternSearch(','function originalMountPatternSearch(');return route.fulfill({contentType:'text/javascript',body:source+'\nexport function mountPatternSearch(...args){window.syntheticMounts=(window.syntheticMounts||0)+1;return originalMountPatternSearch(...args);}'});});
  await late.goto(testBase+'/');await late.waitForFunction(()=>OXFeatures.ready);await late.evaluate(()=>{switchAppView('strength');switchAppView('home');});await late.waitForTimeout(1000);
  assert.equal(await late.evaluate(()=>window.syntheticMounts||0),0,'Late module must not initialize departed tool');
  await late.evaluate(()=>switchAppView('strength'));await late.locator('#ox-crypto-tools-inline .px-board').waitFor({timeout:15000});
  assert.equal(await late.evaluate(()=>window.syntheticMounts),1,'Return initializes exactly once');await next.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

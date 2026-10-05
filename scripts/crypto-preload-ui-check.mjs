import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT='4296';
const {server,preparePage,testBase,bitgetBody}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(4296,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'/tmp/ox-chromium',args:['--no-sandbox']});
try{
 for(const locked of [false,true]){
 const context=await browser.newContext({locale:'zh-TW',viewport:{width:390,height:844}}),{page,audit}=await preparePage(context,{width:390,height:844});
 let requests=0;
 await page.route('https://api.bitget.com/**',route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/candles'))requests++;return route.fulfill({json:{...bitgetBody(url),requestTime:Date.now()}});});
 await page.route('**/api/v1/account/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:endpoint==='feature-access'?{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:locked&&f.id==='crypto.patterns'?'login':'public',version:'fixture'}))}:endpoint==='session'?{ok:true,user:null}:{configured:false}});});
 await page.goto(testBase+'/?ox_feature=crypto.radar');await page.waitForFunction(()=>OXToolModules&&OXFeatures.ready);
 const board=()=>page.locator('#ox-crypto-tools-inline .px-board');
 assert.equal(await board().count(),0);
 if(!locked){
  await page.waitForFunction(async()=>{if(!(await indexedDB.databases()).some(db=>db.name==='ox-crypto-pattern-index'))return false;const db=await new Promise(resolve=>{const r=indexedDB.open('ox-crypto-pattern-index',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);});if(!db)return false;if(!db.objectStoreNames.contains('series')){db.close();return false;}return new Promise(resolve=>{const r=db.transaction('series').objectStore('series').count();r.onsuccess=()=>{db.close();resolve(r.result>=4);};});},{},{timeout:15000});
  const before=requests;await page.evaluate(()=>switchAppView('strength'));await board().waitFor();
  await page.locator('#ox-crypto-tools-inline .px-card').first().waitFor({timeout:10000});
  const icon=await page.locator('#ox-crypto-tools-inline .px-refresh-glyph svg').boundingBox(),pill=await page.locator('#ox-crypto-tools-inline .px-refresh-pill').boundingBox();
  assert(Math.abs(icon.x+icon.width/2-pill.x-pill.width/2)<1);assert(Math.abs(icon.y+icon.height/2-pill.y-pill.height/2)<1);
  await page.evaluate(()=>{switchAppView('radar');switchAppView('strength');switchAppView('radar');});await page.waitForTimeout(500);
  console.log(JSON.stringify({public:true,warmedBeforeOpening:true,cachedCards:true,centeredIcon:true,requestsBeforeOpening:before,errors:audit.pageErrors}));
 }else{
  await page.waitForTimeout(2300);await page.evaluate(()=>{globalThis.OXPublicFeed.cancel('radar-scan');});
  const preloadRequests=await page.evaluate(async()=>{let count=0;const original=globalThis.OXPublicFeed;globalThis.OXPublicFeed={...original,json:(url,options)=>{if(options?.owner==='patterns-preload')count++;return original.json(url,options);}};await OXToolModules['/src/markets/crypto/patterns/view.js'].preloadPatternSearch();globalThis.OXPublicFeed=original;return count;});assert.equal(preloadRequests,0,'Protected board cannot preload');
  console.log('Protected board did not preload');
 }
 assert.deepEqual(audit.pageErrors,[]);await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

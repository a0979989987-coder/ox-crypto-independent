import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT=process.env.OX_ACCOUNT_ENTRY_TEST_PORT||'4255';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const width of [390,1440])for(const market of ['tw','crypto']){
  const context=await browser.newContext({viewport:{width,height:844}}),{page}=await preparePage(context,{width,height:844});
  await page.route('**/api/v1/account/**',async route=>{
   const path=new URL(route.request().url()).pathname.split('/').at(-1);
   if(path==='feature-access')await new Promise(r=>setTimeout(r,700));
   return route.fulfill({json:path==='config'?{configured:true}:path==='session'?{ok:true,user:null}:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:'public',version:'fixture'}))}});
  });
  await page.goto(testBase+'/#news/'+market);await page.waitForFunction(()=>OXFeatures.ready);
  await page.locator('.oxn-title').filter({hasText:market==='tw'?'台股新聞':'加密新聞'}).waitFor({state:'attached',timeout:8000});
  assert.equal(await page.locator('.oxn-root').isVisible(),true,'News workspace visible');
  assert.equal(await page.evaluate(()=>document.body.dataset.market),market);
  assert.equal(new URL(page.url()).hash,'#news/'+market);
  await context.close();
 }
 console.log('Fresh full-index news hash market preserved on mobile/desktop with delayed policy. Synthetic API only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

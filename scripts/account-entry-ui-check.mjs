import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
process.env.OX_E2E_PORT=process.env.OX_ACCOUNT_ENTRY_TEST_PORT||'4255';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(Number(process.env.OX_E2E_PORT),'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:width<600?844:900}}),{page}=await preparePage(context,{width,height:width<600?844:900});
  let sessionStatus=200,sessionDelay=0,policyStatus=200,policyDelay=900,locked=false;
  await page.addInitScript(()=>{window.pendingGateFlashes=0;new MutationObserver(()=>{const panel=document.getElementById('ox-feature-gate');if(panel&&!panel.hidden&&getComputedStyle(panel).display!=='none'&&panel.textContent.includes('正在確認'))window.pendingGateFlashes++;}).observe(document,{subtree:true,childList:true,attributes:true});});
  await page.route('**/api/v1/account/**',async route=>{
   const path=new URL(route.request().url()).pathname.split('/').at(-1);
   assert.ok(['config','session','feature-access'].includes(path),'No login/email/private mutation in this check');
   if(path==='session'&&sessionDelay)await new Promise(r=>setTimeout(r,sessionDelay));
   if(path==='feature-access'&&policyDelay)await new Promise(r=>setTimeout(r,policyDelay));
   return route.fulfill({status:path==='session'?sessionStatus:path==='feature-access'?policyStatus:200,json:path==='config'?{configured:true}:path==='session'?{ok:true,user:null}:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:locked&&f.id==='crypto.radar'?'login':'public',version:'fixture'}))}});
  });
  await page.goto(testBase+'/?ox_feature=crypto.radar');
  await page.waitForFunction(()=>!OXFeatures.ready&&document.getElementById('ox-feature-progress'));
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('ox:viewchange')));
  assert.equal(await page.locator('#ox-feature-gate').isVisible(),false,'No loading error panel, even on early viewchange');
  assert.equal(await page.locator('main').isVisible(),false,'Unverified products stay hidden');
  assert.equal(await page.evaluate(()=>window.pendingGateFlashes),0,'No transient loading-card flash');
  await page.screenshot({path:new URL(`../../imports/account-pending-${width}.png`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:false});
  policyDelay=0;await page.waitForFunction(()=>OXFeatures.ready&&OXAuth.status.configured);
  const opener=page.locator('#ox-control-open,#ox-dock-menu').filter({visible:true}).first();await opener.click();await page.locator('#ox-control-account-open').click();
  await page.locator('#ox-account-overlay.is-open').waitFor();assert.equal(await page.locator('#ox-account-google').isVisible(),true);assert.equal(await page.locator('#ox-account-email').isVisible(),true);
  assert.equal(await page.locator('#ox-control-overlay').evaluate(e=>e.classList.contains('is-open')),false);
  assert.match(await page.locator('.ox-account-provider-note').innerText(),/連線設定已載入/);
  await page.locator('#ox-account-close').click();assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  for(const status of [401,503]){
   sessionStatus=status;sessionDelay=250;await page.evaluate(()=>{OXAuth.user={id:'synthetic-stale'};window.checkRefresh=OXFeatures.refresh();});
   await page.waitForTimeout(80);assert.equal(await page.locator('main').isVisible(),true,'Public policy survives slow userinfo');
   await page.evaluate(()=>window.checkRefresh);assert.equal(await page.locator('main').isVisible(),true,'Public policy survives userinfo error');
   assert.equal(await page.evaluate(()=>OXFeatures.ready),true);
  }
  sessionDelay=0;policyDelay=250;await page.evaluate(()=>{window.checkRefresh=OXFeatures.refresh();document.dispatchEvent(new CustomEvent('ox:viewchange'));});
  assert.equal(await page.locator('main').isVisible(),true,'Confirmed public policy remains visible during refresh');await page.evaluate(()=>window.checkRefresh);
  policyDelay=0;locked=true;await page.evaluate(()=>OXFeatures.refresh());assert.equal(await page.locator('main').isVisible(),false,'Stale session never unlocks login policy');
  locked=false;policyStatus=503;await page.evaluate(()=>OXFeatures.refresh());assert.equal(await page.locator('main').isVisible(),false,'Unavailable policy fails closed');
  policyStatus=200;await page.evaluate(()=>OXFeatures.refresh());assert.equal(await page.locator('main').isVisible(),true);
  await context.close();
 }
 console.log('Full-app mobile/desktop Account entry passed: real control-panel handlers open Google/Email dialog directly, configuration note is current, close restores focus. Synthetic provider/session only; no email or OAuth grant.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

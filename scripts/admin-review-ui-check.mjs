import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port=Number(process.env.OX_REVIEW_TEST_PORT||4201),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/admin-review-preview.mjs','--ordinary-fixture'],{cwd:new URL('..',import.meta.url),env:{...process.env,OX_REVIEW_PREVIEW_PORT:String(port)}});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',code=>reject(Error('Preview exited '+code)));server.stderr.once('data',error=>reject(Error(error.toString())));});
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#example').click();await page.locator('#parse').click();await page.locator('#status').filter({hasText:'SIGN_IN_REQUIRED'}).waitFor();
  await page.locator('[data-session="member"]').click();await page.locator('#parse').click();await page.locator('#status').filter({hasText:'ADMIN_REQUIRED'}).waitFor();
  await page.locator('[data-session="admin"]').click();await page.locator('#parse').click();await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('#rows tr').count(),3);assert.match(await page.locator('#status').innerText(),/已去除 1/);
  await page.locator('#review').click();assert.equal(await page.locator('#confirmation').isVisible(),false);
  const a=page.locator('[data-uid="9000000001"]'),b=page.locator('[data-uid="9000000002"]'),c=page.locator('[data-uid="9000000003"]');
  await a.locator('select').nth(0).selectOption({index:1});await a.locator('select').nth(1).selectOption('ordinary');
  await b.locator('select').nth(0).selectOption({index:2});await b.locator('select').nth(1).selectOption('core');await c.locator('input[type=checkbox]').check();
  await page.locator('#review').click();assert.equal(await page.locator('#confirm-rows tr').count(),2);assert.match(await page.locator('#confirm-rows').innerText(),/普通代理/);assert.match(await page.locator('#confirm-rows').innerText(),/核心代理/);
  if(process.env.OX_REVIEW_SCREENSHOT_DIR) await page.screenshot({path:process.env.OX_REVIEW_SCREENSHOT_DIR+'/admin-confirm-desktop.png'});
  await page.locator('#reason').fill('<img src=x onerror=alert(1)> Synthetic confirmation');await page.locator('#approve').click();await page.locator('#confirmation').waitFor({state:'hidden'});await page.locator('#approvals tr').nth(1).waitFor();
  assert.equal(await page.locator('#audit p').count(),2);assert.match(await page.locator('#approvals').innerText(),/人工審核通過/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile page must not overflow horizontally');
  const revoke=page.locator('#approvals tr').filter({hasText:'9000000001'});await revoke.locator('button').click();await page.locator('#revoke-reason').fill('Synthetic revocation');await page.locator('#revoke-confirm').click();await page.locator('#revoke-dialog').waitFor({state:'hidden'});await revoke.filter({hasText:'已撤銷'}).waitFor();assert.equal(await page.locator('#audit p').count(),3);
  assert.equal(await page.locator('#audit img').count(),0,'Audit reasons must remain escaped text');
  if(process.env.OX_REVIEW_SCREENSHOT_DIR) await page.screenshot({path:process.env.OX_REVIEW_SCREENSHOT_DIR+'/admin-audit-mobile.png'});
  // Delay lookup: editing input must invalidate the response and confirmation.
  let release,blocked,finished;const started=new Promise(r=>blocked=r);const gate=new Promise(r=>release=r),done=new Promise(r=>finished=r);
  await page.route('**/preview-api/lookup',async route=>{const response=await route.fetch();blocked();await gate;await route.fulfill({response});finished();});
  await page.locator('#parse').click();await started;await page.locator('#uids').fill('9000000003');release();await done;await page.unroute('**/preview-api/lookup');await page.waitForTimeout(150);
  assert.equal(await page.locator('#rows tr').count(),0);assert.equal(await page.locator('#review').isDisabled(),true);
  // Delay records: logout must not resurrect the prior admin's audit data.
  let releaseRecords,blockedRecords,finishedRecords;const recordsStarted=new Promise(r=>blockedRecords=r),recordsGate=new Promise(r=>releaseRecords=r),recordsDone=new Promise(r=>finishedRecords=r);
  await page.route('**/preview-api/records',async route=>{const response=await route.fetch();blockedRecords();await recordsGate;await route.fulfill({response});finishedRecords();});
  await page.locator('#refresh').click();await recordsStarted;await page.locator('[data-session="guest"]').click();await page.locator('#session-state').filter({hasText:'未登入'}).waitFor();releaseRecords();await recordsDone;await page.unroute('**/preview-api/records');await page.waitForTimeout(150);
  assert.equal(await page.locator('#approvals tr').count(),0);assert.equal(await page.locator('#audit p').count(),0);assert.deepEqual(errors,[]);
  // While login is in flight, new lookup/records requests must not use the old role.
  let finishLogin,loginBlocked,loginDone;const loginStart=new Promise(r=>loginBlocked=r),loginGate=new Promise(r=>finishLogin=r),loginFinish=new Promise(r=>loginDone=r);
  await page.route('**/preview-api/fixture-session',async route=>{loginBlocked();await loginGate;const response=await route.fetch();await route.fulfill({response});loginDone();});
  await page.locator('[data-session="member"]').click();await loginStart;
  assert.equal(await page.locator('#parse').isDisabled(),true);assert.equal(await page.locator('#refresh').isDisabled(),true);
  assert.equal(await page.locator('#feature-load').isDisabled(),true);assert.equal(await page.locator('#bitget-lookup').isDisabled(),true);
  let featureRequests=0;const countFeature=r=>{if(/preview-api\/(feature-admin|bitget-admin-lookup)/.test(r.url()))featureRequests++;};page.on('request',countFeature);
  await page.locator('#feature-load').evaluate(el=>el.onclick());await page.locator('#bitget-lookup').evaluate(el=>el.onclick());await page.waitForTimeout(100);assert.equal(featureRequests,0,'No requests under previous fixture role while session changes');page.off('request',countFeature);
  await page.locator('#parse').evaluate(el=>el.click());await page.locator('#refresh').evaluate(el=>el.click());assert.equal(await page.locator('#rows tr').count(),0);
  finishLogin();await loginFinish;await page.unroute('**/preview-api/fixture-session');await page.locator('#session-state').filter({hasText:'合成一般會員'}).waitFor();
  assert.equal(await page.locator('#rows tr').count(),0);assert.equal(await page.locator('#approvals tr').count(),0);
  console.log('Local synthetic admin UI passed: batch/dedup, login/admin guards, explicit member/level/exclusion confirmation, approve/audit/revoke, mobile overflow, stale lookup/records guards. No production connection.');
}finally{await browser?.close();server.kill();}

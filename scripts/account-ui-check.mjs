import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Isolated UI fixtures. No real provider, email, account, or signed-in browser.
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const markup = html.slice(html.indexOf('<div class="ox-account-overlay"'), html.indexOf('<main class="wrap"'));
const style = readFileSync(resolve(root, 'src/styles/account/account.css'), 'utf8');
const foundation = readFileSync(resolve(root, 'src/styles/core/foundation.css'), 'utf8');
const executablePath = process.env.OX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  const calls = [], errors = [];
  let admin = false, configured = true, user = null, link = null, linkRevision = null, linkAvailable = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://ox.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="UTF-8"><style>${foundation}\n${style}</style></head><body><small class="ox-account-provider-note">Legacy provider placeholder</small><button data-ox-account-open>登入 / 註冊</button>${markup}<script src="/auth.js"></script><script src="/session.js"></script><script src="/account.js"></script></body></html>` });
    if (['/auth.js', '/session.js', '/account.js'].includes(path)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(resolve(root, 'src/components/account', path.slice(1)), 'utf8') });
    const endpoint = path.split('/').at(-1);
    calls.push({ endpoint, method: request.method(), body: request.postDataJSON() });
    if (endpoint === 'admin-review') return route.fulfill({status:admin?200:403,contentType:'application/json',body:JSON.stringify(admin?{ok:true,administrator:true}:{ok:false,code:'ADMIN_REQUIRED'})});
    if (endpoint === 'bitget-link') {
      if (!linkAvailable) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'UID 連結儲存服務尚未就緒。' }) });
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        link = body.action === 'remove' ? null : { uid: body.uid, revision: '00000000-0000-4000-8000-000000000003', ownershipStatus: 'pending', ownershipVerified: false };
        linkRevision = link?.revision ?? '00000000-0000-4000-8000-000000000004';
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, link, revision: linkRevision, accessPolicyChanged: false }) });
    }
    const result = endpoint === 'config' ? { configured } : endpoint === 'session' ? { ok: true, user } : endpoint === 'email' ? { ok: true, message: '登入連結已寄出' } : endpoint === 'logout' ? { ok: true } : { ok: false, message: '服務暫時無法使用' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto('https://ox.test/');
  await page.locator('#ox-account-auth-status').filter({ hasText: '登入連結' }).waitFor({ state: 'attached' });
  assert.match(await page.locator('.ox-account-provider-note').innerText(),/連線設定已載入/);
  await page.locator('[data-ox-account-open]').click();
  await page.locator('#ox-account-tab-register').click();
  assert.equal(await page.locator('.ox-account-password-wrap').isVisible(), false);
  await page.locator('#ox-account-email').fill('fixture@example.com');
  await page.locator('#ox-account-email-submit').click();
  await page.locator('#ox-account-auth-status').filter({ hasText: '已寄出' }).waitFor();
  assert.equal(calls.find(call => call.endpoint === 'email').body.register, true);
  assert.equal(calls.find(call => call.endpoint === 'email').body.email, 'fixture@example.com');
  await page.locator('#ox-account-google').click();
  await page.locator('#ox-account-auth-status').filter({ hasText: '暫時無法使用' }).waitFor();
  assert.equal(await page.locator('#ox-account-google').isEnabled(), true);
  user = { id: 'fixture-member', email: 'fixture@example.com', displayName: '<img src=x onerror=alert(1)>', createdAt: '2026-09-30T00:00:00Z', methods: ['google'], accountStorage: 'stored' };
  await page.reload();
  await page.waitForFunction(() => window.OXAuth?.user?.id === 'fixture-member');
  await page.locator('[data-ox-account-open]').click();
  await page.locator('#ox-account-center').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#ox-account-center').isVisible(), true);
  assert.equal(await page.locator('#ox-account-profile img').count(), 0);
  assert.match(await page.locator('#ox-account-profile').innerText(), /會員資料已儲存/);
  await page.locator('#ox-bitget-link-save').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#ox-bitget-link-save').disabled);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.ox-account-shell').evaluate(el => { el.scrollTop = 0; });
    const entry = await page.locator('#ox-bitget-link-open').boundingBox();
    const shell = await page.locator('.ox-account-shell').boundingBox();
    assert.ok(entry.y >= shell.y && entry.y + entry.height <= shell.y + shell.height,
      `Bitget UID entry must be visible without scrolling at ${viewport.width}x${viewport.height}`);
    await page.locator('#ox-bitget-link-open').click();
    assert.equal(await page.locator('#ox-bitget-uid').evaluate(el => document.activeElement === el), true);
    const input = await page.locator('#ox-bitget-uid').boundingBox();
    assert.ok(input.y >= shell.y && input.y + input.height <= shell.y + shell.height,
      'UID entry must bring the input into the account viewport');
  }
  await page.locator('#ox-bitget-uid').fill('12345678901234567890');
  await page.locator('#ox-bitget-link-save').click();
  await page.locator('#ox-bitget-link-status').filter({ hasText: '持有權待驗證' }).waitFor();
  assert.equal(calls.filter(call => call.endpoint === 'bitget-link' && call.method === 'POST').at(-1).body.uid, '12345678901234567890');
  assert.match(await page.locator('#ox-bitget-link-summary').innerText(), /待驗證/);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('.ox-account-shell').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Mobile account shell must fit viewport');
  assert.equal(await page.locator('#ox-account-profile').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  if (process.env.OX_ACCOUNT_UI_SCREENSHOT) await page.screenshot({ path: process.env.OX_ACCOUNT_UI_SCREENSHOT });
  await page.locator('#ox-account-signout').click();
  await page.waitForFunction(() => window.OXAuth.user === null);
  assert.equal(await page.locator('#ox-bitget-uid').inputValue(), '');
  assert.equal(await page.locator('#ox-bitget-link-section').isVisible(), false);
  user = null;
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=provider_callback_error&ox_auth_provider=unexpected_failure');
  await page.waitForFunction(() => !location.search.includes('ox_auth'));
  await page.locator('#ox-account-google').waitFor({ state: 'visible' });
  assert.match(await page.locator('#ox-account-auth-status').innerText(), /provider_callback_error \/ unexpected_failure/);
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=provider_callback_error&ox_auth_provider=synthetic-private-detail');
  await page.waitForFunction(() => !location.search.includes('ox_auth') && document.querySelector('#ox-account-auth-status')?.textContent.includes('unclassified'));
  await page.locator('#ox-account-auth-status').filter({ hasText: 'unclassified' }).waitFor({ state: 'visible' });
  assert.match(await page.locator('#ox-account-auth-status').innerText(), /unclassified/);
  assert.doesNotMatch(await page.locator('#ox-account-auth-status').innerText(), /synthetic-private-detail/);
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=exchange_failed');
  await page.locator('#ox-account-overlay').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !location.search.includes('ox_auth'));
  assert.match(await page.locator('#ox-account-auth-status').innerText(), /exchange_failed/);
  assert.doesNotMatch(await page.locator('#ox-account-auth-status').innerText(), /同一個瀏覽器/);
  await page.locator('#ox-account-google').click();
  assert.equal(calls.filter(call => call.endpoint === 'google').at(-1).body.returnTo.includes('ox_auth'), false);
  user = { id: 'fixture-member', email: 'fixture@example.com', displayName: 'Fixture', createdAt: '2026-09-30T00:00:00Z', methods: ['google'], accountStorage: 'stored' };
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=flow_missing');
  await page.waitForFunction(() => window.OXAuth?.user?.id === 'fixture-member' && !location.search.includes('ox_auth'));
  assert.equal(await page.locator('#ox-account-overlay').isVisible(), false);
  await page.locator('[data-ox-account-open]').click();
  await page.waitForFunction(() => document.querySelector('#ox-bitget-uid')?.value === '12345678901234567890');
  await page.locator('#ox-bitget-link-remove').click();
  await page.locator('#ox-bitget-link-status').filter({ hasText: '尚未填寫 UID' }).waitFor();
  assert.equal(link, null);
  await page.locator('#ox-bitget-uid').fill('888');
  await page.locator('#ox-bitget-link-save').click();
  await page.locator('#ox-bitget-link-status').filter({ hasText: '持有權待驗證' }).waitFor();
  assert.equal(calls.filter(call => call.endpoint === 'bitget-link' && call.method === 'POST').at(-1).body.revision, '00000000-0000-4000-8000-000000000004');
  assert.equal(await page.locator('#ox-account-admin-open').isVisible(),false);
  admin = true; await page.reload(); await page.locator('[data-ox-account-open]').click();
  await page.locator('#ox-account-admin-open').waitFor({state:'visible'});
  admin = false; await page.reload(); await page.locator('[data-ox-account-open]').click();
  await page.waitForFunction(()=>window.OXAuth?.user?.id==='fixture-member');
  assert.equal(await page.locator('#ox-account-admin-open').isVisible(),false);
  // An in-flight old admin reply cannot restore the entry after logout.
  admin = true; const savedUser = user; let releaseAdmin,adminStarted,adminFinished;
  const adminStart=new Promise(r=>adminStarted=r),adminGate=new Promise(r=>releaseAdmin=r),adminDone=new Promise(r=>adminFinished=r);
  await page.route('**/api/v1/account/admin-review',async route=>{adminStarted();await adminGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,administrator:true})});adminFinished();});
  await page.reload();await adminStart;await page.evaluate(()=>window.OXAuth.signOut());releaseAdmin();await adminDone;
  await page.waitForFunction(()=>!window.OXAuth.user);assert.equal(await page.locator('#ox-account-admin-open').isVisible(),false);
  await page.unroute('**/api/v1/account/admin-review');admin=false;user=savedUser;
  await page.goto('https://ox.test/?ox_auth=success');
  await page.locator('#ox-account-center').waitFor({state:'visible'});
  assert.equal(await page.locator('#ox-account-overlay').isVisible(),true);
  assert.equal(await page.evaluate(()=>location.search.includes('ox_auth')),false);
  linkAvailable = false;
  await page.reload();
  await page.waitForFunction(() => window.OXAuth?.user?.id === 'fixture-member');
  await page.locator('[data-ox-account-open]').click();
  await page.locator('#ox-bitget-link-status').filter({ hasText: '尚未就緒' }).waitFor();
  assert.equal(await page.locator('#ox-bitget-link-save').isEnabled(), false);
  user = null;
  configured = false; calls.length = 0;
  await page.reload();
  await page.locator('#ox-account-auth-status').filter({ hasText: '尚未設定' }).waitFor({ state: 'attached' });
  assert.equal(calls.some(call => call.endpoint === 'session'), false);
  configured = true; user = null;
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=provider_denied&ox_auth_provider=access_denied');
  await page.locator('#ox-account-auth-status').filter({hasText:'登入連結或授權未完成'}).waitFor();
  assert.doesNotMatch(await page.locator('#ox-account-auth-status').innerText(),/Google 登入已取消/);
  await page.goto('https://ox.test/?ox_auth=error&ox_auth_reason=authorization_expired&ox_auth_provider=otp_expired');
  await page.locator('#ox-account-auth-status').filter({hasText:'登入驗證已失效'}).waitFor();
  await page.goto('https://ox.test/#error=access_denied&error_code=otp_expired&error_description=synthetic-private-error');
  await page.reload();
  await page.locator('#ox-account-auth-status').filter({hasText:'登入驗證已失效'}).waitFor();
  assert.doesNotMatch(await page.locator('#ox-account-auth-status').innerText(), /Google|synthetic-private-error/);
  assert.equal(await page.evaluate(()=>location.hash), '');
  assert.equal(await page.evaluate(()=>window.OXAuth.user), null);
  assert.deepEqual(errors, []);
  console.log('Account UI passed: Magic Link registration, Google failure recovery, member profile escaping/storage status, mobile viewport, logout, unconfigured guest mode. Synthetic fixtures only.');
} finally { await browser.close(); }

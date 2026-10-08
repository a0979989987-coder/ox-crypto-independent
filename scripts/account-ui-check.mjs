import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

// Isolated UI fixtures. No real provider, email, account, or signed-in browser.
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const markup = html.slice(html.indexOf('<div class="ox-account-overlay"'), html.indexOf('<main class="wrap"'));
// Use the app's complete CSS cascade, including theme and shared close controls.
const cssLinks = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]);
const cssFiles = new Map(cssLinks.map(href => {
  const path = new URL(href, 'https://ox.test/').pathname;
  return [path, readFileSync(resolve(root, path.slice(1)), 'utf8')];
}));
const cssHead = cssLinks.map(href => `<link rel="stylesheet" href="${href}">`).join('');
const executablePath = process.env.OX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
const engine=process.env.OX_UI_BROWSER==='webkit'?webkit:chromium;
const browser = await engine.launch({ headless: true, ...(engine===chromium&&executablePath ? { executablePath } : {}) });
async function verifyLoginLayout(page){
  mkdirSync(resolve(root,'docs/performance'),{recursive:true});
  await page.locator('#ox-account-auth-view').waitFor({state:'visible'});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#ox-account-overlay')).opacity==='1'&&getComputedStyle(document.querySelector('.ox-account-shell')).opacity==='1');
  for(const viewport of [{width:320,height:740},{width:390,height:844},{width:430,height:932},{width:390,height:350},{width:320,height:240},{width:844,height:240},{width:844,height:390},{width:1440,height:900}]){
    await page.setViewportSize(viewport);
    await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height&&Math.abs(parseFloat(document.querySelector('#ox-account-overlay').style.getPropertyValue('--ox-account-viewport-height'))-(window.visualViewport?.height||innerHeight))<1,viewport);
    for(const theme of ['dark','light']){
      await page.evaluate(t=>document.body.classList.toggle('theme-light',t==='light'),theme);
      const g=await page.locator('#ox-account-auth-view').evaluate(el=>{
        const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
        const form=el.querySelector('form'),row=el.querySelector('.ox-account-actions'),input=el.querySelector('input'),shell=el.closest('.ox-account-shell'),button=el.querySelector('#ox-account-email-submit');
        const controls=[...row.querySelectorAll('button')].map(e=>{const s=getComputedStyle(e);return {...box(e),text:e.textContent.trim(),overflow:e.scrollWidth-e.clientWidth,border:s.borderTopWidth,background:s.backgroundColor,font:s.fontSize,weight:s.fontWeight};});
        return {form:box(form),row:box(row),input:box(input),send:box(button),shell:box(shell),close:box(shell.querySelector('.ox-account-close')),cardBorder:getComputedStyle(el).borderTopWidth,inputSize:parseFloat(getComputedStyle(input).fontSize),controls,dividers:row.querySelectorAll('.ox-account-action-divider').length,overflow:document.documentElement.scrollWidth-innerWidth,card:box(el),viewport:{w:innerWidth,h:innerHeight},status:el.querySelector('[role=status]').hidden};
      });
      assert.ok(g.shell.x>=0&&g.shell.x+g.shell.w<=viewport.width+1&&g.shell.y>=0&&g.shell.y+g.shell.h<=viewport.height+1,`login fits ${JSON.stringify({viewport,shell:g.shell})}`);
      if(viewport.width===320||viewport.width===390||viewport.width===1440)await page.screenshot({path:resolve(root,`docs/performance/login-${engine===webkit?'webkit':'chromium'}-${viewport.width}-${viewport.height}-${theme}.png`)});
      assert.equal(g.cardBorder,'0px');assert.ok(g.inputSize>=16);assert.ok(g.overflow<=1);
      assert.ok(Math.abs(g.form.x-g.row.x)<1&&Math.abs(g.form.w-g.row.w)<1,'both rows align');
      assert.ok(Math.abs(g.card.cx-g.shell.cx)<1,'email and actions stay horizontally centered');
      if(viewport.height>300)assert.ok(Math.abs(g.card.cy-g.shell.cy)<5,'email and actions form a centered group');
      else assert.ok(g.form.y>=g.close.y+g.close.h+3&&g.row.y+g.row.h<=viewport.height-8,'short keyboard viewport keeps the input, actions and close separate');
      assert.equal(g.dividers,2);assert.equal(g.status,true);
      assert.deepEqual(g.controls.map(e=>e.text),['Google 登入','建立帳號','使用基礎版']);
      for(const c of g.controls){assert.ok(c.h>=44&&c.overflow<=1,'complete text within a transparent touch target');assert.equal(c.border,'0px');assert.equal(c.background,'rgba(0, 0, 0, 0)');assert.equal(c.weight,'400');assert.ok(Math.abs(c.cy-g.row.cy)<1);}
      assert.equal(new Set(g.controls.map(c=>c.font)).size,1);
      assert.ok(g.close.h>=44&&g.close.y>=g.shell.y&&g.close.y+g.close.h<=g.shell.y+g.shell.h,'close remains reachable with keyboard height');
      assert.ok(g.send.h>=44&&Math.abs(g.send.cy-g.form.cy)<1&&g.input.w>=90);
      const label=page.locator(viewport.width<=760?'.ox-account-send-mobile':'.ox-account-send-desktop');
      await label.waitFor({state:'visible'});
      if(!await label.isVisible()){
        await page.screenshot({path:resolve(root,`docs/performance/login-${engine===webkit?'webkit':'chromium'}-${viewport.width}-${theme}-failure.png`)});
        console.log('Login label diagnostics',JSON.stringify({viewport,theme,g,labels:await page.locator('#ox-account-email-submit').evaluate(el=>({cooldown:el.dataset.cooldown,html:el.innerHTML,children:[...el.children].map(e=>({tag:e.tagName,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}))}));
      }
      assert.equal(await label.isVisible(),true,`send label visible at ${viewport.width}x${viewport.height} (${theme})`);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>innerWidth===390&&innerHeight===844&&Math.abs(parseFloat(document.querySelector('#ox-account-overlay').style.getPropertyValue('--ox-account-viewport-height'))-(window.visualViewport?.height||innerHeight))<1);
  await page.evaluate(()=>document.body.classList.remove('theme-light'));
}
try {
  const page = await browser.newPage();
  const calls = [], errors = [];
  let admin = false, configured = true, user = null, link = null, linkRevision = null, linkAvailable = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://ox.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${cssHead}</head><body class="ox-terminal"><small class="ox-account-provider-note">Legacy provider placeholder</small><button data-ox-account-open>登入 / 註冊</button>${markup}<script src="/auth.js"></script><script src="/session.js"></script><script src="/account.js"></script></body></html>` });
    if (cssFiles.has(path)) return route.fulfill({contentType:'text/css',body:cssFiles.get(path)});
    if (['/auth.js', '/session.js', '/account.js'].includes(path)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(resolve(root, 'src/components/account', path.slice(1)), 'utf8') });
    if (path === '/assets/account-orbit.svg') return route.fulfill({contentType:'image/svg+xml',body:readFileSync(resolve(root,'assets/account-orbit.svg'),'utf8')});
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
  await page.waitForFunction(() => window.OXAuth?.status.configured);
  assert.match(await page.locator('.ox-account-provider-note').innerText(),/連線設定已載入/);
  await page.locator('[data-ox-account-open]').click();
  await verifyLoginLayout(page);
  const before=await page.locator('#ox-account-email-form').boundingBox();
  await page.locator('#ox-account-email-submit').click();
  await page.locator('#ox-account-auth-status').filter({hasText:'請輸入電子郵件'}).waitFor();
  assert.equal(calls.some(c=>c.endpoint==='email'),false,'invalid input never sends an email');
  await page.locator('#ox-account-email').fill('invalid');await page.locator('#ox-account-email-submit').click();
  await page.locator('#ox-account-auth-status').filter({hasText:'有效的電子郵件'}).waitFor();
  assert.deepEqual(await page.locator('#ox-account-email-form').boundingBox(),before,'feedback does not move the input');
  await page.locator('#ox-account-skip').click();assert.equal(await page.locator('#ox-account-overlay').getAttribute('aria-hidden'),'true');
  await page.locator('[data-ox-account-open]').click();await page.locator('#ox-account-close').click();
  assert.equal(await page.locator('[data-ox-account-open]').evaluate(e=>document.activeElement===e),true);
  await page.locator('[data-ox-account-open]').click();await page.locator('#ox-account-close').focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#ox-account-skip').evaluate(e=>document.activeElement===e),true,'focus stays in the dialog');
  await page.locator('#ox-account-tab-register').click();
  assert.equal(await page.locator('.ox-account-password-wrap').count(), 0);
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
  // No account surface may recreate an admin entry, even for an administrator.
  for (const administrator of [false, true, false]) {
    admin = administrator;
    await page.reload();
    await page.waitForFunction(() => window.OXAuth?.user?.id === 'fixture-member');
    await page.locator('[data-ox-account-open]').click();
    await page.locator('#ox-bitget-link-open').click();
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.dispatchEvent(new CustomEvent('ox:accountchange', {detail: {user: window.OXAuth.user}}));
    });
    assert.equal(await page.locator('#ox-account-admin-open').count(), 0);
    assert.equal(await page.getByText('代理審核後台', {exact: true}).count(), 0);
  }
  assert.equal(calls.filter(call => call.endpoint === 'admin-review').length, 0);
  await page.evaluate(() => window.OXAuth.signOut());
  await page.waitForFunction(() => !window.OXAuth.user);
  assert.equal(await page.locator('#ox-account-admin-open').count(), 0);
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
  await page.locator('.ox-account-provider-note').filter({hasText:'尚未完成'}).waitFor();
  assert.equal(await page.locator('#ox-account-auth-status').textContent(),'');
  assert.equal(await page.locator('#ox-account-auth-status').isVisible(),false);
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

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { cookie, cookieName, seal, unseal } from '../server/account/cookies.js';

// Separate synthetic browser; never uses the user's browser or real providers.
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const secret = 'synthetic-browser-cookie-secret-32-chars';
  let callbackReceived = false;
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'ox.example' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', headers: { 'set-cookie': cookie('flow', seal({ marker: 'fixture' }, secret, 'flow', 600), 600) }, body: '<a href="https://accounts.synthetic.test/consent">Continue</a>' });
    if (url.hostname === 'accounts.synthetic.test') return route.fulfill({ contentType: 'text/html', body: '<a href="https://mock.supabase.co/callback">Consent</a>' });
    if (url.hostname === 'mock.supabase.co') return route.fulfill({ contentType: 'text/html', body: '<a href="https://ox.example/api/v1/account/callback?code=synthetic">Return</a>' });
    if (url.pathname === '/api/v1/account/callback') {
      const headers = await route.request().allHeaders();
      const value = (headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName('flow') + '='))?.slice(cookieName('flow').length + 1);
      assert.equal(unseal(value, secret, 'flow')?.marker, 'fixture');
      callbackReceived = true;
      return route.fulfill({ contentType: 'text/html', body: 'Synthetic callback complete' });
    }
    return route.abort();
  });
  await page.goto('https://ox.example/');
  const stored = (await context.cookies()).find(x => x.name === cookieName('flow'));
  assert.equal(stored.secure, true); assert.equal(stored.httpOnly, true); assert.equal(stored.sameSite, 'Lax'); assert.equal(stored.domain, 'ox.example');
  await page.locator('a').click();
  await page.waitForURL('https://accounts.synthetic.test/consent');
  await page.locator('a').click();
  await page.waitForURL('https://mock.supabase.co/callback');
  await page.locator('a').click();
  await page.waitForURL('https://ox.example/api/v1/account/callback?code=synthetic');
  assert.equal(callbackReceived, true);
  console.log('Synthetic same-browser cross-site top-level navigation preserves encrypted Secure/HttpOnly/SameSite=Lax flow cookie. No live provider redirect/login tested.');
} finally { await browser.close(); }

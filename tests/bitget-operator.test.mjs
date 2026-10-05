import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHandler } from '../server/integrations/bitget/operator-handler.js';
import { renderOperatorPage } from '../server/integrations/bitget/operator-page.js';

const token = 'synthetic-test-only-operator-password-00000';
const origin = 'https://ox.example';
const headers = { host: 'ox.example', origin, 'content-type': 'application/x-www-form-urlencoded' };
function invoke(handler, body, cookie, extra = {}) {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, send(body) { this.body = body; }, end() {} };
  return Promise.resolve(handler({ method: 'POST', headers: { ...headers, ...(cookie ? { cookie } : {}), ...extra }, body }, res)).then(() => res);
}
async function challenge(handler) {
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, send(body) { this.body = body; }, end() {} };
  await handler({ method: 'GET', headers: { host: 'ox.example' } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.match(/name="challenge" value="([^"]+)"/)[1];
}
function setup() {
  let time = 1800000000000, calls = 0;
  const handler = createTestHandler({ env: { OX_ACCOUNT_LOOKUP_TOKEN: token }, now: () => time, limit: () => true, createClient: () => ({ lookupCustomer: async () => { calls++; throw new Error('SECRET-UPSTREAM-DETAIL'); } }) });
  return { handler, calls: () => calls, expire: () => { time += 600001; } };
}
async function login(handler) {
  const res = await invoke(handler, { action: 'login', password: token, challenge: await challenge(handler) });
  assert.equal(res.statusCode, 303);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  const payload = cookie.split('=')[1].split('.')[0];
  return { res, cookie, csrf: JSON.parse(Buffer.from(payload, 'base64url')).nonce };
}
test('login creates a short-lived secure scoped cookie without echoing the operator secret', async () => {
  const { handler } = setup();
  const { res } = await login(handler);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict; Max-Age=600/);
  assert.match(res.headers['Set-Cookie'], /Path=\/api\/v1\/account\/bitget-status;/);
  assert.equal(JSON.stringify(res).includes(token), false);
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/);
});
test('missing, wrong or expired credentials and forged cookies never call Bitget', async () => {
  const env = setup();
  assert.equal((await invoke(env.handler, { action: 'login', password: 'wrong', challenge: await challenge(env.handler) })).statusCode, 401);
  assert.equal((await invoke(env.handler, { action: 'lookup', uid: '123' })).statusCode, 401);
  const { cookie, csrf } = await login(env.handler);
  assert.equal((await invoke(env.handler, { action: 'lookup', uid: '123', csrf }, cookie + 'x')).statusCode, 401);
  env.expire();
  assert.equal((await invoke(env.handler, { action: 'lookup', uid: '123', csrf }, cookie)).statusCode, 401);
  assert.equal(env.calls(), 0);
});
test('signed login challenge, missing CSRF and duplicate fields fail closed', async () => {
  const env = setup();
  const { cookie, csrf } = await login(env.handler);
  assert.equal((await invoke(env.handler, { action: 'login', password: token })).statusCode, 403);
  assert.equal((await invoke(env.handler, { action: 'login', password: token, challenge: 'forged.challenge' })).statusCode, 403);
  assert.equal((await invoke(env.handler, { action: 'login', password: 'wrong', challenge: await challenge(env.handler) }, null, { origin: 'https://embedded-browser.example' })).statusCode, 401);
  assert.equal((await invoke(env.handler, { action: 'lookup', uid: '123' }, cookie)).statusCode, 403);
  assert.equal((await invoke(env.handler, 'action=lookup&uid=123&uid=456&csrf=' + csrf, cookie)).statusCode, 400);
  assert.equal(env.calls(), 0);
});
test('authorized lookup reaches adapter once and shields unexpected errors', async () => {
  const env = setup();
  const { cookie, csrf } = await login(env.handler);
  const res = await invoke(env.handler, { action: 'lookup', uid: '123', csrf }, cookie);
  assert.equal(env.calls(), 1);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.includes('SECRET-UPSTREAM-DETAIL'), false);
  const logout = await invoke(env.handler, { action: 'logout', csrf }, cookie);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
});
test('operator page escapes results and distinguishes missing records from failed KYC', () => {
  const html = renderOperatorPage({ session: { nonce: 'test' }, uid: '<img src=x>', result: { uid: '<script>alert(1)</script>', referral: { status: 'not_found' }, registration: {}, certification: { status: 'unknown' } } });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /目前無法確認/);
  assert.match(html, /沒有紀錄不等於未通過/);
});
test('successful operator query shows the adapter result without exposing credentials', async () => {
  const handler = createTestHandler({ env: { OX_ACCOUNT_LOOKUP_TOKEN: token }, limit: () => true, createClient: () => ({ lookupCustomer: async ({ uid }) => ({ uid, referral: { status: 'matched' }, registration: { registeredAt: '2026-09-01T12:00:00Z' }, certification: { status: 'passed' } }) }) });
  const { cookie, csrf } = await login(handler);
  const res = await invoke(handler, { action: 'lookup', uid: '123456', csrf }, cookie);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /已找到直客關係/);
  assert.match(res.body, /認證已通過/);
  assert.equal(res.body.includes(token), false);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
});
test('disabled configuration and exhausted burst limits stop before adapter use', async () => {
  const disabled = createTestHandler({ env: {} });
  assert.equal((await invoke(disabled, {})).statusCode, 503);
  const limited = createTestHandler({ env: { OX_ACCOUNT_LOOKUP_TOKEN: token }, limit: () => false });
  const res = await invoke(limited, { action: 'login', password: token, challenge: await challenge(limited) });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '60');
});

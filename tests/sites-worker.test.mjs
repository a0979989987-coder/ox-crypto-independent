import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
import { localD1 } from '../scripts/local-d1.mjs';
import { platformHeaders, isWorkerOnly, fakeGoogle } from '../scripts/sites-platform.mjs';
import { validCatalog } from '../server/account/feature-catalog.js';

const ORIGIN = 'https://crypto.oxpattern.com', OWNER = 'a0979989987@gmail.com';
const root = new URL('../', import.meta.url);
const ASSETS = { async fetch(request) { const path = new URL(request.url).pathname.replace(/^\/_seed\//, '/'); try { return new Response(await readFile(new URL('.' + decodeURIComponent(path), root))); } catch { return new Response('missing', { status: 404 }); } } };
const env = (extra = {}) => ({ DB: localD1(':memory:'), ASSETS, ...extra });
let ip = 0;
const call = (e, path, { method = 'GET', headers = {}, body } = {}) => worker.fetch(new Request(ORIGIN + path, { method, headers: { 'cf-connecting-ip': '100.64.0.' + (++ip % 250), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), e, {});

test('the old account front end gets an all-public tool list and a not-configured login, nothing else', async () => {
  const e = env();
  const policy = await (await call(e, '/api/v1/account/feature-access')).json();
  assert.ok(validCatalog(policy.features), 'the shape the old page requires');
  assert.ok(policy.features.every(f => f.mode === 'public'));
  assert.deepEqual(await (await call(e, '/api/v1/account/config')).json(), { configured: false, providerConnectionVerified: false, databaseConnected: false });
  for (const path of ['session', 'google', 'email', 'bitget-link', 'admin-review', 'feature-admin', 'bitget-admin-lookup']) {
    const response = await call(e, '/api/v1/account/' + path, { method: path === 'session' ? 'GET' : 'POST', body: path === 'session' ? undefined : {}, headers: { Origin: ORIGIN } });
    assert.equal(response.status, 404, path);
  }
  assert.equal((await call(e, '/api/v1/unknown')).status, 404);
});

test('only this site\'s own pages may call its API: a cross-site Origin gets 403 before anything runs', async () => {
  const e = env();
  const evil = { Origin: 'https://evil.example' };
  for (const [path, method, body] of [['/api/v1/app/track', 'POST', { device: 'device-evil-0001', events: [{ name: 'app.open' }] }], ['/api/v1/app/feedback', 'POST', { text: 'spam spam' }], ['/api/v1/app/config', 'GET'],
    ['/api/v1/auth/me', 'GET'], ['/api/v1/auth/logout', 'POST', {}], ['/api/v1/me/data', 'POST', { key: 'watchlist', value: [] }], ['/api/v1/me/bitget', 'POST', { uid: '1234567890' }],
    ['/api/v1/admin/flags', 'POST', { key: 'maintenance', on: true }]]) {
    const response = await call(e, path, { method, body, headers: { ...evil, 'oai-authenticated-user-email': OWNER } });
    assert.equal(response.status, 403, path); assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal((await call(e, '/api/v1/app/feedback', { method: 'POST', body: { text: 'hello there' }, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await call(e, '/api/v1/admin/flags')).status, 401, 'nothing was switched on');
  assert.equal((await call(e, '/api/v1/app/feedback', { method: 'POST', body: { text: 'same site' }, headers: { Origin: ORIGIN } })).status, 200);
  const chatgptSite = await worker.fetch(new Request('https://ox-crypto.example.chatgpt.site/api/v1/app/config', { headers: { Origin: 'https://ox-crypto.example.chatgpt.site' } }), e, {});
  assert.equal(chatgptSite.status, 200, 'the Site\'s own chatgpt.site address works too');
});

test('a visitor cannot sign in as the owner by sending the platform header themselves', async () => {
  const e = env();
  // What Sites (and the local dev server) does with incoming headers before the Worker sees them.
  const spoofed = platformHeaders({ 'oai-authenticated-user-email': OWNER, 'OAI-Authenticated-User-Name': 'x', cookie: 'a=b', 'content-type': 'application/json' });
  assert.equal(spoofed.get('oai-authenticated-user-email'), null); assert.equal(spoofed.get('oai-authenticated-user-name'), null); assert.equal(spoofed.get('cookie'), 'a=b');
  const asVisitor = await worker.fetch(new Request(ORIGIN + '/api/v1/admin/overview', { headers: spoofed }), e, {});
  assert.equal(asVisitor.status, 401);
  const owner = platformHeaders({ 'oai-authenticated-user-email': 'someone@example.com' }, { devAdmin: OWNER });
  assert.equal(owner.get('oai-authenticated-user-email'), OWNER, 'only the platform (OX_DEV_ADMIN locally) sets it');
  assert.equal((await worker.fetch(new Request(ORIGIN + '/api/v1/admin/overview', { headers: owner }), e, {})).status, 200);
  assert.equal((await call(e, '/api/v1/admin/overview', { headers: { 'oai-authenticated-user-email': 'someone@example.com' } })).status, 403);
  assert.ok(isWorkerOnly('/data/news.json') && isWorkerOnly('/previews/data/crypto-flow-history.json') && isWorkerOnly('/api/v1/app/config') && !isWorkerOnly('/src/app/usage.js'));
});

test('/admin, /privacy and /terms are pages; the admin page cannot be framed; a mistyped address gets a page, not a file', async () => {
  const e = env();
  const adminPage = await call(e, '/admin');
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /OX 加密後台/);
  assert.equal(adminPage.headers.get('X-Frame-Options'), 'DENY');
  assert.match(adminPage.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(adminPage.headers.get('Cache-Control'), 'no-store');
  assert.match(await (await call(e, '/privacy')).text(), /隱私權政策/);
  assert.match(await (await call(e, '/terms')).text(), /不構成任何投資建議/);
  const typo = await call(e, '/admin%EF%BC%8C%E7%94%A8');
  assert.equal(typo.status, 302); assert.equal(typo.headers.get('location'), ORIGIN + '/admin');
  const missing = await call(e, '/no-such-page');
  assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /text\/html/); assert.match(await missing.text(), /回到 OX 加密/);
  assert.equal((await call(e, '/data/..%2Fworker%2Fsite.json')).status, 404, 'no way out of the data folders');
  assert.equal((await call(e, '/data/news.json')).headers.get('X-OX-Data-Commit'), 'bundled');
});

test('the local fake Google sign-in checks PKCE and never reaches the Worker as a test identity', async () => {
  const clientId = 'dev-fake-client.apps.googleusercontent.com', e = env({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'dev-fake-secret' });
  const google = fakeGoogle({ clientId, clientSecret: 'dev-fake-secret' });
  const local = 'http://localhost:4313';
  const start = await worker.fetch(new Request(local + '/api/v1/auth/google/start?return_to=/'), e, {});
  const chooser = new URL(google.rewriteLocation(start.headers.get('location'), local));
  assert.equal(chooser.pathname, '/__dev/google');
  const picked = google.page(new URL(local + '/__dev/google/pick?grant=' + chooser.searchParams.get('grant') + '&who=0'));
  const callback = new URL(picked.headers.get('location'));
  // A wrong verifier is refused by the fake token endpoint, as Google would.
  const forged = google.token({ body: new URLSearchParams({ code: callback.searchParams.get('code'), client_id: clientId, client_secret: 'dev-fake-secret', redirect_uri: local + '/api/v1/auth/google/callback', code_verifier: 'x'.repeat(43) }) });
  assert.equal(forged.status, 400);
  // The code was single use, so pick again and complete normally.
  const chooser2 = new URL(google.rewriteLocation((await worker.fetch(new Request(local + '/api/v1/auth/google/start?return_to=/'), e, {})).headers.get('location'), local));
  const callback2 = new URL(google.page(new URL(local + '/__dev/google/pick?grant=' + chooser2.searchParams.get('grant') + '&who=1')).headers.get('location'));
  const { authRoute } = await import('../server/app/auth.js');
  const done = await authRoute(new Request(callback2), e, callback2, { fetcher: async (url, init) => google.token(init) });
  assert.equal(done.headers.get('location'), local + '/?login=ok');
  const cookie = done.headers.get('set-cookie').split(';')[0];
  const me = await (await worker.fetch(new Request(local + '/api/v1/auth/me', { headers: { cookie } }), e, {})).json();
  assert.equal(me.data.member.email, 'hua@example.com');
  // In production the Worker talks to the real Google endpoints only.
  const production = await call(e, '/api/v1/auth/google/start');
  assert.match(production.headers.get('location'), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
});

test('every reply carries security headers; changes need a browser Origin; bursts from one address are limited', async () => {
  const e = env();
  for (const path of ['/no-such-page', '/api/v1/app/config', '/data/news.json', '/admin']) {
    const response = await call(e, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.match(response.headers.get('strict-transport-security') || '', /max-age=\d+/, path);
    assert.match(response.headers.get('permissions-policy') || '', /camera=\(\)/, path);
    assert.ok(response.headers.get('referrer-policy'), path);
  }
  // The admin page keeps its stricter policy.
  assert.equal((await call(e, '/admin')).headers.get('referrer-policy'), 'same-origin');
  assert.equal((await call(e, '/no-such-page')).headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  // A script posting without Origin is refused before anything runs; the page itself works.
  const bare = await call(e, '/api/v1/app/feedback', { method: 'POST', body: { text: 'from a script' } });
  assert.equal(bare.status, 403); assert.equal((await bare.json()).error.code, 'ORIGIN_REQUIRED');
  assert.equal((await call(e, '/api/v1/app/feedback', { method: 'POST', body: { text: 'from the page' }, headers: { Origin: ORIGIN } })).status, 200);
  // The GitHub publisher is not a browser: it still reaches its own token check.
  assert.equal((await call(e, '/api/v1/crypto/data-upload/release', { method: 'PUT', body: {} })).status, 401);
  // 600 calls a minute from one address, then 429; another address is unaffected.
  const from = ip => ({ headers: { 'cf-connecting-ip': ip } });
  let last;
  for (let i = 0; i <= 600; i++) last = await call(e, '/api/v1/unknown', from('198.51.100.7'));
  assert.equal(last.status, 429); assert.equal(last.headers.get('retry-after'), '60'); assert.equal((await last.json()).error.code, 'RATE_LIMITED');
  assert.equal((await call(e, '/api/v1/unknown', from('198.51.100.9'))).status, 404);
});

test('the Site\'s chatgpt.site address can be allowed through OX_SITE_ORIGIN; nothing else is', async () => {
  const site = 'https://ox-crypto.btcfly.chatgpt.site', request = origin => call(env({ OX_SITE_ORIGIN: site + '/' }), '/api/v1/app/config', { headers: { Origin: origin } });
  assert.equal((await request(site)).status, 200);
  assert.equal((await call(env(), '/api/v1/app/config', { headers: { Origin: site } })).status, 403, 'not without the setting');
  for (const origin of ['https://a0979989987-coder.github.io', 'https://ox-crypto-independent.vercel.app', 'https://example.com']) assert.equal((await request(origin)).status, 403, origin);
});

test('the static Vercel copy sends the same security headers', async () => {
  const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
  const all = vercel.headers.find(rule => rule.source === '/(.*)'), names = Object.fromEntries(all.headers.map(h => [h.key, h.value]));
  assert.equal(names['X-Content-Type-Options'], 'nosniff'); assert.equal(names['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(names['Permissions-Policy'], /camera=\(\)/); assert.match(names['Strict-Transport-Security'], /max-age=\d+/);
  assert.equal(vercel.buildCommand, 'npm run build:tools && npm run check');
});

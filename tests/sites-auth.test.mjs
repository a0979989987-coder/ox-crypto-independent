import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authRoute, memberOf } from '../server/app/auth.js';
import { localD1 } from '../scripts/local-d1.mjs';
import { SYNC_KEYS, mergeValue } from '../src/app/sync-keys.js';

const ID = 'client-123.apps.googleusercontent.com', ORIGIN = 'https://crypto.oxpattern.com';
const env = () => ({ DB: localD1(':memory:'), GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: 'secret' });
let ip = 0;
const call = (e, path, { method = 'GET', cookie, body, fetcher, origin = ORIGIN, type = 'application/json' } = {}) => {
  const request = new Request(origin + path, { method, headers: { ...(cookie ? { cookie } : {}), 'Content-Type': type, 'cf-connecting-ip': '203.0.113.' + (++ip % 250) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return authRoute(request, e, new URL(request.url), { fetcher });
};
const idToken = claims => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const good = nonce => ({ iss: 'https://accounts.google.com', aud: ID, azp: ID, exp: Date.now() / 1000 + 600, nonce, sub: '1001', email: 'fan@example.com', email_verified: true, name: '小明', picture: 'https://lh3.googleusercontent.com/a/x' });

async function signIn(e, claimsFor = good, returnTo = '/') {
  const start = await call(e, '/api/v1/auth/google/start?return_to=' + encodeURIComponent(returnTo));
  const google = new URL(start.headers.get('location'));
  assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(google.searchParams.get('redirect_uri'), ORIGIN + '/api/v1/auth/google/callback');
  assert.equal(google.searchParams.get('scope'), 'openid email profile');
  assert.equal(google.searchParams.get('code_challenge_method'), 'S256');
  const state = google.searchParams.get('state'), nonce = google.searchParams.get('nonce'), challenge = google.searchParams.get('code_challenge');
  let sent;
  const fetcher = async (url, init) => { assert.equal(url, 'https://oauth2.googleapis.com/token'); sent = Object.fromEntries(new URLSearchParams(init.body)); return Response.json({ id_token: idToken(claimsFor(nonce)) }); };
  const back = await call(e, `/api/v1/auth/google/callback?state=${state}&code=abc`, { fetcher });
  return { back, sent, state, challenge, cookie: back.headers.get('set-cookie')?.split(';')[0] };
}

test('Google sign-in: PKCE verifier matches the challenge, the session cookie is HttpOnly, Secure, SameSite and stored hashed', async () => {
  const e = env(), { back, sent, challenge, cookie } = await signIn(e, good, '/?view=radar');
  assert.equal(sent.grant_type, 'authorization_code');
  assert.equal(sent.client_secret, 'secret');
  assert.ok(sent.code_verifier.length >= 43);
  assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'), challenge, 'S256(code_verifier) is the challenge sent to Google');
  assert.equal(back.headers.get('location'), ORIGIN + '/?view=radar&login=ok');
  assert.match(back.headers.get('set-cookie'), /^__Host-ox_crypto_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  const token = cookie.split('=')[1];
  const rows = (await e.DB.prepare('SELECT token FROM sessions').all()).results;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token, token, 'the raw session token is never stored');
  assert.equal(rows[0].token, createHash('sha256').update(token).digest('base64url'));
  const me = await (await call(e, '/api/v1/auth/me', { cookie })).json();
  assert.deepEqual(me.data, { configured: true, member: { name: '小明', email: 'fan@example.com', picture: 'https://lh3.googleusercontent.com/a/x', bitget: null } });
});

test('a reused or unknown state, a wrong audience, issuer or nonce, an expired or unverified token are refused', async () => {
  const e = env();
  for (const bad of [n => ({ ...good(n), aud: 'other' }), n => ({ ...good(n), azp: 'other' }), n => ({ ...good(n), iss: 'https://evil.example' }), () => good('wrong-nonce'),
    n => ({ ...good(n), exp: Date.now() / 1000 - 5 }), n => ({ ...good(n), email_verified: false }), n => ({ ...good(n), sub: '../x' })])
    assert.match((await signIn(e, bad)).back.headers.get('location'), /login=failed/);
  assert.match((await call(e, '/api/v1/auth/google/callback?state=never&code=abc')).headers.get('location'), /\/\?login=expired$/);
  // The state is gone after its first use, even if that use failed.
  const { state } = await signIn(e, n => ({ ...good(n), aud: 'other' }));
  assert.match((await call(e, `/api/v1/auth/google/callback?state=${state}&code=abc`, { fetcher: async () => Response.json({ id_token: idToken(good('x')) }) })).headers.get('location'), /login=expired/);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM sessions').first()).n, 0);
  // Google sending the visitor back without a code means they cancelled.
  const start = new URL((await call(e, '/api/v1/auth/google/start')).headers.get('location'));
  assert.match((await call(e, `/api/v1/auth/google/callback?state=${start.searchParams.get('state')}&error=access_denied`)).headers.get('location'), /login=cancelled/);
});

test('sign-in starts on the public domain and only returns to paths on this site', async () => {
  const e = env();
  const elsewhere = await call(e, '/api/v1/auth/google/start?return_to=/', { origin: 'https://ox-crypto.example.chatgpt.site' });
  assert.equal(elsewhere.headers.get('location'), ORIGIN + '/api/v1/auth/google/start?return_to=/');
  for (const target of ['//evil.example/x', 'https://evil.example', '/api/v1/auth/logout', 'javascript:alert(1)'])
    assert.equal((await signIn(e, good, target)).back.headers.get('location'), ORIGIN + '/?login=ok');
});

test('settings sync is per member, only for the listed keys, in their shape, and size-limited', async () => {
  const e = env(), { cookie } = await signIn(e);
  assert.equal((await call(e, '/api/v1/me/data')).status, 401);
  const watch = [{ symbol: 'BTCUSDT', savedAt: 1 }, { symbol: 'ETHUSDT', savedAt: 2 }];
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'watchlist', value: watch } })).status, 200);
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'radar-filter-mode', value: 'custom' } })).status, 200);
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'password', value: 'x' } })).status, 400);
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'watchlist', value: ['BTCUSDT'] } })).status, 400, 'the watchlist stays a list of coins');
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'radar-filter-mode', value: { x: 1 } } })).status, 400);
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'chart-indicators', value: { pad: 'x'.repeat(30000) } } })).status, 400, 'too large');
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'chart-indicators', value: { pad: 'x'.repeat(23995) } } })).status, 413);
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'chart-indicators', value: { 'chk-vol': true } }, type: 'text/plain' })).status, 415);
  assert.deepEqual((await (await call(e, '/api/v1/me/data', { cookie })).json()).data, { watchlist: watch, 'radar-filter-mode': 'custom' });
  assert.equal((await call(e, '/api/v1/me/data', { method: 'POST', cookie, body: { key: 'radar-filter-mode', value: null } })).status, 200);
  assert.deepEqual((await (await call(e, '/api/v1/me/data', { cookie })).json()).data, { watchlist: watch });
  // Another member sees only their own settings.
  const other = await signIn(e, n => ({ ...good(n), sub: '2002', email: 'two@example.com' }));
  assert.deepEqual((await (await call(e, '/api/v1/me/data', { cookie: other.cookie })).json()).data, {});
});

test('the first sign-in on a device keeps both lists; after that one copy is followed', () => {
  const watch = SYNC_KEYS.find(k => k.key === 'watchlist'), list = SYNC_KEYS.find(k => k.merge === 'list'), value = SYNC_KEYS.find(k => k.merge === 'value');
  const merged = mergeValue(watch, [{ symbol: 'SOLUSDT', savedAt: 5 }, { symbol: 'BTCUSDT', savedAt: 1 }], [{ symbol: 'BTCUSDT', savedAt: 9, tier: 't1' }, { symbol: 'ETHUSDT', savedAt: 2 }]);
  assert.deepEqual(merged.map(r => r.symbol), ['SOLUSDT', 'BTCUSDT', 'ETHUSDT'], 'this device first, then the account\'s other coins');
  assert.equal(merged[1].tier, 't1', 'the newer copy of a coin wins');
  assert.equal(mergeValue(watch, [], undefined), undefined);
  assert.deepEqual(mergeValue(list, ['defi', 'ai'], ['ai', 'meme']), ['defi', 'ai', 'meme']);
  assert.equal(mergeValue(value, 'classic', 'custom'), 'custom');
  assert.equal(mergeValue(value, 'classic', undefined), 'classic');
  assert.ok(SYNC_KEYS.every(k => /^[a-z0-9-]+$/.test(k.key) && ['json', 'text'].includes(k.type) && ['records', 'list', 'value'].includes(k.merge)));
  assert.equal(SYNC_KEYS.find(k => k.key === 'watchlist').storage, 'ox-watchlist');
});

test('logout and blocking end the session; a blocked member cannot sign in again', async () => {
  const e = env(), { cookie } = await signIn(e);
  const req = () => new Request(ORIGIN + '/', { headers: { cookie } });
  assert.equal(await memberOf(req(), e), 'g:1001');
  await e.DB.prepare("UPDATE members SET status = 'blocked'").run();
  assert.equal(await memberOf(req(), e), null);
  assert.match((await signIn(e)).back.headers.get('location'), /login=blocked/);
  await e.DB.prepare("UPDATE members SET status = 'active'").run();
  assert.equal(await memberOf(req(), e), 'g:1001');
  const out = await call(e, '/api/v1/auth/logout', { method: 'POST', cookie, body: {} });
  assert.match(out.headers.get('set-cookie'), /^__Host-ox_crypto_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
  assert.equal(await memberOf(req(), e), null);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM sessions').first()).n, 0);
});

test('without Google settings or a database the site says member features are not open yet', async () => {
  for (const e of [{ DB: localD1(':memory:') }, { GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: 'secret' }]) {
    assert.equal((await (await call(e, '/api/v1/auth/me')).json()).data.configured, false);
    assert.match((await call(e, '/api/v1/auth/google/start')).headers.get('location'), /\/\?login=unavailable$/);
  }
});

test('local http runs use a plain cookie name without Secure', async () => {
  const e = env();
  const start = new URL((await call(e, '/api/v1/auth/google/start', { origin: 'http://localhost:4313' })).headers.get('location'));
  assert.equal(start.searchParams.get('redirect_uri'), 'http://localhost:4313/api/v1/auth/google/callback');
  const back = await call(e, `/api/v1/auth/google/callback?state=${start.searchParams.get('state')}&code=abc`, { origin: 'http://localhost:4313', fetcher: async () => Response.json({ id_token: idToken(good(start.searchParams.get('nonce'))) }) });
  assert.match(back.headers.get('set-cookie'), /^ox_crypto_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
});

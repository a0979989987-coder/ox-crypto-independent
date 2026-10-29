import test from 'node:test';
import assert from 'node:assert/strict';
import { appRoute, adminRoute, deviceClass } from '../server/app/routes.js';
import { localD1 } from '../scripts/local-d1.mjs';
import { db } from '../server/app/store.js';

const OWNER = 'a0979989987@gmail.com', ORIGIN = 'https://crypto.oxpattern.com';
const env = () => ({ DB: localD1(':memory:') });
let ipSeq = 0;
const req = (path, { method = 'GET', body, headers = {}, ip } = {}) => {
  const request = new Request(ORIGIN + path, { method, headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip || '198.51.100.' + (++ipSeq % 250), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return [request, new URL(request.url)];
};
const app = (e, path, opts, memberOf) => { const [r, u] = req(path, opts); return appRoute(r, e, u, memberOf); };
const admin = (e, path, opts = {}, email = OWNER) => {
  const [r, u] = req(path, { ...opts, headers: { ...(email ? { 'oai-authenticated-user-email': email } : {}), ...opts.headers } });
  return adminRoute(r, e, u, async file => ({ 'data/news.json': { generatedAt: '2026-10-28T05:57:01.344Z' }, 'previews/data/crypto-flow-history.json': { collectedAt: '2026-10-28T06:52:47.412Z' } }[file]));
};
const data = async response => (await response.json()).data;

test('device class reads the phone and the app it was opened in, never the full agent string', () => {
  assert.equal(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Line/14.0'), 'ios:line');
  assert.equal(deviceClass('Mozilla/5.0 (Linux; Android 14) Instagram 300'), 'android:instagram');
  assert.equal(deviceClass('Mozilla/5.0 (Windows NT 10.0)'), 'desktop:browser');
});

test('usage records are stored anonymously and counted on the admin page with readable names', async () => {
  const e = env();
  const events = [{ name: 'coin.view', detail: 'BTCUSDT' }, { name: 'coin.view', detail: 'ETHUSDT' }, { name: 'board.preset', detail: 'w' }, { name: 'board.draw' }, { name: 'tool.patterns' }, { name: 'chart.indicator', detail: 'ox-markers' }, { name: 'Bad Name!' }, { name: 'x'.repeat(41) }, null, 'text'];
  const stored = await data(await app(e, '/api/v1/app/track', { method: 'POST', body: { device: 'device-aaaa-1111', events }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Line/14.0' } }));
  assert.equal(stored.stored, 6);
  await app(e, '/api/v1/app/track', { method: 'POST', body: { device: 'device-bbbb-2222', events: [{ name: 'coin.view', detail: 'BTCUSDT' }, { name: 'app.open', detail: 'x'.repeat(200) }] } });
  const rows = (await e.DB.prepare('SELECT * FROM events').all()).results;
  assert.ok(rows.every(r => !JSON.stringify(r).includes('Mozilla') && !JSON.stringify(r).includes('198.51.100')), 'no user agent or IP is stored');
  assert.equal(Math.max(...rows.map(r => (r.detail || '').length)), 60);
  const features = await data(await admin(e, '/api/v1/admin/features?days=7'));
  assert.deepEqual(features.find(f => f.name === 'coin.view'), { name: 'coin.view', uses: 3, people: 2 });
  const popular = await data(await admin(e, '/api/v1/admin/popular?days=7'));
  assert.deepEqual(popular.coins.map(r => [r.detail, r.people]), [['BTC', 2], ['ETH', 1]]);
  assert.equal(popular.patterns[0].detail, 'W 底・雙底');
  assert.equal(popular.indicators[0].detail, 'OX 指標');
  assert.equal(popular.draws, 1);
  const overview = await data(await admin(e, '/api/v1/admin/overview'));
  assert.equal(overview.visitors[1], 2); assert.equal(overview.online, 2); assert.equal(overview.daily.length, 1);
  assert.deepEqual((await data(await admin(e, '/api/v1/admin/devices?days=7'))).sort((a, b) => a.kind.localeCompare(b.kind)), [{ kind: 'desktop:browser', people: 1 }, { kind: 'ios:line', people: 1 }]);
  const system = await data(await admin(e, '/api/v1/admin/system'));
  assert.equal(system.news, '2026-10-28T05:57:01.344Z'); assert.equal(system.flow, '2026-10-28T06:52:47.412Z'); assert.equal(system.macro, null);
});

test('a bad device id, a non-JSON post or too many records from one device are refused', async () => {
  const e = env();
  const send = (device, opts = {}) => app(e, '/api/v1/app/track', { method: 'POST', body: { device, events: [{ name: 'app.open' }] }, ...opts });
  assert.equal((await send('x')).status, 400);
  assert.equal((await send('device-<script>-1')).status, 400);
  assert.equal((await app(e, '/api/v1/app/track', { method: 'POST', body: '{not json' })).status, 400);
  assert.equal((await app(e, '/api/v1/app/track', { method: 'POST', body: { device: 'device-cccc-3333', events: [] }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  let last; for (let i = 0; i < 31; i++) last = await send('device-dddd-4444');
  assert.equal(last.status, 429, 'per device');
  for (let i = 0; i < 61; i++) last = await send('device-ip-' + String(i).padStart(4, '0'), { ip: '192.0.2.77' });
  assert.equal(last.status, 429, 'per connection');
});

test('the admin API needs the signed-in owner (or OX_ADMIN_EMAILS)', async () => {
  const e = env();
  assert.equal((await admin(e, '/api/v1/admin/me', {}, null)).status, 401);
  assert.equal((await admin(e, '/api/v1/admin/me', {}, 'someone@example.com')).status, 403);
  for (const path of ['overview', 'features', 'members', 'feedback', 'bitget', 'flags', 'announcements', 'export?kind=members'])
    assert.equal((await admin(e, '/api/v1/admin/' + path, {}, 'someone@example.com')).status, 403, path);
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: 'hack' } }, 'someone@example.com')).status, 403);
  const me = await data(await admin(e, '/api/v1/admin/me', {}, ' A0979989987@Gmail.com '));
  assert.deepEqual(me, { email: OWNER, storage: true, bitgetCheck: false, googleSignIn: false });
  const staff = { ...e, OX_ADMIN_EMAILS: 'helper@example.com' };
  assert.equal((await admin(staff, '/api/v1/admin/me', {}, 'helper@example.com')).status, 200);
  assert.equal((await admin(staff, '/api/v1/admin/me')).status, 403, 'the list replaces the default');
  assert.equal((await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'maintenance', on: true }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('an announcement shows until it is cleared or ends; links must be https', async () => {
  const e = env();
  const config = async () => data(await app(e, '/api/v1/app/config'));
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: '10/30 23:00 資料源維護', link: 'https://crypto.oxpattern.com/' } })).status, 200);
  assert.equal((await config()).announcement.text, '10/30 23:00 資料源維護');
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: 'x', link: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: 'x', ends_at: Date.now() - 1000 } })).status, 400);
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: '' } })).status, 400);
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: 'y'.repeat(500) } })).status, 200);
  assert.equal((await config()).announcement.text.length, 200, 'clipped to 200 characters');
  const [latest] = await data(await admin(e, '/api/v1/admin/announcements'));
  assert.equal(latest.created_by, OWNER);
  const live = (await data(await admin(e, '/api/v1/admin/announcements'))).filter(a => !a.ends_at || a.ends_at > Date.now());
  assert.deepEqual(live.map(a => a.id), [latest.id], 'a new announcement replaces the one showing');
  await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { clear: latest.id } });
  assert.equal((await config()).announcement, null);
  await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { text: '週末維護' } });
  await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { clear: 'all' } });
  assert.equal((await config()).announcement, null);
  assert.equal((await admin(e, '/api/v1/admin/announcements', { method: 'POST', body: { delete: 'abc' } })).status, 400);
});

test('feature switches turn single tools off with a message, and maintenance covers the site', async () => {
  const e = env();
  const config = async () => data(await app(e, '/api/v1/app/config'));
  assert.deepEqual(await config(), { announcement: null, maintenance: null, off: {} });
  await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'tool.heatmap', off: true, message: '熱力圖資料源維修中' } });
  await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'tool.patterns', off: false, message: 'ignored while open' } });
  assert.deepEqual((await config()).off, { heatmap: '熱力圖資料源維修中' });
  await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'maintenance', on: true, message: '升級中' } });
  assert.deepEqual((await config()).maintenance, { message: '升級中' });
  for (const key of ['tool.', 'tool.Heatmap', 'tool.a/b', 'drop table', 'flags']) assert.equal((await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key, off: true } })).status, 400, key);
  await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'tool.heatmap', off: false } });
  await admin(e, '/api/v1/admin/flags', { method: 'POST', body: { key: 'maintenance', on: false } });
  assert.deepEqual(await config(), { announcement: null, maintenance: null, off: {} });
  const flags = await data(await admin(e, '/api/v1/admin/flags'));
  assert.ok(flags.every(f => f.updated_by === OWNER));
});

test('feedback is length-limited, rate-limited per connection and device, and reaches the admin page', async () => {
  const e = env();
  const send = (body, opts) => app(e, '/api/v1/app/feedback', { method: 'POST', body, ...opts }, async () => null);
  assert.equal((await send({ text: '希望畫板加 2H', topic: '功能建議', contact: 'fan@example.com', page: 'strength', device: 'device-ffff-0001' })).status, 200);
  assert.equal((await send({ text: 'a' })).status, 400);
  assert.equal((await send({ text: 'ok then', contact: 'not an email' })).status, 400);
  assert.equal((await send({ text: 'z'.repeat(9000) })).status, 400, 'body too large');
  assert.equal((await send({ text: 'z'.repeat(5000) })).status, 200);
  const list = await data(await admin(e, '/api/v1/admin/feedback'));
  assert.equal(list.length, 2);
  assert.equal(list.find(f => f.contact).topic, '功能建議');
  assert.equal(Math.max(...list.map(f => f.text.length)), 2000);
  let last; for (let i = 0; i < 6; i++) last = await send({ text: 'same connection ' + i }, { ip: '192.0.2.10' });
  assert.equal(last.status, 429);
  for (let i = 0; i < 6; i++) last = await send({ text: 'same device ' + i, device: 'device-ffff-0002' });
  assert.equal(last.status, 429, 'the same device, across connections');
  const id = list[0].id;
  await admin(e, '/api/v1/admin/feedback', { method: 'POST', body: { id, status: 'done' } });
  const done = (await data(await admin(e, '/api/v1/admin/feedback'))).find(f => f.id === id);
  assert.equal(done.status, 'done'); assert.equal(done.handled_by, OWNER); assert.ok(done.handled_at);
  assert.ok((await data(await admin(e, '/api/v1/admin/feedback?status=new'))).every(f => f.status === 'new'));
});

test('the member list shows synced items and Bitget status; blocking ends sessions; CSV cells cannot run formulas', async () => {
  const e = env(), now = Date.now();
  await db(e);
  await e.DB.prepare("INSERT INTO members (id, email, name, created_at, last_seen) VALUES ('g:1', 'fan@example.com', '=cmd()', ?, ?)").bind(now, now).run();
  await e.DB.prepare("INSERT INTO member_data (member, key, value, updated_at) VALUES ('g:1', 'watchlist', '[{\"symbol\":\"BTCUSDT\"},{\"symbol\":\"ETHUSDT\"}]', ?), ('g:1', 'radar-filter-mode', '\"custom\"', ?)").bind(now, now).run();
  await e.DB.prepare("INSERT INTO bitget_uids (member, uid, status, submitted_at) VALUES ('g:1', '1234567890', 'pending', ?)").bind(now).run();
  await e.DB.prepare("INSERT INTO sessions (token, member, created_at, expires_at) VALUES ('hash', 'g:1', ?, ?)").bind(now, now + 1e6).run();
  const [member] = await data(await admin(e, '/api/v1/admin/members?q=fan'));
  assert.deepEqual(member.synced.sort(), ['自選 2', '雷達篩選模式'].sort());
  assert.equal(member.bitget_status, 'pending'); assert.equal(member.bitget_uid, '1234567890');
  assert.equal((await data(await admin(e, '/api/v1/admin/members?q=%25'))).length, 0, 'search text is literal');
  await admin(e, '/api/v1/admin/members', { method: 'POST', body: { id: 'g:1', status: 'blocked' } });
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM sessions').first()).n, 0);
  const csv = await (await admin(e, '/api/v1/admin/export?kind=members')).text();
  assert.match(csv, /"'=cmd\(\)"/);
});

test('without a database the public site keeps working', async () => {
  assert.deepEqual(await data(await app({}, '/api/v1/app/config')), { announcement: null, maintenance: null, off: {} });
  assert.equal((await data(await app({}, '/api/v1/app/track', { method: 'POST', body: { device: 'device-eeee-5555', events: [{ name: 'app.open' }] } }))).stored, 0);
  assert.equal((await app({}, '/api/v1/app/feedback', { method: 'POST', body: { text: 'hello' } })).status, 503);
  assert.equal((await data(await admin({}, '/api/v1/admin/me'))).storage, false);
  assert.equal((await admin({}, '/api/v1/admin/overview')).status, 503);
});

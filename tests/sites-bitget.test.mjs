import test from 'node:test';
import assert from 'node:assert/strict';
import { authRoute } from '../server/app/auth.js';
import { adminRoute } from '../server/app/routes.js';
import { signBitget, createBitgetChecker, UID } from '../server/app/bitget.js';
import { signBitget as nodeSign } from '../server/integrations/bitget/affiliate.js';
import { localD1 } from '../scripts/local-d1.mjs';
import { db } from '../server/app/store.js';
import { createHash } from 'node:crypto';
import worker from '../worker/index.js';

const OWNER = 'a0979989987@gmail.com', ORIGIN = 'https://crypto.oxpattern.com';
// Synthetic credentials only; none of these are real.
const KEYS = { BITGET_AFFILIATE_API_KEY: 'test-only-key', BITGET_AFFILIATE_SECRET_KEY: 'test-only-secret', BITGET_AFFILIATE_PASSPHRASE: 'test-only-passphrase' };
let ip = 0;
const request = (path, { method = 'GET', body, headers = {} } = {}) => new Request(ORIGIN + path, { method, headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.18.0.' + (++ip % 250), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const member = (e, token, path, opts = {}) => { const r = request(path, { ...opts, headers: { cookie: '__Host-ox_crypto_session=' + token } }); return authRoute(r, e, new URL(r.url)); };
const admin = (e, path, opts = {}, email = OWNER, fetcher) => { const r = request(path, { ...opts, headers: email ? { 'oai-authenticated-user-email': email } : {} }); return adminRoute(r, e, new URL(r.url), async () => null, { fetcher }); };
const data = async response => (await response.json()).data;
async function withMembers(extra = {}) {
  const e = { DB: localD1(':memory:'), ...extra }, now = Date.now(); await db(e);
  for (const [id, email, token] of [['g:1', 'fan@example.com', 'a'.repeat(43)], ['g:2', 'hua@example.com', 'b'.repeat(43)]]) {
    await e.DB.prepare('INSERT INTO members (id, email, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').bind(id, email, email.split('@')[0], now, now).run();
    await e.DB.prepare('INSERT INTO sessions (token, member, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(createHash('sha256').update(token).digest('base64url'), id, now, now + 86400000).run();
  }
  return e;
}

test('a member submits one numeric Bitget UID, can change it, and sees the review status', async () => {
  const e = await withMembers(), token = 'a'.repeat(43);
  assert.equal((await authRoute(request('/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } }), e, new URL(ORIGIN + '/api/v1/me/bitget'))).status, 401, 'signed-in members only');
  for (const uid of ['abc123', '12345', '0123456789', '1'.repeat(21), '12 345 678', 1234567890, '１２３４５６７'])
    assert.equal((await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid } })).status, 400, String(uid));
  assert.ok(UID.test('123456') && UID.test('1'.repeat(20)) && !UID.test('1e10'));
  const first = await data(await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: ' 1234567890 ' } }));
  assert.deepEqual({ uid: first.uid, status: first.status, verified: first.verified }, { uid: '1234567890', status: 'pending', verified: false });
  await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } });
  const changed = await data(await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: '9876543210' } }));
  assert.equal(changed.uid, '9876543210');
  assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM bitget_audit WHERE action = 'submit'").first()).n, 2, 'resending the same UID adds nothing');
  for (const uid of ['1111111111', '2222222222', '3333333333']) await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid } });
  assert.equal((await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: '4444444444' } })).status, 429, 'five changes a day');
  const me = await data(await member(e, token, '/api/v1/auth/me'));
  assert.equal(me.member.bitget.uid, '3333333333');
});

test('the owner approves or rejects with a note; every decision is kept with who and when', async () => {
  const e = await withMembers(), token = 'a'.repeat(43);
  await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } });
  await member(e, 'b'.repeat(43), '/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } });
  const list = await data(await admin(e, '/api/v1/admin/bitget?status=pending'));
  assert.equal(list.counts.pending, 2); assert.equal(list.checkConfigured, false);
  assert.ok(list.list.every(r => r.shared === 1), 'the same UID from two members is flagged');
  assert.equal((await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '1234567890', action: 'approve', note: '已確認推薦關係' } }, 'someone@example.com')).status, 403);
  assert.equal((await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '1234567890', action: 'grant-vip' } })).status, 400);
  assert.equal((await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '1234567890', action: 'approve', note: '已確認推薦關係' } })).status, 200);
  const approved = (await data(await member(e, token, '/api/v1/auth/me'))).member.bitget;
  assert.deepEqual({ status: approved.status, note: approved.note, verified: approved.verified }, { status: 'approved', note: '已確認推薦關係', verified: true });
  // A newer submission needs a new look: an old decision cannot land on it.
  await member(e, token, '/api/v1/me/bitget', { method: 'POST', body: { uid: '5555555555' } });
  assert.equal((await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '1234567890', action: 'approve' } })).status, 409);
  assert.equal((await data(await member(e, token, '/api/v1/auth/me'))).member.bitget.verified, false, 'changing the UID removes the badge until it is reviewed again');
  await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '5555555555', action: 'reject', note: '查不到推薦關係' } });
  const rejected = (await data(await member(e, token, '/api/v1/auth/me'))).member.bitget;
  assert.deepEqual({ status: rejected.status, note: rejected.note }, { status: 'rejected', note: '查不到推薦關係' });
  await admin(e, '/api/v1/admin/bitget', { method: 'POST', body: { member: 'g:1', uid: '5555555555', action: 'reopen' } });
  const all = await data(await admin(e, '/api/v1/admin/bitget'));
  const history = all.list.find(r => r.member === 'g:1').history;
  assert.deepEqual(history.map(h => [h.action, h.actor]), [['reopen', OWNER], ['reject', OWNER], ['submit', 'member'], ['approve', OWNER], ['submit', 'member']]);
  assert.ok(history.every(h => Number.isFinite(h.ts) && h.ts > 0));
  assert.equal(history.find(h => h.action === 'reject').note, '查不到推薦關係');
});

test('the approval is only a badge: every tool stays public for everyone', async () => {
  const response = await worker.fetch(new Request(ORIGIN + '/api/v1/account/feature-access'), {});
  assert.ok((await response.json()).features.every(f => f.mode === 'public'));
});

test('signing matches the original Bitget adapter byte for byte', async () => {
  const shared = { secretKey: KEYS.BITGET_AFFILIATE_SECRET_KEY, timestamp: '1700000000000' };
  for (const input of [{ method: 'post', requestPath: '/api/v2/broker/customer-list', body: '{"uid":"123456"}' }, { method: 'get', requestPath: '/api/v2/broker/customer-kyc-result', query: 'endTime=1700000000000&uid=123456' }])
    assert.equal(await signBitget({ ...shared, ...input }), nodeSign({ ...shared, ...input }));
  assert.equal(await signBitget({ ...shared, method: 'post', requestPath: '/api/v2/broker/customer-list', body: '{"uid":"123456"}' }), 'os5igjdhP3ZNGY8Rm5D44ZLdPsVGUOsEHfEGgjWv82U=');
});

test('the automatic check reads the referral and KYC status, read-only, and is kept on the review', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init]);
    if (url.includes('customer-list')) return Response.json({ code: '00000', data: [{ uid: 1234567890, registerTime: '1679991960110' }] });
    return Response.json({ code: '00000', data: { userList: [{ uid: '1234567890', kycResult: 'passed' }] } });
  };
  const checker = createBitgetChecker({ env: KEYS, fetcher, now: () => 1700000000000 });
  const result = await checker.check('1234567890');
  assert.deepEqual({ referral: result.referral, kyc: result.kyc, registeredAt: result.registeredAt }, { referral: 'matched', kyc: 'passed', registeredAt: '2023-03-28T08:26:00.110Z' });
  assert.equal(calls[0][0], 'https://api.bitget.com/api/v2/broker/customer-list');
  assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].body, '{"uid":"1234567890"}'); assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].headers['ACCESS-SIGN'], nodeSign({ secretKey: KEYS.BITGET_AFFILIATE_SECRET_KEY, timestamp: '1700000000000', method: 'POST', requestPath: '/api/v2/broker/customer-list', body: '{"uid":"1234567890"}' }));
  const kyc = new URL(calls[1][0]);
  assert.equal(calls[1][1].method, 'GET'); assert.equal(kyc.searchParams.get('showSub'), 'no'); assert.equal(kyc.searchParams.get('startTime'), String(1700000000000 - 90 * 86400000));
  assert.ok(calls.every(([url]) => !url.includes('test-only-secret')));
  // Not a referral: only one call, and not "unregistered".
  const none = await createBitgetChecker({ env: { ...KEYS, BITGET_AFFILIATE_REFERRAL_CODE: 'code-1' }, fetcher: async (url, init) => { assert.equal(JSON.parse(init.body).referralCode, 'code-1'); return Response.json({ code: '00000', data: [] }); } }).check('1234567890');
  assert.deepEqual({ referral: none.referral, kyc: none.kyc }, { referral: 'not_found', kyc: 'not_checked' });
  await assert.rejects(createBitgetChecker({ env: KEYS, fetcher: async () => Response.json({ code: '40014', msg: 'secret detail must not leak' }) }).check('1234567890'), error => error.code === 'BITGET_API_ERROR' && error.upstreamCode === '40014' && !error.message.includes('secret'));

  const e = await withMembers(KEYS);
  await member(e, 'a'.repeat(43), '/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } });
  assert.equal((await admin(e, '/api/v1/admin/bitget-check', { method: 'POST', body: { member: 'g:1' } }, 'someone@example.com', fetcher)).status, 403);
  const checked = await data(await admin(e, '/api/v1/admin/bitget-check', { method: 'POST', body: { member: 'g:1' } }, OWNER, fetcher));
  assert.equal(checked.result.referral, 'matched');
  const row = (await data(await admin(e, '/api/v1/admin/bitget'))).list[0];
  assert.equal(row.check_result.kyc, 'passed'); assert.equal(row.status, 'pending', 'a check never approves by itself');
  assert.equal(row.history[0].action, 'check'); assert.equal(row.history[0].actor, OWNER);
});

test('without the Bitget secrets the admin page says the automatic check is not set up', async () => {
  const e = await withMembers();
  await member(e, 'a'.repeat(43), '/api/v1/me/bitget', { method: 'POST', body: { uid: '1234567890' } });
  assert.deepEqual(await data(await admin(e, '/api/v1/admin/bitget-check', { method: 'POST', body: { member: 'g:1' } })), { configured: false });
  assert.equal((await data(await admin(e, '/api/v1/admin/me'))).bitgetCheck, false);
  assert.throws(() => createBitgetChecker({ env: { BITGET_AFFILIATE_API_KEY: 'k' } }), error => error.code === 'BITGET_NOT_CONFIGURED');
});

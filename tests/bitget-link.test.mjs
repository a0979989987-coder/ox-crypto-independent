import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandler } from '../server/account/handler.js';
import { cookieName, seal } from '../server/account/cookies.js';
import { publicPendingLink } from '../server/account/bitget-link.js';
const secret = 'synthetic-session-key-32-characters';
const env = { OX_AUTH_SESSION_SECRET: secret, OX_ACCOUNT_ORIGIN: 'https://ox.example', OX_SUPABASE_URL: 'https://mock.supabase.co', OX_SUPABASE_PUBLISHABLE_KEY: 'mock-key' };
const revision = '00000000-0000-4000-8000-000000000003';
const row = { uid: '123456', revision, ownership_status: 'pending' };
const req = (body, authenticated = true) => ({ method: body ? 'POST' : 'GET', query: { endpoint: 'bitget-link' }, body, headers: { origin: env.OX_ACCOUNT_ORIGIN, 'content-type': 'application/json', ...(authenticated ? { cookie: ['access', 'refresh'].map(kind => cookieName(kind) + '=' + seal('synthetic-' + kind, secret, kind)).join('; ') } : {}) } });
const res = () => ({ headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; }, end() {} });
function fixture({ rpcResult = { data: { code: 'OK', link: row } }, readResult = { data: row }, validUser = true } = {}) {
  const calls = [];
  const handler = createAccountHandler({ env, limiter: () => true, clientFactory: (url, key, options) => {
    if (!options.global) return { auth: { getUser: async () => ({ data: { user: validUser ? { id: 'validated-member' } : null } }) } };
    assert.equal(options.global.headers.Authorization, 'Bearer synthetic-access');
    return { from(table) { assert.equal(table, 'ox_bitget_links'); return { select(columns) { assert.equal(columns, 'uid,revision,ownership_status'); return this; }, eq(column, value) { assert.equal(column, 'account_id'); assert.equal(value, 'validated-member'); return this; }, maybeSingle: async () => readResult }; }, rpc: async (name, args) => { calls.push({ name, args }); return rpcResult; } };
  } });
  return { handler, calls };
}
test('UID claims require provider-validated OX identity and same-origin POST', async () => {
  for (const request of [req({ action: 'save', uid: '123456', revision: null }, false), req(undefined, false)]) {
    const f = fixture(), r = res(); await f.handler(request, r); assert.equal(r.statusCode, 401); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ validUser: false }), r = res(); await f.handler(req(), r); assert.equal(r.statusCode, 401);
  const cross = req({ action: 'save', uid: '123456', revision: null }); cross.headers.origin = 'https://evil.example';
  const denied = res(); await fixture().handler(cross, denied); assert.equal(denied.statusCode, 403);
});
test('saving a UID cannot assert owner, qualification, user ID, or query window', async () => {
  for (const extra of [{ account_id: 'another-member' }, { verified: true }, { kyc: 'passed' }, { startTime: '0' }]) {
    const f = fixture(), r = res(); await f.handler(req({ action: 'save', uid: '123456', revision: null, ...extra }), r); assert.equal(r.statusCode, 400); assert.equal(f.calls.length, 0);
  }
  for (const uid of [123456, '001', '0', '1e9', '123456789012345678901']) {
    const f = fixture(), r = res(); await f.handler(req({ action: 'save', uid, revision: null }), r); assert.equal(r.statusCode, 400);
  }
});
test('claim response stays pending and unverified regardless of Affiliate/KYC/sub-affiliate observations', () => {
  const result = publicPendingLink({ ...row, referral: { status: 'matched' }, certification: { status: 'passed' }, subAffiliate: true, providerPrivateDetail: 'synthetic-private' });
  assert.equal(result.ownershipVerified, false); assert.equal(result.eligibility, 'unverified'); assert.equal(result.affiliateStatus, 'not_checked'); assert.equal(result.kycStatus, 'not_checked'); assert.equal(result.subAffiliateStatus, 'unknown'); assert.equal(result.accessPolicyChanged, false);
  assert.ok(!JSON.stringify(result).includes('synthetic-private'));
  assert.throws(() => publicPendingLink({ ...row, ownership_status: 'verified' }));
});
test('authenticated mutation uses only own JWT/RLS RPC and reports conflict without replacing data', async () => {
  const f = fixture(), r = res(); await f.handler(req({ action: 'save', uid: '123456', revision: null }), r);
  assert.equal(r.body.link.ownershipStatus, 'pending'); assert.deepEqual(f.calls[0], { name: 'ox_set_pending_bitget_link', args: { p_action: 'save', p_uid: '123456', p_revision: null } });
  const conflict = fixture({ rpcResult: { data: { code: 'REVISION_CONFLICT' } } }), c = res(); await conflict.handler(req({ action: 'remove', revision }), c); assert.equal(c.statusCode, 409);
});
test('missing migration/database error is unavailable, not a missing UID or disqualification', async () => {
  const f = fixture({ readResult: { error: { message: 'synthetic-private-db-error' } } }), r = res(); await f.handler(req(), r);
  assert.equal(r.statusCode, 503); assert.equal(r.body.code, 'LINK_STORAGE_UNAVAILABLE'); assert.ok(!JSON.stringify(r.body).includes('synthetic-private'));
});

test('expired access is refreshed then provider-validated before reading any pending link', async () => {
  let queried = false;
  const handler = createAccountHandler({ env, limiter: () => true, clientFactory: (url, key, options) => {
    if (!options.global) return { auth: {
      getUser: async token => token === 'synthetic-new-access' ? { data: { user: { id: 'verified-after-refresh' } } } : { error: {} },
      refreshSession: async () => ({ data: { user: { id: 'untrusted-claims' }, session: { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh' } } })
    } };
    assert.equal(options.global.headers.Authorization, 'Bearer synthetic-new-access');
    return { from() { return { select() { return this; }, eq(column, value) { assert.equal(value, 'verified-after-refresh'); return this; }, maybeSingle: async () => { queried = true; return { data: null }; } }; } };
  } });
  const r = res(); await handler(req(), r); assert.equal(queried, true); assert.equal(r.statusCode, 200); assert.equal(r.body.link, null); assert.equal(r.headers['Set-Cookie'].length, 3);
});

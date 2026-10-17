import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, createBitgetStatusHandler, createRateLimiter, createAuditLogger, auditDigest, operatorLookupEnabled } from '../server/integrations/bitget/http-handler.js';

// Synthetic fixtures only.
const token = 'synthetic-operator-token-for-tests-0000';
const uid = '987654321';
const ip = '203.0.113.7';
const enabled = { OX_ACCOUNT_LOOKUP_TOKEN: token, OX_ENABLE_OPERATOR_LOOKUP: '1' };
const request = (overrides = {}) => ({ method: 'POST', url: '/api/v1/account/bitget-status', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-vercel-forwarded-for': ip }, body: { uid }, ...overrides });
function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

test('operator lookup is off unless OX_ENABLE_OPERATOR_LOOKUP is exactly "1"', async () => {
  for (const flag of [undefined, '', '0', 'true', 'yes', ' 1', 1, true]) {
    let contacted = 0;
    const env = { OX_ACCOUNT_LOOKUP_TOKEN: token, OX_ENABLE_OPERATOR_LOOKUP: flag };
    assert.equal(operatorLookupEnabled(env), false);
    const api = createHandler({ env, createClient: () => { contacted++; return { lookupCustomer: async () => ({}) }; }, limit: () => true, audit: () => {} });
    const res = await call(api, request());
    assert.equal(res.statusCode, 404, `flag ${JSON.stringify(flag)}`);
    assert.equal(res.body.code, 'OPERATOR_LOOKUP_DISABLED');
    assert.match(res.body.message, /bitget-admin-lookup/);
    assert.equal(contacted, 0);
    const page = await call(createBitgetStatusHandler({ env, apiHandler: () => assert.fail('api'), operatorHandler: () => assert.fail('operator page must stay closed') }), { method: 'GET', url: '/api/v1/account/bitget-status?view=test', headers: {} });
    assert.equal(page.statusCode, 404);
    assert.equal(page.headers['Cache-Control'], 'no-store, private');
  }
});

test('enabled endpoint keeps the existing Bearer contract and routes the test page', async () => {
  const api = createHandler({ env: enabled, createClient: () => ({ lookupCustomer: async body => ({ uid: body.uid }) }), limit: () => true, audit: () => {} });
  const res = await call(api, request());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.uid, uid);
  const routed = [];
  const router = createBitgetStatusHandler({ env: enabled, apiHandler: () => routed.push('api'), operatorHandler: () => routed.push('page') });
  await call(router, request());
  await call(router, { method: 'GET', url: '/api/v1/account/bitget-status?view=test', headers: {} });
  assert.deepEqual(routed, ['api', 'page']);
});

test('requests are throttled per client before the token is checked', async () => {
  const limit = createRateLimiter({ limit: 3 });
  let contacted = 0;
  const api = createHandler({ env: enabled, limit, audit: () => {}, now: () => 1000, createClient: () => { contacted++; return { lookupCustomer: async () => ({}) }; } });
  const wrong = request({ headers: { ...request().headers, authorization: 'Bearer wrong' } });
  for (let i = 0; i < 3; i++) assert.equal((await call(api, wrong)).statusCode, 401);
  const blocked = await call(api, request());
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['Retry-After'], '60');
  assert.equal(contacted, 0, 'a throttled client cannot reach Bitget even with the right token');
  const other = await call(api, request({ headers: { ...request().headers, 'x-vercel-forwarded-for': '198.51.100.2' } }));
  assert.equal(other.statusCode, 200, 'other clients are unaffected');
  const later = createRateLimiter({ limit: 1 });
  assert.equal(later('k', 0), true); assert.equal(later('k', 1), false); assert.equal(later('k', 60001), true, 'window resets');
});

test('audit log records outcome with keyed hashes, never the UID, token or IP in clear text', async () => {
  const lines = [];
  const audit = createAuditLogger({ env: enabled, log: line => lines.push(line), now: () => Date.UTC(2026, 9, 15) });
  const ok = createHandler({ env: enabled, limit: () => true, audit, createClient: () => ({ lookupCustomer: async () => ({ referral: { status: 'matched' } }) }) });
  await call(ok, request());
  await call(ok, request({ headers: { ...request().headers, authorization: 'Bearer nope' } }));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.includes(uid), false);
    assert.equal(line.includes(token), false);
    assert.equal(line.includes(ip), false);
  }
  const [success, denied] = lines.map(line => JSON.parse(line));
  assert.deepEqual({ ...success, requesterHash: undefined }, { event: 'ox.bitget_operator_lookup', channel: 'api', outcome: 'ok', status: 200, uidHash: auditDigest(token, 'uid', uid), requesterHash: undefined, at: '2026-10-15T00:00:00.000Z' });
  assert.match(success.uidHash, /^[a-f0-9]{16}$/);
  assert.equal(success.requesterHash, auditDigest(token, 'ip', ip));
  assert.equal(denied.outcome, 'unauthorized');
  assert.equal(denied.uidHash, null, 'unauthenticated requests do not even get a UID digest');
  assert.notEqual(auditDigest(token, 'uid', uid), auditDigest('another-token-of-sufficient-length-0000', 'uid', uid), 'digest is keyed');
});

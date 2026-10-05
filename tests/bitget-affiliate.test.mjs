import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitgetAffiliateClient, kycWindow, signBitget, validateUid } from '../server/integrations/bitget/affiliate.js';
import { createHandler } from '../server/integrations/bitget/http-handler.js';

// Synthetic fixtures only. None of these values are real credentials or users.
const now = 1700000000000;
const uid = '123456';
const env = {
  BITGET_AFFILIATE_API_KEY: 'test-only-key',
  BITGET_AFFILIATE_SECRET_KEY: 'test-only-secret',
  BITGET_AFFILIATE_PASSPHRASE: 'test-only-passphrase',
  OX_ACCOUNT_LOOKUP_TOKEN: 'test-only-operator-token-32-characters'
};
const customer = { uid: 123456, registerTime: '1679991960110' };
const response = (data, code = '00000', status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ code, data, msg: 'must never be exposed' }) });
function clientWith(responses, extraEnv = {}) {
  const calls = [];
  const client = createBitgetAffiliateClient({ env: { ...env, ...extraEnv }, now: () => now, fetchImpl: async (...args) => {
    calls.push(args);
    const item = responses.shift();
    if (item instanceof Error) throw item;
    return item;
  } });
  return { client, calls };
}

test('HMAC matches independent Python fixtures for body and query signing', () => {
  const shared = { secretKey: env.BITGET_AFFILIATE_SECRET_KEY, timestamp: String(now) };
  assert.equal(signBitget({ ...shared, method: 'post', requestPath: '/api/v2/broker/customer-list', body: '{"uid":"123456"}' }), 'os5igjdhP3ZNGY8Rm5D44ZLdPsVGUOsEHfEGgjWv82U=');
  assert.equal(signBitget({ ...shared, method: 'get', requestPath: '/api/v2/broker/customer-kyc-result', query: 'endTime=1700000000000&uid=123456' }), 'Ks3eRnxy34yVL1XnmbZO9LVWOzjHmn/gw96PAUpREEc=');
});

test('adapter signs exact transmitted bytes; no date restriction on registration', async () => {
  const { client, calls } = clientWith([response([customer, customer]), response({ userList: [{ uid, kycResult: 'passed' }] })]);
  const result = await client.lookupCustomer({ uid });
  assert.equal(result.referral.status, 'matched');
  assert.equal(result.registration.registeredAt, new Date(Number(customer.registerTime)).toISOString());
  assert.equal(result.certification.status, 'passed');
  assert.equal(result.certification.type, 'kyc_or_kyb');
  assert.equal(result.accountBindingVerified, false);
  assert.equal(result.accessPolicyChanged, false);
  const [postUrl, post] = calls[0];
  assert.equal(postUrl, 'https://api.bitget.com/api/v2/broker/customer-list');
  assert.equal(post.body, '{"uid":"123456"}');
  assert.equal(post.headers['ACCESS-SIGN'], 'os5igjdhP3ZNGY8Rm5D44ZLdPsVGUOsEHfEGgjWv82U=');
  const [getUrl, get] = calls[1];
  const url = new URL(getUrl);
  assert.equal(url.searchParams.get('showSub'), 'no');
  assert.equal(url.searchParams.get('startTime'), String(now - 90 * 86400000));
  assert.equal(url.searchParams.get('endTime'), String(now));
  assert.equal(url.searchParams.get('uid'), uid);
  assert.equal(get.body, undefined);
  assert.equal(get.redirect, 'error');
  assert.equal(get.headers['ACCESS-SIGN'], signBitget({ secretKey: env.BITGET_AFFILIATE_SECRET_KEY, timestamp: String(now), method: 'GET', requestPath: url.pathname, query: url.search.slice(1) }));
  assert.ok(!getUrl.includes(env.BITGET_AFFILIATE_SECRET_KEY));
});

test('referral code stays server controlled; missing referral does not imply unregistered', async () => {
  const { client, calls } = clientWith([response([])], { BITGET_AFFILIATE_REFERRAL_CODE: 'test-code' });
  const result = await client.lookupCustomer({ uid });
  assert.equal(JSON.parse(calls[0][1].body).referralCode, 'test-code');
  assert.equal(calls.length, 1);
  assert.equal(result.registration.status, 'unknown');
  assert.equal(result.certification.status, 'not_checked');
});

test('empty, unknown and contradictory certification records remain unknown', async () => {
  for (const records of [[], [{ uid, kycResult: 'pending_new_enum' }], [{ uid, kycResult: 'passed' }, { uid, kycResult: 'not_passed' }]]) {
    const { client } = clientWith([response([customer]), response({ userList: records })]);
    assert.equal((await client.lookupCustomer({ uid })).certification.status, 'unknown');
  }
});

test('explicit not_passed is preserved without granting or restricting access', async () => {
  const { client } = clientWith([response([customer]), response({ userList: [{ uid, kycResult: 'not_passed' }] })]);
  const result = await client.lookupCustomer({ uid });
  assert.equal(result.certification.status, 'not_passed');
  assert.equal(result.accessPolicyChanged, false);
});

test('foreign UID, imprecise numeric UID and malformed responses fail closed', async () => {
  for (const records of [[{ ...customer, uid: '999' }], [{ ...customer, uid: Number.MAX_SAFE_INTEGER + 1 }], null]) {
    const { client } = clientWith([response(records)]);
    await assert.rejects(client.lookupCustomer({ uid }), { code: 'BITGET_INVALID_RESPONSE' });
  }
  const { client } = clientWith([response([customer]), response({ userList: [{ uid: '999', kycResult: 'passed' }] })]);
  await assert.rejects(client.lookupCustomer({ uid }), { code: 'BITGET_INVALID_RESPONSE' });
});

test('provider API errors, rate limits and transport errors never become a KYC decision', async () => {
  for (const [upstream, code] of [[response(null, '40014'), 'BITGET_API_ERROR'], [response(null, '00000', 429), 'BITGET_RATE_LIMITED'], [new Error(env.BITGET_AFFILIATE_SECRET_KEY), 'BITGET_UNAVAILABLE']]) {
    const { client } = clientWith([upstream]);
    await assert.rejects(client.lookupCustomer({ uid }), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(env.BITGET_AFFILIATE_SECRET_KEY));
      assert.ok(!error.message.includes('must never be exposed'));
      return true;
    });
  }
});

test('UID and time inputs reject injection, precision loss and invalid windows before network', async () => {
  for (const bad of [123456, '0', '1&showSub=yes', '../123', '', '123456789012345678901']) assert.throws(() => validateUid(bad), { code: 'INVALID_REQUEST' });
  for (const times of [['1', undefined], [undefined, '2'], ['1e3', '2000'], ['2', '1'], ['0', String(now)], [String(now), String(now + 1)]]) {
    assert.throws(() => kycWindow(...times, now), { code: 'INVALID_REQUEST' });
  }
  const { client, calls } = clientWith([]);
  await assert.rejects(client.lookupCustomer({ uid: '1?foo=bar' }), { code: 'INVALID_REQUEST' });
  assert.equal(calls.length, 0);
  assert.deepEqual(kycWindow('1000', '2000', now), { startTime: '1000', endTime: '2000' });
});

async function invoke(req, options = {}) {
  const headers = {};
  const res = { setHeader(key, value) { headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await createHandler(options)(req, res);
  return { ...res, headers };
}
const validRequest = () => ({ method: 'POST', headers: { authorization: `Bearer ${env.OX_ACCOUNT_LOOKUP_TOKEN}`, 'content-type': 'application/json' }, body: { uid } });

test('unconfigured/unauthorized HTTP queries cannot contact Bitget', async () => {
  let calls = 0;
  const createClient = () => { calls++; throw new Error('must not execute'); };
  const disabled = await invoke(validRequest(), { env: {}, createClient });
  assert.equal(disabled.statusCode, 503);
  const unauthorized = validRequest();
  unauthorized.headers.authorization = 'Bearer incorrect';
  const denied = await invoke(unauthorized, { env, createClient });
  assert.equal(denied.statusCode, 401);
  assert.equal(calls, 0);
  assert.equal(denied.headers['Cache-Control'], 'no-store, private');
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
});

test('HTTP endpoint rejects query credentials, wrong methods/content types and unexpected input', async () => {
  const cases = [
    [{ method: 'GET', query: { uid, token: env.OX_ACCOUNT_LOOKUP_TOKEN } }, 405],
    [{ ...validRequest(), headers: {} }, 401],
    [{ ...validRequest(), headers: { authorization: `Bearer ${env.OX_ACCOUNT_LOOKUP_TOKEN}`, 'content-type': 'text/plain' } }, 415],
    [{ ...validRequest(), body: '{' }, 400],
    [{ ...validRequest(), body: { uid, cryptoFull: true } }, 400],
    [{ ...validRequest(), body: { uid: '1'.repeat(3000) } }, 400],
    [{ ...validRequest(), body: [] }, 400]
  ];
  for (const [req, status] of cases) {
    const res = await invoke(req, { env, createClient: () => { throw new Error('must not execute'); } });
    assert.equal(res.statusCode, status);
  }
});

test('authorized HTTP query returns minimal result and shields unexpected exception details', async () => {
  const res = await invoke(validRequest(), { env, createClient: () => ({ lookupCustomer: async ({ uid }) => ({ uid, accessPolicyChanged: false }) }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.uid, uid);
  const error = await invoke(validRequest(), { env, createClient: () => { throw new Error(env.BITGET_AFFILIATE_SECRET_KEY); } });
  assert.equal(error.statusCode, 500);
  assert.ok(!JSON.stringify(error.body).includes(env.BITGET_AFFILIATE_SECRET_KEY));
});

test('real credentials are required; no demo fallback', () => {
  assert.throws(() => createBitgetAffiliateClient({ env: {} }), { code: 'BITGET_NOT_CONFIGURED' });
});

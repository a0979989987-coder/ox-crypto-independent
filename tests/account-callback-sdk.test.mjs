import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAccountHandler } from '../server/account/handler.js';
import { unseal, cookieName } from '../server/account/cookies.js';

// Entirely synthetic: no live credentials, users, codes, or network calls.
const secret = 'synthetic-cookie-key-for-tests-32-chars';
const env = { OX_AUTH_SESSION_SECRET: secret, OX_ACCOUNT_ORIGIN: 'https://ox.example', OX_SUPABASE_URL: 'https://mock.supabase.co', OX_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' };
const request = (endpoint, body) => ({ method: body ? 'POST' : 'GET', query: { endpoint }, headers: { origin: env.OX_ACCOUNT_ORIGIN, 'content-type': 'application/json' }, ...(body ? { body } : {}) });
const response = () => ({ headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end() {} });

function setup({ exchangeError = false } = {}) {
  let challenge, exchanges = 0;
  const factory = (url, key, options) => createClient(url, key, { ...options, global: { fetch: async (url, options) => {
    assert.equal(new URL(url).pathname, '/auth/v1/token');
    exchanges++;
    const input = JSON.parse(options.body);
    assert.equal(createHash('sha256').update(input.code_verifier).digest('base64url'), challenge);
    const payload = exchangeError ? { code: 'flow_state_expired', msg: 'Synthetic private upstream detail' } : { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'synthetic-member', email: 'synthetic@example.test', identities: [] } };
    return new Response(JSON.stringify(payload), { status: exchangeError ? 400 : 200, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
  } } });
  const handler = createAccountHandler({ env, clientFactory: factory, limiter: () => true });
  return {
    handler,
    async start(returnTo = '/') {
      const result = response(); await handler(request('google', { returnTo }), result);
      assert.equal(result.body.ok, true);
      const authorize = new URL(result.body.url);
      challenge = authorize.searchParams.get('code_challenge');
      assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
      assert.equal(authorize.searchParams.get('redirect_to'), env.OX_ACCOUNT_ORIGIN + '/api/v1/account/callback');
      return result.headers['Set-Cookie'].split(';')[0];
    },
    get exchanges() { return exchanges; }
  };
}

test('real SDK restores PKCE from encrypted flow cookie and exchanges matching challenge', async () => {
  const flow = setup();
  const cookie = await flow.start('/?market=tw#radar');
  const req = request('callback'); req.query.code = 'synthetic-code'; req.headers.cookie = cookie;
  const result = response(); await flow.handler(req, result);
  assert.equal(flow.exchanges, 1);
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.Location, '/?market=tw&ox_auth=success#radar');
  const access = result.headers['Set-Cookie'].find(value => value.startsWith(cookieName('access') + '='));
  assert.equal(unseal(access.split(';')[0].split('=')[1], secret, 'access'), 'synthetic-access');
});

test('real SDK upstream expiration has a fixed category, not a changed-browser accusation', async () => {
  const flow = setup({ exchangeError: true });
  const cookie = await flow.start();
  const req = request('callback'); req.query.code = 'synthetic-code'; req.headers.cookie = cookie;
  const result = response(); await flow.handler(req, result);
  assert.equal(flow.exchanges, 1);
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.Location, '/?ox_auth=error&ox_auth_reason=authorization_expired');
  assert.ok(!JSON.stringify(result.headers).includes('Synthetic private upstream detail'));
});

test('successful retry strips previous error and code while keeping market/view return state', async () => {
  const flow = setup();
  const cookie = await flow.start('/?market=tw&ox_auth=error&ox_auth_reason=flow_missing&code=synthetic-old#radar');
  const req = request('callback'); req.query.code = 'synthetic-code'; req.headers.cookie = cookie;
  const result = response(); await flow.handler(req, result);
  assert.equal(result.headers.Location, '/?market=tw&ox_auth=success#radar');
});

test('callback uses signed SDK flow id rather than an untrusted URL flow id', async () => {
  const flow = setup(); const cookie = await flow.start();
  const payload = unseal(cookie.split('=')[1], secret, 'flow');
  assert.match(payload.flowId, /^[a-zA-Z0-9_-]{8,64}$/);
  const req = request('callback'); req.query.code = 'synthetic-code'; req.query.sb_flow_id = 'untrusted-flow-id'; req.headers.cookie = cookie;
  const result = response(); await flow.handler(req, result);
  assert.equal(result.headers.Location, '/?ox_auth=success'); assert.equal(flow.exchanges, 1);
});

test('missing/tampered flow cookies fail before provider and do not clear an existing session', async () => {
  for (const [cookie, reason] of [['', 'flow_missing'], [cookieName('flow') + '=synthetic-forged', 'flow_invalid']]) {
    const flow = setup(); const req = request('callback'); req.query.code = 'synthetic-code'; req.headers.cookie = cookie;
    const result = response(); await flow.handler(req, result);
    assert.equal(flow.exchanges, 0);
    assert.equal(result.headers.Location, '/?ox_auth=error&ox_auth_reason=' + reason);
    assert.equal(typeof result.headers['Set-Cookie'], 'string');
    assert.ok(result.headers['Set-Cookie'].startsWith(cookieName('flow') + '='));
  }
});

test('provider callback refusal reveals no raw provider query or error detail', async () => {
  const flow = setup(); const req = request('callback'); req.query.error = 'access_denied'; req.query.error_description = 'synthetic-private-info';
  const result = response(); await flow.handler(req, result);
  assert.equal(result.headers.Location, '/?ox_auth=error&ox_auth_reason=provider_denied&ox_auth_provider=access_denied');
  assert.equal(flow.exchanges, 0);
  assert.ok(!JSON.stringify(result).includes('synthetic-private-info'));
});

test('provider callback exposes only allowlisted codes before cookie or token exchange', async () => {
  for (const [code, expected] of [['unexpected_failure', 'unexpected_failure'], ['bad_oauth_state', 'bad_oauth_state'], ['synthetic-private-user-detail', 'server_error']]) {
    const flow = setup(); const req = request('callback');
    req.query.error = 'server_error'; req.query.error_code = code; req.query.error_description = 'synthetic-private-description';
    const result = response(); await flow.handler(req, result);
    assert.equal(flow.exchanges, 0);
    assert.equal(result.headers.Location, '/?ox_auth=error&ox_auth_reason=provider_callback_error&ox_auth_provider=' + expected);
    assert.ok(!JSON.stringify(result).includes('synthetic-private'));
  }
});

test('expired email link error remains generic and redacts raw details',async()=>{
 const flow=setup();const req=request('callback');req.query.error='access_denied';req.query.error_code='otp_expired';req.query.error_description='synthetic-private-email';
 const result=response();await flow.handler(req,result);assert.equal(result.headers.Location,'/?ox_auth=error&ox_auth_reason=authorization_expired&ox_auth_provider=otp_expired');assert.equal(flow.exchanges,0);assert.ok(!JSON.stringify(result).includes('synthetic-private-email'));
});

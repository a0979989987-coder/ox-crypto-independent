import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, safeReturn, cookie } from '../server/account/cookies.js';
import { createAccountHandler } from '../server/account/handler.js';
import { cookieName } from '../server/account/cookies.js';
const secret = 'mock-session-secret-at-least-32-characters';
const env = { OX_AUTH_SESSION_SECRET: secret, OX_ACCOUNT_ORIGIN: 'https://ox.example', OX_SUPABASE_URL: 'https://mock.supabase.co', OX_SUPABASE_PUBLISHABLE_KEY: 'mock-key' };
function res() { return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(s) { this.statusCode=s; return this; }, json(v) { this.body=v; }, end() {} }; }
const req = (endpoint, body={}, headers={}) => ({ method:'POST', query:{ endpoint }, headers:{ origin:env.OX_ACCOUNT_ORIGIN, 'content-type':'application/json', ...headers }, body });
test('session encryption rejects changes, wrong purpose and expiration', () => {
  const value=seal('provider-token',secret,'access',10,1000);
  assert.equal(unseal(value,secret,'access',2000),'provider-token');
  assert.equal(unseal(value,secret,'refresh',2000),null);
  assert.equal(unseal(value,secret,'access',12000),null);
  const bytes=Buffer.from(value,'base64url'); bytes[30]^=1;
  assert.equal(unseal(bytes.toString('base64url'),secret,'access',2000),null);
  assert.match(cookie('access',value),/Secure; HttpOnly; SameSite=Lax/);
});
test('return locations cannot leave OX or enter API routes', () => {
  for (const value of ['https://evil.example','//evil.example','/\\evil.example','/api/v1/account/callback']) assert.equal(safeReturn(value),'/');
  assert.equal(safeReturn('/?market=crypto#radar'),'/?market=crypto#radar');
});
test('unconfigured and cross-origin requests never call provider', async () => {
  let calls=0; const clientFactory=()=>{calls++; throw Error('unexpected');};
  const a=res(); await createAccountHandler({env:{},clientFactory})(req('email',{email:'member@example.com'}),a); assert.equal(a.statusCode,503);
  const b=res(); await createAccountHandler({env,clientFactory})(req('verify',{email:'member@example.com',token:'123456'},{origin:'https://evil.example'}),b); assert.equal(b.statusCode,403); assert.equal(calls,0);
});
test('verified email issues opaque cookies and exposes no provider tokens', async () => {
  const user={id:'account-1',email:'member@example.com',created_at:'2026-09-30T00:00:00Z',identities:[{provider:'email'}],user_metadata:{}};
  const handler=createAccountHandler({env,limiter:()=>true,clientFactory:()=>({auth:{verifyOtp:async()=>({data:{user,session:{access_token:'private-access-token',refresh_token:'private-refresh-token'}}})}})});
  const r=res(); await handler(req('verify',{email:user.email,token:'123456'}),r);
  assert.equal(r.body.user.id,user.id); assert.equal(r.body.user.cryptoFull,false);
  assert.ok(!JSON.stringify(r.body).includes('token'));
  assert.ok(!r.headers['Set-Cookie'].join().includes('private-access-token'));
});
test('invalid provider verification cannot create identity', async () => {
  const handler=createAccountHandler({env,limiter:()=>true,clientFactory:()=>({auth:{verifyOtp:async()=>({error:{message:'secret upstream detail'},data:{}})}})});
  const r=res(); await handler(req('verify',{email:'member@example.com',token:'123456'}),r); assert.equal(r.statusCode,400); assert.equal(r.headers['Set-Cookie'],undefined); assert.ok(!JSON.stringify(r.body).includes('upstream'));
});
test('OAuth callback without matching PKCE flow is rejected', async () => {
  let calls=0;
  const handler=createAccountHandler({env,clientFactory:()=>({auth:{exchangeCodeForSession:async()=>{ calls++; }}})});
  const r=res(); await handler({method:'GET',query:{endpoint:'callback',code:'code'},headers:{}},r);
  assert.equal(calls,0); assert.equal(r.statusCode,303); assert.equal(r.headers.Location,'/?ox_auth=error&ox_auth_reason=flow_missing');
});
test('SDK generates PKCE flow bound to encrypted cookie and callback preserves page', async () => {
  let capturedStorage;
  const factory=(url,key,options)=> {
    capturedStorage=options.auth.storage;
    return {auth:{
      signInWithOAuth:async()=>{capturedStorage.setItem('mock-verifier','random-verifier'); return {data:{url:'https://mock.supabase.co/auth/v1/authorize?provider=google'}};},
      exchangeCodeForSession:async()=>{
        assert.equal(capturedStorage.getItem('mock-verifier'),'random-verifier');
        return {data:{user:{id:'verified-user'},session:{access_token:'access',refresh_token:'refresh'}}};
      }
    }};
  };
  const handler=createAccountHandler({env,clientFactory:factory,limiter:()=>true});
  const start=res(); await handler(req('google',{returnTo:'/?market=crypto#radar'}),start);
  assert.equal(start.body.ok,true);
  const rawCookie=start.headers['Set-Cookie'].split(';')[0];
  assert.ok(!rawCookie.includes('random-verifier'));
  const callback=res(); await handler({method:'GET',query:{endpoint:'callback',code:'provider-code'},headers:{cookie:rawCookie}},callback);
  assert.equal(callback.headers.Location,'/?market=crypto&ox_auth=success#radar'); assert.equal(callback.statusCode,303);
});
test('email magic link keeps the PKCE verifier in an encrypted flow cookie and returns to the original page', async () => {
  let capturedStorage, emailOptions;
  const factory=(url,key,options)=> {
    capturedStorage=options.auth.storage;
    return {auth:{
      signInWithOtp:async(input)=>{ emailOptions=input; capturedStorage.setItem('email-verifier','one-time-verifier'); return {error:null}; },
      exchangeCodeForSession:async()=>{ assert.equal(capturedStorage.getItem('email-verifier'),'one-time-verifier'); return {data:{user:{id:'email-user'},session:{access_token:'a',refresh_token:'r'}}}; }
    }};
  };
  const handler=createAccountHandler({env,clientFactory:factory,limiter:()=>true});
  const start=res(); await handler(req('email',{email:'member@example.com',register:true,returnTo:'/?market=tw#radar'}),start);
  assert.equal(emailOptions.options.shouldCreateUser,true);
  assert.equal(emailOptions.options.emailRedirectTo,env.OX_ACCOUNT_ORIGIN+'/api/v1/account/callback');
  assert.match(start.body.message,/登入連結/);
  const rawCookie=start.headers['Set-Cookie'].split(';')[0]; assert.ok(!rawCookie.includes('one-time-verifier'));
  const callback=res(); await handler({method:'GET',query:{endpoint:'callback',code:'email-code'},headers:{cookie:rawCookie}},callback);
  assert.equal(callback.headers.Location,'/?market=tw&ox_auth=success#radar');
});
test('provider failure and forged encrypted cookies confer no session', async () => {
  let called=false;
  const handler=createAccountHandler({env,clientFactory:()=>({auth:{getUser:async()=>{called=true;}}})});
  const r=res(); await handler({method:'GET',query:{endpoint:'session'},headers:{cookie:'__Host-ox-account-access=forged; __Host-ox-account-refresh=forged'}},r);
  assert.equal(called,false); assert.equal(r.body.user,null);
});

const sessionRequest = () => ({ method: 'GET', query: { endpoint: 'session' }, headers: { cookie: ['access', 'refresh'].map(kind => `${cookieName(kind)}=${seal(kind + '-private', secret, kind)}`).join('; ') } });

test('member storage uses the validated user JWT with RLS and distinguishes missing/error rows', async () => {
  const user = { id: 'member-id', email: 'member@example.com', identities: [] };
  for (const [result, expected] of [[{ data: { id: user.id } }, 'stored'], [{ data: null }, 'missing'], [{ error: { message: 'private database detail' } }, 'unverified']]) {
    const handler = createAccountHandler({ env, clientFactory: (url, key, options) => options.global ? {
      from(table) { assert.equal(table, 'ox_accounts'); assert.equal(options.global.headers.Authorization, 'Bearer access-private'); return {
        select(columns) { assert.equal(columns, 'id'); return this; },
        eq(column, value) { assert.equal(column, 'id'); assert.equal(value, user.id); return this; },
        async maybeSingle() { return result; }
      }; }
    } : { auth: { getUser: async token => { assert.equal(token, 'access-private'); return { data: { user } }; } } } });
    const r = res(); await handler(sessionRequest(), r);
    assert.equal(r.body.user.accountStorage, expected);
    assert.equal(r.body.user.cryptoFull, false);
    assert.ok(!JSON.stringify(r.body).includes('private'));
  }
});

test('refresh verifies the new token with provider before querying membership', async () => {
  let readToken;
  const handler = createAccountHandler({ env, clientFactory: (url, key, options) => options.global ? {
    from() { readToken = options.global.headers.Authorization; return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'verified' } }) }; }
  } : { auth: {
    getUser: async token => token === 'new-access' ? { data: { user: { id: 'verified' } } } : { error: {} },
    refreshSession: async () => ({ data: { user: { id: 'untrusted-claims' }, session: { access_token: 'new-access', refresh_token: 'new-refresh' } } })
  } } });
  const r = res(); await handler(sessionRequest(), r);
  assert.equal(r.body.user.id, 'verified'); assert.equal(readToken, 'Bearer new-access');
  assert.equal(r.headers['Set-Cookie'].length, 3);
});

test('logout clears all cookies despite provider network or construction failures', async () => {
  for (const clientFactory of [() => { throw Error('private SDK error'); }, () => ({ auth: { setSession: async () => { throw Error('network'); } } })]) {
    const r = res(); const request = req('logout'); request.headers.cookie = sessionRequest().headers.cookie;
    await createAccountHandler({ env, clientFactory, limiter: () => true })(request, r);
    assert.equal(r.body.ok, true); assert.equal(r.headers['Set-Cookie'].length, 3);
    assert.ok(r.headers['Set-Cookie'].every(value => value.includes('Max-Age=0')));
  }
});

test('unknown routes and rate limits stop before SDK construction', async () => {
  let calls = 0; const clientFactory = () => { calls++; throw Error('unexpected'); };
  const handler = createAccountHandler({ env, clientFactory, limiter: () => false });
  const unknown = res(); await handler(req('unknown'), unknown); assert.equal(unknown.statusCode, 404);
  const limited = res(); await handler(req('email', { email: 'member@example.com' }), limited); assert.equal(limited.statusCode, 429);
  assert.equal(calls, 0);
});

test('real Supabase SDK generates PKCE without an outbound provider request', async () => {
  const r = res(); await createAccountHandler({ env, limiter: () => true })(req('google', { returnTo: '/' }), r);
  assert.equal(r.body.ok, true);
  const authorize = new URL(r.body.url);
  assert.equal(authorize.origin, env.OX_SUPABASE_URL);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const flow = unseal(r.headers['Set-Cookie'].split(';')[0].split('=')[1], secret, 'flow');
  assert.ok(Object.keys(flow.storage).some(key => key.endsWith('code-verifier')));
});

test('email rate limits return explicit 429 without private provider details',async()=>{
 for(const error of [{status:429,code:'over_email_send_rate_limit',message:'private-details'},{status:400,code:'over_request_rate_limit',message:'private-details'}]){
  const clientFactory=()=>({auth:{signInWithOtp:async()=>({error})}});const result=res();await createAccountHandler({env,clientFactory,limiter:()=>true})(req('email',{email:'member@example.test',register:true}),result);assert.equal(result.statusCode,429);assert.equal(result.body.code,'EMAIL_RATE_LIMITED');assert.equal(result.body.cooldownSeconds,60);assert.ok(!JSON.stringify(result.body).includes('private-details'));
 }
});

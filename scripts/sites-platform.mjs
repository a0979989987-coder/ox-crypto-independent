// What ChatGPT Sites does in front of the Worker, for local runs and tests:
//   - files in the client folder are served first; the Worker sees everything else
//     (data files are not files there: they live under _seed/ and follow the R2 release),
//   - a visitor can never send the signed-in headers (oai-authenticated-*) itself,
//   - /signin-with-chatgpt signs the owner in; locally OX_DEV_ADMIN=email plays that owner.
// Plus a fake Google sign-in for local tests only (OX_DEV_FAKE_GOOGLE=1). The Worker code is
// unchanged by it: the fake answers where Google would, outside the Worker.
import { createHash, randomBytes } from 'node:crypto';
export const SIGNED_IN = /^oai-authenticated-/i;
export function platformHeaders(raw, { devAdmin } = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw || {})) {
    if (SIGNED_IN.test(name)) continue;
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  if (devAdmin) headers.set('oai-authenticated-user-email', devAdmin);
  return headers;
}
// Paths the platform answers from the client folder (the Worker never sees them).
export const isWorkerOnly = path => /^\/(?:data|previews\/data)\/.+\.json(?:\.gz)?$/.test(path) || path.startsWith('/api/');

const b64url = buf => Buffer.from(buf).toString('base64url');
export const TEST_ACCOUNTS = [
  { sub: '1001', email: 'fan@example.com', name: '小明', picture: null },
  { sub: '1002', email: 'hua@example.com', name: '阿華', picture: null }
];
export function fakeGoogle({ clientId, clientSecret, accounts = TEST_ACCOUNTS, now = Date.now } = {}) {
  const grants = new Map(), codes = new Map();
  const page = (title, body) => new Response(`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f4f5f7;color:#222;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;border-radius:16px;padding:22px 24px;box-shadow:0 6px 30px #0002;width:min(360px,90vw)}a{display:block;margin:10px 0;padding:10px 14px;border:1px solid #ccd;border-radius:10px;color:inherit;text-decoration:none}small{color:#777}</style></head><body><main>${body}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  return {
    // The Worker's redirect to accounts.google.com becomes this local chooser.
    rewriteLocation(location, origin) {
      if (!location?.startsWith('https://accounts.google.com/o/oauth2/v2/auth')) return location;
      const ask = new URL(location), id = b64url(randomBytes(9));
      grants.set(id, Object.fromEntries(ask.searchParams));
      return origin + '/__dev/google?grant=' + id;
    },
    page(url) {
      const grant = grants.get(url.searchParams.get('grant') || '');
      if (!grant) return page('測試登入', '<p>這個測試登入已失效，請回網站重新按登入。</p>');
      if (url.pathname === '/__dev/google') {
        const list = accounts.map((a, i) => `<a href="/__dev/google/pick?grant=${url.searchParams.get('grant')}&who=${i}"><b>${a.name}</b><br><small>${a.email}</small></a>`).join('');
        return page('測試登入', `<p><b>本機測試用的 Google 登入</b><br><small>不會連到真的 Google</small></p>${list}<a href="/__dev/google/pick?grant=${url.searchParams.get('grant')}&who=cancel"><small>取消</small></a>`);
      }
      grants.delete(url.searchParams.get('grant'));
      const back = new URL(grant.redirect_uri); back.searchParams.set('state', grant.state);
      const who = url.searchParams.get('who');
      if (who === 'cancel' || !accounts[Number(who)]) { back.searchParams.set('error', 'access_denied'); return Response.redirect(back.href, 302); }
      const code = b64url(randomBytes(18));
      codes.set(code, { ...grant, account: accounts[Number(who)] });
      back.searchParams.set('code', code);
      return Response.redirect(back.href, 302);
    },
    // Google's token endpoint: checks the client, the redirect and the PKCE verifier.
    token(init) {
      const form = new URLSearchParams(String(init?.body || '')), saved = codes.get(form.get('code') || '');
      codes.delete(form.get('code') || '');
      const challenge = saved && createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (!saved || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret || form.get('redirect_uri') !== saved.redirect_uri || challenge !== saved.code_challenge)
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const seconds = Math.floor(now() / 1000), a = saved.account;
      const claims = { iss: 'https://accounts.google.com', aud: clientId, azp: clientId, sub: a.sub, email: a.email, email_verified: true, name: a.name, ...(a.picture ? { picture: a.picture } : {}), nonce: saved.nonce, iat: seconds, exp: seconds + 3600 };
      return Response.json({ id_token: [b64url('{"alg":"none"}'), b64url(JSON.stringify(claims)), 'local'].join('.'), token_type: 'Bearer', expires_in: 3600 });
    }
  };
}

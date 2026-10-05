import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BitgetLookupError, createBitgetAffiliateClient } from './affiliate.js';
import { renderOperatorPage, TEST_PATH, COOKIE_PATH } from './operator-page.js';

const COOKIE = '__Secure-ox-bitget-test';
const TTL = 600;
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const sign = (token, value) => createHmac('sha256', token).update('ox-bitget-operator-v1:' + value).digest('base64url');
// Per-instance burst protection only; not a distributed/global rate limiter.
const attempts = new Map();
function allowAttempt(key, now) {
  if (attempts.size >= 1000) {
    for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
    if (attempts.size >= 1000 && !attempts.has(key)) return false;
  }
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) { attempts.set(key, { count: 1, until: now + 60000 }); return true; }
  entry.count += 1;
  return entry.count <= 5;
}

export function createTestHandler({ env = process.env, createClient = createBitgetAffiliateClient, now = Date.now, limit = allowAttempt } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const token = env.OX_ACCOUNT_LOOKUP_TOKEN;
    const loginChallenge = () => {
      const payload = Buffer.from(JSON.stringify({ exp: now() + 300000, nonce: randomBytes(24).toString('hex') })).toString('base64url');
      return payload + '.' + sign(token, 'login:' + payload);
    };
    const page = (status, data = {}) => res.status(status).send(renderOperatorPage({ ...data, ...(!data.session && typeof token === 'string' && token.length >= 32 ? { loginChallenge: loginChallenge() } : {}) }));
    if (typeof token !== 'string' || token.length < 32) return page(503, { message: '管理端查詢尚未啟用，請確認伺服器設定。' });
    const signatureCookie = value => `${COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? TTL : 0}`;
    const redirect = () => { res.setHeader('Location', TEST_PATH); return res.status(303).end(); };
    const raw = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
    let session;
    if (raw.length < 1024) {
      const [payload, signature, extra] = raw.split('.');
      if (payload && signature && !extra && equal(signature, sign(token, payload))) {
        try {
          const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
          if (Number.isSafeInteger(value.exp) && value.exp > now() && value.exp <= now() + TTL * 1000 && /^[a-f0-9]{48}$/.test(value.nonce)) session = value;
        } catch { /* Invalid cookies confer no access. */ }
      }
    }
    if (req.method === 'GET') return page(200, { session });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return page(405, { message: '請使用頁面上的表單。' }); }
    // Some embedded browsers rewrite Origin on a normal same-page form POST.
    // Login uses a short-lived signed form challenge; authenticated actions
    // require the session's CSRF nonce and SameSite=Strict cookie below.
    if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return page(415, { message: '表單格式不正確。' });
    let body;
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body) > 2048) return page(413, { message: '表單內容過長。' });
      const params = new URLSearchParams(req.body);
      if (new Set(params.keys()).size !== [...params.keys()].length) return page(400, { message: '表單欄位重複。' });
      body = Object.fromEntries(params);
    } else body = req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > 2048 || Object.values(body).some(value => typeof value !== 'string') || Object.keys(body).some(key => !['action', 'password', 'uid', 'csrf', 'challenge'].includes(key))) return page(400, { message: '表單格式不正確。' });
    if (body.action === 'login') {
      const [challengePayload, signature, extra] = String(body.challenge || '').split('.');
      let validChallenge = false;
      if (challengePayload && signature && !extra && challengePayload.length < 256 && equal(signature, sign(token, 'login:' + challengePayload))) {
        try {
          const challenge = JSON.parse(Buffer.from(challengePayload, 'base64url').toString());
          validChallenge = Number.isSafeInteger(challenge.exp) && challenge.exp > now() && challenge.exp <= now() + 300000 && /^[a-f0-9]{48}$/.test(challenge.nonce);
        } catch { /* Invalid challenges confer no access. */ }
      }
      if (!validChallenge) return page(403, { message: '頁面已過期，請用新畫面再輸入一次。' });
      const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
      if (!limit(createHash('sha256').update(ip).digest('hex'), now())) { res.setHeader('Retry-After', '60'); return page(429, { message: '嘗試次數較多，請等一分鐘再試。' }); }
      if (typeof body.password !== 'string' || !equal(body.password, token)) return page(401, { message: '查詢密碼不正確。請使用 Vercel 中 OX_ACCOUNT_LOOKUP_TOKEN 的值。' });
      const payload = Buffer.from(JSON.stringify({ exp: now() + TTL * 1000, nonce: randomBytes(24).toString('hex') })).toString('base64url');
      res.setHeader('Set-Cookie', signatureCookie(payload + '.' + sign(token, payload)));
      return redirect();
    }
    if (!session) return page(401, { message: '測試授權已到期或尚未登入，請重新輸入查詢密碼。' });
    if (!body.csrf || !equal(body.csrf, session.nonce)) return page(403, { session, message: '表單已失效，請重新送出。' });
    if (body.action === 'logout') { res.setHeader('Set-Cookie', signatureCookie('')); return redirect(); }
    if (body.action !== 'lookup') return page(400, { session, message: '不支援此操作。' });
    if (!limit('query:' + session.nonce, now())) { res.setHeader('Retry-After', '60'); return page(429, { session, message: '查詢次數較多，請等一分鐘再試。' }); }
    try {
      const result = await createClient({ env }).lookupCustomer({ uid: body.uid });
      return page(200, { session, result, uid: body.uid });
    } catch (error) {
      const message = error instanceof BitgetLookupError ? error.message + (error.upstreamCode ? `（代碼 ${error.upstreamCode}）` : '') : '暫時無法完成查詢，請稍後再試。';
      return page(error instanceof BitgetLookupError ? error.status : 500, { session, message, uid: body.uid });
    }
  };
}

export default createTestHandler();

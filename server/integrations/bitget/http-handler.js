import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BitgetLookupError, createBitgetAffiliateClient } from './affiliate.js';
import { createTestHandler } from './operator-handler.js';

// Operator-only service endpoint until OX's real admin/session layer is connected.
// Never embed OX_ACCOUNT_LOOKUP_TOKEN in frontend code or browser storage.
//
// One shared token can look up any UID, so the whole bitget-status endpoint
// (JSON API and ?view=test page) is OFF unless OX_ENABLE_OPERATOR_LOOKUP === '1'.
// Day-to-day lookups belong to /api/v1/account/bitget-admin-lookup, which
// requires a signed-in OX administrator session.
export const OPERATOR_LOOKUP_FLAG = 'OX_ENABLE_OPERATOR_LOOKUP';
export const operatorLookupEnabled = env => env?.[OPERATOR_LOOKUP_FLAG] === '1';
const DISABLED_MESSAGE = '此維運查詢預設關閉，請改用管理後台（bitget-admin-lookup）。';

// Per-instance burst protection only; not a distributed/global rate limiter.
export function createRateLimiter({ limit = 10, windowMs = 60000, maxKeys = 1000 } = {}) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    if (buckets.size >= maxKeys) {
      for (const [id, entry] of buckets) if (entry.until <= now) buckets.delete(id);
      if (buckets.size >= maxKeys && !buckets.has(key)) return false;
    }
    const entry = buckets.get(key);
    if (!entry || entry.until <= now) { buckets.set(key, { count: 1, until: now + windowMs }); return true; }
    entry.count += 1;
    return entry.count <= limit;
  };
}

// Audit lines never contain the UID, token or IP in clear text. Identifiers are
// HMAC-SHA256 keyed with the operator token, so someone holding the token can
// check whether a specific UID/IP appears, but the log alone cannot be brute-forced.
export function auditDigest(token, kind, value) {
  if (typeof token !== 'string' || !token || typeof value !== 'string' || !value) return null;
  return createHmac('sha256', token).update(`ox-bitget-audit-v1:${kind}:${value}`).digest('hex').slice(0, 16);
}
export function createAuditLogger({ env = process.env, log = line => console.info(line), now = Date.now } = {}) {
  return ({ channel, outcome, status, uid, ip }) => {
    const token = env.OX_ACCOUNT_LOOKUP_TOKEN;
    log(JSON.stringify({
      event: 'ox.bitget_operator_lookup', channel, outcome, status,
      uidHash: auditDigest(token, 'uid', typeof uid === 'string' ? uid : ''),
      requesterHash: auditDigest(token, 'ip', ip || ''),
      at: new Date(now()).toISOString()
    }));
  };
}
const clientAddress = req => String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

const defaultLimit = createRateLimiter({ limit: 10 });
export function createHandler({ env = process.env, createClient = createBitgetAffiliateClient, limit = defaultLimit, audit = createAuditLogger({ env }), now = Date.now } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => res.status(status).json(body);
    if (!operatorLookupEnabled(env)) {
      return reply(404, { ok: false, code: 'OPERATOR_LOOKUP_DISABLED', message: DISABLED_MESSAGE });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '請使用 POST 查詢。' });
    }
    const expected = env.OX_ACCOUNT_LOOKUP_TOKEN;
    if (typeof expected !== 'string' || expected.length < 32) {
      return reply(503, { ok: false, code: 'LOOKUP_DISABLED', message: '管理端查詢尚未啟用。' });
    }
    const ip = clientAddress(req);
    // Throttle before checking the token so it cannot be guessed at full speed.
    if (!limit('api:' + createHash('sha256').update(ip).digest('hex'), now())) {
      audit({ channel: 'api', outcome: 'rate_limited', status: 429, ip });
      res.setHeader('Retry-After', '60');
      return reply(429, { ok: false, code: 'RATE_LIMITED', message: '查詢次數較多，請等一分鐘再試。' });
    }
    const authorization = req.headers?.authorization;
    const supplied = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const hash = value => createHash('sha256').update(value).digest();
    if (!supplied || !timingSafeEqual(hash(supplied), hash(expected))) {
      audit({ channel: 'api', outcome: 'unauthorized', status: 401, ip });
      return reply(401, { ok: false, code: 'UNAUTHORIZED', message: '此查詢需要管理端授權。' });
    }
    if (req.headers?.['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { ok: false, code: 'JSON_REQUIRED', message: '請使用 JSON 格式。' });
    }
    let uid;
    try {
      const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (Buffer.byteLength(serialized) > 2048) throw new BitgetLookupError('INVALID_REQUEST', '請求內容過長。', 400);
      let body;
      try { body = JSON.parse(serialized); } catch { throw new BitgetLookupError('INVALID_REQUEST', 'JSON 格式錯誤。', 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['uid', 'startTime', 'endTime'].includes(key))) {
        throw new BitgetLookupError('INVALID_REQUEST', '查詢僅接受 UID 與認證時間區間。', 400);
      }
      uid = typeof body.uid === 'string' ? body.uid : undefined;
      const result = await createClient({ env }).lookupCustomer(body);
      audit({ channel: 'api', outcome: 'ok', status: 200, uid, ip });
      return reply(200, { ok: true, data: result });
    } catch (error) {
      if (error instanceof BitgetLookupError) {
        audit({ channel: 'api', outcome: error.code, status: error.status, uid, ip });
        if (error.code === 'BITGET_RATE_LIMITED') res.setHeader('Retry-After', '60');
        return reply(error.status, { ok: false, code: error.code, message: error.message, ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}) });
      }
      audit({ channel: 'api', outcome: 'LOOKUP_FAILED', status: 500, uid, ip });
      return reply(500, { ok: false, code: 'LOOKUP_FAILED', message: '暫時無法完成查詢。' });
    }
  };
}

// Shares one Vercel function; JSON/Bearer clients retain the existing contract.
export function createBitgetStatusHandler({ env = process.env, apiHandler = createHandler({ env }), operatorHandler = createTestHandler({ env, audit: createAuditLogger({ env }) }) } = {}) {
  return function handler(req, res) {
    const view = new URL(req.url || '/', 'https://ox.invalid').searchParams.get('view');
    if (view === 'test' && !operatorLookupEnabled(env)) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.status(404).send(DISABLED_MESSAGE);
    }
    return view === 'test' ? operatorHandler(req, res) : apiHandler(req, res);
  };
}

export default createBitgetStatusHandler();

import { createHash, timingSafeEqual } from 'node:crypto';
import { BitgetLookupError, createBitgetAffiliateClient } from './affiliate.js';
import { createTestHandler } from './operator-handler.js';

// Operator-only service endpoint until OX's real admin/session layer is connected.
// Never embed OX_ACCOUNT_LOOKUP_TOKEN in frontend code or browser storage.
export function createHandler({ env = process.env, createClient = createBitgetAffiliateClient } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => res.status(status).json(body);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '請使用 POST 查詢。' });
    }
    const expected = env.OX_ACCOUNT_LOOKUP_TOKEN;
    if (typeof expected !== 'string' || expected.length < 32) {
      return reply(503, { ok: false, code: 'LOOKUP_DISABLED', message: '管理端查詢尚未啟用。' });
    }
    const authorization = req.headers?.authorization;
    const supplied = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const hash = value => createHash('sha256').update(value).digest();
    if (!supplied || !timingSafeEqual(hash(supplied), hash(expected))) {
      return reply(401, { ok: false, code: 'UNAUTHORIZED', message: '此查詢需要管理端授權。' });
    }
    if (req.headers?.['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { ok: false, code: 'JSON_REQUIRED', message: '請使用 JSON 格式。' });
    }
    try {
      const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (Buffer.byteLength(serialized) > 2048) throw new BitgetLookupError('INVALID_REQUEST', '請求內容過長。', 400);
      let body;
      try { body = JSON.parse(serialized); } catch { throw new BitgetLookupError('INVALID_REQUEST', 'JSON 格式錯誤。', 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['uid', 'startTime', 'endTime'].includes(key))) {
        throw new BitgetLookupError('INVALID_REQUEST', '查詢僅接受 UID 與認證時間區間。', 400);
      }
      const result = await createClient({ env }).lookupCustomer(body);
      return reply(200, { ok: true, data: result });
    } catch (error) {
      if (error instanceof BitgetLookupError) {
        if (error.code === 'BITGET_RATE_LIMITED') res.setHeader('Retry-After', '60');
        return reply(error.status, { ok: false, code: error.code, message: error.message, ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}) });
      }
      return reply(500, { ok: false, code: 'LOOKUP_FAILED', message: '暫時無法完成查詢。' });
    }
  };
}

const apiHandler = createHandler();
const operatorHandler = createTestHandler();
export default function handler(req, res) {
  // Share one Vercel function; JSON/Bearer clients retain the existing contract.
  const view = new URL(req.url || '/', 'https://ox.invalid').searchParams.get('view');
  return view === 'test' ? operatorHandler(req, res) : apiHandler(req, res);
}

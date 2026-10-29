// Read-only check whether a Bitget UID is one of the owner's referral customers, for
// the admin page's Bitget UID review. Ported from server/integrations/bitget/affiliate.js
// (same requests, same signing) to Web Crypto, so it runs in the Sites Worker.
// Needs the secrets BITGET_AFFILIATE_API_KEY, BITGET_AFFILIATE_SECRET_KEY and
// BITGET_AFFILIATE_PASSPHRASE; BITGET_AFFILIATE_REFERRAL_CODE is optional.
const ORIGIN = 'https://api.bitget.com';
const CUSTOMER_PATH = '/api/v2/broker/customer-list';
const KYC_PATH = '/api/v2/broker/customer-kyc-result';
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
// Bitget UIDs are whole numbers; 6 to 20 digits, no leading zero.
export const UID = /^[1-9]\d{5,19}$/;

export class BitgetCheckError extends Error {
  constructor(code, message, upstreamCode = null) { super(message); this.code = code; this.upstreamCode = upstreamCode; }
}
const malformed = () => new BitgetCheckError('BITGET_INVALID_RESPONSE', 'Bitget 回傳格式異常，無法判定結果。');
const responseUid = uid => {
  if (typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0) return String(uid);
  if (typeof uid === 'string' && /^[1-9]\d{0,19}$/.test(uid)) return uid;
  throw malformed();
};
export const bitgetConfigured = env => ['BITGET_AFFILIATE_API_KEY', 'BITGET_AFFILIATE_SECRET_KEY', 'BITGET_AFFILIATE_PASSPHRASE'].every(name => typeof env?.[name] === 'string' && env[name].trim());

// HMAC-SHA256 over timestamp + METHOD + path (+ ?query) + body, base64 (Bitget API v2).
export async function signBitget({ secretKey, timestamp, method, requestPath, query = '', body = '' }) {
  const payload = timestamp + method.toUpperCase() + requestPath + (query ? `?${query}` : '') + body;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return btoa(String.fromCharCode(...signature));
}

export function createBitgetChecker({ env, fetcher = fetch, now = Date.now } = {}) {
  if (!bitgetConfigured(env)) throw new BitgetCheckError('BITGET_NOT_CONFIGURED', '自動查詢未設定');
  const apiKey = env.BITGET_AFFILIATE_API_KEY.trim(), secretKey = env.BITGET_AFFILIATE_SECRET_KEY.trim(), passphrase = env.BITGET_AFFILIATE_PASSPHRASE.trim();
  const referralCode = env.BITGET_AFFILIATE_REFERRAL_CODE?.trim() || '';
  async function request(method, path, params) {
    const query = method === 'GET' ? new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString() : '';
    const body = method === 'POST' ? JSON.stringify(params) : '';
    const timestamp = String(now());
    let response;
    try {
      response = await fetcher(ORIGIN + path + (query ? `?${query}` : ''), {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { 'ACCESS-KEY': apiKey, 'ACCESS-PASSPHRASE': passphrase, 'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-SIGN': await signBitget({ secretKey, timestamp, method, requestPath: path, query, body }), 'Content-Type': 'application/json', locale: 'zh-CN' },
        ...(body ? { body } : {})
      });
    } catch { throw new BitgetCheckError('BITGET_UNAVAILABLE', '暫時無法連接 Bitget，請稍後再試。'); }
    if (response.status === 429) throw new BitgetCheckError('BITGET_RATE_LIMITED', 'Bitget 查詢太頻繁，請稍後再試。');
    if (!response.ok) throw new BitgetCheckError('BITGET_HTTP_ERROR', 'Bitget 拒絕查詢，請確認 API 金鑰權限。');
    let data; try { data = await response.json(); } catch { throw malformed(); }
    if (!data || typeof data.code !== 'string') throw malformed();
    // Never relay upstream messages, credentials, headers or raw bodies.
    if (data.code !== '00000') throw new BitgetCheckError('BITGET_API_ERROR', 'Bitget 沒有完成查詢，請依錯誤代碼確認 API 權限或時間設定。', /^\d{5,6}$/.test(data.code) ? data.code : null);
    return data.data;
  }
  async function check(uid) {
    if (typeof uid !== 'string' || !UID.test(uid)) throw new BitgetCheckError('INVALID_UID', 'UID 格式不正確');
    const end = now(), window = { startTime: String(end - WINDOW_MS), endTime: String(end) };
    // No registration-date filter, so older referral customers are found too.
    const customers = await request('POST', CUSTOMER_PATH, { uid, ...(referralCode ? { referralCode } : {}) });
    if (!Array.isArray(customers) || customers.some(row => !row || responseUid(row.uid) !== uid)) throw malformed();
    const customer = customers[0];
    const registered = typeof customer?.registerTime === 'string' && /^\d{1,16}$/.test(customer.registerTime) ? Number(customer.registerTime) : NaN;
    const result = { uid, referral: customer ? 'matched' : 'not_found', referralCodeFilter: !!referralCode,
      registeredAt: Number.isSafeInteger(registered) && registered > 0 && registered <= end ? new Date(registered).toISOString() : null,
      kyc: 'not_checked', checkedAt: null };
    // A missing referral does not prove the UID is not on Bitget; it is only not under this account.
    if (customer) {
      const data = await request('GET', KYC_PATH, { uid, ...window, showSub: 'no', limit: '100' });
      if (!data || !Array.isArray(data.userList) || data.userList.some(row => !row || responseUid(row.uid) !== uid)) throw malformed();
      const results = new Set(data.userList.map(row => row.kycResult)), first = data.userList[0];
      result.kyc = first && results.size === 1 && ['passed', 'not_passed'].includes(first.kycResult) ? first.kycResult : 'unknown';
    }
    result.checkedAt = new Date(end).toISOString();
    return result;
  }
  return Object.freeze({ check });
}

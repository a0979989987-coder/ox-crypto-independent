import { createHmac } from 'node:crypto';

// Server-only, read-only Affiliate adapter. Independent of public market feeds.
const ORIGIN = 'https://api.bitget.com';
const CUSTOMER_PATH = '/api/v2/broker/customer-list';
const KYC_PATH = '/api/v2/broker/customer-kyc-result';
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export class BitgetLookupError extends Error {
  constructor(code, message, status = 502, upstreamCode = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.upstreamCode = upstreamCode;
  }
}

const invalid = message => new BitgetLookupError('INVALID_REQUEST', message, 400);
const malformed = () => new BitgetLookupError('BITGET_INVALID_RESPONSE', 'Bitget 回傳格式異常，無法判定結果。');

export function validateUid(uid) {
  if (typeof uid !== 'string' || !/^[1-9]\d{0,19}$/.test(uid)) {
    throw invalid('UID 必須以文字傳入，且只能包含正整數數字。');
  }
  return uid;
}

function responseUid(uid) {
  if (typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0) return String(uid);
  if (typeof uid === 'string' && /^[1-9]\d{0,19}$/.test(uid)) return uid;
  throw malformed();
}

export function kycWindow(startTime, endTime, now = Date.now()) {
  if ((startTime == null) !== (endTime == null)) throw invalid('開始與結束時間必須一起提供。');
  const parseTime = value => {
    if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) throw invalid('時間須使用毫秒時間戳記字串。');
    return Number(value);
  };
  const start = startTime == null ? Math.max(0, now - MAX_WINDOW_MS) : parseTime(startTime);
  const end = endTime == null ? now : parseTime(endTime);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > now || end - start > MAX_WINDOW_MS) {
    throw invalid('認證查詢時間必須有效、不得在未來，且區間不得超過 90 天。');
  }
  return { startTime: String(start), endTime: String(end) };
}

export function signBitget({ secretKey, timestamp, method, requestPath, query = '', body = '' }) {
  const payload = timestamp + method.toUpperCase() + requestPath + (query ? `?${query}` : '') + body;
  return createHmac('sha256', secretKey).update(payload).digest('base64');
}

export function createBitgetAffiliateClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const apiKey = env.BITGET_AFFILIATE_API_KEY;
  const secretKey = env.BITGET_AFFILIATE_SECRET_KEY;
  const passphrase = env.BITGET_AFFILIATE_PASSPHRASE;
  if (![apiKey, secretKey, passphrase].every(value => typeof value === 'string' && value.trim())) {
    throw new BitgetLookupError('BITGET_NOT_CONFIGURED', '尚未設定 Bitget 代理 API 憑證。', 503);
  }
  const referralCode = env.BITGET_AFFILIATE_REFERRAL_CODE?.trim() || '';

  async function request(method, path, params) {
    const query = method === 'GET' ? new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString() : '';
    const body = method === 'POST' ? JSON.stringify(params) : '';
    const timestamp = String(now());
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetchImpl(ORIGIN + path + (query ? `?${query}` : ''), {
        method, redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: {
          'ACCESS-KEY': apiKey,
          'ACCESS-PASSPHRASE': passphrase,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-SIGN': signBitget({ secretKey, timestamp, method, requestPath: path, query, body }),
          'Content-Type': 'application/json', locale: 'zh-CN'
        },
        ...(body ? { body } : {})
      });
      if (response.status === 429) throw new BitgetLookupError('BITGET_RATE_LIMITED', 'Bitget 查詢頻率受限，請稍後重試。', 503);
      if (!response.ok) throw new BitgetLookupError('BITGET_HTTP_ERROR', 'Bitget 拒絕或無法完成查詢，請確認 API 權限與 IP 設定。');
      let json;
      try { json = await response.json(); } catch { throw malformed(); }
      if (!json || typeof json.code !== 'string') throw malformed();
      if (json.code !== '00000') {
        // Never relay upstream messages, credentials, request headers or raw bodies.
        const code = /^\d{5,6}$/.test(json.code) ? json.code : null;
        throw new BitgetLookupError('BITGET_API_ERROR', 'Bitget API 未完成查詢，請依錯誤代碼確認帳號權限、簽章或時間設定。', 502, code);
      }
      return json.data;
    } catch (error) {
      if (error instanceof BitgetLookupError) throw error;
      throw new BitgetLookupError(abort.signal.aborted ? 'BITGET_TIMEOUT' : 'BITGET_UNAVAILABLE', '暫時無法連接 Bitget，請稍後重試。', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async function lookupCustomer({ uid, startTime, endTime }) {
    validateUid(uid);
    const window = kycWindow(startTime, endTime, now());
    // No registration time filter: avoids missing older referral customers.
    const customers = await request('POST', CUSTOMER_PATH, { uid, ...(referralCode ? { referralCode } : {}) });
    if (!Array.isArray(customers)) throw malformed();
    if (customers.some(row => !row || responseUid(row.uid) !== uid)) throw malformed();
    if (new Set(customers.map(row => row.registerTime)).size > 1) throw malformed();
    const customer = customers[0];
    const rawRegisteredAt = customer?.registerTime;
    const registeredMs = typeof rawRegisteredAt === 'string' && /^\d{1,16}$/.test(rawRegisteredAt) ? Number(rawRegisteredAt) : NaN;
    const registeredAt = Number.isSafeInteger(registeredMs) && registeredMs > 0 && registeredMs <= now() ? new Date(registeredMs).toISOString() : null;
    const result = {
      provider: 'bitget', uid,
      referral: { status: customer ? 'matched' : 'not_found', scope: 'direct_customer', referralCodeFilterApplied: Boolean(referralCode) },
      registration: { status: customer ? 'observed' : 'unknown', registeredAt },
      certification: { type: 'kyc_or_kyb', status: 'not_checked', reason: 'referral_not_found', queryWindow: window, updateIntervalSeconds: 300 },
      accountBindingVerified: false,
      accessPolicyChanged: false,
      checkedAt: null
    };
    // An absent referral does not prove the UID is unregistered on Bitget.
    if (customer) {
      const data = await request('GET', KYC_PATH, { uid, ...window, showSub: 'no', limit: '100' });
      if (!data || !Array.isArray(data.userList)) throw malformed();
      if (data.userList.some(row => !row || responseUid(row.uid) !== uid)) throw malformed();
      const record = data.userList[0];
      const conflict = new Set(data.userList.map(row => row.kycResult)).size > 1;
      const known = record && !conflict && ['passed', 'not_passed'].includes(record.kycResult);
      result.certification.status = known ? record.kycResult : 'unknown';
      result.certification.reason = known ? null : conflict ? 'conflicting_results' : record ? 'unrecognized_result' : 'no_record_in_window';
    }
    result.checkedAt = new Date(now()).toISOString();
    return result;
  }

  return Object.freeze({ lookupCustomer });
}

import { BitgetLookupError, createBitgetAffiliateClient } from '../server/integrations/bitget/affiliate.js';

const [uid, startTime, endTime, ...extra] = process.argv.slice(2);
if (!uid || extra.length) {
  console.error('用法：node --env-file=.env.local scripts/check-bitget-customer.mjs UID [開始毫秒 結束毫秒]');
  process.exitCode = 1;
} else {
  try {
    const result = await createBitgetAffiliateClient().lookupCustomer({ uid, startTime, endTime });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const safe = error instanceof BitgetLookupError
      ? { code: error.code, message: error.message, upstreamCode: error.upstreamCode }
      : { code: 'LOOKUP_FAILED', message: '查詢失敗。' };
    console.error(JSON.stringify(safe));
    process.exitCode = 1;
  }
}

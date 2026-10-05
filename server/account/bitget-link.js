import { validateUid } from '../integrations/bitget/affiliate.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseLinkMutation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', 'uid', 'revision'].includes(key))) return null;
  if (!['save', 'remove'].includes(body.action) || !(body.revision === null || (typeof body.revision === 'string' && uuid.test(body.revision)))) return null;
  if (body.action === 'save') { try { validateUid(body.uid); } catch { return null; } }
  if (body.action === 'remove' && Object.hasOwn(body, 'uid')) return null;
  return body;
}

export function publicPendingLink(row) {
  if (!row) return null;
  if (row.ownership_status !== 'pending' || !uuid.test(row.revision || '')) throw new Error('Invalid pending link');
  if (row.uid === null) return null;
  validateUid(row.uid);
  return { uid: row.uid, revision: row.revision, ownershipStatus: 'pending', ownershipVerified: false, affiliateStatus: 'not_checked', kycStatus: 'not_checked', subAffiliateStatus: 'unknown', eligibility: 'unverified', accessPolicyChanged: false };
}

export async function handleBitgetLink({ req, res, reader, memberId }) {
  const reply = (status, body) => res.status(status).json(body);
  try {
    let row;
    if (req.method === 'GET') {
      const result = await reader.from('ox_bitget_links').select('uid,revision,ownership_status').eq('account_id', memberId).maybeSingle();
      if (result.error) throw new Error('Link read unavailable');
      row = result.data;
    } else {
      const mutation = parseLinkMutation(req.body);
      if (!mutation) return reply(400, { ok: false, code: 'INVALID_LINK_REQUEST', message: '請輸入有效 UID，並重新讀取目前連結狀態。' });
      const result = await reader.rpc('ox_set_pending_bitget_link', { p_action: mutation.action, p_uid: mutation.uid ?? null, p_revision: mutation.revision });
      if (result.error) throw new Error('Link write unavailable');
      if (result.data?.code === 'REVISION_CONFLICT') return reply(409, { ok: false, code: 'REVISION_CONFLICT', message: '連結已在其他頁面變更，請重新讀取後再操作。' });
      if (result.data?.code !== 'OK') throw new Error('Invalid link response');
      row = result.data.link;
    }
    return reply(200, { ok: true, link: publicPendingLink(row), revision: row?.revision ?? null, accessPolicyChanged: false });
  } catch {
    // No upstream database details, personal information or keys are reflected.
    return reply(503, { ok: false, code: 'LINK_STORAGE_UNAVAILABLE', message: 'UID 連結儲存服務尚未就緒或暫時無法使用。' });
  }
}

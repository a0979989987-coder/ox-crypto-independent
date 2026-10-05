export const LEVELS = Object.freeze({ ordinary: '普通代理', core: '核心代理' });
export function parseUIDs(input) {
  if (typeof input !== 'string' || input.length > 16000) throw new Error('輸入過長，請分批處理。');
  const tokens = input.trim().split(/[\s,，]+/u).filter(Boolean);
  if (tokens.length > 200) throw new Error('每次最多輸入 200 筆，去重後最多 100 個 UID。');
  const uids = [], invalid = [], seen = new Set(); let duplicates = 0;
  for (const token of tokens) {
    if (!/^[1-9][0-9]{0,19}$/.test(token)) { invalid.push(token); continue; }
    if (seen.has(token)) { duplicates++; continue; }
    seen.add(token); uids.push(token);
  }
  if (uids.length > 100) throw new Error('去重後最多 100 個 UID，請分批處理。');
  return { uids, invalid, duplicates };
}
export function matchClaims(uids, claims) {
  return uids.map(uid => {
    const candidates = claims.filter(c => c.uid === uid);
    const count = candidates.length;
    return { uid, candidates, status: count === 0 ? 'unmatched' : count === 1 ? 'matched' : 'ambiguous',
      accountId: '', level: '', excluded: false };
  });
}
export function confirmation(rows) {
  const entries = [], excluded = [];
  for (const row of rows) {
    if (row.excluded) { excluded.push(row.uid); continue; }
    if (!Object.hasOwn(LEVELS, row.level)) throw new Error(`${row.uid}：請指定代理等級或明確排除。`);
    const matches = row.candidates.filter(c => c.accountId === row.accountId);
    if (matches.length !== 1 || !matches[0].revision) throw new Error(`${row.uid}：請選定並核對一個 OX 會員；無匹配不能核准。`);
    entries.push({ uid: row.uid, accountId: row.accountId, revision: matches[0].revision,
      name: matches[0].name, level: row.level, approvalSource: 'manual_approval', ownershipVerified: false });
  }
  if (!entries.length) throw new Error('至少需要選定一筆可審核會員。');
  return { entries, excluded };
}

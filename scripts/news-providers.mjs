import { eventDay, validDate } from '../src/components/news/model.js';
export const CRYPTO_ASSETS = [
  ['BTC', '比特幣', ['Bitcoin', '比特币'], 'bitcoin'], ['ETH', '以太坊', ['Ethereum', '以太幣', '以太币'], 'ethereum'],
  ['SOL', 'Solana', ['索拉納'], 'solana'], ['APT', 'Aptos', ['阿普托斯'], 'aptos'], ['XRP', 'XRP', ['Ripple', '瑞波'], 'xrp'],
  ['BNB', 'BNB', ['Binance Coin', '幣安幣'], 'bnb'], ['DOGE', '狗狗幣', ['Dogecoin', '狗狗币'], 'dogecoin'],
  ['ADA', 'Cardano', ['艾達幣'], 'cardano'], ['LINK', 'Chainlink', ['鏈結幣'], 'chainlink'], ['AVAX', 'Avalanche', ['雪崩'], 'avalanche'],
  ['AAVE', 'Aave', [], 'aave'], ['UNI', 'Uniswap', [], 'uniswap'], ['NEAR', 'NEAR Protocol', ['NEAR Intents'], 'near'],
  ['SUI', 'Sui', [], 'sui'], ['ARB', 'Arbitrum', [], 'arbitrum'], ['OP', 'Optimism', [], 'optimism'],
  ['USDT', 'Tether', ['泰達幣'], 'tether'], ['USDC', 'USD Coin', [], 'usd-coin'], ['TRX', 'TRON', ['波場'], 'tron']
].map(([symbol, name, aliases, projectId]) => ({ id: `crypto:${projectId}`, market: 'crypto', symbol, name, aliases: [...aliases, projectId], projectId, venueSymbol: ['USDT', 'USDC'].includes(symbol) ? null : `${symbol}USDT` }));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function identifyAssets(title, markets, catalog = []) {
  const assets = [];
  for (const asset of [...catalog, ...CRYPTO_ASSETS]) {
    if (!markets.includes(asset.market)) continue;
    const named = [asset.name, ...(asset.aliases || [])].filter(n => n.length >= 2 && !['near', 'op', 'one', 'gas'].includes(n.toLowerCase())).some(name => /[\u4e00-\u9fff]/.test(name) ? title.includes(name) : new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'i').test(title));
    const symbol = asset.market === 'crypto' ? !['OP', 'NEAR', 'LINK'].includes(asset.symbol) && new RegExp(`(?<![A-Za-z0-9])\\$?${escape(asset.symbol)}(?![A-Za-z0-9])`).test(title)
      : new RegExp(`(?:[（(]\\s*${escape(asset.symbol)}\\s*[）)]|(?:股票|台股|代號|代碼)\\s*${escape(asset.symbol)}(?!\\d))`).test(title);
    if (named || symbol) assets.push(asset);
  }
  return [...new Map(assets.map(a => [a.id, a])).values()];
}
export function rocDate(value) {
  const text = String(value ?? '').trim(), match = text.match(/^(\d{3,4})[\/.-]?(\d{2})[\/.-]?(\d{2})$/);
  if (!match) return null; const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
  const result = `${year}-${match[2]}-${match[3]}`; return validDate(result) ? result : null;
}
export function nullableNumber(value) { if (value === null || value === undefined || String(value).trim() === '' || /^[-—–]|^N\/A$/.test(String(value))) return null; const n = Number(String(value).replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
export function issuerAssets(rows) {
  return rows.map(row => ({ id: `tw:${row['公司代號']}`, market: 'tw', symbol: row['公司代號'], name: row['公司簡稱'], aliases: [row['公司名稱']] })).filter(a => /^\d{4}$/.test(a.symbol) && a.name);
}
function base(id, sourceId, sourceUrl, title, date) { return { id, kind: 'event', sourceId, sourceUrl, link: sourceUrl, title, titleZh: title, translationStatus: 'translated', markets: ['tw'], date, occursAt: null, allDay: true, status: 'date-only', announcementStatus: 'confirmed', originalTimezone: 'Asia/Taipei', impact: { stars: null, reason: '來源未提供重要性分級', ruleVersion: 'unassessed-v1' } }; }
export function dividends(rows, updatedAt) {
  return rows.map(row => {
    const date = rocDate(row.Date), symbol = String(row.Code || ''), company = row.Name;
    if (!date || !symbol || !company) return null;
    const item = base(`twse-dividend:${symbol}:${date}`, 'twse-dividends', 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL', `${company}（${symbol}）除權息預告`, date);
    return { ...item, category: 'dividend-preview', shortTitle: `${company}除息`, announcementStatus: 'preview', company, symbol, exDividendDate: date,
      cashDividend: nullableNumber(row.CashDividend), stockDividend: null, stockDividendRatio: nullableNumber(row.StockDividendRatio), totalDividend: null, paymentDate: null, announcedDate: null,
      assets: [{ id: `tw:${symbol}`, market: 'tw', symbol, name: company }], updatedAt };
  }).filter(Boolean);
}
export function holidays(rows, updatedAt) {
  return rows.map(row => { const date = rocDate(row.Date); if (!date || !row.Name) return null; return { ...base(`twse-holiday:${date}:${row.Name}`, 'twse-holidays', 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule', `台股・${row.Name}`, date), category: 'holiday', shortTitle: row.Name, session: '日盤', description: row.Description || null, updatedAt }; }).filter(Boolean);
}
export function paymentEvents(rows, updatedAt) {
  const events = [];
  for (const row of rows) {
    const symbol = row['公司代號'], company = row['公司名稱']; if (!symbol || !company) continue;
    const date = rocDate(row['除息交易日']), paymentDate = rocDate(row['現金股利發放日']);
    const cash = nullableNumber(row['股利-盈餘分配之現金股利(元/股)']), surplus = nullableNumber(row['股利-法定盈餘公積、資本公積之現金股利(元/股)']);
    const cashDividend = cash === null || surplus === null ? null : cash + surplus;
    const stockDividend = nullableNumber(row['股利-盈餘轉增資配股(元/股)']);
    const asset = [{ id: `tw:${symbol}`, market: 'tw', symbol, name: company }];
    for (const [category, day, suffix] of [['dividend', date, '除息'], ['payment', paymentDate, '現金股利發放']]) {
      if (!day) continue; events.push({ ...base(`mops:${symbol}:${category}:${day}`, 'mops-payments', 'https://openapi.twse.com.tw/v1/opendata/t187ap45_L', `${company}（${symbol}）${suffix}`, day), category, shortTitle: `${company}${suffix}`, company, symbol, cashDividend, stockDividend, totalDividend: cashDividend !== null && stockDividend !== null ? cashDividend + stockDividend : null, exDividendDate: date, paymentDate, assets: asset, updatedAt });
    }
  }
  return events;
}
export function governanceEvents(proposals, updatedAt) {
  return proposals.filter(p => ['aave.eth','uniswap.eth','ens.eth','arbitrumfoundation.eth'].includes(p.space?.id) && /^[a-zA-Z0-9]+$/.test(p.id) && Number.isFinite(p.end) && Number.isFinite(p.start) && p.end > p.start).map(p => ({
    id: `${p.space.id==='aave.eth'?'aave-vote':p.space.id+'-vote'}:${p.id}:end`, title: 'Aave governance proposal voting deadline', titleZh: `${p.space.id.split('.')[0].toUpperCase()} 治理提案投票截止`, translationStatus: 'translated', proposalTitle: p.title,
    kind: 'event', category: 'governance', shortTitle: `${p.space.id.split('.')[0]} 投票截止`, occursAt: new Date(p.end * 1000).toISOString(), date: null, status: 'confirmed', announcementStatus: 'confirmed', markets: ['crypto'],
    originalTimezone: 'UTC', sourceId: 'aave-governance', source: `${p.space.id} 官方治理空間`, sourceUrl: `https://snapshot.box/#/s:${p.space.id}/proposal/${p.id}`, link: `https://snapshot.box/#/s:${p.space.id}/proposal/${p.id}`,
    startsAt: new Date(p.start * 1000).toISOString(), projectId: p.space.id.split('.')[0], assets: CRYPTO_ASSETS.filter(a => a.projectId===p.space.id.split('.')[0]), updatedAt, impact: { stars: null, ruleVersion: 'unassessed-v1', reason: '來源沒有可靠重要性分級' }
  })).flatMap(e=>[e,{...e,id:e.id.replace(/:end$/,':start'),title:'Governance proposal voting opens',titleZh:e.titleZh.replace('投票截止','投票開始'),shortTitle:e.shortTitle.replace('投票截止','投票開始'),occursAt:e.startsAt,endsAt:e.occursAt}]);
}
export function spansFor(events, sourceId, complete = false) {
  const groups = new Map(); for (const item of events) { const category = item.category || 'macro'; if (!groups.has(category)) groups.set(category, []); groups.get(category).push(item); }
  return [...groups].map(([category, items]) => { const days = items.map(eventDay).filter(Boolean).sort(); return { sourceId, category, markets: [...new Set(items.flatMap(i => i.markets))], from: days[0], to: days.at(-1), complete }; });
}
export function tpexDividends(rows, updatedAt, daily = false) {
  return rows.map(row => {
    const date = rocDate(daily ? row.Date : row.ExRrightsExDividendDate), symbol = row.SecuritiesCompanyCode, company = row.CompanyName;
    if (!date || !symbol || !company) return null;
    const sourceId = daily ? 'tpex-dividends-daily' : 'tpex-dividends';
    const url = `https://www.tpex.org.tw/openapi/v1/${daily ? 'tpex_exright_daily' : 'tpex_exright_prepost'}`;
    const item = base(`${sourceId}:${symbol}:${date}`, sourceId, url, `${company}（${symbol}）${daily ? '除權息' : '除權息預告'}`, date);
    return { ...item, category: daily ? 'dividend' : 'dividend-preview', shortTitle: `${company}除息`, announcementStatus: daily ? 'confirmed' : 'preview', company, symbol, exDividendDate: date,
      cashDividend: nullableNumber(row.CashDividend), stockDividend: daily ? nullableNumber(row.StockDividend) : null,
      stockDividendRatio: daily ? null : nullableNumber(row.StockDividendRatio), totalDividend: daily ? nullableNumber(row.StockDividendPlusCashDividend) : null,
      paymentDate: null, assets: [{ id: `tw:${symbol}`, market: 'tw', symbol, name: company }], updatedAt };
  }).filter(Boolean);
}

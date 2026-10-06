import { eventDay } from '../src/components/news/model.js';
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
    if (asset.market !== 'crypto' || !markets.includes(asset.market)) continue;
    const named = [asset.name, ...(asset.aliases || [])].filter(n => n.length >= 2 && !['near', 'op', 'one', 'gas'].includes(n.toLowerCase())).some(name => /[\u4e00-\u9fff]/.test(name) ? title.includes(name) : new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'i').test(title));
    const symbol = !['OP', 'NEAR', 'LINK'].includes(asset.symbol) && new RegExp(`(?<![A-Za-z0-9])\\$?${escape(asset.symbol)}(?![A-Za-z0-9])`).test(title);
    if (named || symbol) assets.push(asset);
  }
  return [...new Map(assets.map(a => [a.id, a])).values()];
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

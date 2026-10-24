import { eventDay } from '../src/components/news/model.js';
import { CRYPTO_ASSETS } from '../server/news/assets.js';
export { CRYPTO_ASSETS, identifyAssets } from '../server/news/assets.js';
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

// A surprise is interpreted through the interest-rate/liquidity channel,
// not as an observed price move. Missing consensus is never called neutral.
const rules = {
  'nonfarm-payrolls': { unit: '人', small: 50000, large: 100000 },
  'cpi-mom': { unit: '%', small: 0.1, large: 0.2 },
  'fed-rate': { unit: '%', small: 0.25, large: 0.5 }
};
export function macroResult(item, now = Date.now()) {
  const released = Number.isFinite(Date.parse(item.releasedAt)) && Date.parse(item.releasedAt) <= now;
  if (!released) { const due = Date.parse(item.occursAt || (item.date ? `${item.date}T23:59:59-04:00` : '')); return { label: due <= now ? '待更新' : '待公布', summary: due <= now ? '公布時間已到，尚未取得可靠實際值。' : '公布後顯示實際值與結果。', score: null }; }
  const rule = rules[item.metric];
  if (!Number.isFinite(item.actual)) return { label: '待更新', summary: '公布時間已到，尚未取得可靠實際值。', score: null };
  if (!rule || item.unit !== rule.unit || !Number.isFinite(item.consensus) || !item.consensusSource || !item.sourceUrl)
    return { label: '待判讀', summary: '已公布實際值；缺少同口徑預期值，暫不判定多空。', score: null };
  const surprise = item.consensus - item.actual, magnitude = Math.abs(surprise);
  const degree = magnitude + 1e-8 >= rule.large ? 2 : magnitude + 1e-8 >= rule.small ? 1 : 0;
  const score = Math.sign(surprise) * degree;
  return { score, label: ['利空', '小空', '中性', '小多', '利多'][score + 2], summary: `實際值${surprise > 0 ? '低於' : surprise < 0 ? '高於' : '符合'}預期。${score > 0 ? '利率上行壓力較小，流動性面偏多。' : score < 0 ? '利率上行壓力較大，流動性面偏空。' : '與預期差距小，流動性面中性。'}` };
}
export function macroValue(value, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(value)}${unit}` : value == null || value === '' ? '—' : String(value);
}
export function mergeMacroResults(snapshot, supplement) {
  if (supplement?.schemaVersion !== 1 || !Array.isArray(supplement.events)) return snapshot;
  const events = [...snapshot.events];
  for (const incoming of supplement.events) {
    if (incoming.category !== 'macro' || !incoming.id || !/^\d{4}-\d{2}-\d{2}/.test(incoming.date || incoming.occursAt || '')) continue;
    const date = (incoming.date || incoming.occursAt).slice(0, 10);
    const index = events.findIndex(e => e.id === incoming.id || e.macroId === incoming.id || e.category === 'macro' &&
      (e.date || e.occursAt || '').slice(0, 10) === date && incoming.matchTitle && e.title?.startsWith(incoming.matchTitle));
    if (index < 0) events.push(incoming);
    else events[index] = { ...events[index], ...incoming, macroId: incoming.id, id: events[index].id };
  }
  return { ...snapshot, events, macroGeneratedAt: supplement.generatedAt, macroSources: supplement.sources || [] };
}

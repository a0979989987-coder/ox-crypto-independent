// 篩選 on the pattern board: time frames, a minimum 24H 成交額 (USDT) and 板塊.
// 板塊 are the 31 editorial sector groups, verified against Bitget contracts by
// the same function the sector tools use. The device remembers the choice under
// BOARD_FILTER_KEY; a later account sync can read or write it through
// readBoardFilter / writeBoardFilter (writes announce BOARD_FILTER_EVENT).
import { SECTOR_GROUPS, verifiedSectorUniverse } from '../analytics/sector-taxonomy.js';

export const BOARD_FILTER_KEY = 'ox-crypto:board-filter-v1';
export const BOARD_FILTER_EVENT = 'ox:board-filterchange';
export const DEFAULT_BOARD_FRAMES = Object.freeze(['4H', '1H']);
export const BOARD_LIMITS = Object.freeze([0, 80, 160]);
// 100萬 / 1000萬 / 1億 USDT: roughly the top 220, 60 and 10 Bitget contracts.
export const TURNOVER_PRESETS = Object.freeze([1e6, 1e7, 1e8]);
const SECTOR_IDS = new Set(SECTOR_GROUPS.map(group => group.id));

export function turnoverText(value) {
  if (!(value > 0)) return '不限';
  if (value >= 1e8) return `${Number((value / 1e8).toFixed(2))}億`;
  return `${Number((value / 1e4).toFixed(value < 1e5 ? 1 : 0))}萬`;
}

export function normalizeBoardFilter(raw, timeframes = null) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const known = frame => typeof frame === 'string' && (!timeframes || Object.hasOwn(timeframes, frame));
  let frames = Array.isArray(value.frames) ? [...new Set(value.frames.filter(known))] : [];
  if (!frames.length) frames = DEFAULT_BOARD_FRAMES.filter(known);
  if (timeframes) frames.sort((a, b) => timeframes[b] - timeframes[a]);
  const turnover = Number(value.turnover), limit = Number(value.limit);
  return {
    frames,
    limit: BOARD_LIMITS.includes(limit) ? limit : 0,
    turnover: Number.isFinite(turnover) && turnover > 0 ? Math.round(turnover) : 0,
    sectors: Array.isArray(value.sectors) ? [...new Set(value.sectors.filter(id => SECTOR_IDS.has(id)))] : []
  };
}

export function readBoardFilter(timeframes = null, storage = globalThis.localStorage) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(BOARD_FILTER_KEY) || 'null'); } catch {}
  return normalizeBoardFilter(raw, timeframes);
}

export function writeBoardFilter(next, timeframes = null, storage = globalThis.localStorage) {
  const value = normalizeBoardFilter(next, timeframes);
  try { storage?.setItem(BOARD_FILTER_KEY, JSON.stringify({ v: 1, ...value })); } catch {}
  try { globalThis.document?.dispatchEvent(new CustomEvent(BOARD_FILTER_EVENT, { detail: value })); } catch {}
  return value;
}

// Number of active 篩選 conditions besides the time frames.
export const activeFilterCount = filter => (filter?.turnover > 0 ? 1 : 0) + (filter?.sectors?.length ? 1 : 0);

// Sector membership for the contracts in a fetched universe. Returns null until
// the universe carries Bitget instrument rows.
export function boardSectors(universe) {
  const instruments = universe?.instruments;
  if (!Array.isArray(instruments) || !instruments.length) return null;
  const { sectors } = verifiedSectorUniverse(instruments, universe.allTickers || universe.tickers || []);
  const bySymbol = new Map();
  for (const group of sectors) for (const symbol of group.members) {
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push(group.id);
  }
  const pool = new Set((universe.tickers || []).map(ticker => ticker.symbol));
  const groups = sectors.map((group, order) => ({ id: group.id, name: group.shortName, title: group.name, order, count: group.members.filter(symbol => pool.has(symbol)).length }))
    .filter(group => group.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order);
  return { bySymbol, groups };
}

// Turnover and sector conditions are combined with AND; several sectors with OR.
// An unknown sector membership (universe not loaded yet) never passes a sector filter.
export function passesBoardFilter(filter, { turnover, sectors } = {}) {
  if (filter?.turnover > 0 && !(Number(turnover) >= filter.turnover)) return false;
  if (!filter?.sectors?.length) return true;
  return Array.isArray(sectors) && sectors.some(id => filter.sectors.includes(id));
}

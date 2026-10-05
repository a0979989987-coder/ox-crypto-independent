import { CLASSIC_VERSION } from '../src/core/classic.js';
// Three independent ceiling tests, rising right-side lows and upward volume.
export function preparation({ volume = true, scale = 1 } = {}) {
  const bars = [];
  for (let i = 0; i < 72; i++) {
    let close = 95 + Math.sin(i * Math.PI / 8) * 2;
    if (i >= 56) close = 94 + (i - 56) * 0.355;
    const previous = bars.at(-1)?.close ?? close - 0.2;
    bars.push({ time: 1700000000 + i * 3600, open: previous, close,
      high: Math.max(previous, close) + 0.25, low: Math.min(previous, close) - 0.25,
      volume: volume && i >= 65 ? 1800 : 1000 });
  }
  for (const i of [12, 28, 44]) bars[i].high = 100;
  return bars.map(c => ({ ...c, open: c.open * scale, high: c.high * scale, low: c.low * scale, close: c.close * scale }));
}
export const shortBars = bars => bars.map(c => ({ ...c, open: 200 - c.open, high: 200 - c.low,
  low: 200 - c.high, close: 200 - c.close }));

// Ranking unit tests consume already qualified signals; synthetic tier/score
// overrides isolate ordering and membership from the separately tested engine.
export function rankingSignal(tier='T1', side='long') {
  return {version:CLASSIC_VERSION,eligible:true,side:side.toUpperCase(),tier,qualityScore:{T1:90,T2:77,T3:65}[tier],priority:0,stage:'帶量逼近 · 尚未突破',atr:1,invalidation:{level:90},reasons:['已通過共同條件']};
}

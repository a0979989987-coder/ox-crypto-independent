import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// The strategy is a plain browser script; load it into an isolated context.
const source = readFileSync(new URL('../src/markets/crypto/radar-strategy.js', import.meta.url), 'utf8');
const context = { Date, Math, JSON, Number, String, Set, Map, Object, Array };
context.globalThis = context;
runInNewContext(source, context);
const S = context.OXRadarStrategy;

const H4 = 14400, DAY = 86400, START = 1700000000;
const now = (START + 200 * H4) * 1000;
function series(n, step, fn, start = START) {
  return Array.from({ length: n }, (_, i) => {
    const c = fn(i), volume = c.v ?? 1000;
    return { time: start + i * step, open: c.o, high: c.h, low: c.l, close: c.c, volume, quoteVolume: volume * c.c };
  });
}
// A flat 4H base around 100 with a three-test ceiling at 101.5, then a volume
// breakout that holds (rising lows, no top fractal after the break).
function breakoutFrames({ last = 102.6 } = {}) {
  const fourHour = series(120, H4, i => {
    if (i < 116) { const c = 100 + Math.sin(i / 3) * 0.8; return { o: c - 0.2, h: c + 0.6, l: c - 0.7, c }; }
    const k = i - 116, c = 101.8 + k * ((last - 101.8) / 3);
    return { o: c - 0.5, h: c + 0.3, l: c - 0.7 + k * 0.05, c, v: 3200 };
  }, START + 80 * H4);
  // Daily: an old swing high at 110 that has never been closed above since.
  const daily = series(60, DAY, i => {
    if (i === 20) return { o: 104, h: 110, l: 103, c: 105 };
    const c = 100 + Math.sin(i / 4); return { o: c, h: c + 1.5, l: c - 1.5, c: c + 0.2, v: 1000000 / (c + 0.2) };
  }, START + 200 * H4 - 61 * DAY);
  return { '4H': fourHour, '1H': fourHour, '1D': daily };
}
function breakoutSignal(frames, overrides = {}) {
  const bars = frames['4H'], brokenAt = bars[116].time;
  return { frame: '4H', triggerFrame: '1H', phase: 'breakout', eligible: true, observationEligible: true,
    pressure: { kind: 'horizontal', state: 'broken', level: 101.5, touches: 3, brokenAt, points: [{ time: bars[10].time }, { time: bars.at(-1).time }] },
    volume: { complete: true, supported: true, distribution: false, upwardShare: 0.8, impulseRatio: 3.2, sustainedBars: 3, recentRatio: 1.6 },
    triggerVolume: { complete: true, supported: true, upwardShare: 0.75, impulseRatio: 2.4, sustainedBars: 2, recentRatio: 1.5 },
    direction: { confirmed: true, higherLows: true, higherHighs: true, advance: 2.2 },
    invalidation: { level: 99.2 }, rejectionReasons: [], ...overrides };
}
const ticker = (turnover, price = 102.6) => ({ usdtVolume: String(turnover), lastPr: String(price) });

test('product classes keep stablecoins and gold tokens out of the crypto radar', () => {
  assert.equal(S.productClass('USDCUSDT', { baseCoin: 'USDC' }), 'stablecoin');
  assert.equal(S.productClass('PAXGUSDT', { baseCoin: 'PAXG' }), 'gold-token');
  assert.equal(S.productClass('NEWGOLDUSDT', { baseCoin: 'NEWGOLD', assetSymbolType: 'metal' }), 'gold-token');
  assert.equal(S.productClass('BTCUSDT', { baseCoin: 'BTC' }), 'major');
  // High turnover is never a reason to exclude a crypto asset.
  assert.equal(S.productClass('SOLUSDT', { baseCoin: 'SOL' }), 'crypto');
  const excluded = S.evaluateSymbol({ symbol: 'USDCUSDT', contract: { baseCoin: 'USDC' }, ticker: ticker(9e9, 1), frames: {} });
  assert.match(excluded.excluded, /穩定幣/);
  assert.equal(excluded.long, null);
});

test('money compares 24H turnover with the previous seven closed daily bars', () => {
  const daily = series(10, DAY, () => ({ o: 1, h: 1.1, l: 0.9, c: 1, v: 1000000 }));
  const money = S.moneyEvidence({ usdtVolume: '3000000' }, daily);
  assert.equal(money.days, 7);
  assert.equal(Math.round(money.expansion * 10) / 10, 3);
});

test('a held, money-backed breakout with room passes every T1 gate', () => {
  const frames = breakoutFrames();
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(result.listed, true, result.rejections.join(','));
  assert.equal(result.gates.length, 0, result.gates.join('、'));
  assert.equal(result.t1, true);
  assert.equal(result.pathway.group, '壓力突破');
  assert.equal(result.pathway.name, '水平壓力（3 次測試）突破');
  assert.ok(result.elements.rr >= 1.5);
  assert.ok(result.target.level >= 110 - 1e-9);
  assert.ok(result.matched.some(text => text.includes('24H 成交額')));
});

// The breakout fixture without its old 110 daily swing high: nothing on the
// daily frame sits more than a few ticks above the 102.6 price.
function withoutOldHigh(frames, edit = (bar) => bar) {
  frames['1D'] = frames['1D'].map((bar, i) => edit(i === 20 ? { ...bar, open: 100.5, high: 101.9, low: 99.8, close: 101 } : bar, i));
  return frames;
}

test('today\'s high above the price is the first target, never a new-high claim', () => {
  const frames = withoutOldHigh(breakoutFrames());
  const last = frames['1D'].at(-1);
  frames['1D'].push({ time: last.time + DAY, open: 101, high: 106.4, low: 100.6, close: 102.6, volume: 20000, quoteVolume: 20000 * 102.6, provisional: true });
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(result.target?.label, '1D 今日高點');
  assert.ok(Math.abs(result.target.level - 106.4) < 1e-9);
  assert.ok(!result.matched.some(text => text.includes('週新高')));
});

test('a live high less than one ATR above the price is the impulse in progress, not supply', () => {
  const frames = withoutOldHigh(breakoutFrames());
  const last = frames['1D'].at(-1);
  frames['1D'].push({ time: last.time + DAY, open: 101, high: 103.2, low: 100.6, close: 102.6, volume: 20000, quoteVolume: 20000 * 102.6, provisional: true });
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.notEqual(result.target?.label, '1D 今日高點');
});

test('a high at the oldest edge of the window still counts as overhead supply', () => {
  const frames = withoutOldHigh(breakoutFrames(), (bar, i) => i === 0 ? { ...bar, open: 100, high: 112, low: 99.5, close: 111.8 } : bar);
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(result.target?.label, '1D 區間高點');
  assert.ok(Math.abs(result.target.level - 112) < 1e-9);
});

test('above every unbroken daily and weekly high is an N-week high with neutral room', () => {
  const frames = withoutOldHigh(breakoutFrames());
  frames['1W'] = series(20, 7 * DAY, i => { const c = 98 + Math.sin(i / 2); return { o: c, h: c + 2, l: c - 2, c }; }, START + 200 * H4 - 21 * 7 * DAY);
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(result.target, null);
  assert.ok(result.matched.some(text => text.includes('約 20 週新高')), result.matched.join('、'));
  assert.ok(!result.gates.some(text => text.includes('上方目標未辨識')));
  assert.equal(result.elements.roomScore, 45);
});

test('a stop closer than one ATR cannot inflate the reward-to-risk ratio', () => {
  const frames = breakoutFrames();
  const result = S.evaluateLong({ signal: breakoutSignal(frames, { invalidation: { level: 102.5 } }), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  // 7.4 of room over a 0.1 stop would read 74; one 4H ATR (about 1.4) caps it near 5.
  assert.ok(result.elements.rr > 3 && result.elements.rr < 8, String(result.elements.rr));
});

test('low turnover cannot reach T1 or a high score through volume ratio alone', () => {
  const frames = breakoutFrames();
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 6e5, expansion: 12 }, price: 102.6 });
  assert.equal(result.t1, false);
  assert.ok(result.score <= S.RADAR_RULES.lowTurnoverScoreCap);
  assert.ok(result.elements.strength <= S.RADAR_RULES.lowTurnoverStrengthCap);
  assert.ok(result.gates.some(text => text.includes('未達 T1 的 100 萬')));
});

test('turnover without expansion is capped below T1', () => {
  const frames = breakoutFrames();
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 5e6, expansion: 1.2 }, price: 102.6 });
  assert.equal(result.t1, false);
  assert.ok(result.score <= S.RADAR_RULES.noExpansionScoreCap);
  assert.ok(result.gates.some(text => text.includes('未達 2 倍')));
});

test('overextension excludes every pathway, including structure reversals', () => {
  const frames = breakoutFrames({ last: 105.5 });
  const breakout = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 5e6, expansion: 3 }, price: 105.5 });
  assert.equal(breakout.listed, false);
  assert.ok(breakout.rejections.some(text => text.includes('過度拉升')));
  const reversal = S.evaluateLong({ signal: breakoutSignal(frames, { phase: 'reversal', reversal: { level: 101.5, upwardShare: 0.8 } }),
    frames, money: { turnover: 5e6, expansion: 3 }, price: 105.5 });
  assert.equal(reversal.listed, false);
  assert.ok(reversal.rejections.some(text => text.includes('過度拉升')));
  // Not selected, but may fill T2／T3 last, with the chase deduction counted.
  assert.equal(breakout.fillable, true);
  assert.ok(breakout.deductions.some(d => d.text.includes('追價風險') && d.points >= 12));
  assert.match(breakout.fillReason, /過度拉升/);
});

test('a broken structure or failed breakout is never a fill candidate', () => {
  const frames = breakoutFrames();
  const broken = S.evaluateLong({ signal: breakoutSignal(frames, { rejectionReasons: ['最新價格已破壞結構'] }), frames, money: { turnover: 5e6, expansion: 3 }, price: 102.6 });
  assert.equal(broken.listed, false);
  assert.equal(broken.fillable, false);
  const failed = S.evaluateLong({ signal: breakoutSignal(frames, { rejectionReasons: ['近期突破失敗，壓力已上下貫穿'] }), frames, money: { turnover: 5e6, expansion: 3 }, price: 102.6 });
  assert.equal(failed.fillable, false);
  const below = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 5e6, expansion: 3 }, price: 99 });
  assert.equal(below.fillable, false);
});

test('pathway names read once: a double top breaks out, it does not "break out" twice', () => {
  const frames = breakoutFrames();
  const pressure = { ...breakoutSignal(frames).pressure, touches: 2 };
  const breakout = S.evaluateLong({ signal: breakoutSignal(frames, { pressure }), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(breakout.pathway.name, '雙頂突破');
  const probe = S.evaluateLong({ signal: breakoutSignal(frames, { pressure, phase: 'probe' }), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.6 });
  assert.equal(probe.pathway.name, '雙頂突破試探（未收 K）');
  const near = S.evaluateLong({ signal: breakoutSignal(frames, { pressure: { ...pressure, state: 'valid' }, phase: 'prebreakout' }), frames, money: { turnover: 3e6, expansion: 3 }, price: 101.2 });
  assert.equal(near.pathway.name, '帶量接近雙頂');
});

test('a setup without any entry pathway is not listed and says why', () => {
  const frames = breakoutFrames();
  const result = S.evaluateLong({ signal: breakoutSignal(frames, { phase: 'watch', pressure: null, rejectionReasons: ['沒有接近有效壓力或強勢啟動'] }),
    frames, money: { turnover: 5e6, expansion: 3 }, price: 102.6 });
  assert.equal(result.listed, false);
  assert.match(result.rejections[0], /沒有入選途徑/);
  // Same-direction evidence without a pathway only fills, and says what it is.
  assert.equal(result.fillable, true);
  assert.equal(result.t1, false);
  assert.equal(result.pathway.group, '觀察補位');
});

test('a qualifying 4H setup stays visible while 1H is unconfirmed, but never as T1', () => {
  const frames = breakoutFrames();
  const standalone = breakoutSignal(frames);
  const multi = { ...breakoutSignal(frames), eligible: false, observationEligible: false, rejectionReasons: ['1H 當下方向或上攻量能未確認'] };
  const result = S.evaluateSymbol({ symbol: 'TESTUSDT', ticker: ticker(3e6), frames, longSignals: [multi], setupSignals: [standalone], price: 102.6 });
  assert.equal(result.long.listed, true);
  assert.equal(result.long.t1, false);
  assert.ok(result.long.deductions.some(d => d.text.includes('啟動待確認')));
});

test('a confirmed breakout that has formed a top fractal is weakened, not T1', () => {
  const frames = breakoutFrames();
  const bars = frames['4H'];
  bars[118] = { ...bars[118], high: 103.4 };
  bars[119] = { ...bars[119], low: bars[118].low - 0.3, close: 102.4 };
  const result = S.evaluateLong({ signal: breakoutSignal(frames), frames, money: { turnover: 3e6, expansion: 3 }, price: 102.4 });
  assert.equal(result.t1, false);
  assert.ok(result.deductions.some(d => d.text.includes('頂分型')));
});

// 4H rally with unbroken naked-K lows, then the highest bar's low is broken.
function rallyFrames({ rising = false } = {}) {
  const bars = series(120, H4, i => {
    if (i < 100) { const c = 50 + Math.sin(i / 3) * 0.5; return { o: c, h: c + 0.4, l: c - 0.4, c }; }
    if (i <= 112) { const c = 50 + (i - 99) * 1.6; return { o: c - 1.2, h: c + 0.3, l: c - 1.3, c, v: 3000 }; }
    if (i === 113) return { o: 70.5, h: 70.9, l: 67.5, c: 67.9, v: 4000 };
    return { o: 68, h: 68.6, l: 66.9, c: 67.2, v: 3500 };
  });
  // Still rallying: the live (unclosed) bar prints above the prior high.
  if (rising) bars.push({ time: bars.at(-1).time + H4, open: 68, high: 75, low: 67.8, close: 74.5, volume: 5000, provisional: true });
  return { '4H': bars };
}

test('top confirmation lists a fresh short after a fast rally', () => {
  const frames = rallyFrames();
  const short = S.evaluateShort({ frames, money: { turnover: 4e6, expansion: 3 }, price: 67.2 });
  assert.equal(short.listed, true, short.rejections.join(','));
  assert.match(short.pathway.group, /頂部確認|結構反轉/);
  assert.ok(short.matched.some(text => text.includes('裸 K 低連續')));
  assert.ok(short.stop > 67.2);
});

test('no short while the rally is still printing new highs or never broke the top bar low', () => {
  const rising = S.evaluateShort({ frames: rallyFrames({ rising: true }), money: { turnover: 4e6, expansion: 3 }, price: 74.5 });
  assert.equal(rising.listed, false);
  assert.match(rising.rejections[0], /創新高/);
  const quiet = S.evaluateShort({ frames: { '4H': series(120, H4, i => { const c = 50 + Math.sin(i / 3); return { o: c, h: c + 0.5, l: c - 0.5, c }; }) },
    money: { turnover: 4e6, expansion: 3 }, price: 50 });
  assert.equal(quiet.listed, false);
  assert.match(quiet.rejections[0], /沒有急漲段/);
  // Neither has any short evidence, so neither may fill the short list.
  assert.equal(rising.fillable, false);
  assert.equal(quiet.fillable, false);
});

test('a stale top is not selected, but it can fill the short list with the age deducted', () => {
  const frames = rallyFrames(), bars = frames['4H'];
  for (let k = 0; k < 12; k++) bars.push({ time: bars.at(-1).time + H4, open: 67.4, high: 68, low: 66.6, close: 67.2, volume: 2500, quoteVolume: 2500 * 67.2 });
  const short = S.evaluateShort({ frames, money: { turnover: 4e6, expansion: 3 }, price: 67.2 });
  assert.equal(short.listed, false);
  assert.equal(short.fillable, true);
  assert.match(short.fillReason, /過時/);
  assert.ok(short.deductions.some(d => d.points === 16));
});

test('without a fast rally, a lower high with a confirmed top only fills the short list', () => {
  const frames = { '4H': series(120, H4, i => { const c = 80 - i * 0.12 + 1.6 * Math.sin(i / 2.2); return { o: c + 0.1, h: c + 0.5, l: c - 0.5, c }; }) };
  const price = frames['4H'].at(-1).close;
  const short = S.evaluateShort({ frames, money: { turnover: 4e6, expansion: 3 }, price });
  assert.equal(short.listed, false, short.rejections.join('、'));
  assert.equal(short.fillable, true, short.rejections.join('、'));
  assert.equal(short.pathway.group, '觀察補位');
  assert.equal(short.t1, false);
});

test('T1 takes at most 10 complete rows and may stay empty; T2 and T3 fill to 15 each without repeats', () => {
  const row = (i, { t1 = false, listed = true, fillable = false } = {}) => ({ symbol: 'C' + i + 'USDT',
    radarSide: { t1, listed, fillable, score: 100 - i, elements: { certainty: 50, strength: 50 } } });
  const rows = [...Array.from({ length: 12 }, (_, i) => row(i, { t1: true })), ...Array.from({ length: 40 }, (_, i) => row(20 + i))];
  const ranked = S.rankRadar(rows);
  assert.equal(ranked.t1.length, 10);
  assert.equal(ranked.t2.length, 15);
  assert.equal(ranked.t3.length, 15);
  assert.ok(ranked.t1.every(r => r.radarSide.t1));
  const all = [...ranked.t1, ...ranked.t2, ...ranked.t3].map(r => r.symbol);
  assert.equal(new Set(all).size, all.length);
  assert.equal(S.TIER_LIMITS.T1 + S.TIER_LIMITS.T2 + S.TIER_LIMITS.T3, 40);
  // No complete row: T1 stays at 0, never filled from the rest.
  const none = S.rankRadar([row(1), row(2, { listed: false, fillable: true })]);
  assert.equal(none.t1.length, 0);
  assert.equal(none.t2.length, 2);
});

test('T2 and T3 put selections scoring 35+ first, then low selections and fill candidates by score; hard rejections never appear', () => {
  const row = (name, score, flags) => ({ symbol: name + 'USDT', radarSide: { t1: false, listed: false, fillable: false, score, elements: { certainty: 40, strength: 40 }, ...flags } });
  const strong = Array.from({ length: 5 }, (_, i) => row('L' + i, 40 - i, { listed: true }));
  const weak = [row('W1', 5, { listed: true })];
  const fill = Array.from({ length: 40 }, (_, i) => row('F' + i, 90 - i, { fillable: true }));
  const hard = [row('H', 99, {})];
  const ranked = S.rankRadar([...hard, ...fill, ...weak, ...strong]);
  // Selections at 35+ lead even below fill scores; the rest follow by score.
  assert.equal(ranked.t2.slice(0, 5).map(r => r.symbol).join(','), 'L0USDT,L1USDT,L2USDT,L3USDT,L4USDT');
  assert.equal(ranked.t2[5].symbol, 'F0USDT');
  assert.equal(ranked.t2.length + ranked.t3.length, 30);
  const placed = [...ranked.t2, ...ranked.t3].map(r => r.symbol);
  assert.ok(!placed.includes('HUSDT'));
  // A selection scoring 5 does not jump ahead of fill candidates scoring 51+.
  assert.ok(!placed.includes('W1USDT'));
  // Fewer real candidates than 30: list what exists, never invent rows.
  const few = S.rankRadar([...strong, ...fill.slice(0, 3)]);
  assert.equal(few.t2.length, 8);
  assert.equal(few.t3.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('src/core/runtime-config.js');
const strength = [runtime, read('src/components/strength/snapshots.js'), read('src/components/strength/market-strength.js')].join('\n;\n');
const context = () => ({ localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null, querySelectorAll: () => [] }, window: {}, Intl, Date });

const helpers = runInNewContext(`${runtime}\n({num,toNumberOrNull,fmtPct,fmtPrice,fmtUsd,fmtCryptoVolume,fmtCryptoVolumeUSDT,fmtSignalReason})`, context());

test('display formatters show a dash for missing or non-numeric values, not zero', () => {
  for (const missing of [undefined, null, '', '  ', 'abc', NaN, Infinity, true]) {
    assert.equal(helpers.fmtPct(missing), '—', `fmtPct(${String(missing)})`);
    assert.equal(helpers.fmtCryptoVolume(missing), '—', `fmtCryptoVolume(${String(missing)})`);
    assert.equal(helpers.fmtUsd(missing), '—', `fmtUsd(${String(missing)})`);
    assert.equal(helpers.fmtPrice(missing), '—', `fmtPrice(${String(missing)})`);
  }
});

test('real zero and real values keep their existing formatting', () => {
  assert.equal(helpers.fmtPct(0), '+0.00%');
  assert.equal(helpers.fmtPct('0.0123'), '+1.23%');
  assert.equal(helpers.fmtPct(-0.05), '-5.00%');
  assert.equal(helpers.fmtCryptoVolume(0), '0');
  assert.equal(helpers.fmtCryptoVolume(1.5e8), '1.5億');
  assert.equal(helpers.fmtCryptoVolume('2500000'), '250萬');
  assert.equal(helpers.fmtUsd(1234567), '1.23M');
  assert.equal(helpers.fmtPrice(0), '—', 'a zero price is still not a valid quote');
  assert.equal(helpers.fmtPrice('64000.5'), '64,000.5');
});

test('toNumberOrNull separates missing from zero while legacy num keeps calculation compatibility', () => {
  assert.equal(helpers.toNumberOrNull('0'), 0);
  assert.equal(helpers.toNumberOrNull(0), 0);
  assert.equal(helpers.toNumberOrNull('1.5'), 1.5);
  for (const missing of [undefined, null, '', 'x', NaN, false]) assert.equal(helpers.toNumberOrNull(missing), null);
  assert.equal(helpers.num(undefined), 0);
  assert.equal(helpers.num('2'), 2);
});

function coins(missing) {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ symbol: `C${i}USDT`, quoteVol: 5e6 + i * 1e6, ret1h: (i - 5) / 1000, ret4h: (i - 6) / 500, ret24h: (i - 4) / 100, structScore: 40 + i * 4, flowScore: 30 + i * 5, setupScore: 50 + i * 2, liqScore: 45 + i, side: i % 3 ? 'LONG' : 'SHORT', tier: i < 2 ? 't1' : 't3' });
  missing?.(rows);
  return [{ symbol: 'BTCUSDT', quoteVol: 9e9, ret1h: 0.002, ret4h: 0.01, ret24h: 0.03, structScore: 70, flowScore: 65, setupScore: 60, liqScore: 80 }, ...rows];
}
function calculate(rows) {
  return runInNewContext(`${strength}\n;(rows => { state.analyzedCache = new Map(rows.map(r => [r.symbol, r])); state.btcTicker = { change24h: 0.03, usdtVolume: 9e9 }; state.tickers = []; globalThis.isCryptoSymbolAllowed = () => true; return calculateBTCvsAltStrength(); })`, context())(rows);
}

test('BTC vs ALT strength is unchanged when every input exists', () => {
  const result = calculate(coins());
  // Values produced by the previous implementation on the same fixture.
  assert.equal(result.btcStrength, 58);
  assert.equal(result.altStrength, 49);
  assert.equal(result.spread, 9);
  assert.equal(result.btcMomentum, 0.0174);
  assert.equal(result.altMomentum, 0.0065);
  assert.equal(result.altOutperformBTC, 33.33333333333333);
  assert.equal(result.altPositiveBreadth, 58.333333333333336);
});

test('missing returns and scores are skipped instead of scored as a 0% move', () => {
  const allMissing = calculate(coins(rows => rows.forEach(r => { r.ret1h = r.ret4h = r.ret24h = undefined; })));
  assert.equal(allMissing.altOutperformBTC, 0, 'a coin without returns cannot outperform BTC');
  assert.ok(Number.isFinite(allMissing.btcStrength) && Number.isFinite(allMissing.altStrength));
  // One coin lacking its 1H return: its composite uses the 4H/24H weights only.
  const fn = runInNewContext(`${strength}\nweightedAvailable`, context());
  assert.equal(fn([[null, .2], [0.01, .35], [0.02, .45]]), (0.01 * .35 + 0.02 * .45) / .8);
  assert.equal(fn([[undefined, .2], ['', .35]]), null);
  assert.equal(fn([[0.01, .2], [0.02, .35], [0.03, .45]]), 0.01 * .2 + 0.02 * .35 + 0.03 * .45);
  const partial = calculate(coins(rows => { rows[3].ret1h = undefined; rows[6].structScore = undefined; }));
  assert.ok(Number.isFinite(partial.altMomentum) && Number.isFinite(partial.btcStrength));
  assert.equal(partial.sampleSize, 12, 'coins with partial data stay in the sample');
});

test('turnover with a unit shows only a dash when missing', () => {
  for (const missing of [undefined, null, '', 'abc']) assert.equal(helpers.fmtCryptoVolumeUSDT(missing), '—');
  assert.equal(helpers.fmtCryptoVolumeUSDT('2500000'), '250萬 USDT');
  assert.equal(helpers.fmtCryptoVolumeUSDT(0), '0 USDT');
  for (const file of ['src/markets/crypto/presentation.js', 'src/markets/crypto/scanner.js'])
    assert.doesNotMatch(read(file), /fmtCryptoVolume\([^)]*\)\}? ?\+? ?['`]? ?USDT/, file + ' must not append USDT to a possibly missing value');
});

test('raw reference prices in signal reasons display with quote precision, other numbers unchanged', () => {
  assert.equal(helpers.fmtSignalReason('1W 歷史價格參考 · 774.5296855783571'), '1W 歷史價格參考 · 774.5297');
  assert.equal(helpers.fmtSignalReason('1D 歷史價格參考 · 64123.98765'), '1D 歷史價格參考 · 64,123.99');
  assert.equal(helpers.fmtSignalReason('4H 正在突破近期轉折，等待收 K · 0.000123456789'), '4H 正在突破近期轉折，等待收 K · 0.00012346');
  assert.equal(helpers.fmtSignalReason('1H 已收復近期轉折 · 1.23456789'), '1H 已收復近期轉折 · 1.2346');
  for (const text of ['上攻量比 1.53x · 同向量 62%', '距觸發 0.79 ATR', '目標空間僅為結構失效距離 0.82 倍 · 分數折減'])
    assert.equal(helpers.fmtSignalReason(text), text);
});

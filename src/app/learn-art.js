// Cover pictures for the 交易教學 courses, drawn in SVG so each one shows what
// the course is about (an order block for SMC, a W bottom for 型態學, a volume
// spike for 量價 and so on). Candles follow the crypto site's Bitget colours: 青藍 up,
// 桃紅 down, lightened to read on the coloured cards.
import { LOGO } from './chrome-style.js';

const UP = '#5fe3f5', DN = '#ff6fa3', GOLD = '#ffd36b';
const f = n => +n.toFixed(1);
const text = (x, y, s, size = 9, op = 0.8, anchor = 'start') => `<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="#fff" fill-opacity="${op}" text-anchor="${anchor}" font-weight="600">${s}</text>`;

// A box of candles from closing levels (0 bottom, 1 top); returns markup and helpers to place marks.
function chart(closes, { x = 10, y = 32, w = 128, h = 86 } = {}) {
  const n = closes.length, step = w / n, bw = Math.max(3, step * 0.56);
  const X = i => x + step * i + step / 2, Y = v => y + (1 - v) * h;
  let prev = closes[0] - 0.05, body = '';
  closes.forEach((c, i) => {
    const o = prev, up = c >= o, hi = Math.max(o, c) + 0.03 + (i % 3) * 0.012, lo = Math.min(o, c) - 0.03 - ((i + 1) % 3) * 0.012, col = up ? UP : DN;
    body += `<line x1="${f(X(i))}" x2="${f(X(i))}" y1="${f(Y(hi))}" y2="${f(Y(lo))}" stroke="${col}" stroke-width="1.2"/><rect x="${f(X(i) - bw / 2)}" y="${f(Y(Math.max(o, c)))}" width="${f(bw)}" height="${f(Math.max(1.6, Math.abs(Y(o) - Y(c))))}" rx="1" fill="${col}"/>`;
    prev = c;
  });
  return { body, X, Y };
}
const dash = (x1, y1, x2, y2, op = 0.55) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#fff" stroke-opacity="${op}" stroke-width="1" stroke-dasharray="3 3"/>`;
const line = (pts, color = '#fff', width = 1.6, op = 1) => `<polyline points="${pts.map(([a, b]) => f(a) + ',' + f(b)).join(' ')}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const ART = {
  smc() {
    const cl = [0.8, 0.72, 0.76, 0.64, 0.56, 0.6, 0.47, 0.38, 0.3, 0.42, 0.6, 0.68, 0.82, 0.88], { body, X, Y } = chart(cl, { x: 8, w: 132 });
    return `<rect x="${f(X(8) - 6)}" y="${f(Y(0.36))}" width="${f(140 - X(8) + 6)}" height="${f(Y(0.24) - Y(0.36))}" fill="#fff" fill-opacity=".13" stroke="#fff" stroke-opacity=".45" stroke-dasharray="3 2"/>${text(136, Y(0.27), 'OB', 8, 0.85, 'end')}
      <rect x="${f(X(10) - 4)}" y="${f(Y(0.56))}" width="${f(140 - X(10) + 4)}" height="${f(Y(0.47) - Y(0.56))}" fill="${GOLD}" fill-opacity=".22"/>${text(136, Y(0.48) - 1, 'FVG', 8, 0.85, 'end')}
      ${dash(X(2), Y(0.81), X(12), Y(0.81), 0.7)}${text(X(6), Y(0.81) - 3, 'BOS', 8, 0.85, 'middle')}${body}`;
  },
  bipolar(id) {
    const [a, b] = [...LOGO.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
    return `<defs><radialGradient id="g-${id}"><stop offset="0" stop-color="#F1EADC" stop-opacity=".5"/><stop offset="1" stop-color="#F1EADC" stop-opacity="0"/></radialGradient></defs>
      <circle cx="74" cy="76" r="58" fill="url(#g-${id})"/><g transform="translate(37 39) scale(${f(74 / 980 * 10) / 10})"><path d="${a}" fill="#223E57"/><path d="${b}" fill="#F1EADC"/></g>`;
  },
  naked() {
    const { body, Y } = chart([0.3, 0.46, 0.38, 0.56, 0.5, 0.68, 0.6, 0.76, 0.7, 0.86]);
    return dash(8, Y(0.58), 140, Y(0.58), 0.5) + body;
  },
  pattern() {
    const cl = [0.82, 0.66, 0.46, 0.3, 0.44, 0.62, 0.48, 0.32, 0.46, 0.64, 0.84], { body, X, Y } = chart(cl);
    const w = [0, 3, 5, 7, 10].map(i => [X(i), Y(cl[i])]);
    return body + dash(X(4), Y(0.63), X(10) + 4, Y(0.63), 0.7) + line(w, GOLD, 5, 0.25) + line(w, GOLD, 2.2) + `<path d="M${f(X(10) + 6)} ${f(Y(0.98))}l4 6h-8z" fill="${GOLD}"/>`;
  },
  trend() {
    const cl = [0.18, 0.28, 0.24, 0.36, 0.32, 0.46, 0.41, 0.56, 0.51, 0.66, 0.62, 0.78], { body, X, Y } = chart(cl, { x: 8, w: 132 });
    const ma = cl.map((_, i) => [X(i), Y(cl.slice(Math.max(0, i - 2), i + 1).reduce((s, v, k, arr) => s + v / arr.length, 0))]);
    return line([[X(0) - 4, Y(0.09)], [X(11) + 4, Y(0.6)]], '#fff', 1.2, 0.75) + body + line(ma, GOLD, 1.6, 0.9);
  },
  kline() {
    const cx = 52;
    return `<line x1="${cx}" x2="${cx}" y1="36" y2="120" stroke="${UP}" stroke-width="2"/><rect x="${cx - 13}" y="56" width="26" height="42" rx="3" fill="${UP}"/>
      ${[[36, '最高'], [56, '收盤'], [98, '開盤'], [120, '最低']].map(([y, s]) => dash(cx + 16, y, 92, y, 0.55) + text(96, y + 3.5, s, 10, 0.9)).join('')}`;
  },
  indicator() {
    const price = Array.from({ length: 15 }, (_, i) => [12 + i * 8.9, 58 - Math.sin(i * 0.62 - 0.6) * 15 - i * 0.6]);
    const vals = Array.from({ length: 14 }, (_, i) => Math.sin(i * 0.58 - 1.1) * 13);
    const bars = vals.map((v, i) => `<rect x="${f(13 + i * 9.1)}" y="${f(v > 0 ? 104 - v : 104)}" width="5" height="${f(Math.max(1.5, Math.abs(v)))}" rx="1" fill="${v > 0 ? UP : DN}" fill-opacity=".9"/>`).join('');
    const dif = vals.map((v, i) => [15.5 + i * 9.1, 104 - v * 0.85 - 2]), dea = vals.map((v, i) => [15.5 + i * 9.1, 104 - Math.sin((i - 1.2) * 0.58 - 1.1) * 11 - 2]);
    return line(price, '#fff', 1.8) + `<line x1="10" x2="138" y1="104" y2="104" stroke="#fff" stroke-opacity=".35"/>` + bars + line(dif, '#fff', 1.1, 0.85) + line(dea, GOLD, 1.1, 0.9) + text(12, 86, 'MACD', 8, 0.7);
  },
  volume() {
    const cl = [0.42, 0.37, 0.43, 0.38, 0.41, 0.37, 0.42, 0.39, 0.44, 0.78], { body, X } = chart(cl, { y: 30, h: 56 });
    const vol = [9, 12, 8, 10, 9, 12, 8, 10, 11, 30];
    let prev = cl[0] - 0.05;
    const bars = vol.map((v, i) => { const up = cl[i] >= prev; prev = cl[i]; return `<rect x="${f(X(i) - 3.6)}" y="${122 - v}" width="7.2" height="${v}" rx="1" fill="${up ? UP : DN}" fill-opacity="${i === 9 ? 1 : 0.6}"/>`; }).join('');
    return body + `<line x1="8" x2="140" y1="122" y2="122" stroke="#fff" stroke-opacity=".3"/>` + bars;
  },
  funding() {
    // 資金費率 every 8 hours: positive (longs pay) in the up colour, negative in the down colour; 未平倉量 above.
    const rates = [0.6, 0.9, 1.3, 0.8, 0.4, -0.3, -0.8, -0.5, 0.2, 0.7, 1.1, 1.6], base = 100, step = 10.4;
    const bars = rates.map((v, i) => `<rect x="${f(14 + i * step)}" y="${f(v > 0 ? base - v * 16 : base)}" width="6.4" height="${f(Math.max(1.5, Math.abs(v) * 16))}" rx="1.2" fill="${v > 0 ? UP : DN}"/>`).join('');
    const oi = rates.map((v, i) => [17 + i * step, 62 - i * 1.6 - Math.max(0, v) * 6]);
    return `<line x1="10" x2="138" y1="${base}" y2="${base}" stroke="#fff" stroke-opacity=".4"/>` + bars + line(oi, GOLD, 1.8) + text(12, 44, '未平倉量', 8, 0.75) + text(136, 126, '資金費率', 8, 0.75, 'end');
  },
  risk() {
    const { body } = chart([0.36, 0.42, 0.35, 0.41, 0.37, 0.4], { x: 8, y: 40, w: 54, h: 70 });
    return body + `<rect x="66" y="40" width="74" height="40" rx="3" fill="#fff" fill-opacity=".16"/><rect x="66" y="80" width="74" height="14" rx="3" fill="#ff6f86" fill-opacity=".45"/>
      ${dash(8, 80, 140, 80, 0.8)}${text(103, 58, '目標', 10, 0.95, 'middle')}${text(103, 72, '1 : 3', 9, 0.75, 'middle')}${text(103, 90.5, '停損', 9, 0.95, 'middle')}`;
  },
  mind() {
    const cols = ['#5ab0ff', '#7fd1d8', '#e8e2a0', '#ffc069', '#ff7f6e'], cx = 74, cy = 104, r = 50;
    const arc = (a0, a1) => { const p = a => [cx + r * Math.cos(a), cy - r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${f(x0)} ${f(y0)}A${r} ${r} 0 0 1 ${f(x1)} ${f(y1)}`; };
    const segs = cols.map((c, i) => `<path d="${arc(Math.PI - i * Math.PI / 5 - 0.04, Math.PI - (i + 1) * Math.PI / 5 + 0.04)}" stroke="${c}" stroke-width="12" fill="none" stroke-linecap="round"/>`).join('');
    const a = Math.PI * (1 - 0.7);
    return segs + `<line x1="${cx}" y1="${cy}" x2="${f(cx + 38 * Math.cos(a))}" y2="${f(cy - 38 * Math.sin(a))}" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>` + text(24, 122, '恐懼', 9, 0.85, 'middle') + text(124, 122, '貪婪', 9, 0.85, 'middle');
  },
  start() {
    // A coin and the chain of blocks behind it.
    const blocks = [0, 1, 2].map(i => `<rect x="88" y="${40 + i * 28}" width="44" height="18" rx="4" fill="#fff" fill-opacity="${f(0.2 + i * 0.12)}" stroke="#fff" stroke-opacity=".6"/>`).join('')
      + '<path d="M110 58v10M110 86v10" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>';
    return blocks + `<circle cx="50" cy="78" r="28" fill="${GOLD}"/><circle cx="50" cy="78" r="21.5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2"/>` + text(50, 87.5, '₿', 26, 0.95, 'middle');
  },
  account() {
    const pts = Array.from({ length: 9 }, (_, i) => [56 + i * 4.6, 74 - Math.sin(i * 0.8) * 6 - i * 1.4]);
    return `<rect x="46" y="30" width="56" height="94" rx="10" fill="#000" fill-opacity=".18" stroke="#fff" stroke-opacity=".75" stroke-width="1.6"/>
      ${text(54, 46, 'BTCUSDT', 7, 0.7)}${text(54, 58, '77,900', 11, 0.95)}${line(pts, UP, 1.6)}
      <rect x="52" y="98" width="21" height="14" rx="4" fill="${UP}"/><rect x="75" y="98" width="21" height="14" rx="4" fill="${DN}"/>${text(62.5, 108, '做多', 7, 1, 'middle')}${text(85.5, 108, '做空', 7, 1, 'middle')}`;
  },
  ox() {
    const d = 'M18 52C26 74 32 98 40 102S56 70 62 70S78 104 84 104S102 60 112 46';
    return `<path d="${d}" fill="none" stroke="${GOLD}" stroke-opacity=".25" stroke-width="10" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${GOLD}" stroke-width="3.4" stroke-linecap="round"/>
      <circle cx="112" cy="46" r="11" fill="#fff" fill-opacity=".18"/><circle cx="112" cy="46" r="6" fill="#fff"/>`;
  }
};
const MAP = { smc: 'smc', bipolar: 'bipolar', naked: 'naked', pattern: 'pattern', trend: 'trend', kline: 'kline', indicator: 'indicator', volume: 'volume', funding: 'funding', risk: 'risk', mind: 'mind', start: 'start', account: 'account', ox: 'ox' };
export function courseArt(id, viewBox = '0 0 148 176') {
  const draw = ART[MAP[id]]; if (!draw) return '';
  return `<svg class="lr-art" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${draw(id + viewBox.replace(/\W/g, ''))}</svg>`;
}

// 分享圖片: a 4:5 card (1080×1350) drawn on a canvas in the browser, shown as a preview
// first, then handed to the phone's share sheet (LINE, IG, Threads, 存到相簿). Where the
// browser cannot share files (some in-app browsers), 存圖 and a long press on the
// preview save it. Nothing is added to the page until a share is asked for.
// Entries: 畫板 cards (long press or the picture button), the drawing, 型態 cards and
// 型態詳情, 盤面, 首頁 and 資訊「今日重點」. Colours: 青藍漲／桃紅跌.
const W = 1080, H = 1350, PAD = 64;
const FONT = '-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif';
export const SHARE_UP = '#00b8d4', SHARE_DOWN = '#ff3078';
const C = { bg0: '#1c2532', bg1: '#0e1217', bg2: '#08090c', ink: '#eef1f4', muted: '#8d97a3', soft: '#d3d9df', up: SHARE_UP, down: SHARE_DOWN, gold: '#f5c451', hi: '#e8ff2e', panel: 'rgba(255,255,255,.035)', line: 'rgba(255,255,255,.08)' };
export const PERFORMANCE_NOTE = '過去表現不代表未來\n僅供研究參考・未含手續費';
export const sharePct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
export const shareTone = v => v > 0 ? C.up : v < 0 ? C.down : C.ink;
// Coin prices run from 0.00001 to 100,000: keep about six significant digits.
export const sharePrice = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v.toLocaleString('en-US', { maximumSignificantDigits: 6 });
export const shareMoney = v => !Number.isFinite(v) ? '—' : v >= 1e8 ? (v / 1e8).toFixed(2) + ' 億' : v >= 1e4 ? (v / 1e4).toFixed(1) + ' 萬' : v.toFixed(0);
const parts = (ms = Date.now()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
// 10/31 14:05 (Taipei): crypto trades all day, so a card names its minute.
export const shareTime = (ms = Date.now()) => { const p = parts(ms); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; };
const fileDay = () => { const p = parts(); return `${p.month.padStart(2, '0')}${p.day.padStart(2, '0')}_${p.hour}${p.minute}`; };
// The address on the card: the one the visitor is on when it is a public one.
function siteHost() {
  const host = globalThis.location?.hostname || '';
  return /(^|\.)oxpattern\.com$|\.vercel\.app$|\.chatgpt\.site$/.test(host) ? host.replace(/^www\./, '') : 'crypto.oxpattern.com';
}

function base(ctx) {
  const g = ctx.createRadialGradient(W * .15, 0, 0, W * .15, 0, W * 1.3);
  g.addColorStop(0, C.bg0); g.addColorStop(.52, C.bg1); g.addColorStop(1, C.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function text(ctx, s, x, y, { size = 28, weight = 700, color = C.ink, align = 'left', max } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(s), x, y, max);
  return Math.min(ctx.measureText(String(s)).width, max ?? Infinity);
}
// The OX mark (white and pale blue), the same shapes as the 畫板 logo in the dock, then 「OX 加密」.
const LOGO_PATHS = [
  'M534 16L503 8L476 8L461 11L434 22L93 221L78 232L64 246L57 255L45 277L38 301L36 332L36 663L41 693L53 719L74 745L93 759L180 812L190 812L196 809L202 802L207 788L207 557L211 532L216 515L232 481L251 454L272 431L326 378L361 353L394 337L432 326L468 322L501 324L524 329L545 337L564 347L582 360L619 397L634 405L647 408L668 407L690 398L703 388L711 379L722 359L727 335L727 187L724 163L715 140L701 120L687 107L584 44Z',
  'M800 168L789 168L782 172L774 185L772 196L773 399L770 428L762 458L746 494L729 521L680 576L652 602L625 622L590 641L556 652L518 657L481 655L459 650L433 640L410 627L398 618L371 590L362 583L351 577L338 573L312 574L291 583L277 594L269 603L259 621L253 644L253 796L257 816L266 838L278 855L298 873L444 961L460 967L480 971L512 969L536 961L885 760L903 747L912 738L925 721L934 704L940 686L943 663L943 317L941 299L936 281L928 264L919 250L905 234L887 220Z'
];
let MARK = null;
function mark(ctx, x, y, size) {
  MARK ??= LOGO_PATHS.map(d => new Path2D(d));
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 980, size / 980);
  ctx.shadowColor = 'rgba(153,200,226,.35)'; ctx.shadowBlur = 40;
  ctx.fillStyle = '#eef1f4'; ctx.fill(MARK[0]); ctx.fillStyle = '#99c8e2'; ctx.fill(MARK[1]);
  ctx.restore();
}
function header(ctx, right) {
  mark(ctx, PAD - 2, PAD - 8, 56);
  text(ctx, 'OX 加密', PAD + 66, PAD + 34, { size: 30, weight: 900 });
  if (!right) return;
  ctx.font = `700 25px ${FONT}`;
  const w = ctx.measureText(right).width + 40;
  roundRect(ctx, W - PAD - w, PAD - 8, w, 56, 28, null, 'rgba(255,255,255,.14)');
  text(ctx, right, W - PAD - w / 2, PAD + 28, { size: 25, color: '#a7b1be', align: 'center' });
}
function chips(ctx, list, x, y) {
  for (const [label, kind] of list) {
    if (!label) continue;
    ctx.font = `800 25px ${FONT}`;
    if (W - PAD - x < 90) break;
    const w = Math.min(ctx.measureText(label).width + 40, W - PAD - x), col = kind === 'tier' ? '#9fd8ff' : kind === 'plain' ? '#dfe6ee' : C.gold;
    roundRect(ctx, x, y, w, 52, 26, kind === 'tier' ? 'rgba(0,184,212,.12)' : kind === 'plain' ? 'rgba(255,255,255,.06)' : 'rgba(245,196,81,.12)', kind === 'tier' ? 'rgba(0,184,212,.45)' : kind === 'plain' ? 'rgba(255,255,255,.16)' : 'rgba(245,196,81,.42)');
    text(ctx, label, x + w / 2, y + 35, { size: 25, weight: 800, color: col, align: 'center', max: w - 24 });
    x += w + 12;
  }
}
// Candles with the pattern: fluorescent yellow before the breakout, the result's colour after.
function chart(ctx, box, { candles, points = [], breakIdx = null, label = '', minBars = 40 }) {
  roundRect(ctx, box.x, box.y, box.w, box.h, 28, C.panel, C.line);
  if (!candles?.length) { text(ctx, 'K 線讀取中斷', box.x + box.w / 2, box.y + box.h / 2, { size: 26, color: C.muted, align: 'center' }); return; }
  const end = candles.length - 1, first = points.length ? Math.floor(points[0][0]) : breakIdx ?? end;
  let start = Math.max(0, Math.min(first, breakIdx ?? end) - 10);
  if (end - start < minBars) start = Math.max(0, end - minBars);
  if (end - start > 140) start = end - 140;
  const ln = [];
  points.forEach(([i, y], j) => {
    if (i < start) return;
    const prev = points[j - 1];
    if (!ln.length && prev && prev[0] < start) ln.push([start, prev[1] + (y - prev[1]) * (start - prev[0]) / (i - prev[0])]);
    ln.push([i, y]);
  });
  const list = candles.slice(start), vals = [...list.flatMap(c => [c.high, c.low]), ...ln.map(p => p[1])];
  const hi = Math.max(...vals), lo = Math.min(...vals), bw = (box.w - 24) / list.length, body = Math.max(2, bw * .62);
  const X = i => box.x + 12 + (i - start + .5) * bw, Y = v => box.y + 54 + (hi - v) / (hi - lo || hi * .01 || 1) * (box.h - 70);
  ctx.save(); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 28); ctx.clip();
  const zoneFrom = ln.length ? Math.max(start, Math.round(ln[0][0])) : null, zoneTo = breakIdx ?? (ln.length ? Math.round(ln.at(-1)[0]) : null);
  if (zoneFrom != null && zoneTo != null && zoneTo >= zoneFrom) { ctx.fillStyle = 'rgba(232,255,46,.08)'; ctx.fillRect(X(zoneFrom) - bw / 2, box.y, X(zoneTo) - X(zoneFrom) + bw, box.h); }
  if (breakIdx != null && breakIdx < end) { ctx.fillStyle = (candles[end].close >= candles[breakIdx].close ? C.up : C.down) + '22'; ctx.fillRect(X(breakIdx) + bw / 2, box.y, X(end) - X(breakIdx), box.h); }
  for (let i = start; i <= end; i++) {
    const c = candles[i], col = c.close >= c.open ? C.up : C.down, t = Y(Math.max(c.open, c.close));
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, bw * .12); ctx.beginPath(); ctx.moveTo(X(i), Y(c.high)); ctx.lineTo(X(i), Y(c.low)); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(X(i) - body / 2, t, body, Math.max(2, Y(Math.min(c.open, c.close)) - t));
  }
  if (ln.length > 1) {
    // A shape has a few turning points (dots); a 走勢路徑 follows every candle (a line only).
    const dots = ln.length <= 12;
    ctx.strokeStyle = C.hi; ctx.globalAlpha = dots ? 1 : .9; ctx.lineWidth = dots ? 4 : 3; ctx.lineJoin = ctx.lineCap = 'round'; ctx.beginPath();
    ln.forEach(([i, y], j) => j ? ctx.lineTo(X(i), Y(y)) : ctx.moveTo(X(i), Y(y))); ctx.stroke(); ctx.globalAlpha = 1;
    if (dots) { ctx.fillStyle = C.hi; for (const [i, y] of ln) if (Number.isInteger(i)) { ctx.beginPath(); ctx.arc(X(i), Y(y), 6, 0, Math.PI * 2); ctx.fill(); } }
  }
  if (breakIdx != null && candles[breakIdx]) {
    const x0 = X(breakIdx), left = x0 > box.x + box.w * .55;
    ctx.setLineDash([10, 7]); ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, box.y); ctx.lineTo(x0, box.y + box.h); ctx.stroke(); ctx.setLineDash([]);
    if (label) text(ctx, label, left ? x0 - 12 : x0 + 12, box.y + 40, { size: 24, weight: 800, color: C.muted, align: left ? 'right' : 'left' });
  }
  ctx.restore();
}
function stats(ctx, list, y, h = 120) {
  const w = (W - PAD * 2 - 16 * (list.length - 1)) / list.length;
  list.forEach(([label, value, color], i) => {
    const x = PAD + i * (w + 16);
    roundRect(ctx, x, y, w, h, 26, 'rgba(255,255,255,.045)');
    text(ctx, label, x + 24, y + 42, { size: 23, weight: 600, color: C.muted, max: w - 40 });
    const quiet = /^(還沒到|—)$/.test(String(value));
    text(ctx, value, x + 24, y + h - 24, { size: quiet ? 34 : 40, weight: quiet ? 700 : 900, color: quiet ? C.muted : color || C.ink, max: w - 40 });
  });
}
function footer(ctx, note = '型態辨識結果，不是投資建議') {
  const lines = String(note).split('\n'), host = siteHost();
  ctx.font = `600 22px ${FONT}`;
  const noteWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
  text(ctx, host, PAD, H - PAD - 34, { size: 40, weight: 900, color: C.gold, max: W - PAD * 2 - noteWidth - 32 });
  text(ctx, '手畫型態・找全部幣種', PAD, H - PAD + 4, { size: 23, weight: 600, color: '#7f8a98' });
  lines.reverse().forEach((line, i) => text(ctx, line, W - PAD, H - PAD + 4 - i * 32, { size: 22, weight: 600, color: '#7f8a98', align: 'right' }));
}
function canvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }

// The app styles every button globally; the preview's own buttons keep this look.
function ensureStyle() {
  if (document.getElementById('ox-share-style')) return;
  const style = document.createElement('style'); style.id = 'ox-share-style';
  const font = FONT.replaceAll('"', "'");
  style.textContent = `dialog.ox-share-preview{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:20px;border:0;box-sizing:border-box;background:rgba(3,5,8,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:${font};color:#fff}
dialog.ox-share-preview::backdrop{background:transparent}
/* 白金 paints every dialog and button; the preview stays dark with its own buttons. */
html body dialog.ox-share-preview.ox-share-preview.ox-share-preview:not(#ox-share-none){background:rgba(3,5,8,.86)!important;background-image:none!important;color:#fff!important;border:0!important;border-radius:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
.ox-share-preview img{display:block;max-width:min(86vw,440px);max-height:68dvh;border-radius:14px;-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto;box-shadow:0 18px 50px #000b}
.ox-share-preview p{margin:0;color:#c9d1db!important;font:500 13px/1.5 ${font}!important;text-align:center}
.ox-share-preview .sp-row{display:flex;gap:10px}
.ox-share-preview .sp-btn{all:unset!important;box-sizing:border-box!important;min-width:78px!important;padding:10px 18px!important;border-radius:11px!important;font:750 14px/1 ${font}!important;text-align:center!important;cursor:pointer!important;-webkit-tap-highlight-color:transparent!important}
html body dialog.ox-share-preview .sp-btn.sp-main:not(#ox-share-none){background:#f5c451!important;color:#15120a!important;border:0!important;box-shadow:none!important}
html body dialog.ox-share-preview .sp-btn.sp-line:not(#ox-share-none){background:transparent!important;border:1px solid rgba(255,255,255,.38)!important;color:#fff!important;box-shadow:none!important}
.ox-share-preview .sp-btn:focus-visible{outline:2px solid #fff!important;outline-offset:2px!important}`;
  document.head.append(style);
}
// A preview first, with 分享 / 存圖 / 關閉: the share sheet then opens from the visitor's
// own tap (iOS refuses it after a long press plus the drawing time). A modal dialog sits
// in the top layer, above an open 型態詳情 or event sheet.
async function deliver(cv, file, kind) {
  globalThis.OXTrack?.('share.image', kind);
  const blob = await new Promise(resolve => cv.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  ensureStyle();
  const shareFile = new File([blob], file, { type: 'image/png' });
  let canShare = false; try { canShare = !!navigator.canShare?.({ files: [shareFile] }); } catch {}
  const url = URL.createObjectURL(blob), back = document.createElement('dialog');
  back.className = 'ox-share-preview'; back.setAttribute('aria-label', '分享圖片預覽');
  back.innerHTML = `<img alt="分享圖片"><p>${canShare ? '按分享傳到 LINE、IG、Threads；也可以長按圖片存起來' : '長按圖片可以存到相簿，或按存圖'}</p><div class="sp-row">${canShare ? '<button type="button" data-share-go class="sp-btn sp-main">分享</button>' : ''}<a download class="sp-btn ${canShare ? 'sp-line' : 'sp-main'}" data-share-save>存圖</a><button type="button" data-share-close class="sp-btn sp-line">關閉</button></div>`;
  back.querySelector('img').src = url;
  const save = back.querySelector('a'); save.href = url; save.download = file;
  const close = () => { if (back.open) back.close(); back.remove(); URL.revokeObjectURL(url); };
  back.addEventListener('cancel', event => { event.preventDefault(); close(); });
  back.addEventListener('click', async event => {
    if (event.target === back || event.target.closest('[data-share-close]')) { close(); return; }
    if (event.target.closest('[data-share-save]')) { globalThis.OXTrack?.('share.saved', kind); return; }
    if (event.target.closest('[data-share-go]')) {
      try { await navigator.share({ files: [shareFile], text: siteHost() }); globalThis.OXTrack?.('share.sent', kind); close(); }
      catch (error) { if (error?.name !== 'AbortError') console.warn('分享失敗', error); }
    }
  });
  document.body.append(back);
  try { back.showModal(); } catch { back.setAttribute('open', ''); }
  return back;
}

// One coin: name, chips, the chart with its pattern, up to three numbers, an optional big result.
export async function shareCoin({ name, symbol, chips: tags = [], candles, points = [], breakIdx = null, label = '', minBars = 40, facts = [], big = null, dateLabel = shareTime(), note, kind = 'coin' }) {
  const cv = canvas(), ctx = cv.getContext('2d');
  base(ctx); header(ctx, dateLabel);
  const y = PAD + 150, nameMax = big ? 520 : W - PAD * 2 - 260;
  const nw = text(ctx, name, PAD, y, { size: 76, weight: 900, max: nameMax });
  if (symbol && symbol !== name) text(ctx, symbol, PAD + nw + 18, y, { size: 34, weight: 700, color: C.muted, max: W - PAD * 2 - nw - 18 - (big ? 400 : 0) });
  if (big) {
    text(ctx, big.label, W - PAD, y - 56, { size: 26, color: C.muted, align: 'right', max: 420 });
    text(ctx, big.value, W - PAD, y + 26, { size: 92, weight: 900, color: big.color, align: 'right', max: 420 });
  }
  chips(ctx, tags, PAD, y + 34);
  const chartY = y + 118, chartH = facts.length ? 640 : 790;
  chart(ctx, { x: PAD, y: chartY, w: W - PAD * 2, h: chartH }, { candles, points, breakIdx, label, minBars });
  if (facts.length) stats(ctx, facts.slice(0, 3), chartY + chartH + 28);
  footer(ctx, note);
  return deliver(cv, `OX_${symbol || name}_${fileDay()}.png`, kind);
}

// What the visitor drew, and the four closest coins.
export async function shareDrawing({ strokes, matches, dateLabel = shareTime() }) {
  const cv = canvas(), ctx = cv.getContext('2d');
  base(ctx); header(ctx, dateLabel);
  text(ctx, '我畫的型態', PAD, PAD + 140, { size: 58, weight: 900 });
  text(ctx, `OX 從全部幣種找出最像的 ${Math.min(4, matches.length)} 個`, PAD, PAD + 188, { size: 28, weight: 700, color: C.muted });
  const box = { x: PAD, y: PAD + 220, w: W - PAD * 2, h: 230 };
  roundRect(ctx, box.x, box.y, box.w, box.h, 28, C.panel, C.line);
  const pts = strokes.flat(), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // Strokes keep y pointing up.
  const sx = p => box.x + 30 + (p.x - x0) / (x1 - x0 || 1) * (box.w - 60), sy = p => box.y + 26 + (y1 - p.y) / (y1 - y0 || 1) * (box.h - 52);
  ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = 14; ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))); ctx.stroke(); }
  ctx.restore();
  const list = matches.slice(0, 4), wide = list.length <= 2, cw = wide ? W - PAD * 2 : (W - PAD * 2 - 20) / 2, ch = 300;
  if (!list.length) text(ctx, '目前沒有相似的幣種', PAD, box.y + box.h + 80, { size: 30, weight: 700, color: C.muted });
  list.forEach((m, i) => {
    const x = wide ? PAD : PAD + (i % 2) * (cw + 20), y = box.y + box.h + 28 + (wide ? i : Math.floor(i / 2)) * (ch + 20);
    roundRect(ctx, x, y, cw, ch, 24, 'rgba(255,255,255,.04)', C.line);
    const nw = text(ctx, m.name, x + 22, y + 46, { size: 32, weight: 900, max: cw - 220 });
    if (m.frame) text(ctx, m.frame, x + 22 + nw + 10, y + 46, { size: 22, weight: 700, color: C.muted });
    text(ctx, m.label || '', x + cw - 22, y + 46, { size: 25, weight: 800, color: C.gold, align: 'right' });
    chart(ctx, { x: x + 10, y: y + 62, w: cw - 20, h: ch - 72 }, { candles: m.candles, points: m.points });
  });
  footer(ctx);
  return deliver(cv, `OX_我畫的型態_${fileDay()}.png`, 'drawing');
}

// Wrap text to a width; CJK breaks anywhere, a Latin word stays whole.
function wrap(ctx, s, width) {
  const tokens = String(s).match(/[A-Za-z0-9.,+\-%（）()／/$]+|\s+|./gu) || [], lines = [];
  let line = '';
  for (const t of tokens) {
    // Closing punctuation never starts a line.
    if (/^[。，、；：）」』%．,.;:)]$/.test(t)) { line += t; continue; }
    if (ctx.measureText(line + t).width > width && line.trim()) { lines.push(line.trimEnd()); line = t.trimStart(); }
    else line += t;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

// 首頁: BTC, four numbers (市場寬度, ETH, SOL), the latest breakouts, then 上漲 and 下跌
// T1／T2／T3 side by side.
export async function shareHome({ dateLabel = shareTime(), btc, tiles = [], breaks = null, long = [], short = [] }) {
  const cv = canvas(), ctx = cv.getContext('2d');
  base(ctx); header(ctx, dateLabel);
  text(ctx, 'BTC 永續', PAD, PAD + 136, { size: 30, weight: 800, color: C.muted });
  const value = btc?.price ?? '—';
  ctx.font = `900 112px ${FONT}`; const vw = Math.min(ctx.measureText(value).width, W - PAD * 2 - 280), cx = Math.min(PAD + vw + 30, W - PAD - 250);
  text(ctx, value, PAD, PAD + 252, { size: 112, weight: 900, max: W - PAD * 2 - 280 });
  if (btc?.change) { text(ctx, '24H 漲跌', cx, PAD + 190, { size: 23, weight: 700, color: C.muted }); text(ctx, btc.change, cx, PAD + 252, { size: 52, weight: 900, color: btc.color || C.ink, max: 250 }); }
  let y = PAD + 300;
  if (tiles.length) { stats(ctx, tiles, y, 120); y += 120; }
  // The newest 4H close's breakouts on one line: coin and the change since the breakout.
  if (breaks?.items?.length) {
    roundRect(ctx, PAD, y + 20, W - PAD * 2, 104, 26, 'rgba(255,255,255,.035)', C.line);
    text(ctx, breaks.title, PAD + 26, y + 60, { size: 24, weight: 800, color: C.soft, max: W - PAD * 2 - 52 });
    let x = PAD + 26;
    for (const item of breaks.items) {
      ctx.font = `800 30px ${FONT}`; const nw = ctx.measureText(item.name).width;
      ctx.font = `800 27px ${FONT}`; const cw = ctx.measureText(item.change).width;
      if (x + nw + 10 + cw > W - PAD - 26) break;
      text(ctx, item.name, x, y + 106, { size: 30, weight: 800 });
      text(ctx, item.change, x + nw + 10, y + 106, { size: 27, weight: 800, color: item.color || C.ink });
      x += nw + 10 + cw + 30;
    }
    y += 124;
  } else y += 4;
  // Two columns of candidates, a tier label where each tier starts.
  const colW = (W - PAD * 2 - 24) / 2, rowH = 56, bottom = H - PAD - 130;
  [[long, '上漲', C.up], [short, '下跌', C.down]].forEach(([rows, title, color], c) => {
    const x = PAD + c * (colW + 24); let ry = y + 20;
    roundRect(ctx, x, ry, colW, bottom - ry, 26, 'rgba(255,255,255,.035)', C.line);
    text(ctx, `${title}・T1／T2／T3`, x + 26, ry + 50, { size: 27, weight: 900, color, max: colW - 52 });
    ry += 72;
    if (!rows.length) { text(ctx, '目前沒有候選', x + 26, ry + 36, { size: 26, weight: 600, color: C.muted }); return; }
    let last = null;
    for (const r of rows) {
      const head = r.tier !== last;
      if (ry + rowH + (head ? 38 : 0) > bottom - 8) break;
      if (head) { text(ctx, r.tier, x + 26, ry + 28, { size: 22, weight: 800, color: '#9fd8ff' }); ry += 38; last = r.tier; }
      text(ctx, r.name, x + 26, ry + 36, { size: 31, weight: 800, max: colW - 230 });
      text(ctx, r.change, x + colW - 26, ry + 36, { size: 29, weight: 900, color: r.color || C.ink, align: 'right' });
      ry += rowH;
    }
  });
  footer(ctx, '分級與突破為系統計算\n型態辨識網站，不是投資建議');
  return deliver(cv, `OX_加密總覽_${fileDay()}.png`, 'home');
}

// 今日重點新聞: the day's most important headlines on one card.
export async function shareNews({ dateLabel, items }) {
  const cv = canvas(), ctx = cv.getContext('2d'), width = W - PAD * 2, bottom = H - PAD - 120;
  base(ctx); header(ctx, dateLabel);
  text(ctx, '今日重點新聞', PAD, PAD + 150, { size: 64, weight: 900 });
  let y = PAD + 200;
  for (const [i, item] of items.entries()) {
    ctx.font = `800 34px ${FONT}`;
    const lines = wrap(ctx, item.title, width - 56).slice(0, 3);
    const h = 40 + lines.length * 46 + 24;
    if (y + h > bottom) break;
    if (i) { ctx.fillStyle = C.line; ctx.fillRect(PAD, y, width, 2); }
    roundRect(ctx, PAD, y + 22, 40, 40, 12, i < 3 ? C.gold : 'rgba(255,255,255,.1)');
    text(ctx, String(i + 1), PAD + 20, y + 51, { size: 24, weight: 900, color: i < 3 ? '#15120a' : C.ink, align: 'center' });
    text(ctx, item.meta, PAD + 56, y + 48, { size: 23, weight: 700, color: C.muted, max: width - 56 });
    lines.forEach((l, j) => text(ctx, l, PAD + 56, y + 92 + j * 46, { size: 34, weight: 800 }));
    y += h + 10;
  }
  footer(ctx, '新聞來源以原文為準\n型態辨識網站，不是投資建議');
  return deliver(cv, `OX_今日重點新聞_${fileDay()}.png`, 'news');
}

// Long-press helper shared by the board and the 型態 list: after `ms` without moving
// more than 10px, `onPress(element)` runs and the click that follows is swallowed.
export function longPress(root, selector, onPress, { ms = 500 } = {}) {
  let press = null, pressed = false;
  const life = new AbortController(), signal = life.signal;
  root.addEventListener('pointerdown', event => {
    pressed = false;
    const el = event.target.closest?.(selector); if (!el) return;
    press = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { pressed = true; press = null; onPress(el); }, ms) };
  }, { signal });
  const release = event => { if (press && (event.type !== 'pointermove' || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10)) { clearTimeout(press.timer); press = null; } };
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) root.addEventListener(type, release, { signal });
  root.addEventListener('click', event => { if (pressed) { pressed = false; event.preventDefault(); event.stopPropagation(); } }, { capture: true, signal });
  root.addEventListener('contextmenu', event => { if (event.target.closest?.(selector)) event.preventDefault(); }, { signal });
  return () => { clearTimeout(press?.timer); life.abort(); };
}
// The picture icon on cards and buttons: a small framed landscape.
export const PICTURE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="9" cy="10" r="1.7"/><path d="m20.5 15.5-4.8-4.8-8.7 8.8"/></svg>';

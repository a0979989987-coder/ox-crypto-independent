// 交易教學 (draft), from the Taiwan site (PRs #49–#50): courses in rows that scroll
// sideways, stacked down the page (交易法, 交易知識, 新手入門). A course opens as a
// level map to clear one stage at a time. The lessons are still being written, so
// every stage is locked and marked 製作中; nothing here pretends to be finished content.
// The market-neutral courses are the Taiwan ones; the stock-only ones are rewritten for
// crypto (籌碼面 → 資金費率與持倉, 股票是什麼 → 加密貨幣是什麼, 開戶與下單 →
// 交易所與下單, 用 OX 選股 → 用 OX 找幣) and wait for the owner's lessons like the rest.
import { icon, escapeHTML } from './chrome-style.js';
import { courseArt } from './learn-art.js';

const ROWS = [
  ['交易法', '一套完整的進出場方法', [
    ['smc', 'SMC／ICT', '聰明錢概念', ['#2b3d63', '#4f7cc4']],
    ['bipolar', '雙極交易法', 'Snsheng 的交易法', ['#0f1a26', '#2b4a68']],
    ['naked', '裸 K', '只看價格行為', ['#2f2f36', '#7b8494']],
    ['pattern', '型態學', 'W 底、頭肩、三角收斂', ['#1f4d45', '#3fa58a']],
    ['trend', '趨勢交易', '趨勢線與均線', ['#4b2340', '#c04f8a']]
  ]],
  ['交易知識', '想補哪一塊就從哪一塊開始', [
    ['kline', 'K 線基礎', '一根 K 棒在說什麼', ['#3a2b14', '#b5852f']],
    ['indicator', '技術指標', 'MACD、KD、RSI、布林', ['#14324a', '#3b8fc4']],
    ['volume', '量價關係', '成交量怎麼看', ['#20403a', '#4fae95']],
    ['funding', '資金費率與持倉', '未平倉量、多空比', ['#40261c', '#c26a45']],
    ['risk', '風險管理', '停損、部位大小、槓桿', ['#3d1820', '#c44e63']],
    ['mind', '交易心理', '紀律與情緒', ['#2c2448', '#7d6bd1']]
  ]],
  ['新手入門', '第一次接觸加密貨幣從這裡開始', [
    ['start', '加密貨幣是什麼', '從比特幣開始', ['#203a2a', '#5bb07a']],
    ['account', '交易所與下單', '第一筆合約交易', ['#2a3140', '#6f86ad']],
    ['ox', '用 OX 找幣', '畫板、型態、行情', ['#1d2a33', '#99c8e2']]
  ]]
];
const STAGES = 8;

function ensureStyle() {
  if (document.getElementById('lr-style')) return;
  const s = document.createElement('style'); s.id = 'lr-style';
  s.textContent = `
.lr{display:flex;flex-direction:column;gap:var(--sp-5);padding-top:var(--sp-1);font-family:var(--oc-font)}
.lr-note{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border-radius:var(--r-s);background:var(--oc-soft);font:500 var(--fs-label)/1.5 var(--oc-font);color:var(--oc-muted)}
.lr-sec h3{margin:0;font:600 var(--fs-section) var(--oc-font);color:var(--oc-ink)}.lr-sec p{margin:2px 0 var(--sp-2);font:400 var(--fs-label) var(--oc-font);color:var(--oc-muted)}
.lr-row{display:flex;gap:var(--sp-2);overflow-x:auto;scrollbar-width:none;margin:0 calc(-1 * var(--gutter));padding:0 var(--gutter) var(--sp-1);scroll-padding-inline:var(--gutter);scroll-snap-type:x mandatory;overscroll-behavior-x:contain}.lr-row::-webkit-scrollbar{display:none}
.lr-card{flex:none;width:148px;height:176px;border:0;border-radius:var(--r-m);padding:var(--sp-3);display:flex;flex-direction:column;justify-content:flex-end;text-align:left;color:#fff;scroll-snap-align:start;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.18)}
.lr-card::before{content:"";position:absolute;inset:0;background:radial-gradient(90% 60% at 80% 0%,rgba(255,255,255,.22),rgba(255,255,255,0) 60%)}
.lr-card::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.5))}
.lr-card .lr-art{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0}
.lr-art text{font-family:var(--oc-font)}
.lr-card b{position:relative;z-index:2;font:600 var(--fs-section) var(--oc-font)}.lr-card small{position:relative;z-index:2;margin-top:2px;font:500 var(--fs-caption)/1.35 var(--oc-font);opacity:.88}
.lr-card i{position:absolute;z-index:2;top:var(--sp-2);left:var(--sp-2);font:600 var(--fs-caption)/1.3 var(--oc-font);font-style:normal;padding:2px var(--sp-2);border-radius:var(--r-pill);background:rgba(0,0,0,.32)}
.lr-map{display:flex;flex-direction:column;align-items:center;gap:0;padding:10px 0 30px}
.lr-hero{width:100%;border-radius:var(--r-m);padding:var(--sp-4);color:#fff;margin-bottom:var(--sp-4);position:relative;overflow:hidden}
.lr-hero{min-height:118px;box-sizing:border-box}.lr-hero .lr-art{position:absolute;right:4px;top:4px;width:150px;height:110px}
.lr-hero b,.lr-hero small,.lr-hero .bar{position:relative;max-width:60%}
/* the light theme recolours buttons and bold text; cards and the banner keep white text */
html body .lr .lr-card.lr-card.lr-card,html body .lr .lr-card.lr-card.lr-card :is(b,small,i),html body .lr .lr-hero.lr-hero.lr-hero :is(b,small){color:#fff!important;-webkit-text-fill-color:#fff}
.lr-hero b{display:block;font:600 20px var(--oc-font)}.lr-hero small{display:block;margin-top:var(--sp-1);font:500 var(--fs-label) var(--oc-font);opacity:.85;white-space:nowrap}
.lr-hero .bar{margin-top:14px;height:6px;border-radius:3px;background:rgba(255,255,255,.25)}.lr-hero .bar i{display:block;width:0;height:100%;border-radius:3px;background:#fff}
.lr-stage{display:flex;flex-direction:column;align-items:center;gap:6px;margin:6px 0}
.lr-node{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;border:0;font:600 18px var(--oc-font);color:var(--oc-muted);background:var(--oc-soft);box-shadow:inset 0 -5px 0 rgba(0,0,0,.08);cursor:default}
.lr-node.first{color:#fff}
.lr-node svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lr-stage span{font:500 12px var(--oc-font);color:var(--oc-muted)}
.lr-link{width:4px;height:22px;border-radius:2px;background:var(--oc-line)}
`;
  document.head.append(s);
}
const lock = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const grad = c => `linear-gradient(145deg,${c[0]},${c[1]})`;

function homeHTML() {
  return `<div class="lr"><div class="lr-note">${icon('learn')}草圖：課程內容製作中，先看看之後會長怎樣。</div>
    ${ROWS.map(([title, sub, list]) => `<section class="lr-sec"><h3>${title}</h3><p>${sub}</p><div class="lr-row">${list.map(([id, name, desc, c]) => `<button type="button" class="lr-card" data-lr="${id}" style="background:${grad(c)}">${courseArt(id)}<i>製作中</i><b>${escapeHTML(name)}</b><small>${escapeHTML(desc)}</small></button>`).join('')}</div></section>`).join('')}
  </div>`;
}
function courseHTML(id) {
  const c = ROWS.flatMap(r => r[2]).find(x => x[0] === id); if (!c) return homeHTML();
  // Stages zigzag down the page like a game map.
  const off = i => [0, 46, 64, 46, 0, -46, -64, -46][i % 8];
  const stages = Array.from({ length: STAGES }, (_, i) => `${i ? '<div class="lr-link"></div>' : ''}<div class="lr-stage" style="transform:translateX(${off(i)}px)"><button type="button" class="lr-node${i ? '' : ' first'}" ${i ? '' : `style="background:${grad(c[3])}"`} disabled aria-label="第 ${i + 1} 關，製作中">${i ? lock : '1'}</button><span>第 ${i + 1} 關・製作中</span></div>`).join('');
  return `<div class="lr"><div class="lr-map"><div class="lr-hero" style="background:${grad(c[3])}">${courseArt(c[0], '0 24 148 104')}<b>${escapeHTML(c[1])}</b><small>${escapeHTML(c[2])}・關卡製作中</small><div class="bar"><i></i></div></div>${stages}</div></div>`;
}

export function openLearn() {
  ensureStyle();
  document.querySelector('.oc-sheet[data-learn]')?.remove();
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.dataset.learn = '';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '交易教學');
  let course = null;
  const render = () => {
    const title = course ? ROWS.flatMap(r => r[2]).find(x => x[0] === course)?.[1] || '交易教學' : '交易教學';
    sheet.innerHTML = `<div class="oc-sheet-head"><button type="button" class="oc-btn oc-back" data-x aria-label="返回">${icon('back')}</button><h2>${escapeHTML(title)}</h2></div><div class="oc-body">${course ? courseHTML(course) : homeHTML()}</div>`;
    sheet.querySelector('.oc-body').scrollTop = 0;
  };
  render(); document.body.append(sheet);
  globalThis.OXTrack?.('learn.open');
  const leave = () => { sheet.remove(); document.removeEventListener('keydown', onKey); globalThis.OXDrawer?.open(); };
  const back = () => { if (course) { course = null; render(); } else leave(); };
  const onKey = e => { if (e.key === 'Escape') back(); };
  document.addEventListener('keydown', onKey);
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-x')) { back(); return; }
    if (b.dataset.lr) { course = b.dataset.lr; globalThis.OXTrack?.('learn.course', course); render(); }
  });
}

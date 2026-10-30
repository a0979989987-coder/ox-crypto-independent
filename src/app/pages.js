// Pages opened from the drawer — 使用說明 and OX Journal — drawn in the app's own
// list-and-card style. Each is a full-screen sheet; ‹ closes it and brings the
// drawer back. 設定 is the app's 設定 view (drawer.js), which keeps the member
// card with the Bitget UID, 媒體, 主題, 進階設定 and the picture guide.
import { icon, escapeHTML, LOGO } from './chrome-style.js';

const YOUTUBE = 'https://youtube.com/@snsheng?si=Dgl_f_Xv5SfPXvX-';
const LINE = 'https://line.me/ti/g2/FXj0yahd04U4JecSoC4uPInXiqhLulqdCl54Ag?utm_source=invitation';
const linkRow = ({ ic, title, sub = '', href }) => `<a class="op-row" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${icon(ic)}<span class="op-t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><i class="op-arrow">↗</i></a>`;

// 使用說明: what each page is for and the one or two things to tap there.
const GUIDE = [
  ['spark', '首頁', 'home', 'BTC 現在的價格和走勢、這 4 小時突破的幣種、上漲和下跌的 T1／T2／T3，還有此刻發生的新聞。上面的搜尋可以直接找幣種。'],
  ['tool', '行情', 'strength', '上面的小分頁切換：雷達、自選、排行、泡泡圖、強弱對比、熱力圖、板塊輪動、主動買賣。雷達就是 OX 的 T1／T2／T3，可以切熱門、自選和多空。點任何幣種就進個股頁。'],
  ['pen', '畫板', 'radar', '用手指畫出你想找的走勢，或從右上選一個型態（諧波也在裡面），就會列出長得像的幣種。預設看 4 小時加 1 小時，左上「篩選」可以改時間級別、成交額和條件。'],
  ['calendar', '型態', 'pattern', '「每 4 小時突破」是畫板每根 4 小時 K 收盤時列出的確認突破，之後 4 小時、1 天、3 天漲跌多少都記下來；「長期勝率」把每次加起來，按等級和型態看；「過去紀錄」一次看每個時間點。'],
  ['search', '個股頁', null, 'K 線可以切 1 分鐘到週線，「指標」裡有均線、布林、KD、RSI、MACD、CCI 和前高前低提醒。畫線工具有趨勢線、水平線、斐波那契等，也可以全螢幕。底部可以加自選、做成圖片分享，或按「畫相似型態」把最近的走勢拿去畫板找同類。'],
  ['journal', '資訊', 'data', '行事曆看非農、CPI、FOMC 等經濟數據，公布後會標出實際值和公布前後走勢；關鍵新聞也在這裡。'],
  ['star', '加到手機主畫面', null, '用 Safari 打開，按下面的分享鍵，選「加入主畫面」。之後從桌面點 OX加密 就能直接打開。']
];
function guideHTML() {
  return GUIDE.map(([ic, title, view, text]) => `<section class="op-card"><h3>${icon(ic)}${title}</h3><p>${text}</p>${view ? `<button type="button" class="oc-btn op-small op-go" data-op-go="${view}">打開${title} ›</button>` : ''}</section>`).join('');
}

const CORE = [
  ['全市場輪巡', '不是只看漲幅榜，而是持續掃描通過流動性門檻的 USDT 永續合約。'],
  ['資金與結構', '成交額、放量、相對強弱、價格結構與 Setup 一起看，不靠單一指標。'],
  ['T1／T2／T3', 'T1 條件完整最多 10 個不補位，其餘合格的同向候選依序列 T2、T3 各 15 個。'],
  ['前高前低提醒', '把重要的大級別結構位置變成提醒，不用一直盯著螢幕。']
];
function journalHTML() {
  return `<section class="op-hero">${LOGO}<small>OX JOURNAL / PERSPECTIVES</small><h2>少一點雜訊。<br>多一點判斷。</h2><p>把大量市場雜訊整理成真正值得花時間看的行情。從市場結構出發，分享 OX 的觀察、方法與思考。</p></section>
    <section class="op-card"><h3>${icon('group')}我是誰</h3><p>我是 OX 的創作者，也是一個長期把時間花在價格行為、趨勢、結構與資金流動上的交易者。OX 不是從「我想做一個網站」開始，而是從我每天都遇到的一個問題開始：市場裡有太多幣，但真正值得看的其實很少。</p></section>
    <section class="op-card"><h3>${icon('tool')}OX 是做什麼的</h3><p>OX 是一個市場篩選與看盤工具。加密市場使用 OX 經典判斷，先找有效水平或斜線壓力、右側方向與同向量能，再用 T1、T2、T3 幫我縮小觀察範圍。最後的交易決策仍然交給人。</p></section>
    <div><p class="op-label">核心功能</p><div class="op-grid">${CORE.map(([t, d]) => `<section class="op-card"><h3>${t}</h3><p>${d}</p></section>`).join('')}</div></div>
    <div><p class="op-label">我的想法</p><p class="op-quote">市場最底層的東西不是指標，而是錢。錢進入市場，留下成交量、波動與價格行為；價格行為形成 K 線，K 線累積成結構，結構最後變成我們看到的趨勢。</p></div>
    <section class="op-card"><p>我做 OX，不是希望它替人預測下一根 K 線，也不是要它告訴所有人現在該買什麼。我更想做的是把不值得看的行情先排除掉。因為交易裡，選擇不做什麼，常常跟選擇做什麼一樣重要。</p><p>我真正想留下的只有四件事：有錢、有流動性、有結構，而且是我看得懂的行情。OX 的角色，就是把幾百個標的縮成少數值得我親自打開 K 線確認的候選。</p></section>
    <div class="op-group">${linkRow({ ic: 'spark', title: 'YouTube', sub: '@snsheng', href: YOUTUBE })}${linkRow({ ic: 'group', title: 'LINE 社群', href: LINE })}</div>
    <div class="op-group"><button type="button" class="oc-btn op-row" data-op-news>${icon('calendar')}<span class="op-t"><b>查看官方市場消息</b></span><i class="op-arrow">›</i></button></div>`;
}

const TITLES = { guide: '使用說明', journal: 'OX Journal' };
export function openPage(kind) {
  if (!TITLES[kind]) return;
  document.querySelector('.oc-sheet[data-page]')?.remove();
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.dataset.page = kind;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', TITLES[kind]);
  sheet.innerHTML = `<div class="oc-sheet-head"><button type="button" class="oc-btn oc-back" data-x aria-label="收起">${icon('back')}</button><h2>${TITLES[kind]}</h2></div><div class="oc-body"><div class="op-body">${kind === 'guide' ? guideHTML() : journalHTML()}</div></div>`;
  document.body.append(sheet);
  globalThis.OXTrack?.(kind === 'guide' ? 'page.guide' : 'page.journal');
  const leave = (reopen = true) => { sheet.remove(); document.removeEventListener('keydown', onKey); if (reopen) globalThis.OXDrawer?.open(); };
  const onKey = e => { if (e.key === 'Escape') leave(); };
  document.addEventListener('keydown', onKey);
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-x')) { leave(); return; }
    if (b.dataset.opGo) { leave(false); if (b.dataset.opGo === 'data' && window.OXNews?.openMarket) window.OXNews.openMarket(); else window.switchAppView?.(b.dataset.opGo); return; }
    if (b.hasAttribute('data-op-news')) { leave(false); window.OXNews?.open?.(); }
  });
  requestAnimationFrame(() => sheet.querySelector('[data-x]')?.focus({ preventScroll: true }));
}

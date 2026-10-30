// Left drawer from the avatar: account and sync, 我的自選, 通知, 意見回饋, 使用說明,
// the LINE community, OX Journal, the last four places used, then 設定, 取得幫助 and
// the theme at the foot. The page slides right under a scrim; tap the scrim, swipe
// left or press Esc to close. 設定 (and the media page) open as pages with a title
// and ‹, which returns to where you were with the drawer open again.
import { icon, escapeHTML, avatarHTML, coinOf, openCoin } from './chrome-style.js';
import { FEATURES, openFeature, logoHTML } from './topbar.js';
import { openPage } from './pages.js';

export const LINE_URL = 'https://line.me/ti/g2/FXj0yahd04U4JecSoC4uPInXiqhLulqdCl54Ag?utm_source=invitation';
const TOOL_NAMES = { radar: '雷達', watch: '自選', rank: '排行', bubbles: '泡泡圖', strength: '強弱對比', heatmap: '熱力圖', rotation: '板塊輪動', flow: '主動買賣' };
const TOOL_ICONS = { radar: 'radar', watch: 'star', rank: 'rank', bubbles: 'bubbles', strength: 'tool', heatmap: 'grid', rotation: 'spark', flow: 'tool' };
const count = () => { try { return getWatchlistRecords().length; } catch { return 0; } };

let drawer, scrim, notices = 0;
function render() {
  const m = globalThis.OXMember?.member, configured = !!globalThis.OXMember?.configured;
  const recent = (globalThis.OXRecent?.list() || []).filter(x => x.type === 'coin' ? /USDT$/.test(x.id) : TOOL_NAMES[x.id]).slice(0, 4);
  const light = document.body.classList.contains('theme-light');
  drawer.innerHTML = `<div class="oc-me"><div class="oc-ava">${avatarHTML(m)}</div><div><b>${escapeHTML(m ? m.name || '會員' : '訪客')}</b><small>${escapeHTML(m ? m.email : '登入後自選和設定換手機也在')}</small></div></div>
    ${m ? `<div class="oc-sync"><span>自選 ${count()} 個・設定</span><b>● 已同步</b></div>`
      : `<button type="button" class="oc-btn oc-login" data-dr="login" ${configured ? '' : 'disabled'}>${icon('google')}${configured ? '用 Google 登入' : 'Google 登入・即將開放'}</button>`}
    <div class="oc-list">
      <button type="button" class="oc-btn oc-item" data-dr="watch">${icon('star')}<span>我的自選</span><u>${count()} 個</u></button>
      <button type="button" class="oc-btn oc-item" data-dr="notices">${icon('bell')}<span>通知</span>${notices ? `<em>${notices}</em>` : ''}</button>
      <button type="button" class="oc-btn oc-item" data-dr="feedback">${icon('chat')}<span>意見回饋</span></button>
      <button type="button" class="oc-btn oc-item" data-dr="guide">${icon('book')}<span>使用說明</span></button>
      <a class="oc-item" data-dr="line" href="${escapeHTML(LINE_URL)}" target="_blank" rel="noopener">${icon('group')}<span>加入 LINE 社群</span></a>
      <button type="button" class="oc-btn oc-item" data-dr="journal">${icon('journal')}<span>OX Journal</span></button>
    </div>
    <div class="oc-hr"></div>
    <div class="oc-dsec">${icon('clock')}最近使用</div>
    <div class="oc-recent">${recent.length ? recent.map(x => x.type === 'coin'
      ? `<button type="button" class="oc-btn" data-coin="${escapeHTML(x.id)}"><i>${logoHTML(x.id)}</i><span>${escapeHTML(coinOf(x.id))}</span></button>`
      : `<button type="button" class="oc-btn" data-tool="${escapeHTML(x.id)}"><i>${icon(TOOL_ICONS[x.id] || 'tool')}</i><span>${TOOL_NAMES[x.id]}</span></button>`).join('')
      : '<div class="none">打開過的幣種和工具會出現在這裡</div>'}</div>
    <div class="oc-foot"><button type="button" class="oc-btn" data-dr="settings">${icon('gear')}設定</button><button type="button" class="oc-btn" data-dr="help">${icon('help')}取得幫助</button>
      <div class="oc-theme" role="group" aria-label="主題">${[['dark', 'moon', '深色'], ['light', 'sun', '白金']].map(([id, ic, label]) => `<button type="button" class="oc-btn" data-theme="${id}" aria-label="${label}" aria-pressed="${light === (id === 'light')}">${icon(ic)}</button>`).join('')}</div></div>`;
}
const isOpen = () => document.body.classList.contains('oc-drawer-open');
function open() {
  if (isOpen()) return;
  render();
  document.body.classList.remove('oc-drawer-closing'); document.body.classList.add('oc-drawer-open');
  drawer.setAttribute('aria-hidden', 'false'); drawer.inert = false;
  document.querySelectorAll('main,.app-dock,.ox-shell-header').forEach(el => el.inert = true);
  globalThis.OXTrack?.('drawer.open');
  requestAnimationFrame(() => drawer.querySelector('button:not([disabled]),a')?.focus({ preventScroll: true }));
}
function close() {
  if (!isOpen()) return;
  document.body.classList.add('oc-drawer-closing'); document.body.classList.remove('oc-drawer-open');
  drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true;
  document.querySelectorAll('main,.app-dock,.ox-shell-header').forEach(el => el.inert = false);
  setTimeout(() => document.body.classList.remove('oc-drawer-closing'), 320);
}
export function feedback() {
  const sheet = document.createElement('div'); sheet.className = 'oc-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '意見回饋');
  sheet.innerHTML = `<div class="oc-sheet-head"><button type="button" class="oc-btn oc-back" data-x aria-label="收起">${icon('back')}</button><h2>意見回饋</h2></div>
    <form class="oc-body oc-feedback"><p>想要的功能、遇到的問題、覺得哪裡可以更好，都可以寫在這裡。</p>
    <textarea maxlength="2000" placeholder="例如：雷達可以加上○○條件" aria-label="意見回饋內容"></textarea><div class="actions"><span role="status"></span><button type="submit" class="oc-btn oc-primary">送出</button></div></form>`;
  document.body.append(sheet);
  const area = sheet.querySelector('textarea'), status = sheet.querySelector('[role="status"]');
  const leave = () => { sheet.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') leave(); };
  document.addEventListener('keydown', onKey);
  sheet.querySelector('[data-x]').onclick = leave;
  sheet.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const text = area.value.trim();
    if (text.length < 2) { status.textContent = '請先寫一點內容'; return; }
    if (typeof globalThis.OXSendFeedback !== 'function') { status.textContent = '回饋功能暫時無法使用'; return; }
    status.textContent = '送出中…';
    try { await globalThis.OXSendFeedback({ text, topic: '意見回饋' }); area.value = ''; status.textContent = '已收到，謝謝！'; setTimeout(leave, 1200); }
    catch (error) { status.textContent = error.message || '送出失敗，請稍後再試'; }
  };
  requestAnimationFrame(() => area.focus());
}

// 設定 and the media page: the app's own views with a title bar; ‹ goes back with the drawer open.
let subReturn = 'home';
const SUB_TITLES = { settings: '設定', media: 'OX Journal' };
function subHead(view) {
  const section = document.querySelector(`[data-app-view="${view}"]`); if (!section || section.querySelector(':scope > .oc-subhead')) return;
  const head = document.createElement('div'); head.className = 'oc-subhead';
  head.innerHTML = `<button type="button" class="oc-btn oc-back" data-sub-back aria-label="返回">${icon('back')}</button><h1>${SUB_TITLES[view]}</h1>`;
  head.querySelector('[data-sub-back]').addEventListener('click', () => { window.switchAppView?.(subReturn === view ? 'home' : subReturn); open(); });
  section.prepend(head);
}
export function openSub(view) {
  const from = document.body.dataset.view; if (from && !SUB_TITLES[from]) subReturn = from === 'stock' ? 'home' : from;
  subHead(view);
  window.switchAppView?.(view);
  scrollTo({ top: 0 });
}
export function initDrawer() {
  scrim = document.createElement('div'); scrim.className = 'oc-scrim';
  drawer = document.createElement('aside'); drawer.className = 'oc-drawer'; drawer.setAttribute('aria-label', '選單'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true;
  document.body.append(scrim, drawer);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
  // Swipe left on the drawer to close it.
  let sx = null;
  drawer.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  drawer.addEventListener('touchend', e => { if (sx !== null && sx - e.changedTouches[0].clientX > 60) close(); sx = null; }, { passive: true });
  // Any avatar (首頁 top bar, the desktop header) opens it.
  document.addEventListener('click', e => { if (e.target.closest?.('[data-oc="drawer"]') && !e.target.closest('#ox-topbar')) { e.preventDefault(); open(); } });
  drawer.addEventListener('click', e => {
    const b = e.target.closest('[data-dr],[data-coin],[data-tool],[data-theme]'); if (!b) return;
    const act = b.dataset.dr;
    if (b.dataset.theme) { document.querySelector(`[data-control-theme="${b.dataset.theme}"]`)?.click(); setTimeout(render, 50); return; }
    if (act === 'line') { close(); return; }
    if (act === 'login') { globalThis.OXMember?.signIn?.(); return; }
    close();
    if (b.dataset.coin) openCoin(b.dataset.coin);
    if (b.dataset.tool) openFeature(FEATURES.find(f => f[3] === b.dataset.tool) || ['', '', 'strength', b.dataset.tool]);
    if (act === 'watch') openFeature(FEATURES.find(f => f[3] === 'watch'));
    if (act === 'notices') globalThis.OXNotices?.open();
    if (act === 'feedback') feedback();
    if (act === 'settings') openSub('settings');
    if (act === 'journal' || act === 'guide' || act === 'help') openPage(act === 'help' ? 'guide' : act);
  });
  document.addEventListener('ox:notice-count', e => { notices = e.detail || 0; });
  document.addEventListener('ox:member', () => { if (isOpen()) render(); });
  document.addEventListener('ox:viewchange', () => close());
  for (const view of Object.keys(SUB_TITLES)) subHead(view);
  globalThis.OXDrawer = { open, close, feedback, openSettings: () => openSub('settings') };
}

// Anonymous usage records for the owner's admin page, plus the site announcement,
// maintenance cover, switched-off tools (功能開關) and in-site feedback.
// A random device ID (no name, email or IP) tells repeat visits apart; records go out
// in small batches, and only to this Site's own backend. Where no backend answers
// (the old static host), nothing is sent and the page works as before.
import { SWITCHES, switchLabel } from './site-features.js?v=20261028-sites1';
const DEVICE_KEY = 'ox-crypto:device-id', BYPASS_KEY = 'ox-crypto:maintenance-preview', CLOSED_KEY = 'ox-crypto:announcement-closed';
const NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const api = path => new URL('/api/v1/' + path, location.href);
let queue = [], timer = 0, errors = 0, backend = 'unknown', interacted = false, configAt = 0;
let off = {};

export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!/^[a-z0-9-]{8,40}$/i.test(id || '')) { id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9-]/gi, '').slice(0, 36); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'nostorage-' + Math.random().toString(36).slice(2, 10); }
}
function flush(beacon = false) {
  clearTimeout(timer); timer = 0;
  if (backend !== 'on' || !queue.length) return;
  const body = JSON.stringify({ device: deviceId(), events: queue.splice(0, 40) }), url = api('app/track');
  if (beacon && navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000, credentials: 'same-origin' }).catch(() => {});
  if (queue.length) timer = setTimeout(flush, 1500);
}
export function track(name, detail) {
  if (backend === 'off' || !NAME.test(name)) return;
  queue.push(detail === undefined || detail === null || detail === '' ? { name } : { name, detail: String(detail).slice(0, 60) });
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (backend !== 'on') return;
  if (queue.length >= 30) flush(); else if (!timer) timer = setTimeout(flush, 8000);
}
globalThis.OXTrack = track;

// Taps anywhere, including inside the tools' open shadow roots (pattern board, bubbles, analytics).
// New screens can opt in with data-track="name" and data-track-detail="…".
const CLICKS = [
  ['[data-track]', el => [el.dataset.track, el.dataset.trackDetail]],
  ['.tab-btn[data-tab]', el => ['radar.tab', el.dataset.tab]],
  ['.btn-tf[data-tf]', el => ['chart.frame', el.dataset.tf]],
  ['[data-watch-symbol]', el => [el.getAttribute('aria-pressed') === 'true' ? 'watch.remove' : 'watch.add', el.dataset.watchSymbol]],
  ['#direction-toggle', el => ['radar.direction', el.getAttribute('aria-pressed') === 'true' ? 'long' : 'short']],
  ['#btn-alert-high', () => ['chart.alert', 'high']], ['#btn-alert-low', () => ['chart.alert', 'low']],
  ['#btn-chart-fullscreen', () => ['chart.fullscreen']], ['#chart-indicator-open', () => ['chart.tools']],
  ['#chart-timeframe-save', () => ['settings.timeframes']],
  ['[data-control-theme]', el => ['settings.theme', el.dataset.controlTheme]], ['[data-theme-choice]', el => ['settings.theme', el.dataset.themeChoice]],
  ['[data-news-tab]', el => ['news.tab', el.getAttribute('data-news-tab')]],
  ['[data-feature-id]', el => ['search.feature', el.dataset.featureId]],
  ['[data-bubble-metric]', el => ['bubbles.metric', el.dataset.bubbleMetric]],
  ['[data-open-chart]', el => ['analytics.chart', el.dataset.openChart]]
];
// Only inside the pattern board (its root element has class "px").
const BOARD = [
  ['[data-preset]', el => ['board.preset', el.dataset.preset]],
  ['[data-frame]', el => ['board.frame', el.dataset.frame]],
  ['[data-tier-filter]', el => ['board.tier', el.dataset.tierFilter]],
  ['[data-result]', el => ['board.card', String(el.dataset.result).split(':')[0]]],
  ['[data-action="refresh"]', () => ['board.scan']], ['[data-action="open-radar"]', () => ['board.to-radar']],
  ['[data-action="toggle-mode"]', () => ['board.mode']], ['[data-action="undo"]', () => ['board.undo']]
];
const elements = event => event.composedPath().filter(node => node instanceof Element);
function listen() {
  document.addEventListener('click', event => {
    const path = elements(event), board = path.some(node => node.classList.contains('px'));
    for (const node of path) {
      if (node === document.body) return;
      for (const [selector, pick] of board ? [...BOARD, ...CLICKS] : CLICKS) if (node.matches(selector)) { const [name, detail] = pick(node); track(name, detail); return; }
    }
  }, { capture: true, passive: true });
  // 畫板: a finger or mouse stroke on the board (not a tap).
  let stroke = null;
  document.addEventListener('pointerdown', event => {
    interacted = true;
    stroke = elements(event).some(node => node.classList.contains('px-board')) ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', event => {
    if (stroke?.id === event.pointerId && Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) > 12) track('board.draw');
    stroke = null;
  }, { capture: true, passive: true });
  document.addEventListener('keydown', () => { interacted = true; }, { capture: true, passive: true });
  document.addEventListener('change', event => {
    const input = event.composedPath()[0];
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input.closest?.('#chart-tools-overlay') && input.type === 'checkbox' && input.checked && input.id) track('chart.indicator', input.id.replace(/^chk-/, ''));
    else if (input.id === 'ox-control-notify-toggle') track('settings.notify', input.checked ? 'on' : 'off');
    else if (input.id === 'ox-control-sound-toggle') track('settings.sound', input.checked ? 'on' : 'off');
    else if (input.id === 'setting-frequency') track('settings.frequency', input.value);
  }, { capture: true, passive: true });
  document.addEventListener('ox:viewchange', event => { if (event.detail?.to && event.detail.to !== event.detail.from) track('view.' + event.detail.to); });
  document.addEventListener('ox:crypto-toolchange', event => { if (event.detail?.tool) track('tool.' + event.detail.tool); });
  // Coins opened on the radar chart, from any list or tool (switchSymbol marks #view-radar).
  const radar = document.getElementById('view-radar');
  if (radar) {
    let last = radar.dataset.selectedSymbol || '';
    new MutationObserver(() => {
      const symbol = radar.dataset.selectedSymbol || '';
      if (symbol && symbol !== last && interacted) track('coin.view', symbol);
      last = symbol;
    }).observe(radar, { attributes: true, attributeFilter: ['data-selected-symbol'] });
  }
  addEventListener('error', event => { if (errors++ < 5) track('app.error', String(event.message || 'error').slice(0, 60)); });
  addEventListener('unhandledrejection', event => { if (errors++ < 5) track('app.error', String(event.reason?.message || event.reason || 'rejection').slice(0, 60)); });
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
    else if (backend === 'on' && Date.now() - configAt > 300000) loadConfig();
  });
}

// ---------- announcement, maintenance and switched-off tools ----------
function maintenance(info) {
  const params = new URLSearchParams(location.search);
  try { if (params.has('preview')) sessionStorage.setItem(BYPASS_KEY, '1'); } catch {}
  let preview = false; try { preview = sessionStorage.getItem(BYPASS_KEY) === '1'; } catch {}
  document.querySelector('.ox-maintenance')?.remove();
  if (!info || preview) return false;
  const cover = document.createElement('div'); cover.className = 'ox-maintenance'; cover.setAttribute('role', 'alert');
  const box = document.createElement('div'), title = document.createElement('b'), text = document.createElement('p');
  title.textContent = 'OX 加密維護中'; text.textContent = info.message || '網站正在更新，請稍後再回來。';
  box.append(title, text); cover.append(box); document.body.append(cover);
  return true;
}
function announcement(a) {
  document.querySelector('.ox-announcement')?.remove();
  if (!a) return;
  try { if (localStorage.getItem(CLOSED_KEY) === String(a.id)) return; } catch {}
  const bar = document.createElement('div'); bar.className = 'ox-announcement'; bar.setAttribute('role', 'status');
  const text = document.createElement(a.link ? 'a' : 'span'); text.textContent = a.text;
  if (a.link && /^https:\/\//.test(a.link)) { text.href = a.link; text.target = '_blank'; text.rel = 'noopener noreferrer'; text.addEventListener('click', () => track('announcement.open', a.id)); }
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', '關閉公告'); close.textContent = '×';
  close.onclick = () => { bar.remove(); try { localStorage.setItem(CLOSED_KEY, String(a.id)); } catch {} };
  bar.append(text, close); document.body.prepend(bar);
}

const isOff = id => Object.prototype.hasOwnProperty.call(off, id);
const viewSwitch = view => SWITCHES.find(item => item.views?.includes(view) && isOff(item.id))?.id || null;
const featureSwitch = id => id === 'media' ? 'media' : id?.startsWith('news.') ? 'news' : id?.startsWith('crypto.') ? id.slice(7) : null;
let dismissed = new Set();
function notice(id) {
  const existing = document.querySelector('.ox-switch-note');
  if (existing?.dataset.tool === id || dismissed.has(id)) return;
  existing?.remove();
  const note = document.createElement('div'); note.className = 'ox-switch-note'; note.dataset.tool = id; note.setAttribute('role', 'status');
  const title = document.createElement('b'), text = document.createElement('p'), close = document.createElement('button');
  title.textContent = `「${switchLabel(id)}」暫停使用`; text.textContent = off[id] || '這個工具正在調整，請先使用其他功能。';
  close.type = 'button'; close.setAttribute('aria-label', '關閉'); close.textContent = '×';
  close.onclick = () => { note.remove(); dismissed.add(id); };
  const copy = document.createElement('div'); copy.append(title, text);
  note.append(copy, close); document.body.append(note);
}
// The tools rail and pages ask window.OXFeatures before opening a tool; a switched-off
// tool answers "not now" there, so it is never loaded, and the owner's message shows.
function guardFeatures() {
  const original = window.OXFeatures;
  if (!original || original.oxSwitches) return;
  window.OXFeatures = Object.freeze({
    oxSwitches: true,
    enter(id, resume) { const s = featureSwitch(id); if (s && isOff(s)) { notice(s); return false; } return original.enter(id, resume); },
    enterView(view) { const s = viewSwitch(view); if (s) { notice(s); return false; } return original.enterView(view); },
    enterTool(tool, attribute, resume) {
      const s = attribute === 'data-crypto-tool' ? tool : attribute === 'data-news-tab' ? 'news' : null;
      if (s && isOff(s)) { notice(s); return false; }
      return original.enterTool(tool, attribute, resume);
    },
    refresh: (...args) => original.refresh(...args),
    canPreload: id => { const s = featureSwitch(id); return s && isOff(s) ? false : original.canPreload(id); },
    selectedTool: market => original.selectedTool(market),
    get returning() { return original.returning; }, get ready() { return original.ready; }, get newsTab() { return original.newsTab; }
  });
}
// Without that hook (or for other buttons), a tap on a switched-off tool is stopped here.
function blockTaps() {
  document.addEventListener('click', event => {
    for (const node of elements(event)) {
      if (node === document.body) return;
      const tool = node.getAttribute('data-crypto-tool'), view = node.getAttribute('data-view-target');
      if (tool || view) dismissed.clear();
      const s = tool && isOff(tool) ? tool : view ? viewSwitch(view) : null;
      if (s) { event.preventDefault(); event.stopImmediatePropagation(); notice(s); return; }
      if (tool || view) return;
    }
  }, true);
  document.addEventListener('ox:viewchange', () => { dismissed.clear(); document.querySelector('.ox-switch-note')?.remove(); });
}
// Dim switched-off tools in the 指標 rail (it lives in an open shadow root).
function markRail() {
  const root = document.getElementById('ox-crypto-tools-nav')?.shadowRoot; if (!root) return;
  let style = root.getElementById('ox-switch-style');
  if (!style) { style = document.createElement('style'); style.id = 'ox-switch-style'; root.append(style); }
  style.textContent = Object.keys(off).filter(id => /^[a-z0-9-]+$/.test(id)).map(id => `[data-crypto-tool="${id}"]{opacity:.42}`).join('');
}
function applySwitches(next) {
  const before = JSON.stringify(off);
  off = next && typeof next === 'object' ? next : {};
  guardFeatures(); markRail();
  // A tool that is open right now closes; the 指標 page asks again on this event.
  if (before !== JSON.stringify(off)) document.dispatchEvent(new CustomEvent('ox:feature-policy-ready'));
  const shown = document.querySelector('#view-strength .strength-page')?.dataset.cryptoTool;
  if (document.body.dataset.view === 'strength' && shown && isOff(shown)) notice(shown);
  const view = viewSwitch(document.body.dataset.view);
  if (view) { notice(view); window.switchAppView?.('radar'); }
}

async function loadConfig() {
  configAt = Date.now();
  let config;
  try {
    const response = await fetch(api('app/config'), { cache: 'no-store', credentials: 'same-origin' });
    const body = response.ok && /json/.test(response.headers.get('content-type') || '') ? await response.json() : null;
    if (!body?.ok) throw Error('no backend');
    config = body.data || {};
  } catch { if (backend === 'unknown') { backend = 'off'; queue = []; } return; }
  backend = 'on'; flush();
  if (maintenance(config.maintenance)) return;
  announcement(config.announcement);
  applySwitches(config.off);
}

// ---------- feedback ----------
export async function sendFeedback({ text, topic, contact, page } = {}) {
  const response = await fetch(api('app/feedback'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ text, topic, contact, page: page || document.body.dataset.view || '', device: deviceId() }) });
  if (!response.ok) {
    const code = (await response.json().catch(() => null))?.error?.code;
    throw Error(response.status === 429 ? '送出太頻繁，請稍後再試' : code === 'INVALID_CONTACT' ? 'Email 格式不正確' : code === 'EMPTY' ? '請先寫一點內容' : '送出失敗，請稍後再試');
  }
  track('feedback.send', topic);
}
globalThis.OXSendFeedback = sendFeedback;
export const feedbackReady = () => backend === 'on';
// The 選單 → 意見回饋 form sends to the admin page once this Site's backend answers.
function wireFeedbackForm() {
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'ox-feedback-form' || backend !== 'on') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const status = form.querySelector('#ox-feedback-status'), area = form.querySelector('#ox-feedback-message'), button = form.querySelector('[type=submit]');
    const text = area?.value.trim() || '';
    if (text.length < 2) { if (status) status.textContent = '請先寫一點內容'; return; }
    if (status) status.textContent = '送出中…'; if (button) button.disabled = true;
    try {
      await sendFeedback({ text, topic: form.querySelector('#ox-feedback-type')?.value, contact: form.querySelector('#ox-feedback-email')?.value.trim() });
      if (area) area.value = ''; if (status) status.textContent = '已收到，謝謝！';
    } catch (error) { if (status) status.textContent = error.message; }
    finally { if (button) button.disabled = false; }
  }, true);
  const ready = () => {
    const status = document.getElementById('ox-feedback-status'), head = document.querySelector('[data-control-view="feedback"] .ox-feedback-head small');
    if (backend !== 'on') return;
    if (status && /沒有串接|尚未連接/.test(status.textContent)) status.textContent = '回饋會直接送到 OX 後台。';
    if (head) head.textContent = 'FEEDBACK';
  };
  document.addEventListener('ox:site-backend', ready);
}

if (typeof document !== 'undefined') {
  listen(); blockTaps(); wireFeedbackForm();
  track('app.open', matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'home-screen' : 'browser');
  loadConfig().then(() => { if (backend === 'on') document.dispatchEvent(new CustomEvent('ox:site-backend')); });
  document.addEventListener('ox:runtime-ready', markRail);
  document.addEventListener('ox:viewchange', () => setTimeout(markRail, 50));
}

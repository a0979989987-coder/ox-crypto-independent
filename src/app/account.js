// Google sign-in for members, syncing 自選 and settings across devices (src/app/sync-keys.js),
// and the member's Bitget UID. Signed-out visitors keep using everything; nothing here
// locks a tool. Mounts into #ox-settings-account when the page has it, otherwise at the
// top of 選單, where the old OX ACCOUNT row was.
import { SYNC_KEYS, MAX_SYNC_CHARS, mergeValue } from './sync-keys.js?v=20261031-share1';
const api = path => new URL('/api/v1/' + path, location.href);
const BY_STORAGE = new Map(SYNC_KEYS.map(item => [item.storage, item]));
const JOINED_KEY = 'ox-crypto:synced-account', RELOADED_KEY = 'ox-crypto:account-synced';
const UID = /^[1-9]\d{5,19}$/;
const STATUS = { pending: ['待審核', 'pending'], approved: ['已通過', 'approved'], rejected: ['未通過', 'rejected'] };
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.7-5.6-4H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 14.1a6 6 0 0 1 0-4.2V7.3H3.1a10 10 0 0 0 0 9.4l3.3-2.6Z"/><path fill="#ea4335" d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A10 10 0 0 0 3.1 7.3l3.3 2.6c.8-2.3 3-4 5.6-4Z"/></svg>';
const state = { loaded: false, configured: false, member: null };
let syncing = false, pushTimer = 0;
const pending = new Map(), dirty = new Set();
const track = (name, detail) => globalThis.OXTrack?.(name, detail);
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c !== null && c !== undefined)); return node; };

// ---------- settings sync ----------
function readLocal(item) {
  let raw; try { raw = localStorage.getItem(item.storage); } catch { return undefined; }
  if (raw === null) return undefined;
  if (item.type === 'text') return raw;
  try { return JSON.parse(raw); } catch { return undefined; }
}
const nativeSet = Storage.prototype.setItem, nativeRemove = Storage.prototype.removeItem;
function writeLocal(item, value) { try { nativeSet.call(localStorage, item.storage, item.type === 'text' ? String(value) : JSON.stringify(value)); } catch {} }
function changed(storage, key) {
  let local; try { local = storage === globalThis.localStorage; } catch { return; }
  const item = local && BY_STORAGE.get(key); if (!item) return;
  if (!state.loaded || syncing) { dirty.add(item.key); return; }
  if (!state.member) return;
  pending.set(item.key, readLocal(item) ?? null); clearTimeout(pushTimer); pushTimer = setTimeout(push, 1200);
}
// Every write to a synced key is saved to the member's account (debounced).
Storage.prototype.setItem = function (key, value) { nativeSet.call(this, key, value); changed(this, key); };
Storage.prototype.removeItem = function (key) { nativeRemove.call(this, key); changed(this, key); };
function push(keepalive = false) {
  clearTimeout(pushTimer); pushTimer = 0;
  for (const [key, value] of pending) {
    const body = JSON.stringify({ key, value });
    if (body.length > MAX_SYNC_CHARS + 300) continue;
    fetch(api('me/data'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body, keepalive: keepalive && body.length < 60000 }).catch(() => {});
  }
  pending.clear();
}
addEventListener('pagehide', () => { if (pending.size) push(true); });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function marker(email) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email).toLowerCase())));
  return [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// The first sign-in on a device merges lists, so nothing on the phone is lost. After that
// the account's copy is the one to follow, so removing a coin on one device sticks.
async function sync() {
  const response = await fetch(api('me/data'), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return false;
  const remote = (await response.json()).data || {}, mark = await marker(state.member.email);
  let joined = false; try { joined = localStorage.getItem(JOINED_KEY) === mark; } catch {}
  const updated = [];
  syncing = true;
  try {
    for (const item of SYNC_KEYS) {
      const local = readLocal(item), server = remote[item.key];
      const next = dirty.has(item.key) ? local : joined ? (server !== undefined ? server : local) : mergeValue(item, local, server);
      if (next === undefined) continue;
      if (!same(next, server)) pending.set(item.key, next);
      if (!same(next, local)) { writeLocal(item, next); updated.push(item.key); }
    }
    try { nativeSet.call(localStorage, JOINED_KEY, mark); } catch {}
  } finally { syncing = false; }
  if (pending.size) push();
  return updated;
}

// ---------- the account card ----------
const root = el('section', { className: 'ox-member', id: 'ox-member-account' });
root.setAttribute('aria-label', '會員');
function mountPoint() {
  const reserved = document.getElementById('ox-settings-account');
  // 設定's slot holds a static 「未開放」 row until this card arrives; the card replaces it.
  if (reserved) { document.getElementById('ox-settings-account-entry')?.closest('.ox-control-group')?.remove(); return { parent: reserved, before: null }; }
  const main = document.querySelector('#ox-control-panel [data-control-view="main"]');
  if (!main) return null;
  // Where the old OX ACCOUNT row was (it stays hidden), right under its label.
  const old = document.getElementById('ox-control-account-open')?.closest('.ox-control-group');
  return { parent: main, before: old?.parentElement === main ? old : main.querySelector('.ox-control-group') };
}
function ensureMount() {
  const point = mountPoint(); if (!point) return false;
  if (root.parentElement !== point.parent) point.before ? point.parent.insertBefore(root, point.before) : point.parent.append(root);
  return true;
}
function row({ icon, title, note, notes = note ? [note] : [], badge, side, onClick, label }) {
  const button = el(onClick ? 'button' : 'div', { className: 'ox-control-row' });
  if (onClick) { button.type = 'button'; button.addEventListener('click', onClick); }
  if (label) button.setAttribute('aria-label', label);
  const iconBox = el('span', { className: 'ox-control-icon' }); if (typeof icon === 'string') { iconBox.classList.add('ox-member-google'); iconBox.innerHTML = icon; } else iconBox.append(icon);
  const copy = el('span', { className: 'ox-control-copy' }, el('b', { textContent: title }, badge ? el('span', { className: 'ox-member-badge', textContent: badge }) : null), ...notes.map(text => el('small', { textContent: text })));
  button.append(iconBox, copy, el('span', { className: 'ox-control-side' }, ...(side || [])));
  return button;
}
function startSignIn() {
  track('account.signin');
  const params = new URLSearchParams(location.search); params.delete('login');
  const back = location.pathname + (params.size ? '?' + params : '');
  location.assign(api('auth/google/start').href + '?return_to=' + encodeURIComponent(back));
}
async function signOut() {
  if (!confirm('要登出嗎？自選和設定會留在這台裝置。')) return;
  track('account.signout');
  await fetch(api('auth/logout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' }).catch(() => {});
  try { localStorage.removeItem(JOINED_KEY); sessionStorage.removeItem(RELOADED_KEY); } catch {}
  location.reload();
}
function bitgetPanel(bitget) {
  const [label, tone] = bitget ? STATUS[bitget.status] || STATUS.pending : ['尚未填寫', 'none'];
  const input = el('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 20, placeholder: '例如 1234567890', value: bitget?.uid || '' });
  input.setAttribute('aria-label', 'Bitget UID'); input.pattern = '[0-9]*'; input.enterKeyHint = 'send';
  const submit = el('button', { type: 'submit', textContent: bitget ? '更改' : '送出' });
  const status = el('p', { className: 'ox-member-status' }); status.setAttribute('role', 'status');
  const form = el('form', { className: 'ox-member-form' }, input, submit);
  input.addEventListener('input', () => { input.value = input.value.replace(/\D+/g, '').slice(0, 20); status.textContent = ''; status.classList.remove('error'); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const uid = input.value.trim();
    const fail = text => { status.textContent = text; status.classList.add('error'); };
    if (!UID.test(uid)) return fail('UID 是 6～20 位數字，不能 0 開頭。');
    if (bitget?.uid === uid) return fail('這就是目前的 UID。');
    if (bitget?.status === 'approved' && !confirm('更改後要重新審核，「Bitget 已驗證」會先拿掉。確定更改？')) return;
    submit.disabled = true; status.classList.remove('error'); status.textContent = '送出中…';
    try {
      const response = await fetch(api('me/bitget'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ uid }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const code = body?.error?.code; return fail(code === 'INVALID_UID' ? 'UID 是 6～20 位數字，不能 0 開頭。' : code === 'RATE_LIMITED' ? '今天改太多次了，明天再試。' : code === 'SIGN_IN_REQUIRED' ? '登入已過期，請重新登入。' : '送出失敗，請稍後再試。'); }
      track('bitget.submit'); state.member.bitget = body.data; render();
      document.querySelector('#ox-member-account .ox-member-status')?.replaceChildren('已送出，等待審核。');
    } catch { fail('送出失敗，請檢查網路後再試。'); }
    finally { submit.disabled = false; }
  });
  const head = el('div', { className: 'ox-member-panel-head' }, el('b', { textContent: 'Bitget UID' }), el('span', { className: 'ox-member-chip ' + tone, textContent: label }));
  const note = bitget?.note && bitget.status !== 'pending' ? el('p', { className: 'ox-member-note', textContent: '備註：' + bitget.note }) : null;
  const hint = el('p', { className: 'ox-member-hint', textContent: bitget?.status === 'approved' ? '已通過審核，帳號顯示「Bitget 已驗證」。' : '在 Bitget App 點頭像就能看到 UID。審核通過後，帳號會顯示「Bitget 已驗證」；所有工具本來就免費開放。' });
  return el('div', { className: 'ox-member-panel ox-member-bitget' }, head, note, form, status, hint);
}
function feedbackPanel() {
  // Only when the page has no 意見回饋 form of its own.
  if (document.getElementById('ox-feedback-form') || !globalThis.OXSendFeedback) return null;
  const area = el('textarea', { maxLength: 2000, placeholder: '想要的功能、遇到的問題，都可以寫在這裡' }); area.setAttribute('aria-label', '意見回饋內容');
  const status = el('span', { className: 'ox-member-status' }); status.setAttribute('role', 'status');
  const send = el('button', { type: 'submit', textContent: '送出' });
  const form = el('form', { className: 'ox-member-feedback', hidden: true }, area, el('div', {}, status, send));
  form.addEventListener('submit', async event => {
    event.preventDefault(); const text = area.value.trim();
    if (text.length < 2) { status.textContent = '請先寫一點內容'; return; }
    send.disabled = true; status.textContent = '送出中…';
    try { await globalThis.OXSendFeedback({ text }); area.value = ''; status.textContent = '已收到，謝謝！'; } catch (error) { status.textContent = error.message; } finally { send.disabled = false; }
  });
  const toggle = row({ icon: el('span', { textContent: '✎' }), title: '意見回饋', note: '想要的功能、遇到的問題', side: [el('span', { className: 'ox-control-arrow', textContent: '›' })], onClick: () => { form.hidden = !form.hidden; if (!form.hidden) area.focus(); } });
  return el('div', {}, toggle, el('div', { className: 'ox-member-panel' }, form));
}
function render() {
  if (!ensureMount()) return;
  const group = el('div', { className: 'ox-control-group' });
  const member = state.member;
  if (!state.loaded) group.append(row({ icon: GOOGLE, title: 'Google 登入', note: '讀取中…' }));
  else if (member) {
    const avatar = member.picture ? el('img', { className: 'ox-member-avatar', src: member.picture, alt: '', referrerPolicy: 'no-referrer' }) : el('span', { textContent: (member.name || member.email || '?').slice(0, 1) });
    group.append(row({ icon: avatar, title: member.name || member.email, badge: member.bitget?.verified ? 'Bitget 已驗證' : null, notes: [member.email, '自選與設定已同步'],
      side: [el('button', { className: 'ox-member-side-button', type: 'button', textContent: '登出', onclick: signOut })] }), bitgetPanel(member.bitget));
  } else if (state.configured) {
    group.append(row({ icon: GOOGLE, title: '用 Google 登入', note: '自選和設定，換手機也還在', label: '用 Google 登入', side: [el('span', { className: 'ox-control-arrow', textContent: '›' })], onClick: startSignIn }));
  } else {
    const r = row({ icon: GOOGLE, title: 'Google 登入', note: '會員功能尚未開放', side: [el('span', { className: 'ox-control-ui-tag', textContent: '未開放' })], onClick: () => {} });
    r.disabled = true; r.setAttribute('aria-label', 'Google 登入：會員功能尚未開放'); group.append(r);
  }
  const extra = state.loaded ? feedbackPanel() : null;
  if (extra) group.append(extra);
  root.replaceChildren(group, el('nav', { className: 'ox-member-legal' }, el('a', { href: 'privacy.html', textContent: '隱私權政策' }), el('a', { href: 'terms.html', textContent: '服務條款' })));
}
// The old 登入 / 註冊 entry (and the feature search's 帳號 item) lead here instead.
function redirectOldEntry() {
  document.addEventListener('click', event => {
    const target = event.target instanceof Element && event.target.closest('#ox-control-account-open,[data-ox-account-open],#ox-account-trigger,[data-ox-account-login]');
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const panel = document.getElementById('ox-control-overlay');
    if (!document.getElementById('ox-settings-account') && panel && !panel.classList.contains('is-open')) [...document.querySelectorAll('#ox-control-open,#ox-dock-menu')].find(opener => opener.getClientRects().length)?.click();
    document.querySelectorAll('[data-control-view]').forEach(view => view.classList.toggle('active', view.dataset.controlView === 'main'));
    if (!ensureMount()) return;
    root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    root.classList.remove('ox-member-flash'); void root.offsetWidth; root.classList.add('ox-member-flash');
  }, true);
}
const MESSAGES = { ok: '已用 Google 登入', cancelled: '已取消登入', expired: '登入逾時，請再試一次', failed: '登入失敗，請再試一次', blocked: '這個帳號已被停用', unavailable: '會員功能尚未開放' };
function loginResult() {
  const params = new URLSearchParams(location.search), result = params.get('login');
  if (!result) return;
  params.delete('login');
  history.replaceState(history.state, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
  if (!MESSAGES[result]) return;
  const toast = el('div', { className: 'ox-member-toast', textContent: MESSAGES[result] }); toast.setAttribute('role', 'status');
  document.body.append(toast); setTimeout(() => toast.remove(), 3500);
}

// The drawer and the top bar's avatar show the same account.
function publish() {
  globalThis.OXMember = Object.freeze({ member: state.member, configured: state.configured, loaded: state.loaded, signIn: startSignIn });
  document.dispatchEvent(new CustomEvent('ox:member', { detail: globalThis.OXMember }));
}
async function start() {
  loginResult(); redirectOldEntry(); render(); publish();
  // The menu can be rebuilt by the shell; put the card back when a page opens.
  for (const type of ['ox:viewchange', 'ox:runtime-ready']) document.addEventListener(type, () => { if (!root.isConnected) render(); });
  document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('#ox-dock-menu,#ox-control-open,[data-view-target="settings"]')) setTimeout(() => { if (!root.isConnected) render(); }, 0); }, true);
  try {
    const response = await fetch(api('auth/me'), { cache: 'no-store', credentials: 'same-origin' });
    const body = response.ok && /json/.test(response.headers.get('content-type') || '') ? await response.json() : null;
    state.configured = !!body?.data?.configured; state.member = body?.data?.member || null;
  } catch {}
  state.loaded = true; render(); publish();
  if (!state.member) return;
  try {
    const updated = await sync();
    if (!updated?.length) return;
    // The watchlist is read live; other settings are read when the page starts.
    if (updated.every(key => key === 'watchlist') && typeof globalThis.syncWatchBadge === 'function') { globalThis.syncWatchBadge(); globalThis.renderCurrentTab?.(); return; }
    let reloaded = false; try { reloaded = sessionStorage.getItem(RELOADED_KEY) === '1'; } catch {}
    if (!reloaded) { try { sessionStorage.setItem(RELOADED_KEY, '1'); } catch {} location.reload(); }
  } catch {}
}
if (typeof document !== 'undefined') start();

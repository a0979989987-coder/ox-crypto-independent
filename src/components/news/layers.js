export function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }
export function button(text, label, action, className = '') { const n = node('button', className, text); n.type = 'button'; if (label) n.setAttribute('aria-label', label); if (action) n.addEventListener('click', action); return n; }
export function anchoredPanel(anchor, title, build) {
  const life = new AbortController(), panel = node('section', 'oxn-popover');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title);
  const header = node('header', 'oxn-layer-heading'); const close = button('‹', '關閉篩選', destroy, 'oxn-close'); header.append(close, node('strong', '', title));
  const body = node('div', 'oxn-panel-content'); panel.append(header, body); document.body.append(panel);
  anchor.setAttribute('aria-expanded', 'true');
  function position() {
    const r = anchor.getBoundingClientRect(), width = Math.min(360, innerWidth - 24), height = Math.min(panel.scrollHeight, innerHeight - 36);
    const left = Math.max(12, Math.min(innerWidth - width - 12, r.left));
    const top = r.bottom + height + 12 <= innerHeight ? r.bottom + 6 : Math.max(12, r.top - height - 6);
    panel.style.cssText = `width:${width}px;left:${left}px;top:${top}px;max-height:${innerHeight - top - 12}px`;
  }
  function destroy({ focus = true } = {}) {
    if (life.signal.aborted) return;
    life.abort(); anchor.setAttribute('aria-expanded', 'false'); panel.classList.remove('is-open'); panel.style.pointerEvents = 'none';
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true }); setTimeout(() => panel.remove(), 280);
  }
  build(body, { destroy, position, signal: life.signal }); position(); requestAnimationFrame(() => { panel.classList.add('is-open'); close.focus({ preventScroll: true }); });
  document.addEventListener('pointerdown', e => { if (!panel.contains(e.target) && !anchor.contains(e.target)) destroy({ focus: false }); }, { signal: life.signal, passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); destroy(); } }, { signal: life.signal });
  window.addEventListener('resize', position, { signal: life.signal });
  return { element: panel, destroy, position };
}
export function modal(title, onBack) {
  const life = new AbortController(), previous = document.activeElement;
  const backdrop = node('div', 'oxn-modal-backdrop'), panel = node('section', 'oxn-modal');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title); panel.tabIndex = -1;
  const header = node('header', 'oxn-layer-heading'), close = button('‹', '返回上一層', onBack, 'oxn-close'); header.append(close, node('strong', '', title));
  const body = node('div', 'oxn-modal-content'); panel.append(header, body); backdrop.append(panel); document.body.append(backdrop);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) onBack(); }, { signal: life.signal });
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); onBack(); }
    if (e.key === 'Tab') { const nodes = [...panel.querySelectorAll('button:not(:disabled),a[href],input')]; const i = nodes.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && i === nodes.length - 1) { e.preventDefault(); nodes[0]?.focus(); } }
  }, { signal: life.signal });
  requestAnimationFrame(() => { backdrop.classList.add('is-open'); close.focus({ preventScroll: true }); });
  return { body, destroy() { life.abort(); backdrop.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); } };
}

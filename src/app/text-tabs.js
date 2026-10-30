// Small text tabs with a short underline under the active one, like the top row of
// an exchange app (the Taiwan site's page tabs). 行情, 型態 and 資訊 use it. The row
// keeps the .ox-mode-rail class, so a swipe across the top of the page still steps
// through the tabs (swipe-views.js). With sticky, the row stays at the top of the
// screen while a long list scrolls and turns to glass only while it is pinned.
// A tab that may need sign-in asks window.OXFeatures first, as the old rail did.
export function createTextTabs({ tabs, selected, label, attribute = 'data-tab', sticky = false, onSelect }) {
  const element = document.createElement('div');
  if (sticky) element.dataset.sticky = '';
  // Same place and spacing on every page; page styles must not move it.
  element.style.setProperty('margin', '0 0 10px', 'important');
  const shadow = element.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
:host{display:block;min-width:0}
:host([hidden]){display:none}
:host([data-sticky]){position:sticky;top:max(var(--oc-top-h,0px),env(safe-area-inset-top,0px));z-index:40}
nav{transition:background-color .2s ease}
:host([data-stuck]) nav{background:var(--oc-bar,rgba(10,12,15,.66));-webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3)}
@media (max-width:720px){:host([data-sticky]) nav{margin-inline:-8px;padding-inline:8px}}
@media (min-width:721px){:host([data-sticky]) nav{margin-inline:-12px;padding-inline:12px}}
/* Dragging the row only slides it sideways; the page underneath never moves up or down. */
.ox-mode-rail{position:relative;display:flex;gap:22px;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;touch-action:pan-x;scrollbar-width:none;padding:0 2px;border-bottom:1px solid var(--oc-line,rgba(255,255,255,.09));-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent)}
.ox-mode-rail.fits,.ox-mode-rail.at-end{-webkit-mask-image:none;mask-image:none}
.ox-mode-rail::-webkit-scrollbar{display:none}
button{position:relative;flex:none;border:0;background:none;margin:0;padding:9px 0 11px;font:500 15px/1.1 var(--oc-font,-apple-system,"PingFang TC",sans-serif);letter-spacing:.01em;color:var(--oc-muted,#9aa1a8);cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:color .15s}
button[aria-selected="true"]{color:var(--oc-ink,#f1f1eb);font-weight:600}
button::after{content:"";position:absolute;left:50%;bottom:-1px;width:18px;height:3px;margin-left:-9px;border-radius:3px;background:var(--oc-accent,#fff);transform:scaleX(0);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
button[aria-selected="true"]::after{transform:none}
button.is-off{opacity:.42}
button:focus-visible{outline:2px solid var(--oc-accent,#fff);outline-offset:2px;border-radius:4px}
@media (min-width:901px){.ox-mode-rail{gap:28px}}
@media (prefers-reduced-motion:reduce){button,button::after,nav{transition:none}}
</style><nav aria-label="${label}"><div class="ox-mode-rail ox-text-rail" role="tablist">${tabs.map(([id, title]) => `<button type="button" role="tab" ${attribute}="${id}" aria-selected="${id === selected}" tabindex="${id === selected ? 0 : -1}">${title}</button>`).join('')}</div></nav>`;
  const rail = shadow.querySelector('.ox-mode-rail'), life = new AbortController();
  const buttons = () => [...rail.querySelectorAll('button')];
  const fade = () => { rail.classList.toggle('fits', rail.scrollWidth <= rail.clientWidth + 2); rail.classList.toggle('at-end', rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4); };
  const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  // Bring the active tab into the row's view without moving the page.
  function position(smooth = false) {
    const button = rail.querySelector('[aria-selected="true"]');
    if (button && rail.scrollWidth > rail.clientWidth) {
      const left = button.offsetLeft - (rail.clientWidth - button.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    }
    fade();
  }
  function mark(button) {
    for (const b of buttons()) { const on = b === button; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    position(true);
  }
  function choose(button, gate = true) {
    if (!button || button.getAttribute('aria-selected') === 'true') return;
    const id = button.getAttribute(attribute);
    if (gate && window.OXFeatures?.enterTool && !window.OXFeatures.enterTool(id, attribute, () => choose(button, false))) return;
    mark(button);
    onSelect(id);
  }
  shadow.addEventListener('click', event => {
    const button = event.target.closest(`[${attribute}]`);
    // Tapping the open tab, scrolled down, goes back to the top.
    if (button?.getAttribute('aria-selected') === 'true') { if (scrollY > 40 && event.isTrusted) scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
    choose(button);
  }, { signal: life.signal });
  shadow.addEventListener('keydown', event => {
    const list = buttons(), i = list.indexOf(shadow.activeElement); if (i < 0) return;
    const next = event.key === 'ArrowRight' ? (i + 1) % list.length : event.key === 'ArrowLeft' ? (i + list.length - 1) % list.length : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); list[next].focus(); choose(list[next]);
  }, { signal: life.signal });
  rail.addEventListener('scroll', fade, { passive: true, signal: life.signal });
  // After sign-in, the tool that asked for it opens again.
  document.addEventListener('ox:feature-tool-return', event => { if (attribute === 'data-crypto-tool' && event.detail?.market === 'crypto') choose(buttons().find(b => b.getAttribute(attribute) === event.detail.tool), false); }, { signal: life.signal });
  document.addEventListener('ox:feature-news-return', event => { if (attribute === 'data-news-tab') choose(buttons().find(b => b.getAttribute(attribute) === event.detail?.tab), false); }, { signal: life.signal });
  // The glass shows only while the row is pinned at the top.
  if (sticky) {
    let queued = false;
    const stuck = () => { queued = false; if (!element.isConnected) return; const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--oc-top-h')) || 0; element.toggleAttribute('data-stuck', scrollY > 0 && element.getBoundingClientRect().top <= top + 1); };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(stuck); } }, { passive: true, signal: life.signal });
  }
  const resize = new ResizeObserver(() => fade()); resize.observe(rail);
  return {
    element, shadow, position,
    // Shows a tab as chosen without running onSelect (the page already shows it).
    mark(id) { const button = buttons().find(b => b.getAttribute(attribute) === id); if (button && button.getAttribute('aria-selected') !== 'true') mark(button); },
    select(id) { choose(buttons().find(b => b.getAttribute(attribute) === id)); },
    destroy() { life.abort(); resize.disconnect(); }
  };
}

import { revealStyledShadow } from '../style-ready.js?v=20261005-stable18';
// Shared Crypto/news rail, including the sliding white glass indicator.
export function createToolsRail({ tabs, selected, label, attribute = 'data-tool', equal = false, mobileCompact = false, onSelect }) {
  const element = document.createElement('div');
  element.style.cssText = 'grid-column:1/-1;min-width:0;';
  const shadow = element.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" data-ox-href="${new URL('../../styles/components/tools-rail.css?v=20261001-tiercomb1', import.meta.url)}"><style>:host{display:block}:host([hidden]){display:none}.ox-tool-root .ox-mode-rail{width:max-content;min-width:100%}.ox-tool-root .ox-mode-rail button{flex:0 0 auto;padding:7px 12px;font-family:inherit;min-height:34px;font-size:11px}${equal?'.ox-tool-root .ox-mode-rail{display:flex;width:100%;min-width:0}.ox-tool-root .ox-mode-rail button{flex:1 1 0;min-width:0;text-align:center;justify-content:center}':''}.ox-tool-root{font-family:Inter,-apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif}@media(max-width:600px){.ox-tool-root .ox-mode-rail button{padding:6px 10px;min-height:33px;font-size:11px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}</style><div class="ox-tool-root"><nav class="ox-mode-viewport" aria-label="${label}"><div class="ox-mode-rail" role="tablist"><span class="ox-mode-indicator" aria-hidden="true"></span>${tabs.map(([id, title]) => `<button type="button" role="tab" ${attribute}="${id}" aria-selected="${id === selected}" tabindex="${id === selected ? 0 : -1}" class="${id === selected ? 'active' : ''}">${title}</button>`).join('')}</div></nav></div>`;
  if(equal){const style=document.createElement('style');style.textContent='@media(max-width:600px){.ox-tool-root .ox-mode-rail{width:max-content;min-width:100%;flex-wrap:nowrap}.ox-tool-root .ox-mode-rail button{flex:1 0 auto;min-width:72px;white-space:nowrap}}';shadow.append(style);}
  const life = new AbortController();
  if(mobileCompact){const style=document.createElement('style');style.textContent='@media(max-width:600px){.ox-tool-root .ox-mode-viewport{overflow:hidden}.ox-tool-root .ox-mode-rail{display:flex;width:100%;min-width:0;flex-wrap:nowrap;gap:1px;padding:3px}.ox-tool-root .ox-mode-rail button{flex:1 1 0;min-width:0;min-height:36px;white-space:nowrap;padding:6px 2px;font-size:11px}.ox-tool-root .ox-mode-indicator{display:block;box-sizing:border-box}.ox-tool-root .ox-mode-rail button.active{color:#fff}}';shadow.append(style);}
  // Six tools still fit in one centered mobile row; desktop sizes are unchanged.
  if (mobileCompact && tabs.length > 5) {
    const style = document.createElement('style');
    style.textContent = `@media(max-width:600px){.ox-tool-root .ox-mode-rail{display:grid;grid-template-columns:repeat(${tabs.length},minmax(0,1fr))}.ox-tool-root .ox-mode-rail button{box-sizing:border-box;width:100%;font-size:clamp(8px,2.4vw,10px);padding-inline:1px;text-align:center;justify-content:center}}`;
    shadow.append(style);
  }
  revealStyledShadow(shadow, life.signal, '.ox-tool-root', 41);
  function position() {
    const rail = shadow.querySelector('.ox-mode-rail'), button = rail.querySelector('.active');
    if (!button || !button.offsetWidth) return;
    rail.style.setProperty('--mode-x', button.offsetLeft + 'px');
    rail.style.setProperty('--mode-width', button.offsetWidth + 'px');
  }
  shadow.addEventListener('click', event => {
    const button = event.target.closest(`[${attribute}]`); if (!button || !button.offsetWidth) return;
    if (window.OXFeatures && !window.OXFeatures.enterTool(button.getAttribute(attribute), attribute, () => button.click())) return;
    shadow.querySelectorAll('button').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active); item.setAttribute('aria-selected', active); item.tabIndex = active ? 0 : -1;
    });
    position();
    const viewport=shadow.querySelector('nav');viewport.scrollTo({left:Math.max(0,button.offsetLeft-(viewport.clientWidth-button.offsetWidth)/2),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
    onSelect(button.getAttribute(attribute));
  }, { signal: life.signal });
  shadow.addEventListener('keydown', event => {
    const buttons = [...shadow.querySelectorAll('button')], i = buttons.indexOf(shadow.activeElement); if (i < 0) return;
    const next = event.key === 'ArrowRight' ? (i + 1) % buttons.length : event.key === 'ArrowLeft' ? (i + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); buttons[next].focus(); buttons[next].click();
  }, { signal: life.signal });
  document.addEventListener('ox:feature-tool-return', event => { const market=attribute==='data-crypto-tool'?'crypto':null; if(market===event.detail?.market){const button=shadow.querySelector(`[${attribute}="${event.detail.tool}"]`);if(button&&!button.classList.contains('active'))button.click();} }, {signal:life.signal});
  document.addEventListener('ox:feature-news-return', event => { if(attribute==='data-news-tab') shadow.querySelector(`[${attribute}="${event.detail.tab}"]`)?.click(); }, {signal:life.signal});
  // Shared CSS loader replaces link nodes, then dispatches resize after styling.
  window.addEventListener('resize', position, { signal: life.signal });
  const resize = new ResizeObserver(position); resize.observe(element);
  return { element, shadow, position, select(id){[...shadow.querySelectorAll('button')].find(b=>b.getAttribute(attribute)===id)?.click();}, destroy() { life.abort(); resize.disconnect(); } };
}

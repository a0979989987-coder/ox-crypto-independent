import { loadStyle } from './style-resource.js?v=20261005-stable18';
export function preloadToolStyles(href) {
  return Promise.all([href, String(href).replace(/\.css(?:\?.*)?$/, '-light.css?v=20261005-load16'),
    new URL('../styles/themes/light-tool-roles.css?v=20261005-graytop5', import.meta.url).href].map(loadStyle));
}
// Inject complete, shared CSS text instead of relying on shadow-link load
// events, which can be late or missed when Safari restores a cached view.
export function guardStyledContent(container, main, links, signal, selector = 'main', minHeight = 220) {
  if (!main || signal?.aborted) return;
  const host = container.host || container, position = host.style?.position;
  if (host.style) host.style.position = 'relative';
  const cloak = document.createElement('style');
  cloak.textContent = `${selector},${selector} *{visibility:hidden!important;pointer-events:none!important}${selector}{max-height:${minHeight}px!important;overflow:hidden!important}.ox-style-loading{box-sizing:border-box;position:absolute;inset:0;z-index:2;min-height:${minHeight}px;display:grid;place-content:center;gap:12px;padding:14px;border:1px solid #8883;border-radius:12px;font:13px/1.6 system-ui}.ox-style-loading button{font:inherit;min-height:36px;padding:6px 14px;color:inherit;background:transparent;border:1px solid currentColor;border-radius:9px;cursor:pointer}`;
  container.prepend(cloak);
  main.inert = true; main.setAttribute('aria-busy', 'true');
  const shell = document.createElement('div'); shell.className = 'ox-style-loading'; shell.setAttribute('role','status');
  if(minHeight<100)shell.style.cssText='display:flex;align-items:center;justify-content:center;padding:4px 8px;gap:8px;font-size:11px;white-space:nowrap';
  const syncShell = () => { shell.style.background=document.body.classList.contains('theme-light')?'#ffffff':'#101216';shell.style.color=document.body.classList.contains('theme-light')?'#697384':'#969ba3'; };
  syncShell(); document.addEventListener('ox:themechange',syncShell,{signal});
  const message=document.createElement('span');message.textContent='介面載入中…';
  const retry=document.createElement('button');retry.type='button';retry.textContent='重試';retry.hidden=true;
  shell.append(message,retry);container.append(shell);
  // Placeholders retain cascade order. Never expose the DOM while only one
  // palette (or a partial stylesheet) has arrived.
  // Preserve link nodes for tools that still attach layout listeners to them.
  // Complete CSS is applied atomically through the adjacent style placeholder.
  const sheets=links.map(link=>{const style=document.createElement('style'),href=link.href;link.disabled=true;link.before(style);return {style,href};});
  let run=0,finished=false;
  async function prepare(attempt = 0) {
    const generation=++run;retry.hidden=true;message.textContent='介面載入中…';
    try {
      const css=await Promise.all(sheets.map(({href})=>loadStyle(href)));
      if (signal?.aborted || generation!==run) return;
      sheets.forEach(({style},index)=>{style.textContent=css[index];});
      requestAnimationFrame(()=>{
        if(signal?.aborted || generation!==run)return;
        finished=true;cloak.remove();shell.remove();main.inert=false;main.removeAttribute('aria-busy');
        if(main.dataset.stylePending==='true'){main.style.removeProperty('visibility');delete main.dataset.stylePending;}
        if(host.style)host.style.position=position||'';
        window.dispatchEvent(new Event('resize'));
      });
    } catch {
      if(signal?.aborted || generation!==run)return;
      if(attempt===0){
        message.textContent='正在重新連線…';
        setTimeout(()=>{if(!signal?.aborted&&generation===run)prepare(1);},400);
        return;
      }
      message.textContent='介面樣式暫時無法載入';retry.hidden=false;
    }
  }
  retry.addEventListener('click',()=>prepare(),{signal});
  signal?.addEventListener('abort',()=>{run++;shell.remove();},{once:true});
  prepare();
  return { retry(){if(!finished)prepare();} };
}
export function revealStyledShadow(shadow, signal, selector = 'main', minHeight = 220) {
  const sheet=shadow.querySelector('link[rel="stylesheet"]'),main=shadow.querySelector(selector);
  if(!sheet||!main)return;
  const mobile=document.createElement('style');
  mobile.textContent='@media(max-width:700px),(pointer:coarse){:host,*{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0;height:0}button,[role=tab],a{touch-action:manipulation}input,textarea,[contenteditable=true]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;font-size:max(16px,1em)}}'+(globalThis.OXLoading?.css||'');
  shadow.append(mobile);
  const syncTheme=()=>{shadow.host.dataset.oxTheme=document.body.classList.contains('theme-light')?'light':'dark';};
  syncTheme();document.addEventListener('ox:themechange',syncTheme,{signal});
  const light=document.createElement('link');light.rel='stylesheet';light.href=sheet.href.replace(/\.css(?:\?.*)?$/, '-light.css?v=20261005-load16');
  const roles=document.createElement('link');roles.rel='stylesheet';roles.href=new URL('../styles/themes/light-tool-roles.css?v=20261005-graytop5',import.meta.url).href;
  shadow.append(light,roles);
  return guardStyledContent(shadow,main,[sheet,light,roles],signal,selector,minHeight);
}

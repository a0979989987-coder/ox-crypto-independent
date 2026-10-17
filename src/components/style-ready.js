import { loadStyle } from './style-resource.js?v=20261005-stable18';
export function preloadToolStyles(href) {
  return Promise.all([href, String(href).replace(/\.css(?:\?.*)?$/, '-light.css?v=20261005-load16'),
    new URL('../styles/themes/light-tool-roles.css?v=20261005-graytop5', import.meta.url).href, polishHref,
    ...(midnightActive() ? [midnightToolsHref()] : [])].map(url => loadStyle(url, { priority: 'low' })));
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
  const syncShell = () => { const palette=globalThis.OXTheme?.current()||(document.body.classList.contains('theme-light')?'light':'dark');shell.style.background=palette==='light'?'#ffffff':palette==='midnight'?'#0f1520':'#101216';shell.style.color=palette==='light'?'#697384':palette==='midnight'?'#a9b0bc':'#969ba3'; };
  syncShell(); document.addEventListener('ox:themechange',syncShell,{signal});
  const message=document.createElement('span');message.textContent='介面載入中…';
  const retry=document.createElement('button');retry.type='button';retry.textContent='重試';retry.hidden=true;
  shell.append(message,retry);container.append(shell);
  // Placeholders retain cascade order. Never expose the DOM while only one
  // palette (or a partial stylesheet) has arrived.
  // Preserve link nodes for tools that still attach layout listeners to them.
  // Complete CSS is applied atomically through the adjacent style placeholder.
  const sheets=links.map(link=>{const style=document.createElement('style'),href=link.dataset?.oxHref||link.href;link.disabled=true;link.before(style);return {style,href};});
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
const polishHref=new URL('../styles/components/ui-polish-tools.css?v=20261015-polish1',import.meta.url).href;
const midnightActive=()=>!document.body.classList.contains('theme-light')&&document.documentElement.classList.contains('theme-midnight');
const midnightToolsHref=()=>new URL(globalThis.OXTheme?.MIDNIGHT_TOOLS_CSS||'src/styles/themes/midnight-ink-tools.css',location.href).href;
export function revealStyledShadow(shadow, signal, selector = 'main', minHeight = 220) {
  const sheet=shadow.querySelector('link[rel="stylesheet"]'),main=shadow.querySelector(selector);
  if(!sheet||!main)return;
  const mobile=document.createElement('style');
  mobile.textContent='@media(max-width:700px),(pointer:coarse){:host,*{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0;height:0}button,[role=tab],a{touch-action:manipulation}input,textarea,[contenteditable=true]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}:is(input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=button],[type=submit]),select,textarea){font-size:max(16px,1em)!important}:host([data-ox-theme][data-ox-theme][data-ox-theme]) select{-webkit-appearance:none;appearance:none;padding-left:6px!important;padding-right:15px!important;line-height:1.15;text-overflow:clip;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%278%27 height=%275%27%3E%3Cpath d=%27M1 1l3 3 3-3%27 fill=%27none%27 stroke=%27%238a929e%27 stroke-width=%271.3%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 5px center!important;background-size:8px 5px!important}}'+(globalThis.OXLoading?.css||'');
  shadow.append(mobile);
  const light=document.createElement('link');light.rel='stylesheet';light.dataset.oxHref=(sheet.dataset.oxHref||sheet.href).replace(/\.css(?:\?.*)?$/, '-light.css?v=20261005-load16');
  const roles=document.createElement('link');roles.rel='stylesheet';roles.dataset.oxHref=new URL('../styles/themes/light-tool-roles.css?v=20261005-graytop5',import.meta.url).href;
  shadow.append(light,roles);
  const polish=document.createElement('link');polish.rel='stylesheet';polish.dataset.oxHref=polishHref;
  shadow.append(polish);
  const links=[sheet,light,roles,polish];
  // Midnight Ink: the host keeps data-ox-theme="dark" (every dark rule still
  // applies) and gains data-ox-palette="midnight". Its colour layer joins the
  // atomic reveal when the theme is already active, otherwise it is fetched the
  // first time the theme is chosen. It is always the last sheet in the root.
  let midnightSheet=false;
  if(midnightActive()){const link=document.createElement('link');link.rel='stylesheet';link.dataset.oxHref=midnightToolsHref();shadow.append(link);links.push(link);midnightSheet=true;}
  const syncTheme=()=>{
    const light=document.body.classList.contains('theme-light');
    shadow.host.dataset.oxTheme=light?'light':'dark';
    if(!midnightActive()){delete shadow.host.dataset.oxPalette;return;}
    if(!midnightSheet){
      midnightSheet=true;const style=document.createElement('style');shadow.append(style);
      loadStyle(midnightToolsHref()).then(css=>{if(!signal?.aborted)style.textContent=css;},()=>{style.remove();midnightSheet=false;});
    }
    shadow.host.dataset.oxPalette='midnight';
  };
  syncTheme();document.addEventListener('ox:themechange',syncTheme,{signal});
  return guardStyledContent(shadow,main,links,signal,selector,minHeight);
}

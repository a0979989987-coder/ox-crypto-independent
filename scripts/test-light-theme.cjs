// White Gold 2.0 browser audit. All market fixtures stay inside route interception.
const assert=require('node:assert/strict');
const {readFileSync,mkdirSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {chromium,webkit}=require('playwright');
const {server,preparePage,testBase,bitgetBody}=require('./e2e-check.cjs');
const root=resolve(__dirname,'..'),read=f=>JSON.parse(readFileSync(resolve(root,'data',f),'utf8'));
const home=read('tw-home.json'),research=read('tw-research.json'),radar=read('tw-radar.json').data;
const output=process.env.OX_LIGHT_QA_OUT||'/tmp/ox-white-gold-qa';mkdirSync(output,{recursive:true});
let currentLabel='setup';
const report={fixtureData:true,engine:process.env.OX_LIGHT_ENGINE||'chromium',screens:[],checks:[],errors:[],passed:false};
async function setup(browser, width) {
  const size = { width, height: width < 600 ? 844 : 900 };
  const context = await browser.newContext({ locale:"zh-TW", reducedMotion:"reduce", viewport:size, isMobile:width < 600, hasTouch:width < 600 });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === testBase) return route.continue();
    return route.fulfill({ json:[] });
  });
  const { page, audit } = await preparePage(context, size);
  await page.route('https://api.bitget.com/**', route => route.fulfill({
    json:{...bitgetBody(new URL(route.request().url())), requestTime:Date.now()},
  }));
  page.setDefaultTimeout(15000);page.on('pageerror',e=>console.error('RUNTIME',currentLabel,e.stack));
  await page.route('**/api/v1/tw/**', route => {
    const u = new URL(route.request().url()), section = u.searchParams.get('section');
    let data = {};
    if (u.pathname.endsWith('/home')) data = { section, data:home[section], checkedAt:new Date().toISOString(), status:'ok' };
    else if (u.pathname.endsWith('/research')) data = research;
    else if (u.pathname.endsWith('/radar')) data = radar;
    else if(u.pathname.endsWith('/etf')){const action=u.searchParams.get('action');if(action==='history'){const history=read('tw-etf/history.json');data={rows:(u.searchParams.get('symbols')||u.searchParams.get('symbol')||'0050').split(',').map(symbol=>history.rows[symbol]||{symbol,unavailable:true})};}else if(action==='holdings')data=read('tw-etf/holdings.json').rows[u.searchParams.get('symbol')]||{holdings:[]};else if(['catalog','offering','radar'].includes(action))data=read('tw-etf/'+({offering:'offerings',radar:'hot-stocks'}[action]||action)+'.json');}
    else if (u.pathname.endsWith('/quotes')) data = { quotes:[] };
    return route.fulfill({ json:{ ok:true, data } });
  });
  await page.addInitScript(() => {localStorage.setItem('ox-ui-theme','light');localStorage.setItem('ox-ui-live-visible','1');});
  if(process.env.OX_LWC_PATH)await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(process.env.OX_LWC_PATH,'utf8')+';(()=>{const api=window.LightweightCharts;window.__oxThemeCharts=[];window.LightweightCharts={...api,createChart:(el,options)=>{const chart=api.createChart(el,options);window.__oxThemeCharts.push({el,chart});return chart;}};})();'}));
  return { context, page, audit };
}

async function inspect(page,label){currentLabel=label;
 await page.waitForTimeout(300);
 const results=await page.evaluate(()=>{
  const all=[];function visit(root){for(const el of root.querySelectorAll('*')){all.push(el);if(el.shadowRoot)visit(el.shadowRoot);}}visit(document);
  const dark=[];
  for(const el of all){const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!el.checkVisibility()||r.width<12||r.height<10||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth||s.visibility==='hidden'||Number(s.opacity)<.4)continue;
   const darkStop=[...s.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].some(m=>{const c=m[0].match(/[\d.]+/g).map(Number);return(c[3]??1)>.75&&Math.max(...c.slice(0,3))<90;});if(darkStop&&r.width>50&&r.height>40)dark.push({selector:el.id||el.className,gradient:s.backgroundImage});
   const c=s.backgroundColor.match(/[\d.]+/g)?.map(Number);if(c&&(c[3]??1)>.75&&Math.max(...c.slice(0,3))<110){dark.push({tag:el.tagName,selector:el.id?'#'+el.id:'.'+String(el.className).replace(/ /g,'.'),background:s.backgroundColor,text:el.textContent.slice(0,45)});}
  }
  return {overflow:document.documentElement.scrollWidth-innerWidth,dark,theme:document.body.className};
 });
 assert(results.overflow<=1,label+': overflow '+results.overflow);
 const filename=label.replace(/[^a-z0-9-]/gi,'-')+'.png';await page.screenshot({path:resolve(output,filename)});
 report.screens.push({label,file:filename,...results});console.log(label,JSON.stringify(results.dark));
}
async function click(page,selector){const el=page.locator(selector).filter({visible:true}).first();if(await el.count()){await el.click();return true;}return false;}
async function closeDialogs(page){await click(page,'.tw-stock-detail [data-twr-close]');await page.evaluate(()=>{function visit(root){for(const d of root.querySelectorAll('dialog[open]'))d.close();for(const el of root.querySelectorAll('*'))if(el.shadowRoot)visit(el.shadowRoot);}visit(document);});}
async function go(page,market,view){await closeDialogs(page);await page.evaluate(({market,view})=>{document.getElementById('ox-control-close').click();window.OXMarketController.setMarket(market,{toast:false});switchAppView(view);},{market,view});await page.waitForTimeout(380);await page.evaluate(()=>scrollTo(0,0));}
async function newsControls(page,market,width){
 await go(page,market,'data');
 await page.locator('.oxn-root').first().waitFor();
 for(const tab of ['calendar','key']){
  await page.locator(`button[data-news-tab="${tab}"]`).click();await inspect(page,`${market}-${width}-news-${tab}`);
  const labels=await page.locator('.oxn-controls button[aria-label]:not(.oxn-month-arrow)').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label')));
  for(let i=0;i<labels.length;i++){await page.locator('.oxn-controls').getByRole('button',{name:labels[i],exact:true}).click();await inspect(page,`${market}-${width}-news-${tab}-control-${i}`);await page.keyboard.press('Escape');}
  if(tab==='calendar'&&await click(page,'.oxn-day-number')){await inspect(page,`${market}-${width}-event-detail`);await page.keyboard.press('Escape');}
  if(tab==='key'&&await click(page,'.oxn-news-row summary'))await inspect(page,`${market}-${width}-news-expanded`);
 }
 if(await click(page,'.oxn-more')){await inspect(page,`${market}-${width}-reader-preferences`);await page.keyboard.press('Escape');}
}
async function controls(page,market,width){
 await go(page,market,'radar');
 await page.locator('#ox-control-open').click();await page.locator('#ox-feature-search-input-v38').focus();await inspect(page,`${market}-${width}-search`);
 await page.locator('#ox-feature-search-input-v38').fill('主題');await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.featureId),'theme');await page.keyboard.press('Escape');assert.equal(await page.locator('#ox-feature-search-input-v38').getAttribute('aria-expanded'),'false');await page.locator('#ox-feature-search-input-v38').fill('白金');await page.locator('[data-feature-id="theme"]').click();await page.waitForFunction(()=>document.body.dataset.view==='settings');await inspect(page,`${market}-${width}-settings`);
 await page.locator('#ox-control-open').click();await page.locator('#ox-control-account-open').click();await inspect(page,`${market}-${width}-account`);const grip=await page.locator('#ox-control-close').boundingBox();await page.mouse.click(grip.x+grip.width/2,grip.y+grip.height/2);await page.waitForFunction(()=>!document.body.classList.contains('ox-control-open'));
 await go(page,market,'radar');
 if(market==='tw'){await page.locator('[data-twr-mode="chart"]').click();await page.locator('.twcr-search-open').waitFor();}
 const sets=market==='crypto'?['#ticker-pair','#chart-indicator-open','#btn-chart-fullscreen']:['.twcr-search-open','.tw-chart-radar [data-action="indicators"]','.tw-chart-radar [data-action="focus"]'];
 for(let i=0;i<sets.length;i++){if(await click(page,sets[i])){await inspect(page,`${market}-${width}-radar-control-${i}`);await closeDialogs(page);await page.keyboard.press('Escape');await page.waitForTimeout(400);if(await page.locator('#ox-provider-backdrop.show').count())await page.locator('#ox-provider-backdrop').click({position:{x:2,y:2}});if(market==='crypto'&&await page.locator('body').evaluate(b=>b.classList.contains('chart-focus')))await click(page,'#btn-chart-fullscreen');}}
 // Also inspect chart focus surfaces whose trigger is hidden at compact widths.
 await page.evaluate(market=>{if(market==='crypto')setChartFocus(true);else if(market==='tw')document.querySelector('.tw-chart-radar [data-action="focus"]')?.click();},market);
 await inspect(page,`${market}-${width}-chart-expanded`);
 if(process.env.OX_LWC_PATH){const switched=await page.evaluate(()=>{const live=window.__oxThemeCharts.filter(x=>x.el.isConnected&&x.el.checkVisibility());const before=live.map(x=>x.chart.timeScale().getVisibleLogicalRange()),count=window.__oxThemeCharts.length;applyTheme('dark');applyTheme('light');return {backgrounds:live.map(x=>x.chart.options().layout.background.color),crosshairLabels:live.map(x=>x.chart.options().crosshair.vertLine.labelBackgroundColor),sameRange:JSON.stringify(before)===JSON.stringify(live.map(x=>x.chart.timeScale().getVisibleLogicalRange())),sameInstances:count===window.__oxThemeCharts.length};});assert(switched.sameInstances&&switched.sameRange,market+': theme keeps native chart viewport');assert(switched.backgrounds.length&&switched.backgrounds.every(c=>c==='#ffffff'));assert(switched.crosshairLabels.every(c=>c==='#8d712e'));const badgeColors=await page.locator('.chart-mobile-last-price strong').filter({visible:true}).evaluateAll(nodes=>nodes.map(n=>({text:getComputedStyle(n).color,badge:getComputedStyle(n.closest('.chart-mobile-last-price')).color})));assert(badgeColors.every(c=>c.text===c.badge),market+': price badge text retains directional contrast');report.checks.push(`${market}/${width}: live native chart changes palette without remount or viewport reset`);}
 // Native chart drawing controls are part of the theme surface too.
 if(await click(page,'.chart-drawing-tools [data-action="menu"]')){await inspect(page,`${market}-${width}-drawing-menu`);await click(page,'.chart-drawing-tools [data-action="menu"]');}
 if(await click(page,'.chart-drawing-tools [data-action="settings"]')){await inspect(page,`${market}-${width}-drawing-settings`);await click(page,'.chart-drawing-tools [data-action="settings"]');}
 await page.keyboard.press('Escape');await page.evaluate(market=>{if(market==='crypto')setChartFocus(false);else if(market==='tw')document.querySelector('.tw-chart-radar [data-action="exit"]')?.click();},market);
 const frame=market==='tw'?'[data-twcr-frame="1Q"]':'#chart-timeframe-strip .btn-tf:last-of-type';
 if(await click(page,frame)){await click(page,frame);await inspect(page,`${market}-${width}-timeframe-menu`);await page.keyboard.press('Escape');await closeDialogs(page);}
 await go(page,market,'strength');
 const attr=market==='crypto'?'data-crypto-tool':'data-tw-tool';
 await page.locator(`button[${attr}]`).first().waitFor();
 const tools=await page.locator(`button[${attr}]`).evaluateAll(bs=>bs.map(b=>b.getAttribute(b.getAttributeNames().find(n=>['data-crypto-tool','data-tw-tool'].includes(n)))));
 for(const tool of tools){
  await closeDialogs(page);await page.locator(`button[${attr}="${tool}"]`).click();await page.waitForTimeout(450);await inspect(page,`${market}-${width}-tool-${tool}`);
  if(tool==='patterns'){
   for(const action of ['patterns','timeframes'])if(await click(page,`.px [data-action="${action}"]`)){await inspect(page,`${market}-${width}-pattern-${action}`);await closeDialogs(page);}
  }
  if(tool==='bubbles'){
   if(await click(page,'.oxb [data-action="metric-menu"]')){await inspect(page,`${market}-${width}-bubble-menu`);await page.keyboard.press('Escape');}
   if(await click(page,'.oxb-asset-grid [data-asset]')){await inspect(page,`${market}-${width}-bubble-detail`);await closeDialogs(page);}
  }
  if(tool==='etf'){
   const tabs=await page.locator('.tabs [data-main]').evaluateAll(bs=>bs.map(b=>b.dataset.main));
   for(const tab of tabs){await page.locator(`.tabs [data-main="${tab}"]`).click();await inspect(page,`${market}-${width}-etf-${tab}`);const subs=await page.locator('button[data-sub]').filter({visible:true}).evaluateAll(bs=>bs.map(b=>b.dataset.sub));for(const sub of subs){await page.locator(`button[data-sub="${sub}"]`).click();await inspect(page,`${market}-${width}-etf-${tab}-${sub}`);}}
   await click(page,'.tabs [data-main="rank"]');
   if(await click(page,'button[data-detail]')){await inspect(page,`${market}-${width}-etf-detail`);await closeDialogs(page);}
   if(await click(page,'[data-fund-extra] summary'))await inspect(page,`${market}-${width}-etf-expanded-data`);
  }
  if(tool==='savings'){
   for(const tab of ['life','single','portfolio','compare']){await page.locator(`.tabs [data-tab="${tab}"]`).click();await inspect(page,`${market}-${width}-savings-${tab}`);if(tab!=='compare'&&width<600){await click(page,'[data-pane="result"]');await inspect(page,`${market}-${width}-savings-${tab}-result`);await click(page,'[data-pane="settings"]');}
   if(tab==='single'){for(const sub of ['dividend','reinvest']){await page.locator(`[data-single="${sub}"]`).click();await page.waitForTimeout(350);await inspect(page,`${market}-${width}-savings-${sub}`);}}}
  }
  if(['rotation','flow','heatmap'].includes(tool)&&await click(page,'.cfx [data-action="help"]')){await inspect(page,`${market}-${width}-${tool}-help`);await closeDialogs(page);}
 }
 if(market==='tw'){
  await go(page,market,'radar');const modes=await page.locator('[data-twr-mode]').evaluateAll(bs=>bs.map(b=>b.dataset.twrMode));
  for(const mode of modes){await page.locator(`[data-twr-mode="${mode}"]`).click();await page.waitForTimeout(300);await inspect(page,`${market}-${width}-radar-${mode}`);
   if(['risk','disposal','release'].includes(mode)&&await click(page,'.tw-stock-card')){await inspect(page,`${market}-${width}-radar-${mode}-detail`);await closeDialogs(page);}
   if(mode==='screener'){if(await click(page,'[data-open-filters]')){await inspect(page,`${market}-${width}-screener-filters`);for(const d of await page.locator('.tws-fields summary').all()){if(await d.isVisible())await d.click();}await inspect(page,`${market}-${width}-screener-expanded`);await page.keyboard.press('Escape');}
    await click(page,'[data-show-results]');if(await click(page,'.tws [data-detail]')){await inspect(page,`${market}-${width}-screener-detail`);await closeDialogs(page);}
   }
  }
 }
 report.checks.push(`${market}/${width}: menu, search routing, settings, account, all indicator tabs, nested tools and radar modes`);
}
(async()=>{
 await new Promise(r=>server.listen(new URL(testBase).port,'127.0.0.1',r));
 const browser=await (report.engine==='webkit'?webkit:chromium).launch({headless:true,...(process.env.OX_BROWSER_PATH?{executablePath:process.env.OX_BROWSER_PATH}:{})});
 try{
  for(const width of (process.env.OX_LIGHT_WIDTHS||'390,1440').split(',').map(Number)){
   const {context,page,audit}=await setup(browser,width);
   try{
    await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('#view-radar .coin-card').first().waitFor({state:'attached'});
    const candleChecks=await page.evaluate(async()=>{const {candleChart}=await import('/src/markets/crypto/patterns/charts.js');applyTheme('light');const results=[];for(const market of ['crypto','tw']){const canvas=document.createElement('canvas');canvas.style.cssText='width:300px;height:160px;position:fixed;top:0;left:0';document.body.append(canvas);const chart=candleChart(canvas,{market,candles:[{time:1700000000,open:10,high:14,low:9,close:13},{time:1700086400,open:13,high:14,low:9,close:10}]});await new Promise(r=>setTimeout(r,100));const px=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();for(let i=0;i<px.length;i+=4)if(px[i+3]===255)colors.add([px[i],px[i+1],px[i+2]].join(','));const expected=market==='tw'?['232,100,128','50,167,128']:['69,152,223','232,100,128'];results.push({market,passed:expected.every(c=>colors.has(c))});chart.destroy();canvas.remove();}return results;});assert(candleChecks.every(r=>r.passed),'Light pattern candles retain both directions');report.checks.push(`${width}: actual canvas pixels confirm contrasting crypto and TW candle colors`);
    for(const market of (process.env.OX_LIGHT_MARKETS||'crypto,tw').split(',')){
     for(const view of ['home','radar','strength','data','media']){await go(page,market,view);await inspect(page,`${market}-${width}-${view}`);}
     await controls(page,market,width);await newsControls(page,market,width);
    }
    await go(page,'crypto','strength');await page.locator('button[data-crypto-tool="bubbles"]').click();await page.locator('.oxb').waitFor();
    for(const mode of ['dark','light','system']){await page.evaluate(mode=>applyTheme(mode),mode);await page.waitForTimeout(100);const light=mode==='light';if(mode!=='system')assert.equal(await page.locator('#ox-crypto-tools-inline>div').first().getAttribute('data-ox-theme'),light?'light':'dark');}
    report.checks.push(`${width}: shadow tools follow dark/light/system without remount`);
    // Exercise current search routes, including cross-market lazy tools.
    for(const [term,id,market,view,selector] of [['台股','tw','tw','radar','[data-twr-mode]'],['ETF','etf','tw','strength','.tabs [data-main]'],['存股','savings','tw','strength','.tabs [data-tab="life"]'],['加密','crypto','crypto','radar','#chart-indicator-open'],['型態','patterns','crypto','strength','.px canvas']]){await page.locator('#ox-control-open').click();await page.locator('#ox-feature-search-input-v38').fill(term);await page.locator(`[data-feature-id="${id}"]`).click();await page.waitForFunction(({market,view})=>document.body.dataset.market===market&&document.body.dataset.view===view,{market,view});await page.locator(selector).first().waitFor();}
    report.checks.push(`${width}: search resolves TW, ETF, savings, crypto and lazy pattern tools`);
    report.errors.push(...audit.pageErrors,...audit.localHttpErrors.filter(e=>/\.(css|js)$/.test(e)));
   }finally{await context.close();}
  }
  assert.deepEqual(report.errors,[],'Runtime errors');assert.deepEqual(report.screens.filter(s=>s.dark.length).map(s=>({label:s.label,dark:s.dark})),[],'No residual dark surfaces');report.passed=true;
 }finally{writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});

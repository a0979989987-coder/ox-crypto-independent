import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
const html=readFileSync(resolve(root,'index.html'),'utf8');
const css=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>`<link rel="stylesheet" href="/${m[1]}">`).join('');
const output=resolve(root,'../imports/calendar-5fec-ui');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const results=[];
try{
 for(const theme of ['dark','light'])for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:width<600?844:900}}),errors=[];let locked=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());assert.equal(u.origin,'https://ox.test','No external requests');
   if(u.pathname==='/api/v1/account/feature-access')return route.fulfill({json:{ok:true,features:FEATURE_CATALOG.map(f=>({...f,mode:locked&&f.id==='news.calendar'?'login':'public',version:'fixture'}))}});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-theme="${theme}"><head><meta charset="UTF-8">${css}<style>body{margin:0}main.wrap{width:100%;max-width:1200px;margin:auto}.app-view{display:block}</style></head><body class="ox-terminal theme-${theme}" data-theme="${theme}" data-market="tw" data-view="data"><script>window.OXAuth={user:null};sessionStorage.setItem('ox-news-v2-all',JSON.stringify({selectedDay:'2020-01-01',month:'2020-01',times:['all']}));window.switchAppView=v=>{if(!OXFeatures.enterView(v))return;document.body.dataset.view=v};</script><script src="/src/components/account/feature-access.js"></script><main class="wrap"><section class="app-view active"><div id="host"></div></section></main><script type="module">
    import {mountNewsWorkspace} from '/src/components/news/workspace.js';import {taipeiDay} from '/src/components/news/model.js';
    await new Promise(r=>{const poll=()=>OXFeatures.ready?r():setTimeout(poll,10);poll()});
    const day=taipeiDay(),events=[{id:'synthetic-calendar',titleZh:'Synthetic event detail',title:'Synthetic event detail',date:day,category:'macro',markets:['tw','crypto'],sourceId:'fixture',status:'confirmed',importance:3},{id:'synthetic-holiday',titleZh:'Synthetic Taiwan closure',date:day,category:'holiday',sourceId:'twse-holidays',markets:['tw'],marketClosed:true}];
    window.payload={snapshot:{news:[],pendingNews:[],events,sources:[],eventCoverage:[],generatedAt:new Date().toISOString()},route:{}};
    const api={scope:'all',preferences:()=>({}),save(){},exit(){},refresh(){},applyUpdate(){},unlockCountdown(){return ''},navigate(route){payload.route=route;workspace.update(payload)},back(){payload.route={};workspace.update(payload)}};
    window.workspace=mountNewsWorkspace(document.querySelector('#host'),api);workspace.update(payload);window.today=day;window.mounted=true;
   </script></body></html>`});
   const file=resolve(root,'.'+u.pathname);assert.ok(file.startsWith(root+'/')||file.startsWith(root+'\\'));
   return route.fulfill({contentType:extname(file)==='.css'?'text/css':extname(file)==='.js'?'text/javascript':'application/octet-stream',body:readFileSync(file)});
  });
  await page.goto('https://ox.test/');await page.waitForFunction(()=>window.mounted);
  const today=await page.evaluate(()=>window.today);
  if(width<600){assert.equal(await page.locator('.oxn-week-date').count(),7);assert.equal(await page.locator('.oxn-week-date[aria-current=date]').count(),1);await page.locator('.oxn-month-expand').click();assert.equal(await page.locator('.oxn-day').count(),42);}
  assert.equal(await page.locator(`.oxn-day[data-date="${today}"].is-today`).count(),1);
  assert.equal(await page.locator(`.oxn-day[data-date="${today}"].is-market-closed`).count(),1);
  assert.equal(await page.locator('.oxn-upcoming-day').count(),1);
  await page.locator('.oxn-upcoming-day').first().locator('.oxn-event-row').filter({hasText:'Synthetic event detail'}).click();
  await page.locator('[role=dialog][aria-modal=true]').waitFor();assert.match(await page.locator('[role=dialog][aria-modal=true]').innerText(),/Synthetic event detail/);
  await page.evaluate(()=>{payload.route={};workspace.update(payload)});
  locked=true;await page.evaluate(()=>OXFeatures.refresh());assert.equal(await page.locator('main.wrap').isVisible(),false);assert.equal(await page.locator('#ox-feature-login').isVisible(),true);
  await page.evaluate(()=>{OXAuth.user={id:'synthetic-account'};document.dispatchEvent(new CustomEvent('ox:accountchange'))});assert.equal(await page.locator('main.wrap').isVisible(),true);
  await page.evaluate(()=>{OXAuth.user=null;document.dispatchEvent(new CustomEvent('ox:accountchange'))});assert.equal(await page.locator('main.wrap').isVisible(),false);
  locked=false;await page.evaluate(()=>OXFeatures.refresh());assert.equal(await page.locator('main.wrap').isVisible(),true);
  await page.locator('[data-news-tab="key"]').click();
  await page.getByRole('button',{name:'多選新聞時間',exact:true}).click();
  assert.equal(await page.locator('[data-value="week"]').getAttribute('aria-pressed'),'true','Legacy saved range migrates to current Taipei week');
  await page.locator('[data-value="custom"]').click();
  await page.getByLabel('開始日期',{exact:true}).fill(today);
  await page.getByLabel('結束日期',{exact:true}).fill(today);
  await page.getByRole('button',{name:'套用自訂日期',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('ox-news-v2-all')).customTime),{from:today,to:today});
  await page.keyboard.press('Escape');await page.locator('[data-news-tab="calendar"]').click();await page.waitForTimeout(350);
  const bg=await page.evaluate(()=>getComputedStyle(document.querySelector('.oxn-calendar')).backgroundColor);const channels=bg.match(/[\d.]+/g).slice(0,3).map(Number);assert.equal(channels.every(c=>c>200),theme==='light','Theme must actually apply to body: '+bg);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');assert.deepEqual(errors,[]);
  await page.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});results.push({theme,width,currentTaipeiDate:true,closure:true,eventDetail:true,upcomingDays:1,loginLogoutGate:true,overflow:false});await page.close();
 }
 writeFileSync(resolve(output,'report.json'),JSON.stringify({synthetic:true,baseline:'253f32a',results},null,2));
 console.log('Actual calendar workspace/CSS passed: dark/light × desktop/mobile, Taipei today, closures, upcoming events, detail dialog, login/logout gate and overflow. Synthetic sessions/events only.');
}finally{await browser.close();}

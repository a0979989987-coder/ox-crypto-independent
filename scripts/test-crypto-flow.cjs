const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const out=process.env.OX_FLOW_SHOTS||'/tmp/ox-flow-review';require('node:fs').mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','4175'],{cwd:path.join(__dirname,'..')});
process.on('exit',()=>server.kill());
(async()=>{
 await new Promise(r=>server.stdout.once('data',r));
 const browser=await chromium.launch({executablePath:process.env.OX_CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const tab=id=>page.locator(`nav [data-tab="${id}"]`).click();
 await page.goto('http://127.0.0.1:4175/previews/crypto-flow.html');await page.locator('[data-slot="rotation-coverage"]').filter({hasText:'5 板塊'}).waitFor();
 assert.equal(await page.locator('h1,.cfx-hero').count(),0);
 assert.equal(await page.locator('.cfx-rank-row').count(),5);
 assert.equal(await page.locator('[data-action="equal-size"]').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.cfx-rank-row').first().locator('small').textContent(),/領先擴大|領先降溫|落後改善|落後擴大/);
 await page.locator('[data-action="equal-size"]').click();assert.equal(await page.locator('[data-action="equal-size"]').getAttribute('aria-pressed'),'false');await page.locator('[data-action="equal-size"]').click();
 
 await page.locator('.cfx-rank-row').first().click();assert.equal(await page.locator('.cfx-sidebar.selected tbody tr').count(),5);
 await page.locator('[data-watch]').click();await page.getByRole('button',{name:'關閉板塊詳情'}).click();
 await page.getByRole('button',{name:'自選',exact:true}).click();assert.equal(await page.locator('.cfx-rank-row').count(),1);await page.getByRole('button',{name:'自選',exact:true}).click();
 await page.getByRole('textbox',{name:'搜尋板塊或幣種'}).fill('ETH');assert.equal(await page.locator('.cfx-rank-row').count(),1);await page.getByRole('textbox',{name:'搜尋板塊或幣種'}).fill('');
 await page.locator('[data-control="sort"]').selectOption('share');assert.ok((await page.locator('.cfx-rank-row').first().innerText()).includes('公鏈'));
 await page.locator('[data-control="sort"]').selectOption('relative');
 await page.getByRole('button',{name:'列表',exact:true}).click();assert.equal(await page.locator('.cfx-rotation-table tbody tr').count(),5);
 await page.locator('[data-state="lagging"]').click();assert.equal(await page.locator('.cfx-rotation-table tbody tr').count(),1);await page.locator('[data-state="lagging"]').click();
 await page.getByRole('button',{name:'泡泡',exact:true}).click();
 for(const period of ['15M','4H','1H']){await page.getByRole('button',{name:period,exact:true}).click();assert.equal(await page.locator('.cfx-rank-row').count(),5);}
 const latest=await page.locator('[data-slot="rotation-time"]').innerText();
 await page.locator('[data-control="frame"]').fill('0');assert.notEqual(await page.locator('[data-slot="rotation-time"]').innerText(),latest);
 await page.getByRole('button',{name:'播放輪動回放'}).click();await page.waitForTimeout(1400);assert.equal(await page.locator('[data-control="frame"]').inputValue(),'1');await page.getByRole('button',{name:'暫停輪動回放'}).click();
 await page.getByRole('button',{name:'最新',exact:true}).click();
 await page.locator('[data-action="fullscreen"]').click();assert.ok((await page.locator('canvas').boundingBox()).height>600);
 const before=await page.locator('canvas').evaluate(c=>c.toDataURL());
 const cdp=await page.context().newCDPSession(page),cb=await page.locator('canvas').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cb.x+90,y:cb.y+200,id:1},{x:cb.x+200,y:cb.y+200,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cb.x+60,y:cb.y+200,id:1},{x:cb.x+250,y:cb.y+200,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);assert.notEqual(await page.locator('canvas').evaluate(c=>c.toDataURL()),before);
 await page.locator('[data-action="reset"]').click();await page.waitForTimeout(300);await page.screenshot({path:out+'/OX-Crypto-Mobile-Fullscreen.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('.focused').count(),0);
 await page.getByRole('button',{name:'資料與計算說明',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),1);await page.getByRole('button',{name:'關閉說明'}).click();
 await page.screenshot({path:out+'/OX-Crypto-Mobile.png',fullPage:true});
 for(const id of ['heatmap','flow','rotation']){
  await tab(id);for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.waitForTimeout(40);assert.ok(await page.locator('.cfx').evaluate(e=>e.scrollWidth<=innerWidth+1),id+' overflows '+width);}
  assert.ok(!/NaN|undefined|Invalid Date/.test(await page.locator('.cfx-content').innerText()),id+' has invalid display');
 }
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(300);await page.screenshot({path:out+'/OX-Crypto-Desktop.png',fullPage:true});
 await page.locator('.cfx-rank-row').first().click();await page.screenshot({path:out+'/OX-Crypto-Desktop-Detail.png',fullPage:true});await page.getByRole('button',{name:'關閉板塊詳情'}).click();
 await tab('heatmap');await page.locator('[data-control="weight"]').selectOption('cap');await page.locator('[data-action="group"]').click();await page.waitForTimeout(200);await page.screenshot({path:out+'/OX-Crypto-Heatmap.png',fullPage:true});
 await page.locator('.cfx-heat-list button').first().click();assert.equal(await page.locator('.cfx-asset-dialog[open]').count(),1);await page.getByRole('button',{name:'關閉標的詳情'}).click();
 await tab('flow');await page.route('https://api.bitget.com/**',r=>r.abort());await page.locator('[data-action="refresh-flow"]').click();await page.locator('.cfx-notice').filter({hasText:'更新失敗'}).waitFor();assert.ok(await page.locator('tbody tr').count()>0);
 await page.getByRole('button',{name:'返回指標',exact:true}).click();assert.equal(await page.locator('#crypto-flow').isHidden(),true);await page.getByRole('button',{name:'重新開啟工具'}).click();await page.locator('[data-slot="rotation-coverage"]').waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.cfx-content').evaluate(e=>getComputedStyle(e).animationName),'none');
 assert.deepEqual(errors,[]);
 const boundary=await browser.newPage();await boundary.goto('http://127.0.0.1:4175/previews/crypto-flow.html');await boundary.evaluate(async()=>{document.body.innerHTML='<section id="view-strength"><div class="strength-page"><div class="page-hero"></div></div></section>';document.body.dataset.market='crypto';document.body.dataset.view='strength';await import('/src/markets/crypto/analytics/entry.js');});
 assert.equal(await boundary.locator('#ox-crypto-tools-nav').isVisible(),true);await boundary.locator('[data-crypto-tool="rotation"]').click();await boundary.locator('[data-slot="rotation-coverage"]').waitFor();
 for(const market of ['tw','crypto']){await boundary.evaluate(m=>{document.body.dataset.market=m;document.dispatchEvent(new CustomEvent('ox:marketchange'));},market);assert.equal(await boundary.locator('#ox-crypto-tools-inline').isVisible(),market==='crypto');assert.equal(await boundary.locator('body > dialog').count(),0);assert.equal(await boundary.evaluate(()=>document.body.style.overflow),'');}
 await browser.close();server.kill();console.log('PASS: rotation/replay/cohorts, 3 retained tools, heatmap/active trades, 320–1440px, pinch/fullscreen/exit, three-market isolation.');
})().catch(e=>{console.error(e);process.exit(1)});

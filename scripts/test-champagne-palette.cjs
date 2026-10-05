// Verify the approved palette on actual mobile controls, not just CSS tokens.
process.env.OX_E2E_PORT ||= '4186';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {server,preparePage,testBase}=require('./e2e-check.cjs');
const {mkdirSync}=require('node:fs');
(async()=>{
 await new Promise(r=>server.listen(new URL(testBase).port,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.OX_BROWSER_PATH});
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',isMobile:true,hasTouch:true});
 const {page}=await preparePage(context,{width:390,height:844});
 const out=process.env.OX_LIGHT_QA_OUT||'/tmp/ox-neutral gray-palette';mkdirSync(out,{recursive:true});
 try{
  await page.goto(testBase,{waitUntil:'domcontentloaded'});await page.locator('.coin-card').first().waitFor();
  const dock=()=>page.locator('.ox-dock-indicator').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {image:s.backgroundImage,border:s.borderColor,opacity:s.opacity,width:r.width,x:r.x};});
  await page.evaluate(()=>{applyTheme('dark');switchAppView('radar');});await page.waitForTimeout(100);
  const originalDark=await dock();
  await page.evaluate(()=>applyTheme('light'));
  const positions=[];
  for(const view of ['home','strength','radar','data']){
   await page.evaluate(v=>switchAppView(v),view);await page.waitForTimeout(180);
   const color=await dock();if(view==='radar'){assert.equal(await page.locator('.ox-dock-indicator').evaluate(e=>getComputedStyle(e).display),'none');continue;}positions.push(color.x);
   assert(color.image.includes('230, 232, 235'),view+': neutral selection');assert.equal(color.border,'rgb(212, 217, 224)');assert.equal(color.opacity,'1');assert(color.width>30);
   const text=await page.locator('.dock-btn.active').evaluate(e=>getComputedStyle(e).color);assert.equal(text,'rgb(48, 52, 59)');
  }
  assert(new Set(positions).size===3,'gray selection moves across non-radar tabs');
  await page.evaluate(()=>switchAppView('home'));await page.waitForTimeout(100);
  const home=await page.locator('.ox-home-chart').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopWidth,shadow:getComputedStyle(e).boxShadow}));assert.equal(home.bg,'rgb(255, 255, 255)');assert.equal(home.border,'1px');assert.equal(home.shadow,'none');
  const energy=await page.locator('#home-btc-strength-meter').evaluate(e=>getComputedStyle(e).backgroundColor);assert.notEqual(energy,'rgb(247, 248, 250)');assert.notEqual(energy,'rgb(255, 255, 255)');
  const analysis=await page.locator('.ox-home-analysis').evaluate(e=>getComputedStyle(e).borderTopWidth);assert.equal(analysis,'1px');await page.screenshot({path:out+'/approved-home.png'});
  await page.evaluate(()=>switchAppView('radar'));await page.waitForTimeout(100);
  const frame=await page.locator('#chart-timeframe-strip .btn-tf.active').evaluate(e=>({bg:getComputedStyle(e).backgroundImage,text:getComputedStyle(e).color}));assert(frame.bg.includes('230, 232, 235'));assert.equal(frame.text,'rgb(48, 52, 59)');await page.screenshot({path:out+'/approved-radar.png'});
  await page.evaluate(()=>switchAppView('strength'));await page.locator('button[data-crypto-tool="patterns"]').waitFor();await page.waitForTimeout(150);
  const rail=await page.locator('button[data-crypto-tool="patterns"]').evaluate(e=>{const s=getComputedStyle(e.getRootNode().querySelector('.twr-mode-indicator'));return s.backgroundImage;});assert(rail.includes('230, 232, 235'),'lazy shadow tool uses neutral gray');await page.screenshot({path:out+'/approved-indicators.png'});
  await page.locator('button[data-crypto-tool="strength"]').click();await page.waitForTimeout(180);
  const surfaces=await page.locator('.strength-card,.strength-compare-panel').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().width).map(e=>({border:getComputedStyle(e).borderTopWidth,bg:getComputedStyle(e).backgroundImage})));assert(surfaces.length>0);assert(surfaces.every(s=>s.border==='0px'&&s.bg==='none'));await page.screenshot({path:out+'/soft-gauges.png'});
  await page.locator('button[data-crypto-tool="patterns"]').click();const canvas=page.locator('.px-board canvas');await canvas.waitFor();const rect=await canvas.boundingBox();await page.mouse.move(rect.x+35,rect.y+150);await page.mouse.down();await page.mouse.move(rect.x+140,rect.y+100,{steps:8});await page.mouse.move(rect.x+270,rect.y+180,{steps:8});await page.mouse.up();await page.waitForTimeout(150);
  const hasBlue=await canvas.evaluate(e=>{const a=e.getContext('2d').getImageData(0,0,e.width,e.height).data;for(let i=0;i<a.length;i+=4)if(a[i]===69&&a[i+1]===152&&a[i+2]===223&&a[i+3]===255)return true;return false;});assert(hasBlue,'actual drawing stroke is clear blue');await page.screenshot({path:out+'/blue-drawing.png'});

  await page.evaluate(()=>{applyTheme('dark');switchAppView('radar');});await page.waitForTimeout(100);assert.deepEqual(await dock(),originalDark,'dark navigation unchanged after round trip');
  console.log('Approved palette passed: three gray dock states and frameless radar, charcoal text, framed white home, visible energy, soft gauges, blue drawing, neutral gray controls, dark round trip.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});

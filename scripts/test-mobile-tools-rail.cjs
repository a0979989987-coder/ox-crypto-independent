const {chromium}=require('playwright');
const {spawn}=require('child_process');
const assert=require('assert/strict');
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','4197']);
(async()=>{
  await new Promise(resolve=>server.stdout.once('data',resolve));
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.OX_CHROMIUM_EXECUTABLE||undefined});
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:4197/missing');
    await page.evaluate(()=>{
      document.head.innerHTML='<base href="/">';document.body.innerHTML='';
      document.body.style.cssText='margin:0;padding:16px';
    });
    await page.evaluate(async()=>{
      const {createToolsRail}=await import('/src/components/strength/tools-rail.js');
      window.rail=createToolsRail({tabs:[['patterns','型態搜尋'],['bubbles','泡泡圖'],['strength','強弱對比'],['heatmap','熱力圖'],['rotation','板塊輪動'],['flow','主動買賣']],selected:'patterns',label:'Crypto',equal:true,mobileCompact:true,onSelect(id){window.selected=id;}});
      document.body.append(rail.element);
    });
    await page.waitForFunction(()=>!!window.rail.shadow.querySelector('link').sheet);
    for(const width of [320,375,390,430,600,1363]) {
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(100);
      const geometry=await page.evaluate(()=>{
        const shadow=window.rail.shadow,viewport=shadow.querySelector('nav');
        return {width:viewport.clientWidth,scroll:viewport.scrollWidth,buttons:[...shadow.querySelectorAll('button')].map(button=>{
          const text=document.createRange();text.selectNodeContents(button);
          const rect=button.getBoundingClientRect(),style=getComputedStyle(button);
          return {width:rect.width,text:text.getBoundingClientRect().width,y:rect.y,align:style.textAlign,font:style.fontSize};
        })};
      });
      assert(geometry.scroll<=geometry.width+1,JSON.stringify({width,geometry}));
      assert.equal(new Set(geometry.buttons.map(button=>button.y)).size,1);
      if(width<=600) for(const button of geometry.buttons) {
        assert(button.text<=button.width-2,JSON.stringify({width,button}));
        assert.equal(button.align,'center');
        assert(Math.abs(button.width-geometry.buttons[0].width)<1);
      }
      else assert(geometry.buttons.every(button=>button.font==='11px'));
      await page.evaluate(()=>window.rail.shadow.querySelector('button:last-child').click());
      assert.equal(await page.evaluate(()=>window.selected),'flow');
      await page.waitForTimeout(400);
      assert(await page.evaluate(()=>{
        const shadow=window.rail.shadow,rail=shadow.querySelector('.twr-mode-rail'),button=shadow.querySelector('.active');
        return Math.abs(parseFloat(rail.style.getPropertyValue('--mode-x'))-button.offsetLeft)<1&&Math.abs(parseFloat(rail.style.getPropertyValue('--mode-width'))-button.offsetWidth)<1;
      }));
      console.log('PASS',width,'all tabs fit, centered, clickable, indicator aligned');
    }
  } finally {await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';

process.env.OX_E2E_PORT='4294';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
await new Promise(resolve=>server.listen(4294,'127.0.0.1',resolve));
const executablePath=process.env.OX_TEST_BROWSER||process.env.OX_BROWSER_PATH;
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const reports=[];
try {
 for(const width of [390,1440])for(const policyDelay of [0,700])for(const feature of ['crypto.radar','crypto.patterns','tw.patterns']){
  const context=await browser.newContext({locale:'zh-TW',viewport:{width,height:844}});
  const {page,audit}=await preparePage(context,{width,height:844});
  await page.route('**/api/v1/account/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
   if(endpoint==='feature-access'){
    if(policyDelay)await new Promise(resolve=>setTimeout(resolve,policyDelay));
    return route.fulfill({json:{ok:true,features:FEATURE_CATALOG.map(row=>({...row,mode:'public',version:'fixture'}))}});
   }
   return route.fulfill({json:endpoint==='session'?{ok:true,user:null}:{configured:false}});
  });
  // The head policy request may complete before parser-blocking styles.
  await page.route('**/foundation.css*',async route=>{
   await new Promise(resolve=>setTimeout(resolve,150));await route.continue();
  });
  await page.goto(testBase+'/?ox_feature='+feature,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>OXFeatures.ready&&OXModules);
  const [market,tool]=feature.split('.'),view=tool==='radar'?'radar':'strength';
  try {await page.waitForFunction(({market,view})=>document.body.dataset.market===market&&document.body.dataset.view===view,{market,view},{timeout:4000});}
  catch(error){console.log(JSON.stringify({width,policyDelay,feature,errors:audit.pageErrors,actual:await page.evaluate(()=>({market:document.body.dataset.market,view:document.body.dataset.view,returning:OXFeatures.returning,selected:OXFeatures.selectedTool('tw'),url:location.href}))}));throw error;}
  if(tool==='patterns')await page.locator(market==='tw'?'#ox-tw-patterns .px-board':'#ox-crypto-tools-inline .px-board').waitFor({timeout:5000});
  else await page.waitForFunction(()=>globalThis.eval('state.candleData.length')>0,{timeout:5000});
  assert.deepEqual(audit.pageErrors,[],`${feature}: direct entry must wait for chart initialization`);
  assert.equal(await page.evaluate(()=>new URL(location.href).searchParams.has('ox_feature')),false);
  reports.push({width,policyDelay,feature,view,errors:audit.pageErrors});
  console.log(JSON.stringify(reports.at(-1)));
  await context.close();
 }
 console.log(`Direct entry startup UI passed: ${reports.length} mobile/desktop cases with fast/delayed policy. Synthetic market data only.`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

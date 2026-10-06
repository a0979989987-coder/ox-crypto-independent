// Read-only public catalog verification. Quotes/WebSocket are explicit fixtures.
// Run only with the existing public DB URL/key; never supply session secrets.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {createAccountHandler} from '../server/account/handler.js';
import {fixtureBody,routeSnapshots} from './performance-fixtures.mjs';
if(process.env.OX_VERIFY_LIVE_POLICY!=='1')throw Error('Explicit OX_VERIFY_LIVE_POLICY=1 required for live public RPC');
const env={OX_SUPABASE_URL:process.env.OX_SUPABASE_URL,OX_SUPABASE_PUBLISHABLE_KEY:process.env.OX_SUPABASE_PUBLISHABLE_KEY};
assert.ok(env.OX_SUPABASE_URL&&env.OX_SUPABASE_PUBLISHABLE_KEY,'Existing public connection required');
process.env.OX_E2E_PORT='4310';
const {server,preparePage,testBase}=createRequire(import.meta.url)('./e2e-check.cjs');
const handler=createAccountHandler({env});
await new Promise(r=>server.listen(4310,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.OX_TEST_BROWSER,headless:true,args:['--no-sandbox']});
const results=[];
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-TW'});
  const {page,audit}=await preparePage(context,{width,height:900});let policy;
  await page.route('**/api/v1/account/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
   const started=Date.now();const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
   await handler({method:route.request().method(),query:{endpoint},headers:{}},res);
   if(endpoint==='feature-access')policy={status:res.statusCode,ok:res.body.ok,count:res.body.features?.length,radarMode:res.body.features?.find(f=>f.id==='crypto.radar')?.mode,requestMs:Date.now()-started};
   await route.fulfill({status:res.statusCode,headers:res.headers,json:res.body});
  });
  await page.route('https://api.bitget.com/**',r=>r.fulfill({json:fixtureBody(r.request().url())}));
  await page.route('https://api.coingecko.com/**',r=>r.fulfill({json:[]}));await routeSnapshots(page);
  await page.goto(testBase,{waitUntil:'domcontentloaded'});
  await page.locator('#view-radar .coin-card').first().waitFor({timeout:30000});
  assert.equal(policy?.status,200);assert.equal(policy.count,18);assert.equal(policy.radarMode,'public');
  assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('ox-feature-blocked')),false);
  assert.equal(await page.evaluate(()=>OXFeatures.ready),true);
  await page.evaluate(()=>switchAppView('strength'));
  for(const [tool,selector] of [['patterns','.px-card'],['bubbles','.oxb-asset-grid button'],['heatmap','.cfx-heat-list button'],['rotation','.cfx-replay'],['flow','.cfx-flow-data']]){
   await page.locator('#ox-crypto-tools-nav [data-crypto-tool="'+tool+'"]').click();
   await page.locator('#ox-crypto-tools-inline '+selector).filter({visible:true}).first().waitFor({timeout:30000});
   assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('ox-feature-blocked')),false,tool+' must follow current public policy');
  }
  assert.deepEqual(audit.pageErrors,[]);
  const result={width,policy,radarAndFiveToolsAccessible:true,loginConfigured:false,pageErrors:audit.pageErrors};results.push(result);console.log(JSON.stringify(result));await context.close();
 }
 await writeFile('docs/performance/live-policy-browser.json',JSON.stringify({conditions:{policy:'actual existing public Supabase catalog RPC, read-only',sessionSecrets:false,market:'8 synthetic quote symbols and simulated WebSocket',surface:'local site assets + real server handler; protected Vercel preview not browser-verified',iphonePhysical:false,browser:await browser.version()},results},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

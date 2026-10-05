import {initializeFeatureFixture} from './lib/feature-access-fixtures.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {seal,cookieName} from '../server/account/cookies.js';
import {candidateFixtureDatabase} from './lib/admin-review-candidate-fixtures.mjs';
import {fixtureIDs as ids} from './lib/admin-review-fixtures.mjs';
// Isolated production transport: actual Vercel router, Account handler and SDK,
// actual candidate SQL; synthetic cookie/JWT/provider. No real OAuth or network.
const env={OX_ACCOUNT_ORIGIN:'https://ox.test',OX_SUPABASE_URL:'https://fixture.supabase.co',OX_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable',OX_AUTH_SESSION_SECRET:'synthetic-session-cookie-key-32-characters'};
Object.assign(process.env,env);
const db=await candidateFixtureDatabase({seedAdmin:true});await db.query('update ox_review_live.policy set ordinary_configured=true');await initializeFeatureFixture(db);
const signing=randomBytes(32),actions=[],errors=[];
function jwt(id){const h=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),p=Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${createHmac('sha256',signing).update(h+'.'+p).digest('base64url')}`;}
function identity(token){try{const[h,p,s]=token.split('.');return createHmac('sha256',signing).update(h+'.'+p).digest('base64url')===s?JSON.parse(Buffer.from(p,'base64url').toString()).sub:null;}catch{return null;}}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url);assert.equal(url.origin,env.OX_SUPABASE_URL,'No external provider requests');
 const token=(new Headers(options.headers).get('authorization')||'').replace(/^Bearer /,''),id=identity(token);
 if(url.pathname==='/auth/v1/user')return id?json({id,email:'member@example.test',created_at:'2026-10-01T00:00:00Z',user_metadata:{admin:true},app_metadata:{role:'admin'},identities:[]}):json({code:'bad_jwt'},401);
 if(url.pathname==='/rest/v1/rpc/ox_feature_access_rpc'){const body=JSON.parse(options.body);try{return json(await db.featureRPC(id,body.p_action,body.p_payload));}catch(e){return json({code:e.code},403);}}
 if(url.pathname==='/rest/v1/rpc/ox_admin_review_rpc'){
  assert.ok(id,'Provider-validated member JWT required');const body=JSON.parse(options.body);actions.push(body.p_action);
  try{return json(await db.memberRPC(id,body.p_action,body.p_payload));}catch(e){return json({code:e.code,message:'synthetic SQL rejection'},403);}
 }
 throw Error('Unexpected synthetic provider endpoint');
};
const {default:router}=await import('../api/v1/account/[endpoint].js');
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.OX_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function pageFor(id,viewport={width:1440,height:900}){
  const context=await browser.newContext({viewport});if(id)await context.addCookies(['access','refresh'].map(kind=>({name:cookieName(kind),value:seal(kind==='access'?jwt(id):'synthetic-refresh',env.OX_AUTH_SESSION_SECRET,kind,600),url:env.OX_ACCOUNT_ORIGIN,httpOnly:true,secure:true,sameSite:'Lax'})));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://ox.test/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['/api/v1/account/admin-review','/api/v1/account/feature-admin','/api/v1/account/feature-access','/api/v1/account/bitget-admin-lookup'].includes(url.pathname)){
    const req={method:request.method(),query:{endpoint:url.pathname.split('/').at(-1)},headers:await request.allHeaders(),body:request.postData()||{},socket:{remoteAddress:'127.0.0.1'}};
    const res={headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;},end(){}};
    await router(req,res);assert.match(res.headers['Cache-Control'],/no-store/);
    return route.fulfill({status:res.code,contentType:'application/json',body:JSON.stringify(res.body)});
   }
   const file=url.pathname==='/previews/account-admin/'?'index.html':url.pathname.split('/').at(-1);
   if(!['index.html','preview.js','model.js','feature-admin.js'].includes(file))throw Error('Unexpected page request');
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:readFileSync(new URL('../previews/account-admin/'+file,import.meta.url),'utf8')});
  });
  await page.goto(env.OX_ACCOUNT_ORIGIN+'/previews/account-admin/');return page;
 }
 const guest=await pageFor();await guest.locator('#status').filter({hasText:'SIGN_IN_REQUIRED'}).waitFor();assert.equal(await guest.locator('#example').isVisible(),false);
 const member=await pageFor(ids.a);await member.locator('#status').filter({hasText:'ADMIN_REQUIRED'}).waitFor();assert.equal(await member.locator('#approvals tr').count(),0);
 const admin=await pageFor(ids.admin);await admin.locator('#session-state').filter({hasText:'已驗證管理員'}).waitFor();assert.equal(await admin.locator('[data-session=admin]').isVisible(),false);
 await admin.locator('#uids').fill('9000000001');await admin.locator('#parse').click();const row=admin.locator('#rows tr');await row.waitFor();await row.locator('select').nth(0).selectOption({index:1});await row.locator('select').nth(1).selectOption('ordinary');
 await admin.locator('#review').click();assert.match(await admin.locator('#confirm-rows').innerText(),/暫不加開權益/);await admin.locator('#reason').fill('Synthetic production transport review');await admin.locator('#approve').click();await admin.locator('#status').filter({hasText:'APPROVED'}).waitFor();await admin.locator('#approvals tr').waitFor();
 const effective=await db.memberRPC(ids.a,'effective',{});assert.deepEqual(effective.approval.capabilities,[]);assert.equal(effective.adminRightsIncluded,false);assert.equal(effective.ownershipVerified,false);
 await admin.locator('#approvals button').click();await admin.locator('#revoke-reason').fill('Synthetic production transport revoke');await admin.locator('#revoke-confirm').click();await admin.locator('#status').filter({hasText:'REVOKED'}).waitFor();assert.equal((await db.memberRPC(ids.a,'effective',{})).approval,null);
 const mobile=await pageFor(ids.admin,{width:390,height:844});await mobile.locator('#session-state').filter({hasText:'已驗證管理員'}).waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await guest.locator('#feature-load').click();await guest.locator('#feature-status').filter({hasText:'SIGN_IN_REQUIRED'}).waitFor();
 await member.locator('#feature-load').click();await member.locator('#feature-status').filter({hasText:'ADMIN_REQUIRED'}).waitFor();
 await admin.locator('#feature-load').click();await admin.locator('#feature-rows tr').nth(10).waitFor();
 await admin.locator('[data-feature="crypto.radar"]').click();assert.equal(await admin.locator('#feature-confirm').isVisible(),true);
 assert.equal((await db.featureRPC(null,'access',{feature:'crypto.radar'})).allowed,true,'Opening confirmation must not change policy');
 await admin.locator('#feature-reason').fill('<img src=x> Synthetic lock');await admin.locator('#feature-save').click();
 await admin.locator('#feature-audit p').filter({hasText:'Synthetic lock'}).waitFor();
 assert.equal((await db.featureRPC(null,'access',{feature:'crypto.radar'})).allowed,false);assert.equal((await db.featureRPC(ids.a,'access',{feature:'crypto.radar'})).allowed,true);
 assert.equal(await admin.locator('#feature-audit img').count(),0);
 await admin.locator('[data-feature="crypto.radar"]').click();await admin.locator('#feature-reason').fill('Synthetic public restore');await admin.locator('#feature-save').click();
 await admin.locator('#feature-audit p').filter({hasText:'Synthetic public restore'}).waitFor();assert.equal((await db.featureRPC(null,'access',{feature:'crypto.radar'})).allowed,true);
 await admin.locator('#bitget-query-uid').fill('123');await admin.locator('#bitget-lookup').click();await admin.locator('#bitget-query-status').filter({hasText:'ADMIN_LOOKUP_NOT_ENABLED'}).waitFor();
 assert.ok(['status','lookup' ,'approve','records','revoke'].every(a=>actions.includes(a)));assert.deepEqual(errors,[]);
 console.log('Production transport UI passed: actual Vercel router → Account JWT handler → SDK → RLS SQL; guest/nonadmin guards, zero-right ordinary approval/audit/revoke, mobile. Synthetic provider only.');
}finally{await browser?.close();await db.close();}

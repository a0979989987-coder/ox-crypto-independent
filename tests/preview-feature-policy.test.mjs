import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountHandler} from '../server/account/handler.js';
import {FEATURE_CATALOG} from '../server/account/feature-catalog.js';
const env={OX_SUPABASE_URL:'https://fixture.supabase.co',OX_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key'};
const features=FEATURE_CATALOG.map(f=>({...f,mode:f.id==='crypto.radar'?'login':'public',version:'fixture-policy-v1'}));
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
const request=(endpoint='feature-access',method='GET')=>({query:{endpoint},method,headers:{cookie:'must-not-forward-session'}});
test('preview reads authoritative public catalog without login configuration or session work',async()=>{
 let clients=0;
 const handler=createAccountHandler({env,clientFactory:(url,key,options)=>{
  clients++;assert.equal(url,env.OX_SUPABASE_URL);assert.equal(key,env.OX_SUPABASE_PUBLISHABLE_KEY);
  assert.deepEqual(options,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return {rpc:async(name,payload)=>{assert.equal(name,'ox_feature_access_rpc');assert.deepEqual(payload,{p_action:'catalog',p_payload:{}});return {data:{ok:true,features},error:null};}};
 }});
 const r=response();await handler(request(),r);assert.equal(r.statusCode,200);assert.equal(clients,1);
 assert.equal(r.body.features.find(f=>f.id==='crypto.radar').mode,'login','must preserve locked policies');
 assert.equal(r.headers['Cache-Control'],'no-store, private');assert.equal(r.headers['Set-Cookie'],undefined);
 const login=response();await handler(request('session'),login);assert.equal(login.statusCode,503);assert.equal(clients,1,'policy configuration does not enable preview login');
});
test('preview policy stays closed for missing connection, rejected RPC, or incomplete catalog',async()=>{
 for(const result of [{error:{message:'private-upstream-detail'}},{data:{ok:true,features:features.slice(1)}}]){
  const r=response();await createAccountHandler({env,clientFactory:()=>({rpc:async()=>result})})(request(),r);
  assert.equal(r.statusCode,503);assert.equal(r.body.code,'FEATURE_POLICY_UNAVAILABLE');assert.equal(JSON.stringify(r.body).includes('private-upstream-detail'),false);
 }
 const r=response();await createAccountHandler({env:{},clientFactory:()=>{throw Error('unexpected');}})(request(),r);
 assert.equal(r.statusCode,503);assert.equal(r.body.code,'FEATURE_POLICY_NOT_CONFIGURED');
 const post=response();await createAccountHandler({env,clientFactory:()=>{throw Error('unexpected');}})(request('feature-access','POST'),post);assert.equal(post.statusCode,405);
});

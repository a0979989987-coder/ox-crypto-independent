import { createClient } from '@supabase/supabase-js';
import { readCookie,unseal } from './cookies.js';
import { FEATURE_CATALOG,validCatalog,TW_API_FEATURES } from './feature-catalog.js';
export async function featureCatalog(reader) {
  const result=await reader.rpc('ox_feature_access_rpc',{p_action:'catalog',p_payload:{}});
  if(result.error||!result.data?.ok||!validCatalog(result.data.features))throw Error('FEATURE_POLICY_UNAVAILABLE');
  return {ok:true,features:result.data.features.map(f=>({...FEATURE_CATALOG.find(item=>item.id===f.id),mode:f.mode,version:f.version}))};
}
export async function handleFeatureAdmin({req,res,reader}) {
  const action=req.method==='GET'?'records':req.body?.action,payload=req.method==='GET'?{}:req.body?.payload;
  if(!['records','update'].includes(action)||!payload||Array.isArray(payload)||typeof payload!=='object'||(req.method==='POST'&&Object.keys(req.body).some(k=>!['action','payload'].includes(k))))return res.status(400).json({ok:false,code:'INVALID_FEATURE_REQUEST'});
  try {
    const result=await reader.rpc('ox_feature_access_rpc',{p_action:action,p_payload:payload});
    if(result.error)return res.status(result.error.code==='42501'?403:503).json({ok:false,code:result.error.code==='42501'?'ADMIN_REQUIRED':'FEATURE_POLICY_UNAVAILABLE'});
    if(!result.data?.ok)return res.status(['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT'].includes(result.data?.code)?409:400).json({ok:false,code:['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_FEATURE_REQUEST'].includes(result.data?.code)?result.data.code:'FEATURE_REQUEST_REJECTED'});
    return res.status(200).json(result.data);
  }catch{return res.status(503).json({ok:false,code:'FEATURE_POLICY_UNAVAILABLE'});}
}
export function createFeatureAPIGate({env=process.env,clientFactory=createClient}={}) {
  return async(req,res,normalizedEndpoint)=>{
    const raw=normalizedEndpoint??req.query?.endpoint;const endpoint=String(Array.isArray(raw)?raw[0]||'':raw??'').trim().toLowerCase();
    const feature=TW_API_FEATURES[endpoint];if(!feature)return true;
    // Policy changes must not be bypassed by a previously public CDN response.
    const setHeader=res.setHeader.bind(res);
    res.setHeader=(name,value)=>setHeader(name,/^(cache-control|vercel-cdn-cache-control|cdn-cache-control)$/i.test(name)?'no-store, private':value);
    res.setHeader('Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');
    const fail=(status,code)=>{res.status(status).json({ok:false,code,feature});return false;};
    if(!env.OX_SUPABASE_URL||!env.OX_SUPABASE_PUBLISHABLE_KEY||!(env.OX_AUTH_SESSION_SECRET?.length>=32))return fail(503,'FEATURE_POLICY_UNAVAILABLE');
    try {
      const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
      const client=clientFactory(env.OX_SUPABASE_URL,env.OX_SUPABASE_PUBLISHABLE_KEY,options);
      // Read current policy before data provider/cache access. No permissive fallback.
      const catalog=await featureCatalog(client),policy=catalog.features.find(f=>f.id===feature);
      if(policy.mode==='public')return true;
      const token=unseal(readCookie(req,'access'),env.OX_AUTH_SESSION_SECRET,'access');
      if(!token)return fail(401,'SIGN_IN_REQUIRED');
      const user=await client.auth.getUser(token);
      if(user.error||!user.data?.user?.id||user.data.user.is_anonymous===true)return fail(401,'SIGN_IN_REQUIRED');
      const reader=clientFactory(env.OX_SUPABASE_URL,env.OX_SUPABASE_PUBLISHABLE_KEY,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
      const access=await reader.rpc('ox_feature_access_rpc',{p_action:'access',p_payload:{feature}});
      if(access.error||!access.data?.ok)return fail(503,'FEATURE_POLICY_UNAVAILABLE');
      if(access.data.allowed!==true)return fail(401,'SIGN_IN_REQUIRED');
      return true;
    }catch{return fail(503,'FEATURE_POLICY_UNAVAILABLE');}
  };
}

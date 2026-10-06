import { FEATURE_CATALOG,validCatalog } from './feature-catalog.js';
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

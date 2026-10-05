import {createBitgetAffiliateClient,validateUid,BitgetLookupError} from '../integrations/bitget/affiliate.js';
export async function handleBitgetAdminLookup({req,res,reader,env,clientFactory=createBitgetAffiliateClient}) {
  const reply=(status,body)=>res.status(status).json(body);
  try {
    const admin=await reader.rpc('ox_admin_review_rpc',{p_action:'status',p_payload:{}});
    if(admin.error||admin.data?.administrator!==true)return reply(403,{ok:false,code:'ADMIN_REQUIRED'});
    if(req.method==='GET')return reply(200,{ok:true,configured:env.OX_BITGET_ADMIN_LOOKUP_ENABLED==='true',ownershipVerified:false,accessPolicyChanged:false});
    if(!req.body||Object.keys(req.body).some(k=>k!=='uid'))return reply(400,{ok:false,code:'INVALID_LOOKUP_REQUEST'});
    validateUid(req.body.uid);
    // Explicit rollout switch: local mocks may enable; no production API call now.
    if(env.OX_BITGET_ADMIN_LOOKUP_ENABLED!=='true')return reply(503,{ok:false,code:'ADMIN_LOOKUP_NOT_ENABLED'});
    const data=await clientFactory({env}).lookupCustomer({uid:req.body.uid});
    return reply(200,{ok:true,data,ownershipVerified:false,accessPolicyChanged:false});
  }catch(error){return reply(error instanceof BitgetLookupError?error.status||502:503,{ok:false,code:error instanceof BitgetLookupError?error.code:'LOOKUP_UNAVAILABLE'});}
}

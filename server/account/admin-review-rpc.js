// Candidate adapter: uses only the provider-validated member JWT, never a
// service-role key. Database RPC rechecks private admin membership itself.
const codes = Object.freeze({SIGN_IN_REQUIRED:401,ADMIN_REQUIRED:403,IDEMPOTENCY_CONFLICT:409,POLICY_CHANGED:409,APPROVAL_CHANGED:409,APPROVAL_NOT_FOUND:404,REVIEW_POLICY_UNAVAILABLE:503,TOO_MANY_MATCHES:422});
const allowed = new Set(['lookup','approve','records','revoke','effective']);
export async function handleAdminReview({req,res,reader}) {
  const reply=(status,body)=>res.status(status).json(body);
  let action='status',payload={};
  if(req.method==='POST') {
    const body=req.body;
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['action','payload'].includes(k))||!allowed.has(body.action)||!body.payload||Array.isArray(body.payload)||typeof body.payload!=='object')
      return reply(400,{ok:false,code:'INVALID_REVIEW_REQUEST'});
    action=body.action;payload=body.payload;
  }
  try {
    const result=await reader.rpc('ox_admin_review_rpc',{p_action:action,p_payload:payload});
    if(result.error) {
      const status=result.error.code==='42501'?403:503;
      return reply(status,{ok:false,code:status===403?'ADMIN_REQUIRED':'REVIEW_NOT_CONFIGURED'});
    }
    if(!result.data||typeof result.data!=='object'||typeof result.data.ok!=='boolean') throw Error('Invalid RPC response');
    if(!result.data.ok) return reply(codes[result.data.code]||400,{ok:false,code:Object.hasOwn(codes,result.data.code)||/^(INVALID_|REASON_REQUIRED|DUPLICATE_TARGET|IDEMPOTENCY_KEY_REQUIRED)/.test(result.data.code||'')?result.data.code:'REVIEW_REQUEST_REJECTED'});
    return reply(200,result.data);
  }catch{return reply(503,{ok:false,code:'REVIEW_UNAVAILABLE'});}
}

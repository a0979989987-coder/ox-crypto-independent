import {readFileSync} from 'node:fs';
export async function initializeFeatureFixture(db){
 await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('request.jwt.claim.is_anonymous',true),''),'false')::boolean)$$;grant execute on function auth.jwt() to ox_review_executor;`);
 await db.exec(readFileSync(new URL('../../docs/account/feature-access-schema-draft.sql',import.meta.url),'utf8'));
 let tail=Promise.resolve();
 db.featureRPC=(id,action,payload={},anonymous=false)=>{const result=tail.then(()=>db.transaction(async tx=>{
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);await tx.query("select set_config('request.jwt.claim.is_anonymous',$1,true)",[String(anonymous)]);await tx.exec('set local role '+(id?'authenticated':'anon'));
  return (await tx.query('select public.ox_feature_access_rpc($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;
 }));tail=result.catch(()=>{});return result;};return db;
}

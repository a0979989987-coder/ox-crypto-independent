const $=s=>document.querySelector(s),prod=!['localhost','127.0.0.1','::1'].includes(location.hostname)||new URL(location.href).searchParams.get('transport')==='rpc';
let epoch=0,pending=null,request=null;
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
async function api(endpoint,body){const r=await fetch((prod?'/api/v1/account/':'/preview-api/')+endpoint,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),data=await r.json();if(!r.ok||!data.ok)throw Error(data.code||'UNAVAILABLE');return data;}
async function load(){
 if(window.OXReviewPreview?.sessionChanging)return;
 const token=++epoch;pending=null;request=null;$('#feature-confirm').close();$('#feature-rows').replaceChildren();$('#feature-audit').replaceChildren();
 try{
  const data=await api('feature-admin'),catalog=await api('feature-access');if(token!==epoch)return;
  for(const row of data.features.filter(f=>!f.id.startsWith('tw.'))){
   const spec=catalog.features.find(f=>f.id===row.id);if(!spec)throw Error('INVALID_CATALOG');
   const tr=document.createElement('tr');tr.append(node('td',spec.label));
   tr.append(node('td',row.mode==='public'?'公開':'需註冊登入'));
   tr.append(node('td',spec.boundary==='api_and_public_snapshot'?'OX 專屬 API 會驗證；公開快照仍可讀':'網站入口限制；外部行情／公開快照或純前端運算不能保密'));
   const cell=document.createElement('td'),button=node('button',row.mode==='public'?'改為需登入':'改為公開');button.type='button';button.dataset.feature=row.id;
   button.onclick=()=>{pending={feature:row.id,version:row.version,mode:row.mode==='public'?'login':'public'};request=null;$('#feature-target').textContent=`${spec.label}：${row.mode==='public'?'公開 → 需註冊登入':'需註冊登入 → 公開'}。只影響此產品功能；不公開後台、會員資料或審核紀錄。`;$('#feature-reason').value='';$('#feature-confirm').showModal();};cell.append(button);tr.append(cell);$('#feature-rows').append(tr);
  }
  for(const record of data.audit)$('#feature-audit').append(node('p',`#${record.sequence} ${record.feature} ${record.old_mode} → ${record.new_mode} · ${record.actor_id} · ${record.reason}`));
  $('#feature-status').textContent='設定已讀取。變更必須確認及填寫理由；普通／核心代理資格不影響此開關。';
 }catch(e){if(token===epoch)$('#feature-status').textContent=`無法讀取／未授權，未開放修改：${e.message}`;}
}
$('#feature-load').onclick=load;$('#feature-back').onclick=()=>$('#feature-confirm').close();
$('#feature-save').onclick=async()=>{
 if(window.OXReviewPreview?.sessionChanging||!pending||!$('#feature-reason').value.trim())return;
 const token=epoch;request??={action:'update',payload:{...pending,reason:$('#feature-reason').value.trim(),idempotencyKey:crypto.randomUUID()}};
 $('#feature-save').disabled=true;
 try{await api('feature-admin',request);if(token===epoch){$('#feature-confirm').close();await load();}}
 catch(e){if(token===epoch)$('#feature-status').textContent=`儲存未完成：${e.message}。請重新讀取以確認目前狀態。`;}
 finally{$('#feature-save').disabled=false;}
};
$('#bitget-lookup').onclick=async()=>{
 if(window.OXReviewPreview?.sessionChanging)return;
 const token=epoch;
 $('#bitget-lookup').disabled=true;$('#bitget-query-status').textContent='正在查詢…';
 try{
  const status=await api('bitget-admin-lookup');
  if(token!==epoch)return;
  if(!status.configured)throw Error('ADMIN_LOOKUP_NOT_ENABLED');
  const result=await api('bitget-admin-lookup',{uid:$('#bitget-query-uid').value.trim()}),data=result.data;
  if(token!==epoch)return;
  $('#bitget-query-status').textContent=`UID ${data.uid}：直客關係 ${data.referral.status}；KYC／KYB ${data.certification.status}。本結果不證明 UID 本人持有，不變更任何會員權限。`;
 }catch(e){if(token!==epoch)return;$('#bitget-query-status').textContent=`查詢未完成：${e.message}。待驗證 UID 並非本人認證；不自動授權。`;}
 finally{if(token===epoch)$('#bitget-lookup').disabled=false;}
};
for(const button of document.querySelectorAll('[data-session]'))button.addEventListener('click',()=>{epoch++;pending=null;request=null;$('#feature-rows').replaceChildren();$('#feature-audit').replaceChildren();$('#feature-confirm').close();$('#feature-status').textContent='身份已切換，請重新讀取功能設定。';$('#bitget-query-status').textContent='';$('#bitget-lookup').disabled=!!window.OXReviewPreview?.sessionChanging;});

document.addEventListener('ox:review-session-changing',event=>{for(const id of ['feature-load','bitget-lookup','feature-save'])$('#'+id).disabled=event.detail.changing;});

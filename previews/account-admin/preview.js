import { parseUIDs, matchClaims, confirmation, LEVELS } from './model.js';
const $ = s => document.querySelector(s); let rows = [], policyVersion, ordinaryConfigured=false, selected, lastApproval, lastRevoke, revokeTarget, sessionEpoch=0, inputEpoch=0, recordEpoch=0, sessionChanging=false;
window.OXReviewPreview=Object.freeze({get sessionChanging(){return sessionChanging;}});
const productionTransport=!['127.0.0.1','localhost','::1'].includes(location.hostname)||new URL(location.href).searchParams.get('transport')==='rpc';
function resetInput() {
  inputEpoch++; rows=[];selected=null;revokeTarget=null;lastApproval=null;lastRevoke=null;
  $('#rows').replaceChildren();$('#review').disabled=true;$('#confirmation').close();$('#revoke-dialog').close();
}
async function api(endpoint,body) {
  if(productionTransport&&endpoint==='fixture-session')throw Error('Fixture sessions are unavailable on the Account API');
  const requestBody=productionTransport&&endpoint!=='status'?{action:endpoint,payload:body||{}}:body;
  const response=await fetch(productionTransport?'/api/v1/account/admin-review':'/preview-api/'+endpoint,{method:requestBody?'POST':'GET',headers:requestBody?{'content-type':'application/json'}:{},...(requestBody?{body:JSON.stringify(requestBody)}:{})});
  const result=await response.json();if(!response.ok) throw Error(result.code);return result;
}
function retryPayload(previous,body) {
  const fingerprint=JSON.stringify(body);return previous?.fingerprint===fingerprint?previous:{fingerprint,body:{...body,idempotencyKey:crypto.randomUUID()}};
}
function text(tag, value) { const el=document.createElement(tag); el.textContent=value; return el; }
function options(items, placeholder) {
  const select=document.createElement('select'); const option=text('option',placeholder); option.value=''; select.append(option);
  for(const [value,label] of items) { const option=text('option',label); option.value=value; select.append(option); } return select;
}
$('#example').addEventListener('click',()=>{ $('#uids').value='9000000001 9000000002,9000000003\n9000000001'; $('#uids').dispatchEvent(new Event('input')); });
$('#uids').addEventListener('input',()=>{ resetInput(); $('#status').textContent='輸入已變更，請重新整理比對。'; });
$('#parse').addEventListener('click',async()=>{
  if(sessionChanging)return;
  resetInput(); const inputVersion=inputEpoch,sessionVersion=sessionEpoch;
  try {
    const parsed=parseUIDs($('#uids').value);
    if(parsed.invalid.length) throw Error(`UID 格式不正確：${parsed.invalid.join('、')}`);
    if(!parsed.uids.length) throw Error('請先貼上 UID。');
    const lookup=await api('lookup',{uids:parsed.uids});if(inputVersion!==inputEpoch||sessionVersion!==sessionEpoch)return;policyVersion=lookup.policyVersion;ordinaryConfigured=lookup.ordinaryConfigured??lookup.ordinaryCapabilities.length>0;
    rows=matchClaims(parsed.uids,lookup.claims);
    for(const row of rows) {
      const tr=document.createElement('tr'); tr.dataset.uid=row.uid;
      const status={matched:'單一匹配，請核對',ambiguous:'多位申請者，必須選定一人',unmatched:'無匹配，不可核准'}[row.status];
      tr.append(text('td',`${row.uid} — ${status}`));
      const member=options(row.candidates.map(c=>[c.accountId,`${c.name} · ${c.accountId}`]),'請選定並核對會員');
      member.setAttribute('aria-label',`${row.uid} OX 會員`); member.disabled=!row.candidates.length;
      member.addEventListener('change',()=>{row.accountId=member.value;});
      const memberCell=document.createElement('td'); memberCell.append(member); tr.append(memberCell);
      const level=options(Object.entries(LEVELS),'請指定代理等級'); level.setAttribute('aria-label',`${row.uid} 代理等級`); level.disabled=!row.candidates.length;
      level.addEventListener('change',()=>{row.level=level.value;});
      const levelCell=document.createElement('td'); levelCell.append(level,text('p',`普通：${ordinaryConfigured?productionTransport?'可核准，暫不加開權益':'合成測試功能':'未設定，不授權'}；核心：全部會員功能。皆不含管理權`)); tr.append(levelCell);
      const exclude=document.createElement('input'); exclude.type='checkbox'; exclude.setAttribute('aria-label',`${row.uid} 本批排除`);
      exclude.addEventListener('change',()=>{row.excluded=exclude.checked; member.disabled=exclude.checked||!row.candidates.length; level.disabled=member.disabled;});
      const excludeCell=document.createElement('td'); excludeCell.append(exclude); tr.append(excludeCell); $('#rows').append(tr);
    }
    $('#status').textContent=`${rows.length} 個 UID；已去除 ${parsed.duplicates} 筆重複。請逐筆指定會員與等級，或明確排除。`; $('#review').disabled=false;
  } catch(error) { if(inputVersion===inputEpoch&&sessionVersion===sessionEpoch) $('#status').textContent=error.message; }
});
$('#review').addEventListener('click',()=>{
  if(sessionChanging)return;
  try {
    const result=confirmation(rows);selected=result.entries; $('#confirm-rows').replaceChildren();
    for(const item of result.entries) { const tr=document.createElement('tr'); for(const value of [item.uid,`${item.name} · ${item.accountId}`,LEVELS[item.level],item.level==='core'?productionTransport?'全部會員功能':'全部會員功能（預覽）':ordinaryConfigured?productionTransport?'可核准，暫不加開權益':'合成測試功能（非正式矩陣）':'未設定，此筆不授權']) tr.append(text('td',value)); $('#confirm-rows').append(tr); }
    $('#excluded').textContent=`本批排除：${result.excluded.join('、')||'無'}`; $('#confirmation').showModal();
  } catch(error) { $('#status').textContent=error.message; }
});
$('#back').addEventListener('click',()=>$('#confirmation').close());
async function records() {
  if(sessionChanging)return;
  const sessionVersion=sessionEpoch,recordVersion=++recordEpoch;
  const data=await api('records');if(sessionVersion!==sessionEpoch||recordVersion!==recordEpoch)return;$('#approvals').replaceChildren();$('#audit').replaceChildren();
  for(const row of data.approvals) {
    const tr=document.createElement('tr');tr.dataset.approvalId=row.id;
    for(const value of [`${row.uid} / ${row.account_id}`,LEVELS[row.level],row.status==='active'&&row.effective===false?'政策已變更，核准失效':{active:'人工審核通過',revoked:'已撤銷',invalidated:'UID 已變更，核准失效'}[row.status]]) tr.append(text('td',value));
    const td=document.createElement('td'),button=text('button','撤銷');button.type='button';button.disabled=row.status!=='active';
    button.addEventListener('click',()=>{revokeTarget=row;$('#revoke-target').textContent=`${row.uid} / ${row.account_id} / ${LEVELS[row.level]}`;$('#revoke-reason').value='';$('#revoke-dialog').showModal();});td.append(button);tr.append(td);$('#approvals').append(tr);
  }
  for(const row of data.audit) $('#audit').append(text('p',`#${row.sequence} ${row.action} · ${row.actor_id} · ${row.reason} · ${row.created_at} · manual_approval`));
  if(data.truncated)$('#audit').append(text('p','目前顯示最近 100 筆核准與 200 筆稽核。'));
}
for(const button of document.querySelectorAll('[data-session]')) button.addEventListener('click',async()=>{
  sessionChanging=true;document.dispatchEvent(new CustomEvent('ox:review-session-changing',{detail:{changing:true}}));$('#parse').disabled=true;$('#refresh').disabled=true;
  const sessionVersion=++sessionEpoch;resetInput();$('#approvals').replaceChildren();$('#audit').replaceChildren();
  for(const sibling of document.querySelectorAll('[data-session]')) sibling.disabled=true;
  try {
    await api('fixture-session',{mode:button.dataset.session});if(sessionVersion!==sessionEpoch)return;
    resetInput();recordEpoch++;sessionChanging=false;$('#session-state').textContent={admin:'合成管理員',member:'合成一般會員',guest:'未登入'}[button.dataset.session];
    $('#status').textContent='測試身分已切換。';if(button.dataset.session==='admin') await records();
  }catch(error){if(sessionVersion===sessionEpoch)$('#status').textContent=error.message;}finally{sessionChanging=false;document.dispatchEvent(new CustomEvent('ox:review-session-changing',{detail:{changing:false}}));$('#parse').disabled=false;$('#refresh').disabled=false;for(const sibling of document.querySelectorAll('[data-session]')) sibling.disabled=false;}
});
$('#approve').addEventListener('click',async()=>{
  if(sessionChanging||!selected)return;
  if(!$('#reason').value.trim()){ $('#status').textContent='請填寫核准理由。';$('#reason').focus();return; }
  $('#approve').disabled=true;const sessionVersion=sessionEpoch,inputVersion=inputEpoch;
  try {
    lastApproval=retryPayload(lastApproval,{policyVersion,reason:$('#reason').value.trim(),entries:selected.map(({uid,accountId,revision,level})=>({uid,accountId,revision,level}))});
    const result=await api('approve',lastApproval.body);if(sessionVersion!==sessionEpoch||inputVersion!==inputEpoch)return;$('#confirmation').close();
    $('#status').textContent=result.results.map(r=>`${r.uid}: ${r.code}`).join('；');await records();
  }catch(error){if(sessionVersion===sessionEpoch&&inputVersion===inputEpoch)$('#status').textContent=error.message;}finally{$('#approve').disabled=false;}
});
$('#refresh').addEventListener('click',()=>{if(sessionChanging)return;const sessionVersion=sessionEpoch;records().catch(error=>{if(sessionVersion===sessionEpoch)$('#status').textContent=error.message;});});
$('#revoke-back').addEventListener('click',()=>$('#revoke-dialog').close());
$('#revoke-confirm').addEventListener('click',async()=>{
  if(sessionChanging||!revokeTarget)return;
  if(!$('#revoke-reason').value.trim()) {$('#revoke-reason').focus();return;}
  $('#revoke-confirm').disabled=true;const sessionVersion=sessionEpoch;
  try {
    lastRevoke=retryPayload(lastRevoke,{approvalId:revokeTarget.id,version:revokeTarget.version,reason:$('#revoke-reason').value.trim()});
    const result=await api('revoke',lastRevoke.body);if(sessionVersion!==sessionEpoch)return;$('#revoke-dialog').close();$('#status').textContent=result.code;await records();
  }catch(error){if(sessionVersion===sessionEpoch)$('#status').textContent=error.message;}finally{$('#revoke-confirm').disabled=false;}
});

if(productionTransport) {
  document.title='OX 代理審核後台';
  const verifiedStatus=document.createElement('p');verifiedStatus.append($('#session-state'));$('.notice').after(verifiedStatus);
  const accountLink=text('a','返回 OX 帳號');accountLink.href='/';verifiedStatus.after(accountLink);
  document.querySelector('[aria-label="合成測試身分"]').style.display='none';$('#example').hidden=true;$('.muted')?.remove();
  $('.notice').textContent='人工代理核准與 Bitget 官方驗證、UID 持有權驗證分開；代理等級不包含管理權。普通功能未配置時不授權。';
  $('#approve').textContent='確認人工核准';$('#revoke-confirm').textContent='確認撤銷';
  $('#confirmation>p').textContent='請核對指定會員與代理等級；人工核准不代表 Bitget 官方認證或 UID 持有權已驗證。';
  api('status').then(()=>{$('#session-state').textContent='已驗證管理員';return records();}).catch(error=>{$('#status').textContent=error.message;});
}

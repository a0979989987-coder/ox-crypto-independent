// Keep recovery usable even when the tool's stylesheet could not be loaded.
export function showToolLoadError(host,error,retry) {
  host.replaceChildren();
  const box=document.createElement('div');
  box.setAttribute('role','status');
  box.style.cssText='display:grid;gap:12px;justify-items:center;padding:24px 16px;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere';
  const title=document.createElement('p');title.textContent='工具暫時無法載入';title.style.margin='0';
  const button=document.createElement('button');button.type='button';button.textContent='重新連線';
  button.style.cssText='font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:12px;padding:10px 20px;min-height:44px';
  button.onclick=()=>{button.disabled=true;retry();};
  const details=document.createElement('details'),label=document.createElement('summary'),message=document.createElement('p');
  label.textContent='查看載入原因';
  message.textContent=`${error?.name||'Error'}：${String(error?.message||'未取得工具資料').slice(0,240)}`;
  details.append(label,message);box.append(title,button,details);host.append(box);
}

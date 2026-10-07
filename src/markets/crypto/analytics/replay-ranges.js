export const REPLAY_RANGES=[['current','目前時間級別'],['7d','最近七天'],['1m','最近一個月'],['3m','最近一季'],['1y','最近一年']];
const stageDate=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit'});
const stageTime=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function replayStages(frames,position,period){
 if(!frames.length)return [];
 const current=Math.max(0,Math.min(frames.length-1,Math.floor(position))),start=Math.max(0,Math.min(current-1,frames.length-3));
 return frames.slice(start,start+3).map((frame,i)=>({ts:frame.ts,index:start+i,current:start+i===current,label:stageDate.format(frame.ts)+(period==='1d'?'':' '+stageTime.format(frame.ts))}));
}
export function replayWindow(range,now=Date.now()){
 const end=new Date(now),start=new Date(now);
 if(range==='7d'||range==='current')start.setUTCDate(start.getUTCDate()-7);
 else if(range==='1m'||range==='3m'){
  const day=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-(range==='1m'?1:3));
  const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(day,last));
 }else if(range==='1y'){const month=start.getUTCMonth();start.setUTCFullYear(start.getUTCFullYear()-1);if(start.getUTCMonth()!==month)start.setUTCDate(0);}
 else throw Error('Unsupported replay range');
 return {start:+start,end:+end,days:Math.ceil((end-start)/86400000)};
}
export function replayCoverage(frames,range,now){
 const window=replayWindow(range,now),valid=frames.filter(frame=>frame.ts>=window.start&&frame.ts<=window.end);
 return {frames:valid,requested:window,availableFrom:valid[0]?.ts??null,availableTo:valid.at(-1)?.ts??null,complete:valid.length>=window.days-1};
}

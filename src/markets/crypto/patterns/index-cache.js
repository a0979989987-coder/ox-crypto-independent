// Local observations only; no generated candles or inferred market values are stored.
import { TIMEFRAMES, candleBoundary } from './catalog.js?v=patterns5d-20260929';
export const INDEX_VERSION=9;
const memory=new Map();let opening;
export const entryKey=data=>`${data.symbol}:${data.frame}`;
export function entryCurrent(entry,now=Date.now()){
  return entry?.version===INDEX_VERSION&&seriesCurrent(entry,now);
}
function seriesCurrent(entry,now=Date.now()){
  const d=entry?.data,seconds=TIMEFRAMES[d?.frame];
  if(!seconds||!Array.isArray(d.candles)||d.candles.length<35)return false;
  const last=d.candles.at(-1),boundary=candleBoundary(now,d.frame);
  return last.provisional?last.time===boundary&&now-d.serverTime<300000:last.time+seconds===boundary;
}
function database(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  return opening??=new Promise(resolve=>{
    let r;try{r=indexedDB.open('ox-crypto-pattern-index',1);}catch{return resolve(null);}
    r.onupgradeneeded=()=>{const s=r.result.createObjectStore('series',{keyPath:'key'});s.createIndex('frame','frame');};
    r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>resolve(null);
  });
}
export async function readIndex(frames,now=Date.now()){
  const db=await database();
  if(db)await Promise.all(frames.map(frame=>new Promise(resolve=>{
    let r;try{r=db.transaction('series').objectStore('series').index('frame').getAll(frame);}catch{return resolve();}
    r.onsuccess=()=>{for(const e of r.result)if(seriesCurrent(e,now)||e.data?.frame==='1W')memory.set(e.key,e);resolve();};r.onerror=()=>resolve();
  })));
  return [...memory.values()].filter(e=>frames.includes(e.data.frame)&&(seriesCurrent(e,now)||e.data.frame==='1W'));
}
export async function saveIndex(data,matches){
  const entry={key:entryKey(data),frame:data.frame,data,matches,version:INDEX_VERSION,savedAt:Date.now()};memory.set(entry.key,entry);
  if(memory.size>1000)memory.delete(memory.keys().next().value);
  const db=await database();if(!db)return entry;
  try{const tx=db.transaction('series','readwrite');tx.objectStore('series').put(entry);tx.onerror=()=>{};}catch{}
  return entry;
}
export async function pruneIndex(now=Date.now()){
  const db=await database();if(!db)return;
  try{const tx=db.transaction('series','readwrite'),r=tx.objectStore('series').openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;if(c.value.savedAt<now-86400000||c.value.version!==INDEX_VERSION)c.delete();c.continue();};tx.onerror=()=>{};}catch{}
}

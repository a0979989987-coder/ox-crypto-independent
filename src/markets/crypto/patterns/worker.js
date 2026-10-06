import { prepareCandles, indexPrepared, matchPrepared } from './matcher.js?v=20261002-rank8';
// Prepared geometry is much larger than its 200 source candles. Bound it without
// dropping scan coverage: searches carry their own bounded 25-series batch.
const index=new Map(),MAX_PREPARED=64;
function prepared(key,candles){let context=index.get(key);if(!context&&candles)context=prepareCandles(candles);if(!context)return null;index.delete(key);index.set(key,context);while(index.size>MAX_PREPARED)index.delete(index.keys().next().value);return context;}
self.onmessage=({data})=>{
 try{
  if(data.type==='index')self.postMessage({id:data.id,result:indexPrepared(prepared(data.key,data.candles),data.matches)});
  else if(data.type==='prepare'){for(const e of data.entries)prepared(e.key,e.candles);self.postMessage({id:data.id,result:true});}
  else if(data.type==='search'){
   const raw=new Map((data.entries||[]).map(e=>[e.key,e.candles])),results=[];
   for(const key of data.keys){const context=prepared(key,raw.get(key));if(!context)throw Error('搜尋資料缺漏');const match=matchPrepared(context,data.query);if(match)results.push({key,match});}
   self.postMessage({id:data.id,result:results});
  }else if(data.type==='retain'){const keep=new Set(data.keys);for(const key of index.keys())if(!keep.has(key))index.delete(key);}
 }catch(error){self.postMessage({id:data.id,error:error.message});}
};

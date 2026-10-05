import { prepareCandles, indexPrepared, matchPrepared } from './matcher.js?v=20261002-rank8';
const index=new Map();
self.onmessage=({data})=>{
  try{
    if(data.type==='index'){
      const context=prepareCandles(data.candles);index.set(data.key,context);
      self.postMessage({id:data.id,result:indexPrepared(context,data.matches)});
    }else if(data.type==='prepare'){
      for(const entry of data.entries)index.set(entry.key,prepareCandles(entry.candles));
      self.postMessage({id:data.id,result:true});
    }else if(data.type==='search'){
      const results=[];
      for(const key of data.keys){const context=index.get(key);if(!context)continue;const match=matchPrepared(context,data.query);if(match)results.push({key,match});}
      self.postMessage({id:data.id,result:results});
    }else if(data.type==='retain'){
      const keep=new Set(data.keys);for(const key of index.keys())if(!keep.has(key))index.delete(key);
    }
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};

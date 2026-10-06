// Translate public headlines only; never submit article bodies or user data.
// Reviewed translations in the collector take precedence over this fallback.
import {withDeadline} from '../src/components/resource-deadline.js';
export async function translateHeadlines(items, { fetcher = fetch, limit = 100, concurrency = 3, timeoutMs = 5000 } = {}) {
  const pending=items.filter(item=>!item.titleZh && typeof item.title==='string' && /[a-z]{3}|[\u4e00-\u9fff]/i.test(item.title) && !/^\d{4,6}[a-z]?$/i.test(item.title.trim())).slice(0,limit);
  let cursor=0,translated=0,failed=0,halt=false,reason=null;
  await Promise.all(Array.from({length:Math.min(concurrency,pending.length)},async()=>{
    while(!halt&&cursor<pending.length){
      const item=pending[cursor++];
      try {
        const url=new URL('https://translate.googleapis.com/translate_a/single');
        url.search=new URLSearchParams({client:'gtx',sl:'auto',tl:'zh-TW',dt:'t',q:item.title}).toString();
        const payload=await withDeadline(async signal=>{
          const response=await fetcher(url,{signal});
          if(response.status===429){halt=true;reason='translation-rate-limited';throw Error('translation rate limited');}
          if(!response.ok)throw Error('translation unavailable');
          return response.json();
        },timeoutMs,'翻譯服務逾時');
        const titleZh=Array.isArray(payload?.[0])?payload[0].map(part=>typeof part?.[0]==='string'?part[0]:'').join('').trim():'';
        if(!/[\u4e00-\u9fff]/.test(titleZh)||titleZh===item.title||titleZh.length>1500)throw Error('invalid translation');
        Object.assign(item,{titleZh,translationStatus:'translated',translationMethod:'machine-title-only'});translated++;
      }catch{failed++;}
    }
  }));
  return {attempted:cursor,translated,failed,deferred:pending.length-cursor,...(reason?{reason}:{})};
}

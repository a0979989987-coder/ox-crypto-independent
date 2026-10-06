/* Public, read-only market transport. Never used for account/private APIs. */
(() => {
 if(globalThis.OXPublicFeed)return;
 function createPublicFeed({fetcher=(...args)=>globalThis.fetch(...args),intervalMs=150,concurrency=4,cooldownMs=2000,maxCache=240}={}){
  const queue=[],active=new Set(),hosts=new Map(),inflight=new Map(),cache=new Map();let wake=0,sequence=0,hits=0,merged=0;
  const abortError=()=>new DOMException('行情工作已取消','AbortError');
  const keyFor=url=>{const u=new URL(url,globalThis.location?.href||'https://fixture.test');u.searchParams.sort();return u.href;};
  const ttlFor=url=>/\/market\/(?:instruments|contracts)\?/.test(url)?60000:/\/market\/(?:tickers|candles|history-candles)\?/.test(url)?1000:0;
  function settle(reader,error,value){clearTimeout(reader.timer);reader.signal?.removeEventListener('abort',reader.cancelSignal);reader.job?.readers.delete(reader);error?reader.reject(error):reader.resolve(value);}
  function finish(job,error,value){if(job.done)return;job.done=true;active.delete(job);inflight.delete(job.key);const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);
   if(!error&&job.ttl>0){cache.delete(job.key);cache.set(job.key,{value,at:Date.now(),ttl:job.ttl});while(cache.size>maxCache)cache.delete(cache.keys().next().value);}
   for(const reader of [...job.readers])settle(reader,error,value);pump();
  }
  function pump(){clearTimeout(wake);wake=0;if(active.size>=concurrency)return;queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);const now=Date.now();let next=Infinity;
   for(const job of [...queue]){if(active.size>=concurrency)break;if(job.done)continue;
    if(concurrency>1&&job.priority<100&&active.size>=concurrency-1)continue;
    const host=hosts.get(job.host)||{next:0,cool:0};hosts.set(job.host,host);const at=Math.max(host.next,host.cool);if(at>now){next=Math.min(next,at);continue;}
    queue.splice(queue.indexOf(job),1);host.next=now+intervalMs;active.add(job);run(job,host);
   }
   if(queue.length&&active.size<concurrency)wake=setTimeout(pump,Math.max(1,(Number.isFinite(next)?next:Date.now()+intervalMs)-Date.now()));
  }
  async function run(job,host){try{
   const response=await fetcher(job.url,{cache:'no-store',signal:job.controller.signal});if(job.done)return;
   if(response.status===429){const raw=response.headers?.get('Retry-After'),seconds=Number(raw),delay=raw&&Number.isFinite(seconds)?seconds*1000:raw?Date.parse(raw)-Date.now():cooldownMs;
    host.cool=Math.max(host.cool,Date.now()+Math.min(60000,Math.max(cooldownMs,delay||0)));if(job.attempt++<1){active.delete(job);queue.push(job);pump();return;}}
   if(!response.ok){const error=Error(`行情 HTTP ${response.status}`);error.status=response.status;throw error;}
   finish(job,null,await response.json());
  }catch(error){finish(job,job.controller.signal.aborted?abortError():error);}}
  function json(url,{signal,owner='foreground',priority=20,timeoutMs=30000,maxAgeMs=ttlFor(String(url))}={}){
   if(signal?.aborted)return Promise.reject(abortError());const key=keyFor(url),cached=cache.get(key);
   if(cached&&Date.now()-cached.at<Math.min(cached.ttl,maxAgeMs)){hits++;return Promise.resolve(cached.value);}if(cached)cache.delete(key);
   let job=inflight.get(key);if(job){merged++;job.priority=Math.max(job.priority,priority);}else{job={key,url:String(url),host:new URL(key).host,priority,id:++sequence,attempt:0,controller:new AbortController(),readers:new Set(),ttl:maxAgeMs};inflight.set(key,job);queue.push(job);}
   return new Promise((resolve,reject)=>{
    const reader={job,owner,signal,resolve,reject};
    reader.cancel=(error=abortError())=>{if(!job.readers.has(reader))return;settle(reader,error);if(!job.readers.size){job.controller.abort();finish(job,abortError());}};
    const onAbort=()=>reader.cancel();reader.cancelSignal=onAbort;
    // Keep the exact listener so it is removed on success as well as cancellation.
    signal?.addEventListener('abort',onAbort,{once:true});
    reader.timer=setTimeout(()=>reader.cancel(new DOMException('行情排隊或讀取逾時','TimeoutError')),timeoutMs);job.readers.add(reader);pump();
   });
  }
  function cancel(owner){for(const job of [...queue,...active])for(const reader of [...job.readers])if(reader.owner===owner)reader.cancel();}
  return Object.freeze({json,cancel,stats:()=>({queued:queue.length,active:active.size,priorityActive:[...active].filter(j=>j.priority>=100).length,cached:cache.size,hits,merged}),create:createPublicFeed});
 }
 globalThis.OXPublicFeed=createPublicFeed();
})();

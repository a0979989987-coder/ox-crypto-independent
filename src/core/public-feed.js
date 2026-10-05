/* Public, read-only market transport. Never used for account/private APIs. */
(() => {
  if (globalThis.OXPublicFeed) return;
  function createPublicFeed({fetcher=(...args)=>globalThis.fetch(...args),intervalMs=150,concurrency=4,cooldownMs=2000}={}) {
    const queue=[], active=new Set(), hosts=new Map();let wake=0,sequence=0;
    const abortError=()=>new DOMException('行情工作已取消','AbortError');
    function finish(job,error,value){if(job.done)return;job.done=true;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.cancel);active.delete(job);const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);error?job.reject(error):job.resolve(value);pump();}
    function pump(){clearTimeout(wake);wake=0;if(active.size>=concurrency)return;
      queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);
      const now=Date.now();let next=Infinity;
      for(const job of [...queue]){if(active.size>=concurrency)break;if(job.done)continue;
        // Leave one connection available for a chart while scans are in flight.
        if(concurrency>1&&job.priority<100&&active.size>=concurrency-1)continue;const host=hosts.get(job.host)||{next:0,cool:0};hosts.set(job.host,host);const at=Math.max(host.next,host.cool,job.retryAt||0);if(at>now){next=Math.min(next,at);continue;}
        queue.splice(queue.indexOf(job),1);host.next=now+intervalMs;active.add(job);run(job,host);
      }
      if(queue.length&&active.size<concurrency){wake=setTimeout(pump,Math.max(1,(Number.isFinite(next)?next:Date.now()+intervalMs)-Date.now()));}
    }
    async function run(job,host){try{const response=await fetcher(job.url,{cache:'no-store',signal:job.controller.signal});
        if(response.status===429){const raw=response.headers?.get('Retry-After'),seconds=Number(raw);const delay=raw&&Number.isFinite(seconds)?seconds*1000:raw?Date.parse(raw)-Date.now():cooldownMs;
          host.cool=Math.max(host.cool,Date.now()+Math.min(10000,Math.max(cooldownMs,delay||0)));if(job.attempt++<1&&!job.done){active.delete(job);queue.push(job);pump();return;}}
        if(!response.ok){const error=Error(`行情 HTTP ${response.status}`);error.status=response.status;throw error;}
        const value=await response.json();finish(job,null,value);
      }catch(error){finish(job,job.controller.signal.aborted?abortError():error);}}
    function json(url,{signal,owner='foreground',priority=20,timeoutMs=30000}={}){return new Promise((resolve,reject)=>{
      const job={url:String(url),host:new URL(url,globalThis.location?.href||'https://fixture.test').host,signal,owner,priority,resolve,reject,id:++sequence,attempt:0,controller:new AbortController()};
      job.cancel=()=>{job.controller.abort();finish(job,abortError());};
      if(signal?.aborted){reject(abortError());return;}
      signal?.addEventListener('abort',job.cancel,{once:true});job.timer=setTimeout(()=>{job.controller.abort();finish(job,new DOMException('行情排隊或讀取逾時','TimeoutError'));},timeoutMs);
      queue.push(job);pump();});}
    function cancel(owner){for(const job of [...queue,...active])if(job.owner===owner)job.cancel();}
    return Object.freeze({json,cancel,stats:()=>({queued:queue.length,active:active.size}),create:createPublicFeed});
  }
  globalThis.OXPublicFeed=createPublicFeed();
})();

// Share logical refreshes as well as individual REST requests. Leaving one
// tool detaches its callbacks, while other readers keep the refresh alive.
export function createMarketRefreshCache(refresh, { now = Date.now, maxAgeMs = 300000,
  maxPools = 2, abortGraceMs = 300 } = {}) {
  const completed = new Map(), pending = new Map();
  const abortError = () => new DOMException('行情更新已取消', 'AbortError');
  function fresh(value) { const age=now()-Number(value?.requestTime); return value?.scan?.complete === true && value.scan.done === value.scan.total && Number(value.requestTime)>0 && age>=-10000 && age<maxAgeMs; }
  function abandon(job, key) {
    clearTimeout(job.cancelTimer);
    job.cancelTimer=setTimeout(() => {
      if (job.readers.size) return;
      job.controller.abort(); if (pending.get(key) === job) pending.delete(key);
    }, abortGraceMs);
  }
  function read(snapshot, { signal, owner = 'analytics', priority = 20, onPartial = () => {}, onProgress = () => {} } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    const key = snapshot.tickers.map(row => row.symbol).join(','), cached = completed.get(key);
    if (fresh(cached)) return Promise.resolve(cached);
    if (fresh(snapshot)) return Promise.resolve(snapshot);
    completed.delete(key);
    let job = pending.get(key);
    if (!job) {
      job = { controller: new AbortController(), readers: new Set(), transport: { owner, priority }, partial: null, cancelTimer: null };
      pending.set(key, job);
      // Readers attach before work begins, including synchronous test sources.
      job.task = Promise.resolve().then(() => refresh(snapshot, {
        signal: job.controller.signal, transport: job.transport,
        onPartial(value) { job.partial = value; for (const reader of [...job.readers]) reader.notify(value); },
        onProgress(done, total) { for (const reader of [...job.readers]) reader.progress(done, total); }
      })).then(value => {
        if (job.controller.signal.aborted) throw abortError();
        if (!value.scan?.complete || value.scan.done !== value.scan.total || value.scan.total !== snapshot.tickers.length || value.tickers.length !== snapshot.tickers.length || value.tickers.some((row,i)=>row.symbol!==snapshot.tickers[i].symbol)) throw Error('行情更新未涵蓋完整觀察池');
        completed.set(key, value); while (completed.size > maxPools) completed.delete(completed.keys().next().value);
        if (pending.get(key) === job) pending.delete(key);
        for (const reader of [...job.readers]) reader.finish(null, value);
      }).catch(error => {
        if (pending.get(key) === job) pending.delete(key);
        for (const reader of [...job.readers]) reader.finish(error);
      }).finally(() => { clearTimeout(job.cancelTimer); if (pending.get(key) === job) pending.delete(key); });
    }
    clearTimeout(job.cancelTimer);
    if (priority > job.transport.priority) Object.assign(job.transport, { owner, priority });
    return new Promise((resolve, reject) => {
      const reader = {
        finish(error, value) { if (!job.readers.delete(reader)) return; signal?.removeEventListener('abort', cancel); if(error&&!job.readers.size)abandon(job,key); error ? reject(error) : resolve(value); },
        notify(value) { if(job.readers.has(reader))try { onPartial(value); } catch (error) { reader.finish(error); } },
        progress(done, total) { if(job.readers.has(reader))try { onProgress(done, total); } catch (error) { reader.finish(error); } }
      };
      const cancel = () => reader.finish(abortError());
      job.readers.add(reader); signal?.addEventListener('abort', cancel, { once: true });
      if (job.partial) { reader.notify(job.partial); reader.progress(job.partial.scan.done, job.partial.scan.total); }
    });
  }
  return Object.freeze({ refresh: read, stats: () => ({ pending: pending.size, cached: completed.size }) });
}

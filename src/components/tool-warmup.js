// One idle preparation job at a time. Transport, modules and CSS retain their
// existing shared caches; this coordinator never mounts an offscreen tool.
export function createToolWarmup({ jobs, eligible, enabled = () => true, quietMs = 750, now = Date.now,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const states = new Map(jobs.map(job => [job.id, { status: 'waiting', nextAt: 0, failures: 0 }]));
  let timer = null, running = null, disposed = false, quietUntil = now() + quietMs;
  function arm() {
    if (disposed || timer !== null || !enabled()) return;
    timer = schedule(step, quietMs);
  }
  async function step() {
    timer = null;
    if (disposed) return;
    if (running || now() < quietUntil) { arm(); return; }
    const job = jobs.find(job => states.get(job.id).nextAt <= now() && eligible(job));
    if (!job) { arm(); return; }
    const state = states.get(job.id), controller = new AbortController();
    running = { job, controller }; state.status = 'running';
    try {
      await job.run(controller.signal);
      if (controller.signal.aborted) throw new DOMException('預熱已暫停', 'AbortError');
      state.status = 'ready'; state.failures = 0;
      state.nextAt = job.repeatMs ? now() + job.repeatMs : Infinity;
    } catch (error) {
      state.status = error.name === 'AbortError' ? 'waiting' : 'failed';
      if (error.name !== 'AbortError') {
        state.failures++; state.nextAt = state.failures >= 2 ? Infinity : now() + 60000;
      }
    } finally { running = null; arm(); }
  }
  function poke({ interaction = false } = {}) {
    if (interaction) quietUntil = now() + quietMs;
    if (running && (interaction || !eligible(running.job))) running.controller.abort();
    if (!enabled()) { unschedule(timer); timer = null; }
    arm();
  }
  arm();
  return Object.freeze({ poke, stats: () => jobs.map(job => ({ id: job.id, ...states.get(job.id) })),
    destroy() { disposed = true; unschedule(timer); timer = null; running?.controller.abort(); } });
}

import { MARKET_IDS } from "../core/config.js?v=20261004-markets2";

export function createMarketRouter() {
  const modules = new Map();
  let active = null;
  let activation = 0;

  return Object.freeze({
    register(module) {
      if (!module?.id || !MARKET_IDS.includes(module.id)) throw new Error("Invalid OX market module");
      modules.set(module.id, module);
      return module;
    },
    get(id) { return modules.get(id) || null; },
    list() { return [...modules.values()]; },
    async activate(id, context = {}) {
      const next = modules.get(id);
      if (!next) return false;
      const token = ++activation;
      if (active && active !== next) {
        const cleanup = active.deactivate?.(context);
        // Keep synchronous market switches synchronous so an immediate
        // view tap is delivered to the newly selected market.
        if (cleanup && typeof cleanup.then === "function") await cleanup;
      }
      if (token !== activation) return false;
      active = next;
      await next.activate?.(context);
      // Switching away already deactivated this module before the next one
      // mounted. A slow response must not clean up the new owner's shared host.
      return token === activation;
    },
    current() { return active?.id || null; }
  });
}

export const marketRouter = createMarketRouter();

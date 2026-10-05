import { safeJsonParse } from "../core/utils.js?v=20261001-loading1";

export function createStorageService(storage = globalThis.localStorage) {
  const memory = new Map();
  const target = storage || {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key)
  };

  return Object.freeze({
    get(key, fallback = null) {
      try { return target.getItem(key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { target.setItem(key, String(value)); return true; } catch { return false; }
    },
    remove(key) {
      try { target.removeItem(key); return true; } catch { return false; }
    },
    getJson(key, fallback = null) {
      return safeJsonParse(this.get(key), fallback);
    },
    setJson(key, value) {
      return this.set(key, JSON.stringify(value));
    }
  });
}

export const storageService = createStorageService();

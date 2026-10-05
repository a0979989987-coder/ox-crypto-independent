import test from "node:test";
import assert from "node:assert/strict";
import { clamp, formatPercent, safeJsonParse } from "../src/core/utils.js";
import { createEventBus } from "../src/core/events.js";
import { createStorageService } from "../src/services/storage.js";
import { createMarketRouter } from "../src/app/marketRouter.js";

test("core utilities are deterministic", () => {
  assert.equal(clamp(120), 100);
  assert.equal(formatPercent(1.234), "+1.23%");
  assert.deepEqual(safeJsonParse('{"ok":true}'), { ok: true });
});

test("event bus subscribes and unsubscribes", () => {
  const bus = createEventBus();
  let received = null;
  const off = bus.on("tick", value => { received = value; });
  bus.emit("tick", 7);
  assert.equal(received, 7);
  off();
  bus.emit("tick", 8);
  assert.equal(received, 7);
});

test("storage service supports JSON", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const service = createStorageService(storage);
  assert.equal(service.setJson("prefs", { market: "tw" }), true);
  assert.deepEqual(service.getJson("prefs"), { market: "tw" });
});

test("independent router accepts Crypto and rejects unavailable markets", async () => {
  const router = createMarketRouter();
  let calls = 0;
  router.register({ id: "crypto", activate: () => calls++ });
  assert.throws(() => router.register({ id: "tw" }), /Invalid OX market/);
  assert.equal(await router.activate("crypto"), true);
  assert.equal(await router.activate("tw"), false);
  assert.equal(router.current(), "crypto");
  assert.equal(calls, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { cryptoModule } from "../src/markets/crypto/index.js";

test("crypto standard boundary exposes preserved Home Strength and Radar surfaces", () => {
  assert.equal(cryptoModule.id, "crypto");
  assert.equal(cryptoModule.activate({ view: "home" }).surface, "home");
  assert.equal(cryptoModule.view("strength").surface, "strength");
  assert.equal(cryptoModule.refresh().surface, "strength");
  assert.equal(cryptoModule.view("radar").owner, "src/markets/crypto/scanner.js");
});

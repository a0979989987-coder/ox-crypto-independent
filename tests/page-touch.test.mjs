import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('page zoom is blocked while one-finger scrolling remains native', () => {
  const listeners = new Map();
  vm.runInNewContext(readFileSync(new URL('../src/components/navigation/page-touch.js', import.meta.url), 'utf8'), {
    document: { addEventListener(name, handler, options) {
      assert.equal(options.passive, false);
      listeners.set(name, handler);
    } }
  });
  let prevented = 0;
  const event = { cancelable: true, touches: [{}], preventDefault() { prevented++; } };
  listeners.get('touchmove')(event);
  assert.equal(prevented, 0);
  event.touches.push({});
  listeners.get('touchmove')(event);
  assert.equal(prevented, 1);
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) listeners.get(name)(event);
  assert.equal(prevented, 4);
});

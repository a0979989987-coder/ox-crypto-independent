import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const node = (...classes) => ({ matches: selector => classes.some(c => selector.split(',').includes(c)) });

test('page pinch-zoom is allowed; two-finger gestures on charts and fixed controls stay in the app', () => {
  const listeners = new Map();
  vm.runInNewContext(readFileSync(new URL('../src/components/navigation/page-touch.js', import.meta.url), 'utf8'), {
    document: { addEventListener(name, handler, options) {
      assert.equal(options.passive, false);
      listeners.set(name, handler);
    } }
  });
  let prevented = 0;
  const event = (path, touches = 2) => ({ cancelable: true, touches: Array(touches).fill({}), composedPath: () => path, preventDefault() { prevented++; } });
  const article = [node('p'), node('.oxn-root'), node('body')];
  const chart = [node('canvas'), node('#chart'), node('body')];
  listeners.get('touchmove')(event(chart, 1));
  assert.equal(prevented, 0, 'one finger always scrolls');
  listeners.get('touchmove')(event(article));
  assert.equal(prevented, 0, 'reading content can be zoomed');
  listeners.get('touchmove')(event(chart));
  assert.equal(prevented, 1, 'chart pinch belongs to the chart');
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) { listeners.get(name)(event(article)); listeners.get(name)(event([node('.app-dock')])); }
  assert.equal(prevented, 4);
});

test('the viewport no longer disables user zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.doesNotMatch(viewport, /maximum-scale|user-scalable/);
  assert.match(viewport, /width=device-width/);
});

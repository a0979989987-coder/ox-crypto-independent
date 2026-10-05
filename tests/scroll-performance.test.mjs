import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('Safari toolbar resizes do not repeatedly redraw an unchanged chart', () => {
  const source = readFileSync(new URL('../src/app/view-home-theme.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function resizeChartToContainer('), source.indexOf('\nfunction updateChartExpandButton('));
  const sizes = [];
  const container = { clientWidth: 320, clientHeight: 440 };
  const originalRange = { from: 60, to: 110 };
  let range = originalRange;
  const scale = {
    getVisibleLogicalRange: () => range,
    setVisibleLogicalRange: value => { range = value; }
  };
  const state = { chart: {
    timeScale: () => scale,
    resize: (width, height, force) => {
      sizes.push({ width, height, force });
      range = { from: 20, to: 110 };
    }
  } };
  const resize = runInNewContext(`${fn}\nresizeChartToContainer`, {
    state,
    document: { getElementById: () => container },
    requestAnimationFrame() {},
    updateKeyLevelVisualLabels() {}
  });
  resize();
  resize();
  assert.equal(sizes.length, 1);
  assert.equal(sizes[0].width, 320);
  assert.equal(sizes[0].height, 440);
  container.clientHeight = 460;
  resize();
  assert.equal(sizes.at(-1).width, 320);
  assert.equal(sizes.at(-1).height, 460);
  assert.equal(sizes.length, 2);
  resize(true);
  assert.equal(sizes.length, 3, 'focus changes redraw at the final canvas size');
  assert.equal(sizes.at(-1).force, true);
  assert.deepEqual(range, originalRange, 'layout resize preserves the visible candle range');
});

function quickSwitchHarness({desktop=false}={}) {
  const nodes = new Map(), timers = new Map();
  let now = 0, nextTimer = 0;
  function element(id = '') {
    const listeners = new Map(), classes = new Set();
    const attrs = new Map();
    const node = {
      id, dataset: {}, style: {}, listeners, attrs,
      classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); } },
      addEventListener(type, callback, options) { if (!listeners.has(type)) listeners.set(type, new Map()); listeners.get(type).set(callback, options); },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
      emit(type, detail = {}) { for (const fn of [...(listeners.get(type)?.keys() || [])]) fn({ target: node, cancelable: true, preventDefault() {}, stopPropagation() {}, ...detail }); },
      setAttribute: (name, value) => attrs.set(name, value),
      appendChild(child) { nodes.set(child.id, child); },
      querySelectorAll: () => [], querySelector: () => null,
      contains: target => target === node,
      getBoundingClientRect: () => ({ left: 150, right: 225, top: 620, bottom: 695, width: 75, height: 75 }),
      hasPointerCapture: () => false,
      focus() {}
    };
    return node;
  }
  const radar = element('radar'), viewport = element('viewport'), desktopRadar=element('desktop');
  desktopRadar.matches=()=>true;
  const body = element('body'); body.dataset.market = 'crypto';
  viewport.setAttribute('content', 'width=device-width,initial-scale=1');
  const document = Object.assign(element(), {
    body, head: element('head'), readyState: 'complete', hidden: false,
    getElementById: id => nodes.get(id), createElement: () => element(),
    querySelector: selector => selector.includes('viewport') ? viewport : selector.includes('.dock-radar') ? radar : desktop&&selector.includes('.ox-desktop-nav')?desktopRadar:null
  });
  const views = [];
  const window = Object.assign(element(), { innerHeight: 844, switchAppView: v => views.push(v) });
  const setTimer = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; };
  const advance = ms => {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  };
  runInNewContext(readFileSync(new URL('../src/components/navigation/market-quick-switch.js', import.meta.url), 'utf8'), {
    document, window, navigator: {}, performance: { now: () => now },
    localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; }, setItem() {} },
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    setInterval: setTimer, clearInterval: id => timers.delete(id), requestAnimationFrame: fn => fn()
  });
  const start = () => radar.emit('touchstart', { touches: [{ identifier: 1 }], changedTouches: [{ identifier: 1, clientX: 185, clientY: 660 }] });
  const end = () => document.emit('touchend', { changedTouches: [{ identifier: 1, clientX: 185, clientY: 660 }] });
  return { document, window, radar, desktopRadar, viewport, nodes, advance, start, end, views };
}

test('desktop Radar requires 0.25 seconds of continuous hover and cancels when the pointer leaves',()=>{
 const h=quickSwitchHarness({desktop:true});
 h.desktopRadar.emit('pointerenter',{pointerType:'mouse'});h.advance(249);
 assert.notEqual(h.nodes.get('ox-market-quick-switch')?.attrs.get('aria-hidden'),'false');
 h.desktopRadar.emit('pointerleave');h.advance(250);
 assert.notEqual(h.nodes.get('ox-market-quick-switch')?.attrs.get('aria-hidden'),'false');
 h.desktopRadar.emit('pointerenter',{pointerType:'mouse'});h.advance(250);
 assert.equal(h.nodes.get('ox-market-quick-switch').attrs.get('aria-hidden'),'false');
});

test('Radar initialization leaves viewport and page-wide native gestures alone', () => {
  const h = quickSwitchHarness();
  assert.equal(h.viewport.attrs.get('content'), 'width=device-width,initial-scale=1');
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'touchmove', 'touchend', 'touchcancel']) {
    assert.equal(h.document.listeners.get(type)?.size || 0, 0, `${type} must not intercept idle page gestures`);
  }
  const css = h.nodes.get('ox-market-quick-switch-style').textContent;
  assert.doesNotMatch(css, /(?:html|body)\s*[,\{]/, 'market menu must not redefine the page scroll containers');
  assert.doesNotMatch(css, /body\.ox-mqs-dragging\s*\{[^}]*overflow\s*:/, 'a market drag must not replace the page scroll root');
});

test('a held Radar menu persists for three seconds after release without idle touch handlers', () => {
  const h = quickSwitchHarness();
  h.start(); h.advance(420); h.end();
  const menu = h.nodes.get('ox-market-quick-switch');
  assert.equal(menu.attrs.get('aria-hidden'), 'false');
  assert.equal(h.views.length, 0, 'holding must not trigger normal Radar navigation');
  assert.equal(h.document.listeners.get('touchmove')?.size || 0, 0);
  h.advance(2999);
  assert.equal(menu.attrs.get('aria-hidden'), 'false');
  h.advance(171);
  assert.equal(menu.attrs.get('aria-hidden'), 'true');
});

test('cancel, browser blur and pagehide release Radar input before the next page gesture', () => {
  for (const event of ['touchcancel', 'blur', 'pagehide']) {
    const h = quickSwitchHarness(); h.start(); h.advance(420);
    (event === 'touchcancel' ? h.document : h.window).emit(event);
    h.advance(200);
    for (const type of ['touchmove', 'touchend', 'touchcancel']) assert.equal(h.document.listeners.get(type)?.size || 0, 0, `${event}: leaked ${type}`);
    assert.equal(h.document.body.classList.contains('ox-mqs-dragging'), false);
    assert.equal(h.nodes.get('ox-market-quick-switch').attrs.get('aria-hidden'), 'true');
    h.start(); h.end();
    assert.deepEqual(h.views, ['radar'], `${event}: next short tap must work immediately`);
  }
});

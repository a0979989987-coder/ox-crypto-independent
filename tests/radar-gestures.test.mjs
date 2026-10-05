import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
  let now = 0, nextId = 0;
  const timers = new Map();
  function node() {
    const listeners = new Map();
    return {
      hidden: true, offsetWidth: 88, offsetHeight: 152, focused: false,
      style: { setProperty() {} },
      addEventListener(type, fn, options) {
        const entries = listeners.get(type) || [];
        entries.push({ fn, options }); listeners.set(type, entries);
      },
      emit(type, extra = {}) {
        for (const { fn } of listeners.get(type) || []) fn({ type, target: this, preventDefault() {}, stopPropagation() {}, ...extra });
      },
      contains(target) { return target === this; },
      closest() { return null; },
      setAttribute() {},
      focus() { this.focused = true; },
      getBoundingClientRect: () => ({ left: 280, bottom: 160, width: 34 }),
      listeners
    };
  }
  const logo = node(), menu = node(), selected = node(), document = node(), window = node();
  menu.querySelector = () => selected;
  document.querySelector = () => logo;
  document.getElementById = () => menu;
  document.body = { append() {} };
  const state = { currentTab: 'all' };
  runInNewContext(readFileSync(new URL('../src/components/radar/controls.js', import.meta.url), 'utf8'), {
    document, window, state, performance: { now: () => now }, innerWidth: 390, innerHeight: 844,
    syncScannerFilterUI() {}, setScannerTierFilter(tier) { state.currentTab = tier; },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const touch = { identifier: 9, clientX: 295, clientY: 142 };
  return {
    logo, menu, selected, document, window, state,
    start() { logo.emit('touchstart', { touches: [touch], changedTouches: [touch] }); },
    end(type = 'touchend') { document.emit(type, { changedTouches: [touch] }); },
    move(dx) { document.emit('touchmove', { touches: [{ ...touch, clientX: touch.clientX + dx }] }); },
    elapse(ms) { now += ms; },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } }
  };
}

test('held touch survives compatibility pointer cancellation and viewport resize, without moving focus', () => {
  const h = harness(); h.start(); h.advance(1000);
  h.document.emit('pointercancel', { pointerType: 'touch', pointerId: 9 });
  h.window.emit('resize'); h.move(7); h.advance(999);
  assert.equal(h.menu.hidden, true);
  h.advance(1);
  assert.equal(h.menu.hidden, false);
  assert.equal(h.selected.focused, false);
  h.end(); h.window.emit('resize');
  h.logo.emit('click', { detail: 0 });
  assert.equal(h.state.currentTab, 'all', 'release click must be consumed');
  assert.equal(h.menu.hidden, false, 'choices remain available after release');
  h.menu.emit('click', { target: { closest: () => ({ dataset: { radarTier: 't2' } }) } });
  assert.equal(h.state.currentTab, 't2'); assert.equal(h.menu.hidden, true);
});

test('drag, native scrolling, cancellation and multiple fingers cancel pending long press', () => {
  for (const cancel of [h => h.move(20), h => { h.window.scrollY = 50; h.document.emit('scroll'); }, h => h.end('touchcancel'), h => h.document.emit('touchstart', { touches: [{}, {}] })]) {
    const h = harness(); h.start(); h.advance(1000); cancel(h); h.advance(2000);
    assert.equal(h.menu.hidden, true);
    h.logo.emit('click', { detail: 0 }); assert.equal(h.state.currentTab, 'all');
  }
});

test('unrelated scrolling does not cancel hold and touch listeners never block page scrolling', () => {
  const h = harness(); h.start(); h.document.emit('scroll', { target: {} }); h.document.emit('scroll'); h.advance(2000);
  assert.equal(h.menu.hidden, false);
  for (const target of [h.logo, h.document]) for (const [type, entries] of target.listeners) {
    if (type.startsWith('touch')) assert(entries.every(entry => entry.options.passive === true));
  }
});

test('short taps still cycle existing tiers; keyboard can open and dismiss choices', () => {
  const h = harness();
  for (const tier of ['t1', 't2', 't3', 'all']) {
    h.start(); h.advance(100); h.end(); h.logo.emit('click', { target: { closest: () => ({}) } });
    assert.equal(h.state.currentTab, tier);
  }
  h.logo.emit('keydown', { key: 'ArrowDown' });
  assert.equal(h.menu.hidden, false); assert.equal(h.selected.focused, true);
  h.document.emit('keydown', { key: 'Escape' }); assert.equal(h.menu.hidden, true);
});


test('tap on radar opens choices and a delayed hold timer is recovered on release', () => {
  const h = harness();
  h.start(); h.elapse(2100); h.end();
  assert.equal(h.menu.hidden, false, 'release recovers an overdue timer');
  h.logo.emit('click'); assert.equal(h.menu.hidden, false, 'release click cannot close menu');
  h.document.emit('keydown', { key: 'Escape' });
  h.start(); h.advance(100); h.end(); h.logo.emit('click');
  assert.equal(h.menu.hidden, false, 'direct tap also opens the same choices');
  assert.equal(h.state.currentTab, 'all', 'opening choices does not change selection');
});

test('touch pointer events work when a WebView does not provide Touch Events', () => {
  const h = harness();
  h.logo.emit('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, pointerId: 5, clientX: 295, clientY: 142 });
  h.advance(2000);
  assert.equal(h.menu.hidden, false);
  h.document.emit('pointerup', { pointerType: 'touch', pointerId: 5 });
  h.logo.emit('click');
  assert.equal(h.menu.hidden, false); assert.equal(h.state.currentTab, 'all');
});


test('rapid double tap leaves choices open instead of toggling them closed', () => {
  const h = harness();
  for (let tap = 0; tap < 2; tap++) {
    h.start(); h.advance(50); h.end(); h.logo.emit('click', { detail: tap + 1 });
    assert.equal(h.menu.hidden, false);
  }
  h.logo.emit('dblclick');
  assert.equal(h.menu.hidden, false);
  assert.equal(h.state.currentTab, 'all');
  h.document.emit('pointerdown', { target: {} });
  assert.equal(h.menu.hidden, true, 'outside tap still dismisses choices');
});

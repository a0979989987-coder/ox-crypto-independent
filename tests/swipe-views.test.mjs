import test from 'node:test';
import assert from 'node:assert/strict';
import { isSwipe, zoneFor, neighbor, ORDER } from '../src/app/swipe-views.js';

test('a quick flick or a long drag switches; slow short moves and diagonal scrolls do not', () => {
  assert.equal(isSwipe(-70, 5, 150), true, 'quick 70px flick');
  assert.equal(isSwipe(-130, 20, 600), true, 'long slow drag');
  assert.equal(isSwipe(-70, 5, 500), false, 'slow 70px move while reading');
  assert.equal(isSwipe(-50, 0, 80), false, 'too short');
  assert.equal(isSwipe(-130, 100, 300), false, 'mostly a vertical scroll');
  assert.equal(isSwipe(-200, 10, 1200), false, 'held too long');
});

test('the top 35% of the screen moves page tabs and the rest moves the dock', () => {
  assert.equal(zoneFor(100, 844), 'tabs');
  assert.equal(zoneFor(295, 844), 'tabs');
  assert.equal(zoneFor(296, 844), 'dock');
  assert.equal(zoneFor(700, 844), 'dock');
});

test('dock swipes follow 首頁 → 行情 → 畫板 → 型態 → 資訊 and stop at the ends', () => {
  assert.deepEqual(ORDER, ['home', 'strength', 'radar', 'pattern', 'data']);
  assert.equal(neighbor('radar', 1), 'pattern');
  assert.equal(neighbor('radar', -1), 'strength');
  assert.equal(neighbor('pattern', 1), 'data');
  assert.equal(neighbor('data', 1), null);
  assert.equal(neighbor('home', -1), null);
  assert.equal(neighbor('media', 1), null, 'pages outside the dock do not swipe');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { storePatternSession } from '../src/markets/crypto/patterns/view.js';

test('new US snapshot sessions release old candle sets without dropping Crypto or Taiwan', () => {
  const sessions = new Map();
  const crypto = { entries: new Map([['BTC:4H', { candles: [1] }]]) };
  const taiwan = { entries: new Map([['2330:1D', { candles: [2] }]]) };
  storePatternSession(sessions, 'crypto', 'crypto', crypto);
  storePatternSession(sessions, 'tw', 'tw', taiwan);
  for (let revision = 1; revision <= 12; revision++)
    storePatternSession(sessions, 'test-source', `private-${revision}`, { entries: new Map([['TEST:1D', { revision }]]) });
  assert.deepEqual([...sessions.keys()], ['crypto', 'tw', 'private-11', 'private-12']);
  assert.equal(sessions.get('crypto'), crypto);
  assert.equal(sessions.get('tw'), taiwan);
  assert.equal(sessions.get('private-12').entries.get('TEST:1D').revision, 12);
});

test('revisited scoped session is retained and another market cannot evict it', () => {
  const sessions = new Map();
  for (const key of ['A', 'B', 'A', 'C']) storePatternSession(sessions, 'test-source', key, { key });
  assert.deepEqual([...sessions.keys()], ['A', 'C']);
  for (const key of ['D', 'E', 'F']) storePatternSession(sessions, 'another', key, { key });
  assert.deepEqual([...sessions.keys()], ['A', 'C', 'E', 'F']);
});

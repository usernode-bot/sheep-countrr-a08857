import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore } from '../public/state.js';

test('a tap persists the run values and the snapshot in one write', () => {
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem: () => { writes += 1; },
  };
  const original = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const store = new StateStore({ userId: 'test' });
    store.startRound(1, { silent: true });
    writes = 0;
    const result = store.tapSheep(0);
    assert.equal(result.outcome, 'counted');
    assert.equal(writes, 1, 'one setItem per tap');
  } finally {
    globalThis.localStorage = original;
  }
});

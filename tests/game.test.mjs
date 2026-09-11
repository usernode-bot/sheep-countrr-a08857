import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore } from '../public/state.js';
import { wanderOffset } from '../public/movement.js';
import { buildSheepBodyGeometry, buildEyeGeometry } from '../public/scene.js';

test('out-of-order taps keep badge order after restoring a round', () => {
  const store = new StateStore({ staticMode: true });
  assert.equal(store.countSheep(2), 1);
  assert.equal(store.countSheep(0), 2);
  assert.equal(store.countSheep(2), null);
  assert.equal(store.countSheep(-1), null);
  assert.equal(store.countSheep(3), null);
  assert.deepEqual(store.state.counted, [2, 0]);
  const restored = JSON.parse(JSON.stringify(store.state));
  assert.equal(restored.counted.indexOf(2) + 1, 1);
});

test('rounds gradually grow from three to a bounded ten sheep', () => {
  const store = new StateStore({ staticMode: true });
  assert.equal(store.state.herdSize, 3);
  for (let round = 0; round < 14; round++) {
    for (let i = 0; i < store.state.herdSize; i++) store.countSheep(i);
    assert.ok(store.isComplete());
    const before = store.state.herdSize;
    store.startNewRound({ carryHerdGrowth: true });
    assert.equal(store.state.herdSize, Math.min(before + 1, 10));
    assert.equal(store.state.count, 0);
    assert.deepEqual(store.state.counted, []);
  }
});

test('wandering stays bounded, smooth, deterministic, and varies between sheep', () => {
  for (let herdSize = 3; herdSize <= 10; herdSize++) {
    for (let i = 0; i < herdSize; i++) {
      for (let t = 0; t < 180; t += 0.5) {
        const point = wanderOffset(42, i, herdSize, t);
        const next = wanderOffset(42, i, herdSize, t + 1/30);
        assert.ok(Math.abs(point.x) <= .21 && Math.abs(point.z) <= .21);
        assert.ok(Math.hypot(next.x - point.x, next.z - point.z) < .004);
        assert.deepEqual(point, wanderOffset(42, i, herdSize, t));
      }
    }
  }
  assert.notDeepEqual(wanderOffset(42, 1, 10, 1), wanderOffset(42, 2, 10, 1));
});

test('all plush sheep variants have finite geometry and stay inside the picking envelope', () => {
  for (const geo of [0,1,2].map(buildSheepBodyGeometry).concat(buildEyeGeometry())) {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    assert.ok(box.min.x >= -.9 && box.max.x <= .9);
    assert.ok(box.max.y <= 1.3 && box.min.y >= -.1);
    for (const attr of Object.values(geo.attributes)) assert.ok(attr.array.every(Number.isFinite));
    geo.dispose();
  }
});

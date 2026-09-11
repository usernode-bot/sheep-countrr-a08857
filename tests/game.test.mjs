import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore } from '../public/state.js';
import { createRoamingFlock, roamingTuning } from '../public/movement.js';
import { layoutPositions } from '../public/layout.js';
import { fitBirdCamera, meadowRegion, BIRD_ELEVATION } from '../public/camera.js';
import * as THREE from 'three';
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

const makeFlock = (seed = 42, count = 10) => {
  const region = meadowRegion(count, true);
  const positions = layoutPositions(seed, count, { ...region, minSeparation: 1.45 });
  return { simulation: createRoamingFlock(seed, positions, region), region, positions };
};

test('roaming crosses the field, stays bounded and keeps sheep apart over ten minutes', () => {
  for (const seed of [42, 47, 103]) {
    const { simulation, region, positions } = makeFlock(seed);
    let maxTravel = 0;
    for (let i = 0; i < 600 * 30; i++) {
      const before = simulation.agents.map(s => ({ x:s.x,z:s.z,heading:s.heading }));
      simulation.update(1/30);
      simulation.agents.forEach((s, j) => {
        assert.ok(Math.abs(s.x) <= region.width/2 && Math.abs(s.z) <= region.depth/2);
        assert.ok(Number.isFinite(s.heading));
        assert.ok(Math.hypot(s.x - before[j].x, s.z - before[j].z) <= simulation.tuning.speed/30 + 1e-8);
        assert.ok(Math.abs(s.heading - before[j].heading) <= simulation.tuning.turnRate/30 + 1e-8);
        for (const other of simulation.agents.slice(j + 1)) assert.ok(Math.hypot(s.x - other.x, s.z - other.z) >= 1.2799);
        maxTravel = Math.max(maxTravel, Math.hypot(s.x - positions[j].x, s.z - positions[j].z));
      });
    }
    assert.ok(maxTravel > Math.min(region.width, region.depth) * .7, 'sheep should explore the field, not orbit their starting point');
    assert.ok(simulation.agents.every(s => s.distance > 12), 'every sheep should travel');
  }
});

test('seeded paths agree at 30 and 60 fps; counted sheep stop', () => {
  const a = makeFlock().simulation, b = makeFlock().simulation;
  for (let i=0; i<1800; i++) { a.update(1/30); b.update(1/60); b.update(1/60); }
  assert.deepEqual(a.agents.map(s=>[s.x,s.z]), b.agents.map(s=>[s.x,s.z]));
  a.count(2);
  const stopped = { x:a.agents[2].x,z:a.agents[2].z,heading:a.agents[2].heading };
  for (let i=0; i<1800; i++) a.update(1/30);
  assert.deepEqual({ x:a.agents[2].x,z:a.agents[2].z,heading:a.agents[2].heading }, stopped);
  assert.equal(a.agents[2].speed, 0);
});

test('larger flocks have more varied movement while speed stays gentle', () => {
  const small=roamingTuning(3), large=roamingTuning(10);
  assert.ok(large.speed > small.speed && large.speed < .8);
  assert.ok(large.meander > small.meander);
  assert.ok(large.retargetSeconds < small.retargetSeconds);
  assert.ok(large.pauseChance < small.pauseChance);
  assert.deepEqual(roamingTuning(999), large);
});

test('bird-eye camera contains every roaming edge at mobile and desktop sizes', () => {
  assert.ok(BIRD_ELEVATION >= Math.PI/3);
  for (const [width,height] of [[390,844],[844,390],[1280,720],[320,568]]) {
    for (const n of [1,3,5,10]) {
      const camera = new THREE.PerspectiveCamera();
      const portrait = height >= width;
      const overlay = {bottom:120,right:width>height && height<=520 ? 130 : width/2+70};
      const {bounds,corners}=fitBirdCamera(camera,{width,height,region:meadowRegion(n,portrait),overlay});
      for (const corner of corners) {
        const projected = corner.clone().project(camera);
        assert.ok(projected.x >= bounds.left && projected.x <= bounds.right);
        assert.ok(projected.y >= bounds.bottom && projected.y <= bounds.top);
      }
    }
  }
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

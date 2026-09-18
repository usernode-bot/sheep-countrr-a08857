import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore } from '../public/state.js';
import { createRoamingFlock, roamingTuning } from '../public/movement.js';
import { layoutPositions, NUMBER_COLORS } from '../public/layout.js';
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

test('a field that never ticks stays exactly where it was laid out', () => {
  // Reduced motion never calls update(); a stray zero/invalid frame must be
  // just as inert, so the stationary meadow can never drift.
  const { simulation, positions } = makeFlock(47, 6);
  for (const dt of [0, -1 / 60, NaN, undefined]) simulation.update(dt);
  simulation.agents.forEach((s, i) => {
    assert.equal(s.x, positions[i].x);
    assert.equal(s.z, positions[i].z);
    assert.equal(s.distance, 0);
  });
});

test('every roaming sheep stays separately tappable after minutes of movement', () => {
  const count = 10;
  const { simulation, region } = makeFlock(47, count);
  const camera = new THREE.PerspectiveCamera();
  fitBirdCamera(camera, { width: 390, height: 844, region, overlay: { bottom: 150, right: 0 } });
  const picks = simulation.agents.map(() =>
    new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial()));
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  for (let frame = 0; frame < 60 * 60 * 3; frame++) {
    simulation.update(1 / 60);
    if (frame % 600) continue;
    picks.forEach((pick, i) => {
      // Same envelope scene.js gives each sheep: a sphere at chest height.
      pick.position.set(simulation.agents[i].x, 0.62, simulation.agents[i].z);
      pick.updateMatrixWorld(true);
    });
    picks.forEach((pick, i) => {
      const screen = pick.position.clone().project(camera);
      assert.ok(Math.abs(screen.x) <= 1 && Math.abs(screen.y) <= 1, 'sheep tapped off-screen');
      pointer.set(screen.x, screen.y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(picks, false);
      assert.ok(hits.length, `sheep ${i} has no pick target at frame ${frame}`);
      // scene.js counts hits[0]; aiming at a sheep must never count another.
      assert.equal(picks.indexOf(hits[0].object), i, `tap on sheep ${i} would count another`);
    });
  }
  picks.forEach((p) => { p.geometry.dispose(); p.material.dispose(); });
});

test('counted sheep keep their number and cannot be counted twice', () => {
  const store = new StateStore({ staticMode: true });
  store.setHerdSize(5);
  const numbers = new Map();
  [3, 0, 4].forEach((idx) => numbers.set(idx, store.countSheep(idx)));
  assert.deepEqual([...numbers.values()], [1, 2, 3]);
  // Re-tapping a counted sheep is a no-op; the badge it already wears stands.
  for (const idx of numbers.keys()) assert.equal(store.countSheep(idx), null);
  for (const [idx, number] of numbers) {
    assert.equal(store.state.counted.indexOf(idx) + 1, number);
    assert.equal(NUMBER_COLORS[(number - 1) % NUMBER_COLORS.length], NUMBER_COLORS[number - 1]);
  }
  assert.equal(store.state.count, 3);
});

test('the DOM fallback numbers and colors sheep exactly like the 3D pasture', async () => {
  const dom = installMinimalDom();
  try {
    const { createFallbackRenderer } = await import('../public/fallback.js');
    const container = dom.createElement('div');
    const tapped = [];
    const renderer = createFallbackRenderer({ container, onTap: (i) => tapped.push(i), reducedMotion: false });
    const store = new StateStore({ staticMode: true });
    store.setHerdSize(4);
    renderer.setState(store.state);

    const cards = dom.findAll(container, (el) => el.className === 'sheep-card');
    assert.equal(cards.length, 4);
    cards[2].listeners.click.forEach((fn) => fn());
    assert.deepEqual(tapped, [2]);

    [2, 0].forEach((idx) => renderer.countSheep(idx, store.countSheep(idx)));
    const badge = (card) => dom.findAll(card, (el) => el.className === 'sheep-card-badge')[0];
    assert.equal(badge(cards[2]).textContent, '1');
    assert.equal(badge(cards[0]).textContent, '2');
    assert.equal(cards[2].style.props['--ribbon'], NUMBER_COLORS[0]);
    assert.equal(cards[0].style.props['--ribbon'], NUMBER_COLORS[1]);
    assert.ok(cards[2].classes.has('is-counted') && !cards[1].classes.has('is-counted'));
    assert.equal(badge(cards[1]).hidden, true);
  } finally {
    dom.restore();
  }
});

// A pocket-sized stand-in for the handful of DOM calls fallback.js makes,
// so the card renderer is covered without pulling in a browser environment.
function installMinimalDom() {
  const previous = globalThis.document;
  const parse = (html, make) => {
    // fallback.js only ever injects its fixed SVG plus one badge span.
    const out = [];
    for (const match of html.matchAll(/<span class="([^"]+)"([^>]*)>/g)) {
      const el = make('span');
      el.className = match[1];
      el.hidden = /\bhidden\b/.test(match[2]);
      out.push(el);
    }
    return out;
  };
  const createElement = (tag) => {
    const el = {
      tagName: tag, className: '', textContent: '', hidden: false, tabIndex: 0,
      children: [], dataset: {}, attributes: {}, listeners: {},
      classes: new Set(), style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
      classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) },
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      remove() {},
      set innerHTML(html) { this.children = html ? parse(html, createElement) : []; },
      get innerHTML() { return ''; },
      querySelector(selector) {
        return findAll(this, (node) => node.className === selector.replace('.', ''))[0] || null;
      },
    };
    return el;
  };
  const findAll = (root, predicate) => root.children.flatMap(
    (child) => (predicate(child) ? [child] : []).concat(findAll(child, predicate)));
  globalThis.document = { createElement };
  return {
    createElement, findAll,
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

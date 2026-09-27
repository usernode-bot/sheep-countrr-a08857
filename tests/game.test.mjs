import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StateStore,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
  ENDED_MISSED,
  ENDED_WOLF,
} from '../public/state.js';
import {
  MAX_SHEEP,
  motionForRound,
  paceLine,
  roamRadius,
  roundIntroText,
  roundSeed,
  sheepForRound,
  sheepPhrase,
  normalizeRound,
  successMessage,
  WOLF_BONUS,
  wolfChance,
  wolfDisguiseTier,
  wolfIndexForRound,
} from '../public/rounds.js';
import { wanderOffset } from '../public/movement.js';
import { buildSheepBodyGeometry, buildEyeGeometry } from '../public/scene.js';

// A store that behaves exactly like a /?round=N deep link: fixed seeds, and
// no localStorage or network to reach for from a test process.
function newStore() {
  return new StateStore({ ephemeral: true, deterministic: true });
}

test('round 1 is a single sheep and it stands perfectly still', () => {
  assert.equal(sheepForRound(1), 1);
  const m = motionForRound(1);
  assert.equal(m.speed, 0);
  assert.equal(m.radius, 0);
  assert.equal(roamRadius(1), 0);
  for (let t = 0; t < 60; t += 0.25) {
    assert.deepEqual(wanderOffset(roundSeed(1), 0, 1, t, m), { x: 0, z: 0, turn: 0 });
  }
});

test('each round adds one or two sheep up to a bounded flock', () => {
  assert.equal(sheepForRound(1), 1);
  let prev = 1;
  for (let round = 2; round <= 30; round++) {
    const n = sheepForRound(round);
    const added = n - prev;
    assert.ok(n <= MAX_SHEEP, `round ${round} wants ${n} sheep`);
    assert.ok(added >= 0 && added <= 2, `round ${round} added ${added} sheep`);
    if (prev < MAX_SHEEP) assert.ok(added >= 1, `round ${round} did not grow`);
    prev = n;
  }
  assert.equal(sheepForRound(9), MAX_SHEEP);
});

test('rounds get faster and more erratic, and never tame down', () => {
  let prev = motionForRound(1);
  for (let round = 2; round <= 24; round++) {
    const m = motionForRound(round);
    assert.ok(m.speed >= prev.speed, `round ${round} slowed down`);
    assert.ok(m.radius >= prev.radius, `round ${round} roams less`);
    assert.ok(m.bounceMix >= prev.bounceMix, `round ${round} bounces less`);
    assert.ok(m.jitterAmp >= prev.jitterAmp, `round ${round} jitters less`);
    assert.ok(m.chaos >= prev.chaos, `round ${round} is calmer`);
    prev = m;
  }
  // The late rounds are meaningfully harder than the first moving one.
  assert.ok(motionForRound(12).speed > motionForRound(2).speed * 3);
  assert.ok(motionForRound(12).jitterAmp > 0.12);
});

test('wandering is deterministic, bounded by roamRadius, and never teleports', () => {
  for (let round = 1; round <= 14; round++) {
    const m = motionForRound(round);
    const bound = roamRadius(round);
    const seed = roundSeed(round);
    const herd = sheepForRound(round);
    for (let i = 0; i < herd; i++) {
      let last = wanderOffset(seed, i, herd, 0, m);
      for (let t = 0; t <= 120; t += 1 / 30) {
        const point = wanderOffset(seed, i, herd, t, m);
        // roamRadius is what scene.js pads the camera by, so it has to be a
        // true upper bound or a late-round sheep can wander out of frame.
        assert.ok(
          Math.hypot(point.x, point.z) <= bound + 1e-9,
          `round ${round} sheep ${i} reached ${Math.hypot(point.x, point.z)} > ${bound}`
        );
        // Continuous motion: a sheep is followable by eye, not warping.
        assert.ok(
          Math.hypot(point.x - last.x, point.z - last.z) < 0.35,
          `round ${round} sheep ${i} jumped at t=${t}`
        );
        assert.deepEqual(point, wanderOffset(seed, i, herd, t, m));
        last = point;
      }
    }
  }
  const m = motionForRound(10);
  assert.notDeepEqual(wanderOffset(7, 1, 12, 1, m), wanderOffset(7, 2, 12, 1, m));
});

test('a deep-link round is reproducible and never grows past the cap', () => {
  assert.equal(roundSeed(5), roundSeed(5));
  assert.notEqual(roundSeed(5), roundSeed(6));
  assert.equal(normalizeRound('5'), 5);
  assert.equal(normalizeRound('0'), 1);
  assert.equal(normalizeRound('nope'), 1);
  assert.equal(normalizeRound(-3), 1);

  const a = newStore();
  const b = newStore();
  a.startRound(5, { silent: true });
  b.startRound('5', { silent: true });
  assert.equal(a.state.seed, b.state.seed);
  assert.equal(a.state.sheepCount, sheepForRound(5));
  assert.equal(a.state.phase, COUNTING);
});

test('counting every sheep passes the round and advances', () => {
  const store = newStore();
  store.startRound(3, { silent: true });
  const n = store.state.sheepCount;
  for (let i = 0; i < n; i++) {
    assert.deepEqual(store.tapSheep(i), { outcome: 'counted', number: i + 1 });
  }
  assert.ok(store.isComplete());
  assert.deepEqual(store.submitCount(), { outcome: 'passed', round: 3 });
  assert.equal(store.state.phase, ROUND_PASSED);

  store.nextRound();
  assert.equal(store.state.round, 4);
  assert.equal(store.state.sheepCount, sheepForRound(4));
  assert.equal(store.state.count, 0);
  assert.deepEqual(store.state.counted, []);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.bestRound, 4);
});

test('tapping an already-counted sheep ends the run', () => {
  const store = newStore();
  store.startRound(4, { silent: true });
  store.tapSheep(2);
  assert.deepEqual(store.tapSheep(2), { outcome: 'doubleTap' });
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_DOUBLE_TAP);
  assert.equal(store.state.round, 4);
  // A dead run accepts nothing more.
  assert.deepEqual(store.tapSheep(0), { outcome: 'ignored' });
  assert.deepEqual(store.submitCount(), { outcome: 'ignored' });
});

test('submitting a short count ends the run on the round reached', () => {
  const store = newStore();
  store.startRound(6, { silent: true });
  store.tapSheep(0);
  assert.deepEqual(store.submitCount(), { outcome: 'missed', round: 6 });
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_MISSED);
  assert.equal(store.state.count, 1);
});

test('out-of-range taps are ignored rather than ending the run', () => {
  const store = newStore();
  store.startRound(2, { silent: true });
  assert.deepEqual(store.tapSheep(-1), { outcome: 'ignored' });
  assert.deepEqual(store.tapSheep(store.state.sheepCount), { outcome: 'ignored' });
  assert.deepEqual(store.tapSheep(1.5), { outcome: 'ignored' });
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.count, 0);
});

test('restarting returns to round 1 and keeps the best round reached', () => {
  const store = newStore();
  store.startRound(7, { silent: true });
  store.endRun(ENDED_MISSED);
  store.restartRun();
  assert.equal(store.state.round, 1);
  assert.equal(store.state.sheepCount, 1);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.endedBy, null);
  assert.equal(store.state.bestRound, 7);
});

test('taps counted in any order keep their tap-order numbering', () => {
  const store = newStore();
  store.startRound(5, { silent: true });
  assert.equal(store.tapSheep(4).number, 1);
  assert.equal(store.tapSheep(0).number, 2);
  assert.equal(store.tapSheep(2).number, 3);
  assert.deepEqual(store.state.counted, [4, 0, 2]);
  assert.equal(store.state.count, 3);
  assert.equal(store.state.totalCounted, 3);
});

test('all plush sheep and wolf variants have finite geometry and stay inside the picking envelope', () => {
  for (const geo of [0, 1, 2].map(buildSheepBodyGeometry).concat(buildEyeGeometry())) {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    assert.ok(box.min.x >= -.9 && box.max.x <= .9);
    assert.ok(box.max.y <= 1.3 && box.min.y >= -.1);
    for (const attr of Object.values(geo.attributes)) assert.ok(attr.array.every(Number.isFinite));
    geo.dispose();
  }
});

test('wolfChance starts at round 2, climbs monotonically and caps', () => {
  assert.equal(wolfChance(1), 0);
  assert.equal(wolfChance(2), 0.15);
  let prev = 0;
  for (let round = 2; round <= 24; round++) {
    const c = wolfChance(round);
    assert.ok(c >= prev, `round ${round} chance dropped`);
    assert.ok(c <= 0.7, `round ${round} chance over cap`);
    prev = c;
  }
  assert.equal(wolfChance(13), 0.7);
  assert.equal(wolfChance(24), 0.7);
});

test('wolfIndexForRound is deterministic, in range, and null on no-wolf rounds', () => {
  assert.equal(wolfIndexForRound(1, roundSeed(1), sheepForRound(1)), null);
  const n = sheepForRound(5);
  const a = wolfIndexForRound(5, roundSeed(5), n);
  const b = wolfIndexForRound(5, roundSeed(5), n);
  assert.deepEqual(a, b);
  if (a !== null) {
    assert.ok(Number.isInteger(a) && a >= 0 && a < n, `index ${a} out of range`);
  }
  // The draw itself decides: across many rounds both outcomes occur.
  const draws = new Set();
  for (let round = 2; round <= 24; round++) {
    draws.add(wolfIndexForRound(round, roundSeed(round), sheepForRound(round)) === null ? 'none' : 'wolf');
  }
  assert.ok(draws.has('wolf'), 'no round ever drew a wolf');
  assert.ok(draws.has('none'), 'no round ever drew a plain flock');
});

test('wolfDisguiseTier never regresses and follows the ramp', () => {
  assert.equal(wolfDisguiseTier(1), 1);
  assert.equal(wolfDisguiseTier(2), 1);
  assert.equal(wolfDisguiseTier(4), 1);
  assert.equal(wolfDisguiseTier(5), 2);
  assert.equal(wolfDisguiseTier(7), 2);
  assert.equal(wolfDisguiseTier(8), 3);
  assert.equal(wolfDisguiseTier(24), 3);
  let prev = 1;
  for (let round = 2; round <= 24; round++) {
    const t = wolfDisguiseTier(round);
    assert.ok(t >= prev, `round ${round} tier regressed`);
    prev = t;
  }
});

test('a forced wolf round ends on the wolf tap and accepts nothing after', () => {
  const store = newStore();
  store.startRound(5, { silent: true });
  const wolfIndex = store.state.sheepCount - 1;
  store.state = { ...store.state, wolfIndex };
  assert.deepEqual(store.tapSheep(wolfIndex), { outcome: 'wolfTap' });
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_WOLF);
  assert.equal(store.state.count, 0);
  assert.equal(store.state.totalCounted, 0);
  assert.deepEqual(store.tapSheep(0), { outcome: 'ignored' });
  assert.deepEqual(store.submitCount(), { outcome: 'ignored' });
});

test('completing a wolf round passes, grows the streak and pays the bonus', () => {
  const store = newStore();
  store.startRound(5, { silent: true });
  const wolfIndex = 2;
  store.state = { ...store.state, wolfIndex };
  const n = store.state.sheepCount;
  const realSheep = [...Array(n).keys()].filter((i) => i !== wolfIndex);
  for (const i of realSheep) {
    assert.equal(store.tapSheep(i).outcome, 'counted');
  }
  assert.ok(store.isComplete());
  assert.deepEqual(store.submitCount(), { outcome: 'passed', round: 5 });
  assert.equal(store.state.safeStreak, 1);
  assert.equal(store.state.bestSafeStreak, 1);
  assert.equal(store.state.bonusCounted, WOLF_BONUS);
  assert.equal(store.state.totalCounted, n - 1 + WOLF_BONUS);
  // The bonus rides its own accumulator, so one sync carries both.
  assert.equal(store.unsyncedBonus, WOLF_BONUS);
  assert.equal(store.unsyncedTaps, n - 1);
});

test('a missed run resets the current streak but keeps the best', () => {
  const store = newStore();
  store.startRound(5, { silent: true });
  store.state = { ...store.state, wolfIndex: 2 };
  for (const i of [0, 1, 3, 4, 5, 6]) store.tapSheep(i);
  store.submitCount();
  assert.equal(store.state.safeStreak, 1);
  store.nextRound();
  assert.equal(store.state.safeStreak, 1, 'a plain round keeps the streak');
  store.state = { ...store.state, wolfIndex: 3 };
  for (const i of [0, 1, 2, 4, 5, 6, 7]) store.tapSheep(i);
  store.submitCount();
  assert.equal(store.state.safeStreak, 2);
  assert.equal(store.state.bestSafeStreak, 2);
  store.endRun(ENDED_MISSED);
  assert.equal(store.state.safeStreak, 2, 'the run-over card still shows the run streak');
  store.restartRun();
  assert.equal(store.state.safeStreak, 0);
  assert.equal(store.state.bestSafeStreak, 2);
});

test('the wolf copy carries no em dash', () => {
  const strings = [
    'The wolf tricked you.',
    'You dodged 1 wolf round in a row.',
    'You dodged 3 wolf rounds in a row.',
    'One of the flock might be a wolf. Counting it ends the run.',
    'Best safe streak',
    'Bonus sheep',
  ];
  for (const s of strings) assert.ok(!s.includes('\u2014'), s);
});

test('the pre-round briefing names the round, its flock, and how it moves', () => {
  // Exact wording a first-time player reads on round 1.
  assert.equal(roundIntroText(1), 'Round 1 has 1 sheep. This one stands still.');
  // A run that starts on a later round names the bigger, faster flock.
  const late = roundIntroText(8);
  assert.ok(late.startsWith(`Round 8 has ${sheepPhrase(sheepForRound(8))}. `), late);
  assert.ok(late.endsWith(paceLine(8)), late);
  assert.notEqual(paceLine(8), 'This one stands still.');
  // The flock size and pace track the same pure functions the renderers use.
  for (const round of [1, 2, 4, 5, 8, 12]) {
    const text = roundIntroText(round);
    assert.ok(text.includes(sheepPhrase(sheepForRound(round))), `round ${round}: ${text}`);
    assert.ok(text.includes(paceLine(round)), `round ${round}: ${text}`);
  }
  // No em dashes in anything the player reads.
  for (const round of [1, 5, 12]) {
    assert.ok(!roundIntroText(round).includes('\u2014'), `em dash in round ${round}`);
  }
  assert.equal(roundIntroText('3'), 'Round 3 has ' + sheepPhrase(sheepForRound(3)) + '. ' + paceLine(3));
  assert.equal(roundIntroText(0), 'Round 1 has 1 sheep. This one stands still.');
});

test('the success message praises the player and names no em dash', () => {
  assert.equal(successMessage(), 'Great job! You found all the sheep.');
  assert.ok(!successMessage().includes('\u2014'), 'em dash in success message');
  // Same wording the round-complete card renders, so the copy helper and the
  // visible headline cannot drift apart.
  assert.ok(successMessage().startsWith('Great job!'), successMessage());
});

test('sheep phrases and pace lines read naturally at their edges', () => {
  assert.equal(sheepPhrase(1), '1 sheep');
  assert.equal(sheepPhrase(7), '7 sheep');
  assert.equal(sheepPhrase(12), '12 sheep');
  assert.equal(paceLine(1), 'This one stands still.');
  assert.ok(paceLine(2).length > 0);
  assert.ok(paceLine(12).length > 0);
  for (const line of [paceLine(1), paceLine(2), paceLine(5), paceLine(8), paceLine(12)]) {
    assert.ok(!line.includes('\u2014'), line);
  }
});

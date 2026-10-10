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
  ENDED_TIME_UP,
  LOAD_REMOTE_TIMEOUT_MS,
} from '../public/state.js';
import {
  CALM_SPEED,
  MAX_SHEEP,
  NEW_PLAYER_DIFFICULTY,
  introRuleText,
  isCalmLevel,
  advanceStreak,
  calmMotion,
  dayDistance,
  localDayKey,
  motionForRound,
  normalizeCalm,
  paceLine,
  roamRadius,
  roundCompleteTitle,
  roundIntroText,
  roundBadgeText,
  roundSeed,
  SPEED_ROUND_SECONDS,
  speedRoundClock,
  weeklyScoreLabel,
  sheepForRound,
  sheepPhrase,
  normalizeRound,
  successMessage,
  WOLF_BONUS,
  wolfChance,
  wolfCueText,
  wolfDisguiseTier,
  wolfIndexForRound,
} from '../public/rounds.js';
import { readFileSync } from 'node:fs';
import { wanderOffset } from '../public/movement.js';
import { weekStartUtc, sortScoreRows } from '../public/leaderboard.js';
import { nearestForgivenTap, sheepName, TAP_FORGIVE_PX } from '../public/layout.js';
import { buildSheepBodyGeometry, buildEyeGeometry } from '../public/scene.js';
import { isSoundEnabled, setSoundEnabled } from '../public/sound.js';
import { bestRoundsCsv, weeklyHistoryCsv } from '../public/export.js';

// A store that behaves exactly like a /?round=N deep link: fixed seeds, and
// no localStorage or network to reach for from a test process.
function newStore(recorded) {
  const recordedRuns = [];
  const store = new StateStore({
    ephemeral: true,
    deterministic: true,
    onRecordRun: recorded ? (round) => recordedRuns.push(round) : undefined,
  });
  return { store, recordedRuns };
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

test('the round badge names the round and the ladder length', () => {
  // The ladder has nine rungs, and the badge says so until the top.
  assert.equal(roundBadgeText(1), 'Round 1 of 9');
  assert.equal(roundBadgeText(8), 'Round 8 of 9');
  // At the top there is no further rung to name, so the suffix drops.
  assert.equal(roundBadgeText(9), 'Round 9');
  assert.equal(roundBadgeText(10), 'Round 10');
  // A Speed Round keeps its mode prefix on every rung.
  assert.equal(roundBadgeText(1, true), 'Speed round 1 of 9');
  assert.equal(roundBadgeText(9, true), 'Speed round 9');
  // Deep-link normalization: a bogus round reads as round 1.
  assert.equal(roundBadgeText('bogus'), 'Round 1 of 9');
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

test('name labels are playful, deterministic and drift by seed', () => {
  // The same sheep in the same round is always named the same, so the 3D
  // scene, the DOM cards and the a11y mirror cannot disagree.
  for (const seed of [roundSeed(1), roundSeed(5), roundSeed(9)]) {
    for (let i = 0; i < 12; i++) {
      assert.equal(sheepName(seed, i), sheepName(seed, i));
    }
  }
  // A different round shuffles which sheep gets which name.
  assert.notEqual(sheepName(roundSeed(1), 0), sheepName(roundSeed(3), 0));
  // Hostile inputs read as slot 0 of seed 0 rather than crashing.
  assert.equal(typeof sheepName(-1, 0), 'string');
  assert.equal(sheepName('x', 'y'), sheepName(0, 0));
  // A flock of twelve never repeats a name within one round.
  for (const seed of [roundSeed(9), 424242]) {
    const names = new Set(Array.from({ length: 12 }, (_, i) => sheepName(seed, i)));
    assert.equal(names.size, 12, `seed ${seed} repeats a name`);
  }
  // No em dashes in anything a player reads.
  for (const name of Array.from({ length: 24 }, (_, i) => sheepName(roundSeed(4) + i, i))) {
    assert.ok(!name.includes('\u2014'), name);
  }
});

test('a near miss counts the closest uncounted sheep', () => {
  // A fingertip lands just off a sheep's edge: it still counts that sheep.
  const single = [{ index: 0, x: 100, y: 100, r: 20, eligible: true }];
  assert.equal(nearestForgivenTap(single, 140, 100), 0);
  assert.equal(nearestForgivenTap(single, 118, 130), 0);
  // Of two eligible sheep, the one whose edge is nearest the tap wins.
  const pair = [
    { index: 0, x: 100, y: 100, r: 20, eligible: true },
    { index: 1, x: 220, y: 100, r: 20, eligible: true },
  ];
  assert.equal(nearestForgivenTap(pair, 145, 100), 0);
  assert.equal(nearestForgivenTap(pair, 175, 100), 1);
  // The forgiveness distance is a fingertip, not a shot in the dark.
  assert.ok(TAP_FORGIVE_PX >= 20 && TAP_FORGIVE_PX <= 40);
});

test('a tap far from every sheep counts nothing', () => {
  const single = [{ index: 0, x: 100, y: 100, r: 20, eligible: true }];
  // One pixel past the forgiveness radius from the edge: nothing.
  assert.equal(nearestForgivenTap(single, 151, 100), -1);
  assert.equal(nearestForgivenTap(single, 100, 300), -1);
  // An empty pasture forgives nothing.
  assert.equal(nearestForgivenTap([], 100, 100), -1);
});

test('forgiveness never lands on a counted sheep or the wolf', () => {
  // The counted sheep is closer, but only the uncounted one is eligible.
  const mixed = [
    { index: 0, x: 110, y: 100, r: 20, eligible: false },
    { index: 1, x: 160, y: 100, r: 20, eligible: true },
  ];
  assert.equal(nearestForgivenTap(mixed, 130, 100), 1);
  // Only counted or wolf cards nearby: the tap is ignored, so a sloppy
  // near miss cannot end a run.
  const allIneligible = [
    { index: 0, x: 100, y: 100, r: 20, eligible: false },
    { index: 1, x: 140, y: 100, r: 20, eligible: false },
  ];
  assert.equal(nearestForgivenTap(allIneligible, 110, 100), -1);
});

test('forgiven taps break ties deterministically', () => {
  // Two eligible sheep exactly equidistant from the tap: the lower index
  // wins, on every run.
  const tied = [
    { index: 3, x: 90, y: 100, r: 0, eligible: true },
    { index: 7, x: 150, y: 100, r: 0, eligible: true },
  ];
  assert.equal(nearestForgivenTap(tied, 120, 100), 3);
  const tiedReversed = [
    { index: 7, x: 150, y: 100, r: 0, eligible: true },
    { index: 3, x: 90, y: 100, r: 0, eligible: true },
  ];
  assert.equal(nearestForgivenTap(tiedReversed, 120, 100), 3);
});

test('a deep-link round is reproducible and never grows past the cap', () => {
  assert.equal(roundSeed(5), roundSeed(5));
  assert.notEqual(roundSeed(5), roundSeed(6));
  assert.equal(normalizeRound('5'), 5);
  assert.equal(normalizeRound('0'), 1);
  assert.equal(normalizeRound('nope'), 1);
  assert.equal(normalizeRound(-3), 1);

  const a = newStore().store;
  const b = newStore().store;
  a.startRound(5, { silent: true });
  b.startRound('5', { silent: true });
  assert.equal(a.state.seed, b.state.seed);
  assert.equal(a.state.sheepCount, sheepForRound(5));
  assert.equal(a.state.phase, COUNTING);
});

test('counting every sheep passes the round and advances', () => {
  const { store } = newStore();
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
  assert.equal(store.bestRound, 4);
});

test('tapping an already-counted sheep ends the run', () => {
  const { store } = newStore();
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
  const { store } = newStore();
  store.startRound(6, { silent: true });
  store.tapSheep(0);
  assert.deepEqual(store.submitCount(), { outcome: 'missed', round: 6 });
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_MISSED);
  assert.equal(store.state.count, 1);
});

test('out-of-range taps are ignored rather than ending the run', () => {
  const { store } = newStore();
  store.startRound(2, { silent: true });
  assert.deepEqual(store.tapSheep(-1), { outcome: 'ignored' });
  assert.deepEqual(store.tapSheep(store.state.sheepCount), { outcome: 'ignored' });
  assert.deepEqual(store.tapSheep(1.5), { outcome: 'ignored' });
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.count, 0);
});

test('restarting returns to round 1 and keeps the best round reached', () => {
  const { store } = newStore();
  store.startRound(7, { silent: true });
  store.endRun(ENDED_MISSED);
  store.restartRun();
  assert.equal(store.state.round, 1);
  assert.equal(store.state.sheepCount, 1);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.endedBy, null);
  assert.equal(store.bestRound, 7);
  assert.equal(store.state.bestRounds.normal, 7);
});

test('taps counted in any order keep their tap-order numbering', () => {
  const { store } = newStore();
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
  const { store } = newStore();
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
  const { store } = newStore();
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
  const { store } = newStore();
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
test('every difficulty keeps round 1 as one motionless sheep', () => {
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    assert.equal(sheepForRound(1, d), 1, `${d} round 1 flock`);
    const m = motionForRound(1, d);
    assert.equal(m.speed, 0, `${d} round 1 speed`);
    assert.equal(m.radius, 0, `${d} round 1 radius`);
    assert.equal(roamRadius(1, d), 0, `${d} round 1 roam`);
    for (let t = 0; t < 60; t += 0.25) {
      assert.deepEqual(wanderOffset(roundSeed(1), 0, 1, t, m), { x: 0, z: 0, turn: 0 });
    }
  }
});

test('each difficulty grows its flock on its own curve, capped', () => {
  // Normal is the pre-difficulty game, byte for byte.
  for (const round of [1, 2, 3, 5, 8, 9, 20]) {
    assert.equal(sheepForRound(round, 'normal'), sheepForRound(round), `round ${round}`);
  }
  // Named check-fixture numbers from the dapp.json deep links.
  assert.equal(sheepForRound(5, 'easy'), 5);
  assert.equal(sheepForRound(5, 'normal'), 7);
  assert.equal(sheepForRound(5, 'hard'), 9);
  assert.equal(sheepForRound(5, 'expert'), 11);
  // Easy stops at 6 sheep; the others at the shared MAX_SHEEP cap.
  assert.equal(sheepForRound(30, 'easy'), 6);
  for (const d of ['normal', 'hard', 'expert']) {
    assert.equal(sheepForRound(30, d), MAX_SHEEP, `${d} cap`);
  }
  // A level never shrinks its flock as rounds go on.
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    let prev = sheepForRound(1, d);
    for (let round = 2; round <= 20; round++) {
      const n = sheepForRound(round, d);
      assert.ok(n >= prev && n <= d === 'easy' ? n <= 6 : n <= MAX_SHEEP, `${d} round ${round}`);
      prev = n;
    }
  }
});

test('later rounds never tame down, at any difficulty', () => {
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    let prev = motionForRound(1, d);
    for (let round = 2; round <= 24; round++) {
      const m = motionForRound(round, d);
      assert.ok(m.speed >= prev.speed, `${d} round ${round} slowed down`);
      assert.ok(m.radius >= prev.radius, `${d} round ${round} roams less`);
      assert.ok(m.bounceMix >= prev.bounceMix, `${d} round ${round} bounces less`);
      assert.ok(m.jitterAmp >= prev.jitterAmp, `${d} round ${round} jitters less`);
      assert.ok(m.chaos >= prev.chaos, `${d} round ${round} is calmer`);
      prev = m;
    }
  }
  // The levels are meaningfully apart where the ramps bite.
  assert.ok(motionForRound(5, 'expert').speed > motionForRound(5, 'normal').speed * 1.5);
  assert.ok(motionForRound(5, 'easy').speed < motionForRound(5, 'normal').speed);
});

test('wandering stays deterministic, bounded and continuous at every difficulty', () => {
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    // A sheep must stay followable by eye, never warping. The drift term
    // has a corner at each reversal, so a single frame at the corner is
    // allowed to move up to DRIFT_MAX; everything above that is a warp. The
    // bound scales with the level: a faster difficulty legitimately covers
    // more ground in the same 1/30th of a second.
    const DRIFT_MAX = 0.5;
    const JUMP_LIMIT = { easy: DRIFT_MAX, normal: DRIFT_MAX * 1.2, hard: DRIFT_MAX * 1.5, expert: DRIFT_MAX * 2 }[d];
    for (let round = 1; round <= 16; round++) {
      const m = motionForRound(round, d);
      const bound = Math.max(roamRadius(round, d), 0.35);
      const seed = roundSeed(round);
      const herd = sheepForRound(round, d);
      for (let i = 0; i < herd; i++) {
        let last = wanderOffset(seed, i, herd, 0, m);
        for (let t = 0; t <= 120; t += 1 / 30) {
          const point = wanderOffset(seed, i, herd, t, m);
          // roamRadius is what scene.js pads the camera by, per difficulty.
          assert.ok(
            Math.hypot(point.x, point.z) <= bound + 1e-9,
            `${d} round ${round} sheep ${i} reached ${Math.hypot(point.x, point.z)} > ${bound}`
          );
          assert.ok(
            Math.hypot(point.x - last.x, point.z - last.z) < JUMP_LIMIT,
            `${d} round ${round} sheep ${i} jumped at t=${t}`
          );
          last = point;
        }
      }
    }
  }
});

test('omitting the difficulty means normal, everywhere', () => {
  for (let round = 1; round <= 14; round++) {
    assert.equal(
      JSON.stringify(motionForRound(round)),
      JSON.stringify(motionForRound(round, 'normal')),
      `round ${round} motion`
    );
    assert.equal(sheepForRound(round), sheepForRound(round, 'normal'));
    assert.equal(roamRadius(round), roamRadius(round, 'normal'));
    assert.equal(paceLine(round), paceLine(round, 'normal'));
  }
  // Anything unrecognised reads as normal too.
  assert.equal(
    JSON.stringify(motionForRound(5, 'bogus')),
    JSON.stringify(motionForRound(5, 'normal'))
  );
});

test('the briefing names the right flock per difficulty', () => {
  assert.equal(roundIntroText(3, 'expert'), 'Round 3 has 6 sheep. They start to wander.');
  assert.equal(roundIntroText(5, 'expert'), 'Round 5 has 11 sheep. They are jumpy now.');
  assert.equal(roundIntroText(5, 'hard'), 'Round 5 has 9 sheep. They bounce off in all directions.');
  assert.equal(roundIntroText(3, 'easy'), 'Round 3 has 3 sheep. They start to wander.');
  assert.equal(roundIntroText(1, 'expert'), 'Round 1 has 1 sheep. This one stands still.');
  // No em dashes in anything the player reads, at any level.
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    for (const round of [1, 5, 12]) {
      assert.ok(!roundIntroText(round, d).includes('\u2014'), `em dash in ${d} round ${round}`);
      assert.ok(!paceLine(round, d).includes('\u2014'), `em dash in pace ${d} round ${round}`);
    }
  }
});

test('switching difficulty resets the run and keeps other levels bests', () => {
  const { store } = newStore();
  store.startRound(5, { silent: true });
  store.tapSheep(0);
  store.setDifficulty('expert');
  assert.equal(store.state.difficulty, 'expert');
  assert.equal(store.state.round, 1);
  assert.equal(store.state.count, 0);
  assert.deepEqual(store.state.counted, []);
  assert.equal(store.state.sheepCount, sheepForRound(1, 'expert'));
  // Normal's best round survives the switch; Expert starts at 1.
  assert.equal(store.state.bestRounds.normal, 5);
  assert.equal(store.state.bestRounds.expert, 1);
  assert.equal(store.bestRound, 1);
  // An unknown level falls back to normal rather than crashing.
  store.setDifficulty('bogus');
  assert.equal(store.state.difficulty, 'normal');
  // Lifetime taps keep accumulating across the switch.
  const before = store.state.totalCounted;
  store.tapSheep(0);
  assert.equal(store.state.totalCounted, before + 1);
});

test('a level runs its own curve once selected', () => {
  const { store } = newStore();
  store.setDifficulty('expert');
  store.startRound(3, { silent: true });
  assert.equal(store.state.sheepCount, sheepForRound(3, 'expert'));
  store.setDifficulty('easy');
  store.startRound(5, { silent: true });
  assert.equal(store.state.sheepCount, sheepForRound(5, 'easy'));
});

test('the sound enabled flag gates before any AudioContext work', () => {
  // Off by default: a fresh page never makes noise.
  setSoundEnabled(false);
  assert.equal(isSoundEnabled(), false);
  // The toggle mirrors the shared state's soundOn bit.
  setSoundEnabled(true);
  assert.equal(isSoundEnabled(), true);
  setSoundEnabled(false);
  assert.equal(isSoundEnabled(), false);
});

test('sound is on for a fresh run, before any grown-up touches settings', () => {
  const { store } = newStore();
  assert.equal(store.state.soundOn, true);
});

test('the sound toggle persists through save and load', () => {
  const { store } = newStore();
  store.setSoundOn(true);
  assert.equal(store.state.soundOn, true);
  // A fresh store reading the same storage shape restores the toggle.
  const saved = { round: 2, difficulty: 'normal', totalCounted: 4, soundOn: true, soundSet: true };
  const { store: restored } = newStore();
  restored.loadLocalFrom(saved);
  assert.equal(restored.state.soundOn, true);
  // A save from before sound defaulted on carries soundOn:false as the
  // old shipped default, not a choice: the baa default applies once.
  const { store: upgraded } = newStore();
  upgraded.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 4, soundOn: false });
  assert.equal(upgraded.state.soundOn, true);
  // And a grown-up's mute, made after the default flipped, stays off.
  const { store: muted } = newStore();
  muted.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 4, soundOn: false, soundSet: true });
  assert.equal(muted.state.soundOn, false);
});

test('a nightly player saved before the baa default hears sound on the next boot', async () => {
  // The device save and the server row both still say soundOn:false,
  // because off was the old shipped default. Neither was a choice: the
  // new default stands, the boot writes the marker, and the next sync
  // upgrades the server row too.
  await withFakeBrowser(
    { round: 2, difficulty: 'normal', totalCounted: 9, soundOn: false },
    { round: 2, difficulty: 'normal', totalCounted: 9, soundOn: false, nightOn: false, calmOn: false },
    async (store, mem) => {
      store.loadLocal();
      await store.loadRemote();
      assert.equal(store.state.soundOn, true);
      const written = JSON.parse(mem.get(store.storageKey));
      assert.equal(written.soundOn, true);
      assert.equal(written.soundSet, true);
    }
  );
  // And a mute a grown-up made after the flip survives both restores.
  await withFakeBrowser(
    { round: 2, difficulty: 'normal', totalCounted: 9, soundOn: false, soundSet: true },
    { round: 2, difficulty: 'normal', totalCounted: 9, soundOn: false, nightOn: false, calmOn: false },
    async (store) => {
      store.loadLocal();
      await store.loadRemote();
      assert.equal(store.state.soundOn, false);
    }
  );
});

test('the per-difficulty best map survives a local save and load', () => {
  const { store } = newStore();
  store.setDifficulty('hard');
  store.startRound(6, { silent: true });
  assert.equal(store.bestRound, 6);
  // A fresh store reading the same storage shape restores both levels.
  const saved = {
    round: 2,
    difficulty: 'hard',
    bestRounds: { easy: 3, normal: 9, hard: 6, expert: 1 },
    totalCounted: 12,
    soundOn: true,
  };
  const { store: restored } = newStore();
  restored.loadLocalFrom(saved);
  assert.equal(restored.state.difficulty, 'hard');
  assert.equal(restored.bestRound, 6);
  assert.equal(restored.state.bestRounds.normal, 9);
  assert.equal(restored.state.bestRounds.easy, 3);
  assert.equal(restored.state.totalCounted, 12);
  assert.equal(restored.state.soundOn, true);
});

test('a legacy best round folds into normal, not every level', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 4, bestRound: 8, totalCounted: 20, soundOn: false });
  assert.equal(restored.state.difficulty, 'normal');
  assert.equal(restored.state.bestRounds.normal, 8);
  assert.equal(restored.state.bestRounds.expert, 1);
});

test('the week starts Monday 00:00 UTC', () => {
  // A Wednesday deep inside its week.
  const wed = weekStartUtc(new Date('2026-09-23T15:30:00Z'));
  assert.equal(wed.toISOString(), '2026-09-21T00:00:00.000Z');
  // Sunday 23:59:59 still belongs to the week that started six days earlier.
  const sundayNight = weekStartUtc(new Date('2026-09-20T23:59:59Z'));
  assert.equal(sundayNight.toISOString(), '2026-09-14T00:00:00.000Z');
  // The boundary itself: Monday 00:00:00 starts the new week.
  const mondayMorning = weekStartUtc(new Date('2026-09-21T00:00:00Z'));
  assert.equal(mondayMorning.toISOString(), '2026-09-21T00:00:00.000Z');
  // A late Sunday belongs to the week that is ending (the boundary
  // Monday is six days back), exactly like date_trunc('week', ...).
  const lateSunday = weekStartUtc(new Date('2026-09-27T12:00:00Z'));
  assert.equal(lateSunday.toISOString(), '2026-09-21T00:00:00.000Z');
});

test('score rows sort best-first, ties by handle, unscored friends last', () => {
  const rows = [
    { username: 'Staging demo: Pip', bestRound: 3, totalCounted: 5 },
    { username: 'Staging demo: Bess', bestRound: 12, totalCounted: 40 },
    { username: 'Staging demo: Mabel', bestRound: 9, totalCounted: 23 },
    { username: 'Staging demo: Otto', bestRound: 6, totalCounted: 11 },
  ];
  const sorted = sortScoreRows(rows);
  assert.deepEqual(
    sorted.map((r) => r.username),
    [
      'Staging demo: Bess',
      'Staging demo: Mabel',
      'Staging demo: Otto',
      'Staging demo: Pip',
    ]
  );

  // Friends with no score yet sort after every scored friend, by handle.
  const friends = sortScoreRows([
    { username: 'zeta', bestRound: null },
    { username: 'mabel', bestRound: 9 },
    { username: 'alix', bestRound: null },
    { username: 'otto', bestRound: 6 },
  ]);
  assert.deepEqual(
    friends.map((r) => r.username),
    ['mabel', 'otto', 'alix', 'zeta']
  );

  // Ties break alphabetically, then the input is never mutated.
  const tie = sortScoreRows([
    { username: 'nova', bestRound: 4 },
    { username: 'alix', bestRound: 4 },
  ]);
  assert.deepEqual(tie.map((r) => r.username), ['alix', 'nova']);
});

test('a finished run records once; a new run re-arms the record', () => {
  const { store, recordedRuns } = newStore(true);
  store.startRound(3, { silent: true });
  store.tapSheep(0);
  store.endRun('doubleTap');
  // Double endRun without a new run records at most one run.
  store.endRun('doubleTap');
  store.endRun('doubleTap');
  assert.equal(recordedRuns.length, 1);
  assert.equal(recordedRuns[0], 3);

  // A fresh run re-arms the guard.
  store.startRound(5, { silent: true });
  store.endRun('doubleTap');
  assert.equal(recordedRuns.length, 2);
  assert.equal(recordedRuns[1], 5);
});

test('share keys and invite codes match their public read shapes', () => {
  // The server validates with the same bounds; these are the pure regex
  // shapes so the test needs no network.
  const SHARE_KEY_RE = /^[A-Za-z0-9_-]{10,32}$/;
  const INVITE_CODE_RE = /^[A-Za-z0-9_-]{8,16}$/;
  assert.ok(SHARE_KEY_RE.test('staging-demo-share'));
  assert.ok(SHARE_KEY_RE.test('Abcdefghijklmnopqrstuvwx'));
  assert.ok(!SHARE_KEY_RE.test('short'));
  assert.ok(!SHARE_KEY_RE.test('has space in it'));
  assert.ok(!SHARE_KEY_RE.test('<script>'));
  assert.ok(INVITE_CODE_RE.test('demo-invite'));
  assert.ok(!INVITE_CODE_RE.test('short'));
  assert.ok(!INVITE_CODE_RE.test('no/slashes/here'));
});

test('a Speed Round toggles on the briefing and runs the same flock', () => {
  const { store } = newStore();
  store.setSpeedOn(true);
  assert.equal(store.state.speedOn, true);
  assert.equal(store.state.secondsLeft, SPEED_ROUND_SECONDS);
  // Same flock as the normal round: the count and the seed do not move.
  assert.equal(store.state.sheepCount, sheepForRound(1));
  assert.equal(store.state.seed, roundSeed(1));
  // The briefing line names the clock.
  assert.match(roundIntroText(1, 'normal', true), /before the clock runs out/);
  // Toggling off drops the clock again.
  store.setSpeedOn(false);
  assert.equal(store.state.speedOn, false);
  assert.equal(store.state.secondsLeft, null);
});

test('the Speed Round clock ticks whole seconds and ends the run at zero', () => {
  const { store, recordedRuns } = newStore(true);
  store.setSpeedOn(true);
  store.startRound(2, { silent: true });
  // The clock is what's under test here, not the wolf: pin this round wolf-free.
  store.state = { ...store.state, wolfIndex: null };
  assert.equal(store.state.secondsLeft, SPEED_ROUND_SECONDS);
  store.tapSheep(0);
  assert.equal(store.tickClock(), true);
  assert.equal(store.state.secondsLeft, SPEED_ROUND_SECONDS - 1);
  // A normal round ignores the clock entirely.
  store.setSpeedOn(false);
  const normal = store.tickClock();
  assert.equal(normal, true);
  assert.equal(store.state.secondsLeft, null);
  // Back on for the timeout: every step down to zero, then the run ends.
  store.setSpeedOn(true);
  for (let left = SPEED_ROUND_SECONDS - 1; left > 0; left--) {
    assert.equal(store.tickClock(), true);
  }
  assert.equal(store.tickClock(), false, 'the zero step reports the timeout');
  // app.js owns the timeout action: the same endRun path a missed count
  // uses, with the clock's own reason.
  store.endRun(ENDED_TIME_UP);
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_TIME_UP);
  assert.equal(recordedRuns.length, 1);
});

test('a passed Speed Round advances with a fresh clock and keeps the mode', () => {
  const { store } = newStore();
  store.setSpeedOn(true);
  store.startRound(1, { silent: true });
  const n = store.state.sheepCount;
  for (let i = 0; i < n; i++) store.tapSheep(i);
  store.submitCount();
  assert.equal(store.state.phase, ROUND_PASSED);
  store.nextRound();
  assert.equal(store.state.speedOn, true, 'the mode is sticky within the run');
  assert.equal(store.state.secondsLeft, SPEED_ROUND_SECONDS, 'the next round gets a fresh clock');
  assert.equal(store.state.phase, COUNTING);
});

test('calm mode slows the flock without changing what the round asks for', () => {
  // The motion profile keeps its shape: same roam radius, a slower clock.
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const raw = motionForRound(6, difficulty);
    const calm = calmMotion(6, difficulty);
    assert.ok(calm.speed < raw.speed, `${difficulty} calm speed did not slow`);
    assert.ok(Math.abs(calm.speed - raw.speed * CALM_SPEED) < 1e-9);
    assert.equal(calm.radius, raw.radius, `${difficulty} calm radius moved`);
    assert.equal(calm.bounceMix, raw.bounceMix, `${difficulty} calm bounce moved`);
    assert.ok(calm.jitterAmp < raw.jitterAmp, `${difficulty} calm jitter did not soften`);
    const rawRadius = roamRadius(6, difficulty);
    assert.ok(rawRadius > 0, 'sanity: roam uses the raw profile');
  }
  // The paths are the same shapes, just walked slower: the same seed at a
  // later time never jumps outside the raw bound.
  const raw = motionForRound(8);
  const calm = calmMotion(8);
  for (let i = 0; i < sheepForRound(8); i++) {
    for (let t = 0; t <= 40; t += 2) {
      const p = wanderOffset(roundSeed(8), i, sheepForRound(8), t, calm);
      assert.ok(Math.hypot(p.x, p.z) <= raw.radius * Math.SQRT2 + 1e-9);
      assert.deepEqual(p, wanderOffset(roundSeed(8), i, sheepForRound(8), t, calm));
    }
  }
  // The store toggle persists like sound and Night Meadow.
  const { store } = newStore();
  store.setCalmOn(true);
  assert.equal(store.state.calmOn, true);
  assert.equal(store.state.sheepCount, sheepForRound(1), 'the flock size did not move');
  assert.equal(store.state.seed, roundSeed(1), 'the seed did not move');
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 3, difficulty: 'hard', totalCounted: 2, calmOn: true });
  assert.equal(restored.state.calmOn, true);
  // Normalization: anything but exactly true is off, and the copy helper
  // keeps its exact words in both modes.
  assert.equal(normalizeCalm('1'), false);
  assert.equal(normalizeCalm(1), false);
  assert.match(roundIntroText(4, 'normal', false, true), /Calm mode keeps them slow/);
  assert.ok(!roundIntroText(4, 'normal', false, false).includes('Calm mode'));
});

test('a fresh run resets the Speed Round mode and reads a stale clock as off', () => {
  const { store } = newStore();
  store.setSpeedOn(true);
  store.endRun(ENDED_TIME_UP);
  store.restartRun();
  assert.equal(store.state.speedOn, false);
  assert.equal(store.state.secondsLeft, null);
  // Normalization: anything but exactly true is off, and the clock text
  // never goes negative.
  assert.equal(normalizeRound(3), 3);
  assert.equal(speedRoundClock(0.4), '1');
  assert.equal(speedRoundClock(-2), '0');
  assert.match(roundCompleteTitle(4, true), /Speed Round 4 counted/);
  assert.equal(roundCompleteTitle(4, false), 'Round 4 counted.');
  assert.equal(weeklyScoreLabel(8, true), 'Speed 8');
assert.equal(weeklyScoreLabel(8, false), 'Round 8');
});

test('a mid-round snapshot round-trips the exact board', () => {
  const { store } = newStore();
  store.startRound(5, { silent: true });
  store.tapSheep(0);
  store.tapSheep(2);
  const snapshot = store.snapshotRound();
  // Everything that defines the board travels together.
  assert.equal(snapshot.round, 5);
  assert.equal(snapshot.seed, store.state.seed);
  assert.deepEqual(snapshot.counted, [0, 2]);
  assert.equal(snapshot.countedAt.length, 2);
  assert.equal(snapshot.countedAt[0].index, 0);
  assert.equal(snapshot.countedAt[1].index, 2);
  assert.equal(snapshot.phase, COUNTING);

  // A fresh store restores it exactly: same round, same flock size, same
  // seed, same sheep counted in the same tap order, same clock.
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 5, difficulty: 'normal', midCountdown: snapshot });
  assert.equal(restored.state.round, 5);
  assert.equal(restored.state.sheepCount, store.state.sheepCount);
  assert.equal(restored.state.seed, store.state.seed);
  assert.deepEqual(restored.state.counted, [0, 2]);
  assert.deepEqual(restored.state.countedAt, snapshot.countedAt);
  assert.equal(restored.state.roundElapsed, snapshot.roundElapsed);
  assert.equal(restored.state.phase, COUNTING);
  // Double-tap protection survives the resume: a restored tap ends the run.
  restored.tapSheep(0);
  assert.equal(restored.state.phase, RUN_OVER);
});

test('a resumed snapshot with no midCountdown starts a fresh round', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 3, difficulty: 'normal', totalCounted: 6 });
  assert.equal(restored.state.round, 3);
  assert.equal(restored.state.count, 0);
  assert.deepEqual(restored.state.counted, []);
  assert.equal(restored.state.sheepCount, sheepForRound(3, 'normal'));
});

test('a mangled snapshot never crashes or fabricates taps', () => {
  const base = { round: 4, difficulty: 'hard', seed: roundSeed(4), phase: COUNTING };
  // Out-of-range and duplicate indices are dropped, tap order preserved.
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 4,
    difficulty: 'hard',
    midCountdown: { ...base, counted: [0, 99, 1, 1, -3] },
  });
  assert.deepEqual(restored.state.counted, [0, 1]);
  assert.equal(restored.state.sheepCount, sheepForRound(4, 'hard'));
  // A non-counting phase never resumes: the round starts fresh.
  const { store: finished } = newStore();
  finished.loadLocalFrom({
    round: 4,
    difficulty: 'hard',
    midCountdown: { ...base, counted: [0, 1], phase: RUN_OVER },
  });
  assert.equal(finished.state.phase, COUNTING);
  assert.equal(finished.state.count, 0);
});

test('passing or ending the round clears the snapshot', () => {
  const { store } = newStore();
  store.startRound(3, { silent: true });
  store.tapSheep(0);
  assert.equal(store.snapshotRound().phase, COUNTING);
  // A miss ends the run and the snapshot must not survive it.
  store.endRun(ENDED_DOUBLE_TAP);
  assert.equal(store.hasMidRoundSnapshot, false);
  // Same after a full count and submit: the round is over.
  const { store: passed } = newStore();
  passed.startRound(1, { silent: true });
  passed.tapSheep(0);
  passed.submitCount();
  assert.equal(passed.state.phase, ROUND_PASSED);
  assert.equal(passed.hasMidRoundSnapshot, false);
});

test('a Speed Round snapshot carries its remaining clock, and 0 reads as gone', () => {
  const { store } = newStore();
  store.setSpeedOn(true);
  store.startRound(2, { silent: true });
  // The clock is what's under test here, not the wolf: pin this round
  // wolf-free, and count a sheep the round's wolf is not. A resume re-draws
  // the wolf and never restores it as counted, since the 3D renderer cannot
  // draw a counted wolf.
  const drawnWolf = store.state.wolfIndex;
  store.state = { ...store.state, wolfIndex: null };
  store.tapSheep(drawnWolf === 0 ? 1 : 0);
  const snapshot = store.snapshotRound();
  assert.equal(snapshot.speedOn, true);
  assert.equal(snapshot.secondsLeft, SPEED_ROUND_SECONDS);

  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 2, midCountdown: { ...snapshot, secondsLeft: 17 } });
  assert.equal(restored.state.speedOn, true);
  assert.equal(restored.state.secondsLeft, 17);
  assert.equal(restored.state.count, 1);

  // A clock that already hit zero is a finished round: it never resumes.
  const { store: expired } = newStore();
  expired.loadLocalFrom({ round: 2, midCountdown: { ...snapshot, secondsLeft: 0 } });
  assert.equal(expired.state.count, 0);
  assert.equal(expired.state.secondsLeft, SPEED_ROUND_SECONDS);
});

// ---- Pass-and-play Duel ----
// The duel is layered on the same state shape the solo run uses: each turn
// is a fresh ephemeral store over one shared flock seed, so every renderer
// surface reads it unchanged. These tests pin the contract the controller
// in app.js depends on.

test('a duel turn store uses the shared flock seed, not the round seed', () => {
  const { store } = newStore();
  const round = 2;
  const sharedSeed = roundSeed(round) + 900000 + round;
  store.state = { ...store.state, duel: true, seed: sharedSeed };
  store.startRound(round, { silent: true });
  store.state = { ...store.state, seed: sharedSeed };
  assert.equal(store.state.seed, sharedSeed);
  assert.notEqual(store.state.seed, roundSeed(round));
  assert.equal(store.state.sheepCount, sheepForRound(round));
  assert.equal(store.state.count, 0);
  assert.equal(store.state.phase, COUNTING);
});

test('a duel turn miss count comes straight off the shared state shape', () => {
  const { store } = newStore();
  const round = 4;
  const n = sheepForRound(round);
  store.startRound(round, { silent: true });
  // The miss count is what's under test here, not the wolf: pin this round wolf-free.
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < n - 1; i++) store.tapSheep(i);
  store.submitCount();
  assert.equal(store.state.phase, RUN_OVER);
  const misses = store.state.sheepCount - store.state.count;
  assert.equal(misses, 1);
});

test('a clean duel turn scores zero misses', () => {
  const { store } = newStore();
  const n = sheepForRound(1);
  store.startRound(1, { silent: true });
  for (let i = 0; i < n; i++) store.tapSheep(i);
  store.submitCount();
  const misses = store.state.sheepCount - store.state.count;
  assert.equal(misses, 0);
  assert.equal(store.state.phase, ROUND_PASSED);
});

test('duel misses compare the way the results card announces', () => {
  const compare = (a, b) => (a < b ? 'Player 1 wins' : b < a ? 'Player 2 wins' : 'A tie');
  assert.equal(compare(0, 1), 'Player 1 wins');
  assert.equal(compare(2, 1), 'Player 2 wins');
  assert.equal(compare(1, 1), 'A tie');
});

test('a duel turn that double-taps still lands in the run-over path', () => {
  const { store } = newStore();
  store.startRound(2, { silent: true });
  // The double-tap path is what's under test here, not the wolf: pin this round wolf-free.
  store.state = { ...store.state, wolfIndex: null };
  store.tapSheep(0);
  store.tapSheep(0);
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_DOUBLE_TAP);
  const misses = store.state.sheepCount - store.state.count;
  assert.ok(misses >= 1);
});

// The grown-ups export: the CSV builders are pure, so the browser button and
// these assertions share one source of truth for the file's exact shape.
test('the best-rounds export names every difficulty and folds legacy data', () => {
  const csv = bestRoundsCsv({ bestRounds: { easy: 3, normal: 7, hard: 5, expert: 2 } });
  assert.equal(
    csv,
    'difficulty,best_round\r\neasy,3\r\nnormal,7\r\nhard,5\r\nexpert,2\r\n',
    'one header and one row per level, CRLF-terminated'
  );
  const legacy = bestRoundsCsv({});
  assert.match(legacy, /normal,1/, 'a store with no bestRounds yet exports defaults');
});

test('the weekly history export carries the clock tag and quotes commas', () => {
  const csv = weeklyHistoryCsv([
    { endedAt: '2026-09-21T10:00:00.000Z', roundReached: 8, speedRound: true },
    { endedAt: '2026-09-22T10:00:00.000Z', roundReached: 5, speedRound: false },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'ended_at,round_reached,speed_round');
  assert.equal(lines[1], '2026-09-21T10:00:00.000Z,8,yes');
  assert.equal(lines[2], '2026-09-22T10:00:00.000Z,5,no');
  // A username-style free-text cell would never shift a column; the
  // quoting rule is what keeps a stray comma inside one cell.
  const quoted = weeklyHistoryCsv([{ endedAt: 'a,b', roundReached: 2 }]);
  assert.match(quoted, /"a,b",2,no/);
  assert.equal(weeklyHistoryCsv(null).endsWith('\r\n'), true, 'an empty week still emits the header');
});

// ---- Play streak ----
// The flame on the Get-ready card counts consecutive local days with at
// least one round started. A persistent (non-ephemeral) store records the
// day on every round start; an ephemeral one, like every fixture and deep
// link, never records. saveLocal is a no-op in a test process (no
// localStorage), so the store-level tests run without a browser.

test('a round start records the day; a deep-link store never does', () => {
  const { store } = newStore();
  assert.equal(store.state.streakDays, 0);
  store.startRound(1);
  assert.equal(store.state.streakDays, 0, 'an ephemeral fixture store never records a day');

  const live = new StateStore({});
  live.startRound(1);
  assert.equal(live.state.streakDays, 1, 'a first day lights the streak');
  assert.equal(live.state.bestStreakDays, 1);
  assert.match(live.state.lastPlayedDay, /^\d{4}-\d{2}-\d{2}$/);
  // Starting more rounds the same day stays at one.
  live.startRound(2);
  assert.equal(live.state.streakDays, 1);
});

test('the streak crosses days through the record seam, not a fake clock', () => {
  const day = (offset) => localDayKey(new Date(Date.now() + offset * 86400000));
  const store = new StateStore({});
  store.startRound(1, { silent: true });
  assert.equal(store.state.streakDays, 1, 'the round start recorded today');
  // Tomorrow, and the day after: the streak grows and the best follows.
  store.recordPlayDay(day(1));
  store.recordPlayDay(day(2));
  assert.equal(store.state.streakDays, 3);
  assert.equal(store.state.bestStreakDays, 3);
  assert.equal(store.state.lastPlayedDay, day(2));
  // A gap resets the streak but never the best.
  store.recordPlayDay(day(9));
  assert.equal(store.state.streakDays, 1);
  assert.equal(store.state.bestStreakDays, 3);
  // The day after the gap builds a fresh streak beside the old best.
  store.recordPlayDay(day(10));
  assert.equal(store.state.streakDays, 2);
  assert.equal(store.state.bestStreakDays, 3);
});

test('a mangled day key is ignored rather than corrupting the streak', () => {
  const store = new StateStore({});
  store.startRound(1, { silent: true });
  store.recordPlayDay('not-a-date');
  store.recordPlayDay(42);
  assert.equal(store.state.streakDays, 1);
  assert.equal(store.state.lastPlayedDay, localDayKey());
});

test('the streak survives a local save and load beside the other values', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 2,
    difficulty: 'normal',
    totalCounted: 3,
    streakDays: 5,
    bestStreakDays: 8,
    lastPlayedDay: '2026-09-26',
  });
  assert.equal(restored.state.streakDays, 5);
  assert.equal(restored.state.bestStreakDays, 8);
  assert.equal(restored.state.lastPlayedDay, '2026-09-26');
  // Old saves without streak data read as a fresh streak, not a crash.
  const { store: fresh } = newStore();
  fresh.loadLocalFrom({ round: 2, totalCounted: 1 });
  assert.equal(fresh.state.streakDays, 0);
  assert.equal(fresh.state.lastPlayedDay, null);
});

// ---- Tap-path persistence and boot timeout (#52) ----
// A counting tap updates the board at once and writes localStorage just
// after, so these tests swap in an in-memory localStorage for a real,
// persistent (non-ephemeral) store.

function withMemoryStorage(fn) {
  const saved = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  const restore = () => {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  };
  return Promise.resolve()
    .then(() => fn((key) => JSON.parse(data.get(key) || '{}')))
    .finally(restore);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a counting tap updates the board first and saves right after', () => withMemoryStorage(async (read) => {
  const store = new StateStore({ userId: 'tap-save' });
  store.startRound(3, { silent: true });
  const countedOnDisk = () => read(store.storageKey).midCountdown?.counted ?? [];

  assert.equal(store.tapSheep(0).outcome, 'counted');
  assert.deepEqual(store.state.counted, [0], 'the board updates synchronously');
  assert.deepEqual(countedOnDisk(), [], 'the write is off the tap path');

  // Back-to-back taps coalesce into one write that carries both.
  store.tapSheep(1);
  await tick();
  assert.deepEqual(countedOnDisk(), [0, 1]);
  assert.equal(read(store.storageKey).totalCounted, 2);

  // pagehide / tab hide flush it at once.
  store.tapSheep(2);
  store.flushPendingSave();
  assert.deepEqual(countedOnDisk(), [0, 1, 2]);
}));

test('a run that ends before the deferred save never resurrects the board', () => withMemoryStorage(async (read) => {
  const store = new StateStore({ userId: 'tap-end' });
  store.startRound(3, { silent: true });
  store.tapSheep(0);
  // Double tap in the same task: the run ends and the snapshot is cleared.
  store.tapSheep(0);
  assert.equal(store.state.phase, RUN_OVER);
  await tick();
  const saved = read(store.storageKey);
  assert.equal(saved.midCountdown, undefined, 'the late tap save must not rewrite the snapshot');
  assert.equal(saved.totalCounted, 1, 'the tap itself still counted');
}));

test('a slow progress load gives up and keeps the device progress', { timeout: LOAD_REMOTE_TIMEOUT_MS + 3000 }, async () => {
  const savedFetch = globalThis.fetch;
  let aborted = false;
  // A server that never answers, unless the request is aborted.
  globalThis.fetch = (_url, opts = {}) => new Promise((_resolve, reject) => {
    opts.signal?.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('aborted'));
    });
  });
  try {
    const store = new StateStore({ userId: 'slow', token: 'x' });
    store.state = { ...store.state, round: 4 };
    const started = Date.now();
    const state = await store.loadRemote();
    assert.ok(aborted, 'the request is aborted');
    assert.ok(Date.now() - started < LOAD_REMOTE_TIMEOUT_MS + 1000);
    assert.equal(state.round, 4, 'local progress stands');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ---- Calm level (issue #28) ----

// A real (non-ephemeral) store over an in-memory localStorage and a stubbed
// /api/state, so the new-player default can be asserted end to end.
async function withFakeBrowser(saved, remote, fn) {
  const prevStorage = globalThis.localStorage;
  const prevFetch = globalThis.fetch;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const store = new StateStore({ userId: 'u1', token: remote ? 't' : '' });
  if (saved) localStorage.setItem(store.storageKey, JSON.stringify(saved));
  globalThis.fetch = async () => ({ ok: true, json: async () => remote });
  try {
    await fn(store, mem);
  } finally {
    globalThis.localStorage = prevStorage;
    globalThis.fetch = prevFetch;
  }
}

test('calm keeps the early-round drift forever and a small, slow flock', () => {
  const drift = motionForRound(2, 'normal');
  assert.deepEqual(motionForRound(1, 'calm'), motionForRound(1, 'normal'));
  for (let round = 2; round <= 40; round++) {
    const m = motionForRound(round, 'calm');
    assert.equal(m.speed, drift.speed, `calm round ${round} sped up`);
    assert.equal(m.radius, drift.radius);
    assert.equal(m.bounceMix, 0);
    assert.equal(m.jitterAmp, 0);
    assert.ok(Number.isFinite(roamRadius(round, 'calm')));
    assert.ok(sheepForRound(round, 'calm') <= 5, `calm round ${round} flock too big`);
    assert.ok(sheepForRound(round, 'calm') >= sheepForRound(round - 1, 'calm'));
  }
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => sheepForRound(r, 'calm')), [1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.equal(roundIntroText(6, 'calm'), 'Round 6 has 3 sheep. They start to wander.');
});

test('calm: a double tap only wiggles, a short count never ends the run, no wolf, no clock', () => {
  const { store, recordedRuns } = newStore(true);
  store.setDifficulty('calm');
  store.startRound(7, { silent: true });
  assert.equal(store.state.wolfIndex, null);
  assert.equal(store.tapSheep(0).outcome, 'counted');
  assert.deepEqual(store.tapSheep(0), { outcome: 'wiggle' });
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.count, 1);
  const short = store.submitCount();
  assert.equal(short.outcome, 'notYet');
  assert.deepEqual(short.awake, [1, 2, 3]);
  assert.equal(store.state.phase, COUNTING);
  for (const i of short.awake) store.tapSheep(i);
  assert.equal(store.submitCount().outcome, 'passed');
  store.setSpeedOn(true);
  assert.equal(store.state.speedOn, false);
  // Calm never records a run for the weekly board.
  store.endRun(ENDED_MISSED);
  assert.deepEqual(recordedRuns, []);
  // Every challenge level keeps its run-ending double tap.
  store.setDifficulty('normal');
  store.tapSheep(0);
  assert.equal(store.tapSheep(0).outcome, 'doubleTap');
  assert.equal(store.state.phase, RUN_OVER);
});

test('the briefing rule line names the calm tap only on calm', () => {
  assert.match(introRuleText('calm'), /sleepy wiggle/);
  assert.match(introRuleText('normal'), /ends the run/);
  assert.match(introRuleText('expert'), /ends the run/);
  assert.ok(!/\u2014/.test(introRuleText('calm')));
  assert.equal(isCalmLevel(NEW_PLAYER_DIFFICULTY), true);
});

test('a new player opens on calm; any saved pick keeps its level', async () => {
  // Nothing saved anywhere: Calm, and it is written down for next time.
  await withFakeBrowser(null, { round: 1, difficulty: null }, async (store, mem) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'calm');
    await store.loadRemote();
    assert.equal(store.state.difficulty, 'calm');
    assert.equal(JSON.parse(mem.get(store.storageKey)).difficulty, 'calm');
  });
  // A saved pick on the device stays.
  await withFakeBrowser({ round: 2, difficulty: 'hard' }, null, async (store) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'hard');
  });
  // A save from before levels existed reads as Normal, as it always has.
  await withFakeBrowser({ round: 2, totalCounted: 4 }, null, async (store) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'normal');
  });
  // A new device for an existing player: the server's saved level wins.
  await withFakeBrowser(null, { round: 1, difficulty: 'expert' }, async (store) => {
    store.loadLocal();
    await store.loadRemote();
    assert.equal(store.state.difficulty, 'expert');
  });
  // Deep-link stores never default to Calm: /?round=8 keeps its flock.
  const { store } = newStore();
  store.startRound(8, { silent: true });
  assert.equal(store.state.difficulty, 'normal');
  assert.equal(store.state.sheepCount, 11);
});

// A board saved mid-round before the wolf existed (#37 shipped save/resume a
// day before #38 added the wolf) can list, as counted, the sheep the wolf now
// hides behind. Resuming it put a counted wolf on screen, which the 3D
// renderer cannot draw (a wolf has no ribbon), so boot failed on every reload.
test('a board saved before the wolf existed resumes without a counted wolf', () => {
  let round = 2;
  let seed = roundSeed(round);
  let n = sheepForRound(round);
  let wolf = wolfIndexForRound(round, seed, n);
  while (wolf === null && round < 60) {
    round += 1;
    seed = roundSeed(round);
    n = sheepForRound(round);
    wolf = wolfIndexForRound(round, seed, n);
  }
  assert.notEqual(wolf, null, 'some round hides a wolf');
  const sheep = [...Array(n).keys()].find((i) => i !== wolf);
  const { store } = newStore();
  store.loadLocalFrom({
    round,
    difficulty: 'normal',
    midCountdown: {
      round,
      difficulty: 'normal',
      sheepCount: n,
      seed,
      counted: [sheep, wolf],
      countedAt: [{ index: sheep, elapsed: 1 }, { index: wolf, elapsed: 2 }],
      roundElapsed: 3,
      phase: COUNTING,
      speedOn: false,
      secondsLeft: null,
    },
  });
  assert.equal(store.state.phase, COUNTING, 'the board still resumes');
  assert.equal(store.state.wolfIndex, wolf);
  assert.deepEqual(store.state.counted, [sheep], 'the wolf is not counted');
  assert.deepEqual(store.state.countedAt, [{ index: sheep, elapsed: 1 }]);
  assert.equal(store.state.count, 1);
});

test('the screen-reader wolf cue names what a sighted player can see at each tier', () => {
  const seen = new Set();
  for (let round = 1; round <= 40; round += 1) {
    const cue = wolfCueText(round);
    assert.equal(typeof cue, 'string');
    assert.ok(cue.length > 0);
    assert.doesNotMatch(cue, /\u2014/, 'user-facing copy carries no em dashes');
    seen.add(`${wolfDisguiseTier(round)}:${cue}`);
  }
  // One wording per tier, and the obvious tier-1 disguise names its ears.
  assert.equal(new Set([...seen].map((k) => k.split(':')[0])).size, seen.size);
  assert.match(wolfCueText(1), /ears/);
});

// The 3D frame loop runs on the round's clock. #37 moved it there but never
// advanced it, so every sheep stood frozen and a counted sheep's number
// never grew in, while every selector-based check still passed. The clock
// lives in a WebGL renderer this suite cannot run, so pin the write itself.
test('the 3D frame loop advances the round clock every frame', () => {
  const scene = readFileSync(new URL('../public/scene.js', import.meta.url), 'utf8');
  const frame = scene.slice(scene.indexOf('function frame() {'));
  const firstReturn = frame.indexOf('return;');
  const write = frame.indexOf('lastElapsed = clock.elapsedTime;');
  assert.ok(write > 0, 'frame() writes lastElapsed');
  assert.ok(write < firstReturn, 'before the low-tier early return, so taps read a current clock');
});

// server.js answered the app's own compiled stylesheet with an empty 204
// (#38), so production rendered without its layout; and it had no wolf end
// reason, so a shared wolf run read "Some sheep were left uncounted."
test('the server serves the app stylesheet and records wolf endings', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const code = server.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(code, /const HAS_TAILWIND_CSS = require\('fs'\)\.existsSync\(path\.join\(__dirname, 'public', 'tailwind\.css'\)\);/);
  const stubs = code.split('\n').filter((l) => /'\/tailwind\.css'/.test(l)).map((l) => l.trim());
  assert.deepEqual(stubs, ["if (req.path === '/tailwind.css' && !HAS_TAILWIND_CSS) {"],
    'the stylesheet is answered empty only when the image has no built copy');
  const empty = code.split('\n').filter((l) => /status\(204\)/.test(l)).map((l) => l.trim());
  assert.deepEqual(empty, ["app.get('/favicon.ico', (_req, res) => res.status(204).end());", 'return res.status(204).end();'],
    'the favicon probe and the missing-stylesheet case are the only empty answers: no stubs for /usernode-bridge/');
  assert.match(code, /\['doubleTap', 'missed', 'timeUp', 'wolf'\]\.includes/);
});

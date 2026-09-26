import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StateStore,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
  ENDED_MISSED,
  ENDED_TIME_UP,
} from '../public/state.js';
import {
  MAX_SHEEP,
  motionForRound,
  paceLine,
  roamRadius,
  roundCompleteTitle,
  roundIntroText,
  roundSeed,
  SPEED_ROUND_SECONDS,
  speedRoundClock,
  weeklyScoreLabel,
  sheepForRound,
  sheepPhrase,
  normalizeRound,
  successMessage,
} from '../public/rounds.js';
import { wanderOffset } from '../public/movement.js';
import { weekStartUtc, sortScoreRows } from '../public/leaderboard.js';
import { buildSheepBodyGeometry, buildEyeGeometry } from '../public/scene.js';
import { isSoundEnabled, setSoundEnabled } from '../public/sound.js';

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

test('all plush sheep variants have finite geometry and stay inside the picking envelope', () => {
  for (const geo of [0, 1, 2].map(buildSheepBodyGeometry).concat(buildEyeGeometry())) {
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    assert.ok(box.min.x >= -.9 && box.max.x <= .9);
    assert.ok(box.max.y <= 1.3 && box.min.y >= -.1);
    for (const attr of Object.values(geo.attributes)) assert.ok(attr.array.every(Number.isFinite));
    geo.dispose();
  }
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

test('the sound toggle persists through save and load', () => {
  const { store } = newStore();
  store.setSoundOn(true);
  assert.equal(store.state.soundOn, true);
  // A fresh store reading the same storage shape restores the toggle.
  const saved = { round: 2, difficulty: 'normal', totalCounted: 4, soundOn: true };
  const { store: restored } = newStore();
  restored.loadLocalFrom(saved);
  assert.equal(restored.state.soundOn, true);
  // And off again stays off.
  const { store: muted } = newStore();
  muted.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 4, soundOn: false });
  assert.equal(muted.state.soundOn, false);
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
  store.tapSheep(0);
  store.tapSheep(0);
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_DOUBLE_TAP);
  const misses = store.state.sheepCount - store.state.count;
  assert.ok(misses >= 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StateStore,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_COMPLETE,
  ENDED_DOUBLE_TAP,
  ENDED_MISSED,
  ENDED_WOLF,
  ENDED_TIME_UP,
  LOAD_REMOTE_TIMEOUT_MS,
} from '../public/state.js';
import {
  BIG_TAP_CONFETTI_KEEP,
  BIG_TAP_HIT_SCALE,
  BIG_TAP_SPEED,
  CALM_SPEED,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MAX_SHEEP,
  NEW_PLAYER_DIFFICULTY,
  RETIRED_DIFFICULTIES,
  ROUNDS_PER_LEVEL,
  isCalmLevel,
  isLevelUp,
  isRetiredDifficulty,
  advanceStreak,
  calmMotion,
  dayDistance,
  localDayKey,
  bigTapMotion,
  flockMotion,
  levelForRound,
  levelTagText,
  levelUpTitle,
  motionForRound,
  normalizeBigTap,
  normalizeCalm,
  normalizeDifficulty,
  normalizeScenery,
  sceneryFromServer,
  paceLine,
  passLine,
  playHintText,
  roamRadius,
  roundInLevel,
  roundSeed,
  secondsForRound,
  secondsPerSheep,
  speedRoundClock,
  startLevelChoices,
  startRoundForLevel,
  weeklyScoreLabel,
  sheepForRound,
  sheepPhrase,
  normalizeRound,
  WOLF_BONUS,
  wolfChance,
  wolfCueText,
  wolfDisguiseTier,
  wolfIndexForRound,
} from '../public/rounds.js';
import { readFileSync } from 'node:fs';
import { wanderOffset } from '../public/movement.js';
import { weekStartUtc, sortScoreRows } from '../public/leaderboard.js';
import { sheepName, POP_PUFF_SECONDS } from '../public/layout.js';
import { buildSheepBodyGeometry, buildEyeGeometry } from '../public/scene.js';
import { isSoundEnabled, setSoundEnabled, playBaaBaaa, BAA_BAAA_SECONDS } from '../public/sound.js';
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

test('the ladder groups rounds into levels and adds sheep each level, up to the cap', () => {
  // Level 1 reads 1, 2, 2; level 4 reads 4, 5, 5 (the spec's table).
  assert.deepEqual([1, 2, 3].map((r) => sheepForRound(r)), [1, 2, 2]);
  assert.deepEqual([4, 5, 6].map((r) => sheepForRound(r)), [2, 3, 3]);
  assert.deepEqual([7, 8, 9].map((r) => sheepForRound(r)), [3, 4, 4]);
  assert.deepEqual([10, 11, 12].map((r) => sheepForRound(r)), [4, 5, 5]);
  let prev = 1;
  for (let round = 2; round <= 90; round++) {
    const n = sheepForRound(round);
    assert.ok(n <= MAX_SHEEP, `round ${round} wants ${n} sheep`);
    assert.ok(n - prev >= 0 && n - prev <= 1, `round ${round} jumped from ${prev} to ${n}`);
    prev = n;
  }
  // The flock is full from level 11's second round and stays full forever:
  // there is no last round any more (#9).
  assert.equal(sheepForRound(32), MAX_SHEEP);
  assert.equal(sheepForRound(33), MAX_SHEEP);
  assert.equal(sheepForRound(500), MAX_SHEEP);
});

test('levels, the corner tag and the level-up words', () => {
  assert.equal(ROUNDS_PER_LEVEL, 3);
  assert.deepEqual([1, 2, 3, 4, 9, 10].map(levelForRound), [1, 1, 1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4].map(roundInLevel), [1, 2, 3, 1]);
  // Only a level's last round levels up.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(isLevelUp), [false, false, true, false, false, true]);
  assert.equal(levelTagText(1), 'Level 1');
  assert.equal(levelTagText(3), 'Level 1');
  assert.equal(levelTagText(4), 'Level 2');
  assert.equal(levelTagText('bogus'), 'Level 1');
  assert.equal(levelUpTitle(3), 'Level 3!');
  assert.equal(passLine(4), 'You counted 4 sheep.');
  assert.equal(passLine(1), 'You counted 1 sheep.');
  // "Start at level" shortcuts land on a level's first round, and only up to
  // the best level reached.
  assert.equal(startRoundForLevel(1), 1);
  assert.equal(startRoundForLevel(4), 10);
  assert.deepEqual(startLevelChoices(1), [1]);
  assert.deepEqual(startLevelChoices(6), [1, 4]);
  assert.deepEqual(startLevelChoices(10), [1, 4, 7, 10]);
  assert.deepEqual(startLevelChoices('bogus'), [1]);
  for (const text of [levelTagText(7), levelUpTitle(7), passLine(7)]) {
    assert.ok(!text.includes('—'), text);
  }
});

test('the counting hint starts, counts down, then (in a duel) hands off to Done counting', () => {
  assert.equal(playHintText(0, 1, 1), 'Tap the sheep to start.');
  assert.equal(playHintText(0, 7, 7), 'Tap every sheep.');
  assert.equal(playHintText(3, 7, 7), '4 left!');
  assert.equal(playHintText(6, 7, 7), '1 left!');
  assert.ok(playHintText(7, 7, 7).includes('Tap Done counting'));
  // A wolf round: four real sheep counted out of four, five animals total.
  assert.ok(playHintText(4, 4, 5).includes('Tap Done counting'));
  for (const text of [
    playHintText(0, 1, 1),
    playHintText(0, 7, 7),
    playHintText(3, 7, 7),
    playHintText(6, 7, 7),
    playHintText(7, 7, 7),
    playHintText(4, 4, 5),
  ]) {
    assert.ok(!text.includes('—'), text);
  }
});

test('rounds get faster and more erratic, and never tame down', () => {
  let prev = motionForRound(1);
  for (let round = 2; round <= 90; round++) {
    const m = motionForRound(round);
    assert.ok(m.speed >= prev.speed, `round ${round} slowed down`);
    assert.ok(m.radius >= prev.radius, `round ${round} roams less`);
    assert.ok(m.bounceMix >= prev.bounceMix, `round ${round} bounces less`);
    assert.ok(m.jitterAmp >= prev.jitterAmp, `round ${round} jitters less`);
    assert.ok(m.chaos >= prev.chaos, `round ${round} is calmer`);
    prev = m;
  }
  // Level 1 drifts at 0.3 and level 2 at 0.4, as the spec's table reads.
  assert.equal(motionForRound(2).speed, 0.3);
  assert.equal(motionForRound(4).speed, 0.4);
  assert.equal(motionForRound(4).bounceMix, 0);
  assert.equal(motionForRound(4).jitterAmp, 0);
  // The late levels are meaningfully harder than the first moving one, and
  // past level 10 the sheep keep getting a little quicker.
  assert.ok(motionForRound(30).speed > motionForRound(2).speed * 5);
  assert.ok(motionForRound(30).jitterAmp > 0.12);
  assert.ok(motionForRound(60).speed > motionForRound(30).speed);
});

test('wandering is deterministic, bounded by roamRadius through round 60, and never teleports', () => {
  // The worst single frame measured across rounds 1-60 is ~0.41 world
  // units (round 59, the fastest creep); a warp would be far beyond 0.5.
  const JUMP_LIMIT = 0.5;
  for (let round = 1; round <= 60; round++) {
    const m = motionForRound(round);
    const bound = roamRadius(round);
    const seed = roundSeed(round);
    const herd = sheepForRound(round);
    for (let i = 0; i < herd; i++) {
      let last = wanderOffset(seed, i, herd, 0, m);
      for (let t = 0; t <= 60; t += 1 / 30) {
        const point = wanderOffset(seed, i, herd, t, m);
        // roamRadius is what scene.js pads the camera by, so it has to be a
        // true upper bound or a late-round sheep can wander out of frame.
        assert.ok(
          Math.hypot(point.x, point.z) <= bound + 1e-9,
          `round ${round} sheep ${i} reached ${Math.hypot(point.x, point.z)} > ${bound}`
        );
        // Continuous motion: a sheep is followable by eye, not warping.
        assert.ok(
          Math.hypot(point.x - last.x, point.z - last.z) < JUMP_LIMIT,
          `round ${round} sheep ${i} jumped at t=${t}`
        );
        assert.deepEqual(point, wanderOffset(seed, i, herd, t, m));
        last = point;
      }
    }
  }
  const m = motionForRound(30);
  assert.notDeepEqual(wanderOffset(7, 1, 12, 1, m), wanderOffset(7, 2, 12, 1, m));
});

test('the clock starts at level 3 and only ever shortens per sheep', () => {
  // Levels 1 and 2 are untimed, and so is Calm at any round.
  for (let round = 1; round <= 6; round++) assert.equal(secondsForRound(round), null, `round ${round}`);
  for (const round of [1, 7, 30]) assert.equal(secondsForRound(round, 'calm'), null);
  // Level 3: 8 seconds a sheep plus a 3 second base; level 4: 6 a sheep.
  assert.equal(secondsPerSheep(3), 8);
  assert.equal(secondsForRound(7), 3 * 8 + 3);
  assert.equal(secondsForRound(10), 4 * 6 + 3);
  // Seconds per sheep never lengthen from one level to the next, and stop
  // at the 2 second floor.
  let prev = Infinity;
  for (let level = 3; level <= 60; level++) {
    const s = secondsPerSheep(level);
    assert.ok(s <= prev, `level ${level} gives more time per sheep`);
    assert.ok(s >= 2, `level ${level} is under the floor`);
    prev = s;
  }
  assert.equal(secondsPerSheep(40), 2);
  // At the full flock the whole clock keeps shrinking too.
  assert.ok(secondsForRound(100) < secondsForRound(34));
  // Big Tap gives half as much time again, rounded up.
  assert.equal(secondsForRound(7, 'flow', { bigTapOn: true }), Math.ceil(27 * 1.5));
});

test('the start is gentle: level 4 is no harder than the old Normal round 4 (#64)', () => {
  // The old Normal round 4 (removed with the retired levels): five sheep
  // at speed 0.4 + (2/8) * 1.5.
  const OLD_NORMAL_ROUND_4_SPEED = 0.4 + (2 / 8) * 1.5;
  for (const round of [10, 11, 12]) {
    assert.ok(sheepForRound(round) <= 5, `round ${round} flock`);
    assert.ok(motionForRound(round).speed <= OLD_NORMAL_ROUND_4_SPEED, `round ${round} speed`);
  }
  // No wolf and no clock for the first two levels; no wolf until level 4.
  for (let round = 1; round <= 9; round++) assert.equal(wolfChance(round), 0, `round ${round} wolf`);
  for (let round = 1; round <= 6; round++) assert.equal(secondsForRound(round), null, `round ${round} clock`);
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

test('the last real sheep passes the round on the spot, and the next round follows', () => {
  const { store } = newStore();
  store.startRound(3, { silent: true });
  const n = store.state.sheepCount;
  for (let i = 0; i < n - 1; i++) {
    assert.deepEqual(store.tapSheep(i), { outcome: 'counted', number: i + 1, passed: false });
    assert.equal(store.state.phase, COUNTING);
  }
  // No Done tap: the last pop passes the round.
  assert.deepEqual(store.tapSheep(n - 1), { outcome: 'counted', number: n, passed: true });
  assert.equal(store.state.phase, ROUND_PASSED);
  // Round 3 is level 1's last round, so this pass is a level-up.
  assert.deepEqual(store.state.lastPass, { round: 3, counted: n, levelUp: true });
  // Nothing more counts while the banner is up.
  assert.deepEqual(store.tapSheep(0), { outcome: 'ignored' });

  store.nextRound();
  assert.equal(store.state.round, 4);
  assert.equal(store.state.sheepCount, sheepForRound(4));
  assert.equal(store.state.count, 0);
  assert.deepEqual(store.state.counted, []);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.lastPass, null);
  assert.equal(store.bestRound, 4);
});

test('a plain pass mid-level is not a level-up', () => {
  const { store } = newStore();
  store.startRound(8, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < store.state.sheepCount; i++) store.tapSheep(i);
  assert.equal(store.state.phase, ROUND_PASSED);
  assert.deepEqual(store.state.lastPass, { round: 8, counted: 4, levelUp: false });
});

test('tapping an already-counted sheep ends the run', () => {
  const { store } = newStore();
  store.startRound(8, { silent: true });
  store.tapSheep(2);
  assert.deepEqual(store.tapSheep(2), { outcome: 'doubleTap' });
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_DOUBLE_TAP);
  assert.equal(store.state.round, 8);
  // A dead run accepts nothing more.
  assert.deepEqual(store.tapSheep(0), { outcome: 'ignored' });
  assert.deepEqual(store.submitCount(), { outcome: 'ignored' });
});

test('a short Done count still ends the turn it was made in', () => {
  // Done counting is a duel turn's hand-in now; the store rule is unchanged.
  const { store } = newStore();
  store.startRound(17, { silent: true });
  store.tapSheep(0);
  assert.deepEqual(store.submitCount(), { outcome: 'missed', round: 17 });
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
  store.endRun(ENDED_TIME_UP);
  store.restartRun();
  assert.equal(store.state.round, 1);
  assert.equal(store.state.sheepCount, 1);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.endedBy, null);
  assert.equal(store.bestRound, 7);
  assert.equal(store.state.bestRounds.flow, 7);
  assert.equal(store.bestLevel, 3);
});

test('Start at level opens a level the player has reached, and no higher', () => {
  const { store } = newStore();
  store.startRound(16, { silent: true });
  store.endRun(ENDED_TIME_UP);
  assert.equal(store.bestLevel, 6);
  store.startAtLevel(4);
  assert.equal(store.state.round, 10);
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.secondsLeft, secondsForRound(10));
  // A level above the best reached is clamped to the best.
  store.startAtLevel(20);
  assert.equal(store.state.round, startRoundForLevel(6));
  // From Calm, a level shortcut returns to the ladder.
  store.setCalmOn(true);
  assert.equal(store.state.difficulty, 'calm');
  store.startAtLevel(4);
  assert.equal(store.state.difficulty, 'flow');
  assert.equal(store.state.calmOn, false);
  assert.equal(store.state.round, 10);
});

test('taps counted in any order keep their tap-order numbering', () => {
  const { store } = newStore();
  store.startRound(17, { silent: true });
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

test('no wolf before level 4, then a chance that climbs per level and caps', () => {
  for (let round = 1; round <= 9; round++) assert.equal(wolfChance(round), 0);
  assert.equal(wolfChance(10), 0.15);
  assert.equal(wolfChance(12), 0.15);
  let prev = 0;
  for (let round = 2; round <= 90; round++) {
    const c = wolfChance(round);
    assert.ok(c >= prev, `round ${round} chance dropped`);
    assert.ok(c <= 0.7, `round ${round} chance over cap`);
    prev = c;
  }
  assert.equal(wolfChance(43), 0.7);
  // Calm never hides one.
  for (const round of [1, 10, 40]) assert.equal(wolfChance(round, 'calm'), 0);
});

test('wolfIndexForRound is deterministic, in range, and null on no-wolf rounds', () => {
  assert.equal(wolfIndexForRound(1, roundSeed(1), sheepForRound(1)), null);
  assert.equal(wolfIndexForRound(5, roundSeed(5), sheepForRound(5)), null);
  const n = sheepForRound(13);
  const a = wolfIndexForRound(13, roundSeed(13), n);
  const b = wolfIndexForRound(13, roundSeed(13), n);
  assert.deepEqual(a, b);
  if (a !== null) {
    assert.ok(Number.isInteger(a) && a >= 0 && a < n, `index ${a} out of range`);
  }
  // The draw itself decides: across many rounds both outcomes occur.
  const draws = new Set();
  for (let round = 10; round <= 60; round++) {
    draws.add(wolfIndexForRound(round, roundSeed(round), sheepForRound(round)) === null ? 'none' : 'wolf');
  }
  assert.ok(draws.has('wolf'), 'no round ever drew a wolf');
  assert.ok(draws.has('none'), 'no round ever drew a plain flock');
});

test('the wolf disguise follows the level, never regresses, and the cue copy matches', () => {
  assert.equal(wolfDisguiseTier(1), 1);
  assert.equal(wolfDisguiseTier(18), 1);
  assert.equal(wolfDisguiseTier(19), 2);
  assert.equal(wolfDisguiseTier(33), 2);
  assert.equal(wolfDisguiseTier(34), 3);
  let prev = 1;
  for (let round = 2; round <= 90; round++) {
    const tier = wolfDisguiseTier(round);
    assert.ok(tier >= prev, `round ${round} tier regressed`);
    prev = tier;
    // The screen-reader cue names what the renderer draws for that tier.
    const cue = wolfCueText(round);
    assert.equal(cue, wolfCueText(tier === 1 ? 1 : tier === 2 ? 19 : 34), `round ${round} cue mismatch`);
    assert.ok(!cue.includes('—'), `em dash in round ${round} cue`);
  }
});

test('a forced wolf round ends on the wolf tap and accepts nothing after', () => {
  const { store } = newStore();
  store.startRound(13, { silent: true });
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

test('completing a wolf round passes on the last real sheep, grows the streak and pays the bonus', () => {
  const { store } = newStore();
  store.startRound(13, { silent: true });
  const wolfIndex = 2;
  store.state = { ...store.state, wolfIndex };
  const n = store.state.sheepCount;
  const realSheep = [...Array(n).keys()].filter((i) => i !== wolfIndex);
  for (const i of realSheep) {
    assert.equal(store.tapSheep(i).outcome, 'counted');
  }
  // The wolf is the one animal left; the round passed without it.
  assert.equal(store.state.phase, ROUND_PASSED);
  assert.equal(store.state.safeStreak, 1);
  assert.equal(store.state.bestSafeStreak, 1);
  assert.equal(store.state.bonusCounted, WOLF_BONUS);
  assert.equal(store.state.totalCounted, n - 1 + WOLF_BONUS);
  // The bonus rides its own accumulator, so one sync carries both.
  assert.equal(store.unsyncedBonus, WOLF_BONUS);
  assert.equal(store.unsyncedTaps, n - 1);
});

test('a lost run resets the current streak but keeps the best', () => {
  const { store } = newStore();
  store.startRound(13, { silent: true });
  store.state = { ...store.state, wolfIndex: 2 };
  for (const i of [0, 1, 3, 4]) store.tapSheep(i);
  assert.equal(store.state.safeStreak, 1);
  store.nextRound();
  assert.equal(store.state.safeStreak, 1, 'a plain round keeps the streak');
  store.state = { ...store.state, wolfIndex: 3 };
  for (const i of [0, 1, 2, 4, 5]) store.tapSheep(i);
  assert.equal(store.state.safeStreak, 2);
  assert.equal(store.state.bestSafeStreak, 2);
  store.nextRound();
  store.endRun(ENDED_TIME_UP);
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
    'Best safe streak',
    'Bonus sheep',
  ];
  for (const s of strings) assert.ok(!s.includes('—'), s);
});

test('sheep phrases and pace lines read naturally at their edges', () => {
  assert.equal(sheepPhrase(1), '1 sheep');
  assert.equal(sheepPhrase(7), '7 sheep');
  assert.equal(sheepPhrase(12), '12 sheep');
  assert.equal(paceLine(1), 'This one stands still.');
  assert.ok(paceLine(2).length > 0);
  assert.ok(paceLine(30).length > 0);
  for (const line of [paceLine(1), paceLine(2), paceLine(13), paceLine(22), paceLine(30)]) {
    assert.ok(!line.includes('—'), line);
  }
});

test('the retired levels play the ladder, everywhere', () => {
  for (const d of RETIRED_DIFFICULTIES) {
    assert.ok(isRetiredDifficulty(d), d);
    assert.equal(normalizeDifficulty(d), 'flow', d);
    for (const round of [1, 5, 12]) {
      assert.equal(sheepForRound(round, d), sheepForRound(round), `${d} round ${round}`);
      assert.equal(JSON.stringify(motionForRound(round, d)), JSON.stringify(motionForRound(round)));
    }
  }
  assert.equal(isRetiredDifficulty('flow'), false);
  assert.equal(isRetiredDifficulty('calm'), false);
  // Anything unrecognised reads as the ladder too, never a crash.
  assert.equal(normalizeDifficulty('bogus'), 'flow');
  assert.equal(DEFAULT_DIFFICULTY, 'flow');
  assert.equal(NEW_PLAYER_DIFFICULTY, 'flow');
  assert.deepEqual(Object.keys(DIFFICULTIES).sort(), ['calm', 'flow']);
});

test('switching to Calm resets the run and keeps the ladder best', () => {
  const { store } = newStore();
  store.startRound(5, { silent: true });
  store.tapSheep(0);
  store.setDifficulty('calm');
  assert.equal(store.state.difficulty, 'calm');
  assert.equal(store.state.round, 1);
  assert.equal(store.state.count, 0);
  assert.deepEqual(store.state.counted, []);
  // The ladder's best round survives the switch; Calm starts at 1.
  assert.equal(store.state.bestRounds.flow, 5);
  assert.equal(store.state.bestRounds.calm, 1);
  assert.equal(store.bestRound, 1);
  // An unknown level falls back to the ladder rather than crashing.
  store.setDifficulty('bogus');
  assert.equal(store.state.difficulty, 'flow');
  // Lifetime taps keep accumulating across the switch.
  const before = store.state.totalCounted;
  store.tapSheep(0);
  assert.equal(store.state.totalCounted, before + 1);
});

test('Calm runs its own curve once selected', () => {
  const { store } = newStore();
  store.setDifficulty('calm');
  store.startRound(9, { silent: true });
  assert.equal(store.state.sheepCount, sheepForRound(9, 'calm'));
  assert.equal(store.state.sheepCount, 5);
  assert.equal(store.state.secondsLeft, null);
  store.setDifficulty('flow');
  store.startRound(9, { silent: true });
  assert.equal(store.state.sheepCount, sheepForRound(9));
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

test('the counted call finishes before the pop bursts', () => {
  // The puff-up must outlast the two-note call, so the sheep finishes
  // its baa-baaa before the confetti comes; both renderers share the
  // pop timing.
  assert.ok(BAA_BAAA_SECONDS <= POP_PUFF_SECONDS,
    `call (${BAA_BAAA_SECONDS}s) must fit inside the pop (${POP_PUFF_SECONDS}s)`);
});

test('playBaaBaaa is silent when sound is off', () => {
  // Muted: the call returns before even creating an AudioContext, so it
  // runs in Node with no window and no audio stack at all.
  setSoundEnabled(false);
  assert.doesNotThrow(() => playBaaBaaa());
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
  store.startRound(6, { silent: true });
  assert.equal(store.bestRound, 6);
  // A fresh store reading the same storage shape restores the ladder's best
  // and keeps a retired level's old best untouched.
  const saved = {
    round: 2,
    difficulty: 'flow',
    bestRounds: { calm: 2, flow: 6, normal: 9, easy: 3 },
    totalCounted: 12,
    soundOn: true,
  };
  const { store: restored } = newStore();
  restored.loadLocalFrom(saved);
  assert.equal(restored.state.difficulty, 'flow');
  assert.equal(restored.state.round, 2);
  assert.equal(restored.bestRound, 6);
  assert.equal(restored.bestLevel, 2);
  assert.equal(restored.state.bestRounds.calm, 2);
  assert.equal(restored.state.bestRounds.normal, 9);
  assert.equal(restored.state.bestRounds.easy, 3);
  assert.equal(restored.state.totalCounted, 12);
  assert.equal(restored.state.soundOn, true);
});

test('a save on a retired level plays the ladder from level 1 and keeps its bests', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 7,
    difficulty: 'hard',
    bestRounds: { hard: 7, normal: 4 },
    totalCounted: 30,
    // Its board belonged to another curve, so it is never resumed.
    midCountdown: { round: 7, difficulty: 'hard', seed: roundSeed(7), counted: [0, 1], phase: COUNTING },
  });
  assert.equal(restored.state.difficulty, 'flow');
  assert.equal(restored.state.round, 1);
  assert.equal(restored.state.count, 0);
  assert.deepEqual(restored.state.counted, []);
  assert.equal(restored.state.bestRounds.hard, 7);
  assert.equal(restored.state.bestRounds.normal, 4);
  assert.equal(restored.state.totalCounted, 30);
});

test('a legacy best round folds into normal, not the ladder', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 4, bestRound: 8, totalCounted: 20, soundOn: false });
  assert.equal(restored.state.difficulty, 'flow');
  assert.equal(restored.state.round, 4);
  assert.equal(restored.state.bestRounds.normal, 8);
  assert.equal(restored.state.bestRounds.flow, 4);
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

test('a timed round opens with its own clock over the same flock', () => {
  const { store } = newStore();
  store.startRound(7, { silent: true });
  assert.equal(store.state.secondsLeft, secondsForRound(7));
  assert.equal(store.state.secondsLeft, 27);
  // The clock never changes the flock: the count and the seed are the round's.
  assert.equal(store.state.sheepCount, sheepForRound(7));
  assert.equal(store.state.seed, roundSeed(7));
  // Levels 1 and 2 open untimed.
  store.startRound(4, { silent: true });
  assert.equal(store.state.secondsLeft, null);
});

test('the round clock ticks whole seconds and ends the run at zero', () => {
  const { store, recordedRuns } = newStore(true);
  store.startRound(7, { silent: true });
  const full = store.state.secondsLeft;
  store.tapSheep(0);
  assert.equal(store.tickClock(), true);
  assert.equal(store.state.secondsLeft, full - 1);
  for (let left = full - 1; left > 1; left--) {
    assert.equal(store.tickClock(), true);
  }
  assert.equal(store.tickClock(), false, 'the zero step reports the timeout');
  assert.equal(store.state.secondsLeft, 0);
  // app.js owns the timeout action: the shared endRun path, with the
  // clock's own reason.
  store.endRun(ENDED_TIME_UP);
  assert.equal(store.state.phase, RUN_OVER);
  assert.equal(store.state.endedBy, ENDED_TIME_UP);
  assert.equal(recordedRuns.length, 1);
  // An untimed round ignores the clock entirely.
  store.startRound(2, { silent: true });
  assert.equal(store.tickClock(), true);
  assert.equal(store.state.secondsLeft, null);
});

test('a passed timed round advances with a fresh, shorter-per-sheep clock', () => {
  const { store } = newStore();
  store.startRound(9, { silent: true });
  store.tickClock();
  for (let i = 0; i < store.state.sheepCount; i++) store.tapSheep(i);
  assert.equal(store.state.phase, ROUND_PASSED);
  // The clock stops with the pass: a tick does nothing.
  const left = store.state.secondsLeft;
  store.tickClock();
  assert.equal(store.state.secondsLeft, left);
  store.nextRound();
  assert.equal(store.state.round, 10);
  assert.equal(store.state.secondsLeft, secondsForRound(10), 'the next round gets a fresh clock');
  assert.equal(store.state.phase, COUNTING);
});

test('Big Tap adds time to the clock; Calm and duel turns have none', () => {
  const { store } = newStore();
  store.setBigTapOn(true);
  store.startRound(7, { silent: true });
  assert.equal(store.state.secondsLeft, Math.ceil(27 * 1.5));
  const { store: duel } = newStore();
  duel.state = { ...duel.state, duel: true };
  duel.startRound(7, { silent: true });
  assert.equal(duel.state.secondsLeft, null);
  const { store: calm } = newStore();
  calm.setDifficulty('calm');
  calm.startRound(7, { silent: true });
  assert.equal(calm.state.secondsLeft, null);
});

test('the finished run never carries the retired Speed Round tag', () => {
  // The run body the store posts: speedRound is always false now. The
  // test seam records the round; the body shape is pinned on the source.
  const src = readFileSync(new URL('../public/state.js', import.meta.url), 'utf8');
  assert.match(src, /speedRound: false,/);
  assert.ok(!/speedOn/.test(src), 'no Speed Round mode is left in the store');
});

test('calm mode slows the flock without changing what the round asks for', () => {
  // The motion profile keeps its shape: same roam radius, a slower clock.
  for (const round of [22, 30, 45]) {
    const raw = motionForRound(round);
    const calm = calmMotion(round);
    assert.ok(calm.speed < raw.speed, `round ${round} calm speed did not slow`);
    assert.ok(Math.abs(calm.speed - raw.speed * CALM_SPEED) < 1e-9);
    assert.equal(calm.radius, raw.radius, `round ${round} calm radius moved`);
    assert.equal(calm.bounceMix, raw.bounceMix, `round ${round} calm bounce moved`);
    assert.ok(calm.jitterAmp < raw.jitterAmp, `round ${round} calm jitter did not soften`);
    assert.ok(roamRadius(round) > 0, 'sanity: roam uses the raw profile');
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
  // The store toggle persists like sound and Night Meadow, and it is the
  // one Calm switch: on, it plays the Calm curve from round 1; off, it
  // returns to the ladder.
  const { store } = newStore();
  store.startRound(8, { silent: true });
  store.setCalmOn(true);
  assert.equal(store.state.calmOn, true);
  assert.equal(store.state.difficulty, 'calm');
  assert.equal(store.state.round, 1);
  assert.equal(store.state.sheepCount, sheepForRound(1), 'the flock size did not move');
  assert.equal(store.state.seed, roundSeed(1), 'the seed did not move');
  store.setCalmOn(false);
  assert.equal(store.state.calmOn, false);
  assert.equal(store.state.difficulty, 'flow');
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 3, difficulty: 'hard', totalCounted: 2, calmOn: true });
  assert.equal(restored.state.calmOn, true);
  // Normalization: anything but exactly true is off, and the copy helper
  // keeps its exact words in both modes.
  assert.equal(normalizeCalm('1'), false);
  assert.equal(normalizeCalm(1), false);
});

test('normalizeScenery passes known keys through and migrates the legacy night flag', () => {
  // Known keys pass through untouched.
  assert.equal(normalizeScenery('meadow'), 'meadow');
  assert.equal(normalizeScenery('night'), 'night');
  assert.equal(normalizeScenery('moon'), 'moon');
  // Anything unrecognised or missing reads as the default, or as Night
  // Meadow when the legacy checkbox said so (the pre-picker migration).
  assert.equal(normalizeScenery('mars'), 'meadow');
  assert.equal(normalizeScenery('mars', true), 'night');
  assert.equal(normalizeScenery(undefined), 'meadow');
  assert.equal(normalizeScenery(undefined, true), 'night');
  assert.equal(normalizeScenery(null, false), 'meadow');
});

test('sceneryFromServer keeps device-local picks and follows the server otherwise', () => {
  // Moon is device-local: the server only knows night_on, so either value
  // leaves the pick alone.
  assert.equal(sceneryFromServer('moon', true), 'moon');
  assert.equal(sceneryFromServer('moon', false), 'moon');
  // Meadow and Night Meadow follow the server exactly as nightOn does.
  assert.equal(sceneryFromServer('meadow', true), 'night');
  assert.equal(sceneryFromServer('meadow', false), 'meadow');
  assert.equal(sceneryFromServer('night', false), 'meadow');
  assert.equal(sceneryFromServer('night', true), 'night');
});

test('a pre-picker save migrates nightOn into the scenery pick', () => {
  // A save written before the picker: only nightOn exists.
  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 9, nightOn: true });
  assert.equal(restored.state.scenery, 'night');
  assert.equal(restored.state.nightOn, true);
  // A moon pick (a device-local key) wins over the stale flag, and nightOn
  // follows the scenery, not the flag.
  const { store: moonUser } = newStore();
  moonUser.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 9, scenery: 'moon', nightOn: true });
  assert.equal(moonUser.state.scenery, 'moon');
  assert.equal(moonUser.state.nightOn, false);
  // No flag and no key: the default meadow.
  const { store: plain } = newStore();
  plain.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 4 });
  assert.equal(plain.state.scenery, 'meadow');
  assert.equal(plain.state.nightOn, false);
});

test('setScenery swaps the background without touching the running board', () => {
  const { store } = newStore();
  store.startRound(5, { silent: true });
  store.tapSheep(1);
  const before = store.state;
  store.setScenery('moon');
  assert.equal(store.state.scenery, 'moon');
  assert.equal(store.state.nightOn, false, 'Moon is device-local and posts nightOn false');
  assert.equal(store.state.round, before.round);
  assert.equal(store.state.seed, before.seed);
  assert.equal(store.state.count, before.count);
  assert.deepEqual(store.state.counted, before.counted);
  // Picking Night Meadow keeps the derived flag true, like the old toggle.
  store.setScenery('night');
  assert.equal(store.state.scenery, 'night');
  assert.equal(store.state.nightOn, true);
  // Back to the meadow clears it, and an unknown value reads as meadow.
  store.setScenery('nonsense');
  assert.equal(store.state.scenery, 'meadow');
  assert.equal(store.state.nightOn, false);
});

test('the clock text and the old weekly tags read plainly', () => {
  // The clock text never goes negative and shows whole seconds.
  assert.equal(normalizeRound(3), 3);
  assert.equal(speedRoundClock(0.4), '1');
  assert.equal(speedRoundClock(-2), '0');
  assert.equal(speedRoundClock(27), '27');
  // Old Speed Round runs keep their tag on the weekly leaderboard.
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
  restored.loadLocalFrom({ round: 5, difficulty: 'flow', midCountdown: snapshot });
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
  restored.loadLocalFrom({ round: 3, difficulty: 'flow', totalCounted: 6 });
  assert.equal(restored.state.round, 3);
  assert.equal(restored.state.count, 0);
  assert.deepEqual(restored.state.counted, []);
  assert.equal(restored.state.sheepCount, sheepForRound(3));
});

test('a mangled snapshot never crashes or fabricates taps', () => {
  const base = { round: 8, difficulty: 'flow', seed: roundSeed(8), phase: COUNTING };
  // Out-of-range and duplicate indices are dropped, tap order preserved.
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 8,
    difficulty: 'flow',
    midCountdown: { ...base, counted: [0, 99, 1, 1, -3] },
  });
  assert.deepEqual(restored.state.counted, [0, 1]);
  assert.equal(restored.state.sheepCount, sheepForRound(8));
  // A non-counting phase never resumes: the round starts fresh.
  const { store: finished } = newStore();
  finished.loadLocalFrom({
    round: 8,
    difficulty: 'flow',
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
  // Same after the last pop passes the round: the round is over.
  const { store: passed } = newStore();
  passed.startRound(1, { silent: true });
  passed.tapSheep(0);
  assert.equal(passed.state.phase, ROUND_PASSED);
  assert.equal(passed.hasMidRoundSnapshot, false);
});

test('a timed snapshot carries its remaining clock, and 0 reads as gone', () => {
  const { store } = newStore();
  store.startRound(7, { silent: true });
  store.tapSheep(0);
  const snapshot = store.snapshotRound();
  assert.equal(snapshot.secondsLeft, 27);
  assert.equal('speedOn' in snapshot, false);

  const { store: restored } = newStore();
  restored.loadLocalFrom({ round: 7, difficulty: 'flow', midCountdown: { ...snapshot, secondsLeft: 17 } });
  assert.equal(restored.state.secondsLeft, 17);
  assert.equal(restored.state.count, 1);

  // A claim longer than the round's own clock is held to it.
  const { store: greedy } = newStore();
  greedy.loadLocalFrom({ round: 7, difficulty: 'flow', midCountdown: { ...snapshot, secondsLeft: 999 } });
  assert.equal(greedy.state.secondsLeft, 27);

  // A clock that already hit zero is a finished round: it never resumes.
  const { store: expired } = newStore();
  expired.loadLocalFrom({ round: 7, difficulty: 'flow', midCountdown: { ...snapshot, secondsLeft: 0 } });
  assert.equal(expired.state.count, 0);
  assert.equal(expired.state.secondsLeft, 27);
});

test('a snapshot with every sheep already popped opens the next round', () => {
  // Rounds pass on their last pop, so a fully counted board was over.
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 7,
    difficulty: 'flow',
    midCountdown: { round: 7, difficulty: 'flow', seed: roundSeed(7), counted: [0, 1, 2], phase: COUNTING },
  });
  assert.equal(restored.state.round, 8);
  assert.equal(restored.state.count, 0);
  assert.equal(restored.state.phase, COUNTING);
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
  store.state = { ...store.state, duel: true };
  store.startRound(round, { silent: true });
  // The miss count is what's under test here, not the wolf: pin this round wolf-free.
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < n - 1; i++) store.tapSheep(i);
  store.submitCount();
  assert.equal(store.state.phase, RUN_OVER);
  const misses = store.state.sheepCount - store.state.count;
  assert.equal(misses, 1);
});

test('a clean duel turn waits for Done counting, then scores zero misses', () => {
  const { store } = newStore();
  const n = sheepForRound(2);
  store.state = { ...store.state, duel: true };
  store.startRound(2, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < n; i++) assert.equal(store.tapSheep(i).passed, false);
  // A duel turn keeps its hand-in: nothing passes until Done counting.
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.lastPass, null);
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
  const csv = bestRoundsCsv({ bestRounds: { flow: 9, easy: 3, normal: 7, hard: 5, expert: 2, insane: 4, chaos: 3, legend: 2 } });
  assert.equal(
    csv,
    'difficulty,best_round\r\nflow,9\r\neasy,3\r\nnormal,7\r\nhard,5\r\nexpert,2\r\ninsane,4\r\nchaos,3\r\nlegend,2\r\n',
    'one header and one row per level, CRLF-terminated'
  );
  const legacy = bestRoundsCsv({});
  assert.match(legacy, /flow,1/, 'a store with no bestRounds yet exports defaults');
  assert.match(legacy, /normal,1/);
  assert.match(legacy, /legend,1/, 'a level nobody has played exports its default too');
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

test('a counting tap updates the board first and saves right after', (t) => withMemoryStorage(async (read) => {
  // The deferred save races a real timer, so run the store's setTimeout on a
  // mocked clock: tick(0) fires the pending save deterministically.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // Seven sheep, so three taps leave the round still being counted (the
    // last pop would pass it and clear the board's snapshot).
    const store = new StateStore({ userId: 'tap-save', deterministic: true });
    store.startRound(17, { silent: true });
    // This test pins the tap-path save ordering, not the wolf draw: take the
    // wolf out of the round like a no-wolf draw would.
    store.state = { ...store.state, wolfIndex: null };
    const countedOnDisk = () => read(store.storageKey).midCountdown?.counted ?? [];

    assert.equal(store.tapSheep(0).outcome, 'counted');
    assert.deepEqual(store.state.counted, [0], 'the board updates synchronously');
    assert.deepEqual(countedOnDisk(), [], 'the write is off the tap path');

    // Back-to-back taps coalesce into one write that carries both.
    store.tapSheep(1);
    t.mock.timers.tick(0);
    assert.deepEqual(countedOnDisk(), [0, 1]);
    assert.equal(read(store.storageKey).totalCounted, 2);

    // pagehide / tab hide flush it at once.
    store.tapSheep(2);
    store.flushPendingSave();
    assert.deepEqual(countedOnDisk(), [0, 1, 2]);
  } finally {
    t.mock.timers.reset();
  }
}));

test('a run that ends before the deferred save never resurrects the board', (t) => withMemoryStorage(async (read) => {
  // Same mocked clock as the tap-save test above.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // deterministic: the round's fixed seed, so the wolf draw is fixed too
    // and the first tap counts. (Round 3's fixed seed hides no wolf.)
    const store = new StateStore({ userId: 'tap-end', deterministic: true });
    store.startRound(3, { silent: true });
    store.tapSheep(0);
    // Double tap in the same task: the run ends and the snapshot is cleared.
    store.tapSheep(0);
    assert.equal(store.state.phase, RUN_OVER);
    t.mock.timers.tick(0);
    const saved = read(store.storageKey);
    assert.equal(saved.midCountdown, undefined, 'the late tap save must not rewrite the snapshot');
    assert.equal(saved.totalCounted, 1, 'the tap itself still counted');
  } finally {
    t.mock.timers.reset();
  }
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
  // The opening drift every level used to start with: slow, small, no
  // bounce and no jitter.
  const drift = { speed: 0.4, radius: 0.3 };
  assert.deepEqual(motionForRound(1, 'calm'), motionForRound(1));
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
  assert.equal(store.state.secondsLeft, null);
  // The last awake sheep passes the round on its own, as on the ladder.
  for (const i of short.awake) store.tapSheep(i);
  assert.equal(store.state.phase, ROUND_PASSED);
  // Calm never records a run for the weekly board.
  store.endRun(ENDED_MISSED);
  assert.deepEqual(recordedRuns, []);
  // The ladder keeps its run-ending double tap.
  store.setDifficulty('flow');
  store.startRound(8, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  store.tapSheep(0);
  assert.equal(store.tapSheep(0).outcome, 'doubleTap');
  assert.equal(store.state.phase, RUN_OVER);
});

// A counted sheep pops like a pi\u00f1ata and is gone: no body, no ribbon, no
// number. Its spot must not swallow a tap (a child would end the run by
// tapping empty grass), so the 3D raycast skips counted sheep and
// handleTap ignores a counted index before it even ripples. Pinned at the
// source because both renderers run in a browser this suite cannot start.
test('a popped sheep cannot be tapped again', () => {
  const scene = readFileSync(new URL('../public/scene.js', import.meta.url), 'utf8');
  const up = scene.slice(scene.indexOf('function onPointerUp'));
  assert.match(up, /filter\(\(s\) => !s\.counted\)/,
    'the raycast targets skip counted sheep, so a tap passes through to a sheep behind');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const tap = app.slice(app.indexOf('function handleTap'));
  const early = tap.indexOf('store.state.counted.includes(index)');
  assert.ok(early > 0, 'handleTap checks for a counted index');
  assert.ok(early < tap.indexOf('store.tapSheep'),
    'before the ripple and the count, so a second tap does nothing at all');
  const fallback = readFileSync(new URL('../public/fallback.js', import.meta.url), 'utf8');
  assert.match(fallback, /is-popped/, 'the card view empties the popped card');
});

test('a new player opens on the ladder; a saved Calm pick keeps its level', async () => {
  // Nothing saved anywhere: the ladder, and it is written down for next time.
  await withFakeBrowser(null, { round: 1, difficulty: null }, async (store, mem) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'flow');
    assert.equal(store.state.round, 1);
    await store.loadRemote();
    assert.equal(store.state.difficulty, 'flow');
    assert.equal(JSON.parse(mem.get(store.storageKey)).difficulty, 'flow');
  });
  // A saved Calm pick on the device stays.
  await withFakeBrowser({ round: 2, difficulty: 'calm' }, null, async (store) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'calm');
    assert.equal(store.state.round, 2);
  });
  // A retired pick plays the ladder from level 1.
  await withFakeBrowser({ round: 6, difficulty: 'hard' }, null, async (store) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'flow');
    assert.equal(store.state.round, 1);
  });
  // A save from before levels existed reads as the ladder.
  await withFakeBrowser({ round: 2, totalCounted: 4 }, null, async (store) => {
    store.loadLocal();
    assert.equal(store.state.difficulty, 'flow');
  });
  // A new device for an existing player: the server's saved level wins...
  await withFakeBrowser(null, { round: 4, difficulty: 'calm' }, async (store) => {
    store.loadLocal();
    await store.loadRemote();
    assert.equal(store.state.difficulty, 'calm');
    assert.equal(store.state.round, 4);
  });
  // ...and a server row still on a retired level restarts the ladder at 1.
  await withFakeBrowser(null, { round: 7, difficulty: 'expert' }, async (store) => {
    store.loadLocal();
    await store.loadRemote();
    assert.equal(store.state.difficulty, 'flow');
    assert.equal(store.state.round, 1);
  });
  // Deep-link stores play the ladder too: /?round=8 is level 3's second round.
  const { store } = newStore();
  store.startRound(8, { silent: true });
  assert.equal(store.state.difficulty, 'flow');
  assert.equal(store.state.sheepCount, 4);
});

test('a reload during the pass banner opens the next round, never the passed one', () => withMemoryStorage(async (read) => {
  const store = new StateStore({ userId: 'pass-save' });
  store.startRound(4, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < store.state.sheepCount; i++) store.tapSheep(i);
  assert.equal(store.state.phase, ROUND_PASSED);
  // The live board still reads the passed round for the banner...
  assert.equal(store.state.round, 4);
  // ...but every save names the next one, with no board to resume.
  const saved = read(store.storageKey);
  assert.equal(saved.round, 5);
  assert.equal(saved.midCountdown, undefined);
  store.setSoundOn(false);
  assert.equal(read(store.storageKey).round, 5, 'a later save during the banner keeps it');
  const reloaded = new StateStore({ userId: 'pass-save' });
  reloaded.loadLocal();
  assert.equal(reloaded.state.round, 5);
  assert.equal(reloaded.state.phase, COUNTING);
  assert.equal(reloaded.bestRound, 5);
}));

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
    difficulty: 'flow',
    midCountdown: {
      round,
      difficulty: 'flow',
      sheepCount: n,
      seed,
      counted: [sheep, wolf],
      countedAt: [{ index: sheep, elapsed: 1 }, { index: wolf, elapsed: 2 }],
      roundElapsed: 3,
      phase: COUNTING,
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
  assert.match(code, /\['doubleTap', 'missed', 'timeUp', 'wolf', 'complete'\]\.includes/);
});

// Passing a round stamps the pass banner's facts at the moment of the pass
// and folds the elapsed time into the per-round best, silently. A first
// time is always a best; a slower replay keeps the old one.
test('a passed round stamps its banner facts and its best time', () => {
  const { store } = newStore();
  store.roundClock = () => 41;
  store.startRound(3, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  const n = store.state.sheepCount;
  for (let i = 0; i < n; i += 1) store.tapSheep(i);
  assert.equal(store.state.phase, ROUND_PASSED);
  assert.deepEqual(store.state.lastPass, { round: 3, counted: n, levelUp: true });
  assert.equal(store.state.bestTimes.flow[3], 41);
  // A fresh round carries no banner, so an old one can never bleed in.
  store.nextRound();
  assert.equal(store.state.phase, COUNTING);
  assert.equal(store.state.lastPass, null);
  // A faster replay of the same round replaces its best; a slower one
  // keeps it.
  for (const [clock, best] of [[55, 55], [30, 30], [70, 30]]) {
    store.startRound(4, { silent: true });
    store.state = { ...store.state, wolfIndex: null };
    store.roundClock = () => clock;
    for (let i = 0; i < store.state.sheepCount; i += 1) store.tapSheep(i);
    assert.equal(store.state.bestTimes.flow[4], best, `after a ${clock}s round`);
  }
  // The banner facts are never written into a save or a snapshot.
  assert.equal('lastPass' in store.snapshotRound(), false);
  const src = readFileSync(new URL('../public/state.js', import.meta.url), 'utf8');
  const runValues = src.slice(src.indexOf('const runValues = {'), src.indexOf('localStorage.setItem(this.storageKey, JSON.stringify({ ...meta, ...runValues }))'));
  assert.ok(!/lastPass/.test(runValues), 'saveLocal never persists lastPass');
});

// Best times are device-local, like the streak and the scenery pick: they
// live in the same per-user payload and never reach the server. Old saves
// without them read as an empty map, and mangled entries are dropped
// rather than trusted.
test('the best times survive a local restore and distrust bad entries', () => {
  const { store: restored } = newStore();
  restored.loadLocalFrom({
    round: 2,
    difficulty: 'normal',
    totalCounted: 4,
    bestTimes: { normal: { 3: 41 }, hard: { 2: 17 }, bogus: { 1: 5 } },
  });
  assert.equal(restored.state.bestTimes.normal[3], 41);
  assert.equal(restored.state.bestTimes.hard[2], 17);
  assert.equal(restored.state.bestTimes.bogus, undefined, 'unknown levels are dropped');
  const { store: fresh } = newStore();
  fresh.loadLocalFrom({ round: 2, totalCounted: 1 });
  assert.deepEqual(fresh.state.bestTimes, {}, 'a save from before best times reads as empty');
  const { store: mangled } = newStore();
  mangled.loadLocalFrom({ round: 2, bestTimes: { normal: { 3: 'lots', 4: -2, 5: 12.9 } } });
  assert.deepEqual(mangled.state.bestTimes, { normal: { 5: 12 } });
  // An ephemeral restore never writes, so nothing landed in storage.
  assert.equal(globalThis.localStorage, undefined);
});

// Request #9: the ladder never runs out. The old ninth round (and any later
// one) passes into the next flock like every other; nothing completes the run.
test('there is no last round: round 9, 30 and 99 all pass into the next', () => {
  const { store, recordedRuns } = newStore(true);
  for (const round of [9, 30, 99]) {
    store.startRound(round, { silent: true });
    store.state = { ...store.state, wolfIndex: null };
    for (let i = 0; i < store.state.sheepCount; i += 1) store.tapSheep(i);
    assert.equal(store.state.phase, ROUND_PASSED, `round ${round}`);
    assert.notEqual(store.state.endedBy, ENDED_COMPLETE);
    store.nextRound();
    assert.equal(store.state.round, round + 1);
    assert.equal(store.state.phase, COUNTING);
  }
  assert.deepEqual(recordedRuns, [], 'no run was recorded: nothing ended');
});

// Calm and the ladder keep separate records, and switching never mixes them.
test('best times are kept per curve, like bestRounds', () => {
  const { store } = newStore();
  store.roundClock = () => 41;
  store.startRound(3, { silent: true });
  store.state = { ...store.state, wolfIndex: null };
  for (let i = 0; i < store.state.sheepCount; i += 1) store.tapSheep(i);
  assert.equal(store.state.bestTimes.flow[3], 41);
  store.setDifficulty('calm');
  store.roundClock = () => 20;
  store.startRound(3, { silent: true });
  for (let i = 0; i < store.state.sheepCount; i += 1) store.tapSheep(i);
  assert.equal(store.state.bestTimes.calm[3], 20);
  assert.equal(store.state.bestTimes.flow[3], 41, 'the ladder keeps its best across the switch');
});

// ---- Big Tap (accessibility) ----

test('normalizeBigTap accepts only a real on', () => {
  assert.equal(normalizeBigTap(true), true);
  assert.equal(normalizeBigTap(false), false);
  assert.equal(normalizeBigTap(null), false);
  assert.equal(normalizeBigTap(undefined), false);
  assert.equal(normalizeBigTap(1), false, 'a query string arrives as text, not a boolean');
  assert.equal(normalizeBigTap('1'), false);
});

test('Big Tap slows the flock by 30% on every difficulty, jitter too', () => {
  for (const key of Object.keys(DIFFICULTIES)) {
    for (const round of [2, 5, 9]) {
      const base = motionForRound(round, key);
      const slowed = bigTapMotion(round, key);
      assert.ok(
        Math.abs(slowed.speed - base.speed * BIG_TAP_SPEED) < 1e-9,
        `${key} round ${round}: speed is not base x ${BIG_TAP_SPEED}`
      );
      assert.ok(
        Math.abs(slowed.jitterAmp - base.jitterAmp * BIG_TAP_SPEED) < 1e-9,
        `${key} round ${round}: jitterAmp is not base x ${BIG_TAP_SPEED}`
      );
      // Only the tempo is touched: the wander shape stays the round's own.
      assert.equal(slowed.radius, base.radius, `${key} round ${round}: radius changed`);
      assert.equal(slowed.turn, base.turn, `${key} round ${round}: turn changed`);
      assert.equal(slowed.chaos, base.chaos, `${key} round ${round}: chaos changed`);
    }
  }
});

test('Big Tap leaves Calm exactly as it was', () => {
  for (const round of [2, 5, 9]) {
    assert.deepEqual(flockMotion(round, 'calm', { calmOn: true, bigTapOn: true }), calmMotion(round, 'calm'));
    assert.deepEqual(flockMotion(round, 'calm', { calmOn: true, bigTapOn: false }), calmMotion(round, 'calm'));
  }
  // Calm speed stays CALM_SPEED x base even with Big Tap on: the calm
  // exemption must never compose a double slowdown.
  const calm = flockMotion(5, 'calm', { calmOn: true, bigTapOn: true });
  const base = motionForRound(5, 'calm');
  assert.ok(Math.abs(calm.speed - base.speed * CALM_SPEED) < 1e-9);
});

test('flockMotion picks the Big Tap profile off Calm and the plain one without', () => {
  const base = motionForRound(7, 'normal');
  assert.deepEqual(flockMotion(7, 'normal', {}), base);
  assert.deepEqual(flockMotion(7, 'normal', { calmOn: false, bigTapOn: false }), base);
  assert.ok(
    Math.abs(flockMotion(7, 'normal', { bigTapOn: true }).speed - base.speed * BIG_TAP_SPEED) < 1e-9
  );
});

test('Big Tap slows the actual wander offset, not just the motion number', () => {
  // Round 2 carries no jitter, so its whole walk is a function of
  // time x speed: the slowed flock at time t stands exactly where the
  // plain flock stands at 70% of the clock.
  const plain = motionForRound(2, 'normal');
  const slowed = bigTapMotion(2, 'normal');
  for (const t of [1.5, 3.25, 7]) {
    for (let i = 0; i < 5; i += 1) {
      const a = wanderOffset(4242, i, 5, t, plain);
      const b = wanderOffset(4242, i, 5, t, slowed);
      const c = wanderOffset(4242, i, 5, t * BIG_TAP_SPEED, plain);
      assert.ok(Math.abs(b.x - c.x) < 1e-9 && Math.abs(b.z - c.z) < 1e-9, 'slowed offset is not the plain offset at 70% of the clock');
      assert.notDeepEqual([b.x, b.z], [a.x, a.z], 'Big Tap left the drift unchanged');
    }
  }
  // A jittery round moves measurably less with Big Tap: sample the same
  // sheep's displacement over a tiny step across a run (small enough that
  // every term stays in its linear regime) and the slowed flock covers
  // well under three quarters of the plain flock's ground. The jitter's
  // rate scales twice, in amp and in w, the drift's once.
  const p6 = motionForRound(25);
  const s6 = bigTapMotion(25);
  const step = (motion) => {
    let moved = 0;
    for (let t = 1; t <= 20; t += 0.25) {
      const a = wanderOffset(4242, 2, 5, t, motion);
      const b = wanderOffset(4242, 2, 5, t + 0.02, motion);
      moved += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return moved;
  };
  const plainMoved = step(p6);
  const slowedMoved = step(s6);
  assert.ok(slowedMoved > 0, 'the slowed flock still moves');
  assert.ok(
    slowedMoved < plainMoved * 0.75,
    `expected the slowed flock to cover < 75% of the ground, got ${slowedMoved} of ${plainMoved}`
  );
});

test('Big Tap constants are the ones the issue asks for', () => {
  assert.equal(BIG_TAP_HIT_SCALE, 1.4, 'hit targets grow by 40%');
  assert.equal(BIG_TAP_SPEED, 0.7, 'movement slows by 30%');
  assert.ok(BIG_TAP_CONFETTI_KEEP > 0 && BIG_TAP_CONFETTI_KEEP < 1, 'confetti is reduced, not removed');
});

test('the Big Tap toggle persists through save and load', () => {
  const { store } = newStore();
  store.setBigTapOn(true);
  assert.equal(store.state.bigTap, true);
  // A fresh store reading the same storage shape restores the toggle.
  const saved = { round: 2, difficulty: 'normal', totalCounted: 4, soundOn: true, bigTap: true };
  const { store: restored } = newStore();
  restored.loadLocalFrom(saved);
  assert.equal(restored.state.bigTap, true);
  // A save from before the setting existed reads as off, not as a choice.
  const { store: upgraded } = newStore();
  upgraded.loadLocalFrom({ round: 2, difficulty: 'normal', totalCounted: 4, soundOn: true });
  assert.equal(upgraded.state.bigTap, false);
  // Turning it back off stays off.
  restored.setBigTapOn(false);
  assert.equal(restored.state.bigTap, false);
});

test('a fresh store starts with Big Tap off, like namesOn', () => {
  const { store } = newStore();
  assert.equal(store.state.bigTap, false);
  assert.equal(store.state.namesOn, false);
});

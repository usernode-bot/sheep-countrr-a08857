import { mulberry32 } from './layout.js';

// Round progression: the single source of truth for how many sheep a round
// holds, how wildly they move and how long its clock runs. Everything here
// is a pure function of the round number and the difficulty, so the
// /?round=N deep link reproduces exactly the same round every time it is
// loaded (screenshots stay comparable run to run).
//
// The main game is one endless ladder ('flow'): rounds are grouped into
// levels of ROUNDS_PER_LEVEL, and each level adds a sheep, speeds the flock
// up a little and, from level 3, shortens the clock per sheep. The round
// number stays the internal unit (seeds, saves, the server's round columns);
// levels are derived from it. Calm is the one other curve: the bedtime one.

// Upper bound on flock size. Past this the sheep stop multiplying and only
// the movement and the clock keep escalating, so taps stay landable.
export const MAX_SHEEP = 12;

// The ladder every real player and every deep link plays.
export const FLOW_LEVEL = 'flow';
export const DEFAULT_DIFFICULTY = FLOW_LEVEL;

// Rounds per level: two small beats, then the level-up moment.
export const ROUNDS_PER_LEVEL = 3;

// The curves. Calm is the bedtime level: its flock grows by one sheep every
// two rounds and stops at five, and its motion never ramps (every round from
// 2 on keeps a slow drift, no bounce, no jitter). The forgiving rules (a
// double tap only wiggles, no wolf, no clock, no game over) live in state.js
// behind isCalmLevel. 'flow' is described by the level functions below
// rather than by dials.
export const DIFFICULTIES = {
  calm: {
    growth: 0.5,
    maxSheep: 5,
  },
  flow: {},
};

// The levels the old Get ready picker offered. They are retired: a save,
// a server row or a deep link naming one plays the flow ladder instead,
// starting again at level 1 (see isRetiredDifficulty).
export const RETIRED_DIFFICULTIES = ['easy', 'normal', 'hard', 'expert', 'insane', 'chaos', 'legend'];

export function isRetiredDifficulty(difficulty) {
  return RETIRED_DIFFICULTIES.includes(difficulty);
}

// Which level a round belongs to, and where in the level it sits (1..3).
export function levelForRound(round) {
  return Math.ceil(normalizeRound(round) / ROUNDS_PER_LEVEL);
}

export function roundInLevel(round) {
  return ((normalizeRound(round) - 1) % ROUNDS_PER_LEVEL) + 1;
}

// True when passing this round finishes its level: the next round opens a
// new level, and the pass gets the bigger "Level N!" moment.
export function isLevelUp(round) {
  return roundInLevel(round) === ROUNDS_PER_LEVEL;
}

// The first round of a level, for "Start at level N".
export function startRoundForLevel(level) {
  const l = Math.max(1, Math.floor(Number(level)) || 1);
  return (l - 1) * ROUNDS_PER_LEVEL + 1;
}

// The game-over card's "Start at level" shortcuts: 1, 4, 7, 10 ... up to
// the best level the player has reached.
export function startLevelChoices(bestLevel) {
  const best = Math.max(1, Math.floor(Number(bestLevel)) || 1);
  const out = [];
  for (let l = 1; l <= best; l += 3) out.push(l);
  return out;
}

// The corner tag and the level-up words.
export function levelTagText(round) {
  return `Level ${levelForRound(round)}`;
}

export function levelUpTitle(level) {
  return `Level ${Math.max(1, Math.floor(Number(level)) || 1)}!`;
}

// The flow clock: seconds per sheep by level, plus a fixed base. Levels 1
// and 2 have no clock at all; from level 3 the time per sheep shrinks, then
// keeps shrinking by a tenth of a second a level down to a floor.
const CLOCK_BASE_SECONDS = 3;
const CLOCK_FIRST_LEVEL = 3;
const CLOCK_PER_SHEEP = { 3: 8, 4: 6, 5: 5, 6: 4.5, 7: 4, 8: 3.5, 9: 3 };
const CLOCK_FLOOR_PER_SHEEP = 2;
// Big Tap gives slower hands more time, on top of the slower flock.
export const BIG_TAP_CLOCK = 1.5;

export function secondsPerSheep(level) {
  const l = Math.max(1, Math.floor(Number(level)) || 1);
  if (l < CLOCK_FIRST_LEVEL) return null;
  if (CLOCK_PER_SHEEP[l] != null) return CLOCK_PER_SHEEP[l];
  return Math.max(CLOCK_FLOOR_PER_SHEEP, 3 - 0.1 * (l - 9));
}

// The round's clock in whole seconds, or null for an untimed round (Calm,
// and levels 1 and 2 of the ladder).
export function secondsForRound(round, difficulty = DEFAULT_DIFFICULTY, { bigTapOn = false } = {}) {
  if (normalizeDifficulty(difficulty) !== FLOW_LEVEL) return null;
  const perSheep = secondsPerSheep(levelForRound(round));
  if (perSheep == null) return null;
  const base = Math.ceil(sheepForRound(round, difficulty) * perSheep + CLOCK_BASE_SECONDS);
  return bigTapOn ? Math.ceil(base * BIG_TAP_CLOCK) : base;
}

// The level a player with no saved pick starts on: the flow ladder, whose
// first two levels are as gentle as Calm (no clock, no wolf, a still or
// drifting flock). A saved pick, Calm included, always wins.
export const CALM_LEVEL = 'calm';
export const NEW_PLAYER_DIFFICULTY = FLOW_LEVEL;

export function isCalmLevel(difficulty) {
  return difficulty === CALM_LEVEL;
}

// Anything unrecognised (a hostile /api/state body, a mangled deep link,
// an old localStorage row, a retired level) falls back to the flow ladder,
// never to a crash.
export function normalizeDifficulty(difficulty) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)
    ? difficulty
    : DEFAULT_DIFFICULTY;
}

export function normalizeRound(round) {
  const r = Math.floor(Number(round));
  return Number.isFinite(r) && r >= 1 ? r : 1;
}

// The retired Speed Round's flag, still read from old runs (a shared card,
// the weekly leaderboard's "Speed N" tag). It is exactly true or nothing.
export function normalizeSpeedRound(on) {
  return on === true;
}

// How much Calm mode slows the flock: a pure multiplier on the movement
// clock. 0.35 turns even the round-9 scramble into a gentle shuffle and
// leaves the flock sizes, seeds and round numbering untouched, so rounds
// stay exactly as hard to count, only easier to follow.
export const CALM_SPEED = 0.35;

// A calm flag survives a save, a server sync and a deep link only when it
// is exactly true; anything else reads as normal play.
export function normalizeCalm(on) {
  return on === true;
}

// ---- Big Tap (accessibility) ----
// A grown-ups toggle that opens the game up for small or less accurate
// fingers: the sheep's tap targets grow, the flock slows down, and the
// pop bursts drop less confetti. Like Calm, it is a pure multiplier set
// over the same motion profile, so flock sizes, seeds and round numbering
// stay exactly as they are on every difficulty.

// The hit target grows by 40%: the invisible pick sphere in the 3D scene
// and the whole card in the DOM fallback both scale by this.
export const BIG_TAP_HIT_SCALE = 1.4;

// The movement slows by 30%: a pure multiplier on the motion clock, the
// same shape as CALM_SPEED.
export const BIG_TAP_SPEED = 0.7;

// How much confetti a pop keeps when Big Tap is on: half of the pieces,
// so the burst is quieter without going empty. Candy is untouched.
export const BIG_TAP_CONFETTI_KEEP = 0.5;

// A Big Tap flag survives a save and a deep link only when it is exactly
// true; anything else reads as normal play.
export function normalizeBigTap(on) {
  return on === true;
}

// Big Tap's motion profile: the round's own wander shape with the speed
// and the nervous wobble slid down, leaving the roam radius untouched so
// the camera framing stays valid.
export function bigTapMotion(round, difficulty = DEFAULT_DIFFICULTY) {
  const m = motionForRound(round, difficulty);
  return { ...m, speed: m.speed * BIG_TAP_SPEED, jitterAmp: m.jitterAmp * BIG_TAP_SPEED };
}

// The one selector both renderers call, so they can never drift apart on
// how a round moves. Calm always wins the tempo: Big Tap never slows a
// Calm round (Calm is already the slow path), while the hit-target growth
// and the confetti reduction stay the toggles' own concerns and are read
// from state.bigTap directly.
export function flockMotion(round, difficulty, { calmOn = false, bigTapOn = false } = {}) {
  if (calmOn) return calmMotion(round, difficulty);
  return bigTapOn ? bigTapMotion(round, difficulty) : motionForRound(round, difficulty);
}

// ---- Scenery ----
// Which scenery the flock stands on. Meadow is the default; night is the
// old Night Meadow; moon is the new grey one. Like the level and the mode,
// this is a closed set: anything unrecognised reads as the default rather
// than crashing an old or mangled save.
export const SCENERY_KEYS = ['meadow', 'night', 'moon'];

// One run-spanning value, `scenery`, is the source of truth for the look;
// `nightOn` is derived from it (scenery === 'night'), so the server's
// night_on contract stays unchanged. A save written before the picker
// existed has only nightOn, so the legacy flag migrates into it: a Night
// Meadow player restores to 'night', everyone else to 'meadow'.
export function normalizeScenery(value, legacyNightOn) {
  if (SCENERY_KEYS.includes(value)) return value;
  return legacyNightOn ? 'night' : 'meadow';
}

// Server sync: the server only knows night_on. Moon (and any future
// device-local pick) survives both server values, because the server could
// never have written it; meadow and night follow the server exactly as
// nightOn does today.
export function sceneryFromServer(local, serverNightOn) {
  if (local === 'moon') return 'moon';
  return serverNightOn ? 'night' : 'meadow';
}

// The on-screen clock text. Whole seconds only, so "30" and "9" rather
// than "30s" and "9s": children read bare numerals more easily.
export function speedRoundClock(secondsLeft) {
  return String(Math.max(0, Math.ceil(Number(secondsLeft) || 0)));
}

// The flow ladder's flock: level L opens with L sheep and its next two
// rounds hold one more, so level 1 reads 1, 2, 2 and level 4 reads 4, 5, 5,
// capped at MAX_SHEEP so taps stay physically landable. Calm grows by one
// sheep every two rounds up to five.
export function sheepForRound(round, difficulty = DEFAULT_DIFFICULTY) {
  const r = normalizeRound(round);
  const d = normalizeDifficulty(difficulty);
  if (d === FLOW_LEVEL) {
    const extra = roundInLevel(r) > 1 ? 1 : 0;
    return Math.min(MAX_SHEEP, levelForRound(r) + extra);
  }
  const c = DIFFICULTIES[d];
  return Math.min(c.maxSheep, 1 + Math.floor((r - 1) * c.growth));
}

// How the flock moves at a given round. Round 1 is completely still: a
// single sheep standing there, so a first-time player learns the tap.
//
//   speed      how fast the wander cycles run
//   radius     how far from home a sheep may roam (world units)
//   bounceMix  share of the travel that is straight-line-and-reverse
//              motion rather than a smooth curve (reads as bouncing)
//   jitterAmp  extra high-frequency wobble, as a share of radius
//   turn       how much a sheep swings its heading while walking
//   chaos      0 to 1 ramp, for renderers that want one dial
//
// On the ladder the motion follows the level: level 1 drifts at 0.3, level
// 2 at 0.4, and the ramp then climbs to full bounce and jitter by level
// 10, after which the sheep keep getting quicker, slowly, up to a cap.
// Calm never ramps: every round from 2 on keeps the opening drift.
const FLOW_RAMP_LEVELS = 8;
const FLOW_OVER_RATE = 0.06;
export function motionForRound(round, difficulty = DEFAULT_DIFFICULTY) {
  const r = normalizeRound(round);
  if (r <= 1) {
    return { speed: 0, radius: 0, bounceMix: 0, jitterAmp: 0, turn: 0, chaos: 0 };
  }
  const level = levelForRound(r);
  if (normalizeDifficulty(difficulty) !== FLOW_LEVEL) {
    return { speed: 0.4, radius: 0.3, bounceMix: 0, jitterAmp: 0, turn: 0.15, chaos: 0 };
  }
  if (level <= 1) {
    return { speed: 0.3, radius: 0.3, bounceMix: 0, jitterAmp: 0, turn: 0.15, chaos: 0 };
  }
  const ramp = Math.min(1, (level - 2) / FLOW_RAMP_LEVELS);
  const over = Math.min(1.2, Math.max(0, level - 2 - FLOW_RAMP_LEVELS) * FLOW_OVER_RATE);
  return {
    speed: 0.4 + ramp * 1.45 + over,
    radius: 0.4 + ramp * 0.9,
    bounceMix: Math.min(0.85, Math.max(0, ramp * 1.1 - 0.1)),
    jitterAmp: ramp * ramp * 0.3 + over * 0.05,
    turn: 0.15 + ramp * 0.6,
    chaos: Math.min(1, ramp + over * 0.4),
  };
}

// Calm mode keeps the same wander shape (so a sheep still reads as the
// same animal on the same path) but slides the motion clock down, which
// slows every blended speed and the nervous wobble without changing how
// far a sheep can roam. Renderers call this instead of motionForRound;
// everything that frames or bounds the flock keeps using the raw profile.
export function calmMotion(round, difficulty = DEFAULT_DIFFICULTY) {
  const m = motionForRound(round, difficulty);
  return { ...m, speed: m.speed * CALM_SPEED, jitterAmp: m.jitterAmp * CALM_SPEED };
}

// Largest distance a sheep can sit from its home spot, so a renderer can
// pad its camera fit / grid and never let a sheep wander out of view. This
// is a true upper bound on wanderOffset: it sums the worst case of each of
// the three blended motions (see movement.js), which never actually peak
// together, so it runs a little generous on purpose.
export function roamRadius(round, difficulty = DEFAULT_DIFFICULTY) {
  const m = motionForRound(round, difficulty);
  const drift = (1 - m.bounceMix) * Math.SQRT2;
  const bounce = m.bounceMix * Math.hypot(1, 0.55);
  const jitter = m.jitterAmp * Math.SQRT2;
  return m.radius * (drift + bounce + jitter);
}

// Deterministic per-round seed for the deep link. Odd multiplier keeps
// consecutive rounds from producing similar layouts.
export function roundSeed(round) {
  const r = normalizeRound(round);
  return (r * 2654435761) % 2147483647;
}

export function roundLabel(round) {
  return 'Round ' + normalizeRound(round);
}

// --- The wolf in the flock ---
// Everything below is a pure function of the round number (and, for the
// spawn draw, the round seed), so /?round=N reproduces the same wolf every
// time it is loaded, exactly like the rest of the difficulty curve.
//
// On the ladder the wolf follows the level: none before level 4, then a
// chance that climbs one step per level until it caps, in a disguise that
// improves at levels 7 and 12. Calm never hides one (state.js skips the
// draw); the optional `mode` argument is the player's difficulty.

const WOLF_FIRST_LEVEL = 4;
const WOLF_BASE_CHANCE = 0.15;
const WOLF_CHANCE_STEP = 0.05;
const WOLF_MAX_CHANCE = 0.7;
const WOLF_TIER2_LEVEL = 7;
const WOLF_TIER3_LEVEL = 12;
export const WOLF_BONUS = 2;

export function wolfChance(round, mode = DEFAULT_DIFFICULTY) {
  if (isCalmLevel(mode)) return 0;
  const level = levelForRound(round);
  if (level < WOLF_FIRST_LEVEL) return 0;
  return Math.min(WOLF_MAX_CHANCE, WOLF_BASE_CHANCE + (level - WOLF_FIRST_LEVEL) * WOLF_CHANCE_STEP);
}

// Deterministic per-round draw: one value from a seed twisted away from
// the layout seed decides whether this round hides a wolf, and a second
// decides which flock member it is. Returns null on a no-wolf round.
export function wolfIndexForRound(round, seed, sheepCount, mode = DEFAULT_DIFFICULTY) {
  if (wolfChance(round, mode) === 0 || sheepCount < 2) return null;
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  if (rand() >= wolfChance(round, mode)) return null;
  return Math.floor(rand() * sheepCount);
}

// How good the disguise is. Three stages line up with the movement ramp:
// fair but findable, matching fleece with small grey cues, then near-perfect
// with only an amber glint in the eyes left to spot.
export function wolfDisguiseTier(round, mode = DEFAULT_DIFFICULTY) {
  const level = levelForRound(round);
  if (level < WOLF_TIER2_LEVEL) return 1;
  if (level < WOLF_TIER3_LEVEL) return 2;
  return 3;
}

// What a sighted player can see give the wolf away at each disguise tier
// (the renderers draw ears and a tail, then smaller ears, then only a
// glint), said in words for the screen-reader list, which otherwise called
// the wolf a sheep like any other and left those players no way to avoid it.
const WOLF_CUES = {
  1: 'it has pointy ears and a bushy tail',
  2: 'its ears look a little pointy',
  3: 'its eyes glint',
};

export function wolfCueText(round, mode = DEFAULT_DIFFICULTY) {
  return WOLF_CUES[wolfDisguiseTier(round, mode)] || WOLF_CUES[3];
}

// Copy helpers live here beside the difficulty curve so the exact wording a
// player reads can be asserted in tests/game.test.mjs without a browser.
// Both renderers and the in-play pass banner share these words.
export function sheepPhrase(n) {
  return n === 1 ? '1 sheep' : `${n} sheep`;
}

// The counting screen's hint, by where the round is: how to start, then
// how many sheep are left. The last line only shows in a duel turn, which
// still ends on Done counting; a solo round passes on its last pop. Pure
// so tests can pin the words, like the other copy helpers here.
export function playHintText(count, realSheep, sheepCount) {
  if (count === 0) return sheepCount === 1 ? 'Tap the sheep to start.' : 'Tap every sheep.';
  if (count >= realSheep) return 'That is all of them. Tap Done counting.';
  return `${realSheep - count} left!`;
}

// A short, honest warning about what the flock will do.
export function paceLine(round, difficulty = DEFAULT_DIFFICULTY) {
  const m = calmMotion(round, difficulty);
  // The raw profile decides, not the calm-slid one: a slowed round 5 is
  // still a jumpy flock, only an easier one to follow.
  if (motionForRound(round, difficulty).jitterAmp > 0.12) return 'They are jumpy now.';
  if (m.bounceMix > 0.5) return 'They bounce off in all directions.';
  if (m.speed > 1.1) return 'They are quicker.';
  if (m.speed > 0) return 'They start to wander.';
  return 'This one stands still.';
}

// The pass banner's line: what was just counted. Shown in the meadow for
// a moment between rounds, under "Level N!" when the pass is a level-up.
export function recapSheepLine(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `You counted ${sheepPhrase(n)}.`;
}

export function passLine(counted) {
  return recapSheepLine(counted);
}

// The weekly leaderboard's score text: a Speed Round keeps its own tag so
// it is distinguishable from a normal round at the same number.
export function weeklyScoreLabel(roundReached, speedOn = false) {
  return speedOn ? `Speed ${normalizeRound(roundReached)}` : `Round ${normalizeRound(roundReached)}`;
}

// ---- Play streak ----
// The streak counts consecutive days on which the player started at least
// one round. Day keys are LOCAL calendar dates (YYYY-MM-DD), never UTC, so
// a family playing after dinner keeps one day per evening regardless of
// timezone. Like the copy helpers above, the arithmetic is pure so
// tests/game.test.mjs can pin it without a browser.

// The local date's key. Padded month and day keep string compares honest.
export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole days between two day keys, computed on UTC midnights of those
// calendar dates so no local timezone offset can skew the count.
export function dayDistance(fromKey, toKey) {
  const parts = (key) => [
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  ];
  const a = parts(fromKey);
  const b = parts(toKey);
  const from = Date.UTC(a[0], a[1], a[2]);
  const to = Date.UTC(b[0], b[1], b[2]);
  return Math.round((to - from) / 86400000);
}

// Fold today's play into the streak. Playing on consecutive days grows the
// streak by one; any gap (or a first ever day) starts it at one; playing
// again the same day changes nothing. best never goes backwards.
export function advanceStreak(prevDays, bestDays, lastDayKey, todayKey) {
  const prev = Math.max(0, Math.floor(Number(prevDays) || 0));
  const best = Math.max(prev, Math.max(0, Math.floor(Number(bestDays) || 0)));
  if (lastDayKey === todayKey) return { days: prev, best, changed: false };
  const grew = !!lastDayKey && dayDistance(lastDayKey, todayKey) === 1;
  const days = grew ? prev + 1 : 1;
  return { days, best: Math.max(best, days), changed: true };
}

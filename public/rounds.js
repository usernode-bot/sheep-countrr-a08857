import { mulberry32 } from './layout.js';

// Round progression: the single source of truth for how many sheep a round
// holds and how wildly they move, per difficulty. Everything here is a pure
// function of the round number and the difficulty, so the
// /?round=N&difficulty=X deep link reproduces exactly the same round every
// time it is loaded (screenshots stay comparable run to run). Omitting the
// difficulty means Normal, which is byte-for-byte the pre-difficulty game.

// Upper bound on flock size. Past this round the sheep stop multiplying and
// only the movement keeps escalating, so taps stay physically landable.
export const MAX_SHEEP = 12;

// Round at which the movement ramp reaches full chaos.
export const DEFAULT_DIFFICULTY = 'normal';

// The ladder's length for the original five levels. The round pill reads
// "Round 5 of 9" so a player always knows how far the run goes; the flock
// keeps its shape past the top (see sheepForRound's cap) and the suffix
// drops off there, so the pill never claims a round the flock does not
// have. The levels above Expert run a longer ladder — see totalRoundsFor.
export const TOTAL_ROUNDS = 9;

// The difficulty dials. Normal is today's curve exactly; Easy stretches the
// same character arc out and calms it down, Hard and Expert compress it and
// push it further. growth is the sheep-per-round multiplier, rampRounds how
// long the movement ramp takes to reach full chaos, speedRamp the extra
// speed at full ramp, overRate the post-ramp speed creep per round, and
// jitterScale how nervy the late wobble gets.
export const DIFFICULTIES = {
  // Calm is the bedtime level, and the default for a brand-new player
  // (see NEW_PLAYER_DIFFICULTY). Its flock grows by one sheep every two
  // rounds and stops at five, and its motion never ramps: rampRounds of
  // Infinity pins the ramp at zero, so every round from 2 on keeps the
  // slow drift every level opens with (speed 0.4, radius 0.3, no bounce,
  // no jitter). The forgiving rules (a double tap only wiggles, no wolf,
  // no game over) live in state.js behind isCalmLevel.
  calm: {
    growth: 0.5,
    maxSheep: 5,
    rampRounds: Infinity,
    speedRamp: 0,
    overRate: 0,
    jitterScale: 0,
  },
  easy: {
    growth: 1.0,
    maxSheep: 6,
    rampRounds: 12,
    speedRamp: 1.1,
    overRate: 0.03,
    jitterScale: 0.25,
  },
  normal: {
    growth: 1.5,
    maxSheep: 12,
    rampRounds: 8,
    speedRamp: 1.5,
    overRate: 0.06,
    jitterScale: 0.3,
  },
  hard: {
    growth: 2.0,
    maxSheep: 12,
    rampRounds: 6,
    speedRamp: 1.8,
    overRate: 0.09,
    jitterScale: 0.35,
  },
  expert: {
    growth: 2.5,
    maxSheep: 12,
    rampRounds: 4,
    speedRamp: 2.2,
    overRate: 0.12,
    jitterScale: 0.4,
  },
  // The long-term ladder above Expert. The flock already sits at the shared
  // MAX_SHEEP cap here, so hardness comes from movement and wolves, not
  // more sheep: shorter ramps, faster full-chaos speed, a steeper post-ramp
  // creep and a nervier wobble, each level meaningfully worse than the one
  // before. Their ladders are also longer (see totalRoundsFor) and their
  // wolves bite sooner and in better disguise (see wolfModeFactors).
  insane: {
    growth: 3.0,
    maxSheep: 12,
    rampRounds: 3,
    speedRamp: 2.5,
    overRate: 0.16,
    jitterScale: 0.45,
  },
  chaos: {
    growth: 3.0,
    maxSheep: 12,
    rampRounds: 2,
    speedRamp: 2.8,
    overRate: 0.2,
    jitterScale: 0.5,
  },
  legend: {
    growth: 3.0,
    maxSheep: 12,
    rampRounds: 2,
    speedRamp: 3.2,
    overRate: 0.24,
    jitterScale: 0.55,
  },
};

// The level a player with no saved pick starts on. Deep links and frozen
// fixtures keep DEFAULT_DIFFICULTY (Normal) so their flocks never move;
// only a real player's store, with nothing saved locally or on the
// server, opens on Calm. A saved pick, any pick, always wins.
export const CALM_LEVEL = 'calm';
export const NEW_PLAYER_DIFFICULTY = CALM_LEVEL;

export function isCalmLevel(difficulty) {
  return difficulty === CALM_LEVEL;
}

// The Get ready card's rule line. Calm promises the forgiving tap; the
// challenge levels keep the warning that a double count ends the run.
export function introRuleText(difficulty = DEFAULT_DIFFICULTY) {
  return isCalmLevel(difficulty)
    ? 'Count each sheep once, then tap Done counting. Tap one twice and it just gives a sleepy wiggle.'
    : 'Count each sheep once, then tap Done counting. Tapping the same sheep twice ends the run.';
}

// Anything unrecognised (a hostile /api/state body, a mangled deep link,
// an old localStorage row) falls back to Normal, never to a crash.
export function normalizeDifficulty(difficulty) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)
    ? difficulty
    : DEFAULT_DIFFICULTY;
}

export function normalizeRound(round) {
  const r = Math.floor(Number(round));
  return Number.isFinite(r) && r >= 1 ? r : 1;
}

// How long a Speed Round lasts, in whole seconds.
export const SPEED_ROUND_SECONDS = 30;

// A speed flag survives a localStorage save, a server sync and a deep
// link only when it is exactly true; anything else reads as a normal
// round.
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

// The on-screen clock text. Whole seconds only, so "30" and "9" rather
// than "30s" and "9s": children read bare numerals more easily.
export function speedRoundClock(secondsLeft) {
  return String(Math.max(0, Math.ceil(Number(secondsLeft) || 0)));
}

// 1, 2, 4, 5, 7, 8, 10, 11, 12 ... on Normal (one or two more sheep each
// round); slower growth on Easy, faster on Hard and Expert, each capped at
// its own flock limit so taps stay physically landable.
export function sheepForRound(round, difficulty = DEFAULT_DIFFICULTY) {
  const r = normalizeRound(round);
  const d = DIFFICULTIES[normalizeDifficulty(difficulty)];
  return Math.min(d.maxSheep, 1 + Math.floor((r - 1) * d.growth));
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
export function motionForRound(round, difficulty = DEFAULT_DIFFICULTY) {
  const r = normalizeRound(round);
  if (r <= 1) {
    return { speed: 0, radius: 0, bounceMix: 0, jitterAmp: 0, turn: 0, chaos: 0 };
  }
  const d = DIFFICULTIES[normalizeDifficulty(difficulty)];
  const ramp = Math.min(1, (r - 2) / d.rampRounds);
  // Past the ramp the sheep keep getting quicker, slowly and forever.
  const over = Math.min(1.2, Math.max(0, r - 2 - d.rampRounds) * d.overRate);
  return {
    speed: 0.4 + ramp * d.speedRamp + over,
    radius: 0.3 + ramp * 1.0,
    bounceMix: Math.min(0.85, ramp * 1.1),
    jitterAmp: ramp * ramp * d.jitterScale + over * 0.05,
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
// Every function takes an optional trailing `mode` argument naming the
// difficulty level: the wolf bites harder the higher the level, so Easy's
// wolf is rarer and later in plainer disguise while the challenge levels
// above Expert draw sooner and disguise earlier. The existing call sites
// pass the player's difficulty; the frozen fixtures pass nothing and so
// keep Normal.

const WOLF_BASE_CHANCE = 0.15;
const WOLF_CHANCE_STEP = 0.05;
const WOLF_MAX_CHANCE = 0.7;
export const WOLF_BONUS = 2;

function wolfModeFactors(mode = 'normal') {
  if (mode === 'easy') return { chance: 0.5, tier2: 7, tier3: 10 };
  if (mode === 'hard') return { chance: 1.2, tier2: 5, tier3: 7 };
  if (mode === 'expert') return { chance: 1.5, tier2: 4, tier3: 6 };
  if (mode === 'insane') return { chance: 1.8, tier2: 4, tier3: 7 };
  if (mode === 'chaos') return { chance: 2.2, tier2: 4, tier3: 6 };
  if (mode === 'legend') return { chance: 2.5, tier2: 3, tier3: 5 };
  return { chance: 1, tier2: 5, tier3: 8 };
}

// Round 1 is the gentle tap-to-learn round: it never hides a wolf. After
// that the chance climbs one step per round until it caps.
export function wolfChance(round, mode = 'normal') {
  const r = normalizeRound(round);
  if (r <= 1) return 0;
  const { chance } = wolfModeFactors(mode);
  return Math.min(WOLF_MAX_CHANCE, (WOLF_BASE_CHANCE + (r - 2) * WOLF_CHANCE_STEP) * chance);
}

// Deterministic per-round draw: one value from a seed twisted away from
// the layout seed decides whether this round hides a wolf, and a second
// decides which flock member it is. Returns null on a no-wolf round.
export function wolfIndexForRound(round, seed, sheepCount, mode = 'normal') {
  if (wolfChance(round, mode) === 0 || sheepCount < 2) return null;
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  if (rand() >= wolfChance(round, mode)) return null;
  return Math.floor(rand() * sheepCount);
}

// How good the disguise is. Three stages line up with the movement ramp:
// fair but findable, matching fleece with small grey cues, then near-perfect
// with only an amber glint in the eyes left to spot.
export function wolfDisguiseTier(round, mode = 'normal') {
  const r = normalizeRound(round);
  const { tier2, tier3 } = wolfModeFactors(mode);
  if (r < tier2) return 1;
  if (r < tier3) return 2;
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

export function wolfCueText(round, mode = 'normal') {
  return WOLF_CUES[wolfDisguiseTier(round, mode)] || WOLF_CUES[3];
}

// The level's ladder length. The round pill reads "Round 5 of 9" (or
// "of 12" on the levels above Expert) so a player always knows how far the
// run goes; see roundBadgeText.
export function totalRoundsFor(difficulty = DEFAULT_DIFFICULTY) {
  const d = normalizeDifficulty(difficulty);
  return d === 'insane' || d === 'chaos' || d === 'legend' ? 12 : TOTAL_ROUNDS;
}

// The on-screen round text: "Round 5 of 9" while the ladder has more
// rungs above it, and plain "Round 9" once the flock has reached its cap
// and the ladder has no further rung to name. The Speed Round keeps its
// mode prefix so the badge stays honest about what is being played. The
// levels above Expert run a longer 12-round ladder (totalRoundsFor).
export function roundBadgeText(round, speedOn = false, difficulty = DEFAULT_DIFFICULTY) {
  const r = normalizeRound(round);
  const total = totalRoundsFor(difficulty);
  const prefix = speedOn ? 'Speed round ' : 'Round ';
  return r < total
    ? `${prefix}${r} of ${total}`
    : `${prefix}${r}`;
}

// Copy helpers live here beside the difficulty curve so the exact wording a
// player reads can be asserted in tests/game.test.mjs without a browser.
// Both renderers and the round-complete panel share these words.
export function sheepPhrase(n) {
  return n === 1 ? '1 sheep' : `${n} sheep`;
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

// The pre-round briefing's first line: what this round asks for. Reads
// "Round 1 has 1 sheep. This one stands still." for a fresh run and names a
// bigger, faster flock for a run that starts on a later round.
export function roundIntroText(round, difficulty = DEFAULT_DIFFICULTY, speedOn = false, calmOn = false) {
  const r = normalizeRound(round);
  const d = normalizeDifficulty(difficulty);
  const intro = `Round ${r} has ${sheepPhrase(sheepForRound(r, d))}. ${paceLine(r, d)}`;
  return speedOn
    ? `${intro} Count them all before the clock runs out.`
    : calmOn
      ? `${intro} Calm mode keeps them slow.`
      : intro;
}

// The round-complete card line for the just-played round: a Speed Round
// names its mode so the result reads differently from a normal round.
export function roundCompleteTitle(round, speedOn = false) {
  return speedOn ? `Speed Round ${normalizeRound(round)} counted.` : `Round ${normalizeRound(round)} counted.`;
}

// The weekly leaderboard's score text: a Speed Round keeps its own tag so
// it is distinguishable from a normal round at the same number.
export function weeklyScoreLabel(roundReached, speedOn = false) {
  return speedOn ? `Speed ${normalizeRound(roundReached)}` : `Round ${normalizeRound(roundReached)}`;
}

// The praise line at the top of the round-complete card. Leads the card so
// finishing a round reads as a reward, not a status readout. The round line
// and next-up line below it carry the specifics.
export function successMessage() {
  return 'Great job! You found all the sheep.';
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

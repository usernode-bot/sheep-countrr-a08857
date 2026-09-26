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

// Flock-size selector. Medium is today's curve exactly; Small runs roughly
// half the flock, Large roughly double, every one capped at the shared
// MAX_SHEEP board limit so taps stay physically landable. The difficulty
// curve is unchanged by the size: size scales how many sheep a round holds,
// difficulty scales how fast they move.
export const DEFAULT_FLOCK_SIZE = 'medium';

export const FLOCK_SIZES = {
  small: { maxSheep: 6, factor: 0.5 },
  medium: { maxSheep: MAX_SHEEP, factor: 1 },
  large: { maxSheep: MAX_SHEEP, factor: 2 },
};

// The difficulty dials. Normal is today's curve exactly; Easy stretches the
// same character arc out and calms it down, Hard and Expert compress it and
// push it further. growth is the sheep-per-round multiplier, rampRounds how
// long the movement ramp takes to reach full chaos, speedRamp the extra
// speed at full ramp, overRate the post-ramp speed creep per round, and
// jitterScale how nervy the late wobble gets.
export const DIFFICULTIES = {
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
};

// Anything unrecognised (a hostile /api/state body, a mangled deep link,
// an old localStorage row) falls back to Normal, never to a crash.
export function normalizeDifficulty(difficulty) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)
    ? difficulty
    : DEFAULT_DIFFICULTY;
}

// Same contract for the flock-size picker: an unknown value reads as Medium.
export function normalizeFlockSize(flockSize) {
  return Object.prototype.hasOwnProperty.call(FLOCK_SIZES, flockSize)
    ? flockSize
    : DEFAULT_FLOCK_SIZE;
}

export function normalizeRound(round) {
  const r = Math.floor(Number(round));
  return Number.isFinite(r) && r >= 1 ? r : 1;
}

// 1, 2, 4, 5, 7, 8, 10, 11, 12 ... on Normal (one or two more sheep each
// round); slower growth on Easy, faster on Hard and Expert, each capped at
// its own flock limit so taps stay physically landable.
export function sheepForRound(round, difficulty = DEFAULT_DIFFICULTY, flockSize = DEFAULT_FLOCK_SIZE) {
  const r = normalizeRound(round);
  const d = DIFFICULTIES[normalizeDifficulty(difficulty)];
  const f = FLOCK_SIZES[normalizeFlockSize(flockSize)];
  // Medium reproduces the pre-size curve byte for byte; Small and Large
  // scale that same ladder (roughly half / double) under their own cap, and
  // round 1 always stays one motionless sheep to teach the tap.
  const scaled = 1 + Math.floor((r - 1) * d.growth * f.factor);
  return Math.min(d.maxSheep, f.maxSheep, Math.max(1, scaled));
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

// Copy helpers live here beside the difficulty curve so the exact wording a
// player reads can be asserted in tests/game.test.mjs without a browser.
// Both renderers and the round-complete panel share these words.
export function sheepPhrase(n) {
  return n === 1 ? '1 sheep' : `${n} sheep`;
}

// A short, honest warning about what the flock will do.
export function paceLine(round, difficulty = DEFAULT_DIFFICULTY) {
  const m = motionForRound(round, difficulty);
  if (m.jitterAmp > 0.12) return 'They are jumpy now.';
  if (m.bounceMix > 0.5) return 'They bounce off in all directions.';
  if (m.speed > 1.1) return 'They are quicker.';
  if (m.speed > 0) return 'They start to wander.';
  return 'This one stands still.';
}

// The pre-round briefing's first line: what this round asks for. Reads
// "Round 1 has 1 sheep. This one stands still." for a fresh run and names a
// bigger, faster flock for a run that starts on a later round.
export function roundIntroText(round, difficulty = DEFAULT_DIFFICULTY, flockSize = DEFAULT_FLOCK_SIZE) {
  const r = normalizeRound(round);
  const d = normalizeDifficulty(difficulty);
  return `Round ${r} has ${sheepPhrase(sheepForRound(r, d, flockSize))}. ${paceLine(r, d)}`;
}

// The praise line at the top of the round-complete card. Leads the card so
// finishing a round reads as a reward, not a status readout. The round line
// and next-up line below it carry the specifics.
export function successMessage() {
  return 'Great job! You found all the sheep.';
}

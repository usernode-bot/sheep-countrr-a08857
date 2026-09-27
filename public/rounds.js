import { mulberry32 } from './layout.js';

// Round progression: the single source of truth for how many sheep a round
// holds and how wildly they move. Everything here is a pure function of the
// round number, so the /?round=N deep link reproduces exactly the same
// round every time it is loaded (screenshots stay comparable run to run).

// Upper bound on flock size. Past this round the sheep stop multiplying and
// only the movement keeps escalating, so taps stay physically landable.
export const MAX_SHEEP = 12;

// Round at which the movement ramp reaches full chaos.
const RAMP_ROUNDS = 8;

export function normalizeRound(round) {
  const r = Math.floor(Number(round));
  return Number.isFinite(r) && r >= 1 ? r : 1;
}

// 1, 2, 4, 5, 7, 8, 10, 11, 12 ... — one or two more sheep each round.
export function sheepForRound(round) {
  const r = normalizeRound(round);
  return Math.min(MAX_SHEEP, 1 + Math.floor((r - 1) * 1.5));
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
export function motionForRound(round) {
  const r = normalizeRound(round);
  if (r <= 1) {
    return { speed: 0, radius: 0, bounceMix: 0, jitterAmp: 0, turn: 0, chaos: 0 };
  }
  const ramp = Math.min(1, (r - 2) / RAMP_ROUNDS);
  // Past the ramp the sheep keep getting quicker, slowly and forever.
  const over = Math.min(1.2, Math.max(0, r - 2 - RAMP_ROUNDS) * 0.06);
  return {
    speed: 0.4 + ramp * 1.5 + over,
    radius: 0.3 + ramp * 1.0,
    bounceMix: Math.min(0.85, ramp * 1.1),
    jitterAmp: ramp * ramp * 0.3 + over * 0.05,
    turn: 0.15 + ramp * 0.6,
    chaos: Math.min(1, ramp + over * 0.4),
  };
}

// Largest distance a sheep can sit from its home spot, so a renderer can
// pad its camera fit / grid and never let a sheep wander out of view. This
// is a true upper bound on wanderOffset: it sums the worst case of each of
// the three blended motions (see movement.js), which never actually peak
// together, so it runs a little generous on purpose.
export function roamRadius(round) {
  const m = motionForRound(round);
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
// Every function takes an optional trailing `mode` argument reserved for
// the future Easy/Expert difficulty work: the existing call sites pass
// nothing, so nothing changes until the modes land.

const WOLF_BASE_CHANCE = 0.15;
const WOLF_CHANCE_STEP = 0.05;
const WOLF_MAX_CHANCE = 0.7;
export const WOLF_BONUS = 2;

function wolfModeFactors(mode = 'normal') {
  if (mode === 'easy') return { chance: 0.5, tier2: 7, tier3: 10 };
  if (mode === 'expert') return { chance: 1.5, tier2: 4, tier3: 6 };
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


// Copy helpers live here beside the difficulty curve so the exact wording a
// player reads can be asserted in tests/game.test.mjs without a browser.
// Both renderers and the round-complete panel share these words.
export function sheepPhrase(n) {
  return n === 1 ? '1 sheep' : `${n} sheep`;
}

// A short, honest warning about what the flock will do.
export function paceLine(round) {
  const m = motionForRound(round);
  if (m.jitterAmp > 0.12) return 'They are jumpy now.';
  if (m.bounceMix > 0.5) return 'They bounce off in all directions.';
  if (m.speed > 1.1) return 'They are quicker.';
  if (m.speed > 0) return 'They start to wander.';
  return 'This one stands still.';
}

// The pre-round briefing's first line: what this round asks for. Reads
// "Round 1 has 1 sheep. This one stands still." for a fresh run and names a
// bigger, faster flock for a run that starts on a later round.
export function roundIntroText(round) {
  const r = normalizeRound(round);
  return `Round ${r} has ${sheepPhrase(sheepForRound(r))}. ${paceLine(r)}`;
}

// The praise line at the top of the round-complete card. Leads the card so
// finishing a round reads as a reward, not a status readout. The round line
// and next-up line below it carry the specifics.
export function successMessage() {
  return 'Great job! You found all the sheep.';
}

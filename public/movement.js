// Where a sheep sits, relative to its home spot, at a given moment.
//
// Deterministic: a pure function of (seed, index, time) plus the round's
// motion profile, so both renderers agree, a reload reproduces the same
// walk, and the /?round=N deep link always looks the same.
//
// Three motions are blended, and the round's profile decides how much of
// each shows up (see motionForRound in rounds.js):
//
//   drift    slow smooth curves — the early rounds
//   bounce   straight-line travel that reverses at the ends, like a
//            sheep pacing a pen — the middle rounds
//   jitter   fast small wobble on top — the late, chaotic rounds
import { mulberry32 } from './layout.js';
import { motionForRound } from './rounds.js';

const STILL = { x: 0, z: 0, turn: 0 };

// Triangle wave over -1..1 with period 2*PI. Continuous (no teleports),
// but with a corner at each end, which is what makes it read as a bounce
// rather than a glide.
function triangle(x) {
  const u = x / (Math.PI * 2);
  return 4 * Math.abs(u - Math.floor(u + 0.5)) - 1;
}

export function wanderOffset(seed, index, herdSize, time, motion) {
  const m = motion || motionForRound(1);
  if (!(m.radius > 0) || !(m.speed > 0)) return STILL;

  const random = mulberry32((seed + index * 7919) >>> 0);
  const phase = random() * Math.PI * 2;
  // Each sheep gets its own pace and its own bounce heading, so a big
  // flock never pulses in unison.
  const pace = 0.7 + random() * 0.6;
  const heading = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;

  const w = time * m.speed * pace;
  const smooth = 1 - m.bounceMix;

  // Smooth drift: two curves at different rates, so the path never looks
  // like a plain circle.
  let x = smooth * (Math.sin(w + phase) * 0.72 + Math.sin(w * 0.43 + phase * 2) * 0.28);
  let z = smooth * (Math.cos(w * 0.71 + phase) * 0.72 + Math.sin(w * 0.37 + phase2) * 0.28);

  // Bounce: pace out along a heading, turn around, pace back.
  if (m.bounceMix > 0) {
    const travel = triangle(w * 0.62 + phase);
    const cross = triangle(w * 0.41 + phase2) * 0.55;
    x += m.bounceMix * (Math.cos(heading) * travel - Math.sin(heading) * cross);
    z += m.bounceMix * (Math.sin(heading) * travel + Math.cos(heading) * cross);
  }

  // Jitter: a quick nervous wobble that only shows up in late rounds.
  if (m.jitterAmp > 0) {
    x += m.jitterAmp * Math.sin(w * 5.3 + phase * 3);
    z += m.jitterAmp * Math.cos(w * 6.1 + phase2 * 3);
  }

  return {
    x: m.radius * x,
    z: m.radius * z,
    turn: Math.sin(w * 0.8 + phase) * m.turn,
  };
}

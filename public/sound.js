// Everything here is generated with the Web Audio API, so there are no
// audio asset files to ship. The AudioContext
// is only ever created/resumed from inside a real tap handler, per
// autoplay policy.

let ctx = null;
let enabled = false;

// The enabled flag is app state: callers pass the current toggle value with
// each call rather than this module owning persistence. Everything checks
// it first, so a muted session never even creates an AudioContext.
export function setSoundEnabled(on) {
  enabled = !!on;
}

export function isSoundEnabled() {
  return enabled;
}

function getCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function playTapChime(step) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const freq = 220 + Math.min(step, 12) * 12;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.045, c.currentTime + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.3);
}

export function playCelebration() {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const notes = [261.63, 329.63];
  notes.forEach((freq, i) => {
    const start = c.currentTime + i * 0.12;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  });
}

export function vibrateTap() {
  try {
    navigator.vibrate && navigator.vibrate(15);
  } catch {
    /* not every device supports haptics */
  }
}

// A soft "baa" for the sound a newly counted sheep makes: a gentle
// two-note glide on a triangle wave, quiet enough to sit under a nap.
export function playBaa() {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const t = c.currentTime;
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(390, t);
  // A sheep's call drifts downward; wobble it slightly so it reads as a
  // voice rather than a test tone.
  osc.frequency.linearRampToValueAtTime(320, t + 0.22);
  const wobble = c.createOscillator();
  const wobbleGain = c.createGain();
  wobble.frequency.value = 18;
  wobbleGain.gain.value = 14;
  wobble.connect(wobbleGain).connect(osc.frequency);
  osc.connect(gain).connect(c.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  osc.start(t);
  wobble.start(t);
  osc.stop(t + 0.35);
  wobble.stop(t + 0.35);
}

// Full length of the counted sheep's two-note call. layout.js's
// POP_PUFF_SECONDS keeps the pop from bursting before it finishes.
export const BAA_BAAA_SECONDS = 0.58;

// One triangle-and-wobble voice shared by both notes, in the same style
// as playBaa above: a glide from fromHz down to toHz, quiet enough to sit
// under a nap, with a short peak and a soft tail.
function baaNote(c, start, fromHz, toHz, glide, tail, stopAt) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const wobble = c.createOscillator();
  const wobbleGain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(fromHz, start);
  osc.frequency.linearRampToValueAtTime(toHz, start + glide);
  wobble.frequency.value = 18;
  wobbleGain.gain.value = 14;
  wobble.connect(wobbleGain).connect(osc.frequency);
  osc.connect(gain).connect(c.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.05, start + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tail);
  osc.start(start);
  wobble.start(start);
  osc.stop(stopAt);
  wobble.stop(stopAt);
}

// The two-note call a newly counted sheep makes while it puffs up: a
// short "baa", then a lower, longer "baaa", so the animal calls out
// before it bursts into confetti.
export function playBaaBaaa() {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  // Note 1: the short "baa", ending before note 2 begins.
  baaNote(c, t, 400, 340, 0.2, 0.22, t + 0.24);
  // Note 2: the lower, longer "baaa", with its longer tail. Its stop is
  // BAA_BAAA_SECONDS after the call began, and never later.
  baaNote(c, t + 0.24, 330, 250, 0.32, 0.32, t + BAA_BAAA_SECONDS);
}

// Sound is off by default. Everything here is generated with the Web
// Audio API, so there are no audio asset files to ship. The AudioContext
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

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

// ---- Background music ----
// A soft looping lullaby, generated note by note with the Web Audio API.
// It has its own on/off switch (the speaker button on the game screen),
// separate from the sound-effects toggle in the grown-ups panel. Like the
// effects, it only ever starts from inside a real tap, per autoplay policy.

// Note lengths are in beats; frequencies in Hz (C major pentatonic, so any
// two notes that overlap still sound sweet). Two 8-beat phrases.
const MELODY = [
  [392.0, 1], [329.63, 1], [392.0, 1], [440.0, 1], [392.0, 2], [329.63, 2],
  [293.66, 1], [329.63, 1], [392.0, 1], [329.63, 1], [293.66, 2], [261.63, 2],
  [392.0, 1], [329.63, 1], [392.0, 1], [523.25, 1], [440.0, 2], [392.0, 2],
  [329.63, 1], [293.66, 1], [329.63, 1], [392.0, 1], [261.63, 4],
];
// One soft bass note per bar of 4 beats.
const BASS = [130.81, 98.0, 110.0, 98.0, 130.81, 110.0, 98.0, 130.81];
const BEAT_S = 0.42;
const MUSIC_VOLUME = 0.05;
const LOOKAHEAD_S = 0.25;

let musicWanted = false; // the toggle
let musicHidden = false; // the app is hidden (tab switched, shell hid us)
let musicStarted = false; // a tap has happened, so audio is allowed
let musicGain = null;
let musicTimer = null;
let nextNoteTime = 0;
let melodyIndex = 0;
let bassIndex = 0;
let nextBassTime = 0;

function musicNote(c, freq, start, dur, type, peak) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.95);
  osc.connect(gain).connect(musicGain);
  osc.start(start);
  osc.stop(start + dur);
}

function scheduleMusic() {
  const c = ctx;
  if (!c || !musicGain) return;
  const horizon = c.currentTime + LOOKAHEAD_S;
  while (nextNoteTime < horizon) {
    const [freq, beats] = MELODY[melodyIndex];
    musicNote(c, freq, nextNoteTime, beats * BEAT_S, 'triangle', 0.6);
    nextNoteTime += beats * BEAT_S;
    melodyIndex = (melodyIndex + 1) % MELODY.length;
  }
  while (nextBassTime < horizon) {
    musicNote(c, BASS[bassIndex], nextBassTime, 4 * BEAT_S, 'sine', 0.45);
    nextBassTime += 4 * BEAT_S;
    bassIndex = (bassIndex + 1) % BASS.length;
  }
}

function updateMusic() {
  const shouldPlay = musicWanted && musicStarted && !musicHidden;
  if (shouldPlay && !musicTimer) {
    const c = getCtx();
    if (!c) return;
    if (!musicGain) {
      musicGain = c.createGain();
      musicGain.connect(c.destination);
    }
    musicGain.gain.cancelScheduledValues(c.currentTime);
    musicGain.gain.setValueAtTime(0.0001, c.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, c.currentTime + 1.2);
    // Restart from the top of the tune, a beat from now.
    nextNoteTime = nextBassTime = c.currentTime + 0.1;
    melodyIndex = bassIndex = 0;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 100);
  } else if (!shouldPlay && musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
    if (ctx && musicGain) {
      // Fade out quickly so the already-scheduled notes don't ring on.
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    }
  }
}

// The toggle value. Turning it on from a tap handler starts the music at
// once; turning it on before any tap just waits for the first one.
export function setMusicEnabled(on) {
  musicWanted = !!on;
  updateMusic();
}

export function isMusicEnabled() {
  return musicWanted;
}

// Call from the first real user gesture (tap / click / key).
export function unlockMusic() {
  if (musicStarted) return;
  musicStarted = true;
  updateMusic();
}

export function setMusicHidden(hidden) {
  musicHidden = !!hidden;
  updateMusic();
}

export function isMusicPlaying() {
  return !!musicTimer;
}

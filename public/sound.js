// Sound effects are off by default and live behind the Grown-ups panel
// toggle. Everything here is generated with the Web Audio API, so there
// are no audio asset files to ship. Every play function checks the shared
// enabled flag itself, so callers never need to gate on the setting, and
// the AudioContext is only ever created/resumed from inside a real tap
// handler, per autoplay policy.

let ctx = null;
let enabled = false;

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

// A soft, short tick per counted sheep. Filtered noise, not a beep, so a
// round of quick taps reads as gentle clicks rather than an alarm.
export function playTapChime(step) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const dur = 0.09;
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1500 + Math.min(step, 12) * 40;
  filter.Q.value = 1.4;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.06, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
}

// A soft, low "baa": a wobbly low tone through a narrow bandpass, kept
// quiet so it sits under the game instead of over it.
export function playBaa() {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(185, t0);
  osc.frequency.linearRampToValueAtTime(150, t0 + 0.4);
  // A slow vibrato gives the tone its bleat.
  const lfo = c.createOscillator();
  lfo.frequency.value = 6;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 9;
  lfo.connect(lfoGain).connect(osc.frequency);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 560;
  filter.Q.value = 2.2;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.03, t0 + 0.22);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + 0.55);
  lfo.stop(t0 + 0.55);
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

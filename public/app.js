import {
  StateStore,
  createDefaultState,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
} from './state.js';
import { motionForRound, normalizeRound, roundSeed, sheepForRound } from './rounds.js';
import { playTapChime, playCelebration } from './sound.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('sheep-countrr:token') || '';
if (params.get('token')) sessionStorage.setItem('sheep-countrr:token', token);

const sceneParam = params.get('scene');
const rendererParam = params.get('renderer');
const roundParam = params.get('round');

// Screenshot-state deep links are pure UI fixtures: they must never touch
// localStorage or the server, in any environment. ?round=N is playable but
// carries the same promise, so a capture run cannot clobber real progress.
const staticMode = !!sceneParam;
const deepLink = staticMode || roundParam !== null;

const reducedMotion = sceneParam === 'still' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
document.documentElement.dataset.motion = reducedMotion ? 'still' : 'full';

// How long the round-complete message sits before the next round starts.
const ADVANCE_DELAY_MS = 1900;
// A beat after the last sheep is tapped, so the tap reads before the round
// settles itself.
const AUTO_SUBMIT_MS = 650;

const els = {
  countDisplay: document.getElementById('count-display'),
  countWord: document.getElementById('count-word'),
  roundBadge: document.getElementById('round-badge'),
  sceneRoot: document.getElementById('scene-root'),
  actionBar: document.getElementById('action-bar'),
  playHint: document.getElementById('play-hint'),
  submitBtn: document.getElementById('submit-count'),
  roundComplete: document.getElementById('round-complete'),
  roundCompleteTitle: document.getElementById('round-complete-title'),
  roundCompleteNext: document.getElementById('round-complete-next'),
  nextRoundBtn: document.getElementById('next-round-btn'),
  gameOver: document.getElementById('game-over'),
  gameOverReason: document.getElementById('game-over-reason'),
  gameOverRound: document.getElementById('game-over-round'),
  restartBtn: document.getElementById('restart-btn'),
  grownupsBtn: document.getElementById('grownups-btn'),
  grownupsPanel: document.getElementById('grownups-panel'),
  grownupsClose: document.getElementById('grownups-close'),
  soundToggle: document.getElementById('sound-toggle'),
  startOverBtn: document.getElementById('start-over-btn'),
  roundValue: document.getElementById('round-value'),
  bestValue: document.getElementById('best-value'),
  totalValue: document.getElementById('total-value'),
  communityValue: document.getElementById('community-value'),
  a11yList: document.getElementById('a11y-sheep-list'),
};

function userIdFromToken(t) {
  if (!t) return 'anon';
  try {
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.id ? String(payload.id) : 'anon';
  } catch {
    return 'anon';
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

const store = new StateStore({
  userId: userIdFromToken(token),
  token,
  ephemeral: deepLink,
  deterministic: deepLink,
  onChange: (state) => updateChrome(state),
});

let renderer = null;
let advanceTimer = null;
let autoSubmitTimer = null;

// Fixed fixtures for the proposal-check deep links, per dapp.json's
// `tests` array — deliberately not read from any network state.
function buildStaticState() {
  const base = createDefaultState();
  const at = (round, extra = {}) => ({
    ...base,
    round,
    sheepCount: sheepForRound(round),
    seed: roundSeed(round),
    bestRound: Math.max(round, base.bestRound),
    ...extra,
  });
  if (sceneParam === 'flock') return at(9);
  if (sceneParam === 'portrait') return at(1);
  if (sceneParam === 'empty') return at(3);
  if (sceneParam === 'midcount') return at(5, { count: 3, counted: [0, 1, 2] });
  if (sceneParam === 'roundcomplete') {
    const n = sheepForRound(4);
    return at(4, { count: n, counted: [...Array(n).keys()], phase: ROUND_PASSED });
  }
  if (sceneParam === 'gameover') {
    return at(6, { count: 4, counted: [0, 1, 2, 3], phase: RUN_OVER, endedBy: ENDED_DOUBLE_TAP });
  }
  if (sceneParam === 'grownups') {
    return at(5, { bestRound: 7, totalCounted: 18, communityTotal: 39 });
  }
  return at(1);
}

async function boot() {
  if (staticMode) {
    store.state = buildStaticState();
  } else if (roundParam !== null) {
    // /?round=N starts a real, playable run at that round, with the round's
    // fixed seed so the same URL always frames the same pasture.
    store.startRound(normalizeRound(roundParam), { silent: true });
  } else {
    store.loadLocal();
    await store.loadRemote();
  }

  const wantsDom = rendererParam === 'dom' || !supportsWebGL();
  renderer = wantsDom ? await mountFallback() : await mountScene();

  renderer.setState(store.state);
  updateChrome(store.state);
  renderA11yList(store.state);

  if (sceneParam === 'grownups') openGrownups(store.state);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) store.flush();
  });
  window.addEventListener('pagehide', () => store.flush());
}

async function mountScene() {
  try {
    const { createSceneRenderer } = await import('./scene.js');
    return createSceneRenderer({
      container: els.sceneRoot,
      reducedMotion,
      onTap: handleTap,
      // The number plate covers the top of the screen and the Done button
      // the bottom; the camera frames the flock in the space between.
      getOverlayRect: () => {
        const plate = document.querySelector('.count-plate');
        return plate ? plate.getBoundingClientRect() : null;
      },
      getBottomOverlayRect: () => (els.actionBar ? els.actionBar.getBoundingClientRect() : null),
      onFatal: async () => {
        renderer?.destroy?.();
        renderer = await mountFallback();
        renderer.setState(store.state);
      },
    });
  } catch (err) {
    console.warn('3D pasture unavailable, using the card view instead', err);
    return mountFallback();
  }
}

async function mountFallback() {
  const { createFallbackRenderer } = await import('./fallback.js');
  return createFallbackRenderer({ container: els.sceneRoot, onTap: handleTap, reducedMotion });
}

function handleTap(index) {
  const result = store.tapSheep(index);
  if (result.outcome === 'counted') {
    renderer.countSheep(index, result.number);
    if (store.state.soundOn) playTapChime(result.number);
    renderA11yList(store.state);
    if (store.isComplete()) {
      // Auto-complete: every sheep is marked, so the round closes itself.
      clearTimeout(autoSubmitTimer);
      autoSubmitTimer = setTimeout(() => {
        if (store.state.phase === COUNTING && store.isComplete()) store.submitCount();
      }, AUTO_SUBMIT_MS);
    }
    return;
  }
  if (result.outcome === 'doubleTap') {
    renderer.wiggleSheep(index);
    renderA11yList(store.state);
  }
}

function submitCount() {
  clearTimeout(autoSubmitTimer);
  store.submitCount();
}

function advanceRound() {
  clearTimeout(advanceTimer);
  if (store.state.phase !== ROUND_PASSED) return;
  store.nextRound();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
}

function restartRun() {
  clearTimeout(advanceTimer);
  clearTimeout(autoSubmitTimer);
  store.restartRun();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
}

function sheepPhrase(n) {
  return n === 1 ? '1 sheep' : `${n} sheep`;
}

// A short, honest warning about what the next flock will do.
function paceLine(round) {
  const m = motionForRound(round);
  if (m.jitterAmp > 0.12) return 'They are jumpy now.';
  if (m.bounceMix > 0.5) return 'They bounce off in all directions.';
  if (m.speed > 1.1) return 'They are quicker.';
  if (m.speed > 0) return 'They start to wander.';
  return 'This one stands still.';
}

function hintFor(state) {
  if (state.phase === ROUND_PASSED) return 'Nicely counted.';
  if (state.phase === RUN_OVER) return 'Tap Start again for round 1.';
  if (state.count === 0) return state.sheepCount === 1 ? 'Tap the sheep.' : 'Tap every sheep.';
  if (state.count >= state.sheepCount) return 'That is all of them.';
  return 'Tap every sheep, then tap Done counting.';
}

let lastShownCount = null;
let lastPhase = null;
function updateChrome(state) {
  if (lastShownCount !== null && state.count > lastShownCount) {
    const plate = els.countDisplay.parentElement;
    plate.classList.remove('count-pop');
    // Restart the animation even when two taps land back to back.
    void plate.offsetWidth;
    plate.classList.add('count-pop');
  }
  lastShownCount = state.count;

  els.roundBadge.textContent = `Round ${state.round}`;
  els.countDisplay.textContent = String(state.count);
  els.countWord.textContent = `of ${sheepPhrase(state.sheepCount)}`;
  els.playHint.textContent = hintFor(state);
  els.submitBtn.disabled = state.phase !== COUNTING;

  els.roundValue.textContent = String(state.round);
  els.bestValue.textContent = String(state.bestRound);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.soundToggle.checked = !!state.soundOn;

  syncPanels(state);
}

function syncPanels(state) {
  const passed = state.phase === ROUND_PASSED;
  const over = state.phase === RUN_OVER;

  if (passed) {
    els.roundCompleteTitle.textContent = `Round ${state.round} counted.`;
    els.roundCompleteNext.textContent =
      `Next up: ${sheepPhrase(sheepForRound(state.round + 1))}. ${paceLine(state.round + 1)}`;
  }
  if (over) {
    els.gameOverRound.textContent = String(state.round);
    els.gameOverReason.textContent = state.endedBy === ENDED_DOUBLE_TAP
      ? 'You counted the same sheep twice.'
      : `You said done with ${state.count} of ${sheepPhrase(state.sheepCount)} counted.`;
  }
  els.roundComplete.hidden = !passed;
  els.gameOver.hidden = !over;

  if (state.phase === lastPhase) return;
  lastPhase = state.phase;
  clearTimeout(advanceTimer);
  if (passed) {
    renderer?.celebrate?.();
    if (state.soundOn) playCelebration();
    // Frozen fixtures stay put so a screenshot catches the message.
    if (!staticMode) advanceTimer = setTimeout(advanceRound, ADVANCE_DELAY_MS);
  }
}

function renderA11yList(state) {
  // Keep the focused button alive while announcing its new counted state.
  if (els.a11yList.children.length !== state.sheepCount) {
    els.a11yList.replaceChildren();
    for (let i = 0; i < state.sheepCount; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.addEventListener('click', () => handleTap(i));
      els.a11yList.appendChild(btn);
    }
  }
  Array.from(els.a11yList.children).forEach((btn, i) => {
    btn.textContent = state.counted.includes(i)
      ? `Sheep ${i + 1}, counted` : `Sheep ${i + 1}, not counted yet`;
  });
}

els.submitBtn.addEventListener('click', submitCount);
els.nextRoundBtn.addEventListener('click', advanceRound);
els.restartBtn.addEventListener('click', restartRun);

// Grown-ups gate: only opens after a ~1.5s press-and-hold, so mashing the
// screen never lands a child in it.
let holdTimer = null;
function startHold() {
  holdTimer = setTimeout(() => openGrownups(store.state), 1500);
}
function cancelHold() {
  clearTimeout(holdTimer);
}
els.grownupsBtn.addEventListener('pointerdown', startHold);
els.grownupsBtn.addEventListener('pointerup', cancelHold);
els.grownupsBtn.addEventListener('pointerleave', cancelHold);
els.grownupsBtn.addEventListener('pointercancel', cancelHold);
els.grownupsBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGrownups(store.state); }
});

function openGrownups(state) {
  els.roundValue.textContent = String(state.round);
  els.bestValue.textContent = String(state.bestRound);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.soundToggle.checked = !!state.soundOn;
  els.grownupsPanel.hidden = false;
}
function closeGrownups() {
  els.grownupsPanel.hidden = true;
}
els.grownupsClose.addEventListener('click', closeGrownups);

els.soundToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  store.setSoundOn(e.target.checked);
});

els.startOverBtn.addEventListener('click', () => {
  if (staticMode) return;
  restartRun();
  closeGrownups();
});

boot();

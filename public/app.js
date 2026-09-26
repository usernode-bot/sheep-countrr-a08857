import {
  StateStore,
  createDefaultState,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
} from './state.js';
import {
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
  normalizeRound,
  paceLine,
  roundIntroText,
  roundSeed,
  sheepForRound,
  sheepPhrase,
  successMessage,
} from './rounds.js';
import { playTapChime, playCelebration } from './sound.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('sheep-countrr:token') || '';
if (params.get('token')) sessionStorage.setItem('sheep-countrr:token', token);

const sceneParam = params.get('scene');
const rendererParam = params.get('renderer');
const roundParam = params.get('round');
// A deep link may name a difficulty; an unknown value falls back to Normal.
// It composes with /?round=N and /?scene=X and, like them, is never
// persisted from a deep link.
const difficultyParam = normalizeDifficulty(params.get('difficulty'));
const hasDifficultyParam = params.get('difficulty') !== null;

// Screenshot-state deep links are pure UI fixtures: they must never touch
// localStorage or the server, in any environment. ?round=N is playable but
// carries the same promise, so a capture run cannot clobber real progress.
const staticMode = !!sceneParam;
const deepLink = staticMode || roundParam !== null;

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How long the success message sits before the next round starts. Long
// enough for the praise line to be read; the Next round button skips it.
const ADVANCE_DELAY_MS = 2600;
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
  roundIntro: document.getElementById('round-intro'),
  roundIntroSize: document.getElementById('round-intro-size'),
  startCountingBtn: document.getElementById('start-counting-btn'),
  roundComplete: document.getElementById('round-complete'),
  successTitle: document.getElementById('success-title'),
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
  difficultyValue: document.getElementById('difficulty-value'),
  difficultyPicker: document.getElementById('difficulty-picker'),
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
// True while the pre-round briefing covers the board, so no tap or
// submit can register before the player taps Start counting.
let introOpen = false;

// Fixed fixtures for the proposal-check deep links, per dapp.json's
// `tests` array — deliberately not read from any network state.
function buildStaticState() {
  const base = createDefaultState();
  const at = (round, extra = {}) => ({
    ...base,
    round,
    difficulty: difficultyParam,
    sheepCount: sheepForRound(round, difficultyParam),
    seed: roundSeed(round),
    bestRounds: { ...base.bestRounds, [difficultyParam]: Math.max(round, base.bestRounds[difficultyParam]) },
    ...extra,
  });
  if (sceneParam === 'flock') return at(9);
  if (sceneParam === 'portrait') return at(1);
  if (sceneParam === 'empty') return at(3);
  if (sceneParam === 'midcount') return at(5, { count: 3, counted: [0, 1, 2] });
  if (sceneParam === 'roundcomplete') {
    const n = sheepForRound(4, difficultyParam);
    return at(4, { count: n, counted: [...Array(n).keys()], phase: ROUND_PASSED });
  }
  if (sceneParam === 'gameover') {
    return at(6, { count: 4, counted: [0, 1, 2, 3], phase: RUN_OVER, endedBy: ENDED_DOUBLE_TAP });
  }
  if (sceneParam === 'grownups') {
    return at(5, {
      bestRounds: { easy: 3, normal: 7, hard: 5, expert: 2 },
      totalCounted: 18,
      communityTotal: 39,
    });
  }
  return at(1);
}

async function boot() {
  if (staticMode) {
    store.state = buildStaticState();
  } else if (roundParam !== null) {
    // /?round=N starts a real, playable run at that round, with the round's
    // fixed seed so the same URL always frames the same pasture. An optional
    // difficulty= picks the curve; it stays ephemeral like the round itself.
    if (hasDifficultyParam) store.state = { ...store.state, difficulty: difficultyParam };
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

  // The briefing covers the board before the first round of a run starts
  // counting. Frozen ?scene= fixtures stay card-free, and a player resuming
  // mid-run at a later round has already played.
  if (!staticMode && store.state.round === 1) showRoundIntro(store.state);
  // On a /?round=N deep link the intro is suppressed (the player has
  // already played), but the difficulty fixtures need the picker to be
  // visible for their dapp.json check. Render it without opening the card.
  if (staticMode && roundParam !== null) syncDifficultyPicker(store.state);

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
  // The briefing is open: no count registers until the player starts.
  if (introOpen) return;
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
  if (introOpen) return;
  clearTimeout(autoSubmitTimer);
  store.submitCount();
}

// The pre-round briefing. Shown before the first round of a run; the one
// button starts counting. The difficulty picker lives on the card. Selecting a level
// immediately rewrites the briefing line, so the player can see what each
// level means before committing to Start counting.
const DIFFICULTY_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };

function syncDifficultyPicker(state) {
  for (const btn of els.difficultyPicker.querySelectorAll('.difficulty-pill')) {
    const level = normalizeDifficulty(btn.dataset.difficulty);
    btn.setAttribute('aria-checked', String(level === state.difficulty));
  }
  els.difficultyValue.textContent = DIFFICULTY_LABELS[state.difficulty] || 'Normal';
  els.bestValue.textContent = String(store.bestRound);
}

function showRoundIntro(state) {
  els.roundIntroSize.textContent = roundIntroText(state.round, state.difficulty);
  syncDifficultyPicker(state);
  els.roundIntro.hidden = false;
  introOpen = true;
}

function dismissRoundIntro() {
  introOpen = false;
  els.roundIntro.hidden = true;
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
  // A restart is the start of a fresh run, so the briefing comes back.
  // Frozen ?scene= fixtures stay card-free.
  if (!staticMode) showRoundIntro(store.state);
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
  els.bestValue.textContent = String(store.bestRound);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.soundToggle.checked = !!state.soundOn;

  syncPanels(state);
}

function syncPanels(state) {
  const passed = state.phase === ROUND_PASSED;
  const over = state.phase === RUN_OVER;

  if (passed) {
    els.successTitle.textContent = successMessage();
    els.roundCompleteTitle.textContent = `Round ${state.round} counted.`;
    els.roundCompleteNext.textContent =
      `Next up: ${sheepPhrase(sheepForRound(state.round + 1, state.difficulty))}. ${paceLine(state.round + 1, state.difficulty)}`;
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
els.startCountingBtn.addEventListener('click', dismissRoundIntro);
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
  els.bestValue.textContent = String(store.bestRound);
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

// Picking a level on the briefing card switches the run to that level at
// round 1. In staticMode the pills render from the fixture but taps are
// ignored, exactly like the sound toggle above.
for (const btn of els.difficultyPicker.querySelectorAll('.difficulty-pill')) {
  btn.addEventListener('click', () => {
    if (staticMode) return;
    store.setDifficulty(btn.dataset.difficulty);
    syncDifficultyPicker(store.state);
    els.roundIntroSize.textContent = roundIntroText(store.state.round, store.state.difficulty);
    // The board behind the card shows the new level's round 1 flock.
    renderer?.resetRound(store.state);
    renderA11yList(store.state);
  });
}

els.startOverBtn.addEventListener('click', () => {
  if (staticMode) return;
  restartRun();
  closeGrownups();
});

boot();

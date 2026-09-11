import { StateStore, createDefaultState } from './state.js';
import { playTapChime, playCelebration } from './sound.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || sessionStorage.getItem('sheep-countrr:token') || '';
if (params.get('token')) sessionStorage.setItem('sheep-countrr:token', token);

const sceneParam = params.get('scene');
const rendererParam = params.get('renderer');
// Screenshot-state deep links are pure UI fixtures: they must never
// touch localStorage or the server, in any environment.
const staticMode = !!sceneParam;

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

const els = {
  countDisplay: document.getElementById('count-display'),
  countWord: document.getElementById('count-word'),
  sceneRoot: document.getElementById('scene-root'),
  celebration: document.getElementById('celebration'),
  celebrationTotal: document.getElementById('celebration-total'),
  countAgainBtn: document.getElementById('count-again-btn'),
  grownupsBtn: document.getElementById('grownups-btn'),
  grownupsPanel: document.getElementById('grownups-panel'),
  grownupsClose: document.getElementById('grownups-close'),
  soundToggle: document.getElementById('sound-toggle'),
  herdSizeInput: document.getElementById('herd-size-input'),
  startOverBtn: document.getElementById('start-over-btn'),
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
  staticMode,
  onChange: (state) => updateChrome(state),
});

let renderer = null;

// Fixed fixtures for the proposal-check deep links, per dapp.json's
// `tests` array — deliberately not read from any network state.
function buildStaticState() {
  const base = createDefaultState();
  base.seed = 42;
  if (sceneParam === 'flock') return { ...base, herdSize: 10, seed: 47 };
  if (sceneParam === 'portrait') return { ...base, herdSize: 1, seed: 42 };
  if (sceneParam === 'empty') return { ...base, herdSize: 5, count: 0, counted: [] };
  if (sceneParam === 'midcount') return { ...base, herdSize: 5, count: 3, counted: [0, 1, 2] };
  if (sceneParam === 'celebrate') return { ...base, herdSize: 5, count: 5, counted: [0, 1, 2, 3, 4] };
  if (sceneParam === 'grownups') {
    return { ...base, herdSize: 5, count: 0, counted: [], best: 7, totalCounted: 18, communityTotal: 39 };
  }
  return base;
}

async function boot() {
  store.loadLocal();
  if (staticMode) {
    store.state = buildStaticState();
  } else {
    await store.loadRemote();
  }

  const wantsDom = rendererParam === 'dom' || !supportsWebGL();
  renderer = wantsDom ? await mountFallback() : await mountScene();

  renderer.setState(store.state);
  updateChrome(store.state);
  renderA11yList(store.state);

  if (sceneParam === 'celebrate') openCelebration(store.state);
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
      // The number plate covers the top of the screen; the camera frames
      // the flock in the space below it.
      getOverlayRect: () => {
        const plate = document.querySelector('.count-plate');
        return plate ? plate.getBoundingClientRect() : null;
      },
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
  if (store.state.counted.includes(index)) {
    renderer.wiggleSheep(index);
    return;
  }
  const number = store.countSheep(index);
  if (number == null) return;
  renderer.countSheep(index, number);
  if (store.state.soundOn) playTapChime(number);

  renderA11yList(store.state);
  if (store.isComplete()) {
    setTimeout(() => { if (store.isComplete()) openCelebration(store.state); }, 1400);
  }
}

let lastShownCount = null;
function updateChrome(state) {
  if (lastShownCount !== null && state.count > lastShownCount) {
    const plate = els.countDisplay.parentElement;
    plate.classList.remove('count-pop');
    // Restart the animation even when two taps land back to back.
    void plate.offsetWidth;
    plate.classList.add('count-pop');
  }
  lastShownCount = state.count;
  els.countDisplay.textContent = String(state.count);
  els.countWord.textContent = NUMBER_WORDS[Math.min(state.count, 10)] || String(state.count);
  els.bestValue.textContent = String(state.best);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.herdSizeInput.value = String(state.herdSize);
  els.soundToggle.checked = !!state.soundOn;
}

function renderA11yList(state) {
  // Keep the focused button alive while announcing its new counted state.
  if (els.a11yList.children.length !== state.herdSize) {
    els.a11yList.replaceChildren();
    for (let i = 0; i < state.herdSize; i++) {
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

function openCelebration(state) {
  els.celebrationTotal.textContent = String(state.herdSize);
  els.celebration.hidden = false;
  renderer?.celebrate?.();
  if (state.soundOn) playCelebration();
}
function closeCelebration() {
  els.celebration.hidden = true;
}

els.countAgainBtn.addEventListener('click', () => {
  closeCelebration();
  if (staticMode) return;
  store.startNewRound({ carryHerdGrowth: true });
  renderer.resetRound(store.state);
  renderA11yList(store.state);
});

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
  els.bestValue.textContent = String(state.best);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.herdSizeInput.value = String(state.herdSize);
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

els.herdSizeInput.addEventListener('change', (e) => {
  if (staticMode) return;
  const n = parseInt(e.target.value, 10);
  store.setHerdSize(n);
  renderer.resetRound(store.state);
  renderA11yList(store.state);
  closeGrownups();
});

els.startOverBtn.addEventListener('click', () => {
  if (staticMode) return;
  store.resetRound();
  renderer.resetRound(store.state);
  renderA11yList(store.state);
  closeGrownups();
});

boot();

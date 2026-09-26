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
import {
  playTapChime,
  playBaa,
  playCelebration,
  setSoundEnabled,
  setMusicEnabled,
  setMusicHidden,
  unlockMusic,
} from './sound.js';
import { sortScoreRows } from './leaderboard.js';

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
// The grown-ups fixture can force the sound toggle on (the shipped default
// for the frozen ?scene=grownups card) without touching localStorage.
const soundParam = params.get('sound');
// Optional landing tab for the leaderboard fixture (?scene=leaderboard&tab=weekly).
const tabParam = params.get('tab');

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
  musicBtn: document.getElementById('music-btn'),
  startOverBtn: document.getElementById('start-over-btn'),
  roundValue: document.getElementById('round-value'),
  bestValue: document.getElementById('best-value'),
  totalValue: document.getElementById('total-value'),
  communityValue: document.getElementById('community-value'),
  difficultyValue: document.getElementById('difficulty-value'),
  difficultyPicker: document.getElementById('difficulty-picker'),
  a11yList: document.getElementById('a11y-sheep-list'),
  leaderboardBtn: document.getElementById('leaderboard-btn'),
  leaderboard: document.getElementById('leaderboard'),
  leaderboardClose: document.getElementById('leaderboard-close'),
  leaderboardTabs: document.getElementById('leaderboard-tabs'),
  tabButtons: {
    global: document.getElementById('tab-global'),
    friends: document.getElementById('tab-friends'),
    weekly: document.getElementById('tab-weekly'),
  },
  leaderboardList: document.getElementById('leaderboard-list'),
  friendAdd: document.getElementById('friend-add'),
  friendInput: document.getElementById('friend-input'),
  friendResults: document.getElementById('friend-results'),
  friendError: document.getElementById('friend-error'),
};

function claimsFromToken(t) {
  if (!t) return null;
  try {
    return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function userIdFromToken(t) {
  const claims = claimsFromToken(t);
  return claims && claims.id ? String(claims.id) : 'anon';
}

function usernameFromToken(t) {
  const claims = claimsFromToken(t);
  return claims && claims.username ? String(claims.username) : null;
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

// The signed-in handle, from the same verified token the server trusts.
// Used to highlight the player's own leaderboard row and to stop a
// self-add before it hits the server.
store.state.meUsername = usernameFromToken(token);

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
      soundOn: soundParam === null || soundParam === '1',
    });
  }
  return at(1);
}

// Hardcoded demo data for the leaderboard fixture. The three names match
// the staging seed rows so check text and preview data agree; staticMode
// must never fetch, so the rows live here.
const LEADERBOARD_FIXTURE = {
  global: [
    { username: 'Staging demo: Bess', bestRound: 12, totalCounted: 40 },
    { username: 'Staging demo: Mabel', bestRound: 9, totalCounted: 23 },
    { username: 'Staging demo: Otto', bestRound: 6, totalCounted: 11 },
    { username: 'Staging demo: Pip', bestRound: 3, totalCounted: 5 },
  ],
  weekly: [
    { username: 'Staging demo: Mabel', roundReached: 8 },
    { username: 'Staging demo: Otto', roundReached: 7 },
    { username: 'Staging demo: Pip', roundReached: 4 },
  ],
  friends: [],
};

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

  if (sceneParam === 'leaderboard') {
    const tab = tabParam === 'weekly' || tabParam === 'friends' ? tabParam : 'global';
    openLeaderboard(LEADERBOARD_FIXTURE, tab);
  }

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
    if (store.state.soundOn) {
      playBaa();
      playTapChime(result.number);
    }
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
  // A soft baa announces the new flock. playBaa checks the sound
  // setting itself, so no extra gate is needed here.
  playBaa();
}

function advanceRound() {
  clearTimeout(advanceTimer);
  if (store.state.phase !== ROUND_PASSED) return;
  store.nextRound();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  playBaa();
}

function restartRun() {
  clearTimeout(advanceTimer);
  clearTimeout(autoSubmitTimer);
  store.restartRun();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  playBaa();
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
  // Keep the audio module's enabled flag in lockstep with the toggle, so
  // every sound path (chime, baa, celebration) reads one source of truth.
  setSoundEnabled(!!state.soundOn);

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
    playBaa();
  }
  els.roundComplete.hidden = !passed;
  els.gameOver.hidden = !over;

  if (state.phase === lastPhase) return;
  lastPhase = state.phase;
  clearTimeout(advanceTimer);
  if (passed) {
    renderer?.celebrate?.();
    playCelebration();
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

// ---- Leaderboard card ----
// Tab state is memory-only: the card always opens on Global, matching the
// panel's transient nature. All text is set via textContent; rows are built
// from plain objects, never HTML strings.
let activeTab = 'global';
let leaderboardData = { global: [], weekly: [], friends: [] };
let friendSearchTimer = null;

function openLeaderboard(data, tab) {
  if (data) leaderboardData = data;
  els.leaderboard.hidden = false;
  selectTab(tab || 'global');
  if (!staticMode) loadLeaderboard();
}

function closeLeaderboard() {
  els.leaderboard.hidden = true;
}

async function loadLeaderboard() {
  if (!token) return;
  renderLoading();
  try {
    const res = await fetch('/api/leaderboard', { headers: { 'x-usernode-token': token } });
    if (!res.ok) throw new Error('bad status');
    leaderboardData = await res.json();
    renderTab();
  } catch {
    renderNote('Could not load the leaderboard. Try again.');
  }
}

function selectTab(tab) {
  activeTab = tab;
  for (const [name, btn] of Object.entries(els.tabButtons)) {
    if (btn) btn.setAttribute('aria-selected', String(name === tab));
  }
  if (els.friendAdd) els.friendAdd.hidden = tab !== 'friends';
  renderTab();
}

function renderLoading() {
  els.leaderboardList.replaceChildren();
  const note = document.createElement('p');
  note.className = 'lb-note';
  note.textContent = 'Loading…';
  els.leaderboardList.appendChild(note);
}

function renderNote(text) {
  els.leaderboardList.replaceChildren();
  const note = document.createElement('p');
  note.className = 'lb-note';
  note.textContent = text;
  els.leaderboardList.appendChild(note);
}

function scoreRow({ rank, name, score, scoreLabel, isMe, removable }) {
  const row = document.createElement('div');
  row.className = 'lb-row' + (isMe ? ' is-me' : '');

  const rankEl = document.createElement('span');
  rankEl.className = 'lb-rank';
  rankEl.textContent = String(rank);
  row.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'lb-name';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  const scoreEl = document.createElement('span');
  scoreEl.className = 'lb-score';
  scoreEl.textContent = scoreLabel;
  row.appendChild(scoreEl);

  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'lb-remove';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => removeFriend(name));
    row.appendChild(remove);
  }
  return row;
}

function renderTab() {
  if (!els.leaderboardList) return;
  els.leaderboardList.replaceChildren();

  if (activeTab === 'weekly') {
    const rows = sortScoreRows(leaderboardData.weekly || [], { getScore: (r) => r.roundReached });
    if (!rows.length) {
      renderNote('No scores yet this week.');
      return;
    }
    rows.forEach((r, i) => {
      els.leaderboardList.appendChild(scoreRow({
        rank: i + 1,
        name: r.username,
        scoreLabel: `Round ${r.roundReached}`,
        isMe: isMe(r.username),
      }));
    });
    return;
  }

  if (activeTab === 'friends') {
    const rows = sortScoreRows(leaderboardData.friends || []);
    if (!(leaderboardData.friends || []).length) {
      renderNote('Add a friend to see their best round.');
      return;
    }
    rows.forEach((r, i) => {
      els.leaderboardList.appendChild(scoreRow({
        rank: r.bestRound == null ? '-' : i + 1,
        name: r.username,
        scoreLabel: r.bestRound == null ? 'No score yet' : `Round ${r.bestRound}`,
        isMe: false,
        removable: true,
      }));
    });
    return;
  }

  const rows = sortScoreRows(leaderboardData.global || [], { getScore2: (r) => r.totalCounted });
  if (!rows.length) {
    renderNote('No scores yet.');
    return;
  }
  rows.forEach((r, i) => {
    els.leaderboardList.appendChild(scoreRow({
      rank: i + 1,
      name: r.username,
      scoreLabel: `Round ${r.bestRound}`,
      isMe: isMe(r.username),
    }));
  });
}

function isMe(name) {
  try {
    return String(name) === String(store.state.meUsername || '');
  } catch {
    return false;
  }
}

// ---- Friend picker ----
// Typeahead through the platform shell (usernode.searchUsers); exact adds
// go through usernode.lookupUser. Both reject outside the shell: catch that
// and degrade open, accepting the typed handle. Never block adding on a
// lookup we could not perform.
function cleanHandle(raw) {
  return String(raw || '').trim().replace(/^@+/, '');
}

function validHandleLocal(handle) {
  return /^[A-Za-z0-9._-]{1,64}$/.test(handle);
}

function showFriendError(text) {
  els.friendError.hidden = !text;
  els.friendError.textContent = text || '';
}

function renderResults(users) {
  els.friendResults.replaceChildren();
  if (!users.length) {
    els.friendResults.classList.remove('open');
    return;
  }
  els.friendResults.classList.add('open');
  for (const u of users) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = u.username;
    btn.addEventListener('click', () => {
      els.friendResults.classList.remove('open');
      addFriend(u.username, u.id);
    });
    els.friendResults.appendChild(btn);
  }
}

async function searchFriends(prefix) {
  const handle = cleanHandle(prefix);
  if (!validHandleLocal(handle)) {
    renderResults([]);
    return;
  }
  try {
    const { users = [] } = await window.usernode.searchUsers(handle, { limit: 10 });
    renderResults(users.filter((u) => cleanHandle(u.username) !== store.state.meUsername));
  } catch {
    renderResults([]);
  }
}

async function addFriend(rawHandle, friendUserId) {
  const handle = cleanHandle(rawHandle);
  if (!validHandleLocal(handle)) {
    showFriendError('Use letters, numbers, dots, dashes or underscores.');
    return;
  }
  if (handle === store.state.meUsername) {
    showFriendError('That is your own handle.');
    return;
  }
  els.friendInput.value = '';
  renderResults([]);
  showFriendError('');

  // Exact-entry add: confirm existence when the shell is present. Outside
  // it (or on any lookup failure) accept the handle as typed.
  try {
    const { found, user } = await window.usernode.lookupUser(handle);
    if (found === false) {
      showFriendError('No user with that handle.');
      return;
    }
    if (user && user.username) {
      return persistFriend(user.username, user.id);
    }
  } catch {
    /* no shell: accept as typed */
  }
  return persistFriend(handle, friendUserId);
}

async function persistFriend(username, friendUserId) {
  try {
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usernode-token': token },
      body: JSON.stringify({ username, friendUserId }),
    });
    if (!res.ok) throw new Error('bad status');
  } catch {
    showFriendError('Could not add that friend. Try again.');
    return;
  }
  await loadLeaderboard();
}

async function removeFriend(username) {
  try {
    await fetch('/api/friends', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-usernode-token': token },
      body: JSON.stringify({ username }),
    });
  } catch {
    /* best effort; the list reloads below anyway */
  }
  await loadLeaderboard();
}

els.friendInput.addEventListener('input', () => {
  showFriendError('');
  clearTimeout(friendSearchTimer);
  friendSearchTimer = setTimeout(() => searchFriends(els.friendInput.value), 200);
});

els.leaderboardBtn.addEventListener('click', () => {
  closeGrownups();
  openLeaderboard();
});
els.leaderboardClose.addEventListener('click', closeLeaderboard);
for (const [name, btn] of Object.entries(els.tabButtons)) {
  if (btn) btn.addEventListener('click', () => selectTab(name));
}

boot();

// ---- Background music ----
// On by default, remembered per device. Deep links (?scene=, ?round=) never
// touch localStorage, so there the choice lives for the page only.
const MUSIC_KEY = 'sheep-countrr:music';
function loadMusicPref() {
  if (deepLink) return true;
  try {
    return localStorage.getItem(MUSIC_KEY) !== 'off';
  } catch {
    return true;
  }
}
function renderMusicBtn(on) {
  els.musicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.musicBtn.setAttribute('aria-label', on ? 'Music on. Tap to mute.' : 'Music off. Tap to play music.');
}
let musicOn = loadMusicPref();
renderMusicBtn(musicOn);
setMusicEnabled(musicOn);
setMusicHidden(document.hidden);

els.musicBtn.addEventListener('click', () => {
  musicOn = !musicOn;
  renderMusicBtn(musicOn);
  setMusicEnabled(musicOn);
  unlockMusic();
  if (!deepLink) {
    try {
      localStorage.setItem(MUSIC_KEY, musicOn ? 'on' : 'off');
    } catch {
      /* storage refused: the choice lasts for this visit */
    }
  }
});

// Browsers only allow audio after a gesture, so the first tap anywhere
// starts the music. Taps on the music button itself are left to its own
// click handler, so a first tap there mutes instead of playing a blip.
function firstGesture(e) {
  if (e.target && e.target.closest && e.target.closest('#music-btn')) return;
  unlockMusic();
  window.removeEventListener('pointerdown', firstGesture, true);
  window.removeEventListener('keydown', firstGesture, true);
}
window.addEventListener('pointerdown', firstGesture, true);
window.addEventListener('keydown', firstGesture, true);

// Pause while nobody is looking: a switched tab, or the platform shell
// keeping this app loaded but hidden.
document.addEventListener('visibilitychange', () => setMusicHidden(document.hidden));
window.addEventListener('usernode:visibility-changed', (e) => {
  setMusicHidden(!!(e.detail && e.detail.hidden) || document.hidden);
});

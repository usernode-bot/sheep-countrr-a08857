import {
  StateStore,
  createDefaultState,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
  ENDED_TIME_UP,
} from './state.js';
import {
  DEFAULT_DIFFICULTY,
  SPEED_ROUND_SECONDS,
  normalizeDifficulty,
  normalizeRound,
  normalizeSpeedRound,
  paceLine,
  roundCompleteTitle,
  roundIntroText,
  roundSeed,
  sheepForRound,
  sheepPhrase,
  speedRoundClock,
  successMessage,
  weeklyScoreLabel,
} from './rounds.js';
import { playTapChime, playBaa, playCelebration, setSoundEnabled } from './sound.js';
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
// The Speed Round flag from a deep link (?round=8&speed=1): it applies to
// the run it opens, but like the difficulty it is never persisted from a
// deep link, so the store stays ephemeral there.
const hasSpeedParam = params.get('speed') !== null;
const speedParam = normalizeSpeedRound(params.get('speed') === '1');
// The grown-ups fixture can force the sound toggle on (the shipped default
// for the frozen ?scene=grownups card) without touching localStorage.
const soundParam = params.get('sound');
// The grown-ups fixture can force the Night Meadow toggle the same way
// (?night=1 shows the night scene without touching localStorage).
const nightParam = params.get('night');
// Optional landing tab for the leaderboard fixture (?scene=leaderboard&tab=weekly).
const tabParam = params.get('tab');
// The two public share surfaces. Their URLs are plain paths, so detection is
// a pathname match; both views fetch only their own public endpoint and
// never touch localStorage, authenticated endpoints, or game state.
const shareMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
const inviteMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
const shareKey = shareMatch ? shareMatch[1] : null;
const inviteCode = inviteMatch ? inviteMatch[1] : null;
const publicViewMode = shareKey ? 'share' : (inviteCode ? 'invite' : null);
// The invite page's one link breaks out of the platform's preview frame
// into the real chromeless view; a tokenless top-level visit already lands
// there through the server's own redirect. The target needs the platform
// origin, which the page only knows inside the shell: outside it the
// relative href stays and the browser resolves it against the app's own
// host, where the landing-page fallback takes over gracefully.
const PLATFORM_ORIGIN = (window.USERNODE_PLATFORM_ORIGIN || '');
const inviteHref = PLATFORM_ORIGIN
  ? `${PLATFORM_ORIGIN}/app/sheep-countrr-a08857/full`
  : '/app/sheep-countrr-a08857/full';

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
// One second per countdown number, per the brief.
const COUNTDOWN_STEP_MS = 1000;

// Recolors the sky and ground only. The DOM class carries the CSS side
// (page sky gradient and the DOM fallback's field), and the renderer gets
// the same flag so the WebGL ground, hills and fog follow. Nothing else on
// the page changes color.
function applyTheme(state) {
  document.body.classList.toggle('theme-night', !!state.nightOn);
  renderer?.setNight?.(!!state.nightOn);
}

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
  countdownOverlay: document.getElementById('countdown-overlay'),
  countdownNumber: document.getElementById('countdown-number'),
  countdownStatus: document.getElementById('countdown-status'),
  countdownSkipBtn: document.getElementById('countdown-skip-btn'),
  bestRoundChip: document.getElementById('best-round-chip'),
  bestRoundValue: document.getElementById('best-round-value'),
  startCountingBtn: document.getElementById('start-counting-btn'),
  speedToggle: document.getElementById('speed-toggle'),
  speedTimer: document.getElementById('speed-timer'),
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
  nightToggle: document.getElementById('night-toggle'),
  startOverBtn: document.getElementById('start-over-btn'),
  roundValue: document.getElementById('round-value'),
  bestValue: document.getElementById('best-value'),
  totalValue: document.getElementById('total-value'),
  communityValue: document.getElementById('community-value'),
  difficultyValue: document.getElementById('difficulty-value'),
  difficultyPicker: document.getElementById('difficulty-picker'),
  a11yList: document.getElementById('a11y-sheep-list'),
  leaderboardBtn: document.getElementById('leaderboard-btn'),
  countBadge: document.getElementById('count-badge'),
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
  shareBtn: document.getElementById('share-btn'),
  sharedBy: document.getElementById('shared-by'),
  inviteCard: document.getElementById('invite-card'),
  inviteInvitee: document.getElementById('invite-invitee'),
  inviteTagline: document.getElementById('invite-tagline'),
  inviteButton: document.getElementById('invite-button'),
  inviteFriendBtn: document.getElementById('invite-friend-btn'),
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
// True while the 3-2-1 countdown covers the board. Like the briefing, it
// is modal: taps, keyboard counting and Done counting all stay blocked
// until it finishes (or is skipped).
let countdownOpen = false;
// The one interval that steps the 3-2-1 overlay. Cleared with the round
// itself (advance, restart, visibility) so a stale tick can never start
// a round the player has already left.
let countdownTimer = null;

// Fixed fixtures for the proposal-check deep links, per dapp.json's
// `tests` array — deliberately not read from any network state.
function buildStaticState() {
  const base = createDefaultState();
  const at = (round, extra = {}) => ({
    ...base,
    round,
    difficulty: difficultyParam,
    speedOn: hasSpeedParam && speedParam,
    secondsLeft: hasSpeedParam && speedParam ? SPEED_ROUND_SECONDS : null,
    sheepCount: sheepForRound(round, difficultyParam),
    seed: roundSeed(round),
    bestRounds: { ...base.bestRounds, [difficultyParam]: Math.max(round, base.bestRounds[difficultyParam]) },
    ...extra,
  });
  if (sceneParam === 'flock') return at(9);
  if (sceneParam === 'countdown') {
    // The 3-2-1 countdown overlay, frozen with the first number on it.
    // Everything else reads like a live round-1 board, so the card's
    // dapp.json check sees the real surface.
    return at(1);
  }
  if (sceneParam === 'intro') {
    // The Get-ready card with an earned best round on it, so the chip has a
    // frozen fixture for its dapp.json check. Hardcoded only, like every
    // other fixture here.
    return at(1, { bestRounds: { ...base.bestRounds, [difficultyParam]: 6 } });
  }
  if (sceneParam === 'portrait') return at(1);
  if (sceneParam === 'empty') return at(3);
  if (sceneParam === 'midcount') return at(5, { count: 3, counted: [0, 1, 2] });
  if (sceneParam === 'speed') {
    // The Speed Round board mid-count, clock visibly running: the dapp.json
    // check reads the countdown pill from this route.
    return at(3, { count: 2, counted: [0, 1], speedOn: true, secondsLeft: SPEED_ROUND_SECONDS });
  }
  if (sceneParam === 'roundcomplete') {
    const n = sheepForRound(4, difficultyParam);
    return at(4, { count: n, counted: [...Array(n).keys()], phase: ROUND_PASSED });
  }
  if (sceneParam === 'gameover') {
    return at(6, { count: 4, counted: [0, 1, 2, 3], phase: RUN_OVER, endedBy: ENDED_DOUBLE_TAP });
  }
  if (sceneParam === 'speedgameover') {
    // A Speed Round the clock ran out on: its own game-over reason line,
    // with the mode still named on the round badge behind the card.
    return at(4, { count: 3, counted: [0, 1, 2], phase: RUN_OVER, speedOn: true, secondsLeft: 0, endedBy: ENDED_TIME_UP });
  }
  if (sceneParam === 'grownups') {
    return at(5, {
      bestRounds: { easy: 3, normal: 7, hard: 5, expert: 2 },
      totalCounted: 18,
      communityTotal: 39,
      soundOn: soundParam === null || soundParam === '1',
      nightOn: nightParam === '1',
    });
  }
  if (sceneParam === 'sharegameover') {
    // The public share view for Mabel's seeded demo run: the round-8 flock
    // behind the game-over card, read-only, with the shared-by line.
    return at(8, { count: 4, counted: [0, 1, 2, 3], phase: RUN_OVER, endedBy: ENDED_DOUBLE_TAP });
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
    { username: 'Staging demo: Mabel', roundReached: 8, speedRound: true },
    { username: 'Staging demo: Otto', roundReached: 7 },
    { username: 'Staging demo: Pip', roundReached: 4 },
  ],
  friends: [],
};

async function boot() {
  if (publicViewMode) {
    await bootPublicView();
    return;
  }
  if (staticMode) {
    store.state = buildStaticState();
  } else if (roundParam !== null) {
    // /?round=N starts a real, playable run at that round, with the round's
    // fixed seed so the same URL always frames the same pasture. An optional
    // difficulty= picks the curve; it stays ephemeral like the round itself.
    if (hasDifficultyParam) store.state = { ...store.state, difficulty: difficultyParam };
    if (hasSpeedParam) store.state = { ...store.state, speedOn: speedParam };
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
  // The frozen intro fixture shows the card with the Best Round chip filled
  // from hardcoded data, so the chip's check has a deterministic route.
  if (staticMode && sceneParam === 'intro') showRoundIntro(store.state);
  // The frozen countdown fixture: the overlay up with the first number on
  // it, and the a11y mirror in the same state the live overlay puts it in.
  if (staticMode && sceneParam === 'countdown') {
    countdownOpen = true;
    els.countdownOverlay.hidden = false;
    els.countdownNumber.textContent = '3';
    els.countdownStatus.textContent = '3';
    renderA11yList(store.state);
    els.countdownSkipBtn.focus({ preventScroll: true });
  }
  // On a /?round=N deep link the intro is suppressed (the player has
  // already played), but the difficulty fixtures need the picker to be
  // visible for their dapp.json check. Render it without opening the card.
  if (staticMode && roundParam !== null) syncDifficultyPicker(store.state);

  // A run that resumes (or opens on a deep link) into a Speed Round that
  // is already counting starts its clock here; a round behind the briefing
  // card starts it when the player taps Start counting. Frozen ?scene=
  // fixtures hold the clock still (the same rule that parks their
  // round-complete auto-advance), so a screenshot can catch the countdown.
  if (!staticMode && store.state.speedOn && store.state.phase === COUNTING && !introOpen) startSpeedClock();

  if (sceneParam === 'grownups') openGrownups(store.state);

  if (sceneParam === 'leaderboard') {
    const tab = tabParam === 'weekly' || tabParam === 'friends' ? tabParam : 'global';
    openLeaderboard(LEADERBOARD_FIXTURE, tab);
  }

  if (sceneParam === 'invite') {
    // The public invite page fixture: the static game pitch plus the
    // inviter line, matching the seeded demo identity.
    bootInviteFixture();
  }

  if (sceneParam === 'sharegameover') {
    // Mirror the tokenless /s/<key> view exactly: read-only card over the
    // reached round's flock, no Start again, no Share button.
    els.gameOverReason.textContent = 'You counted the same sheep twice.';
    els.sharedBy.textContent = 'Counted by Staging demo: Mabel.';
    els.sharedBy.hidden = false;
    els.restartBtn.hidden = true;
    els.shareBtn.hidden = true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) store.flush();
  });
  window.addEventListener('pagehide', () => store.flush());
}

function bootInviteFixture() {
  els.inviteCard.hidden = false;
  els.countBadge.hidden = true;
  els.actionBar.hidden = true;
  els.grownupsBtn.hidden = true;
  els.inviteTagline.hidden = false;
  els.inviteButton.href = inviteHref;
  els.inviteInvitee.textContent = 'Invited by Staging demo: Mabel.';
  els.inviteInvitee.hidden = false;
  els.inviteButton.hidden = false;
}

// ---- Public share and invite views ----
// Both views are tokenless by design: the visitor carries no platform token,
// so these pages fetch only their own public endpoints, mount no game store,
// and touch no localStorage. The share view reuses the game-over card the
// player saw, with the round's deterministic flock behind it; the invite
// view is the landing-page style card naming the game and the inviter.

async function bootPublicView() {
  if (publicViewMode === 'share') {
    await bootShareView();
  } else {
    await bootInviteView();
  }
}

async function bootShareView() {
  let data = null;
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(shareKey)}`);
    if (res.ok) data = await res.json();
  } catch {
    /* not-found copy below */
  }
  if (!data) {
    // Keep it gentle: the audience includes children, and a mistyped or
    // revoked key still shows a card rather than a blank page.
    els.gameOverRound.textContent = '1';
    els.gameOverReason.textContent = 'This result link does not work anymore.';
    els.gameOver.hidden = false;
    els.sharedBy.hidden = true;
    els.restartBtn.hidden = true;
    els.shareBtn.hidden = true;
    return;
  }
  const round = normalizeRound(data.roundReached);
  store.state = {
    ...store.state,
    round,
    sheepCount: sheepForRound(round, store.state.difficulty),
    seed: roundSeed(round),
    phase: RUN_OVER,
    speedOn: normalizeSpeedRound(data.speedRound),
    secondsLeft: normalizeSpeedRound(data.speedRound) ? SPEED_ROUND_SECONDS : null,
    endedBy: data.endedBy === ENDED_DOUBLE_TAP ? ENDED_DOUBLE_TAP : null,
    count: 0,
    counted: [],
  };
  const wantsDom = rendererParam === 'dom' || !supportsWebGL();
  renderer = wantsDom ? await mountFallback() : await mountScene();
  renderer.setState(store.state);
  updateChrome(store.state);
  renderA11yList(store.state);
  // The exact short-count reason line needs the tap count, which runs do
  // not store; every missed or unknown-reason run reads the card's default
  // line instead. Double-tap runs keep their exact line.
  els.gameOverReason.textContent = data.endedBy === ENDED_DOUBLE_TAP
    ? 'You counted the same sheep twice.'
    : data.endedBy === ENDED_TIME_UP
      ? 'The clock ran out.'
      : 'Some sheep were left uncounted.';
  els.gameOver.hidden = false;
  els.sharedBy.textContent = `Counted by ${data.username}.`;
  els.sharedBy.hidden = false;
  els.restartBtn.hidden = true;
  els.shareBtn.hidden = true;
}

async function bootInviteView() {
  els.inviteCard.hidden = false;
  // The invite page carries no game state: the play chrome stays out of it.
  els.countBadge.hidden = true;
  els.actionBar.hidden = true;
  els.grownupsBtn.hidden = true;
  els.inviteTagline.hidden = false;
  els.inviteButton.href = inviteHref;
  els.inviteButton.hidden = false;
  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(inviteCode)}`);
    if (res.ok) {
      const data = await res.json();
      els.inviteInvitee.textContent = `Invited by ${data.username}.`;
      els.inviteInvitee.hidden = !data.username;
    } else {
      els.inviteInvitee.hidden = true;
    }
  } catch {
    els.inviteInvitee.hidden = true;
  }
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
  // Same for the countdown overlay: nothing counts until the round starts.
  if (countdownOpen) return;
  // Purely visual: a soft ripple where the sheep was tapped, before any
  // counting state changes. Skipped under prefers-reduced-motion.
  if (renderer && renderer.kind === 'three') {
    const pos = renderer.sheepPosition(index);
    if (pos) renderer.tapRipple(pos.x, pos.z, pos.scale);
  } else {
    renderer?.tapRipple?.(index);
  }
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
  if (countdownOpen) return;
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

// The chip shows the current level's best only once the player has actually
// finished a round at that level (best > round 1): a brand-new player has no
// record to celebrate, so the chip stays hidden there.
function syncBestRoundChip(state) {
  const best = store.bestRound;
  els.bestRoundValue.textContent = String(best);
  els.bestRoundChip.hidden = !(best > 1);
}

function syncSpeedToggle(state) {
  els.speedToggle.checked = !!state.speedOn;
}

// The round badge names the mode while a Speed Round is live, so the
// result reads differently from a normal round in screenshots too.
function syncRoundBadge(state) {
  els.roundBadge.textContent = state.speedOn && state.phase !== RUN_OVER
    ? `Speed round ${state.round}` : `Round ${state.round}`;
}

function showRoundIntro(state) {
  els.roundIntroSize.textContent = roundIntroText(state.round, state.difficulty, state.speedOn);
  syncDifficultyPicker(state);
  syncSpeedToggle(state);
  syncBestRoundChip(state);
  els.roundIntro.hidden = false;
  introOpen = true;
}

function dismissRoundIntro() {
  introOpen = false;
  els.roundIntro.hidden = true;
  showCountdown(store.state);
}

// The 3-2-1 countdown. Covers the board between "Start counting" (or the
// next round's auto-advance) and the first tap of the round, so young
// players can ready their eyes. Pure DOM: it sits over both the canvas
// and the card fallback unchanged. Tapping the card (or the button)
// skips the rest of the countdown; the round starts either way.
function showCountdown(state) {
  // Frozen ?scene= fixtures and deep links hold still for screenshots;
  // they never run the countdown. Neither does a round that starts
  // behind the briefing card instead.
  if (staticMode || roundParam !== null || introOpen) return;
  clearCountdown();
  countdownOpen = true;
  els.countdownNumber.textContent = '3';
  els.countdownStatus.textContent = '3';
  els.countdownOverlay.hidden = false;
  updateChrome(store.state);
  renderA11yList(store.state);
  els.countdownSkipBtn.focus({ preventScroll: true });
  let remaining = 3;
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      els.countdownNumber.textContent = String(remaining);
      els.countdownStatus.textContent = String(remaining);
      return;
    }
    dismissCountdown();
  }, COUNTDOWN_STEP_MS);
}

function dismissCountdown() {
  clearCountdown();
  countdownOpen = false;
  els.countdownOverlay.hidden = true;
  // The mirror follows the state change: the countdown line leaves the
  // list and the sheep buttons come back, so screen readers hear the
  // round become live the same moment sighted players see it.
  renderA11yList(store.state);
  // A Speed Round starts when the countdown does.
  startSpeedClock();
  // A soft baa announces the new flock. playBaa checks the sound
  // setting itself, so no extra gate is needed here.
  playBaa();
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ---- Speed Round clock ----
// One interval drives the countdown. The store steps it whole seconds at
// a time, so every surface reads the same state; the end (time out,
// before or after the last tap) is the run-end path every other outcome
// already shares. A fresh round, a restart or a board reset clears it.
let speedClockTimer = null;

function startSpeedClock() {
  clearInterval(speedClockTimer);
  if (!store.state.speedOn || store.state.phase !== COUNTING) return;
  // First update paints the clock without waiting a second.
  updateChrome(store.state);
  renderA11yList(store.state);
  speedClockTimer = setInterval(() => {
    if (store.state.phase !== COUNTING || !store.state.speedOn) {
      clearInterval(speedClockTimer);
      return;
    }
    const alive = store.tickClock();
    // The clock line in the a11y list follows the pill every second, not
    // only when a sheep is tapped.
    renderA11yList(store.state);
    if (!alive) {
      clearInterval(speedClockTimer);
      // Time out before the flock is finished: the run ends, exactly as
      // a missed count does, with its own reason line.
      if (store.state.phase === COUNTING && store.state.speedOn) store.endRun(ENDED_TIME_UP);
    }
  }, 1000);
}

function stopSpeedClock() {
  clearInterval(speedClockTimer);
}

function advanceRound() {
  clearTimeout(advanceTimer);
  stopSpeedClock();
  clearCountdown();
  if (store.state.phase !== ROUND_PASSED) return;
  store.nextRound();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  playBaa();
  // A Speed Round run keeps the mode on for the next flock; the fresh
  // 30 second clock starts when the countdown ends, not when the flock
  // lands.
  showCountdown(store.state);
}

function restartRun() {
  clearTimeout(advanceTimer);
  clearTimeout(autoSubmitTimer);
  stopSpeedClock();
  clearCountdown();
  store.restartRun();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  playBaa();
  // A restart is the start of a fresh run, so the briefing comes back,
  // with the Speed Round toggle off again. Frozen ?scene= fixtures stay
  // card-free.
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

  syncRoundBadge(state);
  // The Speed Round countdown is its own pill, so the count plate keeps
  // its job (taps counted). Hidden the moment the mode is off, the round
  // is passed or the run ends; a normal round never shows one.
  const showTimer = !!state.speedOn && state.phase === COUNTING && state.secondsLeft != null;
  els.speedTimer.hidden = !showTimer;
  if (showTimer) els.speedTimer.textContent = speedRoundClock(state.secondsLeft);
  els.countDisplay.textContent = String(state.count);
  els.countWord.textContent = `of ${sheepPhrase(state.sheepCount)}`;
  els.playHint.textContent = hintFor(state);
  els.submitBtn.disabled = state.phase !== COUNTING;

  els.roundValue.textContent = String(state.round);
  els.bestValue.textContent = String(store.bestRound);
  els.totalValue.textContent = String(state.totalCounted);
  els.communityValue.textContent = String(state.communityTotal);
  els.soundToggle.checked = !!state.soundOn;
  els.nightToggle.checked = !!state.nightOn;
  applyTheme(state);

  syncPanels(state);
}

function syncPanels(state) {
  const passed = state.phase === ROUND_PASSED;
  const over = state.phase === RUN_OVER;

  if (passed) {
    els.successTitle.textContent = successMessage();
    els.roundCompleteTitle.textContent = roundCompleteTitle(state.round, state.speedOn);
    els.roundCompleteNext.textContent =
      `Next up: ${sheepPhrase(sheepForRound(state.round + 1, state.difficulty))}. ${paceLine(state.round + 1, state.difficulty)}`;
  }
  if (over) {
    els.gameOverRound.textContent = String(state.round);
    els.gameOverReason.textContent = state.endedBy === ENDED_DOUBLE_TAP
      ? 'You counted the same sheep twice.'
      : state.endedBy === ENDED_TIME_UP
        ? 'The clock ran out.'
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
  // Only buttons are sheep; the Speed Round clock line below is plain
  // status text and must never be counted as a sheep slot.
  let buttons = els.a11yList.querySelectorAll('button');
  if (buttons.length !== state.sheepCount) {
    els.a11yList.replaceChildren();
    for (let i = 0; i < state.sheepCount; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.addEventListener('click', () => handleTap(i));
      els.a11yList.appendChild(btn);
    }
    buttons = els.a11yList.querySelectorAll('button');
  }
  buttons.forEach((btn, i) => {
    // The briefing card or the countdown is open: no tap can land, so the
    // mirror says so instead of offering a button that would silently do
    // nothing.
    btn.disabled = introOpen || countdownOpen;
    btn.textContent = state.counted.includes(i)
      ? `Sheep ${i + 1}, counted` : `Sheep ${i + 1}, not counted yet`;
  });
  // The countdown mirrors into the a11y channel too, appended after the
  // clock line, so when the round goes live the clock is the last thing
  // screen readers hear. The line (and the buttons it belongs with)
  // leaves with the overlay.
  let countdownLine = els.a11yList.querySelector('#a11y-countdown-status');
  if (countdownOpen) {
    if (!countdownLine) {
      countdownLine = document.createElement('p');
      countdownLine.id = 'a11y-countdown-status';
      els.a11yList.appendChild(countdownLine);
    }
    countdownLine.textContent = 'Get ready, round starting.';
  } else if (countdownLine) {
    countdownLine.remove();
  }
  // The clock is part of the round's state, so the screen-reader list
  // mirrors it too. It stays only while the clock is actually running
  // (same condition as the on-screen pill): once the round is passed or
  // the run ends, the line leaves the list. Off or hidden, it stays out
  // of the list entirely.
  let clockLine = els.a11yList.querySelector('#a11y-speed-clock');
  const clockRunning = state.speedOn && state.phase === COUNTING && state.secondsLeft != null;
  if (clockRunning) {
    if (!clockLine) {
      clockLine = document.createElement('p');
      clockLine.id = 'a11y-speed-clock';
      els.a11yList.appendChild(clockLine);
    }
    clockLine.textContent = `Speed Round, ${speedRoundClock(state.secondsLeft)} seconds left.`;
  } else if (clockLine) {
    clockLine.remove();
  }
}

els.submitBtn.addEventListener('click', submitCount);
els.startCountingBtn.addEventListener('click', dismissRoundIntro);
els.countdownSkipBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dismissCountdown();
});
els.countdownOverlay.addEventListener('pointerdown', () => {
  if (countdownOpen) dismissCountdown();
});
els.countdownOverlay.addEventListener('keydown', (e) => {
  if (countdownOpen && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    dismissCountdown();
  }
});
document.addEventListener('visibilitychange', () => {
  // A stale countdown must never start a round the player is not looking
  // at: when the app is hidden, pause the tick and keep the overlay up.
  // The next tap (or the button) starts the round instead. Returning to
  // view must NOT clear it: the unhide itself fires visibilitychange, and
  // clearing there would strand the round before it starts.
  if (countdownOpen && document.hidden) {
    clearCountdown();
  }
});
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
  els.nightToggle.checked = !!state.nightOn;
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

els.nightToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  store.setNightOn(e.target.checked);
});

// Picking a level on the briefing card switches the run to that level at
// round 1. In staticMode the pills render from the fixture but taps are
// ignored, exactly like the sound toggle above.
for (const btn of els.difficultyPicker.querySelectorAll('.difficulty-pill')) {
  btn.addEventListener('click', () => {
    if (staticMode) return;
    store.setDifficulty(btn.dataset.difficulty);
    syncDifficultyPicker(store.state);
    syncBestRoundChip(store.state);
    els.roundIntroSize.textContent = roundIntroText(store.state.round, store.state.difficulty);
    // The board behind the card shows the new level's round 1 flock.
    renderer?.resetRound(store.state);
    renderA11yList(store.state);
  });
}

// The Speed Round toggle flips before Start counting. The briefing line
// and the flock behind the card update so the player sees the mode they
// are about to play; the flag lives one round, and the next round's
// briefing asks again.
els.speedToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  store.setSpeedOn(e.target.checked);
  syncSpeedToggle(store.state);
  els.roundIntroSize.textContent = roundIntroText(store.state.round, store.state.difficulty, store.state.speedOn);
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
});

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
        scoreLabel: weeklyScoreLabel(r.roundReached, !!r.speedRound),
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

// ---- Share result and Invite a friend ----
// Both copy a stable public link. The POSTs are small and idempotent
// server-side; a failed tap can be retried, so failures restore the button
// quietly and never crash the card.
async function copyLink(postPath, body, btn) {
  const originalText = btn.textContent;
  try {
    const res = await fetch(postPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usernode-token': token },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const url = data.key
      ? `${location.origin}/s/${data.key}`
      : `${location.origin}/invite/${data.code}`;
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied.';
    setTimeout(() => { btn.textContent = originalText; }, 2500);
  } catch {
    // Quietly restore: a clipboard rejection or a failed post is retryable
    // by tapping again.
    btn.textContent = originalText;
  }
}

els.shareBtn.addEventListener('click', () => {
  if (staticMode || publicViewMode) return;
  copyLink('/api/shares', { runId: store.lastRunId || undefined }, els.shareBtn);
});

els.inviteFriendBtn.addEventListener('click', () => {
  if (staticMode || publicViewMode) return;
  copyLink('/api/invites', {}, els.inviteFriendBtn);
});

boot();

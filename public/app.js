import {
  StateStore,
  createDefaultState,
  COUNTING,
  ROUND_PASSED,
  RUN_OVER,
  ENDED_DOUBLE_TAP,
  ENDED_COMPLETE,
  ENDED_WOLF,
  ENDED_TIME_UP,
} from './state.js';
import {
  ROUNDS_PER_LEVEL,
  isCalmLevel,
  levelForRound,
  levelTagText,
  levelUpTitle,
  normalizeCalm,
  normalizeDifficulty,
  normalizeRound,
  normalizeScenery,
  passLine,
  playHintText,
  roundInLevel,
  roundSeed,
  secondsForRound,
  sheepForRound,
  sheepPhrase,
  speedRoundClock,
  startLevelChoices,
  WOLF_BONUS,
  wolfCueText,
  wolfIndexForRound,
  weeklyScoreLabel,
} from './rounds.js';
import { playTapChime, playBaa, playBaaBaaa, playCelebration, setSoundEnabled } from './sound.js';
import { sortScoreRows } from './leaderboard.js';
import { NUMBER_COLORS, sheepName } from './layout.js';
import { bestRoundsCsv, weeklyHistoryCsv } from './export.js';

// Pass-and-play Duel: shared controller state, exported for the unit suite.
const DUEL_TURN_SECONDS = 45;
export function duelTurnSeconds() { return DUEL_TURN_SECONDS; }

const params = new URLSearchParams(window.location.search);
// Storage can be blocked in an embedded frame (some Android WebViews and
// privacy settings make sessionStorage throw or be null). An unguarded
// access here would kill the whole module before boot() runs (#44), so a
// blocked store just means the URL's token is the only one we have.
function readStoredToken() {
  try {
    return window.sessionStorage.getItem('sheep-countrr:token') || '';
  } catch {
    return '';
  }
}
const token = params.get('token') || readStoredToken() || '';
if (params.get('token')) {
  try {
    window.sessionStorage.setItem('sheep-countrr:token', token);
  } catch {
    /* storage unavailable; the token stays in the URL for this load */
  }
}

const sceneParam = params.get('scene');
const rendererParam = params.get('renderer');
const roundParam = params.get('round');
// Deep-link-only knob: /?round=N&wolf=1 always hides a wolf, &wolf=0 never
// does. Normal play stays chance-based.
const wolfParam = params.get('wolf');
// A deep link may name a difficulty (?difficulty=calm); anything else,
// a retired level included, plays the flow ladder. It composes with
// /?round=N and /?scene=X and, like them, is never persisted.
const difficultyParam = normalizeDifficulty(params.get('difficulty'));
const hasDifficultyParam = params.get('difficulty') !== null;
// The Duel flag from a deep link (?duel=1): it applies to the run it opens,
// never persisted from a deep link, so the store stays ephemeral there.
const hasDuelParam = params.get('duel') !== null;
const duelParam = params.get('duel') === '1';
// The grown-ups fixture can force the sound toggle on (the shipped default
// for the frozen ?scene=grownups card) without touching localStorage.
const soundParam = params.get('sound');
// The grown-ups fixture can force the Night Meadow toggle the same way
// (?night=1 shows the night scene without touching localStorage).
const nightParam = params.get('night');
// Deep-link knob for the Background picker (?scenery=moon): it names the
// scenery for the run it opens and, like night, is never persisted from a
// deep link. ?night=1 keeps working as shorthand for scenery=night.
const sceneryParam = params.get('scenery');
const fixtureScenery = normalizeScenery(sceneryParam, nightParam === '1');
// ?calm=1 boots straight into Calm mode for the fixture/deep-link run;
// like night and sound it is never persisted from a deep link.
const calmParam = params.get('calm');
// The autoplay harness for the flow deep links (?round=N&autoplay=...):
// '1' plays one round and stops on the pass banner; 'next' then waits
// through the banner until the next flock is up. It rides the existing
// ?round= auth exemption, and its store is ephemeral, so a check run
// never writes localStorage or the server.
const autoplayParam = params.get('autoplay');
// The grown-ups fixture can force the Name labels toggle the same way
// (?names=1 floats playful name labels without touching localStorage).
const hasNamesParam = params.get('names') !== null;
const namesParam = params.get('names') === '1';
// The Big Tap fixture/deep-link knob (?bigtap=1): bigger hit targets, a
// slower flock and lighter pop bursts for the run it opens. Like the
// other knobs it is applied to the store and never persisted from a
// deep link; the frozen ?scene=grownups fixture uses it to show the
// toggle in each state.
const hasBigTapParam = params.get('bigtap') !== null;
const bigtapParam = params.get('bigtap') === '1';
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
// ?round=N stays a playable deep link (fixed seed), but its taps persist
// like any round: a player can start from it, leave, and resume.
const deepLink = staticMode;
// The save/resume demo: a real, persistent (localStorage) run under a
// fixed demo user, so the platform checks can exercise save -> reload ->
// restore end to end without touching a real player's progress. The
// snapshot is seeded from `?snapshot=`, and the load path is exactly the
// one a real player's browser takes.
const resumeParam = params.get('resume') === '1';
const RESUME_USER_ID = 'resume-demo';

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How long the pass banner holds before the next flock walks in: a short
// beat for a plain round, a longer moment for a level-up.
const PASS_MS = 1200;
const LEVEL_UP_MS = 2200;

// Recolors the sky and ground only. The DOM class carries the CSS side
// (page sky gradient and the DOM fallback's field), and the renderer gets
// the same pick so the WebGL ground, hills, fog and scenery props follow.
// Nothing else on the page changes color.
function applyTheme(state) {
  document.body.classList.toggle('theme-night', state.scenery === 'night');
  document.body.classList.toggle('theme-moon', state.scenery === 'moon');
  document.body.classList.toggle('theme-calm', !!state.calmOn);
  renderer?.setScenery?.(state.scenery);
  renderer?.setCalm?.(!!state.calmOn);
}

// Mirrors the purely cosmetic name-label flag into whichever renderer is
// mounted. Counting, the store and the server never see it change.
function applyNames(state) {
  renderer?.setNames?.(!!state.namesOn);
}

const els = {
  countDisplay: document.getElementById('count-display'),
  countWord: document.getElementById('count-word'),
  countDots: document.getElementById('count-dots'),
  roundBadge: document.getElementById('round-badge'),
  sceneRoot: document.getElementById('scene-root'),
  actionBar: document.getElementById('action-bar'),
  playHint: document.getElementById('play-hint'),
  submitBtn: document.getElementById('submit-count'),
  flowBanner: document.getElementById('flow-banner'),
  flowBannerTitle: document.getElementById('flow-banner-title'),
  flowBannerLine: document.getElementById('flow-banner-line'),
  bestRoundChip: document.getElementById('best-round-chip'),
  bestRoundValue: document.getElementById('best-round-value'),
  streakChip: document.getElementById('streak-chip'),
  streakValue: document.getElementById('streak-value'),
  gameOverOptions: document.getElementById('game-over-options'),
  gameOverChips: document.getElementById('game-over-chips'),
  startLevelPicker: document.getElementById('start-level-picker'),
  duelStartBtn: document.getElementById('duel-start-btn'),
  duelPanel: document.getElementById('duel-panel'),
  duelPanelTitle: document.getElementById('duel-panel-title'),
  duelPanelBody: document.getElementById('duel-panel-body'),
  duelPanelScores: document.getElementById('duel-panel-scores'),
  duelPanelHint: document.getElementById('duel-panel-hint'),
  duelPanelBtn: document.getElementById('duel-panel-btn'),
  duelPanelExit: document.getElementById('duel-panel-exit'),
  duelTurnClock: document.getElementById('duel-turn-clock'),
  speedTimer: document.getElementById('speed-timer'),
  gameOver: document.getElementById('game-over'),
  gameOverEyebrow: document.getElementById('game-over-eyebrow'),
  gameOverReason: document.getElementById('game-over-reason'),
  gameOverRound: document.getElementById('game-over-round'),
  restartBtn: document.getElementById('restart-btn'),
  grownupsBtn: document.getElementById('grownups-btn'),
  grownupsPanel: document.getElementById('grownups-panel'),
  grownupsClose: document.getElementById('grownups-close'),
  soundToggle: document.getElementById('sound-toggle'),
  soundBtn: document.getElementById('sound-btn'),
  scenerySelect: document.getElementById('scenery-select'),
  calmToggle: document.getElementById('calm-toggle'),
  namesToggle: document.getElementById('names-toggle'),
  bigtapToggle: document.getElementById('bigtap-toggle'),
  bigtapLabel: document.getElementById('bigtap-label'),
  startOverBtn: document.getElementById('start-over-btn'),
  roundValue: document.getElementById('round-value'),
  bestValue: document.getElementById('best-value'),
  totalValue: document.getElementById('total-value'),
  bestStreakValue: document.getElementById('best-streak-value'),
  bonusValue: document.getElementById('bonus-value'),
  communityValue: document.getElementById('community-value'),
  exportBtn: document.getElementById('export-btn'),
  exportStatus: document.getElementById('export-status'),
  difficultyValue: document.getElementById('difficulty-value'),
  a11yList: document.getElementById('a11y-sheep-list'),
  a11yRoundProgress: document.getElementById('a11y-round-progress'),
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

let store = new StateStore({
  userId: resumeParam ? RESUME_USER_ID : userIdFromToken(token),
  token,
  // The autoplay harness plays real taps, so its store must be as
  // side-effect-free as a fixture's: nothing written anywhere.
  ephemeral: deepLink || autoplayParam !== null,
  deterministic: deepLink,
  onChange: (state) => updateChrome(state),
});

// The demo namespace seeds its snapshot from the URL: the checker writes
// a board with ?snapshot=..., reloads with ?resume=1, and the restore
// path answers from localStorage exactly as it does for a real player.
if (resumeParam) {
  const seedParam = params.get('snapshot');
  if (seedParam !== null && !sceneParam) {
    try {
      localStorage.setItem(store.storageKey, seedParam);
    } catch {
      /* storage unavailable; resume then reads nothing and starts fresh */
    }
  }
}

// The signed-in handle, from the same verified token the server trusts.
// Used to highlight the player's own leaderboard row and to stop a
// self-add before it hits the server.
store.state.meUsername = usernameFromToken(token);

let renderer = null;

// Every full panel (Game over, Grown-ups, leaderboard, duel and invite
// cards) is a .panel-backdrop
// shown and hidden through its `hidden` attribute from many places. One
// observer watches them all and tells the renderer whether the pasture is
// covered, so the 3D scene can drop to a gentle background drift instead
// of redrawing at display rate under the blur.
function syncBackdropMode(target = renderer) {
  const covered = [...document.querySelectorAll('.panel-backdrop')].some((el) => !el.hidden);
  target?.setBackdropMode?.(covered);
}
const backdropObserver = new MutationObserver(() => syncBackdropMode());
document.querySelectorAll('.panel-backdrop').forEach((el) => {
  backdropObserver.observe(el, { attributes: true, attributeFilter: ['hidden'] });
});

// The one timer that moves a passed round on to the next flock once the
// pass banner has had its moment. Cleared by a restart, a duel or a fresh
// board, so a stale timer can never start a round the player has left.
let passTimer = null;

// Fixed fixtures for the proposal-check deep links, per dapp.json's
// `tests` array — deliberately not read from any network state. Rounds
// are ladder rounds: round N is level ceil(N / 3).
function buildStaticState() {
  const base = createDefaultState();
  const at = (round, extra = {}) => ({
    ...base,
    round,
    difficulty: difficultyParam,
    sheepCount: sheepForRound(round, difficultyParam),
    seed: roundSeed(round),
    // The round's own clock, frozen at full: fixtures never tick it.
    secondsLeft: secondsForRound(round, difficultyParam, { bigTapOn: bigtapParam }),
    // The Big Tap knob rides the fixture/deep link the same way (?bigtap=1),
    // applied to the ephemeral fixture state and never persisted.
    bigTap: bigtapParam,
    bestRounds: { ...base.bestRounds, [difficultyParam]: Math.max(round, base.bestRounds[difficultyParam] || 1) },
    // Frozen fixtures never touch storage, so the scenery comes from the
    // deep link (?scenery=moon, or the legacy ?night=1) and nowhere else.
    scenery: fixtureScenery,
    nightOn: fixtureScenery === 'night',
    ...extra,
  });
  // A full flock of twelve: level 11's last round.
  if (sceneParam === 'flock') return at(33);
  if (sceneParam === 'portrait') return at(1);
  if (sceneParam === 'empty') return at(3);
  // Level 6, round 2: seven sheep, three popped, four left.
  if (sceneParam === 'midcount') return at(17, { count: 3, counted: [0, 1, 2] });
  if (sceneParam === 'resumed') {
    // A mid-round board restored from storage, frozen for its dapp.json
    // check: three sheep counted in tap order at fixed clock stamps, the
    // rest of the flock still wandering. Hardcoded only, like every
    // other fixture here.
    return at(17, {
      count: 3,
      counted: [0, 1, 2],
      countedAt: [
        { index: 0, elapsed: 2.5 },
        { index: 1, elapsed: 5 },
        { index: 2, elapsed: 9.5 },
      ],
      roundElapsed: 12,
    });
  }
  if (sceneParam === 'roundpass') {
    // A plain pass: level 3's second round counted, the small banner line
    // in the meadow and no level-up title. Frozen: no timer moves it on.
    const n = sheepForRound(8, difficultyParam);
    return at(8, {
      count: n,
      counted: [...Array(n).keys()],
      phase: ROUND_PASSED,
      lastPass: { round: 8, counted: n, levelUp: false },
    });
  }
  if (sceneParam === 'levelup') {
    // The level-up moment: level 2's last round counted, "Level 3!" over
    // the counted line.
    const n = sheepForRound(6, difficultyParam);
    return at(6, {
      count: n,
      counted: [...Array(n).keys()],
      phase: ROUND_PASSED,
      lastPass: { round: 6, counted: n, levelUp: true },
    });
  }
  if (sceneParam === 'gameover') {
    // Level 4's clock ran out, with a best of level 6 and a three-day
    // streak, so the chips and the start-level shortcuts 1 and 4 show.
    return at(10, {
      count: 3,
      counted: [0, 1, 2],
      phase: RUN_OVER,
      endedBy: ENDED_TIME_UP,
      secondsLeft: 0,
      bestRounds: { ...base.bestRounds, [difficultyParam]: 16 },
      streakDays: 3,
      bestStreakDays: 5,
    });
  }
  // Level 5, round 1: five animals, three sheep popped, the fifth a wolf.
  if (sceneParam === 'wolfround') {
    return at(13, { count: 3, counted: [0, 1, 2], wolfIndex: 4 });
  }
  if (sceneParam === 'wolfgameover') {
    return at(16, {
      count: 4,
      counted: [0, 1, 2, 3],
      wolfIndex: 5,
      phase: RUN_OVER,
      endedBy: ENDED_WOLF,
      safeStreak: 2,
    });
  }
  if (sceneParam === 'timeupgameover') {
    // A timed round the clock ran out on: its own game-over reason line.
    return at(10, { count: 3, counted: [0, 1, 2], phase: RUN_OVER, secondsLeft: 0, endedBy: ENDED_TIME_UP });
  }
  if (sceneParam === 'moon') {
    // The Moon scenery, frozen mid-count: grey ground, lavender-blue sky,
    // and the flock unchanged underneath it. Hardcoded only, like every
    // other fixture here.
    return at(17, { count: 3, counted: [0, 1, 2], scenery: 'moon', nightOn: false });
  }
  if (sceneParam === 'grownups') {
    return at(5, {
      bestRounds: { calm: 3, flow: 7 },
      totalCounted: 18 + 3 * WOLF_BONUS,
      communityTotal: 39,
      bestSafeStreak: 4,
      bonusCounted: 3 * WOLF_BONUS,
      soundOn: soundParam === null || soundParam === '1',
      calmOn: calmParam === '1',
    });
  }
  if (sceneParam === 'duelhandoff') {
    // The frozen pass-the-device card: player 1 counted a clean flock, the
    // board behind the card holds the untouched flock for player 2.
    els.roundBadge.textContent = 'Level 1';
    showDuelPanel({
      title: 'Pass the device',
      body: 'Sheep counter 2, you count the same flock as Sheep counter 1.',
      scores: [{ label: 'Sheep counter 1', value: '0 missed' }],
      hint: 'Same flock, fresh eyes. The lower miss count wins.',
      btn: 'Start counting',
      onBtn: () => {},
    });
  }
  if (sceneParam === 'duelresult') {
    // The frozen results card: player 1 found every sheep, player 2 missed
    // one, so the win line and both miss counts are on the card.
    els.roundBadge.textContent = 'Level 1';
    showDuelPanel({
      title: 'Duel result',
      body: 'Sheep counter 1 wins.',
      scores: [
        { label: 'Sheep counter 1', value: '0 missed' },
        { label: 'Sheep counter 2', value: '1 missed' },
      ],
      hint: null,
      btn: 'Count again',
      onBtn: () => {},
      exitBtn: 'Back to my game',
      onExit: () => {},
    });
  }
  if (sceneParam === 'sharegameover') {
    // The public share view for Mabel's seeded demo run: the round-8 flock
    // behind the game-over card, read-only, with the shared-by line.
    return at(8, { count: 3, counted: [0, 1, 2], phase: RUN_OVER, endedBy: ENDED_DOUBLE_TAP });
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

// The renderer module (and, for the 3D one, three itself) is requested
// the moment boot starts, so it downloads while the saved progress loads
// instead of after it. Memoized: mountScene/mountFallback await the same
// promise, and the onFatal fallback swap reuses it.
const rendererModules = {};
function loadRendererModule(dom) {
  const key = dom ? 'dom' : 'three';
  if (!rendererModules[key]) rendererModules[key] = dom ? import('./fallback.js') : import('./scene.js');
  return rendererModules[key];
}
function wantsDomRenderer() {
  return rendererParam === 'dom' || !supportsWebGL();
}

async function boot() {
  const wantsDom = wantsDomRenderer();
  // Swallow a failed early load here; mountScene's own await reports it
  // and falls back to the card view.
  loadRendererModule(wantsDom).catch(() => {});
  if (publicViewMode) {
    await bootPublicView();
    return;
  }
  if (hasNamesParam) store.state = { ...store.state, namesOn: namesParam };
  if (staticMode) {
    store.state = buildStaticState();
  } else if (resumeParam) {
    // The save/resume demo: load the demo namespace's snapshot through the
    // exact load path a real player takes, then hand the store the live
    // renderer clock so further taps stamp with it. No server sync: the
    // demo identity has no token and the check needs no network.
    store.loadLocal();
  } else if (roundParam !== null) {
    // /?round=N starts a real, playable run at that round, with the round's
    // fixed seed so the same URL always frames the same pasture. An optional
    // difficulty= picks the curve; it stays ephemeral like the round itself.
    if (hasDifficultyParam) store.state = { ...store.state, difficulty: difficultyParam };
    if (calmParam !== null) store.state = { ...store.state, calmOn: normalizeCalm(calmParam === '1') };
    if (hasBigTapParam) store.state = { ...store.state, bigTap: bigtapParam };
    // &sound=0/1 pins the sound button's icon for the capture run; like the
    // other knobs it is applied to the ephemeral store and never persisted.
    if (soundParam !== null) store.state = { ...store.state, soundOn: soundParam === '1' };
    // The Background pick rides the deep link for this run only; the
    // ephemeral store never writes it back to storage.
    if (sceneryParam !== null || nightParam !== null) {
      store.state = { ...store.state, scenery: fixtureScenery, nightOn: fixtureScenery === 'night' };
    }
    if (hasDuelParam && duelParam) {
      store.state = { ...store.state, duel: true };
    }
    store.startRound(normalizeRound(roundParam), { silent: true });
    if (wolfParam === '1' && !isCalmLevel(store.state.difficulty)) {
      // A wolf needs a flock to hide in: round 1's single sheep stays a
      // sheep even when the deep link asks for one.
      store.state = {
        ...store.state,
        wolfIndex: store.state.sheepCount < 2 ? null
          : (wolfIndexForRound(store.state.round, store.state.seed, store.state.sheepCount) ?? store.state.sheepCount - 1),
      };
    } else if (wolfParam === '0') {
      store.state = { ...store.state, wolfIndex: null };
    }
  } else {
    // A /?duel=1 run with no round names a fresh duel at round 1. The flag
    // rides into the boot hook below; a tokenless store (no /api/state)
    // keeps it until then.
    if (hasDuelParam && duelParam) {
      store.state = { ...store.state, duel: true };
    }
    store.loadLocal();
    if (hasDuelParam && duelParam) {
      store.state = { ...store.state, duel: true };
    }
    await store.loadRemote();
    if (hasDuelParam && duelParam) {
      store.state = { ...store.state, duel: true };
    }
  }

  renderer = wantsDom ? await mountFallback() : await mountScene();

  // Resume first (pin the renderer to the saved clock), then hand the
  // store the live clock so taps from here on stamp with it.
  syncRoundClock({ resume: store.state.roundElapsed > 0 });
  renderer.setState(store.state);
  updateChrome(store.state);
  renderA11yList(store.state);

  // A /?duel=1 run boots straight into the pass-and-play flow: its own
  // shared flock, its own handoff card. The state flag is consumed here so
  // the rest of boot (and every later run) stays solo.
  if (!staticMode && store.state.duel) {
    store.state = { ...store.state, duel: false };
    startDuel(store.state.round);
  }

  // No briefing and no countdown: the board is live the moment it is up,
  // and the first tap on a sheep is the start. A board that opens (or
  // resumes) on a timed round starts its clock here. Frozen ?scene=
  // fixtures hold the clock still so a screenshot can catch it.
  if (!staticMode && !duelState && store.state.phase === COUNTING) startRoundClock();

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
    els.gameOverOptions.hidden = true;
    els.gameOverChips.hidden = true;
  }

  document.addEventListener('visibilitychange', () => {
    // A tap's deferred localStorage write lands before the page can go
    // away, including in the resume demo, which saves locally.
    if (document.hidden) store.flushPendingSave();
    // The resume demo has no token and syncs nowhere.
    if (document.hidden && !resumeParam) store.flush();
  });
  window.addEventListener('pagehide', () => {
    store.flushPendingSave();
    if (!resumeParam) store.flush();
  });

  // The flow checks' driver: play the round the deep link opened.
  runAutoplay();
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
    els.gameOverOptions.hidden = true;
    els.gameOverChips.hidden = true;
    return;
  }
  const round = normalizeRound(data.roundReached);
  store.state = {
    ...store.state,
    round,
    sheepCount: sheepForRound(round, store.state.difficulty),
    seed: roundSeed(round),
    phase: RUN_OVER,
    secondsLeft: null,
    endedBy: [ENDED_DOUBLE_TAP, ENDED_WOLF, ENDED_TIME_UP, ENDED_COMPLETE].includes(data.endedBy)
      ? data.endedBy
      : null,
    count: 0,
    counted: [],
  };
  renderer = wantsDomRenderer() ? await mountFallback() : await mountScene();
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
      : data.endedBy === ENDED_WOLF
        ? 'The wolf tricked you.'
        : data.endedBy === ENDED_COMPLETE
          ? 'Every round counted.'
          : 'Some sheep were left uncounted.';
  els.gameOver.hidden = false;
  els.sharedBy.textContent = `Counted by ${data.username}.`;
  els.sharedBy.hidden = false;
  els.restartBtn.hidden = true;
  els.shareBtn.hidden = true;
  els.gameOverOptions.hidden = true;
  els.gameOverChips.hidden = true;
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
    const { createSceneRenderer } = await loadRendererModule(false);
    const sceneRenderer = createSceneRenderer({
      container: els.sceneRoot,
      reducedMotion,
      onTap: handleTap,
      // The whole corner column (round tag, timers, plate, dots) covers the
      // top-left of the screen and the hint (plus Done counting in a duel)
      // the bottom; the camera frames the flock in the space between.
      getOverlayRect: () => (els.countBadge ? els.countBadge.getBoundingClientRect() : null),
      getBottomOverlayRect: () => (els.actionBar ? els.actionBar.getBoundingClientRect() : null),
      onFatal: async () => {
        renderer?.destroy?.();
        renderer = await mountFallback();
        renderer.setState(store.state);
      },
    });
    syncBackdropMode(sceneRenderer);
    return sceneRenderer;
  } catch (err) {
    console.warn('3D pasture unavailable, using the card view instead', err);
    return mountFallback();
  }
}

async function mountFallback() {
  const { createFallbackRenderer } = await loadRendererModule(true);
  const fallback = createFallbackRenderer({ container: els.sceneRoot, onTap: handleTap, reducedMotion });
  syncBackdropMode(fallback);
  return fallback;
}

// One clock contract for both renderers. After mount, the store stamps
// taps with the renderer's animation time, so a resumed board shows each
// counted sheep where the tap left it; after a resume the renderer is
// pinned to the saved clock first, so the flock is standing exactly where
// the player left it. Every round start re-runs this with the new board.
function syncRoundClock({ resume } = {}) {
  if (!renderer || typeof renderer.elapsedSeconds !== 'function') return;
  const saved = store.state.roundElapsed || 0;
  if (resume) {
    renderer.setRoundClock?.(saved);
  }
  store.roundClock = () => Math.max(saved, renderer.elapsedSeconds());
}

function handleTap(index) {
  // The pass banner is up: the round is over and the next flock is on its
  // way, so a tap in between counts nothing (and ripples nothing).
  if (store.state.phase !== COUNTING) return;
  // A popped sheep is gone: its spot cannot be tapped, so a child can
  // never end a run by tapping empty grass. This covers the 3D scene,
  // the card view and the screen-reader list in one place.
  if (store.state.counted.includes(index)) return;
  // Purely visual: a soft ripple where the sheep was tapped, before any
  // counting state changes. Skipped under prefers-reduced-motion, and on
  // Calm, whose feedback stays as quiet as the bedtime original.
  const quiet = isCalmLevel(store.state.difficulty);
  if (quiet) {
    // no ripple
  } else if (renderer && renderer.kind === 'three') {
    const pos = renderer.sheepPosition(index);
    if (pos) renderer.tapRipple(pos.x, pos.z, pos.scale);
  } else {
    renderer?.tapRipple?.(index);
  }
  const result = store.tapSheep(index);
  if (store.state.duel && store.state.phase !== COUNTING) stopDuelClock();
  // Every tap on a sheep's body baas, counted or not. The wolf is not a
  // sheep, and an ignored tap touched nothing, so neither baas. A counted
  // tap gets the two-note baa-baaa, so the sheep calls out while it puffs
  // up before it bursts; wiggles and double taps keep the short baa.
  const sheepTapped = result.outcome === 'counted'
    || result.outcome === 'doubleTap' || result.outcome === 'wiggle';
  if (sheepTapped && store.state.soundOn) {
    if (result.outcome === 'counted') playBaaBaaa();
    else playBaa();
  }
  if (result.outcome === 'counted') {
    renderer.countSheep(index, result.number);
    if (store.state.soundOn) {
      playTapChime(result.number);
    }
    // The last real sheep passed the round (the store did it on this very
    // tap): the clock stops, and syncPanels has already put the banner up.
    if (result.passed || store.isComplete()) stopRoundClock();
    renderA11yList(store.state);
    return;
  }
  if (result.outcome === 'doubleTap' || result.outcome === 'wiggle') {
    // On Calm ('wiggle') this is the whole response: the sheep wiggles
    // sleepily and the round carries on.
    renderer.wiggleSheep(index);
    renderA11yList(store.state);
    return;
  }
  if (result.outcome === 'wolfTap') {
    renderer.revealWolf(index);
    renderA11yList(store.state);
  }
}

// Done counting: a duel turn's hand-in. Solo rounds pass on their last pop.
function submitCount() {
  const result = store.submitCount();
  // Calm never ends a run on a short count: the sheep still awake give a
  // sleepy wiggle so the player can see who is left, and counting goes on.
  if (result.outcome === 'notYet') {
    for (const i of result.awake) renderer?.wiggleSheep?.(i);
    return;
  }
  if (store.state.duel && store.state.phase !== COUNTING) stopDuelClock();
}

// ---- Autoplay harness (the flow deep links) ----
// ?round=N&autoplay=... plays one real round through the app's own tap
// handler, so the dapp.json checks (which can only load a page, never
// interact with it) can reach the pass banner and the next flock:
//   '1'     play the round and stop on the pass banner
//   'next'  then let the banner run out, so the next flock is up
// The store is ephemeral for these runs, so nothing is written anywhere,
// and the round's wolf (if it drew one) is left uncounted, exactly as a
// careful player would. The round passes on its last pop, as in play.
function runAutoplay() {
  if (!autoplayParam || staticMode) return;
  setTimeout(() => {
    const wolf = store.state.wolfIndex;
    for (let i = 0; i < store.state.sheepCount; i++) {
      if (i !== wolf) handleTap(i);
    }
    // 'next' needs nothing more: the pass timer moves the run on. '1'
    // holds the banner up so the check can read it.
    if (autoplayParam === '1') clearTimeout(passTimer);
  }, 400);
}

// ---- Pass-and-play Duel ----
// Both players count the SAME flock: one flock seed is drawn when the duel
// starts, and every turn's store reuses it, so the two counts are directly
// comparable. Each turn gets a fresh ephemeral store over the existing
// state shape, so the 3D scene, the DOM fallback and the a11y list keep
// rendering exactly as they do in a solo round. The turn clock is advisory
// (the store's own speed-clock logic stays off): it nudges the player to
// hand over and never ends a turn by itself.
const DUEL_PLAYERS = ['Sheep counter 1', 'Sheep counter 2'];
let duelState = null; // { round, seed, difficulty, turn (0-based), misses: [n, n], done }
// The player's own store, set aside while a duel's throwaway turn stores run
// the board. endDuel (and a restart) puts it back.
let soloStore = null;
let duelResolving = false; // guards the store swap inside onChange
let duelClockTimer = null;
let duelSecondsLeft = DUEL_TURN_SECONDS;

function startDuel(round, { skipIntro } = {}) {
  const start = normalizeRound(round);
  // A duel takes the board over: no solo clock or pass banner may run on.
  stopRoundClock();
  clearPass();
  // "Count again" starts a duel from inside one: keep the store set aside
  // at the first duel, not the previous duel's turn store.
  if (!soloStore) soloStore = store;
  duelState = {
    round: start,
    seed: roundSeed(start) + 900000 + start, // one fixed flock for both turns
    difficulty: store.state.difficulty,
    turn: 0,
    misses: [null, null],
    done: false,
  };
  duelSecondsLeft = DUEL_TURN_SECONDS;
  beginDuelTurn({ silent: true });
  if (!skipIntro) showDuelPanel({
    title: 'Pass and play',
    body: `${DUEL_PLAYERS[0]} counts first. Pass the device when the card asks.`,
    scores: [],
    hint: 'Both players count the same flock. The lower miss count wins.',
    btn: 'Start counting',
    onBtn: dismissDuelPanel,
  });
}

// Builds a fresh ephemeral store for the current turn. The duel round reads
// as round 1 in the badges (each turn is a single round), but the flock is
// the shared seed, so both players frame the same pasture.
function beginDuelTurn({ silent, startClock = true } = {}) {
  stopDuelClock();
  duelSecondsLeft = DUEL_TURN_SECONDS;
  const turnStore = new StateStore({
    userId: 'duel',
    token: '',
    ephemeral: true,
    deterministic: false,
    onChange: (state) => updateChrome(state),
  });
  turnStore.state = {
    ...turnStore.state,
    duel: true,
    difficulty: duelState.difficulty,
  };
  turnStore.state = turnStore.startRound(duelState.round, { silent: true });
  turnStore.state = { ...turnStore.state, seed: duelState.seed };
  renderer?.resetRound(turnStore.state);
  store = turnStore;
  updateChrome(store.state);
  renderA11yList(store.state);
  if (startClock) startDuelClock();
}

function startDuelClock() {
  clearInterval(duelClockTimer);
  // Paint the full clock before the first tick, so the pill is visible the
  // moment the turn starts rather than one second later.
  syncDuelClock(store.state);
  duelClockTimer = setInterval(() => {
    if (!store.state.duel || store.state.phase !== COUNTING) {
      clearInterval(duelClockTimer);
      return;
    }
    duelSecondsLeft = Math.max(0, duelSecondsLeft - 1);
    syncDuelClock(store.state);
    if (duelSecondsLeft === 0) {
      clearInterval(duelClockTimer);
      syncDuelTurnHint();
    }
  }, 1000);
}

function stopDuelClock() {
  clearInterval(duelClockTimer);
}

// The turn-clock pill follows the same round-pill shape as the round
// countdown, so the two modes never fight over the count plate.
function syncDuelClock(state) {
  const show = !!state.duel && state.phase === COUNTING;
  els.duelTurnClock.hidden = !show;
  if (show) {
    els.duelTurnClock.textContent = String(Math.max(0, duelSecondsLeft));
  }
}

function syncDuelTurnHint() {
  if (duelState && !duelState.done && duelSecondsLeft === 0) {
    els.playHint.textContent = 'Time to pass the device. Tap Done counting.';
    els.playHint.hidden = false;
  }
}

// Called from the panel sync (below) whenever a duel turn's store reaches
// RUN_OVER: record the miss count, then either pass the device or show the
// results card.
function resolveDuelTurn() {
  if (!duelState || duelState.done || duelResolving) return;
  duelResolving = true;
  stopDuelClock();
  const misses = duelState.misses;
  // Misses are real sheep left uncounted. The wolf is not a sheep to count,
  // so it never adds a miss (a perfect wolf round used to read "1 missed").
  const realSheep = store.state.sheepCount - (store.state.wolfIndex != null ? 1 : 0);
  misses[duelState.turn] = Math.max(0, realSheep - store.state.count);
  const isLast = duelState.turn === DUEL_PLAYERS.length - 1;
  if (isLast) {
    duelState.done = true;
    showDuelResults();
  } else {
    duelState.turn += 1;
    showDuelPanel({
      title: 'Pass the device',
      body: `${DUEL_PLAYERS[duelState.turn]}, you count the same flock as ${DUEL_PLAYERS[duelState.turn - 1]}.`,
      scores: [{ label: DUEL_PLAYERS[0], value: `${misses[0]} missed` }],
      hint: 'Same flock, fresh eyes. The lower miss count wins.',
      btn: 'Start counting',
      onBtn: () => {
        dismissDuelPanel();
        beginDuelTurn({});
      },
    });
  }
  duelResolving = false;
}

function duelMissesLine(misses) {
  const [a, b] = misses;
  if (a == null || b == null) return '';
  if (a < b) return `${DUEL_PLAYERS[0]} wins.`;
  if (b < a) return `${DUEL_PLAYERS[1]} wins.`;
  return 'A tie. Count another flock.';
}

function showDuelResults() {
  const misses = duelState.misses;
  showDuelPanel({
    title: 'Duel result',
    body: duelMissesLine(misses),
    scores: DUEL_PLAYERS.map((name, i) => ({ label: name, value: `${misses[i]} missed` })),
    hint: null,
    btn: 'Count again',
    onBtn: () => {
      dismissDuelPanel();
      startDuel(duelState.round, { skipIntro: true });
    },
    exitBtn: 'Back to my game',
    onExit: endDuel,
  });
}

// Leaves pass-and-play for the player's own game. The store the duel set
// aside comes back exactly as it was (round, progress, settings). Before
// this the duel's throwaway store stayed in charge until a reload, so
// nothing played afterwards was saved or reached the leaderboard.
function endDuel() {
  stopDuelClock();
  duelState = null;
  dismissDuelPanel();
  if (soloStore) {
    store = soloStore;
    soloStore = null;
  }
  store.state = { ...store.state, duel: false };
  syncRoundClock();
  renderer?.resetRound(store.state);
  updateChrome(store.state);
  renderA11yList(store.state);
  // A duel is started from the game-over card, so the player's own run is
  // still over and its card comes back; a live board picks its clock up.
  if (!staticMode && store.state.phase === COUNTING) startRoundClock();
}

function showDuelPanel({ title, body, scores, hint, btn, onBtn, exitBtn, onExit }) {
  els.duelPanelTitle.textContent = title;
  els.duelPanelBody.textContent = body;
  els.duelPanelScores.replaceChildren();
  for (const row of scores || []) {
    const p = document.createElement('p');
    p.className = 'duel-score-row';
    const name = document.createElement('span');
    name.className = 'duel-score-name';
    name.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'duel-score-value';
    value.textContent = row.value;
    p.appendChild(name);
    p.appendChild(value);
    els.duelPanelScores.appendChild(p);
  }
  els.duelPanelHint.hidden = !hint;
  els.duelPanelHint.textContent = hint || '';
  els.duelPanelBtn.textContent = btn;
  els.duelPanelBtn.onclick = onBtn;
  if (els.duelPanelExit) {
    els.duelPanelExit.hidden = !exitBtn;
    els.duelPanelExit.textContent = exitBtn || '';
    els.duelPanelExit.onclick = exitBtn ? onExit : null;
  }
  els.duelPanel.hidden = false;
}

function dismissDuelPanel() {
  els.duelPanel.hidden = true;
}

// The grown-ups panel's Difficulty row: the ladder, or Calm.
const DIFFICULTY_LABELS = { calm: 'Calm', flow: 'Levels' };

// The game-over card's Best level chip shows only once the player has
// actually climbed past level 1: a brand-new player has no record to
// celebrate, so the chip stays hidden there.
function syncBestRoundChip() {
  const best = store.bestLevel;
  els.bestRoundValue.textContent = String(best);
  els.bestRoundChip.hidden = !(best > 1);
}

// The corner tag names the level; the screen-reader mirror adds where in
// the level the round sits. The renderers never touch it: it sits above
// the canvas and the DOM grid, so both frame the flock exactly as before.
function syncRoundBadge(state) {
  els.roundBadge.textContent = levelTagText(state.round);
  els.a11yRoundProgress.textContent =
    `${levelTagText(state.round)}, round ${roundInLevel(state.round)} of ${ROUNDS_PER_LEVEL}.`;
}

// The streak chip counts the consecutive days the player has played. The
// store records a day each time a round starts, so the game-over card
// reflects the day's play. It hides entirely when no day has been
// recorded (storage unavailable, or a deep-link fixture without streak
// data), the same way the Best level chip hides until there is a record.
function syncStreakChip(state) {
  const days = Math.max(0, Math.floor(Number(state.streakDays) || 0));
  els.streakChip.hidden = !(days > 0);
  els.streakValue.textContent = String(days);
}

// The game-over card's "Start at level" row: one pill per shortcut up to
// the best level reached (1, 4, 7 ...), then Calm. Rebuilt when the card
// opens, from the store's own bests.
function renderStartLevelPicker(state) {
  const picker = els.startLevelPicker;
  picker.replaceChildren();
  const pill = (label, data) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'difficulty-pill';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    Object.assign(btn.dataset, data);
    btn.textContent = label;
    picker.appendChild(btn);
  };
  for (const level of startLevelChoices(store.bestLevel)) {
    pill(String(level), { level: String(level) });
  }
  pill('Calm', { calm: '1' });
  // The run that just ended marks its own starting point.
  const current = isCalmLevel(state.difficulty) ? 'calm' : null;
  for (const btn of picker.children) {
    if (current && btn.dataset.calm) btn.setAttribute('aria-checked', 'true');
  }
}

// ---- Round clock ----
// One interval drives a timed round's countdown. The store steps it whole
// seconds at a time, so every surface reads the same state; running out is
// the run-end path every other outcome already shares. A pass, a restart,
// a duel or a fresh board clears it. Untimed rounds (levels 1 and 2, Calm)
// never start one.
let roundClockTimer = null;

function startRoundClock() {
  clearInterval(roundClockTimer);
  if (store.state.duel || store.state.secondsLeft == null || store.state.phase !== COUNTING) return;
  // First update paints the clock without waiting a second.
  updateChrome(store.state);
  renderA11yList(store.state);
  roundClockTimer = setInterval(() => {
    if (store.state.phase !== COUNTING || store.state.secondsLeft == null) {
      clearInterval(roundClockTimer);
      return;
    }
    const alive = store.tickClock();
    // The clock line in the a11y list follows the pill every second, not
    // only when a sheep is tapped.
    renderA11yList(store.state);
    if (!alive) {
      clearInterval(roundClockTimer);
      // Time out before the flock is finished: the run ends, with its own
      // reason line.
      if (store.state.phase === COUNTING) store.endRun(ENDED_TIME_UP);
    }
  }, 1000);
}

function stopRoundClock() {
  clearInterval(roundClockTimer);
}

function clearPass() {
  clearTimeout(passTimer);
  passTimer = null;
}

// The pass banner's moment is over: the next flock walks in and, on a
// timed level, its fresh clock starts.
function advanceRound() {
  clearPass();
  stopRoundClock();
  if (store.state.phase !== ROUND_PASSED || store.state.duel) return;
  store.nextRound();
  syncRoundClock();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  startRoundClock();
}

// A fresh board for the store's current round (a restart, a level pick, a
// Calm switch): nothing pending from the last one carries over.
function freshBoard() {
  clearPass();
  stopRoundClock();
  syncRoundClock();
  renderer?.resetRound(store.state);
  renderA11yList(store.state);
  startRoundClock();
}

// Back from a duel's throwaway turn store to the player's own, if a duel
// set one aside.
function leaveDuel() {
  stopDuelClock();
  duelState = null;
  dismissDuelPanel();
  if (soloStore) {
    store = soloStore;
    soloStore = null;
    store.state = { ...store.state, duel: false };
  }
}

function restartRun() {
  leaveDuel();
  store.restartRun();
  freshBoard();
  playBaa();
}

// "Start at level N" and the Calm pill on the game-over card.
function startAtLevel(level) {
  leaveDuel();
  store.startAtLevel(level);
  freshBoard();
  playBaa();
}

function startCalm() {
  leaveDuel();
  if (isCalmLevel(store.state.difficulty)) store.restartRun();
  else store.setCalmOn(true);
  freshBoard();
  playBaa();
}

function hintFor(state) {
  if (state.phase === ROUND_PASSED) return 'Nicely counted.';
  if (state.phase === RUN_OVER) return 'Tap Start again to play.';
  return playHintText(state.count, realSheepCount(state), state.sheepCount);
}

// One small dot per real sheep, under the counter. Dot i fills in the
// pastel colour of tap number i+1's confetti (NUMBER_COLORS), so the dot
// that just popped matches the burst the player just caused. The wolf
// never gets a dot, matching the "of N sheep" total.
function renderCountDots(state, animate) {
  const total = Math.max(0, realSheepCount(state));
  const dots = els.countDots;
  if (dots.childElementCount !== total) {
    dots.replaceChildren();
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'count-dot';
      dots.appendChild(dot);
    }
  }
  const filled = Math.min(total, Math.max(0, state.count));
  for (let i = 0; i < total; i++) {
    const dot = dots.children[i];
    const on = i < filled;
    dot.classList.toggle('is-filled', on);
    if (on) dot.style.setProperty('--dot', NUMBER_COLORS[i % NUMBER_COLORS.length]);
  }
  if (animate && filled > 0) {
    const newest = dots.children[filled - 1];
    newest.classList.remove('dot-pop');
    // Restart the animation even when two taps land back to back.
    void newest.offsetWidth;
    newest.classList.add('dot-pop');
  }
}

let lastShownCount = null;
let lastPhase = null;

// The corner mute button mirrors the sound setting: speaker when on,
// crossed-out speaker when off, with an aria-pressed and a spoken name
// that match. Kept beside the Grown-ups panel's Sound effects switch,
// which reads the same bit, so the two can never disagree.
function syncSoundButton(state) {
  if (!els.soundBtn) return;
  const on = !!state.soundOn;
  els.soundBtn.textContent = on ? '\u{1F50A}' : '\u{1F507}';
  els.soundBtn.setAttribute('aria-pressed', String(on));
  els.soundBtn.setAttribute('aria-label', on
    ? 'Sound effects: on. Tap to turn off'
    : 'Sound effects: off. Tap to turn on');
}

// Big Tap's toggle label names its state, so a grown-up skimming the
// panel reads the mode without interpreting the checkbox.
function syncBigTapLabel(on) {
  if (els.bigtapLabel) els.bigtapLabel.textContent = on ? 'Big Tap: on' : 'Big Tap: off';
}

function updateChrome(state) {
  // Keep the audio module's enabled flag in lockstep with the toggle, so
  // every sound path (chime, baa, celebration) reads one source of truth.
  setSoundEnabled(!!state.soundOn);

  const countedUp = lastShownCount !== null && state.count > lastShownCount;
  if (countedUp) {
    const plate = els.countDisplay.parentElement;
    plate.classList.remove('count-pop');
    // Restart the animation even when two taps land back to back.
    void plate.offsetWidth;
    plate.classList.add('count-pop');
  }
  lastShownCount = state.count;

  syncRoundBadge(state);
  // The round clock is its own pill, so the count plate keeps its job
  // (taps counted). Hidden the moment the round is passed or the run
  // ends; an untimed round and a duel turn never show one.
  const showTimer = !state.duel && state.phase === COUNTING && state.secondsLeft != null;
  els.speedTimer.hidden = !showTimer;
  if (showTimer) els.speedTimer.textContent = speedRoundClock(state.secondsLeft);
  els.countDisplay.textContent = String(state.count);
  // The total is the real sheep only. A round's wolf is not one to count:
  // counting "of N" with the wolf in N led a child straight to tapping it.
  els.countWord.textContent = `of ${sheepPhrase(realSheepCount(state))}`;
  renderCountDots(state, countedUp);
  els.playHint.textContent = hintFor(state);
  // Done counting is a duel turn's hand-in only: a solo round passes on
  // its last pop, so the button would only ever be a trap there.
  els.submitBtn.hidden = !state.duel;
  els.submitBtn.disabled = state.phase !== COUNTING;
  // The quiet Done counting: a soft light button until counting starts,
  // then the usual dark one. It is never disabled during counting.
  els.submitBtn.classList.toggle('is-quiet', state.phase === COUNTING && state.count === 0);

  els.roundValue.textContent = String(levelForRound(state.round));
  els.bestValue.textContent = String(store.bestRound);
  els.difficultyValue.textContent = DIFFICULTY_LABELS[state.difficulty] || 'Levels';
  els.totalValue.textContent = String(state.totalCounted);
  els.bestStreakValue.textContent = String(state.bestSafeStreak);
  els.bonusValue.textContent = String(state.bonusCounted || 0);
  els.communityValue.textContent = String(state.communityTotal);
  setExportStatus('');
  els.soundToggle.checked = !!state.soundOn;
  syncSoundButton(state);
  els.scenerySelect.value = state.scenery;
  els.calmToggle.checked = !!state.calmOn;
  els.namesToggle.checked = !!state.namesOn;
  els.bigtapToggle.checked = !!state.bigTap;
  syncBigTapLabel(!!state.bigTap);
  applyTheme(state);
  applyNames(state);

  syncPanels(state);
}

function syncPanels(state) {
  const passed = state.phase === ROUND_PASSED;
  const over = state.phase === RUN_OVER;

  if (state.duel && (over || passed)) {
    // A duel turn never shows the solo game-over or round-complete card:
    // the handoff or the results card replaces it, and this early return
    // keeps every solo branch (gameOver copy, advance timer, celebration)
    // out of the way. A turn counted without a mistake passes the round;
    // it used to fall through to the solo auto-advance and never hand over.
    // A frozen duel fixture has no duel controller behind it, so its card
    // is shown directly at boot and nothing re-syncs it.
    if (duelState) resolveDuelTurn();
    return;
  }

  // Mid-count the hint is empty and the bubble hides, so the count plate
  // is the only number on the board while the child counts.
  const hint = hintFor(state);
  els.playHint.textContent = hint;
  els.playHint.hidden = !hint;
  // Done counting is a duel turn's hand-in only: a solo round passes on
  // its last pop, so the button would only ever be a trap there.
  els.submitBtn.hidden = !state.duel;
  }
  if (over) {
    els.gameOverRound.textContent = String(levelForRound(state.round));
    els.gameOverEyebrow.textContent = 'The flock scattered';
    els.gameOverReason.textContent =
      state.endedBy === ENDED_COMPLETE ? 'Every round counted.'
      : state.endedBy === ENDED_WOLF ? 'The wolf tricked you.'
      : state.endedBy === ENDED_DOUBLE_TAP ? 'You counted the same sheep twice.'
      : state.endedBy === ENDED_TIME_UP ? 'The clock ran out.'
      : `You said done with ${state.count} of ${sheepPhrase(realSheepCount(state))} counted.`;
    const dodged = state.safeStreak || 0;
    els.gameOverStreak.hidden = !(dodged > 0);
    if (!els.gameOverStreak.hidden) {
      els.gameOverStreak.textContent = dodged === 1
        ? 'You dodged 1 wolf round in a row.'
        : `You dodged ${dodged} wolf rounds in a row.`;
    }
    // The choices for the next run: the record chips and the level
    // shortcuts. A read-only shared card shows neither.
    const readOnly = !!publicViewMode || sceneParam === 'sharegameover';
    els.gameOverChips.hidden = readOnly;
    els.gameOverOptions.hidden = readOnly;
    if (!readOnly) {
      syncBestRoundChip();
      syncStreakChip(state);
      renderStartLevelPicker(state);
    }
    playBaa();
  }
  els.gameOver.hidden = !over;

  if (state.phase === lastPhase) return;
  lastPhase = state.phase;
  if (passed) {
    renderer?.celebrate?.();
    // The bigger moment is for a level-up: the celebration sound joins
    // the confetti. A plain pass already had its baa on the last pop.
    if (pass && pass.levelUp && !isCalmLevel(state.difficulty)) playCelebration();
    // The banner holds for its moment, then the next flock walks in by
    // itself. Frozen fixtures hold still for their screenshots.
    if (!staticMode) {
      clearPass();
      passTimer = setTimeout(advanceRound, pass && pass.levelUp ? LEVEL_UP_MS : PASS_MS);
    }
  }
}

// How many animals in the round are real sheep: everything but the wolf.
function realSheepCount(state) {
  return state.sheepCount - (state.wolfIndex != null ? 1 : 0);
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
    // Between rounds (the pass banner) and after the run no tap can land,
    // so the mirror says so instead of offering a button that would
    // silently do nothing. And a sheep that already popped is gone from
    // the screen, so its button is disabled, not tappable.
    btn.disabled = state.phase !== COUNTING || state.counted.includes(i);
    // With Name labels on, the mirror uses the same playful name the two
    // renderers draw, so a screen reader calls the sheep what the player
    // sees: "Woolly is grazing" / "Woolly, counted as number 3".
    const label = state.namesOn
      ? (state.counted.includes(i)
        ? `${sheepName(state.seed, i)}, counted as number ${state.counted.indexOf(i) + 1}`
        : `${sheepName(state.seed, i)} is grazing`)
      : (state.counted.includes(i)
        ? `Sheep ${i + 1}, counted` : `Sheep ${i + 1}, not counted yet`);
    // The wolf's entry names what gives it away on screen (wolfCueText).
    btn.textContent = state.wolfIndex === i ? `${label}, and ${wolfCueText(state.round, state.difficulty)}` : label;
  });
  // The clock is part of the round's state, so the screen-reader list
  // mirrors it too. It stays only while the clock is actually running
  // (same condition as the on-screen pill): once the round is passed or
  // the run ends, the line leaves the list. Off or hidden, it stays out
  // of the list entirely.
  let clockLine = els.a11yList.querySelector('#a11y-speed-clock');
  const clockRunning = !state.duel && state.phase === COUNTING && state.secondsLeft != null;
  if (clockRunning) {
    if (!clockLine) {
      clockLine = document.createElement('p');
      clockLine.id = 'a11y-speed-clock';
      els.a11yList.appendChild(clockLine);
    }
    clockLine.textContent = `${speedRoundClock(state.secondsLeft)} seconds left.`;
  } else if (clockLine) {
    clockLine.remove();
  }
}

els.submitBtn.addEventListener('click', submitCount);
els.restartBtn.addEventListener('click', restartRun);

// The game-over card's level shortcuts and Calm pill. Frozen fixtures
// render the pills but ignore taps, like every other fixture control.
els.startLevelPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.difficulty-pill');
  if (!btn || staticMode || publicViewMode) return;
  if (btn.dataset.calm) startCalm();
  else startAtLevel(Number(btn.dataset.level));
});

// Pass-and-play Duel, started from the game-over card: both players count
// the flock of the level the run just reached.
els.duelStartBtn.addEventListener('click', () => {
  if (staticMode || publicViewMode) return;
  startDuel(store.state.round);
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
  setExportStatus('');
  els.roundValue.textContent = String(levelForRound(state.round));
  els.bestValue.textContent = String(store.bestRound);
  els.difficultyValue.textContent = DIFFICULTY_LABELS[state.difficulty] || 'Levels';
  els.totalValue.textContent = String(state.totalCounted);
  els.bestStreakValue.textContent = String(state.bestSafeStreak);
  els.bonusValue.textContent = String(state.bonusCounted || 0);
  els.communityValue.textContent = String(state.communityTotal);
  els.soundToggle.checked = !!state.soundOn;
  syncSoundButton(state);
  els.scenerySelect.value = state.scenery;
  els.calmToggle.checked = !!state.calmOn;
  els.namesToggle.checked = !!state.namesOn;
  els.bigtapToggle.checked = !!state.bigTap;
  syncBigTapLabel(!!state.bigTap);
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

// The corner button is the one-tap version of the same setting. It plays
// nothing itself: the next counted sheep (or flock landing) is the first
// sound, so the AudioContext still opens inside a real tap handler.
els.soundBtn.addEventListener('click', () => {
  if (staticMode) return;
  store.setSoundOn(!store.state.soundOn);
});

els.scenerySelect.addEventListener('change', (e) => {
  if (staticMode) return;
  store.setScenery(e.target.value);
});

// Calm is one switch: turning it on or off changes the curve, which starts
// a fresh run at level 1, so the board behind the panel is rebuilt too.
els.calmToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  const before = store.state.difficulty;
  store.setCalmOn(e.target.checked);
  if (store.state.difficulty !== before) freshBoard();
});

els.namesToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  store.setNamesOn(e.target.checked);
  // The mirror lives outside updateChrome's renderer path, so it needs
  // its own render to switch between "Sheep 3" and "Woolly is grazing".
  renderA11yList(store.state);
});

els.bigtapToggle.addEventListener('change', (e) => {
  if (staticMode) return;
  // Big Tap applies from the next flock build (the next round): the store
  // holds it, the renderers read it when the round is built.
  store.setBigTapOn(e.target.checked);
});

// ---- Grown-ups CSV export ----
// Downloads the player's best rounds and this week's finished runs as two
// CSV files. In a live session the data comes from /api/export (the same
// rows the panel and weekly leaderboard already show); the frozen
// ?scene=grownups fixture renders from hardcoded data and never fetches,
// so the static panel exports the same demo numbers without the network.
// The status line announces what happened through its role="status".
function setExportStatus(message, isError) {
  els.exportStatus.textContent = message;
  els.exportStatus.hidden = !message;
  els.exportStatus.classList.toggle('is-error', !!isError);
}

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick: the click must still be able to start the
  // download when this runs.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

let exporting = false;
els.exportBtn.addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  els.exportBtn.disabled = true;
  setExportStatus('Preparing export...');
  try {
    let data;
    if (staticMode) {
      data = {
        bestRounds: store.state.bestRounds,
        weeklyRuns: LEADERBOARD_FIXTURE.weekly.map((row) => ({
          roundReached: row.roundReached,
          speedRound: !!row.speedRound,
        })),
      };
    } else {
      const res = await fetch('/api/export', {
        headers: token ? { 'x-usernode-token': token } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      data = await res.json();
    }
    downloadCsv('sheep-countrr-best-rounds.csv', bestRoundsCsv(data));
    downloadCsv('sheep-countrr-weekly-history.csv', weeklyHistoryCsv(data.weeklyRuns));
    setExportStatus('Exported best rounds and weekly history.');
  } catch (err) {
    setExportStatus('Export failed. Try again in a moment.', true);
  } finally {
    exporting = false;
    els.exportBtn.disabled = false;
  }
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

// Tell the inline boot watchdog in index.html how startup went, so a
// failed start shows the Try again card instead of an empty frame.
boot()
  .then(() => window.__sheepBootDone?.())
  .catch((err) => {
    console.error('Sheep countrr failed to start', err);
    window.__sheepBootFailed?.(err);
  });

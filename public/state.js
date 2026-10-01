// Shared client state for a run of Sheep countrr: which round is being
// played, which sheep have been tapped, and whether the run is still
// alive. Both renderers read this same shape, so the 3D scene and the DOM
// fallback can never drift apart.
//
// A run is a sequence of rounds. Tap every sheep in the round and the
// round is passed; miss one and submit, or tap a sheep you already
// counted, and the run ends.

import {
  DEFAULT_DIFFICULTY,
  MAX_SHEEP,
  SPEED_ROUND_SECONDS,
  advanceStreak,
  localDayKey,
  normalizeCalm,
  normalizeDifficulty,
  normalizeRound,
  normalizeSpeedRound,
  roundSeed,
  sheepForRound,
  WOLF_BONUS,
  wolfIndexForRound,
} from './rounds.js';

const STORAGE_PREFIX = 'sheep-countrr:';
const SYNC_DEBOUNCE_MS = 1500;

// Run phases.
export const COUNTING = 'counting';
export const ROUND_PASSED = 'roundPassed';
export const RUN_OVER = 'runOver';

// Why a run ended, for the game-over copy. A Speed Round can also end on
// its own clock; the reason is stored with the run so a shared card shows
// the same line the player saw.
export const ENDED_DOUBLE_TAP = 'doubleTap';
export const ENDED_MISSED = 'missed';
export const ENDED_WOLF = 'wolf';
export const ENDED_TIME_UP = 'timeUp';

// One best round per difficulty, kept in a map so a best on Easy can never
// masquerade as one on Hard.
export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard', 'expert'];

// ---- Play streak normalization ----
// A day key is a local calendar date, YYYY-MM-DD. Anything that is not one
// reads as "no day recorded" rather than crashing an old or mangled save.
function normalizeDayKey(raw) {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizeStreakCount(raw) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeBestRounds(raw, fallback) {
  const out = { easy: 1, normal: 1, hard: 1, expert: 1 };
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const key of DIFFICULTY_KEYS) {
    out[key] = normalizeRound(source[key] || 1);
  }
  // Fold a legacy single best round in when no per-difficulty data exists,
  // so a pre-difficulty player keeps their best round on Normal.
  if (!source || !Object.keys(source).length) {
    out.normal = Math.max(out.normal, normalizeRound(fallback || 1));
  }
  return out;
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function createDefaultState() {
  return {
    round: 1,
    sheepCount: sheepForRound(1),
    seed: roundSeed(1),
    count: 0,
    counted: [],
    phase: COUNTING,
    endedBy: null,
    wolfIndex: null,
    safeStreak: 0,
    bestSafeStreak: 0,
    bonusCounted: 0,
    bestRounds: { easy: 1, normal: 1, hard: 1, expert: 1 },
    totalCounted: 0,
    communityTotal: 0,
    soundOn: false,
    nightOn: false,
    calmOn: false,
    namesOn: false,
    difficulty: DEFAULT_DIFFICULTY,
    speedOn: false,
    secondsLeft: null,
    // Play streak: consecutive local days with at least one round started,
    // the best streak ever reached, and the day key that earned the current
    // one. Kept in localStorage beside the other run-spanning values; it
    // never syncs to the server, so a deep link or a fixture cannot move a
    // real player's streak.
    streakDays: 0,
    bestStreakDays: 0,
    lastPlayedDay: null,
    // The renderer clock this round had reached when it was last
    // persisted, and when each sheep was counted. Restored on resume so
    // the flock is standing exactly where the player left it.
    roundElapsed: 0,
    countedAt: [],
  };
}

export class StateStore {
  constructor({ userId, token, onChange, ephemeral, deterministic, onRecordRun } = {}) {
    this.userId = userId || 'anon';
    this.token = token || '';
    this.onChange = onChange || (() => {});
    // Deep-link fixtures (?round=N, ?scene=...) are ephemeral: they must
    // never read or write localStorage or the server, so they carry
    // nothing worth authenticating and a screenshot run cannot clobber a
    // real player's progress.
    this.ephemeral = !!ephemeral;
    // Deep links reuse the round's fixed seed so the same URL always
    // renders the same pasture; ordinary play scatters a fresh flock.
    this.deterministic = !!deterministic;
    this.state = createDefaultState();
    this.unsyncedTaps = 0;
    this.unsyncedBonus = 0;
    this._syncTimer = null;
    // One finished run is recorded at most once per run; a fresh run
    // re-arms the guard (see startRound).
    this.runRecorded = false;
    // The id of the most recently recorded run, for Share result. Best
    // effort only: a failed run post leaves it unset and Share falls back
    // to the player's most recent server-side run.
    this.lastRunId = null;
    // Test seam: called with the round reached instead of POSTing, so the
    // guard can be asserted without a network. Real play leaves it unset
    // and records through /api/runs.
    this.onRecordRun = onRecordRun || null;
    // Set by app.js once a renderer exists: returns the round's elapsed
    // animation time in seconds, already offset for a resumed board.
    // Null (tests, pre-mount) means the last persisted value stands.
    this.roundClock = null;
    // True while a resumable board is on screen (see hasMidRoundSnapshot).
    this._hasMidRoundSnapshot = false;
  }

  get storageKey() {
    return STORAGE_PREFIX + this.userId;
  }

  // The best round reached at the difficulty currently selected. The
  // grown-ups panel reads this; the per-level map keeps every level's own.
  get bestRound() {
    return this.state.bestRounds[this.state.difficulty] || 1;
  }

  // True while a resumable board is on screen: a snapshot was restored
  // (or a round started) and the round is still being counted. Drives the
  // "snapshot beats server sync" rule in loadRemote.
  get hasMidRoundSnapshot() {
    return this._hasMidRoundSnapshot === true;
  }

  seedFor(round) {
    return this.deterministic ? roundSeed(round) : randomSeed();
  }

  loadLocal() {
    if (this.ephemeral) return this.state;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return this.state;
      const saved = JSON.parse(raw);
      // Only the run-spanning values are restored. A half-counted round
      // is never resumed: coming back mid-round and finding taps you do
      // not remember making is a run-ending trap.
      this.state = {
        ...this.state,
        round: normalizeRound(saved.round),
        bestRounds: normalizeBestRounds(saved.bestRounds, saved.bestRound || saved.round),
        bestSafeStreak: Math.max(0, Number(saved.bestSafeStreak) || 0),
        bonusCounted: Math.max(0, Number(saved.bonusCounted) || 0),
        totalCounted: Math.max(0, Number(saved.totalCounted) || 0),
        soundOn: !!saved.soundOn,
        nightOn: !!saved.nightOn,
        calmOn: normalizeCalm(saved.calmOn),
        namesOn: !!saved.namesOn,
        difficulty: normalizeDifficulty(saved.difficulty),
        speedOn: normalizeSpeedRound(saved.speedOn),
        streakDays: normalizeStreakCount(saved.streakDays),
        bestStreakDays: normalizeStreakCount(saved.bestStreakDays),
        lastPlayedDay: normalizeDayKey(saved.lastPlayedDay),
      };
      // A mid-round snapshot resumes the exact board: same seed, same
      // counted sheep, same clock. Saves from before this feature (or a
      // save taken between rounds) fall back to a fresh flock, as before.
      if (
        saved.midCountdown
        && saved.midCountdown.phase === COUNTING
        && Array.isArray(saved.midCountdown.counted)
      ) {
        this.resumeMidRound(saved.midCountdown, { silent: true });
      } else {
        this.startRound(this.state.round, { silent: true });
      }
    } catch {
      /* ignore corrupt or unavailable storage */
    }
    return this.state;
  }

  saveLocal() {
    if (this.ephemeral) return;
    try {
      // Merge with whatever else is stored under the key (the mid-round
      // snapshot lives beside these values) instead of replacing it.
      const raw = localStorage.getItem(this.storageKey);
      const meta = raw ? JSON.parse(raw) : {};
      const runValues = {
        round: this.state.round,
        difficulty: this.state.difficulty,
        bestRounds: this.state.bestRounds,
        bestSafeStreak: this.state.bestSafeStreak,
        bonusCounted: this.state.bonusCounted,
        totalCounted: this.state.totalCounted,
        soundOn: this.state.soundOn,
        nightOn: this.state.nightOn,
        calmOn: this.state.calmOn,
        namesOn: this.state.namesOn,
        speedOn: this.state.speedOn,
        streakDays: this.state.streakDays,
        bestStreakDays: this.state.bestStreakDays,
        lastPlayedDay: this.state.lastPlayedDay,
      };
      localStorage.setItem(this.storageKey, JSON.stringify({ ...meta, ...runValues }));
    } catch {
      /* storage full or unavailable; the run still works this session */
    }
  }

  async loadRemote() {
    if (this.ephemeral || !this.token) return this.state;
    try {
      const res = await fetch('/api/state', { headers: { 'x-usernode-token': this.token } });
      if (!res.ok) return this.state;
      const data = await res.json();
      // The server keeps only run-spanning values, so a local mid-round
      // snapshot wins: it was saved on every tap, the server sync is
      // debounced. Its round and difficulty stay exactly as saved; only
      // the community total is allowed to move. Without a snapshot the
      // round starts fresh as before.
      const resuming = this.hasMidRoundSnapshot;
      this.state = {
        ...this.state,
        round: resuming ? this.state.round : normalizeRound(data.round),
        bestRounds: normalizeBestRounds(data.bestRounds, data.bestRound),
        bestSafeStreak: Math.max(0, Number(data.bestSafeStreak) || 0),
        bonusCounted: Math.max(0, Number(data.bonusCounted) || 0),
        totalCounted: Math.max(0, Number(data.totalCounted) || 0),
        communityTotal: Math.max(0, Number(data.communityTotal) || 0),
        soundOn: !!data.soundOn,
        nightOn: !!data.nightOn,
        calmOn: normalizeCalm(data.calmOn),
        difficulty: resuming ? this.state.difficulty : normalizeDifficulty(data.difficulty),
      };
      if (resuming) {
        this.startRound(this.state.round, { silent: true, keepBoard: true });
      } else {
        this.startRound(this.state.round, { silent: true });
      }
      this.saveLocal();
    } catch {
      /* offline or no server: keep whatever localStorage had */
    }
    return this.state;
  }

  scheduleSync() {
    if (this.ephemeral || !this.token) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.flush(), SYNC_DEBOUNCE_MS);
  }

  async flush() {
    if (this.ephemeral || !this.token) return;
    clearTimeout(this._syncTimer);
    const taps = this.unsyncedTaps;
    this.unsyncedTaps = 0;
    const bonus = this.unsyncedBonus;
    this.unsyncedBonus = 0;
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usernode-token': this.token },
        keepalive: true,
        body: JSON.stringify({
          round: this.state.round,
          difficulty: this.state.difficulty,
          bestRound: this.bestRound,
          bestSafeStreak: this.state.bestSafeStreak,
          newTaps: taps,
          newBonus: bonus,
          soundOn: this.state.soundOn,
          nightOn: this.state.nightOn,
          calmOn: this.state.calmOn,
        }),
      });
    } catch {
      /* best effort; the next change reschedules a sync */
    }
  }

  // Start (or restart) a round: fresh flock, nothing counted, run alive.
  // The wolf draw happens here, from the round's seed, so a round that is
  // never resumed mid-count always re-derives exactly what was hiding.
  startRound(round, { silent, keepBoard } = {}) {
    const next = normalizeRound(round);
    const bestRound = Math.max(this.state.bestRounds[this.state.difficulty] || 1, next);
    // keepBoard: a server sync just came back and the locally restored
    // board is newer than anything the server has; keep its flock and
    // its exact seed, not a freshly scattered one.
    const sheepCount = keepBoard ? this.state.sheepCount : sheepForRound(next, this.state.difficulty);
    const seed = keepBoard ? this.state.seed : this.seedFor(next);
    this.state = {
      ...this.state,
      round: next,
      sheepCount,
      seed,
      // keepBoard: a server sync just came back and the locally restored
      // board is newer than anything the server has; keep its counted
      // list, its clock and its Speed Round countdown exactly as
      // restored, not a fresh round's.
      count: keepBoard ? this.state.count : 0,
      // keepBoard: a server sync just came back and the locally restored
      // board is newer than anything the server has; keep its counted
      // list and animation clock exactly as restored.
      counted: keepBoard ? this.state.counted : [],
      countedAt: keepBoard ? this.state.countedAt : [],
      roundElapsed: keepBoard ? this.state.roundElapsed : 0,
      phase: COUNTING,
      endedBy: null,
      wolfIndex: keepBoard ? this.state.wolfIndex : wolfIndexForRound(next, seed, sheepCount),
      // A restart to round 1 is a new run, so the current streak resets.
      // bestSafeStreak survives, like bestRounds.
      safeStreak: next === 1 ? 0 : this.state.safeStreak,
      // Speed Round is a run-level mode set on the briefing card: every
      // round of the run plays the same flock under its own fresh 30
      // second clock. The clock state is reset with the round so a
      // resumed round can never read a stale countdown.
      speedOn: normalizeSpeedRound(this.state.speedOn),
      secondsLeft: keepBoard
        ? this.state.secondsLeft
        : (normalizeSpeedRound(this.state.speedOn) ? SPEED_ROUND_SECONDS : null),
      bestRounds: {
        ...this.state.bestRounds,
        [this.state.difficulty]: bestRound,
      },
    };
    this.runRecorded = false;
    // Every round start is a play day. On a day already recorded this is
    // a no-op; a first day or a new day after a gap updates the streak.
    // Deep links and fixtures are ephemeral and never record.
    this.recordPlayDay();
    if (!silent && !keepBoard) {
      // A round that just started is a board worth resuming: nothing
      // counted yet, but the seed, flock size and mode travel with it.
      this.saveMidRound();
    }
    if (keepBoard) {
      // The kept board came from a restored snapshot; it stays resumable.
      this._hasMidRoundSnapshot = true;
    }
    if (!silent) {
      this.saveLocal();
      this.flush();
      this.onChange(this.state);
    }
    return this.state;
  }

  // A pure save/restore shape used by the tests to exercise the same
  // normalization loadLocal applies, without touching localStorage.
  loadLocalFrom(saved) {
    this.state = {
      ...this.state,
      round: normalizeRound(saved.round),
      bestRounds: normalizeBestRounds(saved.bestRounds, saved.bestRound || saved.round),
          totalCounted: Math.max(0, Number(saved.totalCounted) || 0),
          soundOn: !!saved.soundOn,
          nightOn: !!saved.nightOn,
          calmOn: normalizeCalm(saved.calmOn),
          namesOn: !!saved.namesOn,
          difficulty: normalizeDifficulty(saved.difficulty),
          speedOn: normalizeSpeedRound(saved.speedOn),
          streakDays: normalizeStreakCount(saved.streakDays),
          bestStreakDays: normalizeStreakCount(saved.bestStreakDays),
          lastPlayedDay: normalizeDayKey(saved.lastPlayedDay),
    };
    if (
      saved.midCountdown
      && saved.midCountdown.phase === COUNTING
      && Array.isArray(saved.midCountdown.counted)
    ) {
      this.resumeMidRound(saved.midCountdown, { silent: true });
    } else {
      this.startRound(this.state.round, { silent: true });
    }
    return this.state;
  }

  // Restore an exact mid-round board from a snapshot. Everything that
  // defines the board travels together: the round's seed, the counted
  // list in tap order, when each tap happened on the renderer clock, the
  // clock position itself, and the Speed Round countdown. A snapshot that
  // disagrees with the round it claims (a mangled save) is dropped.
  resumeMidRound(snapshot, { silent } = {}) {
    if (!snapshot || snapshot.phase !== COUNTING) return this.state;
    const round = normalizeRound(snapshot.round);
    const difficulty = normalizeDifficulty(snapshot.difficulty);
    const sheepCount = sheepForRound(round, difficulty);
    const counted = Array.isArray(snapshot.counted)
      ? snapshot.counted.filter((i) => Number.isInteger(i) && i >= 0 && i < sheepCount)
      : [];
    // Deduplicate while keeping tap order: a save can never carry the
    // same sheep twice, but a corrupt one should not be able to either.
    const seen = new Set();
    const uniqueCounted = counted.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
    const rawAt = Array.isArray(snapshot.countedAt) ? snapshot.countedAt : [];
    const countedAt = uniqueCounted.map((index, order) => {
      const at = rawAt[order];
      return {
        index,
        elapsed: Number.isFinite(Number(at && at.elapsed)) && Number(at.elapsed) >= 0
          ? Number(at.elapsed)
          : 0,
      };
    });
    const secondsLeft = snapshot.speedOn
      ? Math.max(0, Math.min(SPEED_ROUND_SECONDS, Math.floor(Number(snapshot.secondsLeft))))
      : null;
    if (secondsLeft === 0) {
      // The clock had already run out: the snapshot is a finished round.
      // The run keeps its mode and level; the round itself starts fresh.
      this.state = { ...this.state, difficulty, speedOn: !!snapshot.speedOn };
      return this.startRound(round, { silent });
    }
    const seed = Number.isFinite(Number(snapshot.seed)) && Number(snapshot.seed) >= 0
      ? Number(snapshot.seed)
      : this.seedFor(round);
    this.state = {
      ...this.state,
      round,
      difficulty,
      sheepCount,
      seed,
      // Re-derived from the same round/seed/sheepCount, exactly like
      // startRound: the wolf draw is a pure function of these, so a
      // resumed board always shows the same animal that was hiding.
      wolfIndex: wolfIndexForRound(round, seed, sheepCount),
      count: uniqueCounted.length,
      counted: uniqueCounted,
      countedAt,
      roundElapsed: Number.isFinite(Number(snapshot.roundElapsed)) && Number(snapshot.roundElapsed) >= 0
        ? Number(snapshot.roundElapsed)
        : 0,
      phase: COUNTING,
      endedBy: null,
      speedOn: !!snapshot.speedOn,
      secondsLeft,
    };
    this._hasMidRoundSnapshot = true;
    // Resuming a board is playing: the streak records the day too.
    this.recordPlayDay();
    return this.state;
    return this.state;
  }

  // The exact board, written under its own key the moment anything on it
  // changes. Reads it back through loadLocal on the next visit.
  saveMidRound() {
    if (this.ephemeral) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      const meta = raw ? JSON.parse(raw) : {};
      meta.midCountdown = this.snapshotRound();
      localStorage.setItem(this.storageKey, JSON.stringify(meta));
    } catch {
      /* storage full or unavailable; the run still works this session */
    }
  }

  // The restore shape, kept pure so the tests can round-trip it without
  // a browser: everything that defines the exact board on screen.
  snapshotRound() {
    return {
      round: this.state.round,
      difficulty: this.state.difficulty,
      sheepCount: this.state.sheepCount,
      seed: this.state.seed,
      counted: this.state.counted,
      countedAt: this.state.countedAt,
      roundElapsed: this.state.roundElapsed,
      phase: this.state.phase,
      speedOn: this.state.speedOn,
      secondsLeft: this.state.secondsLeft,
    };
  }

  // The round is no longer resumable (it was passed or lost): drop the
  // snapshot so the next visit never shows a half-counted board from a
  // finished round.
  clearMidRound() {
    this._hasMidRoundSnapshot = false;
    if (this.ephemeral) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      const meta = raw ? JSON.parse(raw) : {};
          delete meta.midCountdown;
      localStorage.setItem(this.storageKey, JSON.stringify(meta));
    } catch {
      /* storage unavailable; the run still works this session */
    }
  }

  // Fold this round start into the play streak, in the player's local
  // timezone. The streak lives in localStorage under the same per-user key
  // as the rest of the run-spanning state, so it survives reloads like the
  // best rounds do. It never syncs to the server: the flame chip reads
  // exactly what the store keeps. `dayKey` is a test seam, so the suite
  // can step across days without faking a clock.
  recordPlayDay(dayKey = localDayKey()) {
    if (this.ephemeral) return;
    const today = normalizeDayKey(dayKey);
    if (!today) return;
    const { days, best, changed } = advanceStreak(
      this.state.streakDays,
      this.state.bestStreakDays,
      this.state.lastPlayedDay,
      today,
    );
    if (!changed) return;
    this.state = {
      ...this.state,
      streakDays: days,
      bestStreakDays: best,
      lastPlayedDay: today,
    };
    // Persist immediately: the advance must survive even if the session
    // ends before any other save, or the same visit would count twice.
    this.saveLocal();
  }

  // Elapsed animation time for the current round: the live renderer clock
  // when one is attached, otherwise the last persisted value. The max()
  // keeps tap stamps monotonic within a round.
  currentElapsed() {
    return this.roundClock
      ? Math.max(this.state.roundElapsed || 0, this.roundClock())
      : (this.state.roundElapsed || 0);
  }

  // Switching difficulty starts that level's run at round 1. Every other
  // level's best round is untouched, and lifetime taps keep accumulating
  // across the switch.
  setDifficulty(level) {
    const difficulty = normalizeDifficulty(level);
    if (difficulty === this.state.difficulty) return this.state;
    // The old level's board must not resurrect under the new one.
    this.clearMidRound();
    this.state = {
      ...this.state,
      difficulty,
      speedOn: false,
      secondsLeft: null,
    };
    this.state = this.startRound(1, { silent: true });
    this.saveLocal();
    this.flush();
    this.onChange(this.state);
    return this.state;
  }

  // Record a finished run for the weekly leaderboard. Runs are short and
  // a run end can be the last thing the session ever syncs (page closed
  // on the game-over card), so this posts immediately, not through the
  // debounced flush. Best effort: a failed post never blocks play.
  // The run id is remembered for Share result, and the reason is stored
  // with the run so a shared card shows the same line the player saw.
  recordRun() {
    // The test seam answers even for an ephemeral deep-link store: the
    // unit suite runs with no token, like the fixtures do.
    if (this.onRecordRun) {
      if (this.runRecorded) return;
      this.runRecorded = true;
      this.onRecordRun(this.state.round);
      return;
    }
    if (this.ephemeral || !this.token || this.runRecorded) return;
    this.runRecorded = true;
    try {
      fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usernode-token': this.token },
        keepalive: true,
        body: JSON.stringify({
          roundReached: this.state.round,
          endedBy: this.state.endedBy,
          speedRound: this.state.speedOn,
        }),
      }).then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.id) this.lastRunId = data.id;
        })
        .catch(() => {});
    } catch {
      /* best effort */
    }
  }

  // A tap on a sheep. Returns what it did:
  //   { outcome: 'counted', number }  a new sheep, numbered in tap order
  //   { outcome: 'doubleTap' }        already counted, so the run ends
  //   { outcome: 'wolfTap' }          the wolf: the run ends immediately
  //   { outcome: 'ignored' }          the run is not accepting taps
  tapSheep(index) {
    if (this.state.phase !== COUNTING) return { outcome: 'ignored' };
    if (!Number.isInteger(index) || index < 0 || index >= this.state.sheepCount) {
      return { outcome: 'ignored' };
    }
    if (this.state.counted.includes(index)) {
      this.endRun(ENDED_DOUBLE_TAP);
      return { outcome: 'doubleTap' };
    }
    if (this.state.wolfIndex != null && index === this.state.wolfIndex) {
      // The wolf tap counts nothing anywhere: no tap, no sheep, no bonus.
      // The run just ends, like any other run-ending mistake.
      this.endRun(ENDED_WOLF);
      return { outcome: 'wolfTap' };
    }
    const counted = [...this.state.counted, index];
    this.unsyncedTaps += 1;
    // Stamp the tap with the round's animation clock, so a resumed board
    // can show the counted ribbon exactly where the tap left it.
    const elapsed = this.currentElapsed();
    const countedAt = [...this.state.countedAt, { index, elapsed }];
    this.state = {
      ...this.state,
      counted,
      count: counted.length,
      countedAt,
      roundElapsed: elapsed,
      totalCounted: this.state.totalCounted + 1,
    };
    // One storage pass per tap: the run values and the mid-round snapshot
    // share the same key, so they are read once, merged and written back
    // together instead of saveLocal and saveMidRound each doing their own
    // read/parse/write. Same payload shape, same contents.
    if (!this.ephemeral) {
      try {
        const raw = localStorage.getItem(this.storageKey);
        const meta = raw ? JSON.parse(raw) : {};
        localStorage.setItem(this.storageKey, JSON.stringify({
          ...meta,
          round: this.state.round,
          difficulty: this.state.difficulty,
          bestRounds: this.state.bestRounds,
          bestSafeStreak: this.state.bestSafeStreak,
          bonusCounted: this.state.bonusCounted,
          totalCounted: this.state.totalCounted,
          soundOn: this.state.soundOn,
          nightOn: this.state.nightOn,
          calmOn: this.state.calmOn,
          namesOn: this.state.namesOn,
          speedOn: this.state.speedOn,
          streakDays: this.state.streakDays,
          bestStreakDays: this.state.bestStreakDays,
          lastPlayedDay: this.state.lastPlayedDay,
          midCountdown: this.snapshotRound(),
        }));
      } catch {
        /* storage full or unavailable; the run still works this session */
      }
    }
    this.scheduleSync();
    this.onChange(this.state);
    return { outcome: 'counted', number: counted.length };
  }

  isComplete() {
    // A round that hides a wolf auto-passes once every real sheep is
    // counted; the impostor is the one animal left uncounted.
    const wolves = this.state.wolfIndex != null ? 1 : 0;
    return this.state.count >= this.state.sheepCount - wolves;
  }

  // The player says that is all of them. Right count passes the round;
  // anything short ends the run.
  submitCount() {
    if (this.state.phase !== COUNTING) return { outcome: 'ignored' };
    if (this.isComplete()) {
      let { safeStreak, bestSafeStreak } = this.state;
      if (this.state.wolfIndex != null) {
        // Dodged: the streak grows, the best streak is kept forever, and
        // two bonus sheep join the lifetime count.
        safeStreak += 1;
        bestSafeStreak = Math.max(bestSafeStreak, safeStreak);
        this.unsyncedBonus += WOLF_BONUS;
      }
      this.state = {
        ...this.state,
        phase: ROUND_PASSED,
        safeStreak,
        bestSafeStreak,
        bonusCounted: this.state.bonusCounted + (this.state.wolfIndex != null ? WOLF_BONUS : 0),
        totalCounted: this.state.totalCounted + (this.state.wolfIndex != null ? WOLF_BONUS : 0),
      };
      this.saveLocal();
      // A passed round is over; resuming into it would show a board with
      // nothing left to tap. The next visit starts the round fresh,
      // exactly like leaving between rounds always has.
      this.clearMidRound();
      this.flush();
      this.onChange(this.state);
      return { outcome: 'passed', round: this.state.round };
    }
    this.endRun(ENDED_MISSED);
    return { outcome: 'missed', round: this.state.round };
  }

  endRun(reason) {
    this.state = { ...this.state, phase: RUN_OVER, endedBy: reason };
    this.recordRun();
    this.saveLocal();
    // The round is over: a stale snapshot must never resurrect it.
    this.clearMidRound();
    this.flush();
    this.onChange(this.state);
    return this.state;
  }

  nextRound() {
    return this.startRound(this.state.round + 1);
  }

  // After a run ends: back to round 1 with a fresh flock. bestRounds are
  // kept, so the grown-ups panel still shows how far the player got. The
  // Speed Round mode is a per-run choice, so it resets with the run and
  // the briefing card asks again.
  restartRun() {
    this.state = { ...this.state, speedOn: false, secondsLeft: null };
    const state = this.startRound(1);
    return state;
  }

  // One clock step for a Speed Round: every whole second the store's
  // onChange fires and all surfaces (count pill, DOM fallback, a11y list)
  // read the same secondsLeft. Returns false on the step that hits zero;
  // app.js owns what that does.
  tickClock() {
    if (this.state.phase !== COUNTING || !this.state.speedOn) return true;
    const left = Math.max(0, (this.state.secondsLeft ?? SPEED_ROUND_SECONDS) - 1);
    this.state = { ...this.state, secondsLeft: left };
    this.onChange(this.state);
    return left > 0;
  }

  // Speed Round toggle for the briefing card. Applies to the round that
  // is about to start; it never flips mid-round (the briefing is modal,
  // so this runs before Start counting in real play).
  setSpeedOn(on) {
    const speedOn = normalizeSpeedRound(on);
    this.state = { ...this.state, speedOn, secondsLeft: speedOn ? SPEED_ROUND_SECONDS : null };
    this.saveLocal();
    // The briefing's toggle is part of the resumable board too.
    this.saveMidRound();
    this.scheduleSync();
    this.onChange(this.state);
  }

  setSoundOn(on) {
    this.state = { ...this.state, soundOn: !!on };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
  }

  setNightOn(on) {
    this.state = { ...this.state, nightOn: !!on };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
  }

  // Calm mode is a comfort setting, not a per-run mode: it survives
  // restarts and rounds, like sound and Night Meadow.
  setCalmOn(on) {
    const calmOn = normalizeCalm(on);
    this.state = { ...this.state, calmOn };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
  }

  // The name-labels toggle is purely cosmetic, so it never rides the
  // server sync: a deep link or a screenshot run cannot flip it for a
  // real player, and it stays whatever the device last chose.
  setNamesOn(on) {
    this.state = { ...this.state, namesOn: !!on };
    this.saveLocal();
    this.onChange(this.state);
  }
}

export { MAX_SHEEP, sheepForRound };

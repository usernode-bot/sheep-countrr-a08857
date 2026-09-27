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
  normalizeDifficulty,
  normalizeRound,
  normalizeSpeedRound,
  roundSeed,
  sheepForRound,
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
export const ENDED_TIME_UP = 'timeUp';

// One best round per difficulty, kept in a map so a best on Easy can never
// masquerade as one on Hard.
export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard', 'expert'];

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
    bestRounds: { easy: 1, normal: 1, hard: 1, expert: 1 },
    totalCounted: 0,
    communityTotal: 0,
    soundOn: false,
    nightOn: false,
    difficulty: DEFAULT_DIFFICULTY,
    speedOn: false,
    secondsLeft: null,
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
        totalCounted: Math.max(0, Number(saved.totalCounted) || 0),
        soundOn: !!saved.soundOn,
        nightOn: !!saved.nightOn,
        difficulty: normalizeDifficulty(saved.difficulty),
        speedOn: normalizeSpeedRound(saved.speedOn),
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
        totalCounted: this.state.totalCounted,
        soundOn: this.state.soundOn,
        nightOn: this.state.nightOn,
        speedOn: this.state.speedOn,
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
        totalCounted: Math.max(0, Number(data.totalCounted) || 0),
        communityTotal: Math.max(0, Number(data.communityTotal) || 0),
        soundOn: !!data.soundOn,
        nightOn: !!data.nightOn,
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
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usernode-token': this.token },
        keepalive: true,
        body: JSON.stringify({
          round: this.state.round,
          difficulty: this.state.difficulty,
          bestRound: this.bestRound,
          newTaps: taps,
          soundOn: this.state.soundOn,
          nightOn: this.state.nightOn,
        }),
      });
    } catch {
      /* best effort; the next change reschedules a sync */
    }
  }

  // Start (or restart) a round: fresh flock, nothing counted, run alive.
  startRound(round, { silent, keepBoard } = {}) {
    const next = normalizeRound(round);
    const bestRound = Math.max(this.state.bestRounds[this.state.difficulty] || 1, next);
    this.state = {
      ...this.state,
      round: next,
      // keepBoard: a server sync just came back and the locally restored
      // board is newer than anything the server has; keep its flock and
      // its exact seed, not a freshly scattered one.
      sheepCount: keepBoard ? this.state.sheepCount : sheepForRound(next, this.state.difficulty),
      seed: keepBoard ? this.state.seed : this.seedFor(next),
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
          difficulty: normalizeDifficulty(saved.difficulty),
          speedOn: normalizeSpeedRound(saved.speedOn),
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
    this.state = {
      ...this.state,
      round,
      difficulty,
      sheepCount,
      seed: Number.isFinite(Number(snapshot.seed)) && Number(snapshot.seed) >= 0
        ? Number(snapshot.seed)
        : this.seedFor(round),
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
    this.saveLocal();
    this.saveMidRound();
    this.scheduleSync();
    this.onChange(this.state);
    return { outcome: 'counted', number: counted.length };
  }

  isComplete() {
    return this.state.count >= this.state.sheepCount;
  }

  // The player says that is all of them. Right count passes the round;
  // anything short ends the run.
  submitCount() {
    if (this.state.phase !== COUNTING) return { outcome: 'ignored' };
    if (this.isComplete()) {
      this.state = { ...this.state, phase: ROUND_PASSED };
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
}

export { MAX_SHEEP, sheepForRound };

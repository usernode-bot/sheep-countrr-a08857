// Shared client state for a run of Sheep countrr: which round is being
// played, which sheep have been tapped, and whether the run is still
// alive. Both renderers read this same shape, so the 3D scene and the DOM
// fallback can never drift apart.
//
// A run is a sequence of rounds. Tap every sheep in the round and the
// round is passed; miss one and submit, or tap a sheep you already
// counted, and the run ends.

import { MAX_SHEEP, normalizeRound, roundSeed, sheepForRound } from './rounds.js';

const STORAGE_PREFIX = 'sheep-countrr:';
const SYNC_DEBOUNCE_MS = 1500;

// Run phases.
export const COUNTING = 'counting';
export const ROUND_PASSED = 'roundPassed';
export const RUN_OVER = 'runOver';

// Why a run ended, for the game-over copy.
export const ENDED_DOUBLE_TAP = 'doubleTap';
export const ENDED_MISSED = 'missed';

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
    runRecorded: false,
    bestRound: 1,
    totalCounted: 0,
    communityTotal: 0,
    soundOn: false,
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
    // Test seam: called with the round reached instead of POSTing, so the
    // guard can be asserted without a network. Real play leaves it unset
    // and records through /api/runs.
    this.onRecordRun = onRecordRun || null;
  }

  get storageKey() {
    return STORAGE_PREFIX + this.userId;
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
        bestRound: normalizeRound(saved.bestRound || saved.round),
        totalCounted: Math.max(0, Number(saved.totalCounted) || 0),
        soundOn: !!saved.soundOn,
      };
      this.startRound(this.state.round, { silent: true });
    } catch {
      /* ignore corrupt or unavailable storage */
    }
    return this.state;
  }

  saveLocal() {
    if (this.ephemeral) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        round: this.state.round,
        bestRound: this.state.bestRound,
        totalCounted: this.state.totalCounted,
        soundOn: this.state.soundOn,
      }));
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
      this.state = {
        ...this.state,
        round: normalizeRound(data.round),
        bestRound: normalizeRound(data.bestRound),
        totalCounted: Math.max(0, Number(data.totalCounted) || 0),
        communityTotal: Math.max(0, Number(data.communityTotal) || 0),
        soundOn: !!data.soundOn,
      };
      this.startRound(this.state.round, { silent: true });
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
          bestRound: this.state.bestRound,
          newTaps: taps,
          soundOn: this.state.soundOn,
        }),
      });
    } catch {
      /* best effort; the next change reschedules a sync */
    }
  }

  // Start (or restart) a round: fresh flock, nothing counted, run alive.
  startRound(round, { silent } = {}) {
    const next = normalizeRound(round);
    this.state = {
      ...this.state,
      round: next,
      sheepCount: sheepForRound(next),
      seed: this.seedFor(next),
      count: 0,
      counted: [],
      phase: COUNTING,
      endedBy: null,
      runRecorded: false,
      bestRound: Math.max(this.state.bestRound, next),
    };
    this.runRecorded = false;
    if (!silent) {
      this.saveLocal();
      this.flush();
      this.onChange(this.state);
    }
    return this.state;
  }

  // Record a finished run for the weekly leaderboard. Runs are short and
  // a run end can be the last thing the session ever syncs (page closed
  // on the game-over card), so this posts immediately, not through the
  // debounced flush. Best effort: a failed post never blocks play.
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
        body: JSON.stringify({ roundReached: this.state.round }),
      }).catch(() => {});
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
    this.state = {
      ...this.state,
      counted,
      count: counted.length,
      totalCounted: this.state.totalCounted + 1,
    };
    this.saveLocal();
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
    this.flush();
    this.onChange(this.state);
    return this.state;
  }

  nextRound() {
    return this.startRound(this.state.round + 1);
  }

  // After a run ends: back to round 1 with a fresh flock. bestRound is
  // kept, so the grown-ups panel still shows how far the player got.
  restartRun() {
    const state = this.startRound(1);
    return state;
  }

  setSoundOn(on) {
    this.state = { ...this.state, soundOn: !!on };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
  }
}

export { MAX_SHEEP, sheepForRound };

// Shared client state for a counting round: local persistence plus a
// debounced sync to /api/state. Both renderers read this same shape so
// the 3D scene and the DOM fallback can never drift apart.

const STORAGE_PREFIX = 'sheep-countrr:';
const HERD_MIN = 1;
const HERD_MAX = 10;
const SYNC_DEBOUNCE_MS = 1500;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function createDefaultState() {
  return {
    round: 1,
    herdSize: 5,
    seed: randomSeed(),
    count: 0,
    counted: [],
    best: 0,
    totalCounted: 0,
    communityTotal: 0,
    soundOn: false,
  };
}

export class StateStore {
  constructor({ userId, token, onChange, staticMode }) {
    this.userId = userId || 'anon';
    this.token = token || '';
    this.onChange = onChange || (() => {});
    // Deep-link screenshot states (?scene=...) are pure UI fixtures: they
    // must never read or write localStorage or the server.
    this.staticMode = !!staticMode;
    this.state = createDefaultState();
    this._syncTimer = null;
  }

  get storageKey() {
    return STORAGE_PREFIX + this.userId;
  }

  loadLocal() {
    if (this.staticMode) return this.state;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    return this.state;
  }

  saveLocal() {
    if (this.staticMode) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* storage full or unavailable — round still works this session */
    }
  }

  async loadRemote() {
    if (this.staticMode || !this.token) return this.state;
    try {
      const res = await fetch('/api/state', { headers: { 'x-usernode-token': this.token } });
      if (!res.ok) return this.state;
      const data = await res.json();
      this.state = {
        round: data.round,
        herdSize: data.herdSize,
        seed: data.seed,
        count: data.count,
        counted: data.counted || [],
        best: data.best,
        totalCounted: data.totalCounted,
        communityTotal: data.communityTotal,
        soundOn: !!data.soundOn,
      };
      this.saveLocal();
    } catch {
      /* offline or no server — keep whatever localStorage had */
    }
    return this.state;
  }

  scheduleSync() {
    if (this.staticMode || !this.token) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.flush(), SYNC_DEBOUNCE_MS);
  }

  async flush() {
    if (this.staticMode || !this.token) return;
    clearTimeout(this._syncTimer);
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usernode-token': this.token },
        keepalive: true,
        body: JSON.stringify({
          round: this.state.round,
          herdSize: this.state.herdSize,
          seed: this.state.seed,
          count: this.state.count,
          counted: this.state.counted,
          soundOn: this.state.soundOn,
        }),
      });
    } catch {
      /* best-effort — next change reschedules a sync */
    }
  }

  // Returns the 1-based number assigned to this tap, or null if the
  // sheep was already counted / the flock is already complete.
  countSheep(index) {
    if (this.state.counted.includes(index)) return null;
    if (this.state.counted.length >= this.state.herdSize) return null;
    const counted = [...this.state.counted, index].sort((a, b) => a - b);
    this.state = {
      ...this.state,
      counted,
      count: counted.length,
      best: Math.max(this.state.best, counted.length),
      totalCounted: this.state.totalCounted + 1,
    };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
    return counted.length;
  }

  isComplete() {
    return this.state.count >= this.state.herdSize;
  }

  // "Count again": a fresh scatter, one sheep more (up to the max) so the
  // game grows gently with the child.
  startNewRound({ carryHerdGrowth } = {}) {
    const nextHerd = carryHerdGrowth
      ? clamp(this.state.herdSize + 1, HERD_MIN, HERD_MAX)
      : this.state.herdSize;
    this.state = {
      ...this.state,
      round: this.state.round + 1,
      herdSize: nextHerd,
      seed: randomSeed(),
      count: 0,
      counted: [],
    };
    this.saveLocal();
    this.flush();
    this.onChange(this.state);
  }

  // Grown-up picked a specific herd size from the panel.
  setHerdSize(n) {
    const herdSize = clamp(n, HERD_MIN, HERD_MAX);
    this.state = {
      ...this.state,
      round: this.state.round + 1,
      herdSize,
      seed: randomSeed(),
      count: 0,
      counted: [],
    };
    this.saveLocal();
    this.flush();
    this.onChange(this.state);
  }

  // "Start over": same herd size, fresh scatter.
  resetRound() {
    this.state = { ...this.state, seed: randomSeed(), count: 0, counted: [] };
    this.saveLocal();
    this.flush();
    this.onChange(this.state);
  }

  setSoundOn(on) {
    this.state = { ...this.state, soundOn: !!on };
    this.saveLocal();
    this.scheduleSync();
    this.onChange(this.state);
  }
}

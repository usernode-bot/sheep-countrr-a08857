const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// The platform's address, injected by the platform at deploy (#2047). Never
// written out here: a hardcoded hostname is what broke this app when the
// platform moved domains. Empty only outside the platform (local runs).
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '').replace(/\/+$/, '');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);
// The platform's bridge script is injected into the shell on every app and
// is centrally served from the app's own hostname. Staging's edge answers
// it before this container sees the request; a plain local boot (the
// in-loop browser, the repo's own run-checks harness) reaches Express
// directly, where the script must be open or the page logs a 401 for a
// resource the app itself did not fetch.
const PUBLIC_PREFIXES = ['/usernode-bridge/'];
// `next()` through the gate above only skips authentication; something
// must actually answer the request, so the bridge path is mounted right
// after the gate. Staging's edge serves the real centrally-hosted script;
// locally this answers 204 instead of leaking a 401 into every check and
// screenshot. Do not copy the bridge into this repo.
app.use('/usernode-bridge', (_req, res) => {
  res.status(204).type('application/javascript').end();
});

// The highest round a client may report, and the most sheep one sync can
// claim to have tapped. The per-round sheep count lives in
// public/rounds.js (sheepForRound); MAX_TAPS_PER_SYNC only has to be at
// least as large as its cap, since it exists to bound how much a single
// request can add to the shared community total.
const MAX_ROUND = 999;
const MAX_TAPS_PER_SYNC = 12;

app.use(express.json());

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

let shuttingDown = false;

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  res.json({ status: 'ok' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// three.js is served straight out of node_modules — no CDN, no vendored
// copy in git. Mount the whole build/ dir (not just three.module.js) since
// it imports three.core.js by relative path.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// Current progress for the signed-in child, plus how many sheep everyone
// else has ever counted (the "community total" line in the grown-ups
// panel). Creates a fresh row on first visit.
//
// Only run-spanning values travel: which round to start on, the best round
// reached, lifetime taps and the sound setting. A half-counted round is
// deliberately not stored, because resuming into taps you do not remember
// making would end the run on the next tap.
app.get('/api/state', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT round, best_round, total_counted, sound_on
       FROM sheep_progress WHERE user_id = $1`,
      [req.user.id]
    );

    let row = rows[0];
    if (!row) {
      await pool.query(
        `INSERT INTO sheep_progress (user_id, username, round, best_round, seed)
         VALUES ($1, $2, 1, 1, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [req.user.id, req.user.username, randomSeed()]
      );
      row = { round: 1, best_round: 1, total_counted: 0, sound_on: false };
    }

    const { rows: totalRows } = await pool.query(
      `SELECT COALESCE(SUM(total_counted), 0) AS sum FROM sheep_progress WHERE user_id != $1`,
      [req.user.id]
    );
    const communityTotal = parseInt(totalRows[0].sum, 10) + row.total_counted;

    res.json({
      round: row.round,
      bestRound: row.best_round,
      totalCounted: row.total_counted,
      soundOn: row.sound_on,
      communityTotal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upserts the caller's own row. Every value is clamped/validated
// server-side so a broken or hostile client can't corrupt state or
// inflate the community total; ownership always comes from req.user,
// never from the request body.
app.post('/api/state', async (req, res) => {
  const body = req.body || {};

  const round = clamp(parseInt(body.round, 10) || 1, 1, MAX_ROUND);
  const claimedBest = clamp(parseInt(body.bestRound, 10) || round, 1, MAX_ROUND);
  // Taps are reported as a delta since the last sync, and bounded, so no
  // single request can inflate the shared community total.
  const newTaps = clamp(parseInt(body.newTaps, 10) || 0, 0, MAX_TAPS_PER_SYNC);
  const soundOn = !!body.soundOn;

  try {
    const { rows } = await pool.query(
      `SELECT best_round, total_counted FROM sheep_progress WHERE user_id = $1`,
      [req.user.id]
    );
    const prev = rows[0];

    // A run restarts at round 1, so the round may move backward freely;
    // only the best round ever reached is monotonic.
    const bestRound = Math.max(prev ? prev.best_round : 1, claimedBest, round);
    const totalCounted = (prev ? prev.total_counted : 0) + newTaps;

    await pool.query(
      `INSERT INTO sheep_progress
         (user_id, username, round, best_round, total_counted, sound_on, seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         round = EXCLUDED.round,
         best_round = EXCLUDED.best_round,
         total_counted = EXCLUDED.total_counted,
         sound_on = EXCLUDED.sound_on,
         updated_at = NOW()`,
      [req.user.id, req.user.username, round, bestRound, totalCounted, soundOn, randomSeed()]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// express.static's default `index` option would otherwise auto-serve
// index.html for `/` (and a direct `/index.html` request) before the
// auth-gated catch-all below ever runs, silently defeating that gate.
// Route both paths past static so the catch-all is the only place the
// shell is served from.
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') return next();
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Usernode" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
//
// The screenshot-state deep links are the one exception: `?scene=`
// fixtures render hardcoded demo data, and `?round=N` starts a playable
// run from a fixed seed. Both branches in app.js are ephemeral, so they
// never touch localStorage or the server and carry nothing worth gating.
// They stay reachable with no token so the platform's checks/screenshots
// (and this repo's own usernode-run-checks) can navigate straight to them,
// since neither can mint a real platform-signed token.
app.get('*', (req, res) => {
  if (!req.user && !req.query.scene && !req.query.round) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, (PLATFORM_ORIGIN + '/app/sheep-countrr-a08857/full') + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Usernode</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Usernode</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/sheep-countrr-a08857/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Usernode</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Staging-only demo rows so the community total and grown-ups panel don't
// read empty in a fresh preview. Negative ids can never collide with a
// real platform user id, and the visiting user's own row is never
// touched here — that row is what "restore where the child left off"
// reads, so seeding it would make every staging visitor look mid-round
// while production stayed empty.
async function seedStagingData() {
  const demoRows = [
    { user_id: -101, username: 'Staging demo: Mabel', round: 4, best_round: 9, total_counted: 23 },
    { user_id: -102, username: 'Staging demo: Otto', round: 2, best_round: 6, total_counted: 11 },
    { user_id: -103, username: 'Staging demo: Pip', round: 1, best_round: 3, total_counted: 5 },
  ];
  for (const r of demoRows) {
    await pool.query(
      `INSERT INTO sheep_progress
         (user_id, username, round, best_round, total_counted, sound_on, seed)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       ON CONFLICT (user_id) DO NOTHING`,
      [r.user_id, r.username, r.round, r.best_round, r.total_counted, 1000 - r.user_id]
    );
  }
}

async function start() {
  // Public table: holds a public username and round counters — nothing a
  // stranger seeing every row would care about — and the community total
  // needs real rows in staging, so it stays unmarked (no
  // `staging:private` comment) and copies normally.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheep_progress (
      user_id INTEGER PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      herd_size INTEGER NOT NULL DEFAULT 5,
      seed BIGINT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      counted JSONB NOT NULL DEFAULT '[]',
      best INTEGER NOT NULL DEFAULT 0,
      total_counted INTEGER NOT NULL DEFAULT 0,
      sound_on BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Round-based play: the furthest round a run has ever reached. The older
  // per-count columns stay for rows written before rounds existed; nothing
  // reads them now, so they simply keep their defaults.
  await pool.query(`ALTER TABLE sheep_progress ADD COLUMN IF NOT EXISTS best_round INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE sheep_progress ALTER COLUMN seed SET DEFAULT 0`);

  if (IS_STAGING) await seedStagingData();

  const server = app.listen(port, () => console.log(`Listening on :${port}`));

  const DRAIN_MS = 3000;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
    try {
      await pool.end();
    } catch (e) {
      console.error('[shutdown] pool.end failed', e.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });

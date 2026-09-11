const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

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

const HERD_MIN = 1;
const HERD_MAX = 10;

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

function defaultRow(user) {
  return {
    user_id: user.id,
    username: user.username,
    round: 1,
    herd_size: 3,
    seed: randomSeed(),
    count: 0,
    counted: [],
    best: 0,
    total_counted: 0,
    sound_on: false,
  };
}

// Current progress for the signed-in child, plus how many sheep everyone
// else has ever counted (the "community total" line in the grown-ups
// panel). Creates a fresh row with a random seed on first visit.
app.get('/api/state', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT round, herd_size, seed, count, counted, best, total_counted, sound_on
       FROM sheep_progress WHERE user_id = $1`,
      [req.user.id]
    );

    let row = rows[0];
    if (!row) {
      const fresh = defaultRow(req.user);
      await pool.query(
        `INSERT INTO sheep_progress
           (user_id, username, round, herd_size, seed, count, counted, best, total_counted, sound_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id) DO NOTHING`,
        [fresh.user_id, fresh.username, fresh.round, fresh.herd_size, fresh.seed,
         fresh.count, JSON.stringify(fresh.counted), fresh.best, fresh.total_counted, fresh.sound_on]
      );
      row = {
        round: fresh.round, herd_size: fresh.herd_size, seed: fresh.seed, count: fresh.count,
        counted: fresh.counted, best: fresh.best, total_counted: fresh.total_counted, sound_on: fresh.sound_on,
      };
    }

    const { rows: totalRows } = await pool.query(
      `SELECT COALESCE(SUM(total_counted), 0) AS sum FROM sheep_progress WHERE user_id != $1`,
      [req.user.id]
    );
    const communityTotal = parseInt(totalRows[0].sum, 10) + row.total_counted;

    res.json({
      round: row.round,
      herdSize: row.herd_size,
      seed: Number(row.seed),
      count: row.count,
      counted: row.counted,
      best: row.best,
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

  const herdSize = clamp(parseInt(body.herdSize, 10), HERD_MIN, HERD_MAX);
  if (!Number.isFinite(herdSize)) return res.status(400).json({ error: 'herdSize must be a number' });

  if (!Array.isArray(body.counted)) return res.status(400).json({ error: 'counted must be an array' });
  const counted = [...new Set(body.counted.map((n) => parseInt(n, 10)))]
    .filter((n) => Number.isInteger(n) && n >= 0 && n < herdSize);

  const count = clamp(parseInt(body.count, 10), 0, herdSize);
  if (!Number.isFinite(count) || count !== counted.length) {
    return res.status(400).json({ error: 'count must equal counted.length' });
  }

  const round = Math.max(1, parseInt(body.round, 10) || 1);
  const seed = Number.isFinite(Number(body.seed)) ? Math.trunc(Number(body.seed)) : randomSeed();
  const soundOn = !!body.soundOn;

  try {
    const { rows } = await pool.query(
      `SELECT round, herd_size, best, total_counted FROM sheep_progress WHERE user_id = $1`,
      [req.user.id]
    );
    const prev = rows[0];

    if (prev && round < prev.round) {
      return res.status(400).json({ error: 'round cannot move backward' });
    }

    const best = Math.max(prev ? prev.best : 0, count);
    // A client can only ever add up to herdSize new sheep per sync — this
    // caps how much any single request can inflate the shared total,
    // regardless of what the client claims.
    const totalCounted = (prev ? prev.total_counted : 0) + Math.min(count, herdSize);

    await pool.query(
      `INSERT INTO sheep_progress
         (user_id, username, round, herd_size, seed, count, counted, best, total_counted, sound_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         round = EXCLUDED.round,
         herd_size = EXCLUDED.herd_size,
         seed = EXCLUDED.seed,
         count = EXCLUDED.count,
         counted = EXCLUDED.counted,
         best = EXCLUDED.best,
         total_counted = EXCLUDED.total_counted,
         sound_on = EXCLUDED.sound_on,
         updated_at = NOW()`,
      [req.user.id, req.user.username, round, herdSize, seed, count,
       JSON.stringify(counted), best, totalCounted, soundOn]
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
// `?scene=` screenshot-state fixtures are the one exception: app.js's
// `staticMode` branch renders only hardcoded demo data and never touches
// localStorage or the server, so they carry nothing worth gating. They
// stay reachable with no token so the platform's checks/screenshots (and
// this repo's own usernode-run-checks) can navigate straight to them —
// neither can mint a real platform-signed token.
app.get('*', (req, res) => {
  if (!req.user && !req.query.scene) {
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
      return res.redirect(302, 'https://social-vibecoding.usernodelabs.org/app/sheep-countrr-a08857/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Usernode</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Usernode</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="https://social-vibecoding.usernodelabs.org/app/sheep-countrr-a08857/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Usernode</a>
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
    { user_id: -101, username: 'Staging demo — Mabel', round: 4, herd_size: 8, seed: 1001, count: 8, counted: [0, 1, 2, 3, 4, 5, 6, 7], best: 8, total_counted: 23 },
    { user_id: -102, username: 'Staging demo — Otto', round: 2, herd_size: 6, seed: 1002, count: 2, counted: [0, 1], best: 6, total_counted: 11 },
    { user_id: -103, username: 'Staging demo — Pip', round: 1, herd_size: 3, seed: 1003, count: 0, counted: [], best: 5, total_counted: 5 },
  ];
  for (const r of demoRows) {
    await pool.query(
      `INSERT INTO sheep_progress
         (user_id, username, round, herd_size, seed, count, counted, best, total_counted, sound_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       ON CONFLICT (user_id) DO NOTHING`,
      [r.user_id, r.username, r.round, r.herd_size, r.seed, r.count, JSON.stringify(r.counted), r.best, r.total_counted]
    );
  }
}

async function start() {
  // Public table: holds a public username, a flock size and counters —
  // nothing a stranger seeing every row would care about — and the
  // community total needs real rows in staging, so it stays unmarked
  // (no `staging:private` comment) and copies normally.
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

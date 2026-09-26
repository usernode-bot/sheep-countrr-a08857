const express = require('express');
const https = require('https');
const http = require('http');

// The platform is http inside the cluster and https outside; pick the
// client module the bridge URL's own scheme names.
const bridgeFetch = (url, opts, cb) =>
  (url.startsWith('https:') ? https : http).request(url, opts, cb);
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
// The platform's bridge script is injected into the app shell on every app
// and is centrally served from the app's own hostname — never vendored.
// Normally the platform's edge answers it before this container sees the
// request; a plain boot (the in-loop browser, the repo's own run-checks
// harness, or any environment where the edge isn't in front of the app)
// reaches Express directly, so this app must answer the path itself or the
// shell's required bridge tag fails and the page loads with a 401 on the
// console (or a blank frame when the load is hard enough to break the
// bootstrap). The route stays open, and the script is proxied from the
// platform's canonical copy rather than copied into this repo, so
// fleet-wide bridge fixes keep reaching this app on the next page load.
// The two public share surfaces are deliberately tokenless: a visitor who
// opens /s/<key> or /invite/<code> has no platform token to forward, so the
// data endpoints under these prefixes answer without one. Only GET routes
// are registered under them, so every other method 404s at the router.
const PUBLIC_PREFIXES = ['/usernode-bridge/', '/api/share/', '/api/invite/'];
const BRIDGE_BASE_URL = ((process.env.USERNODE_PLATFORM_ORIGIN || process.env.PLATFORM_URL || '')
  .replace(/\/+$/, '')) + '/usernode-bridge/v1/bridge.js';
app.use('/usernode-bridge', (req, res) => {
  let upstream;
  try {
    upstream = bridgeFetch(BRIDGE_BASE_URL, {
      method: 'GET',
      headers: { 'if-none-match': req.headers['if-none-match'] || '' },
    }, (up) => {
      const out = {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache, must-revalidate',
      };
      for (const h of ['etag', 'last-modified']) {
        if (up.headers[h]) out[h] = up.headers[h];
      }
      res.writeHead(up.statusCode || 502, out);
      if (up.statusCode === 304) return up.resume();
      up.pipe(res);
    });
  } catch {
    return res.status(502).type('text').end('bridge unavailable');
  }
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).type('text').end('bridge unavailable');
    else res.end();
  });
  upstream.end();
});

// The highest round a client may report, and the most sheep one sync can
// claim to have tapped. The per-round sheep count lives in
// public/rounds.js (sheepForRound); MAX_TAPS_PER_SYNC only has to be at
// least as large as its cap, since it exists to bound how much a single
// request can add to the shared community total.
const MAX_ROUND = 999;
const MAX_TAPS_PER_SYNC = 12;

// The difficulty levels the client may report. Anything else falls back to
// 'normal', matching public/rounds.js's normalizeDifficulty.
const DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'expert']);

// URL-safe code shapes. The client copies full URLs, but the key/code itself
// never carries anything else, so a strict charset check is all the input
// validation a public read needs. Too-short and too-long strings fail the
// length bounds; anything else fails the charset.
const SHARE_KEY_RE = /^[A-Za-z0-9_-]{10,32}$/;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{8,16}$/;

function validShareKey(key) {
  return typeof key === 'string' && SHARE_KEY_RE.test(key);
}

function validInviteCode(code) {
  return typeof code === 'string' && INVITE_CODE_RE.test(code);
}

function randomShareKey() {
  return crypto.randomBytes(16).toString('base64url');
}

function randomInviteCode() {
  return crypto.randomBytes(8).toString('base64url');
}

app.use(express.json());

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  // The centrally hosted bridge never exists in a standalone container
  // (the platform edge serves it in front of real deploys). Answer 204 so
  // local in-loop checks and previews don't log a console error for a file
  // no standalone server is expected to carry.
  if (req.path.startsWith('/usernode-bridge/') && !req.user) {
    return res.status(204).end();
  }
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

// Friend handles are public platform usernames. A conservative charset
// keeps junk out of the URL-safe slots without trying to guess the
// platform's own rules; the frontend's directory lookup is what actually
// confirms existence inside the shell.
function normalizeHandle(raw) {
  const trimmed = String(raw || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

// One row per finished run. Identity comes from the verified token, never
// from the body; the round is clamped to the same bound as /api/state.
// The row id is returned so the client can link a share to the run it just
// recorded; the end reason is stored so a shared card shows the same reason
// line the player saw.
app.post('/api/runs', async (req, res) => {
  const roundReached = clamp(parseInt((req.body || {}).roundReached, 10) || 1, 1, MAX_ROUND);
  const endReason = ['doubleTap', 'missed', 'timeUp'].includes((req.body || {}).endedBy)
    ? (req.body || {}).endedBy : null;
  // Speed Rounds carry their own tag so the weekly leaderboard can show
  // them separately from normal rounds.
  const speedRound = !!(req.body || {}).speedRound;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sheep_runs (user_id, username, round_reached, end_reason, speed_round)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.user.id, req.user.username, roundReached, endReason, speedRound]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One share per run, idempotent. Sharing is always the run owner's own
// action: a runId that names someone else's run is indistinguishable from a
// nonexistent one (404), so the API never confirms other users' run ids.
// The URL itself is built client-side from location.origin so it is correct
// in every environment the app runs in.
app.post('/api/shares', async (req, res) => {
  const runId = Number.isInteger((req.body || {}).runId) ? (req.body || {}).runId : null;
  try {
    let run;
    if (runId !== null) {
      const { rows } = await pool.query(
        `SELECT id FROM sheep_runs WHERE id = $1 AND user_id = $2`,
        [runId, req.user.id]
      );
      run = rows[0];
      if (!run) return res.status(404).json({ error: 'No such run' });
    } else {
      const { rows } = await pool.query(
        `SELECT id FROM sheep_runs WHERE user_id = $1 ORDER BY ended_at DESC, id DESC LIMIT 1`,
        [req.user.id]
      );
      run = rows[0];
      if (!run) return res.status(404).json({ error: 'No run to share' });
    }
    await pool.query(
      `INSERT INTO sheep_run_shares (run_id, share_key, created_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO NOTHING`,
      [run.id, randomShareKey(), req.user.id]
    );
    const { rows } = await pool.query(
      `SELECT share_key FROM sheep_run_shares WHERE run_id = $1`,
      [run.id]
    );
    res.json({ key: rows[0].share_key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The public read behind /s/<key>. Only fields the weekly leaderboard
// already publishes for the same rows leave the database, and the key is
// unguessable, so no enumeration is possible.
app.get('/api/share/:key', async (req, res) => {
  if (!validShareKey(req.params.key)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await pool.query(
      `SELECT r.username, r.round_reached AS "roundReached", r.end_reason AS "endedBy",
              r.speed_round AS "speedRound", r.ended_at AS "endedAt"
       FROM sheep_run_shares s
       JOIN sheep_runs r ON r.id = s.run_id
       WHERE s.share_key = $1`,
      [req.params.key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One stable invite code per player. Created on first ask, returned
// unchanged afterwards; codes do not expire and are not consumed on use.
app.post('/api/invites', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO sheep_invites (owner_user_id, invite_code)
       VALUES ($1, $2)
       ON CONFLICT (owner_user_id) DO NOTHING`,
      [req.user.id, randomInviteCode()]
    );
    const { rows } = await pool.query(
      `SELECT invite_code FROM sheep_invites WHERE owner_user_id = $1`,
      [req.user.id]
    );
    res.json({ code: rows[0].invite_code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The public read behind /invite/<code>: the inviter's display name, which
// is already public on the global leaderboard. Nothing else is exposed.
app.get('/api/invite/:code', async (req, res) => {
  if (!validInviteCode(req.params.code)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await pool.query(
      `SELECT p.username FROM sheep_invites i
       LEFT JOIN sheep_progress p ON p.user_id = i.owner_user_id
       WHERE i.invite_code = $1`,
      [req.params.code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ username: rows[0].username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All three tabs in one response. Global reads the monotonic best_round
// from sheep_progress; weekly reads finished runs inside the current ISO
// week (Postgres date_trunc is Monday 00:00 UTC); friends joins the
// caller's own list to progress rows by canonical username. Lists cap at
// 25 rows and re-sort by score after the per-user DISTINCT ON.
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { rows: globalRows } = await pool.query(
      `SELECT user_id, username, best_round AS "bestRound", total_counted AS "totalCounted"
       FROM sheep_progress
       ORDER BY best_round DESC, total_counted DESC, username ASC
       LIMIT 25`
    );

    const { rows: weeklyRows } = await pool.query(
      `SELECT user_id, username, round_reached AS "roundReached", speed_round AS "speedRound"
       FROM (
         SELECT DISTINCT ON (user_id)
                user_id, username, round_reached, speed_round, ended_at
         FROM sheep_runs
         WHERE ended_at >= date_trunc('week', NOW())
         ORDER BY user_id, round_reached DESC, ended_at ASC
       ) per_user
       ORDER BY round_reached DESC, per_user.username ASC
       LIMIT 25`
    );

    const { rows: friendRows } = await pool.query(
      `SELECT f.friend_username AS username,
              p.best_round AS "bestRound"
       FROM sheep_friends f
       LEFT JOIN sheep_progress p ON p.username = f.friend_username
       WHERE f.owner_user_id = $1
       ORDER BY (p.best_round IS NULL), p.best_round DESC, f.friend_username ASC
       LIMIT 25`,
      [req.user.id]
    );

    res.json({
      global: globalRows.map((r) => ({ username: r.username, bestRound: r.bestRound, totalCounted: r.totalCounted })),
      weekly: weeklyRows.map((r) => ({ username: r.username, roundReached: r.roundReached, speedRound: r.speedRound })),
      friends: friendRows.map((r) => ({ username: r.username, bestRound: r.bestRound })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The caller's own friend list.
app.get('/api/friends', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT friend_username AS username, friend_user_id AS "friendUserId"
       FROM sheep_friends WHERE owner_user_id = $1
       ORDER BY friend_username ASC`,
      [req.user.id]
    );
    res.json({ friends: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a handle. friendUserId arrives only when the frontend's bridge lookup
// resolved it (the shell owns the directory); the server never re-verifies
// it and treats an absent id as "added outside the shell". A duplicate or
// a self-add is a quiet no-op.
app.post('/api/friends', async (req, res) => {
  const body = req.body || {};
  const username = normalizeHandle(body.username);
  const friendUserId = Number.isInteger(body.friendUserId) && body.friendUserId > 0
    ? body.friendUserId : null;
  if (!username) return res.status(400).json({ error: 'Invalid handle' });
  if (username === req.user.username) return res.status(400).json({ error: 'That is your own handle' });
  try {
    await pool.query(
      `INSERT INTO sheep_friends (owner_user_id, friend_username, friend_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_user_id, friend_username) DO NOTHING`,
      [req.user.id, username, friendUserId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove. Deletes only the caller's own row, so one user can never edit
// another's list.
app.delete('/api/friends', async (req, res) => {
  const username = normalizeHandle((req.body || {}).username);
  if (!username) return res.status(400).json({ error: 'Invalid handle' });
  try {
    await pool.query(
      `DELETE FROM sheep_friends WHERE owner_user_id = $1 AND friend_username = $2`,
      [req.user.id, username]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// Current progress for the signed-in child, plus how many sheep everyone
// else has ever counted (the "community total" line in the grown-ups
// panel). Creates a fresh row on first visit.
//
// Only run-spanning values travel: which round to start on, the best round
// reached, lifetime taps and the sound + theme settings. A half-counted
// round is
// deliberately not stored, because resuming into taps you do not remember
// making would end the run on the next tap.
app.get('/api/state', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT round, best_round, total_counted, sound_on, night_on, calm_on
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
      row = { round: 1, best_round: 1, total_counted: 0, sound_on: false, night_on: false, calm_on: false, difficulty: 'normal', best_rounds: {} };
    }

    const { rows: totalRows } = await pool.query(
      `SELECT COALESCE(SUM(total_counted), 0) AS sum FROM sheep_progress WHERE user_id != $1`,
      [req.user.id]
    );
    const communityTotal = parseInt(totalRows[0].sum, 10) + row.total_counted;

    // bestRounds holds one best round per difficulty; the legacy best_round
    // column stays the all-time best and still folds in for old clients.
    const bestRounds = { easy: 1, normal: 1, hard: 1, expert: 1, ...(row.best_rounds || {}) };

    res.json({
      round: row.round,
      difficulty: row.difficulty,
      bestRounds,
      bestRound: row.best_round,
      totalCounted: row.total_counted,
      soundOn: row.sound_on,
      nightOn: row.night_on,
      calmOn: row.calm_on,
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
  const nightOn = !!body.nightOn;
  const calmOn = !!body.calmOn;
  // An unrecognised difficulty is never stored; it reads back as Normal.
  const difficulty = DIFFICULTIES.has(body.difficulty) ? body.difficulty : 'normal';

  try {
    const { rows } = await pool.query(
      `SELECT best_round, best_rounds FROM sheep_progress WHERE user_id = $1`,
      [req.user.id]
    );
    const prev = rows[0];

    // A run restarts at round 1, so the round may move backward freely;
    // only the best rounds are monotonic: the all-time best across every
    // difficulty, and the reporting difficulty's own best.
    const bestRound = Math.max(prev ? prev.best_round : 1, claimedBest, round);
    const prevBestRounds = (prev && prev.best_rounds) || {};
    const bestRounds = {
      ...prevBestRounds,
      [difficulty]: Math.max(prevBestRounds[difficulty] || 1, claimedBest, round),
    };
    const totalCounted = (prev ? prev.total_counted : 0) + newTaps;

    await pool.query(
      `INSERT INTO sheep_progress
         (user_id, username, round, best_round, best_rounds, difficulty, total_counted, sound_on, night_on, calm_on, seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         round = EXCLUDED.round,
         best_round = EXCLUDED.best_round,
         best_rounds = EXCLUDED.best_rounds,
         difficulty = EXCLUDED.difficulty,
         total_counted = EXCLUDED.total_counted,
         sound_on = EXCLUDED.sound_on,
         night_on = EXCLUDED.night_on,
         calm_on = EXCLUDED.calm_on,
         updated_at = NOW()`,
      [req.user.id, req.user.username, round, bestRound, JSON.stringify(bestRounds), difficulty, totalCounted, soundOn, nightOn, calmOn, randomSeed()]
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
  // Public share and invite views are served tokenless: the visitor carries
  // no platform token by definition, and these pages read only their own
  // public data endpoints, so they must not depend on the chromeless shell
  // minting a token for them. Skipping the chromeless redirect here also
  // removes any redirect-loop risk if it ever fired on the same path.
  if (!req.user && !req.query.scene && !req.query.round) {
    if (req.path.startsWith('/s/') || req.path.startsWith('/invite/')) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
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
    { user_id: -104, username: 'Staging demo: Bess', round: 1, best_round: 12, total_counted: 40 },
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

  // Weekly leaderboard rows. Fixed ids make the insert idempotent; the
  // timestamps stay inside their week no matter when the container boots.
  // The last-week row exists to prove the Monday 00:00 UTC boundary hides
  // it from the This week tab while Mabel's newer run keeps her on it.
  const weekRuns = [
    { id: 900101, user_id: -101, username: 'Staging demo: Mabel', round_reached: 8, speed: true, when: "date_trunc('week', NOW()) + interval '2 hours'" },
    { id: 900102, user_id: -102, username: 'Staging demo: Otto', round_reached: 7, speed: false, when: "date_trunc('week', NOW()) + interval '2 hours'" },
    { id: 900103, user_id: -103, username: 'Staging demo: Pip', round_reached: 4, speed: false, when: "date_trunc('week', NOW()) + interval '1 hour'" },
    { id: 900104, user_id: -101, username: 'Staging demo: Mabel', round_reached: 5, speed: false, when: "date_trunc('week', NOW()) - interval '3 days'" },
  ];
  for (const r of weekRuns) {
    await pool.query(
      `INSERT INTO sheep_runs (id, user_id, username, round_reached, speed_round, ended_at)
       VALUES ($1, $2, $3, $4, $5, ${r.when})
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.user_id, r.username, r.round_reached, r.speed]
    );
  }

  // A shareable demo run with its share row, so the /s/<key> view and the
  // public /api/share read have something to show in a fresh preview. The
  // end_reason matches what the shared card renders for it.
  await pool.query(
    `INSERT INTO sheep_runs (id, user_id, username, round_reached, end_reason, ended_at)
     VALUES (900105, -101, 'Staging demo: Mabel', 8, 'doubleTap', date_trunc('week', NOW()) + interval '3 hours')
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO sheep_run_shares (run_id, share_key, created_by_user_id)
     VALUES (900105, 'staging-demo-share', -101)
     ON CONFLICT (run_id) DO NOTHING`
  );

  // One invite for the demo identity, so the /invite/<code> page has an
  // inviter to name. The code is obviously fake and nothing in game logic
  // reads it.
  await pool.query(
    `INSERT INTO sheep_invites (owner_user_id, invite_code)
     VALUES (-101, 'demo-invite')
     ON CONFLICT (owner_user_id) DO NOTHING`
  );
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
  // Per-difficulty progress: which level the player last played, and one
  // best round per level. Rows written before difficulties existed read as
  // Normal via the column default; best_rounds starts empty and folds in.
  await pool.query(`ALTER TABLE sheep_progress ADD COLUMN IF NOT EXISTS difficulty VARCHAR(255) NOT NULL DEFAULT 'normal'`);
  await pool.query(`ALTER TABLE sheep_progress ADD COLUMN IF NOT EXISTS best_rounds JSONB NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE sheep_progress ADD COLUMN IF NOT EXISTS night_on BOOLEAN NOT NULL DEFAULT false`);
  // Calm mode: a comfort setting stored with the other grown-up toggles.
  await pool.query(`ALTER TABLE sheep_progress ADD COLUMN IF NOT EXISTS calm_on BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE sheep_progress ALTER COLUMN seed SET DEFAULT 0`);

  // Finished runs, one row per run end: what the This week tab ranks. The
  // table is deliberately separate from sheep_progress so a run's outcome
  // is timestamped when it happens, which a best-round-only column cannot
  // express.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheep_runs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username VARCHAR(255) NOT NULL,
      round_reached INTEGER NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sheep_runs_week_idx ON sheep_runs (ended_at)`);

  // Why the run ended, so a shared card shows the same reason line the
  // player saw. Rows written before this column existed read as NULL and
  // the shared view falls back to the generic copy.
  await pool.query(`ALTER TABLE sheep_runs ADD COLUMN IF NOT EXISTS end_reason VARCHAR(255)`);

  // Speed Round tag: which runs were played against the 30 second clock,
  // so the weekly leaderboard marks them separately from normal rounds.
  await pool.query(`ALTER TABLE sheep_runs ADD COLUMN IF NOT EXISTS speed_round BOOLEAN NOT NULL DEFAULT false`);

  // Public table: shares point at already-public run rows (a username and a
  // round number the leaderboard publishes), and the key is unguessable, so
  // no `staging:private` comment is needed; rows copy into previews. One
  // share per run; the share dies with the run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheep_run_shares (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL UNIQUE REFERENCES sheep_runs(id) ON DELETE CASCADE,
      share_key VARCHAR(32) NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Public table: one stable invite code per player. A code maps to a
  // display username that is already public on the global leaderboard, so
  // nothing here is a secret.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheep_invites (
      owner_user_id INTEGER PRIMARY KEY,
      invite_code VARCHAR(16) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // The following list, one row per (owner, friend). A following graph is
  // personal information beyond a public username, so the table is marked
  // staging:private: schema copies into previews, rows never do, and the
  // seed block below deliberately does not touch it. friend_user_id is
  // filled only when the platform shell resolved the handle; a friend
  // added outside the shell keeps NULL.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheep_friends (
      owner_user_id INTEGER NOT NULL,
      friend_username VARCHAR(255) NOT NULL,
      friend_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_user_id, friend_username)
    )
  `);
  await pool.query(`COMMENT ON TABLE sheep_friends IS 'staging:private'`);

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

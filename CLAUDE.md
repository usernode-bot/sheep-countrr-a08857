# Sheep countrr — notes for Claude Code

This app runs on **Usernode Social Vibecoding**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://social-vibecoding.usernodelabs.org/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Usernode's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Usernode connector calls (`mcp__usernode__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Starter template

The screen this app currently ships — the hero, the "What's already
working" card, and the Press! example (the demo markup in
`public/index.html`, the `/api/press` and `/api/leaderboard` routes, and
the `presses` table bootstrap in `server.js`) — is placeholder content
from the Usernode starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- remove or repurpose the "Try the example" card, its demo endpoints and
  the `presses` table as appropriate,
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Sheep countrr

A round-based tap-to-count game for young children. Round 1 is one
stationary sheep; each completed round adds roughly one or two more and
raises the movement speed and randomness, so remembering which sheep you
already counted is the difficulty. Tapping an uncounted sheep counts it
and marks it permanently (numbered ribbon, eyes closed, motion stopped);
tapping a counted sheep, or submitting a short count, ends the run and
shows the round reached with a restart button. Sound is off by default; a
grown-up reaches settings (sound, progress, start over) only via a ~1.5s
press-and-hold on the corner gear icon, so a child mashing the screen
cannot wander in. See `README.md` for the full feature description.

## App-specific conventions

- **The round difficulty curve lives in `public/rounds.js`** and nowhere
  else: `sheepForRound`, `motionForRound`, `roundSeed` and `roamRadius`
  are pure functions of the round number, which is what makes `/?round=N`
  reproducible and lets `tests/game.test.mjs` assert the escalation
  without a browser. Tune difficulty there rather than in a renderer.
  `roamRadius(round)` must stay a genuine upper bound on
  `wanderOffset`'s vector magnitude — `scene.js` pads the camera by it,
  so an under-estimate lets a late-round sheep wander off screen. The
  test sweeps it; don't relax that assertion to make a tweak pass.
- **`/?round=N` is a playable deep link, not a frozen fixture.** It
  starts a real run at that round from the round's fixed seed, but the
  store is constructed `ephemeral` + `deterministic`, so it never reads
  or writes localStorage or the server. That is what lets it share the
  auth exemption with `?scene=`; keep it side-effect-free.
- **Frozen screenshot fixtures live behind `?scene=`** (`portrait`,
  `empty`, `midcount`, `roundcomplete`, `gameover`, `grownups`, `flock`
  — see `dapp.json`'s `tests`). `public/app.js`'s `staticMode` branch
  renders these from hardcoded data only (`buildStaticState()`) and never
  touches localStorage or the server — keep it that way, since these
  routes are exempted from the auth gate in `server.js` specifically
  because they carry no real user data. Don't make `staticMode` read from
  the store or network. `staticMode` also suppresses the round-complete
  auto-advance timer, so `?scene=roundcomplete` holds still long enough
  to photograph.
- **`?renderer=dom` forces the DOM/card fallback** (used by the
  "No-WebGL fallback" test) even on a device that supports WebGL. It
  shares the same `onTap(index)` contract and counting logic as the 3D
  scene (`public/scene.js` vs `public/fallback.js`) — keep both
  renderers behaviorally identical when changing counting logic.
- **`server.js`'s catch-all auth gate exempts requests carrying a
  `?scene=` or `?round=` query param**
  (`if (!req.user && !req.query.scene && !req.query.round)`) so
  the platform's screenshot/check pipeline — which cannot supply a
  real signed platform token — can still reach the declared test
  paths. The bare `/` route (real user progress) and all `/api/*`
  routes remain fully gated. If you ever add a new screenshot-state
  fixture parameter, extend this exemption deliberately and keep the
  fixture side-effect-free, the same way `?scene=` is.
- **`sheep_progress`** is a public table (per-user counters: which round
  to start on, best round reached, lifetime total) — nothing in it is
  sensitive. Only run-spanning values are stored: a half-counted round is
  deliberately never persisted, because resuming into taps the player
  does not remember making would end the run on the next tap. The
  `herd_size` / `count` / `counted` / `best` columns predate rounds and
  are no longer read; `best_round` is added by an idempotent
  `ADD COLUMN IF NOT EXISTS`. `POST /api/state` takes
  `{ round, bestRound, newTaps, soundOn }` and bounds every value
  server-side, `newTaps` being a delta so one request can't inflate the
  community total. Staging seeds three demo rows with negative
  `user_id`s and usernames prefixed "Staging demo: ..." so the grown-ups
  panel's community total isn't zero in a fresh preview; the seed never
  touches the visiting user's own row, and never fabricates a signal the
  app's own logic reads.
- **The camera frames the flock, not the field.** `scene.js`'s
  `fitCamera()` bisects the camera distance until every sheep (plus a
  pad and the floating number plate height) projects inside the screen
  area NOT covered by the count plate: below it in portrait, to its
  right in landscape (CSS parks the plate top-left on short landscape
  screens). `app.js` passes `getOverlayRect()` returning the plate's
  DOMRect for this. Layout shape (`layoutRegion`) follows orientation,
  and a portrait/landscape flip rebuilds the flock from the same seed;
  a soft-keyboard resize only refits the camera. Don't hardcode camera
  positions; every round's flock (1 up to MAX_SHEEP = 12 sheep, plus the
  round's `roamRadius` pad) must stay fully visible at 390x844.
  `getBottomOverlayRect()` passes the Done-button bar the same way, so
  the flock is framed between the count plate and the submit button
  rather than underneath either.
- **Sheep are merged vertex-colored meshes** (`buildSheepBodyGeometry`,
  `mergeColored` in `scene.js`; no `three/examples` imports). Only the
  eyes, shadow, ribbon, number plate and pick sphere are separate
  objects, so a full flock of twelve stays under ~100 draw calls. Keep new sheep
  detail inside the merge rather than adding per-sheep meshes.
- **Both renderers animate from the same `wanderOffset`.** `scene.js`
  moves sheep in world units; `fallback.js` applies the same offsets as
  `left`/`top` on the already-relative cards, deliberately leaving
  `transform` to the tap and wiggle animations. A counted sheep snaps
  back to its home spot and stops moving in both.
- **`NUMBER_COLORS` in `layout.js`** is the one pastel-per-number palette
  used by the 3D ribbon/number plate and the DOM fallback badge. Both
  renderers also expose an optional `celebrate()`; `app.js` calls it
  when a round is passed.
- **User-facing copy carries no em dashes** (index.html and every string
  the renderers write to the DOM). Comments may.
- **`three` is a normal npm runtime dependency**, not a
  platform-hosted asset like the bridge/native-kit/Tailwind runtime —
  it's installed into the image and served from `/vendor/three` via
  Express static, not vendored into git.

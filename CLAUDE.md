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
and pops it like a piñata: it puffs up, vanishes, and leaves a pile of
pastel confetti and candy where it stood for the rest of the round; a
popped spot ignores taps, so it can never end a run. Submitting a short
count ends the run and shows the round reached with a restart button. Sound is on by default: a
soft Web Audio baa plays each time a sheep is counted, and a grown-up
mutes it (and reaches settings: progress, start over) only via a ~1.5s
press-and-hold on the corner gear icon, so a child mashing the screen
cannot wander in. The on-by-default flip carries a one-time migration
(see `restoredSound` in `public/state.js`): saves written before the flip
carry a `soundSet` marker; a pre-marker save takes the new default once,
and a mute made after it persists the marker and stays off. See `README.md` for the full feature description.

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
  `empty`, `midcount`, `allcounted`, `roundcomplete`, `gameover`,
  `grownups`, `flock` — see `dapp.json`'s `tests`). `public/app.js`'s
  `staticMode` branch
  renders these from hardcoded data only (`buildStaticState()`) and never
  touches localStorage or the server — keep it that way, since these
  routes are exempted from the auth gate in `server.js` specifically
  because they carry no real user data. Don't make `staticMode` read from
  the store or network. `staticMode` also suppresses the round-complete
  auto-advance timer, so `?scene=roundcomplete` holds still long enough
  to photograph.
- **Speed Round fixtures**: `?scene=speed` (board mid-count with the
  countdown pill), `?scene=speedgameover` (the clock ran out), and
  `?round=N&speed=1` (a playable timed run). All ride the existing
  `?scene=` / `?round=` auth exemption and stay side-effect-free. The
  Speed Round mode is run-level client state (`speedOn` in state.js,
  saved to localStorage like soundOn); it is deliberately NOT a
  sheep_progress column, so a deep link or screenshot run cannot flip a
  real player's next round into a timed one. Only finished runs carry
  the mode to the server (`sheep_runs.speed_round`), which is what the
  weekly leaderboard's "Speed N" tag reads.
- **The play streak is client-side, never a server column.** The
  streak flame on the Get-ready card counts consecutive LOCAL calendar
  days with at least one round started, plus a best-streak record. It
  lives in localStorage inside the same per-user payload the store
  already saves (`streakDays` / `bestStreakDays` / `lastPlayedDay`),
  recorded by `recordPlayDay()` on every `startRound` (and on resuming a
  mid-round snapshot). Ephemeral stores (all `?scene=` / `?round=` deep
  links) never record a day, so a capture run cannot move a real
  player's streak; the `?scene=intro` fixture hardcodes its streak in
  `buildStaticState()` instead. The pure arithmetic (`localDayKey`,
  `dayDistance`, `advanceStreak`) lives in `rounds.js` with the other
  copy/curve helpers and is asserted in `tests/game.test.mjs`.
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
  moves sheep in world units; `fallback.js` applies the same offsets via
  the individual CSS `translate` property (compositor-only, no per-frame
  layout), deliberately leaving `transform` to the tap and wiggle
  animations. A counted sheep pops away (its group hides and a seeded
  confetti-and-candy burst settles where it stood), so its spot is
  untappable and never moves again, in both renderers.
- **`NUMBER_COLORS` in `layout.js`** is the one pastel-per-number palette,
  used by the pop burst's confetti and candy in both renderers. Both
  renderers also expose an optional `celebrate()`; `app.js` calls it
  when a round is passed.
- **User-facing copy carries no em dashes** (index.html and every string
  the renderers write to the DOM). Comments may.
- **`three` is a normal npm runtime dependency**, not a
  platform-hosted asset like the bridge/native-kit/Tailwind runtime —
  it's installed into the image and served from `/vendor/three` via
  Express static, not vendored into git.
- **The light pastel palette is the only default.** Night Meadow and
  Calm mode recolor only the scenery (and Calm the tempo) via
  `body.theme-*`; never add an unscoped `:root` block that redefines
  `--plum` / `--cream` / `--pink`, since source order makes it win for
  everyone. Style new chrome with those variables, not hardcoded hexes.
- **The first paint is the pastel sky, never the platform's black frame
  (#44).** The tiny `<style>` at the very top of `index.html`'s `<head>`
  gives `html`/`body` the sky colors before the bridge, stylesheet or
  `app.js` can stall; keep it first and keep it pastel. `#boot-card` plus
  the inline watchdog script just before the `app.js` tag are the only
  thing allowed to cover the screen before `boot()` finishes: `app.js`
  calls `window.__sheepBootDone()` (which also sets `html[data-booted]`,
  asserted by the `boot.ready` check) or `window.__sheepBootFailed()`.
  Any browser-storage access at `app.js` module top level must be wrapped
  in try/catch: a throw there kills the module before the watchdog hears
  about it.
- **`/tailwind.css` is served from `public/` when the image built it.**
  It is this app's own build output (`npm run build`, run by the
  Dockerfile's first stage), not a platform file. `server.js` answers 204
  only when the file is missing (a plain checkout). Every layout utility in
  `index.html` depends on it, so never short-circuit it unconditionally: a
  204 there once shipped to production and left every screen without its
  layout.
- **The 3D frame loop runs on the round's clock** (`elapsedSeconds()` in
  `scene.js`), which `frame()` must advance every frame. `setRoundClock`
  only re-bases it for a resumed board. Movement, blinking and the counted
  number's pop-in all read it, so a clock that stops moving freezes the
  game while every static check still passes.

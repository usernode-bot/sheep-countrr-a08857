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

A tap-to-count game for very young children: a 3D pasture of
procedurally-built sheep (Three.js), rendered full-screen. Tapping an
uncounted sheep counts it and bumps a big readable number badge; once
every sheep in the round is counted, a short celebration plays. Sound
is off by default (taps always vibrate); a grown-up reaches settings
(sound, flock size, progress, start over) only via a ~1.5s
press-and-hold on the corner gear icon, so a child mashing the screen
can't wander in. See `README.md` for the full feature description.

## App-specific conventions

- **Screenshot-state fixtures live behind `?scene=`** (`empty`,
  `midcount`, `celebrate`, `grownups` — see `dapp.json`'s `tests`).
  `public/app.js`'s `staticMode` branch renders these from hardcoded
  data only (`buildStaticState()`) and never touches localStorage or
  the server — keep it that way, since these routes are exempted from
  the auth gate in `server.js` specifically because they carry no real
  user data. Don't make `staticMode` read from the store or network.
- **`?renderer=dom` forces the DOM/card fallback** (used by the
  "No-WebGL fallback" test) even on a device that supports WebGL. It
  shares the same `onTap(index)` contract and counting logic as the 3D
  scene (`public/scene.js` vs `public/fallback.js`) — keep both
  renderers behaviorally identical when changing counting logic.
- **`server.js`'s catch-all auth gate exempts requests carrying a
  `?scene=` query param** (`if (!req.user && !req.query.scene)`) so
  the platform's screenshot/check pipeline — which cannot supply a
  real signed platform token — can still reach the declared test
  paths. The bare `/` route (real user progress) and all `/api/*`
  routes remain fully gated. If you ever add a new screenshot-state
  fixture parameter, extend this exemption deliberately and keep the
  fixture side-effect-free, the same way `?scene=` is.
- **`sheep_progress`** is a public table (per-user counters: current
  herd size, best round, lifetime total, community total) — nothing
  in it is sensitive. Staging seeds three demo rows with negative
  `user_id`s and usernames prefixed "Staging demo — ..." so the
  grown-ups panel's community total isn't zero in a fresh preview;
  the seed never touches the visiting user's own row.
- **`three` is a normal npm runtime dependency**, not a
  platform-hosted asset like the bridge/native-kit/Tailwind runtime —
  it's installed into the image and served from `/vendor/three` via
  Express static, not vendored into git.

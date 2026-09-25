# Sheep countrr

A tap-to-count game for young children, played in rounds. Round 1 puts
one sheep on screen and it stands perfectly still. Count it, and the next
round brings another sheep or two, moving a little faster and a little
less predictably. Keep going and the flock ends up bouncing and jittering
across the pasture, which is the whole game: the counting stays easy, the
keeping track of who you already counted does not.

## How it works

- **Rounds.** Round 1 is a single stationary sheep. Each completed round
  adds roughly one or two more sheep (up to twelve, so every sheep stays
  tappable on a phone) and turns up the movement: a slow drift at first,
  then pacing and bouncing, then a nervous jitter on top.
- **Counting.** Tap a sheep to count it. It stops, closes its eyes and
  puts on a numbered ribbon, so a counted sheep is impossible to mistake
  for an uncounted one. The current round and the running tap count sit
  at the top of the screen the whole time.
- **Before you start.** The first round of a run opens on a short "Get
  ready" card that names the round and its flock, explains that a tap
  counts a sheep and gives it a number, and warns that counting the same
  sheep twice ends the run. Its one button, "Start counting", dismisses
  the card and begins the round. It returns at the start of every run
  (after "Start again" or "Start over at round 1"), and later rounds in
  a run skip it since the round-complete message already previews the
  next flock.
- **Finishing a round.** Tap every sheep and the round completes itself,
  or tap "Done counting" when you think you have them all. A correct
  count shows a short round-complete message and moves on.
- **Ending a run.** Tapping a sheep you already counted, or saying you
  are done while sheep are still uncounted, ends the run. The game-over
  screen names the round you reached and offers "Start again", which
  returns to round 1.
- **Touch first.** The whole board is taps: big hit targets, no drag, no
  pinch, and the Done button sits clear of the safe area at the bottom.
  The camera reframes on rotation so the whole flock stays visible.
- **Renderers.** The pasture is Three.js (procedurally-built sheep on a
  grassy field). Devices without WebGL, or `?renderer=dom`, fall back to
  a grid of big round cards that drift with the same seeded motion and
  share the same counting logic.
- **Sound is off by default.** Soft chimes only play once a grown-up
  turns sound on.
- **The grown-ups panel** (sound, progress, start over) is reached by a
  ~1.5 second press-and-hold on the small gear icon in the corner, or
  Enter/Space with a keyboard. A quick tap does nothing, so a child
  mashing the screen cannot wander into settings.
- **Progress syncs to the server** per signed-in user (which round to
  start on, best round reached, lifetime sheep counted) plus a community
  total shown in the grown-ups panel. A half-counted round is never
  restored, since returning to taps you do not remember making would end
  the run on the next tap.
- Reduced-motion preference holds the flock still and drops the tap
  animations in both renderers.

## Running and reviewing

Run `npm ci`, `npm run build`, `npm test`.

Review fixtures, all of which avoid localStorage and the server:

- `/?round=N` starts a real, playable run at round N from that round's
  fixed seed, so the same URL always frames the same pasture. This is the
  deep link the screenshot checks use: `/?round=8` for a chaotic flock of
  eleven. `/?round=1` now opens on the "Get ready" card (it is the start
  of a fresh run); for the bare still-single-sheep board use
  `/?scene=portrait`, which shows no card.
- `/?scene=midcount`, `/?scene=roundcomplete`, `/?scene=gameover`,
  `/?scene=grownups`, `/?scene=flock`, `/?scene=portrait`,
  `/?scene=empty` freeze one screen for a screenshot.
- `?renderer=dom` forces the card fallback and composes with either
  (`/?round=8&renderer=dom`).

Use `/` for normal play.

## App-specific notes

See `CLAUDE.md` for platform conventions and repo-specific details (the
`sheep_progress` table, staging seed rows, how the round difficulty curve
is laid out in `public/rounds.js`, and the screenshot-state deep links
used by the declared `dapp.json` checks).

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
- **Counting.** Tap a sheep to count it: it baas, puffs up, pops like a
  piñata and is gone, leaving a little pile of pastel confetti and candy
  on the grass where it stood for the rest of the round. A popped sheep's
  spot cannot be tapped, so a counted sheep is impossible to mistake for
  an uncounted one and empty grass never ends a run. The running tap count
  sits in a small counter in the top-left corner (with a row of progress
  dots underneath, one dot per sheep, filled in the counted sheep's
  pastel colour), leaving the middle of the screen to the flock. That
  counter is the one number on the board: the hint at the bottom reads
  "Tap every sheep." before the first tap, hides while counting, and
  comes back as "That is all of them. Tap Done counting." once every
  sheep is counted. The grown-ups gear and the mute button sit pale in
  the top-right corner so they never compete with the flock.
- **Before you start.** The first round of a run opens on a short "Get
  ready" card that names the round and its flock and gives the rule in
  one line (tap each sheep once, then Done counting; saying done too early
  ends the run; watch out for the wolf). The level picker, Speed Round and
  Pass-and-play Duel sit folded inside a closed "Game options" row that
  names the current level. Its one button, "Start counting", dismisses
  the card and begins the round. It returns at the start of every run
  (after "Start again" or "Start over at round 1"), and later rounds in
  a run skip it. The card also carries a streak flame: how many days in a
  row the player has played.
- **Calm, the default level.** The Get ready card's Game options list Calm first, then
  Easy, Normal, Hard, Expert, and above Expert the long-run levels Insane,
  Chaos and Legend. A player with no saved level starts on
  Calm; a saved pick is kept. On Calm the sheep only ever drift as slowly
  as an early round, the flock grows by one every two rounds and stops at
  five, the confetti falls more slowly after each pop, "Done counting"
  with sheep left wiggles the ones still awake, and there is no wolf,
  Speed Round, Duel or game over. Calm rounds keep their own best round
  but never count toward the Global, Friends or weekly leaderboards.
- **The long-run levels.** Insane, Chaos and Legend are for a player who
  has topped out Expert. Each keeps its own best round and a longer
  12-round ladder (the round badge reads "of 12"), the flock reaches the
  full twelve sheep within a few rounds, movement reaches full chaos by
  round 4 or 5 and keeps creeping up, and the wolf shows up earlier and
  in better disguise the higher the level: by Legend's round 5, every
  round hides one. The wolf's chance and disguise also scale on the
  original levels, so Easy's wolf is gentler and Hard's slightly sharper
  than Normal's.
- **Finishing a round.** Tapping the last sheep only marks it; the round
  waits for the "Done counting" tap. Saying done with every sheep counted
  shows the recap card: "Great job! You found all the sheep.", the round
  counted, the sheep counted as one big number, and one small line with
  the time ("That took 41 seconds.", plus "A new best!" when it is one),
  and every sheep counted on the device so far today.
  The Next round button, a tap anywhere or Enter moves on.
- **Ending a run.** Saying you are done while sheep are still uncounted
  ends the run; a popped sheep's spot ignores taps, so it can never end
  one. The game-over screen names the round you reached and offers
  "Start again", which returns to round 1, with a quieter "Share result"
  beneath it.
- **Touch first.** The whole board is taps: big hit targets, no drag, no
  pinch, and the Done button sits clear of the safe area at the bottom.
  The camera reframes on rotation so the whole flock stays visible.
- **Renderers.** The pasture is Three.js (procedurally-built sheep on a
  grassy field). Devices without WebGL, or `?renderer=dom`, fall back to
  a grid of big round cards that drift with the same seeded motion and
  share the same counting logic.
- **Sound is on by default.** Every sheep tap gives a soft baa (counted
  sheep add a gentle chime, Web Audio only, no asset files). A grown-up
  can mute it with the Sound effects toggle in the grown-ups panel.
- **The grown-ups panel** (sound, progress, start over) is reached by a
  ~1.5 second press-and-hold on the small gear icon in the corner, or
  Enter/Space with a keyboard. A quick tap does nothing, so a child
  mashing the screen cannot wander into settings.
- **Background picker.** The grown-ups panel's Background menu picks the
  scenery the flock stands on: Pastel Meadow, Night Meadow or Moon (grey
  ground, lavender-blue sky with small stars). Scenery only: the sheep,
  the counting and the difficulty never change. The pick is remembered on
  the device like the other settings; Night Meadow still syncs to the
  server as before (`scenery` is client-side only, with `nightOn`
  derived from it), and Moon stays per device.
- **Progress syncs to the server** per signed-in user (which round to
  start on, best round reached, lifetime sheep counted) plus a community
  total shown in the grown-ups panel. A half-counted round is never
  restored, since returning to taps you do not remember making would end
  the run on the next tap. The play streak and its best stay on the
  device, keyed per user, and count days in the player's local timezone.
- **Leaderboard** (grown-ups gate): a card with three tabs. Global ranks
  the best round ever reached; This week ranks the best round achieved in
  the current week (Monday 00:00 UTC to Sunday night, the same everywhere);
  Friends ranks the Homeroom handles you follow, picked from the platform's
  user directory with a typeahead field. Each finished run records its
  round for the weekly tab. `/\?scene=leaderboard` freezes the card with
  demo rows (add `&tab=weekly` or `&tab=friends` for the other tabs).
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

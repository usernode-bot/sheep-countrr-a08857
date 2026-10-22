# Sheep countrr

A tap-to-count game for young children, played on one endless ladder of
levels. The app opens straight onto the meadow with one sheep standing
still: tapping it is the start. Each flock runs straight into the next, and
every three rounds make a level that brings a few more sheep, a little more
speed and, from level 3, a shorter clock. The counting stays easy; keeping
track of who you already counted, against the clock, does not.

## How it works

- **One tap to start.** No Get ready card, no level picker, no countdown.
  The first round is a single still sheep, and tapping it is the first
  count.
- **Counting.** Tap a sheep to count it: it baas, puffs up, pops like a
  piñata and is gone, leaving a little pile of pastel confetti and candy
  on the grass where it stood for the rest of the round. A popped sheep's
  spot cannot be tapped, so empty grass never ends a run. The running tap
  count sits in the top-left corner (with a row of progress dots, one per
  sheep), and the hint at the bottom counts down: "Tap the sheep to
  start.", "Tap every sheep.", then "4 left!" and so on.
- **Rounds run into each other.** The round passes the moment the last
  sheep pops. A small line in the meadow reads "You counted 4 sheep." for
  about a second, the confetti plays, and the next flock walks in by
  itself. There is no card to close and no Done counting button in solo
  play.
- **Levels, Tetris style.** Every three rounds make one level. Finishing a
  level plays a bigger moment (about two seconds): "Level 3!" over the
  counted line, a confetti burst and the celebration sound, and the corner
  tag changes to the new level. Level L opens with L sheep and its next two
  rounds hold one more, up to twelve.
- **A gentle start.** Levels 1 and 2 have no clock and no wolf; the sheep
  stand or drift. Level 4 is still calmer than the old Normal round 4.
- **The clock.** From level 3 every round has its own clock (the yellow
  pill under the corner tag): 8 seconds a sheep at level 3, 6 at level 4,
  then shorter each level down to 2, plus a 3 second base. Big Tap gives
  half as much time again.
- **The wolf.** From level 4 one of the flock may be a wolf in disguise,
  more often and better disguised as the levels climb. Tapping it ends the
  run; the round passes without it.
- **No last round.** The ladder never runs out. Past level 10 the flock
  stays at twelve and the sheep keep getting a little faster while the
  clock keeps getting a little shorter.
- **Ending a run.** The clock runs out, or the wolf is tapped. The
  game-over card names the level reached and is the one place to choose
  how to play next: Start again (level 1), Start at level shortcuts (1, 4,
  7 ... up to the best level reached), Calm, Pass-and-play Duel and Share
  result, with the Best level chip and the day streak flame.
- **Calm.** One switch (the grown-ups panel's Calm mode, or the Calm pill
  on the game-over card): slow sheep, a flock that grows by one every two
  rounds up to five, no clock, no wolf, no game over. Calm rounds keep
  their own best and never count toward the leaderboards.
- **Pass-and-play Duel.** Started from the game-over card: both players
  count the flock of the level the run reached, and each turn still ends on
  Done counting.
- **Touch first.** The whole board is taps: big hit targets, no drag, no
  pinch, and the Done button sits clear of the safe area at the bottom.
  The camera reframes on rotation so the whole flock stays visible.
- **Renderers.** The pasture is Three.js (procedurally-built sheep on a
  grassy field). Devices without WebGL, or `?renderer=dom`, fall back to
  a grid of big round cards that drift with the same seeded motion and
  share the same counting logic.
- **Sound is on by default.** Every sheep tap gives a soft baa (counted
  sheep add a gentle chime, Web Audio only, no asset files). A grown-up
  can mute it with the corner button or the Sound effects toggle in the
  grown-ups panel.
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

Review fixtures:

- `/?round=N` starts a real, playable run at round N (level ceil(N / 3))
  from that round's fixed seed, so the same URL always frames the same
  pasture: `/?round=29` for a jittery flock of eleven, `/?round=7` for the
  first timed round. `&wolf=0` / `&wolf=1` pin the wolf draw.
- `/?round=N&autoplay=1` plays the round and stops on the pass banner;
  `&autoplay=next` lets the next flock walk in.
- `/?scene=roundpass`, `/?scene=levelup`, `/?scene=midcount`,
  `/?scene=gameover`, `/?scene=timeupgameover`, `/?scene=grownups`,
  `/?scene=flock`, `/?scene=portrait`, `/?scene=empty` freeze one screen
  for a screenshot and never touch localStorage or the server.
- `?renderer=dom` forces the card fallback and composes with either
  (`/?round=29&renderer=dom`).

Use `/` for normal play.

## App-specific notes

See `CLAUDE.md` for platform conventions and repo-specific details (the
`sheep_progress` table, staging seed rows, how the round difficulty curve
is laid out in `public/rounds.js`, and the screenshot-state deep links
used by the declared `dapp.json` checks).

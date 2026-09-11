# Sheep countrr

A tap-to-count game for very young children. A small pasture of fluffy
3D sheep grazes on screen; tap a sheep to count it, and a big number
badge tracks the total as you go. When every sheep in the flock has
been counted, the flock rests and a quiet invitation to count again appears. No reading required, no
scoring, no losing — just counting.

## How it works

- **The pasture** is rendered in 3D with Three.js: a handful of
  procedurally-built sheep standing on a grassy field. Tapping an
  uncounted sheep adds a numbered ribbon onto it and bumps the count;
  tapping an already-counted sheep gives it a friendly wiggle instead.
  Devices without WebGL (or `?renderer=dom`, used for testing) fall
  back to the same interaction as a grid of big round cards — same
  counting logic, no 3D required.
- **The count** is shown oversized at the top of the screen, both as
  a numeral and as its word ("3" / "Three"), readable from across the
  room.
- **Sound is off by default.** There are no vibrations;
  soft, low chimes only play once a grown-up turns
  sound on.
- **The grown-ups panel** (sound toggle, flock size, progress, start
  over) is reached by a ~1.5 second press-and-hold (or Enter/Space with a keyboard) on the small
  gear icon in the corner — a quick tap does nothing, so a child
  mashing the screen can't wander into settings.
- **Progress syncs to the server** per signed-in user (current flock,
  best round, lifetime sheep counted) and to a community total shown
  in the grown-ups panel, so it picks up where it left off on any
  device.

## App-specific notes

See `CLAUDE.md` for platform conventions and repo-specific details
(the `sheep_progress` table, staging seed rows, screenshot-state deep
links used by the declared `dapp.json` checks).

## Bedtime sheep update

The flock starts with three sheep and grows by one per round to ten. Uncounted
sheep follow bounded, seeded wandering paths that become slightly more varied
as the flock grows; counted sheep hold still and close their eyes. The camera
stays still. Reduced-motion preference disables wandering and tap animations
in both renderers.

Run `npm ci`, `npm run build`, and `npm test`. Browser review fixtures:
`/?scene=portrait` (one sheep), `/?scene=flock` (ten),
`/?scene=midcount`, `/?scene=celebrate`, and `/?renderer=dom` (playable fallback).
Fixtures never persist progress. Use `/` for normal play and round progression.

## Bird’s-eye meadow

The camera looks down at 60 degrees and always frames the entire roaming area.
Sheep choose seeded destinations across that area, steer around each other and
turn smoothly. Larger flocks change direction more often and trot a little
faster; pauses and capped acceleration keep the pace gentle. Leg swings follow
actual distance travelled. Counted sheep stop in place. Grass tufts, five-petal
daisies, little stones, raised wool curls and wagging tails add quiet detail.

Review `/?scene=birdseye`, `/?scene=roaming`, and `/?scene=still` (a non-persistent
reduced-motion fixture). Normal play remains `/`. The non-WebGL fallback stays
a stationary card grid for accessibility and lower-powered devices.

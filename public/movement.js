// A fixed-step, seeded steering simulation. Sheep travel to new places in
// the meadow; rendering frequency never changes the paths they choose.
import { mulberry32 } from './layout.js';
const STEP = 1 / 60;
const GAP = 1.28;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function roamingTuning(herdSize) {
  const variety = clamp((herdSize - 3) / 7, 0, 1);
  return {
    speed: .34 + variety * .34,
    retargetSeconds: 7 - variety * 3.5,
    turnRate: .8 + variety * .65,
    meander: .10 + variety * .33,
    pauseChance: .4 - variety * .22,
  };
}

export function createRoamingFlock(seed, positions, region, herdSize = positions.length) {
  const tuning = roamingTuning(herdSize);
  const halfX = region.width / 2;
  const halfZ = region.depth / 2;
  const agents = positions.map((p, i) => ({
    x: p.x, z: p.z, heading: i * 2.4, speed: 0, distance: 0,
    targetX: p.x, targetZ: p.z, remaining: 0, pause: i * .18,
    counted: false, phase: i * 2.399,
    random: mulberry32((seed + (i + 1) * 7919) >>> 0),
  }));
  let accumulator = 0;
  let time = 0;

  function chooseTarget(s) {
    // Prefer a destination well away from the current spot. Higher levels
    // choose destinations more often, mixing long crossings and short turns.
    for (let attempt = 0; attempt < 12; attempt++) {
      s.targetX = (s.random() - .5) * region.width * .92;
      s.targetZ = (s.random() - .5) * region.depth * .92;
      if (Math.hypot(s.targetX - s.x, s.targetZ - s.z) > Math.min(region.width, region.depth) * .35) break;
    }
    s.remaining = tuning.retargetSeconds * (.7 + s.random() * .7);
  }

  function constrain(s) {
    s.x = clamp(s.x, -halfX, halfX);
    s.z = clamp(s.z, -halfZ, halfZ);
  }

  function step() {
    time += STEP;
    const proposed = agents.map((s, i) => {
      if (s.counted) return { x: s.x, z: s.z };
      s.remaining -= STEP;
      if (s.remaining <= 0 || Math.hypot(s.targetX - s.x, s.targetZ - s.z) < .38) {
        chooseTarget(s);
        if (s.random() < tuning.pauseChance) s.pause = .6 + s.random() * 1.4;
      }
      s.pause = Math.max(0, s.pause - STEP);
      let dx = s.targetX - s.x, dz = s.targetZ - s.z;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length; dz /= length;
      // Steer away early, including around sleeping sheep.
      agents.forEach((other, j) => {
        if (i === j) return;
        const ox = s.x - other.x, oz = s.z - other.z;
        const d = Math.hypot(ox, oz);
        if (d > .001 && d < 1.85) {
          const force = (1.85 - d) * 2.8;
          dx += ox / d * force; dz += oz / d * force;
        }
      });
      // Soft wall repulsion begins before reaching the visible boundary.
      dx += Math.max(0, .85 - (s.x + halfX)) * 3 - Math.max(0, .85 - (halfX - s.x)) * 3;
      dz += Math.max(0, .85 - (s.z + halfZ)) * 3 - Math.max(0, .85 - (halfZ - s.z)) * 3;
      const desired = Math.atan2(dx, dz) + Math.sin(time * .7 + s.phase) * tuning.meander;
      const turn = angleDelta(s.heading, desired);
      s.heading += clamp(turn, -tuning.turnRate * STEP, tuning.turnRate * STEP);
      // Turn in place for tight corners; ease back into a trot afterward.
      const targetSpeed = s.pause > 0 ? 0 : tuning.speed * (.7 + .3 * Math.sin(time * .35 + s.phase) ** 2) * Math.max(0, Math.cos(turn));
      s.speed += clamp(targetSpeed - s.speed, -.8 * STEP, .55 * STEP);
      return { x: s.x + Math.sin(s.heading) * s.speed * STEP, z: s.z + Math.cos(s.heading) * s.speed * STEP };
    });
    agents.forEach((s, i) => {
      if (s.counted) return;
      const previousX = s.x, previousZ = s.z;
      s.x = proposed[i].x; s.z = proposed[i].z; constrain(s);
      // Reject a step into a neighbour instead of pushing sleeping sheep
      // or teleporting a moving one. Steering will find a way around.
      if (agents.some((o, j) => j !== i && Math.hypot(s.x - o.x, s.z - o.z) < GAP)) {
        s.x = previousX; s.z = previousZ; s.speed = 0;
        s.remaining = Math.min(s.remaining, .5);
      }
      s.distance += Math.hypot(s.x - previousX, s.z - previousZ);
    });
  }

  return {
    agents,
    tuning,
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      accumulator += Math.min(dt, .1);
      while (accumulator + 1e-9 >= STEP) { step(); accumulator -= STEP; }
    },
    count(index) {
      const s = agents[index];
      if (s) { s.counted = true; s.speed = 0; }
    },
  };
}

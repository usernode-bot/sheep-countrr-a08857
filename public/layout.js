// Deterministic seeded layout shared by both renderers, so the same round
// always reproduces the same pasture arrangement after a reload.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rejection-sampled positions within a rectangular field, so counted
// sheep read as visually distinct rather than clumped together.
export function layoutPositions(seed, n, { width = 8, depth = 5, minSeparation = 1.6 } = {}) {
  const rand = mulberry32(seed >>> 0);
  const points = [];
  const maxAttempts = 200;
  for (let i = 0; i < n; i++) {
    let placed = false;
    for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
      const x = (rand() - 0.5) * width;
      const z = (rand() - 0.5) * depth;
      const ok = points.every((p) => Math.hypot(p.x - x, p.z - z) >= minSeparation);
      if (ok) {
        points.push({ x, z });
        placed = true;
      }
    }
    if (!placed) {
      // Field is full at this separation. Fall back to a looser spot
      // rather than dropping a sheep from the flock.
      points.push({ x: (rand() - 0.5) * width, z: (rand() - 0.5) * depth });
    }
  }
  return points;
}

// Smooth, deterministic wandering stays inside each sheep's own space.
// A larger flock adds a second, slower curve without sudden direction changes.
import { mulberry32 } from './layout.js';
export function wanderOffset(seed, index, herdSize, time) {
  const random = mulberry32((seed + index * 7919) >>> 0);
  const phase = random() * Math.PI * 2;
  const variety = Math.max(0, Math.min(1, (herdSize - 3) / 7));
  const speed = 0.18 + variety * 0.12;
  const radius = 0.08 + variety * 0.13;
  return {
    x: radius * (Math.sin(time * speed + phase) * 0.75 + Math.sin(time * speed * 0.43 + phase * 2) * 0.25),
    z: radius * (Math.cos(time * speed * 0.71 + phase) * 0.75 + Math.sin(time * speed * 0.37 + phase) * 0.25),
    turn: Math.sin(time * speed * 0.8 + phase) * (0.08 + variety * 0.2),
  };
}

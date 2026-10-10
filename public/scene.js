// The 3D pasture. Imported by app.js only when WebGL is available, so
// devices without it never run three (index.html still preloads the
// file, since nearly every device does have WebGL).
//
// Art direction: a quiet dusk meadow with plush, sleepy sheep. Every sheep is ONE vertex-colored
// mesh (body, wool puffs, face, ears, cheeks, smile, legs, hooves merged at
// boot) plus two eye meshes that blink and close and a soft contact shadow.
// A counted sheep pops into confetti and candy (two instanced meshes for the
// whole round), which keeps a full flock under a hundred draw calls and the
// low tier smooth.
import * as THREE from 'three';
import { layoutPositions, NUMBER_COLORS, sheepName } from './layout.js';
import { wanderOffset } from './movement.js';
import { MAX_SHEEP, calmMotion, isCalmLevel, motionForRound, roamRadius, wolfDisguiseTier } from './rounds.js';

const COLORS = {
  wool: '#f4eadb',
  woolLight: '#fff8ed',
  woolShade: '#e5d7c5',
  face: '#bd9986',
  earInner: '#d6a5a4',
  cheek: '#d9a3a0',
  mouth: '#7a4f44',
  leg: '#e6c3ab',
  hoof: '#8a6558',
  eyeWhite: '#fff8ed',
  pupil: '#2b2530',
  ground: '#6b9150',
  hillA: '#5e8a49',
  hillB: '#527b42',
  hillC: '#476d3e',
  trunk: '#7b7773',
  leaf: '#4e7a3f',
  leafLight: '#6a9352',
  fog: '#a1afb8',
  wolfWool: '#cfc9bd',
  wolfWoolShade: '#b3ada2',
  glint: '#ffb347',
};

// Calm mode: the scenery takes the same soft pastel wash the CSS sky
// above the canvas uses (see body.theme-calm in index.html). Sheep,
// flowers and UI colors stay as they are, so the counted ribbons and
// number plates keep their exact contrast.
const CALM_COLORS = {
  ground: '#8fbf8a',
  hillA: '#87a982',
  hillB: '#75957a',
  hillC: '#66846c',
  fog: '#b3c2c8',
};

// Night Meadow: only the scenery (ground, hills, fog) shifts to its dark
// counterpart; every sheep color, the flowers and the UI stay as they are.
const NIGHT_COLORS = {
  ground: '#3e5c40',
  hillA: '#33513f',
  hillB: '#2b4638',
  hillC: '#243c30',
  fog: '#2c3d52',
};

// One plush fleece color per sheep, repeating across bigger flocks. The
// face stays the same warm tan on every sheep so they all still read as
// the same little animal, just in different pajamas.
const FLEECES = [
  { wool: '#f4eadb', woolLight: '#fff8ed', woolShade: '#e5d7c5' },
  { wool: '#ded4f7', woolLight: '#f1ecff', woolShade: '#c4b7ea' },
  { wool: '#f9d9e4', woolLight: '#feeef4', woolShade: '#e8bccc' },
  { wool: '#d5ecdd', woolLight: '#ecf9f1', woolShade: '#b4d6c1' },
  { wool: '#d7e8f7', woolLight: '#ecf5ff', woolShade: '#b7d0e8' },
  { wool: '#f8ecc9', woolLight: '#fdf6e0', woolShade: '#e3d2a4' },
];

function seededRand(seed, salt) {
  let a = (seed ^ (salt * 2654435761)) >>> 0;
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function placeMatrix(x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  return m;
}

// Concatenate several primitive geometries into one non-indexed, vertex
// colored geometry. Kept in-repo on purpose: the platform spec forbids
// pulling BufferGeometryUtils from three/examples.
function mergeColored(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const c = new THREE.Color();
  for (const { geo, color, matrix } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    c.set(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A small cream pill with the sheep's name, floating above its head.
// Fixed-width canvas so every label shares one sprite scale; the text is
// centered inside it. Same palette family as the number plates.
const NAME_FONT = '800 30px "Nunito", ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';

function buildNameTexture(name) {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(80, 50, 90, 0.18)';
  roundRect(ctx, 16, 18, w - 32, h - 22, 26);
  ctx.fill();
  ctx.fillStyle = '#fffaf2';
  roundRect(ctx, 8, 8, w - 16, h - 22, 24);
  ctx.fill();
  ctx.fillStyle = '#4a3b5c';
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2 - 4);
  return makeTexture(canvas);
}

function buildCloudTexture() {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const puffs = [
    [60, 78, 34], [104, 60, 44], [150, 62, 40], [192, 80, 32], [126, 86, 40],
  ];
  // Soft edge: a faint halo first, then the solid puff.
  puffs.forEach(([x, y, r]) => {
    const grad = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.25);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
  });
  // A whisper of lavender shading along the bottom.
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, 40, 0, h);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(214, 205, 240, 0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  return makeTexture(canvas);
}

function buildSunTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 30, c, c, c);
  glow.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
  glow.addColorStop(0.35, 'rgba(255, 226, 150, 0.45)');
  glow.addColorStop(1, 'rgba(255, 220, 160, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#eee4cc';
  ctx.beginPath();
  ctx.arc(c, c, 46, 0, Math.PI * 2);
  ctx.fill();
  return makeTexture(canvas);
}

function buildShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 4, c, c, c);
  grad.addColorStop(0, 'rgba(50, 90, 40, 0.34)');
  grad.addColorStop(0.6, 'rgba(50, 90, 40, 0.14)');
  grad.addColorStop(1, 'rgba(50, 90, 40, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return makeTexture(canvas);
}

function buildStarTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.fillStyle = '#fff8ed';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 28 : 9;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return makeTexture(canvas);
}

function buildDotTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff8ed';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  return makeTexture(canvas);
}

// Soft expanding ground ring shown where a sheep is tapped. A fading ring
// texture on a flat disc reads as a ripple in the grass at any tier.
function buildRippleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 248, 237, 0.85)');
  gradient.addColorStop(0.55, 'rgba(255, 248, 237, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 248, 237, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return makeTexture(canvas);
}

// ---------------------------------------------------------------------------
// Sheep geometry. Built once per variant, then shared by every sheep.

export function buildSheepBodyGeometry(variant, fleece = FLEECES[0]) {
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const smile = new THREE.TorusGeometry(0.048, 0.009, 6, 16, Math.PI);
  const curl = new THREE.TorusGeometry(0.065, 0.025, 6, 14, Math.PI * 1.65);
  const parts = [];
  const add = (color, x, y, z, sx, sy = sx, sz = sx, rz = 0) =>
    parts.push({ geo: sphere, color, matrix: placeMatrix(x, y, z, sx, sy, sz, 0, 0, rz) });
  // A soft pear-shaped silhouette, with overlapping wool locks rather
  // than an exposed smooth ball. All locks share a single draw call.
  add(fleece.woolShade, 0, 0.64, -0.05, 0.51, 0.49, 0.5);
  for (let row = 0; row < 5; row++) {
    const latitude = -0.9 + row * 0.46;
    const radius = Math.cos(latitude);
    const locks = row === 4 ? 7 : 11;
    for (let i = 0; i < locks; i++) {
      const angle = i / locks * Math.PI * 2 + row * 0.34;
      const wobble = seededRand(variant + 31, row * 11 + i);
      const x = Math.cos(angle) * radius * 0.44;
      const z = Math.sin(angle) * radius * 0.44 - 0.07;
      const y = 0.65 + Math.sin(latitude) * 0.41;
      const size = 0.155 + wobble * 0.045;
      add(i % 4 === 0 ? fleece.woolLight : fleece.wool, x, y, z, size, size * 1.08, size);
      if (row > 1 && i % 3 === 0 && z > 0) {
        parts.push({ geo: curl, color: fleece.woolShade,
          matrix: placeMatrix(x, y, z + size * 0.88, 0.65, 0.65, 0.45, 0, 0, angle) });
      }
    }
  }
  // Tiny rounded feet peep from beneath the fleece.
  for (const x of [-0.25, 0.25]) for (const z of [-0.22, 0.22]) {
    add(COLORS.leg, x, 0.18, z, 0.085, 0.15, 0.085);
    add(COLORS.hoof, x, 0.065, z + 0.025, 0.1, 0.065, 0.12);
  }
  add(fleece.wool, 0, 0.65, -0.63, 0.16, 0.15, 0.2);
  // Oversized forehead, small plush muzzle and low, wide-set eyes.
  add(COLORS.face, 0, 0.84, 0.48, 0.31, 0.3, 0.25);
  add('#dcc1a9', 0, 0.72, 0.685, 0.21, 0.13, 0.11);
  for (const side of [-1, 1]) {
    add(COLORS.face, side * 0.36, 0.91, 0.46, 0.19, 0.085, 0.065, side * -0.28);
    add(COLORS.earInner, side * 0.37, 0.918, 0.505, 0.125, 0.044, 0.025, side * -0.28);
    add(COLORS.cheek, side * 0.2, 0.775, 0.695, 0.063, 0.032, 0.026);
  }
  [[-0.2, 1.045, 0.5, 0.12], [-0.08, 1.11, 0.49, 0.145],
    [0.08, 1.1, 0.48, 0.13], [0.21, 1.03, 0.5, 0.105]].forEach(([x,y,z,r]) =>
      add(fleece.woolLight, x,y,z,r));
  parts.push({ geo: curl, color: COLORS.woolShade,
    matrix: placeMatrix(-0.06, 1.115, 0.628, 0.7, 0.7, 0.5, 0, 0, 0.3 + variant * 0.2) });
  add(COLORS.mouth, 0, 0.758, 0.8, 0.033, 0.021, 0.018);
  parts.push({ geo: smile, color: COLORS.mouth,
    matrix: placeMatrix(0, 0.723, 0.79, 1, 0.7, 1, 0, 0, Math.PI) });
  const geometry = mergeColored(parts);
  sphere.dispose(); smile.dispose(); curl.dispose();
  return geometry;
}

export function buildEyeGeometry() {
  const sphere = new THREE.SphereGeometry(1, 14, 10);
  const geometry = mergeColored([
    { geo: sphere, color: COLORS.pupil, matrix: placeMatrix(0, 0, 0, 0.052, 0.063, 0.035) },
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(-0.013, 0.021, 0.031, 0.016) },
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(0.015, -0.016, 0.033, 0.007) },
  ]);
  sphere.dispose();
  return geometry;
}

// The wolf's eyes: the same placement as a sheep's, with an amber glint
// that stays visible at every tier, even the near-perfect third one.
export function buildWolfEyeGeometry() {
  const sphere = new THREE.SphereGeometry(1, 14, 10);
  const geometry = mergeColored([
    { geo: sphere, color: COLORS.pupil, matrix: placeMatrix(0, 0, 0, 0.052, 0.063, 0.035) },
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(-0.013, 0.021, 0.031, 0.016) },
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(0.015, -0.016, 0.033, 0.007) },
    { geo: sphere, color: COLORS.glint, matrix: placeMatrix(0.005, 0.008, 0.04, 0.014) },
  ]);
  sphere.dispose();
  return geometry;
}

// The wolf reuses the sheep's merge pipeline: same silhouette, same wool
// locks, different disguise. Tier 1 wears grey with upright ears and a
// tail; tier 2 keeps small grey ears and a tail peek under a flock-pastel
// fleece; tier 3 is a sheep except for the eyes, which carry the glint.
export function buildWolfBodyGeometry(variant, tier, fleece = FLEECES[0]) {
  const isGrey = tier === 1;
  const wolfFleece = isGrey
    ? { wool: COLORS.wolfWool, woolLight: '#e2ddd2', woolShade: COLORS.wolfWoolShade }
    : fleece;
  const base = buildSheepBodyGeometry(variant, wolfFleece);
  if (tier >= 3) return base;

  // Small upgrades on top of the sheep silhouette, merged with the same
  // vertex-color pipeline so the draw-call budget stays flat.
  const parts = [];
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const add = (color, x, y, z, sx, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) =>
    parts.push({ geo: sphere, color, matrix: placeMatrix(x, y, z, sx, sy, sz, rx, ry, rz) });

  // Upright pointed ears, replacing the look of the sheep's low wide ones.
  const earScale = tier === 1 ? 1 : 0.6;
  const earGrey = isGrey ? COLORS.wolfWoolShade : '#9d968b';
  for (const side of [-1, 1]) {
    add(earGrey, side * 0.3, 1.28, 0.44, 0.09 * earScale, 0.3 * earScale, 0.06 * earScale, 0, 0, side * -0.18);
    add(isGrey ? '#a89f92' : '#b5ada1', side * 0.29, 1.26, 0.47, 0.055 * earScale, 0.2 * earScale, 0.03 * earScale, 0, 0, side * -0.18);
  }
  // A fluffy tail. Tier 2 shows only a peek of it.
  const tailScale = tier === 1 ? 1 : 0.5;
  add(wolfFleece.woolShade, 0, 0.66, -0.78, 0.17 * tailScale, 0.15 * tailScale, 0.2 * tailScale, 0, 0, 0.5);
  add(wolfFleece.woolLight, 0, 0.72, -0.84, 0.1 * tailScale, 0.09 * tailScale, 0.12 * tailScale, 0, 0, 0.5);

  const upgrade = mergeColored(parts);
  sphere.dispose();

  const pos = [];
  const nor = [];
  const col = [];
  for (const geo of [base, upgrade]) {
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const c = geo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function buildTreeGeometry() {
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const geo = mergeColored([
    { geo: cyl, color: COLORS.trunk, matrix: placeMatrix(0, 0.6, 0, 0.16, 1.2, 0.16) },
    { geo: sphere, color: COLORS.leaf, matrix: placeMatrix(0, 1.6, 0, 0.75, 0.7, 0.75) },
    { geo: sphere, color: COLORS.leafLight, matrix: placeMatrix(0.45, 1.35, 0.25, 0.5) },
    { geo: sphere, color: COLORS.leafLight, matrix: placeMatrix(-0.45, 1.4, -0.1, 0.52) },
    { geo: sphere, color: COLORS.leaf, matrix: placeMatrix(0.05, 2.05, -0.15, 0.5) },
  ]);
  sphere.dispose();
  cyl.dispose();
  return geo;
}

// ---------------------------------------------------------------------------
// Particle pools (sparkles on tap, confetti on celebration).

function createSparklePool(scene, size, texture) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(size * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: '#fff3b0',
    map: texture,
    size: 0.32,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const velocities = new Array(size).fill(null).map(() => ({ vx: 0, vy: 0, vz: 0 }));
  const DURATION = 0.7;
  let sinceBurst = 999;

  function burst(x, y, z) {
    for (let i = 0; i < size; i++) {
      const angle = (i / size) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 0.5 + Math.random() * 0.7;
      velocities[i] = { vx: Math.cos(angle) * speed, vy: 1.0 + Math.random() * 0.7, vz: Math.sin(angle) * speed };
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;
    sinceBurst = 0;
  }

  function update(dt) {
    sinceBurst += dt;
    if (sinceBurst > DURATION) {
      mat.opacity = 0;
      return;
    }
    mat.opacity = 1 - sinceBurst / DURATION;
    for (let i = 0; i < size; i++) {
      const v = velocities[i];
      positions[i * 3] += v.vx * dt;
      positions[i * 3 + 1] += v.vy * dt;
      positions[i * 3 + 2] += v.vz * dt;
      v.vy -= dt * 2.2;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { burst, update };
}

function createConfettiPool(scene, size, texture) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(size * 3);
  const colors = new Float32Array(size * 3);
  const c = new THREE.Color();
  for (let i = 0; i < size; i++) {
    c.set(NUMBER_COLORS[i % NUMBER_COLORS.length]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    map: texture,
    size: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const velocities = new Array(size).fill(null).map(() => ({ vx: 0, vy: 0, vz: 0, wobble: 0 }));
  const DURATION = 3.2;
  let since = 999;

  function start(cx, cz, spread) {
    for (let i = 0; i < size; i++) {
      positions[i * 3] = cx + (Math.random() - 0.5) * spread * 2;
      positions[i * 3 + 1] = 2.8 + Math.random() * 2.2;
      positions[i * 3 + 2] = cz + (Math.random() - 0.5) * spread;
      velocities[i] = {
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(0.6 + Math.random() * 0.8),
        vz: (Math.random() - 0.5) * 0.3,
        wobble: Math.random() * Math.PI * 2,
      };
    }
    geo.attributes.position.needsUpdate = true;
    since = 0;
  }

  function update(dt, t) {
    since += dt;
    if (since > DURATION) {
      mat.opacity = 0;
      return;
    }
    mat.opacity = since > DURATION - 0.6 ? (DURATION - since) / 0.6 : 1;
    for (let i = 0; i < size; i++) {
      const v = velocities[i];
      positions[i * 3] += (v.vx + Math.sin(t * 3 + v.wobble) * 0.5) * dt;
      positions[i * 3 + 1] += v.vy * dt;
      positions[i * 3 + 2] += v.vz * dt;
      if (positions[i * 3 + 1] < 0.05) positions[i * 3 + 1] = 0.05;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { start, update };
}

function createRipplePool(scene, size, texture) {
  const geo = new THREE.CircleGeometry(1, 24);
  const meshes = Array.from({ length: size }, () => {
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, age: 0 };
  });
  let next = 0;
  const DURATION = 0.6;
  // The pool keeps its own frame clock: update() runs once per rendered
  // frame, so the age of each ripple is the accumulated frame delta.
  let lastUpdate = null;

  function burst(x, z, scale) {
    const r = meshes[next];
    next = (next + 1) % size;
    r.age = 0;
    r.mesh.position.set(x, 0.02, z);
    r.mesh.scale.setScalar(scale);
    r.mesh.visible = true;
  }

  function update() {
    const now = performance.now();
    if (lastUpdate === null) lastUpdate = now;
    const dt = Math.min((now - lastUpdate) / 1000, 0.1);
    lastUpdate = now;
    for (const r of meshes) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const p = r.age / DURATION;
      if (p >= 1) {
        r.mesh.visible = false;
        r.mat.opacity = 0;
        continue;
      }
      const ease = 1 - Math.pow(1 - p, 2);
      r.mat.opacity = 0.65 * (1 - p);
      r.mesh.scale.setScalar(r.mesh.scale.x + ease * 0.02);
    }
  }

  function dispose() {
    geo.dispose();
    meshes.forEach((r) => r.mat.dispose());
  }

  return { burst, update, dispose };
}

// Confetti and candy: what is left where a sheep popped. Two instanced
// meshes carry every burst of the round (2 draw calls total), each sheep
// owning a fixed slice of the instances so back-to-back pops never steal
// pieces from each other. Piece paths, spins and landing spots come from
// mulberry32 seeded with the round's seed and the sheep's index, so the
// frozen ?scene= fixtures render the same piles every time. A piece flies
// on a simple ballistic arc, lands lying flat at ground level and stays
// there until the round ends.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFETTI_PER_BURST = 18;
const CANDY_PER_BURST = 6;
const PIECES_PER_BURST = CONFETTI_PER_BURST + CANDY_PER_BURST;

function createPopBurstPool(scene, bursts) {
  const confettiGeo = new THREE.PlaneGeometry(0.17, 0.09);
  const candyGeo = new THREE.IcosahedronGeometry(0.055, 0);
  const confettiMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const candyMat = new THREE.MeshLambertMaterial();
  const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, bursts * CONFETTI_PER_BURST);
  const candyMesh = new THREE.InstancedMesh(candyGeo, candyMat, bursts * CANDY_PER_BURST);
  confettiMesh.frustumCulled = false;
  candyMesh.frustumCulled = false;
  scene.add(confettiMesh);
  scene.add(candyMesh);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpColor = new THREE.Color();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpVec = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const pieces = Array.from({ length: bursts * PIECES_PER_BURST }, () => ({
    start: -1, slot: 0, candy: false, scale: 1,
    x0: 0, y0: 0.7, z0: 0, vx: 0, vy: 0, vz: 0, g: 2.3, T: 1, delay: 0,
    lx: 0, lz: 0, spin: 4, rest: 0, tilt: 0, live: false, settled: false,
  }));
  let dirty = false;

  function writeHidden(p) {
    (p.candy ? candyMesh : confettiMesh).setMatrixAt(p.slot, hiddenMatrix);
    dirty = true;
  }

  function writeSettled(p) {
    // Confetti lies flat on the grass; candy rests as it falls.
    const rx = p.candy ? p.tilt : -Math.PI / 2;
    tmpEuler.set(rx, 0, p.rest);
    tmpQuat.setFromEuler(tmpEuler);
    tmpVec.set(p.lx, p.candy ? 0.035 : 0.02, p.lz);
    tmpScale.setScalar(p.scale);
    (p.candy ? candyMesh : confettiMesh).setMatrixAt(p.slot,
      new THREE.Matrix4().compose(tmpVec, tmpQuat, tmpScale));
    dirty = true;
  }

  const tmpMatrix = new THREE.Matrix4();
  function writeFlying(p, e) {
    tmpEuler.set(p.spin * e, p.spin * 0.6 * e, p.rest);
    tmpQuat.setFromEuler(tmpEuler);
    tmpVec.set(p.x0 + p.vx * e, p.y0 + p.vy * e - 0.5 * p.g * e * e, p.z0 + p.vz * e);
    tmpScale.setScalar(p.scale);
    tmpMatrix.compose(tmpVec, tmpQuat, tmpScale);
    (p.candy ? candyMesh : confettiMesh).setMatrixAt(p.slot, tmpMatrix);
    dirty = true;
  }

  function burst(index, x, z, number, startTime, { settled = false, slow = false, seed = 1 } = {}) {
    const rand = mulberry32((seed ^ (index * 2654435761)) >>> 0);
    const g = slow ? 1.1 : 2.3;
    const spread = slow ? 0.6 : 1;
    const y0 = 0.7;
    for (let i = 0; i < PIECES_PER_BURST; i++) {
      const candy = i >= CONFETTI_PER_BURST;
      const p = pieces[index * PIECES_PER_BURST + i];
      p.candy = candy;
      p.slot = candy ? index * CANDY_PER_BURST + (i - CONFETTI_PER_BURST) : index * CONFETTI_PER_BURST + i;
      p.start = startTime;
      p.live = true;
      p.settled = !!settled;
      p.g = g;
      p.x0 = x;
      p.y0 = y0;
      p.z0 = z;
      p.scale = 0.7 + rand() * 0.6;
      const color = NUMBER_COLORS[(number - 1 + i) % NUMBER_COLORS.length];
      tmpColor.set(color);
      (candy ? candyMesh : confettiMesh).setColorAt(p.slot, tmpColor);
      const ang = rand() * Math.PI * 2;
      const speed = (0.3 + rand() * 0.65) * spread;
      p.vx = Math.cos(ang) * speed;
      p.vz = Math.sin(ang) * speed;
      p.vy = (1.4 + rand() * 1.1) * (slow ? 0.7 : 1);
      p.delay = rand() * 0.12;
      // Flight time until the arc comes back down to grass level.
      p.T = (p.vy + Math.sqrt(p.vy * p.vy + 2 * g * (y0 - 0.02))) / g;
      p.lx = x + p.vx * p.T;
      p.lz = z + p.vz * p.T;
      p.spin = (3 + rand() * 6) * (rand() < 0.5 ? -1 : 1);
      p.rest = rand() * Math.PI * 2;
      p.tilt = rand() * 0.6 - 0.3;
      if (settled) {
        writeSettled(p);
      } else {
        writeHidden(p);
      }
    }
    if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
    if (candyMesh.instanceColor) candyMesh.instanceColor.needsUpdate = true;
    dirty = true;
  }

  function update(t) {
    dirty = false;
    for (const p of pieces) {
      if (!p.live) continue;
      if (p.settled) continue;
      const e = t - p.start - p.delay;
      if (e <= 0) {
        writeHidden(p);
      } else if (e >= p.T) {
        p.settled = true;
        writeSettled(p);
      } else {
        writeFlying(p, e);
      }
    }
    if (dirty) {
      confettiMesh.instanceMatrix.needsUpdate = true;
      candyMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function reset() {
    for (const p of pieces) {
      p.live = false;
      p.settled = false;
      p.start = -1;
      writeHidden(p);
    }
    confettiMesh.instanceMatrix.needsUpdate = true;
    candyMesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    scene.remove(confettiMesh);
    scene.remove(candyMesh);
    confettiGeo.dispose();
    candyGeo.dispose();
    confettiMat.dispose();
    candyMat.dispose();
    if (confettiMesh.instanceColor) confettiMesh.instanceColor.dispose?.();
    if (candyMesh.instanceColor) candyMesh.instanceColor.dispose?.();
  }

  return { burst, update, reset, dispose };
}

// ---------------------------------------------------------------------------

function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 4;
  if (cores <= 2 || dpr > 3 || mem <= 2) return 'low';
  if (cores <= 4) return 'mid';
  return 'high';
}

export function createSceneRenderer({ container, onTap, reducedMotion, onFatal, getOverlayRect, getBottomOverlayRect }) {
  let tier = detectTier();
  let night = false;
  let calm = false;

  const canvas = document.createElement('canvas');
  canvas.className = 'sheep-canvas';
  container.appendChild(canvas);

  // alpha: the pastel sky gradient is CSS on the container behind the
  // canvas, which is cheaper than a sky dome and matches the DOM fallback.
  // MSAA only where it is visible and affordable: on a dense (DPR 2+)
  // phone screen it costs a lot and the pixels already hide the edges.
  // It is fixed at context creation, so the step-down below cannot undo it.
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: tier === 'high' && dpr < 2,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(dpr, tier === 'low' ? 1 : tier === 'mid' ? 1.5 : 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 16, 46);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);

  scene.add(new THREE.HemisphereLight('#e3e3f3', '#485e60', 1.6));
  const sun = new THREE.DirectionalLight('#ffdfbe', 2.1);
  sun.position.set(-5, 9, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dbe9ff', 0.35);
  fill.position.set(6, 4, -4);
  scene.add(fill);

  // Ground: a big gently rolling plane. Vertex colors mottle it with soft
  // grass patches so it reads as a real meadow instead of one flat swatch;
  // material.color still carries the day/calm/night tint, and multiplies
  // these near-white variations, so palette switching keeps working.
  const groundGeo = new THREE.PlaneGeometry(70, 70, 48, 48);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const y = gp.getY(i);
    const far = Math.max(0, Math.abs(y) - 5) * 0.015;
    gp.setZ(i, Math.sin(x * 0.45) * 0.08 + Math.cos(y * 0.5) * 0.08 + far * far * 0.4);
  }
  groundGeo.computeVertexNormals();
  {
    const shades = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      // Two smooth octaves: broad patches plus a finer mottle, both fixed
      // (not round-seeded) so the meadow looks the same every round.
      const broad = Math.sin(x * 0.32 + 1.7) * Math.cos(y * 0.41 + 0.6)
        + 0.6 * Math.sin(x * 0.71 + y * 0.53 + 2.1);
      const fine = Math.sin(x * 1.9 + 4.2) * Math.sin(y * 2.3 + 1.3) * 0.35;
      const t = Math.max(0, Math.min(1, 0.5 + (broad + fine) * 0.28));
      // Dry sunlit patches lean warm; shaded patches lean deep green.
      shades[i * 3] = 0.84 + t * 0.26;
      shades[i * 3 + 1] = 0.92 + t * 0.12;
      shades[i * 3 + 2] = 0.88 + t * 0.1;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(shades, 3));
  }
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: COLORS.ground, vertexColors: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);

  // Rolling hills behind the field, layered greens.
  const hillGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const hills = [
    [-9, -13, 9, 2.6, COLORS.hillA], [8, -15, 11, 3.2, COLORS.hillB], [0, -19, 14, 3.4, COLORS.hillC],
    [-16, -17, 10, 3.0, COLORS.hillB], [17, -12, 8, 2.2, COLORS.hillA], [-5, -22, 12, 4.2, COLORS.hillC],
  ];
  const hillMeshes = [];
  hills.forEach(([x, z, r, h, color], i) => {
    const m = new THREE.Mesh(hillGeo, new THREE.MeshLambertMaterial({ color }));
    m.scale.set(r, h * 0.42, r * 0.8);
    m.position.set(x, -0.1, z);
    scene.add(m);
    hillMeshes.push([m, ['hillA', 'hillB', 'hillC'][i % 3]]);
  });

  // Applies the day/night palette to the ground, hills and fog only. The
  // sky behind the transparent canvas is CSS on the container; the sheep,
  // trees and flowers keep their colors so they still read as daytime
  // objects under a dimmer meadow.
  function applyPalette() {
    const c = night ? NIGHT_COLORS : (calm ? CALM_COLORS : COLORS);
    ground.material.color.set(c.ground);
    hillMeshes.forEach(([m, key]) => m.material.color.set(c[key]));
    scene.fog.color.set(c.fog);
  }

  function applyNight(on) {
    night = !!on;
    applyPalette();
  }

  function applyCalm(on) {
    calm = !!on;
    applyPalette();
  }

  // A few round toy trees along the back.
  const treeGeo = buildTreeGeometry();
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  [[-6.5, -7.5, 1.1], [6.8, -8.2, 1.3], [-9.5, -5.5, 0.9], [10, -5, 1.0], [1.5, -10.5, 1.2]].forEach(([x, z, s]) => {
    const t = new THREE.Mesh(treeGeo, treeMat);
    t.position.set(x, 0, z);
    t.scale.setScalar(s);
    t.rotation.y = x * 0.7;
    scene.add(t);
  });

  // Flowers: one instanced mesh for petals, one for centers.
  const flowerCount = tier === 'low' ? 28 : 80;
  const petalGeo = new THREE.SphereGeometry(0.075, 7, 5);
  const petalMat = new THREE.MeshLambertMaterial({ color: '#fff8ed' });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, flowerCount);
  const centerGeo = new THREE.SphereGeometry(0.03, 6, 4);
  const centers = new THREE.InstancedMesh(centerGeo, new THREE.MeshLambertMaterial({ color: '#ffe066' }), flowerCount);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const petalColors = ['#ffb3c6', '#fff8ed', '#ffe08a', '#c9b6ff', '#ffc4a3', '#fff8ed'];
    for (let i = 0; i < flowerCount; i++) {
      const x = (seededRand(9001, i) - 0.5) * 22;
      const z = -9 + seededRand(9002, i) * 14;
      const s = 0.8 + seededRand(9003, i) * 0.6;
      m.compose(new THREE.Vector3(x, 0.06 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, 0.45 * s, s));
      petals.setMatrixAt(i, m);
      c.set(petalColors[i % petalColors.length]);
      petals.setColorAt(i, c);
      m.compose(new THREE.Vector3(x, 0.085 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      centers.setMatrixAt(i, m);
    }
    petals.instanceMatrix.needsUpdate = true;
    if (petals.instanceColor) petals.instanceColor.needsUpdate = true;
    centers.instanceMatrix.needsUpdate = true;
  }
  scene.add(petals);
  scene.add(centers);

  // Sun and clouds as soft sprites, unaffected by fog.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: buildSunTexture(), transparent: true, depthWrite: false, fog: false }));
  sunSprite.scale.set(4.5, 4.5, 1);
  sunSprite.position.set(-7, 9.5, -24);
  scene.add(sunSprite);

  const cloudTexture = buildCloudTexture();
  const clouds = [];
  const cloudCount = tier === 'low' ? 3 : 6;
  for (let i = 0; i < cloudCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false, fog: false, opacity: 0.35 });
    const sprite = new THREE.Sprite(mat);
    const w = 5 + seededRand(77, i) * 3;
    sprite.scale.set(w, w * 0.5, 1);
    sprite.position.set(-14 + seededRand(78, i) * 28, 5.5 + seededRand(79, i) * 4, -18 - seededRand(80, i) * 6);
    scene.add(sprite);
    clouds.push({ sprite, speed: 0.08 + seededRand(81, i) * 0.1 });
  }

  const butterflies = [];

  // Shared sheep assets.
  const bodyGeos = FLEECES.map((fleece, i) => buildSheepBodyGeometry(i % 3, fleece));
  const eyeGeo = buildEyeGeometry();
  const wolfEyeGeo = buildWolfEyeGeometry();
  const wolfBodyGeos = [1, 2, 3].map((tier) =>
    [0, 1, 2].map((variant) => buildWolfBodyGeometry(variant, tier, FLEECES[variant % FLEECES.length])));
  // One material for every sheep body and eye, so the low tier can swap
  // the whole flock to cheaper Lambert shading in one place.
  let sheepMat = tier === 'low'
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  function useLowSheepMaterial() {
    if (sheepMat.isMeshLambertMaterial) return;
    const old = sheepMat;
    sheepMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    scene.traverse((o) => {
      if (o.material === old) o.material = sheepMat;
    });
    old.dispose();
  }
  const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const shadowMat = new THREE.MeshBasicMaterial({ map: buildShadowTexture(), transparent: true, depthWrite: false });
  const pickGeo = new THREE.SphereGeometry(0.9, 8, 6);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  // Name-label textures, built on demand and shared across rounds: a
  // name's pill is identical wherever that name appears.
  const nameTextureCache = new Map();
  function nameTexture(name) {
    let tex = nameTextureCache.get(name);
    if (!tex) {
      tex = buildNameTexture(name);
      nameTextureCache.set(name, tex);
    }
    return tex;
  }
  // Whether floating name labels are on. Toggled from app.js; never
  // changes counting, only what is drawn.
  let namesOn = false;
  const starTexture = buildStarTexture();
  const dotTexture = buildDotTexture();

  let sheepGroup = new THREE.Group();
  scene.add(sheepGroup);
  let sheep = [];
  let flockCenter = { x: 0, z: 0 };
  let flockSpread = 3;
  const sparklePool = createSparklePool(scene, tier === 'low' ? 14 : 26, starTexture);
  const confettiPool = createConfettiPool(scene, tier === 'low' ? 40 : 90, dotTexture);
  const ripplePool = createRipplePool(scene, tier === 'low' ? 4 : 6, buildRippleTexture());
  // The pop burst: confetti and candy where a counted sheep stood. One
  // fixed slice of instances per sheep, so overlapping pops never collide.
  const popPool = createPopBurstPool(scene, MAX_SHEEP);

  let lastState = null;
  // How this round's flock moves. Round 1 is perfectly still; later
  // rounds are faster, bouncier and eventually jittery. Calm mode keeps
  // the same paths but slides the motion clock down, so the flock reads
  // as slow and quiet without changing what the round asks for.
  let motion = motionForRound(1, lastState && lastState.difficulty);
  let isPortrait = true;

  function layoutRegion(n) {
    // Region area grows with the flock; its shape follows the screen so a
    // portrait phone gets a tall field and landscape a wide one.
    // Portrait is bound by the narrow horizontal field of view, so the
    // field is kept slim and deep there; sheep read larger that way.
    const area = Math.max(n, 2) * 2.6;
    const ratio = isPortrait ? 0.42 : 2.1;
    return { width: Math.sqrt(area * ratio), depth: Math.sqrt(area / ratio) };
  }

  function buildFlock(state) {
    lastState = state;
    namesOn = !!state.namesOn;
    motion = state.calmOn ? calmMotion(state.round, state.difficulty) : motionForRound(state.round, state.difficulty);
    // A fresh board leaves only grass: no confetti piles from the last round.
    popPool.reset();
    scene.remove(sheepGroup);
    sheepGroup = new THREE.Group();
    scene.add(sheepGroup);
    sheep = [];

    const region = layoutRegion(state.sheepCount);
    const positions = layoutPositions(state.seed + (isPortrait ? 0 : 7), state.sheepCount, {
      width: region.width,
      depth: region.depth,
      minSeparation: 1.3,
    });

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < state.sheepCount; i++) {
      const g = new THREE.Group();
      const scale = 0.92 + seededRand(state.seed, i) * 0.16;
      g.scale.setScalar(scale);

      const isWolf = state.wolfIndex === i;
      const tier = isWolf ? wolfDisguiseTier(state.round) : 0;
      const body = new THREE.Mesh(
        isWolf ? wolfBodyGeos[tier - 1][i % 3] : bodyGeos[i % bodyGeos.length],
        sheepMat
      );
      g.add(body);

      const eyes = [-1, 1].map((side) => {
        const eye = new THREE.Mesh(isWolf ? wolfEyeGeo : eyeGeo, sheepMat);
        eye.position.set(side * 0.123, 0.867, 0.709);
        g.add(eye);
        return eye;
      });

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.012, 0.05);
      g.add(shadow);

      // Optional playful name label above the head, floating gently while the
      // sheep grazes. A counted sheep pops away, label and all.
      const nameSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: nameTexture(sheepName(state.seed, i)), transparent: true, depthTest: false, fog: false })
      );
      nameSprite.scale.set(1.7, 0.425, 1);
      nameSprite.position.set(0, 1.5, 0.1);
      nameSprite.visible = namesOn;
      g.add(nameSprite);

      // Large invisible pick target so small fingers land the tap.
      const pick = new THREE.Mesh(pickGeo, pickMat);
      pick.position.y = 0.62;
      g.add(pick);

      const pos = positions[i];
      g.position.set(pos.x, 0, pos.z);
      // Every sheep faces roughly toward the camera so its face shows.
      g.rotation.y = (seededRand(state.seed, i + 100) - 0.5) * 1.2;

      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);

      sheepGroup.add(g);
      sheep.push({
        group: g,
        body,
        eyes,
        pick,
        nameSprite,
        counted: false,
        baseScale: scale,
        popStart: -1,
        popNumber: 0,
        origin: { x: pos.x, z: pos.z },
        heading: g.rotation.y,
        index: i,
        phase: seededRand(state.seed, i + 200) * Math.PI * 2,
        bounceStart: -1,
        bounceDur: 0,
        wiggle: false,
        nextBlink: 1 + Math.random() * 4,
        blinkStart: -1,
        nextHop: 5 + Math.random() * 8,
        hopStart: -1,
        isWolf,
        tier,
      });
    }

    flockCenter = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    flockSpread = Math.max(maxX - minX, maxZ - minZ, 1.5) / 2 + 0.8;
    butterflies.forEach((b, i) => {
      b.cx = flockCenter.x + (i - 1) * Math.max(1.2, flockSpread * 0.7);
      b.cz = flockCenter.z - 0.5 + i * 0.6;
    });

    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
    fitCamera(minX, maxX, minZ, maxZ);
  }

  // Frame the whole flock, as large as possible, below the number plate.
  const cameraDir = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraBase = new THREE.Vector3();
  let cameraDistance = 9;
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const proj = new THREE.Vector3();

  function fitCamera(minX, maxX, minZ, maxZ) {
    if (!Number.isFinite(minX)) return;
    // Pad by the round's roam radius so a wandering sheep can never leave
    // the frame, however chaotic the round gets.
    const pad = 1.0 + roamRadius(lastState ? lastState.round : 1, lastState && lastState.difficulty);
    const top = 1.9;
    const xs = [minX - pad, maxX + pad];
    const zs = [minZ - pad, maxZ + pad];
    const ys = [0, top];
    let k = 0;
    xs.forEach((x) => zs.forEach((z) => ys.forEach((y) => corners[k++].set(x, y, z))));

    // Reserve space for the plate and bottom hint. The plate moves to
    // the left only on short landscape screens, not every wide screen.
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const overlay = getOverlayRect?.() || { bottom: 0, right: 0 };
    const bottomOverlay = getBottomOverlayRect?.();
    const sidePlate = !isPortrait && h <= 520;
    const topLimit = sidePlate ? .92 : Math.max(.15, 1 - 2 * overlay.bottom / h - .06);
    const leftLimit = sidePlate ? Math.min(.2, -1 + 2 * overlay.right / w + .06) : -.94;
    const sideLimit = 0.94;
    // The Done button sits across the bottom; keep sheep above it so every
    // one of them stays tappable.
    let bottomLimit = -.84;
    if (bottomOverlay && bottomOverlay.height > 0) {
      const wanted = -1 + 2 * (h - bottomOverlay.top) / h + .04;
      bottomLimit = Math.max(-.94, Math.min(-.2, wanted));
    }
    if (topLimit - bottomLimit < .5) bottomLimit = topLimit - .5;

    // A lowish camera keeps the faces, the horizon and a strip of sky in
    // frame; portrait gets a wider lens so the flock can sit closer.
    camera.fov = isPortrait ? 54 : 46;
    // Shift the optical center into the usable rectangle before fitting.
    // Fitting a centered camera to a one-sided rectangle cannot converge.
    camera.setViewOffset(w, h, -(leftLimit + sideLimit) * w / 4,
      (topLimit + bottomLimit) * h / 4, w, h);
    camera.updateProjectionMatrix();
    const elevation = isPortrait ? 0.44 : 0.38;
    cameraDir.set(0, Math.sin(elevation), Math.cos(elevation));
    cameraTarget.set((minX + maxX) / 2, 0.6, (minZ + maxZ) / 2);

    const fits = (d) => {
      camera.position.copy(cameraTarget).addScaledVector(cameraDir, d);
      camera.lookAt(cameraTarget);
      camera.updateMatrixWorld();
      for (let i = 0; i < corners.length; i++) {
        proj.copy(corners[i]).project(camera);
        if (proj.x < leftLimit || proj.x > sideLimit || proj.y < bottomLimit || proj.y > topLimit) return false;
      }
      return true;
    };
    let lo = 2;
    let hi = 60;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    cameraDistance = hi;
    fits(cameraDistance);
    cameraBase.copy(camera.position);
  }

  function markCounted(index, number, animate = true) {
    const s = sheep[index];
    // The wolf is never counted, so it never pops.
    if (!s || s.counted || s.isWolf) return;
    s.counted = true;
    if (lastState && !lastState.counted.includes(index)) {
      lastState = { ...lastState, counted: [...lastState.counted, index] };
    }
    if (animate && !reducedMotion) {
      // The pop: the sheep puffs up for a beat, then frame() hides the
      // group and bursts the confetti where it stood.
      s.popStart = elapsedSeconds();
      s.popNumber = number;
    } else {
      // Resume, fixtures, an orientation rebuild or reduced motion: no
      // pop to watch, so the sheep is simply gone and its confetti and
      // candy already lie settled on the grass at its home spot.
      s.group.visible = false;
      const calm = isCalmLevel(lastState && lastState.difficulty);
      popPool.burst(index, s.origin.x, s.origin.z, number, elapsedSeconds(), {
        settled: true, slow: calm, seed: lastState ? lastState.seed : 1,
      });
    }
  }

  function wiggleSheep(index) {
    const s = sheep[index];
    if (!s || reducedMotion) return;
    s.bounceStart = elapsedSeconds();
    s.bounceDur = 0.34;
    s.wiggle = true;
  }

  // The disguise drops: on reveal the wolf hops on the existing
  // tap-reaction plumbing and, from tier 2 up, swaps to the fully grey
  // tier-1 body so the reveal has something to show even late in the game.
  function revealWolf(index) {
    const s = sheep[index];
    if (!s) return;
    // The frame measures reactions on the round's clock, not the raw one.
    s.bounceStart = elapsedSeconds();
    s.bounceDur = 0.9;
    s.wiggle = false;
    if (s.tier >= 2) s.body.geometry = wolfBodyGeos[0][index % 3];
  }

  function celebrate() {
    // Counted sheep settle quietly. No confetti or synchronized jumping.
  }

  const raycaster = new THREE.Raycaster();
  const pointerStart = { x: 0, y: 0, t: 0 };
  const pointerVec = new THREE.Vector2();

  function onPointerDown(evt) {
    pointerStart.x = evt.clientX;
    pointerStart.y = evt.clientY;
    pointerStart.t = performance.now();
  }
  function onPointerUp(evt) {
    const dx = evt.clientX - pointerStart.x;
    const dy = evt.clientY - pointerStart.y;
    const dt = performance.now() - pointerStart.t;
    // A drag or a long press never registers as a tap.
    if (Math.hypot(dx, dy) > 12 || dt > 700) return;
    const rect = canvas.getBoundingClientRect();
    pointerVec.set(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerVec, camera);
    // A popped sheep is gone: its empty spot cannot be tapped, so a tap
    // there passes through to a sheep standing behind it.
    const tappable = sheep.filter((s) => !s.counted);
    const targets = tappable.map((s) => s.pick);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const hit = tappable.find((s) => s.pick === hits[0].object);
      if (hit) onTap(hit.index);
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp, { passive: true });

  let resizeTimer = null;
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const nowPortrait = h >= w;
    if (nowPortrait !== isPortrait && lastState) {
      // Orientation flipped: re-lay the field for the new shape. A
      // soft-keyboard resize never crosses this line, so sheep hold still.
      isPortrait = nowPortrait;
      buildFlock(lastState);
    } else {
      isPortrait = nowPortrait;
      if (sheep.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        sheep.forEach((s) => {
          minX = Math.min(minX, s.origin.x);
          maxX = Math.max(maxX, s.origin.x);
          minZ = Math.min(minZ, s.origin.z);
          maxZ = Math.max(maxZ, s.origin.z);
        });
        fitCamera(minX, maxX, minZ, maxZ);
      }
    }
  }
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 60);
  });
  resizeObserver.observe(container);
  resize();

  let contextLost = false;
  function onContextLost(e) {
    e.preventDefault();
    contextLost = true;
    setTimeout(() => {
      if (contextLost) onFatal?.();
    }, 2000);
  }
  function onContextRestored() {
    contextLost = false;
  }
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  const clock = new THREE.Clock();
  // The round's animation clock. setRoundClock resumes a saved board at
  // the exact time it was left, so wandering sheep are standing where
  // they were when the player came back. THREE.Clock only exposes
  // elapsedTime through getDelta(), so the frame loop stays the writer.
  let clockOffset = 0;
  let lastElapsed = 0;
  let clockBase = 0;
  function elapsedSeconds() {
    return clockOffset + (lastElapsed - clockBase);
  }
  function setRoundClock(seconds) {
    clockOffset = Number.isFinite(Number(seconds)) && Number(seconds) >= 0 ? Number(seconds) : 0;
    // getDelta() also resyncs the clock, so no hidden-tab gap leaks into
    // the next frame after a resume.
    clockBase = clock.getDelta() >= 0 ? clock.elapsedTime : 0;
    lastElapsed = clockBase;
    clock.getDelta();
  }
  let frameAvg = 16;
  let animId = null;
  let lowTierAccum = 0;
  // Adaptive quality: two one-way steps per session, each only after the
  // smoothed frame time has stayed over budget for a while, so a single
  // long frame (a flock rebuild, a tab coming back) never trips one.
  // Step 1 drops the pixel ratio to 1; step 2 is the full low tier.
  let overBudget = 0;
  let pixelStepped = false;
  // While a full panel covers the pasture it only needs to drift: render
  // a few times a second instead of at display rate (see setBackdropMode).
  let backdrop = false;
  let backdropAccum = 0;
  const BACKDROP_FPS = 12;

  function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function frame() {
    animId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    // Advance the round's clock. Without this write elapsedSeconds() never
    // moved outside a resumed board, so sheep stood frozen and a counted
    // sheep's number and ribbon never grew in.
    lastElapsed = clock.elapsedTime;
    frameAvg = frameAvg * 0.9 + dt * 1000 * 0.1;
    if (tier !== 'low' && !backdrop && clock.elapsedTime > 2) {
      // One-way steps down within a session, to avoid oscillating.
      const budget = pixelStepped ? 26 : 20;
      const hold = pixelStepped ? 2 : 1;
      overBudget = frameAvg > budget ? overBudget + dt : 0;
      if (overBudget > hold) {
        overBudget = 0;
        if (!pixelStepped) {
          pixelStepped = true;
          if (renderer.getPixelRatio() > 1) renderer.setPixelRatio(1);
        } else {
          tier = 'low';
          renderer.setPixelRatio(1);
          useLowSheepMaterial();
        }
      }
    }
    if (backdrop) {
      backdropAccum += dt;
      if (backdropAccum < 1 / BACKDROP_FPS) return;
    } else if (tier === 'low') {
      lowTierAccum += dt;
      if (lowTierAccum < 1 / 30) return;
    }
    const stepDt = backdrop ? backdropAccum : tier === 'low' ? lowTierAccum : dt;
    lowTierAccum = 0;
    backdropAccum = 0;

    // The whole frame runs on the round's clock: after a resume it sits
    // at the saved position, so the flock is exactly where it was left.
    const rt = elapsedSeconds();
    const t = rt;
    sheep.forEach((s) => {
      // Breathing.
      const breathe = reducedMotion ? 0 : Math.sin(t * 0.9 + s.phase) * 0.012;
      let sy = 1 + breathe;
      let sx = 1 - breathe * 0.6;
      let y = 0;
      let rz = 0;

      // Seeded, bounded wandering gets gently more varied as the flock
      // grows. Counted sheep stop where they are, ready for sleep.
      if (!reducedMotion && !s.counted) {
        // Tiers 1 and 2 wander a beat out of step with the flock; tier 3
        // keeps perfect time, which is exactly what makes it hard to spot.
        const wolfLag = s.isWolf && s.tier < 3 ? -0.8 : 0;
        const offset = wanderOffset(lastState.seed, s.index, lastState.sheepCount, t + wolfLag, motion);
        s.group.position.x = s.origin.x + offset.x;
        s.group.position.z = s.origin.z + offset.z;
        s.group.rotation.y = s.heading + offset.turn;
        y = Math.sin(t * 2 + s.phase) * 0.008;
      }

      // Tap reaction: squash, then a hop with a little overshoot.
      if (s.bounceStart >= 0) {
        const p = (t - s.bounceStart) / s.bounceDur;
        if (p >= 1) {
          s.bounceStart = -1;
          s.wiggle = false;
        } else if (s.wiggle) {
          rz = Math.sin(p * Math.PI * 4) * 0.035 * (1 - p);
          y += Math.sin(p * Math.PI) * 0.015;
        } else {
          const squash = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) : 0;
          const hop = p >= 0.2 ? Math.sin(((p - 0.2) / 0.8) * Math.PI) : 0;
          sy *= 1 - squash * 0.04 + hop * 0.025;
          sx *= 1 + squash * 0.14 - hop * 0.015;
          y += hop * 0.035;
        }
      }

      const base = s.group.scale.x;
      s.body.scale.set(sx, sy, sx);
      s.eyes.forEach((e) => {
        e.position.y = 0.867 * sy;
      });
      s.group.position.y = y * base;
      s.group.rotation.z = rz;

      // Counted sheep close their eyes, including in reduced motion.
      if (s.counted) s.eyes.forEach((e) => e.scale.set(1, 0.14, 1));
      if (!reducedMotion && !s.counted) {
        if (s.blinkStart < 0 && rt > s.nextBlink) s.blinkStart = rt;
        let eyeY = 1;
        if (s.blinkStart >= 0) {
          const p = (t - s.blinkStart) / 0.18;
          if (p >= 1) {
            s.blinkStart = -1;
            s.nextBlink = rt + 2 + Math.random() * 5;
          } else {
            eyeY = 1 - Math.sin(p * Math.PI) * 0.92;
          }
        }
        s.eyes.forEach((e) => e.scale.set(1, eyeY, 1));
      }

      // The pop: puff up for a beat, then vanish into confetti and candy
      // where the sheep stood.
      if (s.popStart >= 0) {
        const p = (t - s.popStart) / 0.14;
        if (p >= 1) {
          s.popStart = -1;
          s.group.visible = false;
          const calm = isCalmLevel(lastState && lastState.difficulty);
          const pos = s.group.position;
          popPool.burst(s.index, pos.x, pos.z, s.popNumber, t, {
            slow: calm, seed: lastState ? lastState.seed : 1,
          });
        } else if (p > 0) {
          s.group.scale.setScalar(s.baseScale * (1 + 0.25 * p));
        }
      }

      // Name label: a gentle float while grazing. A popped sheep is gone,
      // label and all, with its group.
      if (s.nameSprite) {
        s.nameSprite.visible = namesOn;
        if (namesOn) {
          s.nameSprite.position.y = 1.5 + (reducedMotion ? 0 : Math.sin(t * 1.8 + s.phase) * 0.03);
        }
      }
    });

    clouds.forEach((c) => {
      c.sprite.position.x += (reducedMotion ? 0 : 0.35) * c.speed * stepDt;
      if (c.sprite.position.x > 18) c.sprite.position.x = -18;
    });

    butterflies.forEach((b) => {
      const tt = t * 0.45 + b.phase;
      b.group.position.set(
        b.cx + Math.sin(tt) * 1.6,
        1.35 + Math.sin(tt * 2.3) * 0.35,
        b.cz + Math.cos(tt * 0.8) * 1.1
      );
      b.group.rotation.z = Math.cos(tt) * 0.5;
      const flap = 0.35 + Math.sin(t * 13 + b.phase) * 0.75;
      b.left.rotation.y = flap;
      b.right.rotation.y = -flap;
    });

    sparklePool.update(stepDt);
    confettiPool.update(stepDt, t);
    popPool.update(t);
    ripplePool.update();
    renderer.render(scene, camera);
  }

  function start() {
    if (!animId) frame();
  }
  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', stop);
  window.addEventListener('focus', start);

  start();

  return {
    kind: 'three',
    elapsedSeconds,
    setRoundClock,
    setState(state) {
      buildFlock(state);
      applyNight(!!state.nightOn);
      applyCalm(!!state.calmOn);
    },
    countSheep(index, number) {
      markCounted(index, number, true);
    },
    revealWolf(index) {
      revealWolf(index);
    },
    // Live ground position of a sheep, for the tap ripple. The ripple
    // scale divides by the sheep's own scale so the ring footprint is
    // constant across flock sizes.
    sheepPosition(index) {
      const s = sheep[index];
      if (!s) return null;
      return { x: s.group.position.x, z: s.group.position.z, scale: 1 / s.group.scale.x };
    },
    // Purely visual: a soft ring where the tap landed. The caller supplies
    // ground coordinates so the effect follows the sheep's live position.
    tapRipple(x, z, scale = 1) {
      if (reducedMotion) return;
      ripplePool.burst(x, z, scale);
    },
    wiggleSheep(index) {
      wiggleSheep(index);
    },
    celebrate() {
      celebrate();
    },
    resetRound(state) {
      buildFlock(state);
    },
    setNight(on) {
      applyNight(on);
    },
    setCalm(on) {
      applyCalm(on);
    },
    // A full panel covers the pasture: keep it drifting at a few frames a
    // second instead of redrawing it at display rate under the blur. The
    // clock keeps running, so wander positions and the round clock are
    // unaffected.
    setBackdropMode(on) {
      backdrop = !!on;
      backdropAccum = 0;
    },
    setNames(on) {
      namesOn = !!on;
      if (lastState && !!lastState.namesOn !== namesOn) {
        lastState = { ...lastState, namesOn };
      }
      sheep.forEach((s) => {
        if (s.nameSprite) s.nameSprite.visible = namesOn;
      });
    },
    destroy() {
      stop();
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', stop);
      window.removeEventListener('focus', start);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      ripplePool.dispose();
      popPool.dispose();
      nameTextureCache.forEach((tex) => tex.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}

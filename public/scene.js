// The 3D pasture. Loaded lazily by app.js only when WebGL is available,
// so devices without it never pay for importing three at all.
//
// Art direction: a soft, toy-like meadow. Every sheep is ONE vertex-colored
// mesh (body, wool puffs, face, ears, cheeks, smile, legs, hooves merged at
// boot) plus two eye meshes that blink, a soft contact shadow, a pastel
// ribbon and a number plate. Ten sheep is under a hundred draw calls, which
// is what keeps the low tier smooth.
import * as THREE from 'three';
import { layoutPositions, NUMBER_COLORS } from './layout.js';

const COLORS = {
  wool: '#fdf8f1',
  woolLight: '#ffffff',
  woolShade: '#f3e9dc',
  face: '#f7d5bf',
  earInner: '#f9b6c6',
  cheek: '#ffb0c4',
  mouth: '#7a4f44',
  leg: '#e6c3ab',
  hoof: '#8a6558',
  eyeWhite: '#ffffff',
  pupil: '#2b2530',
  ground: '#9fdc74',
  hillA: '#b4e58a',
  hillB: '#8fd06a',
  hillC: '#6fbd5b',
  trunk: '#c8956d',
  leaf: '#7fcf6f',
  leafLight: '#a5e08e',
  fog: '#e6f4ff',
};

const FONT = '800 150px "Nunito", ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';

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

function buildNumberTextures() {
  const textures = [];
  for (let n = 1; n <= 10; n++) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Soft drop shadow, then a cream plate with a pastel rim.
    ctx.fillStyle = 'rgba(80, 50, 90, 0.18)';
    roundRect(ctx, 26, 34, size - 52, size - 60, 64);
    ctx.fill();
    ctx.fillStyle = NUMBER_COLORS[n - 1];
    roundRect(ctx, 20, 20, size - 40, size - 52, 64);
    ctx.fill();
    ctx.fillStyle = '#fffaf2';
    roundRect(ctx, 34, 34, size - 68, size - 80, 52);
    ctx.fill();
    ctx.fillStyle = '#4a3b5c';
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), size / 2, size / 2 - 8);
    textures.push(makeTexture(canvas));
  }
  return textures;
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
  ctx.fillStyle = '#fff1b8';
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
  ctx.fillStyle = '#ffffff';
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
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  return makeTexture(canvas);
}

// ---------------------------------------------------------------------------
// Sheep geometry. Built once per variant, then shared by every sheep.

function buildSheepBodyGeometry(variant) {
  const sphere = new THREE.SphereGeometry(1, 14, 10);
  const cone = new THREE.CylinderGeometry(1, 1, 1, 10);
  const smile = new THREE.TorusGeometry(0.075, 0.014, 6, 14, Math.PI);
  const parts = [];

  // Round wool body.
  parts.push({ geo: sphere, color: COLORS.wool, matrix: placeMatrix(0, 0.64, -0.02, 0.52, 0.46, 0.5) });

  // Clustered puffs around the body. The variant nudges them so a flock
  // isn't ten identical clones.
  const puffs = [
    [0.36, 0.86, 0.1, 0.24], [-0.36, 0.86, 0.1, 0.24], [0, 0.96, -0.12, 0.26],
    [0.3, 0.9, -0.32, 0.22], [-0.3, 0.9, -0.32, 0.22], [0.42, 0.6, -0.3, 0.22],
    [-0.42, 0.6, -0.3, 0.22], [0, 0.72, -0.5, 0.24], [0.4, 0.58, 0.28, 0.2],
    [-0.4, 0.58, 0.28, 0.2], [0.18, 0.94, 0.3, 0.2], [-0.18, 0.94, 0.3, 0.2],
  ];
  puffs.forEach(([x, y, z, r], i) => {
    const j = seededRand(variant * 17 + 3, i) - 0.5;
    const k = seededRand(variant * 31 + 5, i) - 0.5;
    const color = i % 3 === 0 ? COLORS.woolLight : i % 3 === 1 ? COLORS.wool : COLORS.woolShade;
    parts.push({
      geo: sphere,
      color,
      matrix: placeMatrix(x + j * 0.08, y + k * 0.05, z + j * 0.06, r + k * 0.03),
    });
  });

  // Head, tilted up a touch so the face reads from the camera's height.
  parts.push({ geo: sphere, color: COLORS.face, matrix: placeMatrix(0, 0.8, 0.5, 0.27, 0.26, 0.24) });
  // Wool tuft on top of the head.
  [[0, 1.02, 0.42, 0.14], [0.12, 0.98, 0.5, 0.11], [-0.12, 0.98, 0.5, 0.11]].forEach(([x, y, z, r]) => {
    parts.push({ geo: sphere, color: COLORS.woolLight, matrix: placeMatrix(x, y, z, r) });
  });
  // Ears: face colored outer, pink inner.
  [-1, 1].forEach((side) => {
    parts.push({
      geo: sphere,
      color: COLORS.face,
      matrix: placeMatrix(side * 0.3, 0.88, 0.44, 0.13, 0.08, 0.05, 0, 0, side * -0.55),
    });
    parts.push({
      geo: sphere,
      color: COLORS.earInner,
      matrix: placeMatrix(side * 0.3, 0.88, 0.47, 0.085, 0.05, 0.03, 0, 0, side * -0.55),
    });
  });
  // Rosy cheeks.
  [-1, 1].forEach((side) => {
    parts.push({ geo: sphere, color: COLORS.cheek, matrix: placeMatrix(side * 0.17, 0.74, 0.7, 0.062, 0.045, 0.03) });
  });
  // Little smile (a half torus, arc facing up so it curves like a grin).
  parts.push({ geo: smile, color: COLORS.mouth, matrix: placeMatrix(0, 0.735, 0.735, 1, 1, 1, 0.2, 0, Math.PI) });
  // Tiny nose.
  parts.push({ geo: sphere, color: COLORS.cheek, matrix: placeMatrix(0, 0.775, 0.745, 0.028, 0.022, 0.02) });

  // Legs and hooves.
  [[-0.22, -0.2], [0.22, -0.2], [-0.24, 0.22], [0.24, 0.22]].forEach(([x, z]) => {
    parts.push({ geo: cone, color: COLORS.leg, matrix: placeMatrix(x, 0.2, z, 0.075, 0.34, 0.075) });
    parts.push({ geo: cone, color: COLORS.hoof, matrix: placeMatrix(x, 0.045, z, 0.082, 0.09, 0.082) });
  });

  const geo = mergeColored(parts);
  sphere.dispose();
  cone.dispose();
  smile.dispose();
  return geo;
}

function buildEyeGeometry() {
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const geo = mergeColored([
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(0, 0, 0, 0.085, 0.09, 0.06) },
    { geo: sphere, color: COLORS.pupil, matrix: placeMatrix(0, -0.005, 0.045, 0.052, 0.058, 0.035) },
    { geo: sphere, color: COLORS.eyeWhite, matrix: placeMatrix(0.02, 0.024, 0.078, 0.018) },
  ]);
  sphere.dispose();
  return geo;
}

function buildRibbonGeometry() {
  const torus = new THREE.TorusGeometry(0.2, 0.045, 8, 26);
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const geo = mergeColored([
    // Collar around the neck, tilted with the head.
    { geo: torus, color: '#ffffff', matrix: placeMatrix(0, 0.74, 0.34, 1, 1, 1, Math.PI / 2 - 0.35, 0, 0) },
    // Bow: two loops and a knot, sitting to one side.
    { geo: sphere, color: '#ffffff', matrix: placeMatrix(0.3, 0.86, 0.36, 0.085, 0.06, 0.05, 0, 0, 0.5) },
    { geo: sphere, color: '#ffffff', matrix: placeMatrix(0.36, 0.74, 0.36, 0.085, 0.06, 0.05, 0, 0, -0.5) },
    { geo: sphere, color: '#ffffff', matrix: placeMatrix(0.31, 0.8, 0.39, 0.045) },
  ]);
  torus.dispose();
  sphere.dispose();
  return geo;
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

// ---------------------------------------------------------------------------

function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 4;
  if (cores <= 2 || dpr > 3 || mem <= 2) return 'low';
  if (cores <= 4) return 'mid';
  return 'high';
}

export function createSceneRenderer({ container, onTap, reducedMotion, onFatal, getOverlayRect }) {
  let tier = detectTier();

  const canvas = document.createElement('canvas');
  canvas.className = 'sheep-canvas';
  container.appendChild(canvas);

  // alpha: the pastel sky gradient is CSS on the container behind the
  // canvas, which is cheaper than a sky dome and matches the DOM fallback.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: tier !== 'low',
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'low' ? 1 : 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 16, 46);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);

  scene.add(new THREE.HemisphereLight('#fff4ea', '#7fbf63', 1.05));
  const sun = new THREE.DirectionalLight('#fff2d6', 1.15);
  sun.position.set(-5, 9, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dbe9ff', 0.35);
  fill.position.set(6, 4, -4);
  scene.add(fill);

  // Ground: a big gently rolling plane.
  const groundGeo = new THREE.PlaneGeometry(70, 70, 36, 36);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const y = gp.getY(i);
    const far = Math.max(0, Math.abs(y) - 5) * 0.06;
    gp.setZ(i, Math.sin(x * 0.45) * 0.08 + Math.cos(y * 0.5) * 0.08 + far * far * 0.4);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: COLORS.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);

  // Rolling hills behind the field, layered greens.
  const hillGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const hills = [
    [-9, -13, 9, 2.6, COLORS.hillA], [8, -15, 11, 3.2, COLORS.hillB], [0, -19, 14, 3.4, COLORS.hillC],
    [-16, -17, 10, 3.0, COLORS.hillB], [17, -12, 8, 2.2, COLORS.hillA], [-5, -22, 12, 4.2, COLORS.hillC],
  ];
  hills.forEach(([x, z, r, h, color]) => {
    const m = new THREE.Mesh(hillGeo, new THREE.MeshLambertMaterial({ color }));
    m.scale.set(r, h, r * 0.8);
    m.position.set(x, -0.1, z);
    scene.add(m);
  });

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
  const petalMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, flowerCount);
  const centerGeo = new THREE.SphereGeometry(0.03, 6, 4);
  const centers = new THREE.InstancedMesh(centerGeo, new THREE.MeshLambertMaterial({ color: '#ffe066' }), flowerCount);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const petalColors = ['#ffb3c6', '#ffffff', '#ffe08a', '#c9b6ff', '#ffc4a3', '#ffffff'];
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
  sunSprite.scale.set(9, 9, 1);
  sunSprite.position.set(-7, 9.5, -24);
  scene.add(sunSprite);

  const cloudTexture = buildCloudTexture();
  const clouds = [];
  const cloudCount = tier === 'low' ? 3 : 6;
  for (let i = 0; i < cloudCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
    const sprite = new THREE.Sprite(mat);
    const w = 5 + seededRand(77, i) * 3;
    sprite.scale.set(w, w * 0.5, 1);
    sprite.position.set(-14 + seededRand(78, i) * 28, 5.5 + seededRand(79, i) * 4, -18 - seededRand(80, i) * 6);
    scene.add(sprite);
    clouds.push({ sprite, speed: 0.08 + seededRand(81, i) * 0.1 });
  }

  // Butterflies: two flapping wings each, wandering above the flock.
  const butterflies = [];
  if (tier !== 'low') {
    // Each wing is a pair of ovals (a big upper and a small lower lobe)
    // hinged at the body, so the flap pivots like a real butterfly.
    const lobe = new THREE.CircleGeometry(1, 14);
    const wingGeo = mergeColored([
      { geo: lobe, color: '#ffffff', matrix: placeMatrix(0.11, 0.06, 0, 0.11, 0.085, 1, 0, 0, 0.5) },
      { geo: lobe, color: '#ffffff', matrix: placeMatrix(0.08, -0.07, 0, 0.07, 0.055, 1, 0, 0, -0.4) },
    ]);
    lobe.dispose();
    const bodyGeo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.014, 0.12, 3, 6) : new THREE.SphereGeometry(0.02, 6, 4);
    const bodyMat = new THREE.MeshBasicMaterial({ color: '#5a4a66' });
    ['#ffb3d1', '#b9d8ff', '#fff0a6'].forEach((color, i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
      const left = new THREE.Mesh(wingGeo, mat);
      left.scale.x = -1;
      const right = new THREE.Mesh(wingGeo, mat);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      g.add(left, right, body);
      // Wings lie flat-ish, seen a little from above.
      g.rotation.x = -0.9;
      scene.add(g);
      butterflies.push({ group: g, left, right, phase: i * 2.1, cx: (i - 1) * 2.2, cz: -1 + i * 0.8 });
    });
  }

  // Shared sheep assets.
  const bodyGeos = [0, 1, 2].map(buildSheepBodyGeometry);
  const eyeGeo = buildEyeGeometry();
  const ribbonGeo = buildRibbonGeometry();
  const sheepMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const shadowMat = new THREE.MeshBasicMaterial({ map: buildShadowTexture(), transparent: true, depthWrite: false });
  const pickGeo = new THREE.SphereGeometry(0.9, 8, 6);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const numberTextures = buildNumberTextures();
  const starTexture = buildStarTexture();
  const dotTexture = buildDotTexture();

  let sheepGroup = new THREE.Group();
  scene.add(sheepGroup);
  let sheep = [];
  let flockCenter = { x: 0, z: 0 };
  let flockSpread = 3;
  const sparklePool = createSparklePool(scene, tier === 'low' ? 14 : 26, starTexture);
  const confettiPool = createConfettiPool(scene, tier === 'low' ? 40 : 90, dotTexture);

  let lastState = null;
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
    scene.remove(sheepGroup);
    sheepGroup = new THREE.Group();
    scene.add(sheepGroup);
    sheep = [];

    const region = layoutRegion(state.herdSize);
    const positions = layoutPositions(state.seed + (isPortrait ? 0 : 7), state.herdSize, {
      width: region.width,
      depth: region.depth,
      minSeparation: 1.3,
    });

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < state.herdSize; i++) {
      const g = new THREE.Group();
      const scale = 0.92 + seededRand(state.seed, i) * 0.16;
      g.scale.setScalar(scale);

      const body = new THREE.Mesh(bodyGeos[i % bodyGeos.length], sheepMat);
      g.add(body);

      const eyes = [-1, 1].map((side) => {
        const eye = new THREE.Mesh(eyeGeo, sheepMat);
        eye.position.set(side * 0.105, 0.83, 0.71);
        g.add(eye);
        return eye;
      });

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.012, 0.05);
      g.add(shadow);

      const ribbonMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
      ribbon.visible = false;
      g.add(ribbon);

      const numberSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: numberTextures[0], transparent: true, depthTest: false, fog: false })
      );
      numberSprite.scale.set(0.62, 0.62, 1);
      numberSprite.position.set(0, 1.55, 0.1);
      numberSprite.visible = false;
      g.add(numberSprite);

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
        ribbon,
        ribbonMat,
        numberSprite,
        counted: false,
        phase: seededRand(state.seed, i + 200) * Math.PI * 2,
        bounceStart: -1,
        bounceDur: 0,
        wiggle: false,
        nextBlink: 1 + Math.random() * 4,
        blinkStart: -1,
        nextHop: 5 + Math.random() * 8,
        hopStart: -1,
        ribbonPop: -1,
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
    const pad = 0.65;
    const top = 1.9;
    const xs = [minX - pad, maxX + pad];
    const zs = [minZ - pad, maxZ + pad];
    const ys = [0, top];
    let k = 0;
    xs.forEach((x) => zs.forEach((z) => ys.forEach((y) => corners[k++].set(x, y, z))));

    // Keep the flock out from under the number plate: below it in
    // portrait (where it spans the top), to the right of it in landscape
    // (where CSS parks it in the top-left corner).
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const overlay = (typeof getOverlayRect === 'function' ? getOverlayRect() : null) || { bottom: 0, right: 0 };
    let topLimit = 0.92;
    let leftLimit = -0.94;
    if (isPortrait) topLimit = Math.max(0.15, 1 - (2 * overlay.bottom) / h - 0.06);
    else leftLimit = Math.min(0.2, -1 + (2 * overlay.right) / w + 0.06);
    const sideLimit = 0.94;
    const bottomLimit = -0.93;

    // A lowish camera keeps the faces, the horizon and a strip of sky in
    // frame; portrait gets a wider lens so the flock can sit closer.
    camera.fov = isPortrait ? 54 : 46;
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
    // Shift the target so the flock sits centered in the free area, not
    // pinned to the top edge of it.
    fits(cameraDistance);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < corners.length; i++) {
      proj.copy(corners[i]).project(camera);
      minY = Math.min(minY, proj.y);
      maxY = Math.max(maxY, proj.y);
    }
    let minPX = Infinity;
    let maxPX = -Infinity;
    for (let i = 0; i < corners.length; i++) {
      proj.copy(corners[i]).project(camera);
      minPX = Math.min(minPX, proj.x);
      maxPX = Math.max(maxPX, proj.x);
    }
    const worldPerNdc = cameraDistance * Math.tan((camera.fov * Math.PI) / 360);
    const slack = (topLimit - maxY) - (minY - bottomLimit);
    if (Math.abs(slack) > 0.02) {
      // Raising the target lowers the flock on screen (and brings the
      // horizon down into view), so subtract.
      cameraTarget.y -= (slack / 2) * worldPerNdc * 0.9;
    }
    const slackX = (sideLimit - maxPX) - (minPX - leftLimit);
    if (Math.abs(slackX) > 0.02) {
      // Positive slack means room on the right: pan the camera left by
      // moving the target left along the screen's x axis.
      cameraTarget.x -= (slackX / 2) * worldPerNdc * camera.aspect * 0.9;
    }
    fits(cameraDistance);
    cameraBase.copy(camera.position);
  }

  function markCounted(index, number, animate = true) {
    const s = sheep[index];
    if (!s || s.counted) return;
    s.counted = true;
    const color = NUMBER_COLORS[(number - 1) % NUMBER_COLORS.length];
    s.ribbonMat.color.set(color);
    s.ribbon.visible = true;
    s.numberSprite.material.map = numberTextures[Math.min(number, 10) - 1];
    s.numberSprite.material.needsUpdate = true;
    s.numberSprite.visible = true;
    if (animate && !reducedMotion) {
      s.bounceStart = clock.elapsedTime;
      s.bounceDur = 0.5;
      s.wiggle = false;
      s.ribbonPop = clock.elapsedTime;
      const p = s.group.position;
      sparklePool.burst(p.x, 0.9 * s.group.scale.x, p.z + 0.2);
    }
  }

  function wiggleSheep(index) {
    const s = sheep[index];
    if (!s) return;
    s.bounceStart = clock.elapsedTime;
    s.bounceDur = 0.34;
    s.wiggle = true;
  }

  function celebrate() {
    if (reducedMotion) return;
    confettiPool.start(flockCenter.x, flockCenter.z, Math.max(flockSpread, 2.5));
    sheep.forEach((s, i) => {
      // Whole flock hops, a beat apart.
      s.hopStart = clock.elapsedTime + i * 0.06;
    });
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
    const targets = sheep.map((s) => s.pick);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const idx = targets.findIndex((t) => t === hits[0].object);
      if (idx >= 0) onTap(idx);
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
          minX = Math.min(minX, s.group.position.x);
          maxX = Math.max(maxX, s.group.position.x);
          minZ = Math.min(minZ, s.group.position.z);
          maxZ = Math.max(maxZ, s.group.position.z);
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
  let frameAvg = 16;
  let animId = null;
  let lowTierAccum = 0;

  function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function frame() {
    animId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    frameAvg = frameAvg * 0.9 + dt * 1000 * 0.1;
    if (tier !== 'low' && frameAvg > 28 && clock.elapsedTime > 2) {
      // One-way step down within a session, to avoid oscillating.
      tier = 'low';
      renderer.setPixelRatio(1);
    }
    if (tier === 'low') {
      lowTierAccum += dt;
      if (lowTierAccum < 1 / 30) return;
    }
    const stepDt = tier === 'low' ? lowTierAccum : dt;
    lowTierAccum = 0;

    const t = clock.elapsedTime;
    if (!reducedMotion) {
      camera.position.set(cameraBase.x + Math.sin(t * 0.18) * 0.12, cameraBase.y + Math.sin(t * 0.23) * 0.05, cameraBase.z);
      camera.lookAt(cameraTarget);
    }

    sheep.forEach((s) => {
      // Breathing.
      const breathe = reducedMotion ? 0 : Math.sin(t * 1.6 + s.phase) * 0.018;
      let sy = 1 + breathe;
      let sx = 1 - breathe * 0.6;
      let y = 0;
      let rz = 0;

      // Occasional idle hop.
      if (!reducedMotion && !s.counted && s.hopStart < 0 && t > s.nextHop) {
        s.hopStart = t;
      }
      if (s.hopStart >= 0 && t >= s.hopStart) {
        const p = (t - s.hopStart) / 0.55;
        if (p >= 1) {
          s.hopStart = -1;
          s.nextHop = t + 6 + Math.random() * 10;
        } else {
          y += Math.sin(p * Math.PI) * 0.28;
          sy *= 1 + Math.sin(p * Math.PI) * 0.08;
          sx *= 1 - Math.sin(p * Math.PI) * 0.05;
        }
      }

      // Tap reaction: squash, then a hop with a little overshoot.
      if (s.bounceStart >= 0) {
        const p = (t - s.bounceStart) / s.bounceDur;
        if (p >= 1) {
          s.bounceStart = -1;
          s.wiggle = false;
        } else if (s.wiggle) {
          rz = Math.sin(p * Math.PI * 4) * 0.14 * (1 - p);
          y += Math.sin(p * Math.PI) * 0.06;
        } else {
          const squash = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) : 0;
          const hop = p >= 0.2 ? Math.sin(((p - 0.2) / 0.8) * Math.PI) : 0;
          sy *= 1 - squash * 0.18 + hop * 0.12;
          sx *= 1 + squash * 0.14 - hop * 0.06;
          y += hop * 0.34;
        }
      }

      const base = s.group.scale.x;
      s.body.scale.set(sx, sy, sx);
      s.eyes.forEach((e) => {
        e.position.y = 0.83 * sy;
      });
      s.group.position.y = y * base;
      s.group.rotation.z = rz;

      // Blink.
      if (!reducedMotion) {
        if (s.blinkStart < 0 && t > s.nextBlink) s.blinkStart = t;
        let eyeY = 1;
        if (s.blinkStart >= 0) {
          const p = (t - s.blinkStart) / 0.18;
          if (p >= 1) {
            s.blinkStart = -1;
            s.nextBlink = t + 2 + Math.random() * 5;
          } else {
            eyeY = 1 - Math.sin(p * Math.PI) * 0.92;
          }
        }
        s.eyes.forEach((e) => e.scale.set(1, eyeY, 1));
      }

      // Ribbon pops in with overshoot when counted.
      if (s.ribbonPop >= 0) {
        const p = Math.min(1, (t - s.ribbonPop) / 0.45);
        const k = easeOutBack(p);
        s.ribbon.scale.setScalar(Math.max(0.01, k));
        s.numberSprite.scale.set(0.62 * k, 0.62 * k, 1);
        if (p >= 1) s.ribbonPop = -1;
      }
      if (s.numberSprite.visible && s.ribbonPop < 0) {
        s.numberSprite.position.y = 1.55 + (reducedMotion ? 0 : Math.sin(t * 2.2 + s.phase) * 0.035);
      }
    });

    clouds.forEach((c) => {
      c.sprite.position.x += (reducedMotion ? 0.3 : 1) * c.speed * stepDt;
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
    setState(state) {
      buildFlock(state);
    },
    countSheep(index, number) {
      markCounted(index, number, true);
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
      renderer.dispose();
      canvas.remove();
    },
  };
}

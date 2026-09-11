// The 3D pasture. Loaded lazily by app.js only when WebGL is available,
// so devices without it never pay for importing three at all.
//
// Art direction: a detailed dusk meadow viewed from above, with plush sheep. Every sheep is ONE vertex-colored
// mesh (body, wool puffs, face, ears, cheeks and smile merged at
// boot) plus two eye meshes that blink and close, a soft contact shadow, a muted
// ribbon and a number plate. Legs and tails are instanced across the flock, which
// is what keeps the low tier smooth.
import * as THREE from 'three';
import { layoutPositions, NUMBER_COLORS } from './layout.js';
import { createRoamingFlock } from './movement.js';
import { fitBirdCamera, meadowRegion } from './camera.js';

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
  ground: '#667d79',
  hillA: '#738886',
  hillB: '#5f7879',
  hillC: '#4f686c',
  trunk: '#7b7773',
  leaf: '#586e6f',
  leafLight: '#728786',
  fog: '#a1afb8',
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

// ---------------------------------------------------------------------------
// Sheep geometry. Built once per variant, then shared by every sheep.

export function buildSheepBodyGeometry(variant) {
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const smile = new THREE.TorusGeometry(0.048, 0.009, 6, 16, Math.PI);
  const curl = new THREE.TorusGeometry(0.065, 0.025, 6, 14, Math.PI * 1.65);
  const parts = [];
  const add = (color, x, y, z, sx, sy = sx, sz = sx, rz = 0) =>
    parts.push({ geo: sphere, color, matrix: placeMatrix(x, y, z, sx, sy, sz, 0, 0, rz) });
  // A soft pear-shaped silhouette, with overlapping wool locks rather
  // than an exposed smooth ball. All locks share a single draw call.
  add(COLORS.woolShade, 0, 0.64, -0.05, 0.51, 0.49, 0.5);
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
      add(i % 4 === 0 ? COLORS.woolLight : COLORS.wool, x, y, z, size, size * 1.08, size);
      if (row > 1 && i % 3 === 0 && z > 0) {
        parts.push({ geo: curl, color: COLORS.woolShade,
          matrix: placeMatrix(x, y, z + size * 0.88, 0.65, 0.65, 0.45, 0, 0, angle) });
      }
    }
  }
  // Extra locks and raised curls read clearly from the bird's-eye view.
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399;
    const radius = .10 + (i % 3) * .10;
    parts.push({ geo: curl, color: i % 2 ? COLORS.wool : COLORS.woolShade,
      matrix: placeMatrix(Math.cos(a) * radius, 1.135 - radius * .18,
        Math.sin(a) * radius - .12, .65, .65, .45, -Math.PI / 2, 0, a) });
  }
  const headStart = parts.length;
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
      add(COLORS.woolLight, x,y,z,r));
  parts.push({ geo: curl, color: COLORS.woolShade,
    matrix: placeMatrix(-0.06, 1.115, 0.628, 0.7, 0.7, 0.5, 0, 0, 0.3 + variant * 0.2) });
  add(COLORS.mouth, 0, 0.758, 0.8, 0.033, 0.021, 0.018);
  parts.push({ geo: smile, color: COLORS.mouth,
    matrix: placeMatrix(0, 0.723, 0.79, 1, 0.7, 1, 0, 0, Math.PI) });
  const tilt = headTiltMatrix();
  for (let i = headStart; i < parts.length; i++) parts[i].matrix.premultiply(tilt);
  const geometry = mergeColored(parts);
  sphere.dispose(); smile.dispose(); curl.dispose();
  return geometry;
}

function headTiltMatrix() {
  return new THREE.Matrix4().makeTranslation(0, .84, .48)
    .multiply(new THREE.Matrix4().makeRotationX(-.25))
    .multiply(new THREE.Matrix4().makeTranslation(0, -.84, -.48));
}

export function buildLegGeometry() {
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const geometry = mergeColored([
    { geo: sphere, color: COLORS.leg, matrix: placeMatrix(0, -.09, 0, .085, .15, .085) },
    { geo: sphere, color: COLORS.hoof, matrix: placeMatrix(0, -.205, .025, .1, .065, .12) },
    // A little split in each rounded hoof.
    { geo: sphere, color: '#614e48', matrix: placeMatrix(0, -.217, .14, .008, .032, .005) },
  ]);
  sphere.dispose();
  return geometry;
}

function buildTailGeometry() {
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const geometry = mergeColored([
    { geo: sphere, color: COLORS.wool, matrix: placeMatrix(0, 0, -.045, .13, .13, .19) },
    { geo: sphere, color: COLORS.woolLight, matrix: placeMatrix(.065, .04, -.12, .09) },
    { geo: sphere, color: COLORS.woolLight, matrix: placeMatrix(-.05, -.03, -.14, .085) },
  ]);
  sphere.dispose();
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

function buildRibbonGeometry() {
  const torus = new THREE.TorusGeometry(0.2, 0.045, 8, 26);
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const geo = mergeColored([
    // Collar around the neck, tilted with the head.
    { geo: torus, color: '#fff8ed', matrix: placeMatrix(0, 0.74, 0.34, 1, 1, 1, Math.PI / 2 - 0.35, 0, 0) },
    // Bow: two loops and a knot, sitting to one side.
    { geo: sphere, color: '#fff8ed', matrix: placeMatrix(0.3, 0.86, 0.36, 0.085, 0.06, 0.05, 0, 0, 0.5) },
    { geo: sphere, color: '#fff8ed', matrix: placeMatrix(0.36, 0.74, 0.36, 0.085, 0.06, 0.05, 0, 0, -0.5) },
    { geo: sphere, color: '#fff8ed', matrix: placeMatrix(0.31, 0.8, 0.39, 0.045) },
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
  canvas.dataset.camera = 'birdseye';
  canvas.dataset.motion = reducedMotion ? 'still' : 'roaming';
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
  scene.fog = new THREE.Fog(COLORS.fog, 32, 70);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);

  scene.add(new THREE.HemisphereLight('#e3e3f3', '#485e60', 1.6));
  const sun = new THREE.DirectionalLight('#ffdfbe', 2.1);
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
    const far = Math.max(0, Math.abs(y) - 5) * 0.015;
    gp.setZ(i, far * far * .4);
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
    m.scale.set(r, h * 0.42, r * 0.8);
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
  const petalSphere = new THREE.SphereGeometry(1, 8, 6);
  const petalGeo = mergeColored(Array.from({ length: 5 }, (_, i) => {
    const a = i / 5 * Math.PI * 2;
    return { geo: petalSphere, color: '#ffffff', matrix: placeMatrix(Math.cos(a) * .062, 0, Math.sin(a) * .062, .055, .025, .035, 0, -a) };
  }));
  petalSphere.dispose();
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


  // Tiny grass clusters and stones share just two draw calls.
  const grassParts = [];
  const blade = new THREE.ConeGeometry(.025, .21, 5);
  for (let i = 0; i < 5; i++) grassParts.push({ geo: blade, color: i % 2 ? '#8b9b83' : '#738a77',
    matrix: placeMatrix(Math.cos(i * 2.4) * .055, .08, Math.sin(i * 2.4) * .055,
      1, .65 + i * .1, 1, 0, 0, (i - 2) * .12) });
  const grassGeo = mergeColored(grassParts); blade.dispose();
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), tier === 'low' ? 100 : 220);
  const stoneGeo = new THREE.SphereGeometry(1, 9, 6);
  const stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshLambertMaterial({ color: '#92958a' }), 32);
  for (let i = 0; i < grass.count; i++) {
    grass.setMatrixAt(i, placeMatrix((seededRand(430, i) - .5) * 17, .015,
      (seededRand(431, i) - .5) * 17, .8 + seededRand(432, i) * .7, 1, 1, 0, i));
  }
  for (let i = 0; i < stones.count; i++) {
    const a = i * 2.399, r = 6 + seededRand(433, i) * 2;
    stones.setMatrixAt(i, placeMatrix(Math.cos(a) * r, .045, Math.sin(a) * r, .12, .07, .085));
  }
  scene.add(grass, stones);
  // A soft oval-like rectangle of clover marks the roaming space, with
  // four generous gaps. It is decoration, never an obstacle for tapping.
  const border = new THREE.Group(); scene.add(border);
  function buildMeadowBorder(field) {
    border.children.forEach(child => { child.geometry.dispose(); child.material.dispose(); });
    border.clear();
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshLambertMaterial({ color: '#7d9380' });
    const count = 100;
    const edge = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      const side = Math.floor(i / 25), along = (i % 25) / 24 - .5;
      const x = side < 2 ? along * (field.width + 2.2) : (side === 2 ? -1 : 1) * (field.width / 2 + 1.1);
      const z = side >= 2 ? along * (field.depth + 2.2) : (side === 0 ? -1 : 1) * (field.depth / 2 + 1.1);
      const scale = Math.abs(along) < .065 ? 0 : .08 + seededRand(222, i) * .06;
      edge.setMatrixAt(i, placeMatrix(x, .025, z, scale, .025, scale));
    }
    border.add(edge);
  }

  // Shared sheep assets.
  const bodyGeos = [0, 1, 2].map(buildSheepBodyGeometry);
  const eyeGeo = buildEyeGeometry();
  const ribbonGeo = buildRibbonGeometry();
  const sheepMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const shadowMat = new THREE.MeshBasicMaterial({ map: buildShadowTexture(), transparent: true, depthWrite: false });
  const pickGeo = new THREE.SphereGeometry(0.9, 8, 6);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  const numberTextures = buildNumberTextures();


  let sheepGroup = new THREE.Group();
  scene.add(sheepGroup);
  let sheep = [];
  let roaming = null;
  let region = null;
  const legs = new THREE.InstancedMesh(buildLegGeometry(), sheepMat, 40);
  const tails = new THREE.InstancedMesh(buildTailGeometry(), sheepMat, 10);
  legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  legs.frustumCulled = false; tails.frustumCulled = false;
  legs.count = 0; tails.count = 0;
  scene.add(legs, tails);
  const limbMatrix = new THREE.Matrix4();
  const footOffsets = [[-.25,-.22],[.25,-.22],[-.25,.22],[.25,.22]];

  let lastState = null;
  let isPortrait = true;

  function buildFlock(state) {
    lastState = state;
    sheep.forEach((s) => { s.ribbonMat.dispose(); s.numberSprite.material.dispose(); });
    scene.remove(sheepGroup);
    sheepGroup = new THREE.Group();
    scene.add(sheepGroup);
    sheep = [];

    region = meadowRegion(state.herdSize, isPortrait);
    const positions = layoutPositions(state.seed + (isPortrait ? 0 : 7), state.herdSize, {
      width: region.width,
      depth: region.depth,
      minSeparation: 1.45,
    });

    roaming = createRoamingFlock(state.seed, positions, region, state.herdSize);
    legs.count = state.herdSize * 4; tails.count = state.herdSize;
    buildMeadowBorder(region);
    for (let i = 0; i < state.herdSize; i++) {
      const g = new THREE.Group();
      const scale = 0.92 + seededRand(state.seed, i) * 0.16;
      g.scale.setScalar(scale);

      const body = new THREE.Mesh(bodyGeos[i % bodyGeos.length], sheepMat);
      g.add(body);

      const eyes = [-1, 1].map((side) => {
        const eye = new THREE.Mesh(eyeGeo, sheepMat);
        eye.position.set(side * 0.123, 0.867, 0.709).applyMatrix4(headTiltMatrix());
        eye.rotation.x = -.25;
        eye.userData.restY = eye.position.y;
        g.add(eye);
        return eye;
      });

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.012, 0.05);
      g.add(shadow);

      const ribbonMat = new THREE.MeshLambertMaterial({ color: '#fff8ed' });
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
      roaming.agents[i].heading = g.rotation.y;

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
        index: i,
        phase: seededRand(state.seed, i + 200) * Math.PI * 2,
        bounceStart: -1,
        bounceDur: 0,
        wiggle: false,
        nextBlink: 1 + Math.random() * 4,
        blinkStart: -1,
        ribbonPop: -1,
      });
    }

    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
    fitCamera();
  }

  function fitCamera() {
    if (!region) return;
    fitBirdCamera(camera, {
      width: container.clientWidth || 1, height: container.clientHeight || 1,
      region, overlay: getOverlayRect?.() || undefined,
    });
  }

  function markCounted(index, number, animate = true) {
    const s = sheep[index];
    if (!s || s.counted) return;
    s.counted = true;
    roaming?.count(index);
    if (lastState && !lastState.counted.includes(index)) {
      lastState = { ...lastState, counted: [...lastState.counted, index] };
    }
    const color = NUMBER_COLORS[(number - 1) % NUMBER_COLORS.length];
    s.ribbonMat.color.set(color);
    s.ribbon.visible = true;
    s.numberSprite.material.map = numberTextures[Math.min(number, 10) - 1];
    s.numberSprite.material.needsUpdate = true;
    s.numberSprite.visible = true;
    if (animate && !reducedMotion) {
      s.bounceStart = clock.elapsedTime;
      s.bounceDur = 0.9;
      s.wiggle = false;
      s.ribbonPop = clock.elapsedTime;
      const p = s.group.position;
      // A sleepy nod is enough feedback; no burst of sparkles.
    }
  }

  function wiggleSheep(index) {
    const s = sheep[index];
    if (!s || reducedMotion) return;
    s.bounceStart = clock.elapsedTime;
    s.bounceDur = 0.34;
    s.wiggle = true;
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
      if (sheep.length) fitCamera();
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
    if (!reducedMotion) roaming?.update(stepDt);
    sheep.forEach((s) => {
      // Breathing.
      const breathe = reducedMotion ? 0 : Math.sin(t * 0.9 + s.phase) * 0.012;
      let sy = 1 + breathe;
      let sx = 1 - breathe * 0.6;
      let y = 0;
      let rz = 0;

      const motion = roaming.agents[s.index];
      const stride = motion.distance * 11;
      const gait = reducedMotion || s.counted ? 0 : Math.min(1, motion.speed / .25);
      s.group.position.x = motion.x;
      s.group.position.z = motion.z;
      s.group.rotation.y = motion.heading;
      y = Math.abs(Math.sin(stride)) * .035 * gait;

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
        e.position.y = e.userData.restY * sy;
      });
      s.group.position.y = y * base;
      s.group.rotation.z = rz + Math.sin(stride) * .022 * gait;
      s.group.updateMatrix();
      footOffsets.forEach(([x,z], foot) => {
        const diagonal = foot === 0 || foot === 3 ? 0 : Math.PI;
        const swing = Math.sin(stride + diagonal) * .48 * gait;
        limbMatrix.copy(s.group.matrix).multiply(placeMatrix(x, .27, z, 1, 1, 1, swing));
        legs.setMatrixAt(s.index * 4 + foot, limbMatrix);
      });
      const wag = reducedMotion ? 0 : Math.sin(t * 1.8 + s.phase) * .12;
      limbMatrix.copy(s.group.matrix).multiply(placeMatrix(0, .66, -.59, 1, 1, 1, 0, wag));
      tails.setMatrixAt(s.index, limbMatrix);

      // Counted sheep close their eyes, including in reduced motion.
      if (s.counted) s.eyes.forEach((e) => e.scale.set(1, 0.14, 1));
      if (!reducedMotion && !s.counted) {
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
        const k = p * p * (3 - 2 * p);
        s.ribbon.scale.setScalar(Math.max(0.01, k));
        s.numberSprite.scale.set(0.62 * k, 0.62 * k, 1);
        if (p >= 1) s.ribbonPop = -1;
      }
      if (s.numberSprite.visible && s.ribbonPop < 0) {
        s.numberSprite.position.y = 1.55 + (reducedMotion ? 0 : Math.sin(t * 2.2 + s.phase) * 0.035);
      }
    });

    clouds.forEach((c) => {
      c.sprite.position.x += (reducedMotion ? 0 : 0.35) * c.speed * stepDt;
      if (c.sprite.position.x > 18) c.sprite.position.x = -18;
    });

    legs.instanceMatrix.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
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

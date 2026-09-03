// The 3D pasture. Loaded lazily by app.js only when WebGL is available,
// so devices without it never pay for importing three at all.
import * as THREE from 'three';
import { layoutPositions } from './layout.js';

const WOOL_BUMP_OFFSETS = [
  [0.35, 0.25, 0.15],
  [-0.35, 0.25, 0.15],
  [0.3, 0.2, -0.3],
  [-0.3, 0.2, -0.3],
  [0, 0.35, 0.35],
  [0, 0.3, -0.4],
];
const RIBBON_COLORS = ['#f97316', '#ec4899', '#22c55e', '#38bdf8', '#eab308', '#a855f7'];

function seededRand(seed, salt) {
  let a = (seed ^ (salt * 2654435761)) >>> 0;
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function buildNumberTextures() {
  const textures = [];
  for (let n = 1; n <= 10; n++) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#18181b';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), size / 2, size / 2 + 4);
    const tex = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
  }
  return textures;
}

function buildCloudTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  [
    [30, 32, 26],
    [64, 24, 30],
    [96, 30, 24],
    [64, 44, 34],
  ].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  return new THREE.CanvasTexture(canvas);
}

function createSparklePool(scene, size) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(size * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: '#fff6a8',
    size: 0.12,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const velocities = new Array(size).fill(null).map(() => ({ vx: 0, vy: 0, vz: 0 }));
  const DURATION = 0.6;
  let sinceBurst = 999;

  function burst(x, y, z) {
    for (let i = 0; i < size; i++) {
      const angle = (i / size) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 0.4 + Math.random() * 0.5;
      velocities[i] = { vx: Math.cos(angle) * speed, vy: 0.7 + Math.random() * 0.5, vz: Math.sin(angle) * speed };
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
      v.vy -= dt * 1.5;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { burst, update };
}

function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  if (cores <= 2 || dpr > 2.5) return 'low';
  if (cores <= 4) return 'mid';
  return 'high';
}

export function createSceneRenderer({ container, onTap, reducedMotion, onFatal }) {
  let tier = detectTier();

  const canvas = document.createElement('canvas');
  canvas.className = 'sheep-canvas';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'low' ? 1 : 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fd3ff');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 5.2, 7.5);
  camera.lookAt(0, 0.2, -0.5);

  scene.add(new THREE.HemisphereLight('#e8f7ff', '#5b8a3a', 0.9));
  const sun = new THREE.DirectionalLight('#fff6de', 0.85);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  const groundGeo = new THREE.PlaneGeometry(20, 14, 24, 18);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    posAttr.setZ(i, Math.sin(x * 0.5) * 0.08 + Math.cos(y * 0.6) * 0.08);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: '#6fbf4f' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const cloudTexture = buildCloudTexture();
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4 + Math.random() * 2, 1.6 + Math.random() * 0.6, 1);
    sprite.position.set(-8 + Math.random() * 16, 4 + Math.random() * 2, -6 - Math.random() * 3);
    scene.add(sprite);
    clouds.push(sprite);
  }

  // Shared geometries/materials so material/draw-call count stays fixed
  // regardless of flock size.
  const woolMaterial = new THREE.MeshLambertMaterial({ color: '#f8f7f2' });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: '#3f3a36' });
  const bodyGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const bumpGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const headGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const earGeo = new THREE.ConeGeometry(0.07, 0.16, 8);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6);
  const shadowGeo = new THREE.CircleGeometry(0.5, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', opacity: 0.18, transparent: true });
  const ribbonGeo = new THREE.TorusGeometry(0.26, 0.045, 8, 24);
  const numberTextures = buildNumberTextures();

  let sheepGroup = new THREE.Group();
  scene.add(sheepGroup);
  let sheep = [];
  const sparklePool = createSparklePool(scene, 24);

  function buildFlock(state) {
    scene.remove(sheepGroup);
    sheepGroup = new THREE.Group();
    scene.add(sheepGroup);
    sheep = [];

    const positions = layoutPositions(state.seed, state.herdSize, { width: 7.5, depth: 4.5, minSeparation: 1.5 });
    for (let i = 0; i < state.herdSize; i++) {
      const g = new THREE.Group();
      const scale = 0.85 + seededRand(state.seed, i) * 0.3;
      g.scale.setScalar(scale);

      const body = new THREE.Mesh(bodyGeo, woolMaterial);
      body.position.y = 0.42;
      g.add(body);

      if (tier !== 'low') {
        WOOL_BUMP_OFFSETS.forEach(([bx, by, bz]) => {
          const bump = new THREE.Mesh(bumpGeo, woolMaterial);
          bump.position.set(bx, 0.42 + by, bz);
          g.add(bump);
        });
      }

      const head = new THREE.Mesh(headGeo, darkMaterial);
      head.position.set(0, 0.5, 0.42);
      g.add(head);

      if (tier !== 'low') {
        [-0.14, 0.14].forEach((ex) => {
          const ear = new THREE.Mesh(earGeo, darkMaterial);
          ear.position.set(ex, 0.62, 0.38);
          ear.rotation.z = ex < 0 ? 0.6 : -0.6;
          g.add(ear);
        });
      }

      [
        [-0.18, -0.28],
        [0.18, -0.28],
        [-0.18, 0.24],
        [0.18, 0.24],
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(legGeo, darkMaterial);
        leg.position.set(lx, 0.15, lz);
        g.add(leg);
      });

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.005;
      g.add(shadow);

      const ribbon = new THREE.Mesh(
        ribbonGeo,
        new THREE.MeshBasicMaterial({ color: RIBBON_COLORS[i % RIBBON_COLORS.length] })
      );
      ribbon.position.y = 0.42;
      ribbon.rotation.x = Math.PI / 2;
      ribbon.visible = false;
      g.add(ribbon);

      const numberSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: numberTextures[0], transparent: true, depthTest: false })
      );
      numberSprite.scale.set(0.5, 0.5, 1);
      numberSprite.position.set(0, 1.15, 0);
      numberSprite.visible = false;
      g.add(numberSprite);

      // Larger invisible pick target so small fingers reliably land taps.
      const pick = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.y = 0.42;
      g.add(pick);

      const pos = positions[i];
      g.position.set(pos.x, 0, pos.z);
      g.rotation.y = seededRand(state.seed, i + 100) * Math.PI * 2;

      sheepGroup.add(g);
      sheep.push({
        group: g,
        pick,
        ribbon,
        numberSprite,
        counted: false,
        phase: Math.random() * Math.PI * 2,
        bounceUntil: 0,
        wiggle: false,
      });
    }

    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
  }

  function markCounted(index, number, animate = true) {
    const s = sheep[index];
    if (!s || s.counted) return;
    s.counted = true;
    s.ribbon.visible = true;
    s.numberSprite.material.map = numberTextures[Math.min(number, 10) - 1];
    s.numberSprite.material.needsUpdate = true;
    s.numberSprite.visible = true;
    if (animate && !reducedMotion) {
      s.bounceUntil = performance.now() + 420;
      sparklePool.burst(s.group.position.x, 0.6, s.group.position.z);
    }
  }

  function wiggleSheep(index) {
    const s = sheep[index];
    if (!s) return;
    s.bounceUntil = performance.now() + 260;
    s.wiggle = true;
  }

  const raycaster = new THREE.Raycaster();
  const pointerStart = { x: 0, y: 0, t: 0 };

  function ndc(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((evt.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }
  function onPointerDown(evt) {
    pointerStart.x = evt.clientX;
    pointerStart.y = evt.clientY;
    pointerStart.t = performance.now();
  }
  function onPointerUp(evt) {
    const dx = evt.clientX - pointerStart.x;
    const dy = evt.clientY - pointerStart.y;
    const dt = performance.now() - pointerStart.t;
    // Movement/duration thresholds so a drag or a long press never
    // registers as a tap.
    if (Math.hypot(dx, dy) > 12 || dt > 700) return;
    const { x, y } = ndc(evt);
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const targets = sheep.map((s) => s.pick);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const idx = targets.findIndex((t) => t === hits[0].object);
      if (idx >= 0) onTap(idx);
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp, { passive: true });

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
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

  function frame() {
    animId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    frameAvg = frameAvg * 0.9 + dt * 1000 * 0.1;
    if (tier !== 'low' && frameAvg > 28) {
      tier = 'low';
      renderer.setPixelRatio(1);
    }

    const t = clock.elapsedTime;
    if (!reducedMotion) {
      camera.position.x = Math.sin(t * 0.15) * 0.3;
      camera.lookAt(0, 0.2, -0.5);
    }

    const now = performance.now();
    sheep.forEach((s) => {
      const bob = reducedMotion ? 0 : Math.sin(t * 2 + s.phase) * 0.03;
      let y = bob;
      if (s.bounceUntil > now) {
        const remain = (s.bounceUntil - now) / 420;
        y += Math.sin(remain * Math.PI) * (s.wiggle ? 0.05 : 0.22);
        if (s.wiggle) s.group.rotation.z = Math.sin(remain * Math.PI * 4) * 0.12;
      } else if (s.wiggle) {
        s.wiggle = false;
        s.group.rotation.z = 0;
      }
      s.group.position.y = y;
      if (s.numberSprite.visible) {
        s.numberSprite.position.y = 1.15 + Math.sin(t * 2.4 + s.phase) * 0.03;
      }
    });

    clouds.forEach((c, i) => {
      c.position.x += (reducedMotion ? 0.002 : 0.006) * (i % 2 === 0 ? 1 : -1);
      if (c.position.x > 10) c.position.x = -10;
      if (c.position.x < -10) c.position.x = 10;
    });

    sparklePool.update(dt);
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
    resetRound(state) {
      buildFlock(state);
    },
    destroy() {
      stop();
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

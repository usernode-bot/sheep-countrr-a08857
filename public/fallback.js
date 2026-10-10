// DOM/card renderer used on devices without WebGL, or when ?renderer=dom
// is set for testing. Shares the exact same counting semantics as the
// 3D scene: same tap contract (onTap(index)), same counted-badge numbers,
// same pastel per number.
import { NUMBER_COLORS, sheepName } from './layout.js';
import { wanderOffset } from './movement.js';
import { calmMotion, isCalmLevel, motionForRound } from './rounds.js';

// A friendly little sheep, drawn once as inline SVG per card. Eyes carry a
// class so CSS can blink them; the bow only shows once counted.
const SHEEP_SVG = `
<svg class="sheep-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <ellipse cx="60" cy="108" rx="34" ry="6" fill="rgba(60,100,40,0.18)"/>
  <g fill="#e6c3ab">
    <rect x="34" y="80" width="10" height="24" rx="5"/>
    <rect x="50" y="82" width="10" height="24" rx="5"/>
    <rect x="62" y="82" width="10" height="24" rx="5"/>
    <rect x="78" y="80" width="10" height="24" rx="5"/>
  </g>
  <g fill="#8a6558">
    <rect x="34" y="98" width="10" height="7" rx="3.5"/>
    <rect x="50" y="100" width="10" height="7" rx="3.5"/>
    <rect x="62" y="100" width="10" height="7" rx="3.5"/>
    <rect x="78" y="98" width="10" height="7" rx="3.5"/>
  </g>
  <g fill="var(--fleece, #fdf8f1)">
    <circle cx="60" cy="62" r="30"/>
    <circle cx="36" cy="60" r="16" fill="var(--fleece-light, #ffffff)"/>
    <circle cx="84" cy="60" r="16" fill="var(--fleece-light, #ffffff)"/>
    <circle cx="44" cy="42" r="15"/>
    <circle cx="76" cy="42" r="15"/>
    <circle cx="60" cy="36" r="16" fill="var(--fleece-light, #ffffff)"/>
    <circle cx="40" cy="78" r="14" fill="var(--fleece-shade, #f3e9dc)"/>
    <circle cx="80" cy="78" r="14" fill="var(--fleece-shade, #f3e9dc)"/>
    <circle cx="60" cy="84" r="16"/>
  </g>
  <ellipse cx="30" cy="56" rx="9" ry="5" fill="#f7d5bf" transform="rotate(-25 30 56)"/>
  <ellipse cx="90" cy="56" rx="9" ry="5" fill="#f7d5bf" transform="rotate(25 90 56)"/>
  <ellipse cx="30" cy="56" rx="5.5" ry="2.8" fill="#f9b6c6" transform="rotate(-25 30 56)"/>
  <ellipse cx="90" cy="56" rx="5.5" ry="2.8" fill="#f9b6c6" transform="rotate(25 90 56)"/>
  <ellipse cx="60" cy="60" rx="22" ry="20" fill="#f7d5bf"/>
  <g fill="#ffffff">
    <circle cx="50" cy="44" r="7"/>
    <circle cx="62" cy="40" r="6.5"/>
    <circle cx="72" cy="45" r="6"/>
  </g>
  <g class="sheep-eyes">
    <g>
      <ellipse cx="51" cy="58" rx="6" ry="6.5" fill="#ffffff"/>
      <circle cx="51.5" cy="59" r="3.6" fill="#2b2530"/>
      <circle cx="53" cy="56.5" r="1.4" fill="#ffffff"/>
    </g>
    <g>
      <ellipse cx="69" cy="58" rx="6" ry="6.5" fill="#ffffff"/>
      <circle cx="69.5" cy="59" r="3.6" fill="#2b2530"/>
      <circle cx="71" cy="56.5" r="1.4" fill="#ffffff"/>
    </g>
  </g>
  <ellipse cx="44" cy="67" rx="5" ry="3.2" fill="#ffb0c4"/>
  <ellipse cx="76" cy="67" rx="5" ry="3.2" fill="#ffb0c4"/>
  <circle cx="60" cy="66" r="2.2" fill="#ffb0c4"/>
  <path d="M55 70 Q60 75 65 70" stroke="#7a4f44" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <g class="sheep-bow">
    <path d="M60 80 L46 72 L48 88 Z" fill="var(--ribbon, #ff8fab)"/>
    <path d="M60 80 L74 72 L72 88 Z" fill="var(--ribbon, #ff8fab)"/>
    <circle cx="60" cy="80" r="4.5" fill="var(--ribbon, #ff8fab)"/>
    <circle cx="60" cy="80" r="2" fill="#ffffff" opacity="0.8"/>
  </g>
</svg>`;

// World units are metres in the 3D pasture; here they are card-sized
// nudges, so the same round profile reads as the same kind of restlessness.
const PX_PER_UNIT = 22;

// Same deterministic hash the 3D scene uses, so the wolf's choice of side
// matches between renderers on the same seed.
function seededRand(seed, salt) {
  let a = (seed ^ (salt * 2654435761)) >>> 0;
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Same pastel palette the 3D renderer uses, so a sheep looks like itself
// whichever way the device draws it.
const FLEECES = [
  { fleece: '#f4eadb', 'fleece-light': '#fff8ed', 'fleece-shade': '#e5d7c5' },
  { fleece: '#ded4f7', 'fleece-light': '#f1ecff', 'fleece-shade': '#c4b7ea' },
  { fleece: '#f9d9e4', 'fleece-light': '#feeef4', 'fleece-shade': '#e8bccc' },
  { fleece: '#d5ecdd', 'fleece-light': '#ecf9f1', 'fleece-shade': '#b4d6c1' },
  { fleece: '#d7e8f7', 'fleece-light': '#ecf5ff', 'fleece-shade': '#b7d0e8' },
  { fleece: '#f8ecc9', 'fleece-light': '#fdf6e0', 'fleece-shade': '#e3d2a4' },
];

// Wolf-only SVG cues, drawn over the plain sheep SVG on the visiting
// wolf's card: upright ears, a tail and the amber eye glints. The card's
// grey fleece variables (see .wolf-card in index.html) recolor the body.
const WOLF_CUES_SVG = `
  <g class="wolf-cues">
    <g class="wolf-ears">
      <path d="M28 32 L33 12 L42 28 Z" fill="#b3ada2"/>
      <path d="M92 32 L87 12 L78 28 Z" fill="#b3ada2"/>
      <path d="M31 29 L34 17 L39 26 Z" fill="#a89f92"/>
      <path d="M89 29 L86 17 L81 26 Z" fill="#a89f92"/>
    </g>
    <g class="wolf-tail">
      <circle cx="97" cy="86" r="9" fill="var(--fleece-shade, #e5d7c5)"/>
      <circle cx="103" cy="81" r="6" fill="var(--fleece-light, #ffffff)"/>
    </g>
    <g class="wolf-glint">
      <circle cx="53.5" cy="57.5" r="1.6" fill="#ffb347"/>
      <circle cx="71.5" cy="57.5" r="1.6" fill="#ffb347"/>
    </g>
  </g>`;

export function createFallbackRenderer({ container, onTap, onWolfTap, reducedMotion }) {
  const field = document.createElement('div');
  field.className = 'sheep-fallback-field';
  const grid = document.createElement('div');
  grid.className = 'sheep-fallback-grid';
  field.appendChild(grid);
  container.appendChild(field);

  // The visiting wolf lives outside the scrolling grid, in its own fixed
  // card, so the flock's layout never makes room for it and it can stroll
  // clean off the screen.
  const wolfBtn = document.createElement('button');
  wolfBtn.type = 'button';
  wolfBtn.className = 'wolf-card';
  wolfBtn.setAttribute('aria-hidden', 'true');
  wolfBtn.tabIndex = -1;
  wolfBtn.innerHTML = SHEEP_SVG.replace('</svg>', WOLF_CUES_SVG + '\n</svg>');
  wolfBtn.hidden = true;
  wolfBtn.addEventListener('click', () => onWolfTap?.());
  field.appendChild(wolfBtn);

  let cards = [];
  let current = null;
  let calm = false;
  let motion = motionForRound(1);
  let rafId = null;
  // The round's animation clock. setRoundClock resumes a saved board at
  // the exact time it was left, so the flock is standing where it was.
  let startedAt = performance.now();
  let clockOffset = 0;
  function elapsedSeconds() {
    return clockOffset + (performance.now() - startedAt) / 1000;
  }

  function render(state) {
    grid.innerHTML = '';
    cards = [];
    current = state;
    calm = !!state.calmOn;
    motion = calm ? calmMotion(state.round, state.difficulty) : motionForRound(state.round, state.difficulty);
    grid.dataset.size = String(state.sheepCount);
    for (let i = 0; i < state.sheepCount; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheep-card';
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
      btn.dataset.index = String(i);
      btn.style.setProperty('--bob-delay', `${(i * 0.37) % 2.2}s`);
      for (const [name, value] of Object.entries(FLEECES[i % FLEECES.length])) {
        btn.style.setProperty(`--${name}`, value);
      }
      btn.innerHTML = SHEEP_SVG
        + '<span class="sheep-name-label" hidden></span>'
        + '<span class="sheep-card-badge" hidden></span>'
        + '<span class="sheep-tap-ripple" hidden></span>';
      btn.addEventListener('click', () => onTap(i));
      grid.appendChild(btn);
      cards.push(btn);
    }
    // A new flock has no visit out. A wolf on the old board must not
    // survive the rebuild; app.js re-spawns one if the new state still
    // carries a visit.
    hideWolf();
    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
    syncNames(state);
    startDrift();
  }

  // The optional name label above each card. Same deterministic name the
  // 3D scene and the a11y list use, so a sheep is called the same thing
  // whichever way it is drawn.
  function syncNames(state) {
    for (let i = 0; i < cards.length; i++) {
      const label = cards[i] && cards[i].querySelector('.sheep-name-label');
      if (!label) continue;
      if (state.namesOn) {
        label.hidden = false;
        label.textContent = sheepName(state.seed, i);
      } else {
        label.hidden = true;
        label.textContent = '';
      }
    }
  }

  // The cards drift with the same seeded motion the 3D flock uses, so a
  // late round is just as hard to follow in either renderer. Offsets go on
  // the individual CSS `translate` property: it moves the card on the
  // compositor without a layout pass every frame, and composes with (so
  // leaves alone) the tap and wiggle animations on `transform`.
  function startDrift() {
    cancelAnimationFrame(rafId);
    if (reducedMotion || !current || !(motion.radius > 0)) {
      cards.forEach((btn) => { btn.style.translate = 'none'; btn.style.willChange = ''; });
      return;
    }
    cards.forEach((btn) => {
      btn.style.willChange = btn.classList.contains('is-counted') ? '' : 'translate';
    });
    const step = () => {
      rafId = requestAnimationFrame(step);
      const t = elapsedSeconds();
      for (let i = 0; i < cards.length; i++) {
        const btn = cards[i];
        if (btn.classList.contains('is-counted')) continue;
        const offset = wanderOffset(current.seed, i, cards.length, t, motion);
        btn.style.translate = `${(offset.x * PX_PER_UNIT).toFixed(1)}px ${(offset.z * PX_PER_UNIT * 0.6).toFixed(1)}px`;
      }
    };
    rafId = requestAnimationFrame(step);
  }

  function markCounted(index, number, animate = true) {
    const btn = cards[index];
    if (!btn) return;
    const color = NUMBER_COLORS[(number - 1) % NUMBER_COLORS.length];
    btn.classList.add('is-counted');
    btn.style.translate = 'none';
    btn.style.willChange = '';
    btn.style.setProperty('--ribbon', color);
    const badge = btn.querySelector('.sheep-card-badge');
    badge.hidden = false;
    badge.textContent = String(number);
    if (animate && !reducedMotion && btn.animate) {
      // Calm skips the card's hop; the number badge still pops in.
      if (!isCalmLevel(current && current.difficulty)) btn.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(0.98)' },
          { transform: 'scale(1.02)' },
          { transform: 'scale(1)' },
        ],
        { duration: 900, easing: 'cubic-bezier(.34,1.56,.64,1)' }
      );
      badge.animate(
        [{ transform: 'scale(0)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'ease-out' }
      );
    }
  }

  function wiggle(index) {
    const btn = cards[index];
    if (reducedMotion || !btn || !btn.animate) return;
    btn.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-7deg)' },
        { transform: 'rotate(7deg)' },
        { transform: 'rotate(-4deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 340, easing: 'ease-in-out' }
    );
  }

  // --- The visiting wolf ---
  // A standalone card outside the grid. The walk across the field is the
  // escape timer, driven by the Web Animations API rather than a CSS
  // transition, so the global reduced-motion rule (which kills CSS
  // transitions and animations) cannot stop it: the stroll must still
  // run, only the hop and the scamper's flourish are skipped.

  let wolfVisit = null;
  let wolfCaughtAt = -1;
  let wolfWalkAnim = null;

  function hideWolf() {
    if (wolfWalkAnim) { wolfWalkAnim.cancel(); wolfWalkAnim = null; }
    wolfVisit = null;
    wolfCaughtAt = -1;
    wolfBtn.hidden = true;
    wolfBtn.style.translate = '';
    wolfBtn.style.scale = '';
  }

  // A visit begins: the wolf steps out at `at` on the round clock and
  // strolls off the near edge over `window` seconds. The side is drawn
  // from the round seed twisted with the visit number, so the same round
  // always greets the same stroll and a deep link reproduces it exactly.
  function spawnWolf({ at, window: win, seed, n, hold }) {
    wolfVisit = { at, window: win, n, hold: !!hold, side: seededRand(seed, 500 + (n || 1)) < 0.5 ? -1 : 1 };
    wolfCaughtAt = -1;
    wolfBtn.classList.remove('is-caught');
    wolfBtn.hidden = false;
    startWalk();
  }

  function startWalk() {
    if (wolfWalkAnim) { wolfWalkAnim.cancel(); wolfWalkAnim = null; }
    if (!wolfVisit || wolfCaughtAt >= 0) return;
    const rect = field.getBoundingClientRect();
    const size = wolfBtn.offsetWidth || 118;
    const side = wolfVisit.side;
    // From just inside the field's side edge to clean off-screen, level
    // with the middle of the flock.
    const startX = side < 0 ? rect.width * 0.16 : rect.width * 0.84 - size;
    const endX = side < 0 ? -size - 24 : rect.width + 24;
    wolfBtn.style.left = '0px';
    wolfBtn.style.top = `${Math.round(rect.top + rect.height * 0.44)}px`;
    if (wolfVisit.hold) {
      // A frozen fixture holds its visit mid-stride so it can be
      // photographed whenever the capture lands.
      wolfBtn.style.translate = `${Math.round(startX + (endX - startX) * 0.35)}px 0px`;
      return;
    }
    // Resume support: a board saved mid-visit rejoins the walk at the
    // round clock's position, never back at the start.
    const into = Math.max(0, elapsedSeconds() - wolfVisit.at);
    const frac = Math.min(1, into / wolfVisit.window);
    if (frac >= 1) {
      wolfBtn.style.translate = `${Math.round(endX)}px 0px`;
      return;
    }
    const fromX = startX + (endX - startX) * frac;
    wolfWalkAnim = wolfBtn.animate(
      [{ translate: `${fromX.toFixed(1)}px 0px` }, { translate: `${Math.round(endX)}px 0px` }],
      { duration: Math.round((wolfVisit.window - into) * 1000), easing: 'linear', fill: 'forwards' }
    );
  }

  // The tap landed: the wolf turns and bounds away off the same edge,
  // shrinking as it goes. Reduced motion skips the flourish and just
  // steps the wolf out of sight.
  function catchWolf() {
    if (!wolfVisit || wolfCaughtAt >= 0) return;
    wolfCaughtAt = elapsedSeconds();
    if (wolfWalkAnim) { wolfWalkAnim.cancel(); wolfWalkAnim = null; }
    // Freeze the walk where the tap found it, so the scamper starts from
    // there rather than teleporting.
    const held = getComputedStyle(wolfBtn).translate;
    wolfBtn.style.translate = held && held !== 'none' ? held : '0px 0px';
    const side = wolfVisit.side;
    if (reducedMotion || !wolfBtn.animate) {
      wolfBtn.hidden = true;
      return;
    }
    const rect = field.getBoundingClientRect();
    const farX = side < 0 ? -rect.width * 0.4 : rect.width * 1.4;
    const scamper = wolfBtn.animate(
      [
        { translate: wolfBtn.style.translate, scale: '1', opacity: 1 },
        { translate: `${Math.round(farX)}px -40px`, scale: '0.6', opacity: 0.9 },
      ],
      { duration: 900, easing: 'ease-in', fill: 'forwards' }
    );
    scamper.onfinish = () => {
      wolfBtn.hidden = true;
      scamper.cancel();
      wolfBtn.style.translate = '';
      wolfBtn.style.scale = '';
    };
  }

  // Soft expanding ring where the card was tapped. One span per card,
  // restarted on every tap so back-to-back taps re-animate it. Purely
  // visual: the same ripple shows for a first tap and a double tap.
  function tapRipple(index) {
    const btn = cards[index];
    const ripple = btn && btn.querySelector('.sheep-tap-ripple');
    if (!ripple) return;
    if (reducedMotion || !btn.animate) {
      // Reduced motion (or no Web Animations) skips the ripple entirely.
      ripple.hidden = true;
      return;
    }
    ripple.hidden = false;
    // Restart the animation even when two taps land back to back.
    ripple.classList.remove('is-rippling');
    void ripple.offsetWidth;
    ripple.classList.add('is-rippling');
  }

  function celebrate() {}

  // Night Meadow: the field's ground gradients are CSS variables on the
  // body class (see index.html), so the DOM renderer only has to mirror
  // the state flag into its own styling scope. Nothing else changes.
  function setNight(on) {
    field.classList.toggle('theme-night', !!on);
  }

  // Calm mode: the field already reads its soft palette from the same
  // body class the CSS uses, so mirroring the flag keeps the ground wash
  // and the card recolor in step with the 3D scene.
  function setCalm(on) {
    field.classList.toggle('theme-calm', !!on);
  }

  return {
    kind: 'dom',
    elapsedSeconds,
    // Resume support: pin the drift clock at the board's saved position.
    // A visit out rejoins its walk at the new clock position.
    setRoundClock(seconds) {
      clockOffset = Number.isFinite(Number(seconds)) && Number(seconds) >= 0 ? Number(seconds) : 0;
      startedAt = performance.now();
      if (wolfVisit && wolfCaughtAt < 0) startWalk();
    },
    setState(state) {
      render(state);
      setNight(!!state.nightOn);
      setCalm(!!state.calmOn);
    },
    countSheep(index, number) {
      markCounted(index, number, true);
    },
    wiggleSheep(index) {
      wiggle(index);
    },
    // A visit begins: app.js calls this the moment the store puts a wolf
    // out. The card appears at `at` and strolls for `window` seconds.
    spawnWolf(opts) {
      spawnWolf(opts);
    },
    // The tap landed on the wolf: scamper away off the edge.
    catchWolf() {
      catchWolf();
    },
    tapRipple(index) {
      tapRipple(index);
    },
    // The 3D scene throttles itself under a covering panel. The cards are
    // already cheap, so this keeps the shared renderer interface only.
    setBackdropMode() {},
    celebrate() {
      celebrate();
    },
    resetRound(state) {
      render(state);
    },
    setNight(on) {
      setNight(on);
    },
    setCalm(on) {
      setCalm(on);
    },
    setNames(on) {
      if (current) syncNames({ ...current, namesOn: !!on });
    },
    destroy() {
      cancelAnimationFrame(rafId);
      field.remove();
    },
  };
}

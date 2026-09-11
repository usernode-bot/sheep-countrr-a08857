// DOM/card renderer used on devices without WebGL, or when ?renderer=dom
// is set for testing. Shares the exact same counting semantics as the
// 3D scene: same tap contract (onTap(index)), same counted-badge numbers,
// same pastel per number.
import { NUMBER_COLORS } from './layout.js';

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
  <g fill="#fdf8f1">
    <circle cx="60" cy="62" r="30"/>
    <circle cx="36" cy="60" r="16" fill="#ffffff"/>
    <circle cx="84" cy="60" r="16" fill="#ffffff"/>
    <circle cx="44" cy="42" r="15"/>
    <circle cx="76" cy="42" r="15"/>
    <circle cx="60" cy="36" r="16" fill="#ffffff"/>
    <circle cx="40" cy="78" r="14" fill="#f3e9dc"/>
    <circle cx="80" cy="78" r="14" fill="#f3e9dc"/>
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

export function createFallbackRenderer({ container, onTap, reducedMotion }) {
  const field = document.createElement('div');
  field.className = 'sheep-fallback-field';
  const grid = document.createElement('div');
  grid.className = 'sheep-fallback-grid';
  field.appendChild(grid);
  container.appendChild(field);

  let cards = [];

  function render(state) {
    grid.innerHTML = '';
    cards = [];
    grid.dataset.size = String(state.herdSize);
    for (let i = 0; i < state.herdSize; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheep-card';
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
      btn.dataset.index = String(i);
      btn.style.setProperty('--bob-delay', `${(i * 0.37) % 2.2}s`);
      btn.innerHTML = SHEEP_SVG + '<span class="sheep-card-badge" hidden></span>';
      btn.addEventListener('click', () => onTap(i));
      grid.appendChild(btn);
      cards.push(btn);
    }
    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
  }

  function markCounted(index, number, animate = true) {
    const btn = cards[index];
    if (!btn) return;
    const color = NUMBER_COLORS[(number - 1) % NUMBER_COLORS.length];
    btn.classList.add('is-counted');
    btn.style.setProperty('--ribbon', color);
    const badge = btn.querySelector('.sheep-card-badge');
    badge.hidden = false;
    badge.textContent = String(number);
    if (animate && !reducedMotion && btn.animate) {
      btn.animate(
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

  function celebrate() {}

  return {
    kind: 'dom',
    setState(state) {
      render(state);
    },
    countSheep(index, number) {
      markCounted(index, number, true);
    },
    wiggleSheep(index) {
      wiggle(index);
    },
    celebrate() {
      celebrate();
    },
    resetRound(state) {
      render(state);
    },
    destroy() {
      field.remove();
    },
  };
}

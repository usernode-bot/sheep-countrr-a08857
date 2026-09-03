// DOM/card renderer used on devices without WebGL, or when ?renderer=dom
// is set for testing. Shares the exact same counting semantics as the
// 3D scene: same tap contract (onTap(index)), same counted-badge numbers.

export function createFallbackRenderer({ container, onTap }) {
  const field = document.createElement('div');
  field.className = 'sheep-fallback-field';
  container.appendChild(field);

  let cards = [];

  function render(state) {
    field.innerHTML = '';
    cards = [];
    for (let i = 0; i < state.herdSize; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheep-card';
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
      btn.dataset.index = String(i);
      btn.innerHTML =
        '<span class="sheep-card-emoji" aria-hidden="true">🐑</span>' +
        '<span class="sheep-card-badge" hidden></span>';
      btn.addEventListener('click', () => onTap(i));
      field.appendChild(btn);
      cards.push(btn);
    }
    state.counted.forEach((idx, order) => markCounted(idx, order + 1, false));
  }

  function markCounted(index, number, animate = true) {
    const btn = cards[index];
    if (!btn) return;
    btn.classList.add('is-counted');
    const badge = btn.querySelector('.sheep-card-badge');
    badge.hidden = false;
    badge.textContent = String(number);
    if (animate && btn.animate) {
      btn.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' }
      );
    }
  }

  function wiggle(index) {
    const btn = cards[index];
    if (!btn || !btn.animate) return;
    btn.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-6deg)' },
        { transform: 'rotate(6deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 260, easing: 'ease-in-out' }
    );
  }

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
    resetRound(state) {
      render(state);
    },
    destroy() {
      field.remove();
    },
  };
}

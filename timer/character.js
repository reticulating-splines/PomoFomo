/**
 * PomoFomo — Character controllers (character.js)
 *
 * A character is an SVG injected as live DOM (so CSS animations and JS
 * attribute updates work) whose visual state is a single class on its root:
 * `dragon--focus`, `book--idle`, etc. All animation lives in timer.css.
 *
 * Two characters ship: Ember the dragon and Page the book. Both share the
 * same state vocabulary; timer.js can hot-swap them via createCharacter()
 * when the timerCharacter setting changes — no extension reload needed.
 */

export const CHARACTER_STATES = [
  'idle',
  'focus',
  'focus-tired',
  'focus-sleeping',
  'break-start',
  'break-active',
  'break-done',
];

class CharacterController {
  #container;
  #prefix;            // CSS class prefix: 'dragon' | 'book'
  #breakStartMs;      // how long break-start plays before break-active
  #svgEl = null;
  #current = null;
  #pendingState = null;
  #transitionTimer = null;

  constructor(container, { prefix, breakStartMs }) {
    this.#container = container;
    this.#prefix = prefix;
    this.#breakStartMs = breakStartMs;
  }

  async load(svgPath, fallbackEmoji) {
    try {
      const res = await fetch(chrome.runtime.getURL(svgPath));
      this.#container.innerHTML = await res.text();
      this.#svgEl = this.#container.querySelector('svg');
      this.onLoaded(this.#svgEl);
      this.#applyState(this.#pendingState ?? 'idle');
    } catch (err) {
      console.error(`[PomoFomo] Failed to load ${svgPath}:`, err);
      this.#container.innerHTML =
        `<div style="font-size:80px;line-height:1;text-align:center">${fallbackEmoji}</div>`;
    }
    return this;
  }

  /** Subclass hook: cache child elements after injection. */
  onLoaded(_svgEl) {}

  setState(state) {
    if (!CHARACTER_STATES.includes(state)) {
      console.warn('[PomoFomo] Unknown character state:', state);
      state = 'idle';
    }
    if (!this.#svgEl) {
      this.#pendingState = state; // SVG still fetching — apply once loaded
      return;
    }
    this.#applyState(state);
  }

  #applyState(state) {
    if (state === this.#current) return;
    clearTimeout(this.#transitionTimer);

    CHARACTER_STATES.forEach(s => this.#svgEl.classList.remove(`${this.#prefix}--${s}`));
    this.#svgEl.classList.add(`${this.#prefix}--${state}`);
    this.#current = state;

    // break-start is a one-shot celebration that settles into break-active
    if (state === 'break-start') {
      this.#transitionTimer = setTimeout(() => {
        if (this.#current === 'break-start') this.#applyState('break-active');
      }, this.#breakStartMs);
    }
  }

  /**
   * Per-second progress hook (0 → 1 through the current phase).
   * Base characters ignore it; the book drives its page stacks with it.
   */
  setProgress(_ratio, _timerState) {}

  get currentState() { return this.#current; }
  get svgEl() { return this.#svgEl; }

  destroy() {
    clearTimeout(this.#transitionTimer);
    this.#container.innerHTML = '';
    this.#svgEl = null;
  }
}

// ── Ember the dragon ─────────────────────────────────────────────────────────

class DragonController extends CharacterController {
  constructor(container) {
    super(container, { prefix: 'dragon', breakStartMs: 750 });
  }
}

// ── Page the book ─────────────────────────────────────────────────────────────
// Progress shows as two page stacks: read pages grow on the left, unread
// pages shrink on the right. During breaks a shelf shows one finished book
// per completed session.

const STACK_W_MIN = 2;
const STACK_W_MAX = 20;
const LEFT_STACK_RIGHT_EDGE = 22; // left stack grows leftward from this x

class BookController extends CharacterController {
  #leftStack = null;
  #rightStack = null;

  constructor(container) {
    super(container, { prefix: 'book', breakStartMs: 700 });
  }

  onLoaded(svgEl) {
    this.#leftStack = svgEl.querySelector('#book__stack-left');
    this.#rightStack = svgEl.querySelector('#book__stack-right');
  }

  setProgress(ratio, timerState) {
    if (!this.svgEl) return;
    const r = Math.min(1, Math.max(0, ratio));

    if (['focus', 'focus-tired', 'focus-sleeping'].includes(this.currentState)) {
      const leftW = STACK_W_MIN + (STACK_W_MAX - STACK_W_MIN) * r;
      if (this.#leftStack) {
        this.#leftStack.setAttribute('width', leftW.toFixed(1));
        this.#leftStack.setAttribute('x', (LEFT_STACK_RIGHT_EDGE - leftW).toFixed(1));
      }
      const rightW = STACK_W_MIN + (STACK_W_MAX - STACK_W_MIN) * (1 - r);
      this.#rightStack?.setAttribute('width', rightW.toFixed(1));
    }

    if (this.currentState === 'break-active' || this.currentState === 'break-done') {
      // sessionNumber during a break = the session that just finished
      for (let i = 1; i <= 4; i++) {
        const book = this.svgEl.querySelector(`.shelf-book--${i}`);
        if (book) book.style.display = i <= timerState.sessionNumber ? '' : 'none';
      }
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createCharacter(kind, container) {
  if (kind === 'book') {
    return new BookController(container).load('timer/book.svg', '📖');
  }
  return new DragonController(container).load('dragon/dragon.svg', '🐉');
}

/**
 * PomoFomo — Book Controller (book.js)
 *
 * Mirror of DragonController. Fetches timer/book.svg, injects it into
 * #bookContainer, and manages CSS state classes on the SVG root element.
 *
 * Additional capability over the dragon: setProgress(ratio, state) drives
 * the JS-animated page stacks:
 *   #book__stack-left  — read pages, grows leftward  (right edge anchored at x=22)
 *   #book__stack-right — unread pages, shrinks inward (left edge anchored at x=158)
 * Both stacks go from width=2 (minimum) to width=20 (maximum).
 *
 * During break-active the bookshelf shows one book per completed session.
 *
 * Dispatches 'bookReady' on window when the SVG is loaded and ready.
 */

const STATES = [
  'idle',
  'focus',
  'focus-tired',
  'focus-sleeping',
  'break-start',
  'break-active',
  'break-done',
];

// ── Stack geometry constants ──────────────────────────────────────────────────
// Both stacks span width 2 (empty/full side) → 20 (full/empty side).
const STACK_W_MIN    = 2;    // min width in SVG units (nearly finished side)
const STACK_W_MAX    = 20;   // max width (full side)
const STACK_W_RANGE  = STACK_W_MAX - STACK_W_MIN;  // 18

// Left stack: right edge anchored at x=22. x = 22 − width.
const LEFT_STACK_RIGHT_EDGE = 22;

// Right stack: left edge fixed at x=158. x stays constant.
// (Changing width alone is enough — SVG rects grow to the right from x.)

// ── BookController class ──────────────────────────────────────────────────────

class BookController {
  #container;                 // The #bookContainer div
  #svgEl       = null;        // The <svg> element once injected
  #current     = null;        // Current state string
  #pendingState = null;       // State to apply once SVG loads

  // JS-driven SVG elements (cached after load)
  #leftStackEl  = null;       // <rect id="book__stack-left">
  #rightStackEl = null;       // <rect id="book__stack-right">

  constructor(containerEl) {
    this.#container = containerEl;
    this.#load();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Set the book's visual state.
   * @param {string} state one of the STATES values
   */
  setState(state) {
    if (!STATES.includes(state)) {
      console.warn('[PomoFomo Book] Unknown state:', state);
      state = 'idle';
    }

    if (!this.#svgEl) {
      // SVG hasn't loaded yet — queue it
      this.#pendingState = state;
      return;
    }

    this.#applyState(state);
  }

  /**
   * Drive JS-animated progress elements.
   * Called by timer.js tick() every second during active phases.
   *
   * @param {number} ratio  0..1 where 0 = just started, 1 = phase complete
   * @param {object} state  full timer state (uses state.sessionNumber)
   */
  setProgress(ratio, state) {
    if (!this.#svgEl) return;

    const r = Math.min(1, Math.max(0, ratio));
    const isFocus = ['focus', 'focus-tired', 'focus-sleeping'].includes(this.#current);

    if (isFocus) {
      // ── Left stack: read pages — grows leftward as ratio increases ─────────
      // Right edge is anchored at LEFT_STACK_RIGHT_EDGE (x=22).
      // width goes from STACK_W_MIN (ratio=0) to STACK_W_MAX (ratio=1).
      const leftW = (STACK_W_MIN + STACK_W_RANGE * r).toFixed(1);
      const leftX = (LEFT_STACK_RIGHT_EDGE - parseFloat(leftW)).toFixed(1);
      if (this.#leftStackEl) {
        this.#leftStackEl.setAttribute('width', leftW);
        this.#leftStackEl.setAttribute('x', leftX);
      }

      // ── Right stack: unread pages — shrinks inward as ratio increases ──────
      // Left edge stays fixed at x=158 (the rect's x attribute never changes).
      // width goes from STACK_W_MAX (ratio=0) to STACK_W_MIN (ratio=1).
      const rightW = (STACK_W_MIN + STACK_W_RANGE * (1 - r)).toFixed(1);
      if (this.#rightStackEl) {
        this.#rightStackEl.setAttribute('width', rightW);
      }
    }

    // ── Shelf book visibility ───────────────────────────────────────────────
    // During break-active, show one book per completed session.
    // sessionNumber during break = the session that just ended.
    if (this.#current === 'break-active') {
      this.#updateShelf(state.sessionNumber);
    }
  }

  /** Current state string (read-only) */
  get currentState() {
    return this.#current;
  }

  // ── Private methods ────────────────────────────────────────────────────────

  async #load() {
    try {
      const url = chrome.runtime.getURL('timer/book.svg');
      const res = await fetch(url);
      const svgText = await res.text();

      // Inject as live DOM so CSS animations and JS attribute updates work
      this.#container.innerHTML = svgText;
      this.#svgEl = this.#container.querySelector('svg');

      // Cache the JS-driven stack elements
      this.#leftStackEl  = this.#svgEl.querySelector('#book__stack-left');
      this.#rightStackEl = this.#svgEl.querySelector('#book__stack-right');

      // Apply any state that arrived before SVG was ready
      const initialState = this.#pendingState ?? 'idle';
      this.#applyState(initialState);

      // Notify timer.js that the book is ready
      window.dispatchEvent(new CustomEvent('bookReady', {
        detail: { controller: this },
      }));

    } catch (err) {
      console.error('[PomoFomo Book] Failed to load book SVG:', err);
      // Show a friendly fallback so the page still works
      this.#container.innerHTML =
        '<div style="font-size:72px;line-height:1;text-align:center;padding-top:16px">📖</div>';
    }
  }

  #applyState(state) {
    if (state === this.#current) return;

    // Swap CSS state class on the SVG root
    STATES.forEach(s => this.#svgEl.classList.remove(`book--${s}`));
    this.#svgEl.classList.add(`book--${state}`);
    this.#current = state;

    // break-start auto-transitions to break-active after the fly-out animation
    if (state === 'break-start') {
      setTimeout(() => {
        if (this.#current === 'break-start') {
          this.#applyState('break-active');
        }
      }, 700);
    }
  }

  #updateShelf(sessionNumber) {
    if (!this.#svgEl) return;
    // sessionNumber = sessions completed in this cycle; show that many books
    for (let i = 1; i <= 4; i++) {
      const bookEl = this.#svgEl.querySelector(`.shelf-book--${i}`);
      if (bookEl) {
        bookEl.style.display = (i <= sessionNumber) ? '' : 'none';
      }
    }
  }
}

// ── Conditional auto-initialize ───────────────────────────────────────────────
// Only create the controller if timerCharacter === 'book'.
// dragon.js does the same check for 'dragon'.
// timer.js hides the inactive container on load.

const container = document.getElementById('bookContainer');
if (container) {
  const { timerCharacter } = await chrome.storage.sync.get('timerCharacter');
  if (timerCharacter === 'book') {
    new BookController(container);
  }
} else {
  console.warn('[PomoFomo Book] #bookContainer not found.');
}

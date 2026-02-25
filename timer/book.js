/**
 * PomoFomo — Book Controller (book.js)
 *
 * Mirror of DragonController. Fetches timer/book.svg, injects it into
 * #bookContainer, and manages CSS state classes on the SVG root element.
 *
 * Additional capability over the dragon: setProgress(ratio, state) drives
 * JS-animated elements — the bookmark ribbon moves rightward as the focus
 * session progresses, the right-page-edge stack shrinks, and the bookshelf
 * shows the correct number of completed-session books during break-active.
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

// ── Progress constants ────────────────────────────────────────────────────────
// Bookmark: the <g id="book__bookmark"> starts at translate(0,0).
// A translate(dx,0) moves the ribbon from x≈103 (near spine) to x≈142 (right edge).
const BOOKMARK_DX_MAX  = 39;   // SVG units of travel (0 → 39)

// Page-edge stack: right edge anchored at x=156.
// width starts at 6 (full) and shrinks to 1 (almost done).
const EDGE_WIDTH_START = 6;
const EDGE_WIDTH_END   = 1;
const EDGE_ANCHOR_X    = 156;  // right edge stays fixed

// ── BookController class ──────────────────────────────────────────────────────

class BookController {
  #container;                 // The #bookContainer div
  #svgEl       = null;        // The <svg> element once injected
  #current     = null;        // Current state string
  #pendingState = null;       // State to apply once SVG loads

  // JS-driven SVG elements (cached after load)
  #bookmarkEl  = null;        // <g id="book__bookmark">
  #pageEdgeEl  = null;        // <rect id="book__page-edge">

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

    // ── Bookmark position ───────────────────────────────────────────────────
    // Only move during focus states — not during break
    const isFocus = ['focus', 'focus-tired', 'focus-sleeping'].includes(this.#current);
    if (isFocus && this.#bookmarkEl) {
      const dx = (BOOKMARK_DX_MAX * r).toFixed(2);
      this.#bookmarkEl.setAttribute('transform', `translate(${dx}, 0)`);
    }

    // ── Right page-edge width ───────────────────────────────────────────────
    // Shrinks as pages are "read"; right edge stays anchored
    if (isFocus && this.#pageEdgeEl) {
      const w = (EDGE_WIDTH_START - (EDGE_WIDTH_START - EDGE_WIDTH_END) * r).toFixed(2);
      const x = (EDGE_ANCHOR_X - parseFloat(w)).toFixed(2);
      this.#pageEdgeEl.setAttribute('width', w);
      this.#pageEdgeEl.setAttribute('x', x);
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

      // Cache the JS-driven elements
      this.#bookmarkEl = this.#svgEl.querySelector('#book__bookmark');
      this.#pageEdgeEl = this.#svgEl.querySelector('#book__page-edge');

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

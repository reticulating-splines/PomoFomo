/**
 * PomoFomo — Dragon Controller (dragon.js)
 *
 * Fetches dragon.svg, injects it into #dragonContainer, and manages
 * which CSS state class is active on the SVG root element.
 *
 * Dispatches a 'dragonReady' event on window when the SVG is loaded,
 * so timer.js can begin sending state updates.
 */

const STATES = [
  'idle',
  'focus',
  'focus-tired',
  'break-start',
  'break-active',
  'break-done',
];

class DragonController {
  #container;       // The #dragonContainer div
  #svgEl = null;    // The <svg> element once injected
  #current = null;  // Current state string
  #pendingState = null; // State to apply once SVG loads

  constructor(container) {
    this.#container = container;
    this.#load();
  }

  async #load() {
    try {
      const url = chrome.runtime.getURL('dragon/dragon.svg');
      const res = await fetch(url);
      const svgText = await res.text();

      // Inject SVG as live DOM (not <img>) so CSS animations work
      this.#container.innerHTML = svgText;
      this.#svgEl = this.#container.querySelector('svg');

      // Apply any state that arrived before the SVG was ready
      const initialState = this.#pendingState ?? 'idle';
      this.#applyState(initialState);

      // Notify timer.js that the dragon is ready
      window.dispatchEvent(new CustomEvent('dragonReady', {
        detail: { controller: this },
      }));

    } catch (err) {
      console.error('[PomoFomo Dragon] Failed to load dragon SVG:', err);
      // Show a friendly fallback emoji so the page still works
      this.#container.innerHTML = '<div style="font-size:80px;line-height:1;text-align:center">🐉</div>';
    }
  }

  /**
   * Set the dragon's visual state.
   * @param {string} state - one of: idle, focus, focus-tired, break-start,
   *                         break-active, break-done
   */
  setState(state) {
    if (!STATES.includes(state)) {
      console.warn('[PomoFomo Dragon] Unknown state:', state);
      state = 'idle';
    }

    if (!this.#svgEl) {
      // SVG hasn't loaded yet — queue it
      this.#pendingState = state;
      return;
    }

    this.#applyState(state);
  }

  #applyState(state) {
    if (state === this.#current) return;

    // Remove all existing state classes
    STATES.forEach(s => this.#svgEl.classList.remove(`dragon--${s}`));

    // Add new state class
    this.#svgEl.classList.add(`dragon--${state}`);
    this.#current = state;

    // break-start auto-transitions to break-active after the jump animation
    if (state === 'break-start') {
      setTimeout(() => {
        if (this.#current === 'break-start') {
          this.#applyState('break-active');
        }
      }, 750);
    }
  }

  get currentState() {
    return this.#current;
  }
}

// ── Auto-initialize on the timer page ────────────────────────────────────────
// dragon.js is loaded as a module in timer.html before timer.js,
// so the controller is created and the SVG fetch starts immediately.

const container = document.getElementById('dragonContainer');
if (container) {
  // Instantiated here; timer.js receives the instance via the 'dragonReady' event
  new DragonController(container);
} else {
  console.warn('[PomoFomo Dragon] #dragonContainer not found.');
}

/**
 * PomoFomo — FaviconUpdater (favicon.js)
 *
 * Draws a 32×32 canvas icon — phase-colored disc plus a white progress
 * arc — and swaps it into the page's <link rel="icon"> as a data URL.
 * Called once per render/tick by timer.js.
 */

import { STATUS } from '../shared/constants.js';

const COLORS = {
  [STATUS.IDLE]:       '#9A8070',
  [STATUS.FOCUS]:      '#F5A623',
  [STATUS.BREAK]:      '#2BBFA0',
  [STATUS.LONG_BREAK]: '#2BBFA0',
};

export class FaviconUpdater {
  #linkEl;
  #canvas;
  #ctx;

  constructor(linkEl) {
    this.#linkEl = linkEl;
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = 32;
    this.#canvas.height = 32;
    this.#ctx = this.#canvas.getContext('2d');
  }

  update(state) {
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, 32, 32);

    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, 2 * Math.PI);
    ctx.fillStyle = this.#color(state);
    ctx.fill();

    if (state.startTime && state.phaseDuration && !state.isPaused) {
      const elapsed = Date.now() - state.startTime;
      const isBreak = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;
      const ratio = Math.min(1, elapsed / state.phaseDuration);
      const shown = isBreak ? ratio : 1 - ratio; // break fills, focus drains

      if (shown > 0) {
        const start = -Math.PI / 2;
        ctx.beginPath();
        ctx.arc(16, 16, 11, start, start + shown * 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    if (state.isPaused) {
      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
    }

    this.#linkEl.href = this.#canvas.toDataURL('image/png');
  }

  #color(state) {
    if (state.status === STATUS.FOCUS_WARNING) {
      // Pulse between deep and bright amber on a 1-second beat
      return Date.now() % 2000 < 1000 ? '#E8842A' : '#F5A623';
    }
    return COLORS[state.status] ?? COLORS[STATUS.IDLE];
  }
}

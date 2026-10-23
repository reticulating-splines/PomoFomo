/**
 * PomoFomo — FaviconUpdater (favicon.js)
 *
 * Draws a 32×32 canvas icon — a phase-coloured disc with a white progress
 * ring — and swaps it into the page's <link rel="icon"> as a data URL. At
 * idle it shows the app icon. Called once per render/tick by timer.js; it
 * skips the encode when nothing visible has changed.
 */

import { STATUS, BREAK_STATUSES } from '../shared/constants.js';
import { phaseProgress } from '../shared/timing.js';

const COLORS = {
  [STATUS.FOCUS]:      '#6C6FF5',
  [STATUS.BREAK]:      '#1FAE79',
  [STATUS.LONG_BREAK]: '#1FAE79',
};
const WARN = ['#F29A1F', '#E5503C']; // pulses between these
const PAUSED = '#8E86A6';
const IDLE_HREF = '../assets/icons/icon32.png';

export class FaviconUpdater {
  #linkEl;
  #ctx;
  #lastKey = null;

  constructor(linkEl) {
    this.#linkEl = linkEl;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    this.#ctx = canvas.getContext('2d');
  }

  update(state) {
    if (state.status === STATUS.IDLE) {
      if (this.#lastKey !== 'idle') this.#linkEl.href = IDLE_HREF;
      this.#lastKey = 'idle';
      return;
    }

    const ratio = phaseProgress(state);
    const shown = BREAK_STATUSES.includes(state.status) ? ratio : 1 - ratio;
    const color = this.#color(state);
    const key = `${color}:${Math.round(shown * 48)}:${state.isPaused}`;
    if (key === this.#lastKey) return;
    this.#lastKey = key;

    const ctx = this.#ctx;
    ctx.clearRect(0, 0, 32, 32);

    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(16, 16, 10.5, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.stroke();

    if (shown > 0.01) {
      const start = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(16, 16, 10.5, start, start + shown * 2 * Math.PI);
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }

    if (state.isPaused) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(12, 11, 3, 10);
      ctx.fillRect(17, 11, 3, 10);
    }

    this.#linkEl.href = ctx.canvas.toDataURL('image/png');
  }

  #color(state) {
    if (state.isPaused) return PAUSED;
    if (state.status === STATUS.FOCUS_WARNING) return WARN[Math.floor(Date.now() / 1000) % 2];
    return COLORS[state.status] ?? PAUSED;
  }
}

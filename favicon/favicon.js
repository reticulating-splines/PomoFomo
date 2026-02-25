/**
 * FaviconUpdater
 * Draws a 32×32 canvas icon showing the current timer phase color + progress arc.
 * Updates the <link id="favicon"> element's href with a data URL every tick.
 */

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

  /**
   * @param {object} state  — current timer state from background.js
   */
  update(state) {
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, 32, 32);

    // Background circle
    const color = this.#statusColor(state);
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Progress arc
    if (state.startTime && state.phaseDuration && !state.isPaused) {
      const elapsed = Date.now() - state.startTime;
      const isBreak = state.status === 'break' || state.status === 'longBreak';

      // Break fills up (recharge), focus drains
      const rawProgress = Math.min(1, elapsed / state.phaseDuration);
      const arcProgress = isBreak ? rawProgress : 1 - rawProgress;

      if (arcProgress > 0) {
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + arcProgress * 2 * Math.PI;

        ctx.beginPath();
        ctx.arc(16, 16, 11, startAngle, endAngle);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // Paused: draw a white dot in center
    if (state.isPaused) {
      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
    }

    this.#linkEl.href = this.#canvas.toDataURL('image/png');
  }

  /**
   * Returns the fill color for the current state.
   * During focus-warning, pulses between two amber tones every second.
   */
  #statusColor(state) {
    const colorMap = {
      'idle':         '#9A8070',
      'focus':        '#F5A623',
      'focus-warning': null, // handled below (pulsing)
      'break':        '#2BBFA0',
      'longBreak':    '#2BBFA0',
    };

    if (state.status === 'focus-warning') {
      // Pulse between deep amber and bright amber on a 1-second cycle
      return Date.now() % 2000 < 1000 ? '#E8842A' : '#F5A623';
    }

    return colorMap[state.status] ?? '#9A8070';
  }
}

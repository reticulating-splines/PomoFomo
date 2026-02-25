/**
 * PomoFomo — Sound Player (sounds.js)
 *
 * All sounds are synthesized via Web Audio API. No external files needed.
 *
 * IMPORTANT: Chrome's autoplay policy requires a user gesture before an
 * AudioContext can produce sound. Call unlock() on the first user click
 * (the Start button) to enable all subsequent sounds.
 */

export class SoundPlayer {
  #ctx       = null;
  #enabled   = true;
  #unlocked  = false;

  // Active ambient nodes (kept so we can stop them)
  #ambientNodes  = [];
  #ambientTimer  = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Call this on the first user gesture (Start button click).
   * Creates and resumes the AudioContext, enabling all future sounds.
   */
  async unlock() {
    try {
      const ctx = this.#getCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      this.#unlocked = true;
      console.log('[PomoFomo Sounds] AudioContext unlocked.');
    } catch (e) {
      console.warn('[PomoFomo Sounds] Could not unlock AudioContext:', e);
    }
  }

  setEnabled(val) {
    this.#enabled = Boolean(val);
    if (!val) this.stopAmbient();
  }

  // ── Chimes ─────────────────────────────────────────────────────────────────

  /**
   * Play a chime.
   * @param {'warning'|'break'|'snooze'} variant
   */
  playChime(variant = 'warning') {
    if (!this.#enabled || !this.#unlocked) return;
    const ctx = this.#getCtx();
    if (ctx.state !== 'running') return;

    switch (variant) {
      case 'warning': this.#playWarningChime(ctx); break;
      case 'break':   this.#playBreakChime(ctx);   break;
      case 'snooze':  this.#playSnoozeTone(ctx);   break;
      default:        this.#playWarningChime(ctx);
    }
  }

  /** Soft descending two-note tone: G5 → E5. "Heads up." */
  #playWarningChime(ctx) {
    const now = ctx.currentTime;

    this.#tone(ctx, {
      freq:    784,     // G5
      startAt: now,
      volume:  0.12,
      attack:  0.03,
      decay:   0.5,
    });

    this.#tone(ctx, {
      freq:    659,     // E5
      startAt: now + 0.28,
      volume:  0.10,
      attack:  0.03,
      decay:   0.6,
    });
  }

  /** Bright ascending three-note arpeggio: C5 → E5 → G5. Celebratory. */
  #playBreakChime(ctx) {
    const now = ctx.currentTime;
    const notes = [523, 659, 784]; // C5, E5, G5

    notes.forEach((freq, i) => {
      this.#tone(ctx, {
        freq,
        startAt: now + i * 0.14,
        volume:  0.14,
        attack:  0.02,
        decay:   0.7,
      });
    });

    // Add a soft fourth note an octave up for sparkle
    this.#tone(ctx, {
      freq:    1047,    // C6
      startAt: now + 0.42,
      volume:  0.07,
      attack:  0.02,
      decay:   0.9,
    });
  }

  /** Gentle rising tone for snooze acknowledgement. */
  #playSnoozeTone(ctx) {
    const now = ctx.currentTime;

    this.#tone(ctx, {
      freq:    440,     // A4
      startAt: now,
      volume:  0.10,
      attack:  0.04,
      decay:   0.6,
    });

    this.#tone(ctx, {
      freq:    494,     // B4
      startAt: now + 0.25,
      volume:  0.08,
      attack:  0.04,
      decay:   0.5,
    });
  }

  // ── Ambient nature sounds ──────────────────────────────────────────────────

  /** Start ambient break sounds: soft brown noise + pentatonic melodic tones. */
  startAmbient() {
    if (!this.#enabled || !this.#unlocked) return;
    const ctx = this.#getCtx();
    if (ctx.state !== 'running') return;

    this.stopAmbient(); // clear any existing

    // ── Brown noise (gentle wind-like texture) ─────────────────────────────
    const bufferSize = 4096;
    // createScriptProcessor is deprecated but works fine; migrate to AudioWorklet post-MVP
    const brownNoiseNode = ctx.createScriptProcessor(bufferSize, 1, 1);
    let lastOut = 0;
    brownNoiseNode.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const white = (Math.random() * 2 - 1);
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // amplify
      }
    };

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.035; // very subtle — just texture
    brownNoiseNode.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    this.#ambientNodes.push(brownNoiseNode, noiseGain);

    // ── Pentatonic melodic tones (bird-like, sporadic) ─────────────────────
    this.#schedulePentatonicTones(ctx);
  }

  /** Schedule a pentatonic tone, then schedule itself again after a random delay. */
  #schedulePentatonicTones(ctx) {
    // C4 pentatonic: C, D, E, G, A (one and two octaves)
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];

    const playTone = () => {
      if (!this.#enabled || !this.#unlocked || ctx.state !== 'running') return;

      const freq = scale[Math.floor(Math.random() * scale.length)];
      // Occasionally play a two-note phrase instead of a single note
      const doPhrase = Math.random() < 0.35;

      this.#tone(ctx, {
        freq,
        startAt: ctx.currentTime,
        volume:  0.06 + Math.random() * 0.04,
        attack:  0.05,
        decay:   1.2 + Math.random() * 0.8,
        type:    'sine',
      });

      if (doPhrase) {
        // Second note, slightly higher
        const freq2 = scale[Math.min(scale.length - 1, scale.indexOf(freq) + 1 + Math.floor(Math.random() * 2))];
        this.#tone(ctx, {
          freq:    freq2,
          startAt: ctx.currentTime + 0.25,
          volume:  0.05 + Math.random() * 0.03,
          attack:  0.05,
          decay:   1.0 + Math.random() * 0.6,
          type:    'sine',
        });
      }

      // Schedule next tone: 2–5 seconds from now
      const delay = 2000 + Math.random() * 3000;
      this.#ambientTimer = setTimeout(playTone, delay);
    };

    // Start after a brief pause
    this.#ambientTimer = setTimeout(playTone, 800);
  }

  /** Stop all ambient sounds. */
  stopAmbient() {
    clearTimeout(this.#ambientTimer);
    this.#ambientTimer = null;

    this.#ambientNodes.forEach(node => {
      try { node.disconnect(); } catch (_e) {}
    });
    this.#ambientNodes = [];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Lazy AudioContext creation. */
  #getCtx() {
    if (!this.#ctx) {
      this.#ctx = new AudioContext();
    }
    return this.#ctx;
  }

  /**
   * Play a single synthesized tone.
   * @param {object} opts
   * @param {number} opts.freq     — frequency in Hz
   * @param {number} opts.startAt  — AudioContext time to start
   * @param {number} opts.volume   — peak gain (0–1)
   * @param {number} opts.attack   — attack time in seconds
   * @param {number} opts.decay    — decay/release time in seconds
   * @param {string} [opts.type]   — oscillator type (default 'sine')
   */
  #tone(ctx, { freq, startAt, volume, attack, decay, type = 'sine' }) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);

    // Envelope: fade in quickly, then decay to silence
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);

    osc.start(startAt);
    osc.stop(startAt + attack + decay + 0.05);

    // Cleanup after the note ends
    osc.onended = () => {
      try { osc.disconnect(); gain.disconnect(); } catch (_e) {}
    };
  }
}

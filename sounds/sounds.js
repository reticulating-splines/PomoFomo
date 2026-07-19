/**
 * PomoFomo — Sound Player (sounds.js)
 *
 * All sounds are synthesized with the Web Audio API — no audio files.
 *
 * Chrome's autoplay policy requires a user gesture before an AudioContext
 * can produce sound: call unlock() from a click handler. Every play method
 * is a silent no-op until unlocked.
 */

export class SoundPlayer {
  #ctx = null;
  #enabled = true;
  #unlocked = false;

  // Ambient graph (null when not playing)
  #ambient = null; // { noiseSource, nodes: [], melodyTimer }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  async unlock() {
    try {
      const ctx = this.#getCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      this.#unlocked = true;
    } catch (e) {
      console.warn('[PomoFomo Sounds] Could not unlock AudioContext:', e);
    }
  }

  get unlocked() { return this.#unlocked; }

  setEnabled(val) {
    this.#enabled = Boolean(val);
    if (!this.#enabled) this.#stopAmbient();
  }

  get #ready() {
    return this.#enabled && this.#unlocked && this.#getCtx().state === 'running';
  }

  // ── Chimes ─────────────────────────────────────────────────────────────────

  /** @param {'warning'|'break'|'snooze'} variant */
  playChime(variant = 'warning') {
    if (!this.#ready) return;
    const ctx = this.#getCtx();
    const now = ctx.currentTime;

    switch (variant) {
      case 'break':
        // Bright ascending arpeggio C5–E5–G5 (+C6 sparkle): celebration
        [523, 659, 784].forEach((freq, i) =>
          this.#tone(ctx, { freq, startAt: now + i * 0.14, volume: 0.14, attack: 0.02, decay: 0.7 }));
        this.#tone(ctx, { freq: 1047, startAt: now + 0.42, volume: 0.07, attack: 0.02, decay: 0.9 });
        break;

      case 'snooze':
        // Gentle rising A4 → B4: "okay, a little longer"
        this.#tone(ctx, { freq: 440, startAt: now, volume: 0.10, attack: 0.04, decay: 0.6 });
        this.#tone(ctx, { freq: 494, startAt: now + 0.25, volume: 0.08, attack: 0.04, decay: 0.5 });
        break;

      default:
        // Soft descending G5 → E5: "heads up"
        this.#tone(ctx, { freq: 784, startAt: now, volume: 0.12, attack: 0.03, decay: 0.5 });
        this.#tone(ctx, { freq: 659, startAt: now + 0.28, volume: 0.10, attack: 0.03, decay: 0.6 });
    }
  }

  // ── Ambient break soundscape ───────────────────────────────────────────────
  // Soft wind (looped brown-noise buffer through a lowpass) plus sporadic
  // pentatonic tones, bird-like. Idempotent: setAmbient(true) while already
  // playing does nothing.

  setAmbient(on) {
    if (on) this.#startAmbient();
    else this.#stopAmbient();
  }

  #startAmbient() {
    if (this.#ambient || !this.#ready) return;
    const ctx = this.#getCtx();

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this.#brownNoiseBuffer(ctx);
    noiseSource.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 480;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.5); // fade in

    noiseSource.connect(lowpass).connect(gain).connect(ctx.destination);
    noiseSource.start();

    this.#ambient = { noiseSource, nodes: [lowpass, gain], melodyTimer: null };
    this.#scheduleMelody(ctx);
  }

  #stopAmbient() {
    if (!this.#ambient) return;
    const { noiseSource, nodes, melodyTimer } = this.#ambient;
    this.#ambient = null;
    clearTimeout(melodyTimer);
    try { noiseSource.stop(); } catch { /* already stopped */ }
    [noiseSource, ...nodes].forEach(n => { try { n.disconnect(); } catch { /* ok */ } });
  }

  #scheduleMelody(ctx) {
    // C-major pentatonic across two octaves
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];

    const playNote = () => {
      if (!this.#ambient || !this.#ready) return;

      const idx = Math.floor(Math.random() * scale.length);
      this.#tone(ctx, {
        freq: scale[idx],
        startAt: ctx.currentTime,
        volume: 0.06 + Math.random() * 0.04,
        attack: 0.05,
        decay: 1.2 + Math.random() * 0.8,
      });

      // Occasionally answer with a slightly higher second note
      if (Math.random() < 0.35) {
        const idx2 = Math.min(scale.length - 1, idx + 1 + Math.floor(Math.random() * 2));
        this.#tone(ctx, {
          freq: scale[idx2],
          startAt: ctx.currentTime + 0.25,
          volume: 0.05 + Math.random() * 0.03,
          attack: 0.05,
          decay: 1.0 + Math.random() * 0.6,
        });
      }

      this.#ambient.melodyTimer = setTimeout(playNote, 2000 + Math.random() * 3000);
    };

    this.#ambient.melodyTimer = setTimeout(playNote, 800);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #getCtx() {
    if (!this.#ctx) this.#ctx = new AudioContext();
    return this.#ctx;
  }

  #noiseBuffer = null;

  /** 4-second brown noise loop, generated once. */
  #brownNoiseBuffer(ctx) {
    if (this.#noiseBuffer) return this.#noiseBuffer;
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // Short crossfade at the loop seam to avoid a click
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[length - fade + i] * (1 - t);
    }
    this.#noiseBuffer = buffer;
    return buffer;
  }

  /** One synthesized tone with an attack/decay envelope. */
  #tone(ctx, { freq, startAt, volume, attack, decay, type = 'sine' }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);

    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);

    osc.start(startAt);
    osc.stop(startAt + attack + decay + 0.05);
    osc.onended = () => {
      try { osc.disconnect(); gain.disconnect(); } catch { /* ok */ }
    };
  }
}

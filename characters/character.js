/**
 * PomoFomo — Character controller (character.js)
 *
 * A character is an SVG injected as live DOM (so CSS animations work) whose
 * visual state is a single class on its root: `ember--focus`, `page--idle`…
 * All animation lives in characters/<name>.css, which pages link up front.
 *
 * Ember the dragon and Page the book share one state vocabulary, so pages
 * can hot-swap them when the timerCharacter setting changes.
 */

import { characterInfo } from '../shared/constants.js';

export const CHARACTER_STATES = [
  'idle',
  'focus',
  'focus-tired',
  'focus-sleeping',
  'break-start',
  'break-active',
  'break-done',
];

const svgCache = new Map(); // path → markup, so swaps and second copies are instant

async function fetchSvg(path) {
  if (!svgCache.has(path)) {
    const res = await fetch(chrome.runtime.getURL(path));
    svgCache.set(path, await res.text());
  }
  return svgCache.get(path);
}

export class Character {
  #container;
  #info;
  #svgEl = null;
  #current = null;
  #pending = 'idle';
  #settleTimer = null;

  constructor(container, key) {
    this.#container = container;
    this.#info = characterInfo(key);
  }

  get info() { return this.#info; }
  get currentState() { return this.#current; }

  async load() {
    try {
      this.#container.innerHTML = await fetchSvg(this.#info.svg);
      this.#svgEl = this.#container.querySelector('svg');
      this.#apply(this.#pending);
    } catch (err) {
      console.error(`[PomoFomo] Failed to load ${this.#info.svg}:`, err);
    }
    return this;
  }

  setState(state) {
    if (!CHARACTER_STATES.includes(state)) state = 'idle';
    this.#pending = state;
    if (this.#svgEl) this.#apply(state);
  }

  #apply(state) {
    if (state === this.#current) return;
    clearTimeout(this.#settleTimer);

    const { prefix, breakStartMs } = this.#info;
    for (const s of CHARACTER_STATES) this.#svgEl.classList.remove(`${prefix}--${s}`);
    this.#svgEl.classList.add(`${prefix}--${state}`);
    this.#current = state;

    // break-start is a one-shot celebration that settles into break-active
    if (state === 'break-start') {
      this.#settleTimer = setTimeout(() => {
        if (this.#current === 'break-start') this.#apply('break-active');
      }, breakStartMs);
    }
  }

  destroy() {
    clearTimeout(this.#settleTimer);
    this.#container.innerHTML = '';
    this.#svgEl = null;
  }
}

export function createCharacter(key, container) {
  return new Character(container, key).load();
}

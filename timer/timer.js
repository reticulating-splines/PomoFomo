/**
 * PomoFomo — Timer Tab (timer.js)
 *
 * Pure renderer: reads state from chrome.storage on load, subscribes to
 * chrome.storage.onChanged for every update, and sends user actions to the
 * service worker. No timing decisions happen here — the per-second interval
 * only repaints time derived from startTime/phaseDuration.
 *
 * Chimes are derived from observed status transitions (focus → warning,
 * anything → break, snooze), so no push messaging from the SW is needed.
 */

import {
  STATUS, MSG, BREAK_STATUSES, DEFAULT_SETTINGS,
} from '../shared/constants.js';
import { getState, getSettings } from '../shared/storage.js';
import { createCharacter } from './character.js';
import { FaviconUpdater } from '../favicon/favicon.js';
import { SoundPlayer } from '../sounds/sounds.js';

// ── Arc geometry (matches the SVG in timer.html) ─────────────────────────────
const ARC_RADIUS = 96;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

// How long the character celebrates "break-done" when a break rolls into the
// next focus session, before settling into the focus pose.
const BREAK_DONE_MS = 1600;

// ── Element refs ─────────────────────────────────────────────────────────────
const bodyEl        = document.body;
const progressArc   = document.getElementById('progressArc');
const timeDisplay   = document.getElementById('timeDisplay');
const statusLabel   = document.getElementById('statusLabel');
const sessionDots   = document.getElementById('sessionDots');
const sessionLabel  = document.getElementById('sessionLabel');
const btnStart      = document.getElementById('btnStart');
const btnSnooze     = document.getElementById('btnSnooze');
const btnStopLink   = document.getElementById('btnStopLink');
const breakBanner   = document.getElementById('breakBanner');
const bannerTitle   = document.getElementById('breakBannerTitle');
const bannerSubtitle = document.getElementById('breakBannerSubtitle');
const characterContainer = document.getElementById('characterContainer');

const favicon = new FaviconUpdater(document.getElementById('favicon'));
const sounds  = new SoundPlayer();

// ── Local caches ─────────────────────────────────────────────────────────────
let currentState = null;
let settings = { ...DEFAULT_SETTINGS };
let character = null;
let tickInterval = null;
let celebrateTimer = null; // non-null while playing the break-done pose

progressArc.style.strokeDasharray = ARC_CIRCUMFERENCE;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [state, loadedSettings] = await Promise.all([getState(), getSettings()]);
  settings = loadedSettings;
  sounds.setEnabled(settings.soundEnabled);
  character = await createCharacter(settings.timerCharacter, characterContainer);
  characterContainer.setAttribute(
    'aria-label',
    settings.timerCharacter === 'book' ? 'Page the book' : 'Ember the dragon',
  );
  render(state);
}

init();

// ── Storage subscription — the only state input after load ───────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local') {
    const prev = currentState;
    const next = await getState();
    onTransition(prev, next);
    render(next);
  } else if (area === 'sync') {
    const prevCharacter = settings.timerCharacter;
    settings = await getSettings();
    sounds.setEnabled(settings.soundEnabled);
    if (settings.timerCharacter !== prevCharacter) await swapCharacter();
    if (currentState) render(currentState);
  }
});

async function swapCharacter() {
  character?.destroy();
  character = await createCharacter(settings.timerCharacter, characterContainer);
  characterContainer.setAttribute(
    'aria-label',
    settings.timerCharacter === 'book' ? 'Page the book' : 'Ember the dragon',
  );
  if (currentState) character.setState(characterState(currentState));
}

// ── Transition effects (chimes + celebrations) ───────────────────────────────

function onTransition(prev, next) {
  if (!prev || prev.status === next.status) {
    // Same phase — the only interesting micro-transition is snooze
    if (prev && !prev.snoozeUsed && next.snoozeUsed) sounds.playChime('snooze');
    return;
  }

  const wasBreak = BREAK_STATUSES.includes(prev.status);
  const isBreak  = BREAK_STATUSES.includes(next.status);

  if (next.status === STATUS.FOCUS_WARNING) {
    sounds.playChime('warning');
  } else if (isBreak && !wasBreak) {
    sounds.playChime('break');
  } else if (wasBreak && next.status === STATUS.FOCUS) {
    // Break rolled into the next session — let the character celebrate first
    celebrate();
  }
}

function celebrate() {
  clearTimeout(celebrateTimer);
  character?.setState('break-done');
  celebrateTimer = setTimeout(() => {
    celebrateTimer = null;
    if (currentState) character?.setState(characterState(currentState));
  }, BREAK_DONE_MS);
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(state) {
  currentState = state;

  bodyEl.dataset.status = state.status;
  bodyEl.dataset.paused = String(Boolean(state.isPaused));

  if (character && !celebrateTimer) {
    const target = characterState(state);
    // Don't replay the break-start jump if we've already settled into
    // break-active (e.g. a settings change re-rendered mid-break)
    if (!(target === 'break-start' && character.currentState === 'break-active')) {
      character.setState(target);
    }
  }

  renderSessionDots(state);
  renderControls(state);
  renderBanner(state);
  statusLabel.textContent = statusText(state);

  clearInterval(tickInterval);
  if (isRunning(state)) {
    tick();
    tickInterval = setInterval(tick, 1000);
  } else {
    // Idle or paused: show a static time and a full (ready) ring
    const ms = state.isPaused && state.pausedRemaining != null
      ? state.pausedRemaining
      : state.phaseDuration ?? settings.focusMinutes * 60 * 1000;
    timeDisplay.textContent = formatTime(ms);
    progressArc.style.strokeDashoffset = 0;
  }

  favicon.update(state);
  syncAmbient(state);
}

function tick() {
  const state = currentState;
  if (!isRunning(state)) return;

  const elapsed = Date.now() - state.startTime;
  const remaining = Math.max(0, state.phaseDuration - elapsed);
  const ratio = Math.min(1, elapsed / state.phaseDuration);

  timeDisplay.textContent = formatTime(remaining);

  // Focus: ring drains toward empty. Break: ring fills back up (recharge).
  const shown = BREAK_STATUSES.includes(state.status) ? ratio : 1 - ratio;
  progressArc.style.strokeDashoffset = ARC_CIRCUMFERENCE * (1 - shown);

  favicon.update(state);

  // Final seconds of the warning: the character nods off (visual only —
  // the SW state stays focus-warning)
  if (state.status === STATUS.FOCUS_WARNING && character && !celebrateTimer) {
    character.setState(remaining <= 10_000 ? 'focus-sleeping' : 'focus-tired');
  }

  character?.setProgress(ratio, state);
}

function renderSessionDots(state) {
  const total = settings.sessionsBeforeLongBreak;
  const onBreak = BREAK_STATUSES.includes(state.status);

  sessionDots.replaceChildren(...Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const dot = document.createElement('span');
    dot.className = 'session-dot';
    // During a break, sessionNumber is the session just completed
    if (n < state.sessionNumber || (onBreak && n === state.sessionNumber)) {
      dot.classList.add('done');
    } else if (n === state.sessionNumber) {
      dot.classList.add('current');
    }
    return dot;
  }));

  sessionLabel.textContent = onBreak
    ? (state.status === STATUS.LONG_BREAK ? 'Long break' : 'Break time')
    : `Session ${state.sessionNumber}`;
}

function renderControls(state) {
  btnStart.hidden = state.status !== STATUS.IDLE;
  btnSnooze.hidden = !(state.status === STATUS.FOCUS_WARNING && !state.snoozeUsed);
  btnStopLink.hidden = state.status === STATUS.IDLE;
}

function renderBanner(state) {
  const onBreak = BREAK_STATUSES.includes(state.status);
  breakBanner.hidden = !onBreak;
  if (!onBreak) return;

  const isBook = settings.timerCharacter === 'book';
  if (state.status === STATUS.LONG_BREAK) {
    bannerTitle.textContent = isBook ? 'Long break time! 📚✨' : 'Long break time! 🐉✨';
    bannerSubtitle.textContent = 'You finished a whole cycle — amazing work!';
  } else {
    bannerTitle.textContent = isBook ? 'Break time! 📖' : 'Break time! 🐉';
    bannerSubtitle.textContent = isBook
      ? 'Another chapter done — you\'ve earned this rest.'
      : 'Ember is celebrating — you\'ve earned this rest.';
  }
}

// ── Sounds ───────────────────────────────────────────────────────────────────

function syncAmbient(state) {
  const wantAmbient = BREAK_STATUSES.includes(state.status) && !state.isPaused;
  sounds.setAmbient(wantAmbient);
}

// Web Audio needs a user gesture; the Start button is the natural one, but
// any click in the tab unlocks (covers reloads mid-session).
document.addEventListener('click', async () => {
  const wasUnlocked = sounds.unlocked;
  await sounds.unlock();
  if (!wasUnlocked && currentState) syncAmbient(currentState);
}, { passive: true });

// ── User actions — send and forget; storage.onChanged repaints ───────────────

btnStart.addEventListener('click', () => sendMsg(MSG.START));
btnSnooze.addEventListener('click', () => sendMsg(MSG.SNOOZE));
btnStopLink.addEventListener('click', () => sendMsg(MSG.STOP));

async function sendMsg(type) {
  try {
    await chrome.runtime.sendMessage({ type });
  } catch (e) {
    console.error('[PomoFomo Timer] sendMsg failed:', type, e);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function characterState(state) {
  if (state.isPaused) return 'idle';
  switch (state.status) {
    case STATUS.FOCUS:         return 'focus';
    case STATUS.FOCUS_WARNING: return 'focus-tired'; // tick() may deepen to sleeping
    case STATUS.BREAK:
    case STATUS.LONG_BREAK:    return 'break-start'; // settles into break-active
    default:                   return 'idle';
  }
}

function isRunning(state) {
  return state.startTime != null
    && state.phaseDuration != null
    && !state.isPaused
    && state.status !== STATUS.IDLE;
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function statusText(state) {
  if (state.isPaused) return 'Paused';
  switch (state.status) {
    case STATUS.IDLE:          return 'Ready to focus?';
    case STATUS.FOCUS:         return 'Focus time';
    case STATUS.FOCUS_WARNING: return 'Almost there…';
    case STATUS.BREAK:         return 'Break time!';
    case STATUS.LONG_BREAK:    return 'Long break — great work!';
    default:                   return '';
  }
}

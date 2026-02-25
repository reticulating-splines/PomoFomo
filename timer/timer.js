/**
 * PomoFomo — Timer Tab (timer.js)
 *
 * Responsibilities:
 *  - Request and receive state from the service worker
 *  - Render the progress arc, time display, session dots, status label
 *  - Wire button clicks to service worker messages
 *  - Update the dragon state via DragonController
 *  - Update the favicon via FaviconUpdater
 *  - Play sounds via SoundPlayer (unlocked on first user gesture)
 *
 * This file does NOT make timing decisions — it displays what the SW tells it.
 */

import { MSG, STATUS } from '../shared/constants.js';
import { FaviconUpdater } from '../favicon/favicon.js';
import { SoundPlayer } from '../sounds/sounds.js';

// ── Arc geometry (must match SVG viewBox in timer.html) ──────────────────────
const ARC_RADIUS       = 96;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS; // ≈ 603.2

// ── Element refs ─────────────────────────────────────────────────────────────
const bodyEl          = document.body;
const progressArc     = document.getElementById('progressArc');
const timeDisplay     = document.getElementById('timeDisplay');
const statusLabel     = document.getElementById('statusLabel');
const sessionDots     = document.getElementById('sessionDots');
const sessionLabelEl  = document.getElementById('sessionLabel');
const btnSnooze       = document.getElementById('btnSnooze');
const breakBanner     = document.getElementById('breakBanner');
const breakBannerTitle   = document.getElementById('breakBannerTitle');
const breakBannerSubtitle = document.getElementById('breakBannerSubtitle');
const faviconLink     = document.getElementById('favicon');

// ── Module instances ─────────────────────────────────────────────────────────
const favicon  = new FaviconUpdater(faviconLink);
const sounds   = new SoundPlayer();

// The active character controller — either DragonController or BookController.
// Whichever script fires its ready event first (only one will fire, based on setting).
let character = null;

window.addEventListener('dragonReady', (e) => {
  character = e.detail.controller;
  if (currentState) character.setState(statusToCharacterState(currentState));
});

window.addEventListener('bookReady', (e) => {
  character = e.detail.controller;
  if (currentState) character.setState(statusToCharacterState(currentState));
});

// ── State ─────────────────────────────────────────────────────────────────────
let currentState      = null;
let tickInterval      = null;
let soundsUnlocked    = false;
let ambientIsPlaying  = false;

// ── Nag mode ──────────────────────────────────────────────────────────────────
let nagInterval  = null;
let myTabId      = null;
let myWindowId   = null;

// ── Arc setup ─────────────────────────────────────────────────────────────────
progressArc.style.strokeDasharray  = ARC_CIRCUMFERENCE;
progressArc.style.strokeDashoffset = ARC_CIRCUMFERENCE; // starts empty

// ── Listen for state pushes from service worker ───────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.STATE_UPDATE && msg.state) {
    applyState(msg.state);
    return;
  }
  if (msg.type === MSG.PLAY_CHIME) {
    if (soundsUnlocked) sounds.playChime(msg.variant ?? 'warning');
  }
});

// ── Request current state on load (with retry if SW not ready) ────────────────
// The service worker and the timer tab both restart on extension reload.
// GET_STATE is retried several times in case the SW is still waking up.
// background.js also pushes state proactively via chrome.tabs.onUpdated,
// so whichever arrives first wins — both call applyState(), which is idempotent.
async function loadInitialState() {
  let retries = 6;
  while (retries-- > 0) {
    try {
      const state = await chrome.runtime.sendMessage({ type: MSG.GET_STATE });
      if (state) { applyState(state); return; }
    } catch (_e) {
      // SW may still be waking up — keep trying
    }
    await new Promise(r => setTimeout(r, 400));
  }
  // Fallback: show idle — background.js push (via handleTabUpdated) may still
  // arrive and correct this within the next second.
  applyState({ status: STATUS.IDLE, sessionNumber: 1, snoozeUsed: false });
}

loadInitialState();

// ── Resolve tab identity for nag mode ────────────────────────────────────────
chrome.tabs.getCurrent().then(tab => {
  if (tab) { myTabId = tab.id; myWindowId = tab.windowId; }
}).catch(() => {});

// ── Hide inactive character container ────────────────────────────────────────
// Both dragon.js and book.js are always loaded (as modules), but only one
// instantiates based on the timerCharacter setting. Hide the other container
// so it doesn't occupy space or cause layout issues.
chrome.storage.sync.get('timerCharacter').then(r => {
  const active = r.timerCharacter ?? 'dragon';
  const dragonEl = document.getElementById('dragonContainer');
  const bookEl   = document.getElementById('bookContainer');
  if (dragonEl) dragonEl.hidden = (active !== 'dragon');
  if (bookEl)   bookEl.hidden   = (active !== 'book');
}).catch(() => {
  // Fallback: show dragon (the default)
  const bookEl = document.getElementById('bookContainer');
  if (bookEl) bookEl.hidden = true;
});

// ── Core render ───────────────────────────────────────────────────────────────
function applyState(state) {
  currentState = state;

  // ── Body theme class ───────────────────────────────────────────────────────
  bodyEl.dataset.status = state.status;
  bodyEl.dataset.paused = state.isPaused ? 'true' : 'false';

  // ── Character (dragon or book) ─────────────────────────────────────────────
  if (character) character.setState(statusToCharacterState(state));

  // ── Session dots ───────────────────────────────────────────────────────────
  renderSessionDots(state);

  // ── Controls ───────────────────────────────────────────────────────────────
  renderControls(state);

  // ── Status label ───────────────────────────────────────────────────────────
  statusLabel.textContent = getStatusLabel(state);

  // ── Break banner ───────────────────────────────────────────────────────────
  renderBreakBanner(state);

  // ── Tick interval ──────────────────────────────────────────────────────────
  clearInterval(tickInterval);
  if (isActivePhase(state)) {
    tick(state);
    tickInterval = setInterval(() => tick(currentState), 1000);
  } else {
    // Show the phase's full duration as the default display
    const defaultMs = state.phaseDuration ?? getDefaultDisplayMs(state.status);
    timeDisplay.textContent = formatTime(defaultMs);
    progressArc.style.strokeDashoffset = ARC_CIRCUMFERENCE;
  }

  favicon.update(state);

  // ── Ambient sounds ─────────────────────────────────────────────────────────
  const isBreakPhase = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;
  if (isBreakPhase && soundsUnlocked && !ambientIsPlaying) {
    sounds.startAmbient();
    ambientIsPlaying = true;
  } else if (!isBreakPhase && ambientIsPlaying) {
    sounds.stopAmbient();
    ambientIsPlaying = false;
  }

  // ── Nag mode ────────────────────────────────────────────────────────────────
  // During break phases, optionally re-grab focus every 20 seconds.
  // Uses setInterval in the timer tab (chrome.alarms minimum is 1 min).
  if (isBreakPhase) {
    chrome.storage.sync.get('nagDuringBreak').then(r => {
      r.nagDuringBreak ? startNag() : stopNag();
    }).catch(() => stopNag());
  } else {
    stopNag();
  }
}

// ── Tick (called every second) ────────────────────────────────────────────────
function tick(state) {
  if (!state || !state.startTime || !state.phaseDuration) return;

  const elapsed   = Date.now() - state.startTime;
  const remaining = Math.max(0, state.phaseDuration - elapsed);

  timeDisplay.textContent = formatTime(remaining);
  updateArc(elapsed, state.phaseDuration, state.status);
  favicon.update(state);

  // Progressive sleepiness in the final seconds of focus-warning.
  // The SW state stays FOCUS_WARNING — this is purely a visual character transition.
  if (state.status === STATUS.FOCUS_WARNING && character) {
    const target = remaining <= 10_000 ? 'focus-sleeping' : 'focus-tired';
    if (character.currentState !== target) character.setState(target);
  }

  // Drive book progress (bookmark position + page-edge width).
  // The dragon controller ignores setProgress (it doesn't have the method).
  if (character && typeof character.setProgress === 'function') {
    character.setProgress(Math.min(1, elapsed / state.phaseDuration), state);
  }
}

// ── Arc update ────────────────────────────────────────────────────────────────
function updateArc(elapsed, total, status) {
  const isBreak = status === STATUS.BREAK || status === STATUS.LONG_BREAK;

  // Focus: arc drains (shows time remaining, draining toward empty)
  // Break:  arc fills (shows recharge progress, filling toward full)
  let progress;
  if (isBreak) {
    progress = Math.min(1, elapsed / total);      // 0 → 1 (fills)
  } else {
    progress = Math.max(0, 1 - elapsed / total);  // 1 → 0 (drains)
  }

  progressArc.style.strokeDashoffset = ARC_CIRCUMFERENCE * (1 - progress);
}

// ── Session dots ──────────────────────────────────────────────────────────────
async function renderSessionDots(state) {
  // Get sessionsBeforeLongBreak from storage (don't block UI on this)
  let total = 3;
  try {
    const result = await chrome.storage.sync.get('sessionsBeforeLongBreak');
    total = result.sessionsBeforeLongBreak ?? 3;
  } catch (_e) {}

  sessionDots.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const dot = document.createElement('span');
    dot.className = 'session-dot';
    dot.setAttribute('aria-label', `Session ${i}`);

    if (i < state.sessionNumber) {
      dot.classList.add('done');
    } else if (i === state.sessionNumber) {
      dot.classList.add('current');
    }
    sessionDots.appendChild(dot);
  }

  const isBreak = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;
  if (isBreak) {
    sessionLabelEl.textContent = state.status === STATUS.LONG_BREAK
      ? 'Long break' : 'Break time';
  } else {
    sessionLabelEl.textContent = state.sessionNumber === 1
      ? 'Session 1'
      : `Session ${state.sessionNumber}`;
  }
}

// ── Controls ─────────────────────────────────────────────────────────────────
// The timer tab is a pure display. Start / Stop live in the popup.
// Only the snooze button lives here — it's time-critical and appears right
// when the focus-warning fires and this tab is already in the foreground.
function renderControls(state) {
  const { status, snoozeUsed } = state;
  btnSnooze.hidden = !(status === STATUS.FOCUS_WARNING && !snoozeUsed);
}

// ── Break banner ──────────────────────────────────────────────────────────────
function renderBreakBanner(state) {
  const isBreak = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;

  if (isBreak) {
    breakBanner.hidden = false;
    if (state.status === STATUS.LONG_BREAK) {
      breakBannerTitle.textContent = 'Long break time! 🐉✨';
      breakBannerSubtitle.textContent = 'You finished a full cycle — Ember is so proud!';
    } else {
      breakBannerTitle.textContent = 'Break time! 🐉';
      breakBannerSubtitle.textContent = 'Ember is celebrating — you\'ve earned this rest.';
    }
  } else {
    breakBanner.hidden = true;
  }
}

// ── Sound unlock ──────────────────────────────────────────────────────────────
// Web Audio requires a user gesture before AudioContext can resume.
// Unlock on any click in this tab — catches Snooze clicks plus general
// tab interaction (clicking links in games, etc.)
document.addEventListener('click', async () => {
  if (!soundsUnlocked) {
    await sounds.unlock();
    soundsUnlocked = true;
  }
}, { passive: true });

// ── Button wiring ─────────────────────────────────────────────────────────────

// Snooze — 5 extra minutes, once per session, during focus-warning only
btnSnooze.addEventListener('click', async () => {
  const newState = await sendMsg(MSG.SNOOZE);
  if (newState) applyState(newState);
});

// ── Message helper ────────────────────────────────────────────────────────────
async function sendMsg(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (e) {
    console.error('[PomoFomo Timer] sendMsg failed:', e);
    return null;
  }
}

// ── Character state mapping ───────────────────────────────────────────────────
// Used for both DragonController and BookController — both use the same vocabulary.
function statusToCharacterState(state) {
  if (state.isPaused) return 'idle';

  switch (state.status) {
    case STATUS.IDLE:          return 'idle';
    case STATUS.FOCUS:         return 'focus';
    case STATUS.FOCUS_WARNING: return 'focus-tired';
    case STATUS.BREAK:         return 'break-start';   // auto-transitions to break-active
    case STATUS.LONG_BREAK:    return 'break-start';
    default:                   return 'idle';
  }
}

// ── Nag mode helpers ──────────────────────────────────────────────────────────

function startNag() {
  if (nagInterval) return; // already running
  nagInterval = setInterval(() => {
    if (!myTabId) return;
    chrome.tabs.update(myTabId, { active: true }).catch(() => {});
    if (myWindowId) {
      chrome.windows.update(myWindowId, { focused: true }).catch(() => {});
    }
  }, 20_000);
}

function stopNag() {
  if (nagInterval) {
    clearInterval(nagInterval);
    nagInterval = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isActivePhase(state) {
  return (
    state.startTime != null &&
    state.phaseDuration != null &&
    !state.isPaused &&
    state.status !== STATUS.IDLE
  );
}

function getDefaultDisplayMs(status) {
  // Shown when idle — read from storage if possible, otherwise use defaults
  chrome.storage.sync.get('focusMinutes').then(r => {
    if (status === STATUS.IDLE) {
      timeDisplay.textContent = formatTime((r.focusMinutes ?? 20) * 60 * 1000);
    }
  }).catch(() => {});
  return 20 * 60 * 1000; // synchronous fallback
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getStatusLabel(state) {
  if (state.isPaused)                           return 'Paused';
  if (state.status === STATUS.IDLE)             return state.sessionNumber > 1 ? 'Ready for the next one?' : 'Ready to focus?';
  if (state.status === STATUS.FOCUS)            return 'Focus time';
  if (state.status === STATUS.FOCUS_WARNING)    return 'Almost there…';
  if (state.status === STATUS.BREAK)            return 'Break time!';
  if (state.status === STATUS.LONG_BREAK)       return 'Long break — great work!';
  return '';
}

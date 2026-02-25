/**
 * PomoFomo — Popup (popup.js)
 *
 * The popup is destroyed when the user clicks away and recreated on each open.
 * Never store state in variables — always read from service worker / storage.
 */

import { MSG, STATUS, DEFAULT_SETTINGS } from '../shared/constants.js';

// ── Element refs ─────────────────────────────────────────────────────────────
const bodyEl         = document.body;
const btnGear        = document.getElementById('btnGear');
const miniBadge      = document.getElementById('miniBadge');
const statusPhase    = document.getElementById('statusPhase');
const statusTime     = document.getElementById('statusTime');
const statusIcon     = document.getElementById('statusIcon');
const popupDots      = document.getElementById('popupDots');
const btnGoToTimer   = document.getElementById('btnGoToTimer');
const btnQuickStart  = document.getElementById('btnQuickStart');
const btnStop        = document.getElementById('btnStop');
const settingsForm   = document.getElementById('settingsForm');

// Settings inputs
const sFocusMin    = document.getElementById('sFocusMin');
const sShortMin    = document.getElementById('sShortMin');
const sLongMin     = document.getElementById('sLongMin');
const sSessions    = document.getElementById('sSessions');
const sSound       = document.getElementById('sSound');
const sPersist     = document.getElementById('sPersist');
const sNag         = document.getElementById('sNag');
const sCharDragon  = document.getElementById('sCharDragon');
const sCharBook    = document.getElementById('sCharBook');
const sFocusVal    = document.getElementById('sFocusVal');
const sShortVal    = document.getElementById('sShortVal');
const sLongVal     = document.getElementById('sLongVal');
const sSessionsVal = document.getElementById('sSessionsVal');

// ── State ─────────────────────────────────────────────────────────────────────
let currentState = null;
let tickInterval  = null;
let sessionsTotal = DEFAULT_SETTINGS.sessionsBeforeLongBreak;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Load state and settings in parallel
  const [state, settings] = await Promise.all([
    sendMsg(MSG.GET_STATE),
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)).then(r => ({
      ...DEFAULT_SETTINGS, ...r,
    })),
  ]);

  sessionsTotal = settings.sessionsBeforeLongBreak;

  if (state) {
    currentState = state;
    renderStatus(state);
    if (isActivePhase(state)) {
      tickInterval = setInterval(() => renderTime(currentState), 1000);
    }
  }

  populateSettings(settings);
}

// ── Status view ───────────────────────────────────────────────────────────────
function renderStatus(state) {
  statusPhase.textContent = getPhaseLabel(state);
  statusIcon.textContent  = getPhaseIcon(state);
  renderTime(state);
  renderDots(state);

  // Popup is the control panel:
  //   Idle   → show "Start Focus"; hide "Stop timer"
  //   Active → show "Stop timer";  hide "Start Focus"
  const isIdle = state.status === STATUS.IDLE;
  btnQuickStart.hidden = !isIdle;
  btnStop.hidden       = isIdle;
}

function renderTime(state) {
  if (!state) return;

  let remaining;
  if (state.isPaused && state.pausedRemaining != null) {
    remaining = state.pausedRemaining;
  } else if (state.startTime && state.phaseDuration) {
    remaining = Math.max(0, state.phaseDuration - (Date.now() - state.startTime));
  } else {
    remaining = null;
  }

  if (remaining != null) {
    statusTime.textContent = formatTime(remaining);
  } else {
    // Idle — show default focus duration
    chrome.storage.sync.get('focusMinutes').then(r => {
      statusTime.textContent = formatTime((r.focusMinutes ?? 20) * 60 * 1000);
    }).catch(() => {
      statusTime.textContent = '20:00';
    });
  }

  // Update mini badge (shown in settings view)
  if (remaining != null && state.status !== STATUS.IDLE) {
    miniBadge.textContent = `${formatTime(remaining)} · ${getPhaseLabel(state)}`;
  } else {
    miniBadge.textContent = '';
  }
}

function renderDots(state) {
  popupDots.innerHTML = '';
  for (let i = 1; i <= sessionsTotal; i++) {
    const dot = document.createElement('span');
    dot.className = 'session-dot-mini';
    if (i < state.sessionNumber) dot.classList.add('done');
    else if (i === state.sessionNumber) dot.classList.add('current');
    popupDots.appendChild(dot);
  }
}

// ── Settings view ─────────────────────────────────────────────────────────────
function populateSettings(settings) {
  sFocusMin.value  = settings.focusMinutes;
  sShortMin.value  = settings.shortBreakMinutes;
  sLongMin.value   = settings.longBreakMinutes;
  sSessions.value  = settings.sessionsBeforeLongBreak;
  sSound.checked   = settings.soundEnabled;
  sPersist.checked = settings.persistOnRelaunch;
  sNag.checked     = settings.nagDuringBreak ?? false;

  const char = settings.timerCharacter ?? 'dragon';
  sCharDragon.checked = (char === 'dragon');
  sCharBook.checked   = (char === 'book');

  updateSliderLabels();
}

function updateSliderLabels() {
  sFocusVal.textContent    = `${sFocusMin.value} min`;
  sShortVal.textContent    = `${sShortMin.value} min`;
  sLongVal.textContent     = `${sLongMin.value} min`;
  sSessionsVal.textContent = sSessions.value;
}

// Live save on any settings input
settingsForm.addEventListener('input', async () => {
  updateSliderLabels();

  const settings = collectSettings();
  try {
    await chrome.storage.sync.set(settings);
    await sendMsg(MSG.SETTINGS_CHANGED, { settings });
  } catch (e) {
    console.error('[PomoFomo Popup] Settings save failed:', e);
  }
});

function collectSettings() {
  return {
    focusMinutes:            Number(sFocusMin.value),
    shortBreakMinutes:       Number(sShortMin.value),
    longBreakMinutes:        Number(sLongMin.value),
    sessionsBeforeLongBreak: Number(sSessions.value),
    soundEnabled:            sSound.checked,
    persistOnRelaunch:       sPersist.checked,
    nagDuringBreak:          sNag.checked,
    timerCharacter:          sCharBook.checked ? 'book' : 'dragon',
  };
}

// ── View toggle (gear icon) ───────────────────────────────────────────────────
btnGear.addEventListener('click', () => {
  const isSettings = bodyEl.dataset.view === 'settings';
  bodyEl.dataset.view = isSettings ? 'status' : 'settings';
  // CSS handles show/hide via translateX — no hidden attribute needed
});

// ── Go to timer tab ───────────────────────────────────────────────────────────
btnGoToTimer.addEventListener('click', async () => {
  const state = await sendMsg(MSG.GET_STATE);
  if (state?.timerTabId) {
    try {
      await chrome.tabs.update(state.timerTabId, { active: true });
      if (state.timerWindowId) {
        await chrome.windows.update(state.timerWindowId, { focused: true });
      }
    } catch (_e) {
      // Tab may have been closed — service worker will recreate it
    }
  }
  window.close();
});

// ── Quick start ───────────────────────────────────────────────────────────────
btnQuickStart.addEventListener('click', async () => {
  await sendMsg(MSG.START);
  // Open timer tab so the child can see the dragon
  const state = await sendMsg(MSG.GET_STATE);
  if (state?.timerTabId) {
    try {
      await chrome.tabs.update(state.timerTabId, { active: true });
    } catch (_e) {}
  }
  window.close();
});

// ── Stop ─────────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', async () => {
  await sendMsg(MSG.STOP);
  window.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPhaseLabel(state) {
  if (state.isPaused)                        return 'Paused';
  if (state.status === STATUS.IDLE)          return 'Ready';
  if (state.status === STATUS.FOCUS)         return 'Focus';
  if (state.status === STATUS.FOCUS_WARNING) return 'Almost done!';
  if (state.status === STATUS.BREAK)         return 'Break';
  if (state.status === STATUS.LONG_BREAK)    return 'Long break';
  return 'Ready';
}

function getPhaseIcon(state) {
  if (state.status === STATUS.IDLE)                                         return '🐉';
  if (state.status === STATUS.FOCUS || state.status === STATUS.FOCUS_WARNING) return '📖';
  if (state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK)  return '🌿';
  return '🐉';
}

function isActivePhase(state) {
  return (
    state.startTime != null &&
    state.phaseDuration != null &&
    !state.isPaused &&
    state.status !== STATUS.IDLE
  );
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function sendMsg(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (e) {
    console.error('[PomoFomo Popup] sendMsg failed:', type, e);
    return null;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
init();

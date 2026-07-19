/**
 * PomoFomo — Popup (popup.js)
 *
 * The popup is destroyed on close and recreated on open, so it reads
 * everything from storage on load — and stays live while open by
 * subscribing to chrome.storage.onChanged (state can change under it:
 * alarms fire, the timer tab's buttons are clicked, etc).
 */

import { MSG, STATUS, BREAK_STATUSES, ACTIVE_STATUSES, DEFAULT_SETTINGS } from '../shared/constants.js';
import { getState, getSettings, saveSettings } from '../shared/storage.js';

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
const parentControls = document.getElementById('parentControls');
const btnPauseResume = document.getElementById('btnPauseResume');
const btnSkip        = document.getElementById('btnSkip');
const btnStop        = document.getElementById('btnStop');
const settingsForm   = document.getElementById('settingsForm');

const inputs = {
  focus:    document.getElementById('sFocusMin'),
  short:    document.getElementById('sShortMin'),
  long:     document.getElementById('sLongMin'),
  sessions: document.getElementById('sSessions'),
  sound:    document.getElementById('sSound'),
  persist:  document.getElementById('sPersist'),
  nag:      document.getElementById('sNag'),
  dragon:   document.getElementById('sCharDragon'),
  book:     document.getElementById('sCharBook'),
};

const sliderLabels = {
  focus:    document.getElementById('sFocusVal'),
  short:    document.getElementById('sShortVal'),
  long:     document.getElementById('sLongVal'),
  sessions: document.getElementById('sSessionsVal'),
};

// ── State ────────────────────────────────────────────────────────────────────
let currentState = null;
let settings = { ...DEFAULT_SETTINGS };
let tickInterval = null;

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const [state, loadedSettings] = await Promise.all([getState(), getSettings()]);
  settings = loadedSettings;
  populateSettings();
  render(state);
}

init();

// Stay live while open
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === 'local') {
    render(await getState());
  } else if (area === 'sync') {
    settings = await getSettings();
    // Don't repopulate the form — the user is probably the one dragging it
    if (currentState) render(currentState);
  }
});

// ── Render ───────────────────────────────────────────────────────────────────
function render(state) {
  currentState = state;

  statusPhase.textContent = phaseLabel(state);
  statusIcon.textContent = phaseIcon(state);
  renderTime(state);
  renderDots(state);

  const isIdle = state.status === STATUS.IDLE;
  btnQuickStart.hidden = !isIdle;
  parentControls.hidden = isIdle;
  btnPauseResume.textContent = state.isPaused ? 'Resume' : 'Pause';

  clearInterval(tickInterval);
  if (isRunning(state)) {
    tickInterval = setInterval(() => renderTime(currentState), 1000);
  }
}

function renderTime(state) {
  let remaining = null;
  if (state.isPaused && state.pausedRemaining != null) {
    remaining = state.pausedRemaining;
  } else if (state.startTime && state.phaseDuration) {
    remaining = Math.max(0, state.phaseDuration - (Date.now() - state.startTime));
  }

  statusTime.textContent = formatTime(remaining ?? settings.focusMinutes * 60 * 1000);

  miniBadge.textContent = remaining != null && state.status !== STATUS.IDLE
    ? `${formatTime(remaining)} · ${phaseLabel(state)}`
    : '';
}

function renderDots(state) {
  const onBreak = BREAK_STATUSES.includes(state.status);
  popupDots.replaceChildren(
    ...Array.from({ length: settings.sessionsBeforeLongBreak }, (_, i) => {
      const n = i + 1;
      const dot = document.createElement('span');
      dot.className = 'session-dot-mini';
      if (n < state.sessionNumber || (onBreak && n === state.sessionNumber)) {
        dot.classList.add('done');
      } else if (n === state.sessionNumber) {
        dot.classList.add('current');
      }
      return dot;
    }),
  );
}

// ── Settings form ────────────────────────────────────────────────────────────
function populateSettings() {
  inputs.focus.value    = settings.focusMinutes;
  inputs.short.value    = settings.shortBreakMinutes;
  inputs.long.value     = settings.longBreakMinutes;
  inputs.sessions.value = settings.sessionsBeforeLongBreak;
  inputs.sound.checked  = settings.soundEnabled;
  inputs.persist.checked = settings.persistOnRelaunch;
  inputs.nag.checked    = settings.nagDuringBreak;
  inputs.dragon.checked = settings.timerCharacter !== 'book';
  inputs.book.checked   = settings.timerCharacter === 'book';
  updateSliderLabels();
}

function updateSliderLabels() {
  sliderLabels.focus.textContent    = `${inputs.focus.value} min`;
  sliderLabels.short.textContent    = `${inputs.short.value} min`;
  sliderLabels.long.textContent     = `${inputs.long.value} min`;
  sliderLabels.sessions.textContent = inputs.sessions.value;
}

// Live-save on any input. The SW reads settings fresh at each transition,
// and the timer tab reacts to the sync-area change — no message needed.
settingsForm.addEventListener('input', async () => {
  updateSliderLabels();
  try {
    await saveSettings({
      focusMinutes:            Number(inputs.focus.value),
      shortBreakMinutes:       Number(inputs.short.value),
      longBreakMinutes:        Number(inputs.long.value),
      sessionsBeforeLongBreak: Number(inputs.sessions.value),
      soundEnabled:            inputs.sound.checked,
      persistOnRelaunch:       inputs.persist.checked,
      nagDuringBreak:          inputs.nag.checked,
      timerCharacter:          inputs.book.checked ? 'book' : 'dragon',
    });
  } catch (e) {
    console.error('[PomoFomo Popup] Settings save failed:', e);
  }
});

// ── View toggle ──────────────────────────────────────────────────────────────
btnGear.addEventListener('click', () => {
  bodyEl.dataset.view = bodyEl.dataset.view === 'settings' ? 'status' : 'settings';
});

// ── Actions ──────────────────────────────────────────────────────────────────
btnGoToTimer.addEventListener('click', async () => {
  await focusTimerTab();
  window.close();
});

btnQuickStart.addEventListener('click', async () => {
  await sendMsg(MSG.START);
  await focusTimerTab();
  window.close();
});

btnPauseResume.addEventListener('click', () =>
  sendMsg(currentState?.isPaused ? MSG.RESUME : MSG.PAUSE));

btnSkip.addEventListener('click', () => sendMsg(MSG.SKIP));

btnStop.addEventListener('click', async () => {
  await sendMsg(MSG.STOP);
  window.close();
});

async function focusTimerTab() {
  const timerUrl = chrome.runtime.getURL('timer/timer.html');
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url && t.url.startsWith(timerUrl));
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    // No tab? The SW recreates it shortly; nothing to do here.
  } catch (e) {
    console.warn('[PomoFomo Popup] Could not focus timer tab:', e);
  }
}

async function sendMsg(type) {
  try {
    return await chrome.runtime.sendMessage({ type });
  } catch (e) {
    console.error('[PomoFomo Popup] sendMsg failed:', type, e);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function phaseLabel(state) {
  if (state.isPaused) return 'Paused';
  switch (state.status) {
    case STATUS.FOCUS:         return 'Focus';
    case STATUS.FOCUS_WARNING: return 'Almost done!';
    case STATUS.BREAK:         return 'Break';
    case STATUS.LONG_BREAK:    return 'Long break';
    default:                   return 'Ready';
  }
}

function phaseIcon(state) {
  if (BREAK_STATUSES.includes(state.status)) return '🌿';
  if (ACTIVE_STATUSES.includes(state.status)) {
    return settings.timerCharacter === 'book' ? '📖' : '🐉';
  }
  return settings.timerCharacter === 'book' ? '📚' : '🐉';
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

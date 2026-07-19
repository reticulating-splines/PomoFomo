/**
 * PomoFomo — Service Worker (background.js)
 *
 * Single source of timer authority. All timing decisions happen here via
 * chrome.alarms; every phase transition is written to chrome.storage.local
 * in ONE atomic set() call. UI pages (timer tab, popup) render from storage
 * and subscribe to chrome.storage.onChanged — the service worker never
 * pushes state messages to them.
 *
 * Messages (UI → SW) exist only for user actions: START, PAUSE, RESUME,
 * STOP, SKIP, SNOOZE.
 *
 * CRITICAL: all chrome.* event listeners are registered synchronously at
 * module top level so they survive service worker sleep/wake cycles.
 */

import {
  ALARM, STATUS, MSG, BREAK_STATUSES, FOCUS_STATUSES, ACTIVE_STATUSES,
  DEFAULT_STATE, DEFAULT_SETTINGS,
  WARNING_MINUTES, SNOOZE_MINUTES, NAG_PERIOD_MINUTES, MAX_LOG_ENTRIES,
} from './shared/constants.js';
import { getState, setState, getSettings } from './shared/storage.js';

const TIMER_URL = chrome.runtime.getURL('timer/timer.html');
const NOTIFICATION_ID = 'pomofomo-break';
const MINUTE = 60 * 1000;

// ── Top-level event listener registration ────────────────────────────────────

chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.notifications.onClicked.addListener(handleNotificationClicked);
chrome.storage.onChanged.addListener(handleStorageChanged);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => {
      console.error('[PomoFomo BG] Message error:', err);
      sendResponse(null);
    });
  return true; // keep channel open for async sendResponse
});

// ── Install / update / browser startup ───────────────────────────────────────

async function handleInstalled(details) {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ ...DEFAULT_STATE });
    await chrome.storage.sync.set({ ...DEFAULT_SETTINGS });
  } else if (details.reason === 'update') {
    // Add any new settings keys without overwriting user preferences
    const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...existing });
  }
  await refreshActionUi();
  await ensureTimerTab();
}

async function handleStartup() {
  const settings = await getSettings();

  if (settings.persistOnRelaunch) {
    await reconcileAlarms();
  } else {
    await chrome.alarms.clearAll();
    await setState(phaseSnapshot({ status: STATUS.IDLE, sessionNumber: 1 }));
    await refreshActionUi();
  }

  await ensureTimerTab();
}

// ── Reconcile alarms after browser restart (persist mode) ────────────────────
// chrome.alarms don't survive a full browser restart; recompute them from the
// saved startTime + phaseDuration. If a phase ended while the browser was
// closed, transition immediately.

async function reconcileAlarms() {
  const state = await getState();
  if (!ACTIVE_STATUSES.includes(state.status)) return;
  if (state.isPaused) return; // paused state persists; alarms recreate on resume

  const now = Date.now();
  const phaseEnd = state.startTime + state.phaseDuration;

  if (FOCUS_STATUSES.includes(state.status)) {
    if (now >= phaseEnd) {
      await startBreak({ natural: true });
      return;
    }
    await chrome.alarms.create(ALARM.FOCUS_END, { when: phaseEnd });
    const warningAt = phaseEnd - WARNING_MINUTES * MINUTE;
    if (now < warningAt) {
      await chrome.alarms.create(ALARM.FOCUS_WARNING, { when: warningAt });
    } else if (state.status === STATUS.FOCUS) {
      await setState({ status: STATUS.FOCUS_WARNING });
    }
    await ensureBadgeTick();
    await refreshActionUi();
  } else {
    // break / longBreak
    if (now >= phaseEnd) {
      await finishBreak({ natural: true });
      return;
    }
    await chrome.alarms.create(ALARM.BREAK_END, { when: phaseEnd });
    await ensureNagAlarm();
    await ensureBadgeTick();
    await refreshActionUi();
  }
}

// ── Alarm handler ─────────────────────────────────────────────────────────────

async function handleAlarm(alarm) {
  const state = await getState();

  switch (alarm.name) {
    case ALARM.FOCUS_WARNING:
      if (state.status !== STATUS.FOCUS) return; // stale alarm guard
      await setState({ status: STATUS.FOCUS_WARNING });
      await refreshActionUi();
      break;

    case ALARM.FOCUS_END:
    case ALARM.SNOOZE_END:
      if (!FOCUS_STATUSES.includes(state.status)) return;
      await startBreak({ natural: true });
      break;

    case ALARM.BREAK_END:
      if (!BREAK_STATUSES.includes(state.status)) return;
      await finishBreak({ natural: true });
      break;

    case ALARM.NAG: {
      const settings = await getSettings();
      if (BREAK_STATUSES.includes(state.status) && !state.isPaused && settings.nagDuringBreak) {
        await activateTimerTab();
      }
      break;
    }

    case ALARM.BADGE_TICK:
      await updateBadge(state);
      break;
  }
}

// ── Phase transitions ─────────────────────────────────────────────────────────
// Each transition: clear alarms → write ONE atomic state snapshot → schedule
// new alarms → side effects (icon, tab focus, notification).

/** Full runtime snapshot for a phase change — everything but logs. */
function phaseSnapshot({ status, sessionNumber, startTime = null, phaseDuration = null }) {
  return {
    status,
    sessionNumber,
    startTime,
    phaseDuration,
    isPaused: false,
    pausedRemaining: null,
    snoozeUsed: false,
  };
}

async function startFocus(sessionNumber) {
  const settings = await getSettings();
  const duration = settings.focusMinutes * MINUTE;
  const now = Date.now();

  await chrome.alarms.clearAll();
  await setState(phaseSnapshot({
    status: STATUS.FOCUS,
    sessionNumber,
    startTime: now,
    phaseDuration: duration,
  }));

  await scheduleFocusAlarms(now + duration);
  await ensureBadgeTick();
  await refreshActionUi();
}

async function scheduleFocusAlarms(phaseEnd) {
  await chrome.alarms.create(ALARM.FOCUS_END, { when: phaseEnd });
  const warningAt = phaseEnd - WARNING_MINUTES * MINUTE;
  if (warningAt > Date.now()) {
    await chrome.alarms.create(ALARM.FOCUS_WARNING, { when: warningAt });
  }
}

async function startBreak({ natural }) {
  const state = await getState();
  const settings = await getSettings();

  await appendLog({
    type: 'focus',
    scheduledDuration: state.phaseDuration,
    startedAt: state.startTime,
    endedAt: Date.now(),
    completedNaturally: natural,
    snoozed: state.snoozeUsed,
  });

  const isLong = state.sessionNumber >= settings.sessionsBeforeLongBreak;
  const breakMinutes = isLong ? settings.longBreakMinutes : settings.shortBreakMinutes;
  const breakStatus = isLong ? STATUS.LONG_BREAK : STATUS.BREAK;
  const now = Date.now();

  await chrome.alarms.clearAll();
  await setState(phaseSnapshot({
    status: breakStatus,
    sessionNumber: state.sessionNumber,
    startTime: now,
    phaseDuration: breakMinutes * MINUTE,
  }));

  await chrome.alarms.create(ALARM.BREAK_END, { when: now + breakMinutes * MINUTE });
  await ensureNagAlarm();
  await ensureBadgeTick();
  await refreshActionUi();
  await activateTimerTab();
  await showBreakNotification(isLong, breakMinutes);
}

async function finishBreak({ natural }) {
  const state = await getState();

  await appendLog({
    type: state.status === STATUS.LONG_BREAK ? 'longBreak' : 'shortBreak',
    scheduledDuration: state.phaseDuration,
    startedAt: state.startTime,
    endedAt: Date.now(),
    completedNaturally: natural,
  });

  // After a long break the cycle restarts at session 1; otherwise advance.
  // The next focus session auto-starts — the child only ever clicks Start
  // once, at the very beginning.
  const next = state.status === STATUS.LONG_BREAK ? 1 : state.sessionNumber + 1;
  await startFocus(next);
}

async function stopTimer() {
  await chrome.alarms.clearAll();
  await setState(phaseSnapshot({ status: STATUS.IDLE, sessionNumber: 1 }));
  await refreshActionUi();
}

// ── Message handler (user actions from timer tab / popup) ────────────────────

async function handleMessage(msg) {
  const state = await getState();

  switch (msg?.type) {
    case MSG.START:
      if (state.status !== STATUS.IDLE) break;
      await startFocus(state.sessionNumber);
      break;

    case MSG.PAUSE: {
      if (!ACTIVE_STATUSES.includes(state.status) || state.isPaused) break;
      const remaining = Math.max(0, state.startTime + state.phaseDuration - Date.now());
      await chrome.alarms.clearAll();
      await setState({ isPaused: true, pausedRemaining: remaining });
      await refreshActionUi(); // badge freezes at the paused minutes
      break;
    }

    case MSG.RESUME: {
      if (!state.isPaused || state.pausedRemaining == null) break;
      const now = Date.now();
      const phaseEnd = now + state.pausedRemaining;
      await setState({
        isPaused: false,
        pausedRemaining: null,
        startTime: now,
        phaseDuration: state.pausedRemaining,
      });
      if (BREAK_STATUSES.includes(state.status)) {
        await chrome.alarms.create(ALARM.BREAK_END, { when: phaseEnd });
        await ensureNagAlarm();
      } else {
        await scheduleFocusAlarms(phaseEnd);
      }
      await ensureBadgeTick();
      await refreshActionUi();
      break;
    }

    case MSG.STOP:
      await stopTimer();
      break;

    case MSG.SKIP:
      if (FOCUS_STATUSES.includes(state.status)) {
        await startBreak({ natural: false });
      } else if (BREAK_STATUSES.includes(state.status)) {
        await finishBreak({ natural: false });
      }
      break;

    case MSG.SNOOZE: {
      // One snooze per session, only while the warning is showing
      if (state.status !== STATUS.FOCUS_WARNING || state.snoozeUsed) break;
      const newDuration = state.phaseDuration + SNOOZE_MINUTES * MINUTE;
      const newEnd = state.startTime + newDuration;
      await chrome.alarms.clear(ALARM.FOCUS_END);
      await chrome.alarms.clear(ALARM.FOCUS_WARNING);
      await setState({
        status: STATUS.FOCUS,
        phaseDuration: newDuration,
        snoozeUsed: true,
      });
      await chrome.alarms.create(ALARM.SNOOZE_END, { when: newEnd });
      // Warn again before the extended end (snooze > warning window, so future)
      await chrome.alarms.create(ALARM.FOCUS_WARNING, {
        when: newEnd - WARNING_MINUTES * MINUTE,
      });
      await refreshActionUi();
      break;
    }

    default:
      console.warn('[PomoFomo BG] Unknown message:', msg?.type);
  }

  return getState();
}

// ── Timer tab lifecycle ───────────────────────────────────────────────────────
// No tab id is stored: the timer tab is found by URL each time, which stays
// correct across service worker restarts and user-opened duplicates.

let creatingTimerTab = null; // dedupe concurrent ensureTimerTab() calls

async function findTimerTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(t => t.url && t.url.startsWith(TIMER_URL));
}

async function ensureTimerTab() {
  const existing = await findTimerTabs();

  if (existing.length > 0) {
    const [keep, ...extras] = existing;
    for (const extra of extras) {
      try { await chrome.tabs.remove(extra.id); } catch { /* already gone */ }
    }
    if (!keep.pinned) {
      try { await chrome.tabs.update(keep.id, { pinned: true }); } catch { /* gone */ }
    }
    return keep;
  }

  if (!creatingTimerTab) {
    creatingTimerTab = chrome.tabs
      .create({ url: TIMER_URL, pinned: true, active: false })
      .finally(() => { creatingTimerTab = null; });
  }
  return creatingTimerTab;
}

async function activateTimerTab() {
  try {
    const tab = await ensureTimerTab();
    await chrome.tabs.update(tab.id, { active: true });
    // Bring the window forward too — best-effort, the OS may refuse
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch { /* best effort */ }
}

function handleTabRemoved(_tabId, removeInfo) {
  if (removeInfo.isWindowClosing) return; // don't fight a closing window
  // Recreate after a beat if the closed tab was ours (cheap query either way)
  setTimeout(async () => {
    try {
      if ((await findTimerTabs()).length === 0) await ensureTimerTab();
    } catch { /* browser may be shutting down */ }
  }, 500);
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function showBreakNotification(isLong, breakMinutes) {
  try {
    await chrome.notifications.clear(NOTIFICATION_ID);
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: isLong ? '🐉 Long break time!' : '🐉 Break time!',
      message: isLong
        ? `Amazing work! Time for a ${breakMinutes}-minute break. You earned it!`
        : `Great focus! Take a quick ${breakMinutes}-minute break.`,
      priority: 2,
    });
  } catch (e) {
    console.warn('[PomoFomo BG] Notification failed:', e);
  }
}

async function handleNotificationClicked(notificationId) {
  if (notificationId !== NOTIFICATION_ID) return;
  await chrome.notifications.clear(NOTIFICATION_ID);
  await activateTimerTab();
}

// ── Nag alarm (re-focus timer tab during breaks) ─────────────────────────────

async function ensureNagAlarm() {
  const settings = await getSettings();
  if (settings.nagDuringBreak) {
    await chrome.alarms.create(ALARM.NAG, {
      delayInMinutes: NAG_PERIOD_MINUTES,
      periodInMinutes: NAG_PERIOD_MINUTES,
    });
  } else {
    await chrome.alarms.clear(ALARM.NAG);
  }
}

// React to the nag setting being toggled mid-break
async function handleStorageChanged(changes, area) {
  if (area !== 'sync' || !('nagDuringBreak' in changes)) return;
  const state = await getState();
  if (BREAK_STATUSES.includes(state.status) && !state.isPaused) {
    await ensureNagAlarm();
  }
}

// ── Toolbar icon + badge ──────────────────────────────────────────────────────

const ICON_COLORS = {
  [STATUS.IDLE]:          '#9A8070',
  [STATUS.FOCUS]:         '#F5A623',
  [STATUS.FOCUS_WARNING]: '#E8842A',
  [STATUS.BREAK]:         '#2BBFA0',
  [STATUS.LONG_BREAK]:    '#2BBFA0',
};

/** Redraw both the icon and the minutes badge from current state. */
async function refreshActionUi() {
  const state = await getState();
  await updateActionIcon(state.status);
  await updateBadge(state);
}

/**
 * Toolbar badge: minutes remaining ("14m") while a phase runs, empty at idle.
 * A repeating 1-minute alarm (BADGE_TICK) keeps it fresh; while paused the
 * alarm is cleared and the badge freezes at the paused minutes.
 */
async function updateBadge(state) {
  let text = '';
  if (ACTIVE_STATUSES.includes(state.status)) {
    const remaining = state.isPaused
      ? state.pausedRemaining ?? 0
      : state.startTime + state.phaseDuration - Date.now();
    text = `${Math.max(1, Math.ceil(remaining / MINUTE))}m`;
  }

  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({
        color: ICON_COLORS[state.status] ?? ICON_COLORS[STATUS.IDLE],
      });
      await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    }
  } catch (e) {
    console.warn('[PomoFomo BG] Could not update badge:', e);
  }
}

async function ensureBadgeTick() {
  await chrome.alarms.create(ALARM.BADGE_TICK, { periodInMinutes: 1 });
}

async function updateActionIcon(status) {
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, 2 * Math.PI);
    ctx.fillStyle = ICON_COLORS[status] ?? ICON_COLORS[STATUS.IDLE];
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 16, 17);

    await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, 32, 32) });
  } catch (e) {
    console.warn('[PomoFomo BG] Could not update action icon:', e);
  }
}

// ── Session log ───────────────────────────────────────────────────────────────

async function appendLog(entry) {
  const { logs } = await getState();
  const trimmed = [...(Array.isArray(logs) ? logs : []), { id: crypto.randomUUID(), ...entry }]
    .slice(-MAX_LOG_ENTRIES);
  await setState({ logs: trimmed });
}

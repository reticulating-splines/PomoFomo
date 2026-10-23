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
  DEFAULT_STATE, DEFAULT_SETTINGS, characterInfo,
  WARNING_MINUTES, SNOOZE_MINUTES, NAG_PERIOD_MINUTES, MAX_LOG_ENTRIES, BREAK_GRACE_MS,
} from './shared/constants.js';
import { getState, setState, getSettings } from './shared/storage.js';

const TIMER_URL = chrome.runtime.getURL('timer/timer.html');
const NOTE = {
  BREAK:   'pomofomo-break',
  WARNING: 'pomofomo-warning',
  NUDGE:   'pomofomo-nudge',
};
const MINUTE = 60 * 1000;

// ── Top-level event listener registration ────────────────────────────────────

chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabs.onActivated.addListener(handleTabActivated);
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
  await ensureTimerTab({ activate: details.reason === 'install' });
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
  if (state.isPaused) { await refreshActionUi(); return; } // alarms recreate on resume

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
  } else {
    if (now >= phaseEnd) {
      await finishBreak({ natural: true });
      return;
    }
    await chrome.alarms.create(ALARM.BREAK_END, { when: phaseEnd });
    await ensureNagAlarm();
  }
  await ensureBadgeTick();
  await refreshActionUi();
}

// ── Alarm handler ─────────────────────────────────────────────────────────────

async function handleAlarm(alarm) {
  const state = await getState();

  switch (alarm.name) {
    case ALARM.FOCUS_WARNING:
      if (state.status !== STATUS.FOCUS) return; // stale alarm guard
      await setState({ status: STATUS.FOCUS_WARNING });
      await refreshActionUi();
      await showWarningNotification(state);
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
      await refreshActionUi(state);
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
    breakInterrupted: false,
  };
}

/** `extra` rides along in the same write (e.g. the finished break's log). */
async function startFocus(sessionNumber, extra = {}) {
  const settings = await getSettings();
  const duration = settings.focusMinutes * MINUTE;
  const now = Date.now();

  await chrome.alarms.clearAll();
  await setState({
    ...phaseSnapshot({
      status: STATUS.FOCUS,
      sessionNumber,
      startTime: now,
      phaseDuration: duration,
    }),
    ...extra,
  });

  await scheduleFocusAlarms(now + duration);
  await ensureBadgeTick();
  await refreshActionUi();
  await clearNotifications(NOTE.BREAK, NOTE.NUDGE);
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
  const now = Date.now();

  const isLong = state.sessionNumber >= settings.sessionsBeforeLongBreak;
  const breakMinutes = isLong ? settings.longBreakMinutes : settings.shortBreakMinutes;

  // Log entry + phase change land in ONE write so listeners never see a
  // half-finished transition.
  await chrome.alarms.clearAll();
  await setState({
    ...phaseSnapshot({
      status: isLong ? STATUS.LONG_BREAK : STATUS.BREAK,
      sessionNumber: state.sessionNumber,
      startTime: now,
      phaseDuration: breakMinutes * MINUTE,
    }),
    logs: withLogEntry(state.logs, {
      type: 'focus',
      scheduledDuration: state.phaseDuration,
      startedAt: state.startTime,
      endedAt: now,
      completedNaturally: natural,
      snoozed: state.snoozeUsed,
    }),
  });

  await chrome.alarms.create(ALARM.BREAK_END, { when: now + breakMinutes * MINUTE });
  await ensureNagAlarm();
  await ensureBadgeTick();
  await refreshActionUi();
  await activateTimerTab();
  await clearNotifications(NOTE.WARNING);
  await showBreakNotification(settings, isLong, breakMinutes);
}

async function finishBreak({ natural }) {
  const state = await getState();
  const logs = withLogEntry(state.logs, {
    type: state.status === STATUS.LONG_BREAK ? 'longBreak' : 'shortBreak',
    scheduledDuration: state.phaseDuration,
    startedAt: state.startTime,
    endedAt: Date.now(),
    completedNaturally: natural,
    interrupted: state.breakInterrupted,
  });

  // After a long break the cycle restarts at session 1; otherwise advance.
  // The next focus session auto-starts — the child only ever clicks Start
  // once, at the very beginning.
  const next = state.status === STATUS.LONG_BREAK ? 1 : state.sessionNumber + 1;
  await startFocus(next, { logs });
}

async function stopTimer() {
  await chrome.alarms.clearAll();
  await setState(phaseSnapshot({ status: STATUS.IDLE, sessionNumber: 1 }));
  await refreshActionUi();
  await clearNotifications(NOTE.BREAK, NOTE.WARNING, NOTE.NUDGE);
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
      if (state.status !== STATUS.FOCUS_WARNING || state.snoozeUsed || state.isPaused) break;
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
      await clearNotifications(NOTE.WARNING);
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

function isTimerUrl(url) {
  return Boolean(url) && url.startsWith(TIMER_URL);
}

async function findTimerTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(t => isTimerUrl(t.url));
}

async function ensureTimerTab({ activate = false } = {}) {
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
      .create({ url: TIMER_URL, pinned: true, active: activate })
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

// ── Break guard ──────────────────────────────────────────────────────────────
// Switching to another tab mid-break marks the break as interrupted (so it
// won't earn a reward) and sends ONE friendly nudge. No content scripts and
// no lockout — the kid stays in charge.

async function handleTabActivated({ tabId }) {
  const state = await getState();
  if (!BREAK_STATUSES.includes(state.status) || state.isPaused || state.breakInterrupted) return;

  const remaining = state.startTime + state.phaseDuration - Date.now();
  if (remaining <= BREAK_GRACE_MS) return;

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (isTimerUrl(tab.url) || isTimerUrl(tab.pendingUrl)) return;

  await setState({ breakInterrupted: true });
  const settings = await getSettings();
  await showNudgeNotification(settings, remaining);
}

// ── Notifications ─────────────────────────────────────────────────────────────

const ICON_URL = chrome.runtime.getURL('assets/icons/icon128.png');

async function notify(id, options) {
  try {
    await chrome.notifications.clear(id);
    await chrome.notifications.create(id, { type: 'basic', iconUrl: ICON_URL, ...options });
  } catch (e) {
    console.warn('[PomoFomo BG] Notification failed:', e);
  }
}

async function clearNotifications(...ids) {
  for (const id of ids) {
    try { await chrome.notifications.clear(id); } catch { /* fine */ }
  }
}

async function showWarningNotification(state) {
  const settings = await getSettings();
  const { name } = characterInfo(settings.timerCharacter);
  await notify(NOTE.WARNING, {
    title: `${WARNING_MINUTES} minutes until break`,
    message: state.snoozeUsed
      ? `Time to find a good place to stop. ${name} will call you soon.`
      : `Find a good place to stop — save your game, finish your sentence. ${name} will call you soon.`,
    priority: 0,
    silent: true, // the timer tab plays its own gentle chime
  });
}

async function showBreakNotification(settings, isLong, breakMinutes) {
  const { name } = characterInfo(settings.timerCharacter);
  await notify(NOTE.BREAK, {
    title: isLong ? 'Big break time!' : 'Break time!',
    message: isLong
      ? `You finished every round! Take ${breakMinutes} minutes away from the screen. ${name} will keep watch.`
      : `Great focus! Take ${breakMinutes} minutes to stretch, drink water and rest your eyes.`,
    priority: 2,
  });
}

async function showNudgeNotification(settings, remaining) {
  const info = characterInfo(settings.timerCharacter);
  const mins = Math.max(1, Math.ceil(remaining / MINUTE));
  await notify(NOTE.NUDGE, {
    title: 'Psst… it’s still break time',
    message: `${mins} more minute${mins === 1 ? '' : 's'} to rest. ${info.name} will call you when it’s time to go again.`,
    priority: 1,
  });
}

async function handleNotificationClicked(notificationId) {
  if (!Object.values(NOTE).includes(notificationId)) return;
  await chrome.notifications.clear(notificationId);
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
// Icon: the character tile with a phase-colored progress ring around it.
// Badge: minutes remaining ("14m"). A 1-minute alarm keeps both fresh; while
// paused the alarm is cleared and both freeze.

const PHASE_COLORS = {
  [STATUS.IDLE]:          '#8E86A6',
  [STATUS.FOCUS]:         '#6C6FF5',
  [STATUS.FOCUS_WARNING]: '#F29A1F',
  [STATUS.BREAK]:         '#1FAE79',
  [STATUS.LONG_BREAK]:    '#1FAE79',
};
const PAUSED_COLOR = '#8E86A6';

async function refreshActionUi(state) {
  state ??= await getState();
  await updateActionIcon(state);
  await updateBadge(state);
}

function phaseFraction(state) {
  if (!ACTIVE_STATUSES.includes(state.status) || !state.phaseDuration) return null;
  const remaining = state.isPaused
    ? state.pausedRemaining ?? 0
    : state.startTime + state.phaseDuration - Date.now();
  return Math.min(1, Math.max(0, remaining / state.phaseDuration));
}

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
        color: state.isPaused ? PAUSED_COLOR : PHASE_COLORS[state.status] ?? PHASE_COLORS[STATUS.IDLE],
      });
      await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    }
    await chrome.action.setTitle({ title: actionTitle(state) });
  } catch (e) {
    console.warn('[PomoFomo BG] Could not update badge:', e);
  }
}

function actionTitle(state) {
  if (state.isPaused) return 'PomoFomo — paused';
  switch (state.status) {
    case STATUS.FOCUS:
    case STATUS.FOCUS_WARNING: return 'PomoFomo — focusing';
    case STATUS.BREAK:         return 'PomoFomo — break time';
    case STATUS.LONG_BREAK:    return 'PomoFomo — big break';
    default:                   return 'PomoFomo';
  }
}

async function ensureBadgeTick() {
  await chrome.alarms.create(ALARM.BADGE_TICK, { periodInMinutes: 1 });
}

const iconBitmaps = {}; // size → ImageBitmap, cached for the SW's lifetime

async function iconBitmap(size) {
  if (!iconBitmaps[size]) {
    const res = await fetch(chrome.runtime.getURL(`assets/icons/icon${size}.png`));
    iconBitmaps[size] = await createImageBitmap(await res.blob());
  }
  return iconBitmaps[size];
}

async function drawIcon(size, state) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const fraction = phaseFraction(state);
  // Use the 32px art for both sizes: it holds up better when inset.
  const art = await iconBitmap(32);

  if (fraction == null) {
    ctx.drawImage(art, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  }

  const line = size * 0.125;
  const r = size / 2 - line / 2;
  const c = size / 2;
  const inset = line * 1.5;
  ctx.drawImage(art, inset, inset, size - inset * 2, size - inset * 2);

  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(142, 134, 166, 0.35)';
  ctx.stroke();

  // Focus drains toward empty; breaks fill back up (recharge)
  const shown = BREAK_STATUSES.includes(state.status) ? 1 - fraction : fraction;
  if (shown > 0.01) {
    ctx.beginPath();
    ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + shown * Math.PI * 2);
    ctx.strokeStyle = state.isPaused ? PAUSED_COLOR : PHASE_COLORS[state.status];
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

async function updateActionIcon(state) {
  try {
    await chrome.action.setIcon({
      imageData: { 16: await drawIcon(16, state), 32: await drawIcon(32, state) },
    });
  } catch (e) {
    console.warn('[PomoFomo BG] Could not update action icon:', e);
  }
}

// ── Session log ───────────────────────────────────────────────────────────────

function withLogEntry(logs, entry) {
  return [...(Array.isArray(logs) ? logs : []), { id: crypto.randomUUID(), ...entry }]
    .slice(-MAX_LOG_ENTRIES);
}

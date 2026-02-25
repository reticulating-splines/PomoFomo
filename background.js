/**
 * PomoFomo — Service Worker (background.js)
 *
 * This is the single source of timer authority. All timing decisions happen
 * here via chrome.alarms. The timer tab and popup are display-only — they
 * read state and send user actions up to this file.
 *
 * CRITICAL: All chrome.* event listeners must be registered synchronously
 * at module top level so they survive service worker sleep/wake cycles.
 */

import {
  ALARM, STATUS, MSG,
  DEFAULT_STATE, DEFAULT_SETTINGS, WARNING_MINUTES,
} from './shared/constants.js';
import { getState, setState, resetState, getSettings } from './shared/storage.js';

// ── Top-level event listener registration ────────────────────────────────────
// These MUST be at the top level, not inside async functions.

chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.tabs.onRemoved.addListener(handleTabRemoved);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(err => {
      console.error('[PomoFomo BG] Message error:', err);
      sendResponse(null);
    });
  return true; // keep channel open for async sendResponse
});

// ── Install / Update ──────────────────────────────────────────────────────────

async function handleInstalled(details) {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ ...DEFAULT_STATE });
    await chrome.storage.sync.set({ ...DEFAULT_SETTINGS });
    console.log('[PomoFomo] Extension installed, initializing.');
  }

  if (details.reason === 'update') {
    // Merge new settings keys without overwriting existing user preferences
    const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...existing });
  }

  await ensureTimerTab();
}

// ── Browser Startup ───────────────────────────────────────────────────────────

async function handleStartup() {
  const settings = await getSettings();

  if (!settings.persistOnRelaunch) {
    await chrome.alarms.clearAll();
    await resetState();
    console.log('[PomoFomo] Browser started, timer reset (persist disabled).');
  } else {
    console.log('[PomoFomo] Browser started, attempting to resume timer.');
    await reconcileAlarms();
  }

  await ensureTimerTab();
}

// ── Ensure timer tab exists and is pinned ─────────────────────────────────────

async function ensureTimerTab() {
  const state = await getState();
  const timerUrl = chrome.runtime.getURL('timer/timer.html');

  // Check if saved tab is still alive
  if (state.timerTabId) {
    try {
      const tab = await chrome.tabs.get(state.timerTabId);
      if (tab && tab.url && tab.url.startsWith(timerUrl.split('?')[0])) {
        // Tab exists — ensure it's pinned
        if (!tab.pinned) {
          await chrome.tabs.update(tab.id, { pinned: true });
        }
        await setState({ timerWindowId: tab.windowId });
        return; // Tab is healthy
      }
    } catch (_e) {
      // Tab no longer exists — fall through to create
    }
  }

  // Create a new pinned timer tab (not active so it doesn't steal focus on startup)
  const tab = await chrome.tabs.create({
    url: timerUrl,
    pinned: true,
    active: false,
  });

  await setState({ timerTabId: tab.id, timerWindowId: tab.windowId });
  console.log('[PomoFomo] Timer tab created:', tab.id);
}

// ── Reconcile alarms after browser restart (persist mode) ────────────────────
// Re-registers alarms based on saved startTime + phaseDuration.
// If a phase already ended while the browser was closed, fires immediately.

async function reconcileAlarms() {
  const state = await getState();
  if (state.status === STATUS.IDLE || state.isPaused) return;

  const now = Date.now();
  const phaseEnd = state.startTime + state.phaseDuration;
  const existingAlarms = await chrome.alarms.getAll();
  const alarmNames = new Set(existingAlarms.map(a => a.name));

  if (state.status === STATUS.FOCUS || state.status === STATUS.FOCUS_WARNING) {
    if (now >= phaseEnd) {
      // Focus ended while browser was closed — transition to break immediately
      await transitionToBreak();
      return;
    }

    // Re-register missing alarms
    const warningAt = phaseEnd - WARNING_MINUTES * 60 * 1000;
    if (!alarmNames.has(ALARM.FOCUS_END)) {
      await chrome.alarms.create(ALARM.FOCUS_END, { when: phaseEnd });
    }
    if (now < warningAt && !alarmNames.has(ALARM.FOCUS_WARNING)) {
      await chrome.alarms.create(ALARM.FOCUS_WARNING, { when: warningAt });
    } else if (now >= warningAt && state.status !== STATUS.FOCUS_WARNING) {
      await setState({ status: STATUS.FOCUS_WARNING });
    }
  }

  if (state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK) {
    if (now >= phaseEnd) {
      await endBreak();
      return;
    }
    if (!alarmNames.has(ALARM.BREAK_END)) {
      await chrome.alarms.create(ALARM.BREAK_END, { when: phaseEnd });
    }
  }

  // Push updated state to timer tab
  await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
}

// ── Alarm Handler ─────────────────────────────────────────────────────────────

async function handleAlarm(alarm) {
  console.log('[PomoFomo] Alarm fired:', alarm.name);

  switch (alarm.name) {
    case ALARM.FOCUS_WARNING:
      await handleFocusWarning();
      break;

    case ALARM.FOCUS_END:
    case ALARM.SNOOZE_END:
      await transitionToBreak();
      break;

    case ALARM.BREAK_END:
      await endBreak();
      break;

    default:
      console.warn('[PomoFomo] Unknown alarm:', alarm.name);
  }
}

async function handleFocusWarning() {
  const state = await getState();
  if (state.status !== STATUS.FOCUS) return; // stale alarm guard

  await setState({ status: STATUS.FOCUS_WARNING });
  await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });

  const settings = await getSettings();
  if (settings.soundEnabled) {
    await broadcastToTimerTab({ type: MSG.PLAY_CHIME, variant: 'warning' });
  }

  await updateActionIcon(STATUS.FOCUS_WARNING);
  console.log('[PomoFomo] Focus warning triggered.');
}

// ── Transition to Break ───────────────────────────────────────────────────────

async function transitionToBreak() {
  const state = await getState();
  const settings = await getSettings();

  // Log the completed focus session
  await appendLog({
    type: 'focus',
    scheduledDuration: state.phaseDuration,
    actualDuration: state.startTime ? Date.now() - state.startTime : state.phaseDuration,
    completedNaturally: true,
    snoozed: state.snoozeUsed,
    startedAt: state.startTime,
    endedAt: Date.now(),
  });

  const isLongBreak = state.sessionNumber >= settings.sessionsBeforeLongBreak;
  const breakMinutes = isLongBreak
    ? settings.longBreakMinutes
    : settings.shortBreakMinutes;
  const breakStatus = isLongBreak ? STATUS.LONG_BREAK : STATUS.BREAK;
  const breakDuration = breakMinutes * 60 * 1000;
  const now = Date.now();

  // Clear all focus-related alarms
  await chrome.alarms.clear(ALARM.FOCUS_WARNING);
  await chrome.alarms.clear(ALARM.FOCUS_END);
  await chrome.alarms.clear(ALARM.SNOOZE_END);

  // Set break state
  await setState({
    status: breakStatus,
    startTime: now,
    phaseDuration: breakDuration,
    isPaused: false,
    pausedRemaining: null,
    snoozeUsed: false,
  });

  // Schedule break end
  await chrome.alarms.create(ALARM.BREAK_END, { delayInMinutes: breakMinutes });

  // Broadcast state BEFORE switching tabs so the tab renders correctly when activated
  const newState = await getState();
  await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: newState });

  // Switch to timer tab and focus its window
  await activateTimerTab();

  // System notification (clear any previous one first to avoid stacking)
  try { await chrome.notifications.clear('pomofomo-break'); } catch (_e) {}
  await chrome.notifications.create('pomofomo-break', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: isLongBreak ? '🐉 Long break time!' : '🐉 Break time!',
    message: isLongBreak
      ? `Amazing work! Time for a ${settings.longBreakMinutes}-minute break. You earned it!`
      : `Great focus! Take a quick ${settings.shortBreakMinutes}-minute break.`,
    priority: 2,
  });

  // Play break chime
  const freshSettings = await getSettings();
  if (freshSettings.soundEnabled) {
    await broadcastToTimerTab({ type: MSG.PLAY_CHIME, variant: 'break' });
  }

  await updateActionIcon(breakStatus);
  console.log(`[PomoFomo] Break started: ${isLongBreak ? 'long' : 'short'} (${breakMinutes} min)`);
}

// ── End Break ─────────────────────────────────────────────────────────────────

async function endBreak() {
  const state = await getState();

  // Log the completed break
  await appendLog({
    type: state.status === STATUS.LONG_BREAK ? 'longBreak' : 'shortBreak',
    scheduledDuration: state.phaseDuration,
    actualDuration: state.startTime ? Date.now() - state.startTime : state.phaseDuration,
    completedNaturally: true,
    snoozed: false,
    startedAt: state.startTime,
    endedAt: Date.now(),
  });

  const wasLongBreak = state.status === STATUS.LONG_BREAK;

  // After a long break, cycle resets to session 1; otherwise advance
  const newSessionNumber = wasLongBreak ? 1 : state.sessionNumber + 1;

  await chrome.alarms.clear(ALARM.BREAK_END);

  // Auto-start the next focus session — no idle state between cycles.
  // The child only ever clicks Start once (the very first session).
  const freshSettings = await getSettings();
  const focusDuration = freshSettings.focusMinutes * 60 * 1000;
  const now = Date.now();

  await setState({
    status: STATUS.FOCUS,
    sessionNumber: newSessionNumber,
    startTime: now,
    phaseDuration: focusDuration,
    isPaused: false,
    pausedRemaining: null,
    snoozeUsed: false,
  });

  // Schedule next focus session alarms
  if (freshSettings.focusMinutes > WARNING_MINUTES) {
    await chrome.alarms.create(ALARM.FOCUS_WARNING, {
      delayInMinutes: freshSettings.focusMinutes - WARNING_MINUTES,
    });
  }
  await chrome.alarms.create(ALARM.FOCUS_END, {
    delayInMinutes: freshSettings.focusMinutes,
  });

  await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
  await updateActionIcon(STATUS.FOCUS);
  console.log('[PomoFomo] Break ended, auto-starting session', newSessionNumber);
}

// ── Activate timer tab ────────────────────────────────────────────────────────

async function activateTimerTab() {
  const state = await getState();

  if (state.timerTabId) {
    try {
      await chrome.tabs.update(state.timerTabId, { active: true });
    } catch (_e) {
      // Tab was closed — recreate and activate
      await ensureTimerTab();
      const freshState = await getState();
      if (freshState.timerTabId) {
        try { await chrome.tabs.update(freshState.timerTabId, { active: true }); }
        catch (_e2) { /* best effort */ }
      }
    }
  }

  // Bring the Chrome window to front (best-effort — may be blocked by OS)
  const windowId = state.timerWindowId;
  if (windowId) {
    try { await chrome.windows.update(windowId, { focused: true }); }
    catch (_e) { /* best effort */ }
  }
}

// ── Message Handler ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const state = await getState();
  const settings = await getSettings();

  switch (msg.type) {

    // ── GET_STATE ────────────────────────────────────────────────────────────
    case MSG.GET_STATE:
      return await getState();

    // ── START ────────────────────────────────────────────────────────────────
    case MSG.START: {
      if (state.status !== STATUS.IDLE) return await getState();

      const freshSettings = await getSettings();
      const focusDuration = freshSettings.focusMinutes * 60 * 1000;
      const warningDelay = freshSettings.focusMinutes - WARNING_MINUTES;
      const now = Date.now();

      // Clear any stale alarms
      await chrome.alarms.clear(ALARM.FOCUS_WARNING);
      await chrome.alarms.clear(ALARM.FOCUS_END);

      await setState({
        status: STATUS.FOCUS,
        startTime: now,
        phaseDuration: focusDuration,
        isPaused: false,
        pausedRemaining: null,
        snoozeUsed: false,
      });

      // Only create warning alarm if session is longer than WARNING_MINUTES
      if (freshSettings.focusMinutes > WARNING_MINUTES) {
        await chrome.alarms.create(ALARM.FOCUS_WARNING, {
          delayInMinutes: warningDelay,
        });
      }
      await chrome.alarms.create(ALARM.FOCUS_END, {
        delayInMinutes: freshSettings.focusMinutes,
      });

      await updateActionIcon(STATUS.FOCUS);
      const newState = await getState();
      await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: newState });
      return newState;
    }

    // ── PAUSE ────────────────────────────────────────────────────────────────
    case MSG.PAUSE: {
      const activeStatuses = [STATUS.FOCUS, STATUS.FOCUS_WARNING, STATUS.BREAK, STATUS.LONG_BREAK];
      if (!activeStatuses.includes(state.status) || state.isPaused) return await getState();

      const remaining = Math.max(0, (state.startTime + state.phaseDuration) - Date.now());

      // Clear all alarms — we'll recreate on resume
      await chrome.alarms.clearAll();

      await setState({
        isPaused: true,
        pausedRemaining: remaining,
      });

      await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
      return await getState();
    }

    // ── RESUME ───────────────────────────────────────────────────────────────
    case MSG.RESUME: {
      if (!state.isPaused || state.pausedRemaining == null) return await getState();

      const now = Date.now();
      const remaining = state.pausedRemaining;
      const newDuration = remaining;

      await setState({
        isPaused: false,
        pausedRemaining: null,
        startTime: now,
        phaseDuration: newDuration,
      });

      const isBreakPhase = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;

      if (isBreakPhase) {
        await chrome.alarms.create(ALARM.BREAK_END, {
          when: now + remaining,
        });
      } else {
        // Focus phase — re-register alarms
        const warningAt = now + remaining - WARNING_MINUTES * 60 * 1000;
        if (warningAt > now) {
          await chrome.alarms.create(ALARM.FOCUS_WARNING, { when: warningAt });
        }
        await chrome.alarms.create(ALARM.FOCUS_END, { when: now + remaining });
      }

      await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
      return await getState();
    }

    // ── STOP (reset to idle) ─────────────────────────────────────────────────
    case MSG.STOP: {
      await chrome.alarms.clearAll();
      await setState({
        status: STATUS.IDLE,
        startTime: null,
        phaseDuration: null,
        isPaused: false,
        pausedRemaining: null,
        snoozeUsed: false,
      });
      await updateActionIcon(STATUS.IDLE);
      await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
      return await getState();
    }

    // ── SKIP ─────────────────────────────────────────────────────────────────
    case MSG.SKIP: {
      const isFocusPhase = state.status === STATUS.FOCUS || state.status === STATUS.FOCUS_WARNING;
      const isBreakPhase = state.status === STATUS.BREAK || state.status === STATUS.LONG_BREAK;

      if (isFocusPhase) {
        await chrome.alarms.clear(ALARM.FOCUS_WARNING);
        await chrome.alarms.clear(ALARM.FOCUS_END);
        await chrome.alarms.clear(ALARM.SNOOZE_END);
        await transitionToBreak();
      } else if (isBreakPhase) {
        await chrome.alarms.clear(ALARM.BREAK_END);
        await endBreak();
      }
      return await getState();
    }

    // ── SNOOZE ───────────────────────────────────────────────────────────────
    case MSG.SNOOZE: {
      // Guard: only one snooze per session, only during focus-warning
      if (state.snoozeUsed) return await getState();
      if (state.status !== STATUS.FOCUS_WARNING) return await getState();

      const snoozeMs = 5 * 60 * 1000;

      // Clear existing focus alarms
      await chrome.alarms.clear(ALARM.FOCUS_END);
      await chrome.alarms.clear(ALARM.FOCUS_WARNING);

      const newDuration = state.phaseDuration + snoozeMs;
      const newEnd = state.startTime + newDuration;

      await setState({
        snoozeUsed: true,
        phaseDuration: newDuration,
        status: STATUS.FOCUS, // back to regular focus state
      });

      // Schedule snooze end
      await chrome.alarms.create(ALARM.SNOOZE_END, { when: newEnd });

      await updateActionIcon(STATUS.FOCUS);
      await broadcastToTimerTab({ type: MSG.STATE_UPDATE, state: await getState() });
      return await getState();
    }

    // ── SETTINGS_CHANGED ─────────────────────────────────────────────────────
    case MSG.SETTINGS_CHANGED: {
      // Settings take effect at the start of the next phase.
      // No action needed here — SW reads fresh settings at every transition.
      return { ok: true };
    }

    default:
      console.warn('[PomoFomo BG] Unknown message type:', msg.type);
      return null;
  }
}

// ── Tab Removed ───────────────────────────────────────────────────────────────

async function handleTabRemoved(tabId) {
  const state = await getState();
  if (tabId !== state.timerTabId) return;

  // Clear saved tab reference
  await setState({ timerTabId: null, timerWindowId: null });

  // Recreate after a brief delay to avoid race with Chrome's tab cleanup
  setTimeout(() => ensureTimerTab(), 600);
  console.log('[PomoFomo] Timer tab was closed, recreating...');
}

// ── Broadcast to Timer Tab ────────────────────────────────────────────────────

async function broadcastToTimerTab(message) {
  const state = await getState();
  if (!state.timerTabId) return;

  try {
    await chrome.tabs.sendMessage(state.timerTabId, message);
  } catch (_e) {
    // Timer tab may not have its listener ready yet (still loading).
    // This is fine — timer.js calls GET_STATE on load to pull current state.
  }
}

// ── Update Toolbar Icon ───────────────────────────────────────────────────────

async function updateActionIcon(status) {
  const colors = {
    [STATUS.IDLE]:          '#9A8070',
    [STATUS.FOCUS]:         '#F5A623',
    [STATUS.FOCUS_WARNING]: '#E8842A',
    [STATUS.BREAK]:         '#2BBFA0',
    [STATUS.LONG_BREAK]:    '#2BBFA0',
  };
  const color = colors[status] ?? '#9A8070';

  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    // Circle background
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // White "P" letter mark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 16, 17);

    const imageData = ctx.getImageData(0, 0, 32, 32);
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn('[PomoFomo BG] Could not update action icon:', e);
  }
}

// ── Session Log ───────────────────────────────────────────────────────────────

async function appendLog(entry) {
  const state = await getState();
  const logs = Array.isArray(state.logs) ? state.logs : [];

  const newEntry = {
    id: crypto.randomUUID(),
    ...entry,
  };

  // Keep last 1000 entries to avoid unbounded storage growth
  const trimmed = [...logs, newEntry].slice(-1000);
  await setState({ logs: trimmed });
}

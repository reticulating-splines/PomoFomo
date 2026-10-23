import { STATUS, BREAK_STATUSES } from './constants.js';

// Pure helpers shared by the timer tab and the popup. Time is always derived
// from startTime/phaseDuration — never from counters.

export const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;

export function isRunning(state) {
  return state.startTime != null
    && state.phaseDuration != null
    && !state.isPaused
    && state.status !== STATUS.IDLE;
}

export function isBreak(state) {
  return BREAK_STATUSES.includes(state.status);
}

/** Milliseconds left in the current phase, or null at idle. */
export function remainingMs(state, now = Date.now()) {
  if (state.status === STATUS.IDLE) return null;
  if (state.isPaused) return state.pausedRemaining ?? 0;
  if (state.startTime == null || state.phaseDuration == null) return null;
  return Math.max(0, state.startTime + state.phaseDuration - now);
}

/** 0 → 1 through the current phase. */
export function phaseProgress(state, now = Date.now()) {
  const left = remainingMs(state, now);
  if (left == null || !state.phaseDuration) return 0;
  return Math.min(1, Math.max(0, 1 - left / state.phaseDuration));
}

export function formatClock(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A break that ran its full length without the kid wandering off. */
export function isFullBreak(entry) {
  return (entry.type === 'shortBreak' || entry.type === 'longBreak')
    && entry.completedNaturally
    && !entry.interrupted;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Rewards (full breaks) earned since midnight. */
export function rewardsToday(logs) {
  const since = startOfToday();
  return (Array.isArray(logs) ? logs : [])
    .filter(e => e.endedAt >= since && isFullBreak(e)).length;
}

/**
 * Last 7 calendar days, oldest first: focus rounds finished, focus minutes,
 * and full breaks taken per day.
 */
export function weekStats(logs) {
  const today = startOfToday();
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = today - (6 - i) * DAY_MS;
    return {
      start,
      label: new Date(start).toLocaleDateString(undefined, { weekday: 'narrow' }),
      longLabel: new Date(start).toLocaleDateString(undefined, { weekday: 'long' }),
      isToday: i === 6,
      rounds: 0,
      minutes: 0,
      breaks: 0,
    };
  });

  for (const entry of Array.isArray(logs) ? logs : []) {
    if (!entry.endedAt) continue;
    const day = days.find(d => entry.endedAt >= d.start && entry.endedAt < d.start + DAY_MS);
    if (!day) continue;
    if (entry.type === 'focus') {
      day.rounds++;
      const ms = entry.startedAt ? entry.endedAt - entry.startedAt : entry.scheduledDuration ?? 0;
      day.minutes += Math.round(ms / MINUTE);
    } else if (isFullBreak(entry)) {
      day.breaks++;
    }
  }
  return days;
}

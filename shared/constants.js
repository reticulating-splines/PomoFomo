// ── Alarm names ──────────────────────────────────────────────────────────────
export const ALARM = {
  FOCUS_WARNING: 'focus-warning',  // fires WARNING_MINUTES before focus ends
  FOCUS_END:     'focus-end',      // fires when focus session completes
  BREAK_END:     'break-end',      // fires when break completes
  SNOOZE_END:    'snooze-end',     // fires SNOOZE_MINUTES after snooze
  NAG:           'nag',            // repeating: re-focus timer tab during break
  BADGE_TICK:    'badge-tick',     // repeating: refresh toolbar icon + badge
};

// ── Timer status values ──────────────────────────────────────────────────────
export const STATUS = {
  IDLE:          'idle',
  FOCUS:         'focus',
  FOCUS_WARNING: 'focus-warning',
  BREAK:         'break',
  LONG_BREAK:    'longBreak',
};

export const BREAK_STATUSES  = [STATUS.BREAK, STATUS.LONG_BREAK];
export const FOCUS_STATUSES  = [STATUS.FOCUS, STATUS.FOCUS_WARNING];
export const ACTIVE_STATUSES = [...FOCUS_STATUSES, ...BREAK_STATUSES];

// ── Message types (timer.js / popup.js → background.js) ──────────────────────
// State flows the other way through chrome.storage.onChanged — the service
// worker never pushes messages to the UI pages.
export const MSG = {
  START:  'START',
  PAUSE:  'PAUSE',
  RESUME: 'RESUME',
  STOP:   'STOP',
  SKIP:   'SKIP',
  SNOOZE: 'SNOOZE',
};

// ── Characters ───────────────────────────────────────────────────────────────
// `reward` is what a full (uninterrupted) break earns for the kid.
export const CHARACTERS = {
  dragon: { name: 'Ember', kind: 'dragon', svg: 'characters/ember.svg', css: 'characters/ember.css', prefix: 'ember', breakStartMs: 750, reward: 'gem' },
  book:   { name: 'Page',  kind: 'book',   svg: 'characters/page.svg',  css: 'characters/page.css',  prefix: 'page',  breakStartMs: 700, reward: 'star' },
};

export function characterInfo(key) {
  return CHARACTERS[key] ?? CHARACTERS.dragon;
}

// ── Default settings (chrome.storage.sync) ───────────────────────────────────
export const DEFAULT_SETTINGS = {
  focusMinutes:            20,
  shortBreakMinutes:       5,
  longBreakMinutes:        15,
  sessionsBeforeLongBreak: 3,
  soundEnabled:            true,
  persistOnRelaunch:       false,
  nagDuringBreak:          false,    // timer tab re-grabs focus during breaks
  timerCharacter:          'dragon', // 'dragon' | 'book'
};

// ── Default runtime state (chrome.storage.local) ─────────────────────────────
export const DEFAULT_STATE = {
  status:           STATUS.IDLE,
  sessionNumber:    1,      // 1..sessionsBeforeLongBreak
  startTime:        null,   // epoch ms when current phase started
  phaseDuration:    null,   // total ms for current phase
  isPaused:         false,
  pausedRemaining:  null,   // ms remaining when paused
  snoozeUsed:       false,
  breakInterrupted: false,  // kid switched to another tab during this break
  logs:             [],     // completed-phase entries (stats + rewards)
};

// UI-only flags the pages write themselves (never touched by the SW).
export const UI_KEYS = {
  INTRO_SEEN: 'introSeen',
};

// ── Timing knobs ─────────────────────────────────────────────────────────────
export const WARNING_MINUTES    = 2;    // heads-up before focus ends
export const SNOOZE_MINUTES     = 5;    // one snooze per session
export const NAG_PERIOD_MINUTES = 0.5;  // chrome.alarms minimum (Chrome 120+)
export const MAX_LOG_ENTRIES    = 500;
// Leaving the timer tab this close to the end of a break doesn't count as
// interrupting it — the kid is just getting ready to go again.
export const BREAK_GRACE_MS     = 20 * 1000;

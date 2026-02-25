// ── Alarm names ────────────────────────────────────────────────────────────────
// These strings must match exactly across background.js and any callers.
export const ALARM = {
  FOCUS_WARNING: 'focus-warning',  // fires 2 min before focus ends
  FOCUS_END:     'focus-end',      // fires when focus session completes
  BREAK_END:     'break-end',      // fires when break completes
  SNOOZE_END:    'snooze-end',     // fires 5 min after snooze
};

// ── Timer status values ────────────────────────────────────────────────────────
export const STATUS = {
  IDLE:          'idle',
  FOCUS:         'focus',
  FOCUS_WARNING: 'focus-warning',
  BREAK:         'break',
  LONG_BREAK:    'longBreak',
};

// ── Message types (timer.js / popup.js → background.js) ──────────────────────
export const MSG = {
  START:              'START',
  PAUSE:              'PAUSE',
  RESUME:             'RESUME',
  STOP:               'STOP',
  SKIP:               'SKIP',
  SNOOZE:             'SNOOZE',
  GET_STATE:          'GET_STATE',
  STATE_UPDATE:       'STATE_UPDATE',
  PLAY_CHIME:         'PLAY_CHIME',
  SETTINGS_CHANGED:   'SETTINGS_CHANGED',
};

// ── Default settings (chrome.storage.sync) ────────────────────────────────────
export const DEFAULT_SETTINGS = {
  focusMinutes:            20,
  shortBreakMinutes:       5,
  longBreakMinutes:        15,
  sessionsBeforeLongBreak: 3,
  soundEnabled:            true,
  persistOnRelaunch:       false,
};

// ── Default runtime state (chrome.storage.local) ──────────────────────────────
export const DEFAULT_STATE = {
  status:          'idle',
  sessionNumber:   1,
  startTime:       null,   // epoch ms when current phase started
  phaseDuration:   null,   // total ms for current phase
  isPaused:        false,
  pausedRemaining: null,   // ms remaining when paused
  snoozeUsed:      false,
  timerTabId:      null,
  timerWindowId:   null,
  logs:            [],
};

// ── Warning threshold ─────────────────────────────────────────────────────────
// How many minutes before focus end to trigger the warning state
export const WARNING_MINUTES = 2;

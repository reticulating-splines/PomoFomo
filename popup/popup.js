/**
 * PomoFomo — Popup (popup.js)
 *
 * The toolbar remote for grown-ups. The popup is destroyed on close and
 * recreated on open, so it reads everything from storage on load — and stays
 * live while open by subscribing to chrome.storage.onChanged (alarms fire,
 * the timer tab's buttons get clicked, etc).
 */

import { MSG, STATUS, DEFAULT_SETTINGS, characterInfo } from '../shared/constants.js';
import { getState, getSettings, saveSettings } from '../shared/storage.js';
import {
  isRunning, isBreak, remainingMs, phaseProgress, formatClock, formatMinutes, weekStats, MINUTE,
} from '../shared/timing.js';
import { createCharacter } from '../characters/character.js';

const SPRITE = '../assets/sprite.svg';
const TIMER_URL = chrome.runtime.getURL('timer/timer.html');

const $ = id => document.getElementById(id);
const el = {
  body: document.body,
  btnView: $('btnView'), mini: $('mini'),
  face: $('nowFace'), phase: $('phase'), time: $('time'), bar: $('bar'), rounds: $('rounds'), ends: $('ends'),
  btnStart: $('btnStart'), controls: $('controls'),
  btnPause: $('btnPause'), pauseIcon: $('pauseIcon'), pauseLabel: $('pauseLabel'),
  btnSkip: $('btnSkip'), skipLabel: $('skipLabel'), btnStop: $('btnStop'), btnOpen: $('btnOpen'),
  weekBars: $('weekBars'), statRounds: $('statRounds'), statMinutes: $('statMinutes'),
  statBreaks: $('statBreaks'), statRewardIcon: $('statRewardIcon'),
  cycleHint: $('cycleHint'),
};
const steppers = [...document.querySelectorAll('.stepper')];
const switches = [...document.querySelectorAll('.switch input')];
const buddyInputs = [...document.querySelectorAll('input[name="timerCharacter"]')];

let state = null;
let settings = { ...DEFAULT_SETTINGS };
let face = null;
let faceKey = null;
let tickTimer = null;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [loaded, loadedSettings] = await Promise.all([getState(), getSettings()]);
  settings = loadedSettings;
  populateSettings();
  await renderFace();
  render(loaded);
  loadBuddyArt();
  requestAnimationFrame(() => requestAnimationFrame(() => el.body.removeAttribute('data-loading')));
}

init();

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === 'local') {
    render(await getState());
  } else if (area === 'sync') {
    settings = await getSettings();
    populateSettings();
    await renderFace();
    if (state) render(state);
  }
});

// ── Status view ──────────────────────────────────────────────────────────────

function render(next) {
  state = next;
  const idle = state.status === STATUS.IDLE;

  el.body.dataset.status = state.status;
  el.body.dataset.paused = String(Boolean(state.isPaused));
  el.phase.textContent = phaseLabel();
  el.btnStart.hidden = !idle;
  el.controls.hidden = idle;

  el.pauseLabel.textContent = state.isPaused ? 'Resume' : 'Pause';
  el.pauseIcon.setAttribute('href', `${SPRITE}#${state.isPaused ? 'play' : 'pause'}`);
  el.skipLabel.textContent = isBreak(state) ? 'End break' : 'Skip';

  const total = settings.sessionsBeforeLongBreak;
  el.rounds.textContent = idle
    ? `${settings.focusMinutes} min focus · ${settings.shortBreakMinutes} min break`
    : `Round ${Math.min(state.sessionNumber, total)} of ${total}`;

  face?.setState(faceState());
  renderWeek();

  clearInterval(tickTimer);
  tick();
  if (isRunning(state)) tickTimer = setInterval(tick, 1000);
}

function tick() {
  const left = remainingMs(state);
  const clock = formatClock(left ?? settings.focusMinutes * MINUTE);
  el.time.textContent = clock;
  el.bar.style.width = `${(isBreak(state) ? phaseProgress(state) : 1 - phaseProgress(state)) * 100}%`;
  el.mini.textContent = left == null ? '' : `${clock} · ${phaseLabel()}`;

  if (left != null && !state.isPaused) {
    const at = new Date(Date.now() + left).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.ends.textContent = `${isBreak(state) ? 'Back to it' : 'Break'} at ${at}`;
  } else {
    el.ends.textContent = '';
  }
}

function phaseLabel() {
  if (state.isPaused) return 'Paused';
  switch (state.status) {
    case STATUS.FOCUS:         return 'Focusing';
    case STATUS.FOCUS_WARNING: return 'Break soon';
    case STATUS.BREAK:         return 'On a break';
    case STATUS.LONG_BREAK:    return 'Big break';
    default:                   return 'Ready to start';
  }
}

function faceState() {
  if (state.isPaused) return 'idle';
  switch (state.status) {
    case STATUS.FOCUS:         return 'focus';
    case STATUS.FOCUS_WARNING: return 'focus-tired';
    case STATUS.BREAK:
    case STATUS.LONG_BREAK:    return 'break-active';
    default:                   return 'idle';
  }
}

async function renderFace() {
  if (faceKey === settings.timerCharacter) return;
  faceKey = settings.timerCharacter;
  face?.destroy();
  face = await createCharacter(settings.timerCharacter, el.face);
  if (state) face.setState(faceState());
}

function renderWeek() {
  const days = weekStats(state.logs);
  const max = Math.max(1, ...days.map(d => d.rounds));
  const { reward } = characterInfo(settings.timerCharacter);

  el.weekBars.replaceChildren(...days.map(day => {
    const col = document.createElement('div');
    col.className = 'day' + (day.isToday ? ' is-today' : '') + (day.rounds ? '' : ' is-zero');
    col.title = `${day.longLabel}: ${day.rounds} round${day.rounds === 1 ? '' : 's'}, ${day.breaks} full break${day.breaks === 1 ? '' : 's'}`;
    const n = document.createElement('span');
    n.className = 'day__n';
    n.textContent = day.rounds || '';
    const bar = document.createElement('span');
    bar.className = 'day__bar';
    bar.style.height = day.rounds ? `${(day.rounds / max) * 56}px` : '4px';
    const label = document.createElement('span');
    label.className = 'day__label';
    label.textContent = day.label;
    col.append(n, bar, label);
    return col;
  }));
  el.weekBars.setAttribute('aria-label',
    days.map(d => `${d.longLabel} ${d.rounds}`).join(', ') + ' focus rounds');

  el.statRounds.textContent = days.reduce((n, d) => n + d.rounds, 0);
  el.statMinutes.textContent = formatMinutes(days.reduce((n, d) => n + d.minutes, 0));
  el.statBreaks.textContent = days.reduce((n, d) => n + d.breaks, 0);
  el.statRewardIcon.setAttribute('href', `${SPRITE}#${reward}`);
}

// ── Settings view ────────────────────────────────────────────────────────────

function populateSettings() {
  for (const s of steppers) renderStepper(s, settings[s.dataset.key]);
  for (const input of switches) input.checked = Boolean(settings[input.dataset.key]);
  for (const input of buddyInputs) input.checked = input.value === (settings.timerCharacter === 'book' ? 'book' : 'dragon');

  const n = settings.sessionsBeforeLongBreak;
  el.cycleHint.textContent =
    `${n} rounds of ${settings.focusMinutes} min, with ${settings.shortBreakMinutes} min breaks, then a ${settings.longBreakMinutes} min big break.`;
}

function renderStepper(stepper, value) {
  const { min, max, unit } = stepper.dataset;
  stepper.querySelector('output').textContent = unit ? `${value} ${unit}` : value;
  stepper.querySelector('[data-dir="-1"]').disabled = value <= Number(min);
  stepper.querySelector('[data-dir="1"]').disabled = value >= Number(max);
}

for (const stepper of steppers) {
  stepper.addEventListener('click', e => {
    const btn = e.target.closest('.stepper__btn');
    if (!btn || btn.disabled) return;
    const { key, min, max, step } = stepper.dataset;
    const value = Math.min(Number(max), Math.max(Number(min),
      settings[key] + Number(btn.dataset.dir) * Number(step)));
    save({ [key]: value });
  });
}

for (const input of switches) {
  input.addEventListener('change', () => save({ [input.dataset.key]: input.checked }));
}

for (const input of buddyInputs) {
  input.addEventListener('change', () => { if (input.checked) save({ timerCharacter: input.value }); });
}

// Optimistic: update locally right away; the sync-area change re-renders too.
// The SW reads settings fresh at each transition, and the timer tab reacts
// to the sync change — no message needed.
async function save(partial) {
  settings = { ...settings, ...partial };
  populateSettings();
  try {
    await saveSettings(partial);
  } catch (e) {
    console.error('[PomoFomo Popup] Settings save failed:', e);
  }
}

async function loadBuddyArt() {
  for (const art of document.querySelectorAll('.buddy__art')) {
    const c = await createCharacter(art.dataset.char, art);
    c.setState('idle');
  }
}

// ── View toggle ──────────────────────────────────────────────────────────────

el.btnView.addEventListener('click', () => {
  const toSettings = el.body.dataset.view !== 'settings';
  el.body.dataset.view = toSettings ? 'settings' : 'status';
  el.btnView.setAttribute('aria-expanded', String(toSettings));
  el.btnView.setAttribute('aria-label', toSettings ? 'Back to status' : 'Settings');
});

// ── Actions ──────────────────────────────────────────────────────────────────

el.btnOpen.addEventListener('click', async () => {
  await focusTimerTab();
  window.close();
});

el.btnStart.addEventListener('click', async () => {
  await sendMsg(MSG.START);
  await focusTimerTab();
  window.close();
});

el.btnPause.addEventListener('click', () => sendMsg(state?.isPaused ? MSG.RESUME : MSG.PAUSE));
el.btnSkip.addEventListener('click', () => sendMsg(MSG.SKIP));
el.btnStop.addEventListener('click', () => sendMsg(MSG.STOP));

async function focusTimerTab() {
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url && t.url.startsWith(TIMER_URL));
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: TIMER_URL, pinned: true, active: true });
    }
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

/**
 * PomoFomo — Timer tab (timer.js)
 *
 * Pure renderer: reads state from chrome.storage on load, subscribes to
 * chrome.storage.onChanged for every update, and sends user actions to the
 * service worker. No timing decisions happen here — the per-second interval
 * only repaints time derived from startTime/phaseDuration.
 *
 * Chimes, celebrations and the reward toast are derived from observed status
 * transitions, so no push messaging from the SW is needed.
 */

import { STATUS, MSG, DEFAULT_SETTINGS, UI_KEYS, characterInfo } from '../shared/constants.js';
import { getState, getSettings } from '../shared/storage.js';
import {
  isRunning, isBreak, remainingMs, phaseProgress, formatClock, isFullBreak, rewardsToday, MINUTE,
} from '../shared/timing.js';
import { ideasFor } from '../shared/break-ideas.js';
import { createCharacter } from '../characters/character.js';
import { FaviconUpdater } from '../favicon/favicon.js';
import { SoundPlayer } from '../sounds/sounds.js';

const SPRITE = '../assets/sprite.svg';
const RING_R = 136;
const RING_C = 2 * Math.PI * RING_R;
const BREAK_DONE_MS = 1600; // break → focus celebration before the focus pose
const SLEEPY_MS = 10_000;   // last seconds of the warning: the character nods off
const TOAST_MS = 4200;

const $ = id => document.getElementById(id);
const el = {
  body: document.body,
  arc: $('arc'), knob: $('knob'),
  time: $('time'), caption: $('caption'), bubble: $('bubble'),
  roundDots: $('roundDots'), roundLabel: $('roundLabel'),
  hoard: $('hoard'), hoardIcon: $('hoardIcon'), hoardCount: $('hoardCount'), hoardLabel: $('hoardLabel'),
  btnStart: $('btnStart'), btnSnooze: $('btnSnooze'), btnStop: $('btnStop'), actionsNote: $('actionsNote'),
  breakCard: $('breakCard'), breakTitle: $('breakTitle'), breakLede: $('breakLede'),
  idea: $('idea'), ideaArt: $('ideaArt'), ideaTitle: $('ideaTitle'), ideaText: $('ideaText'), btnIdea: $('btnIdea'),
  rewardHint: $('rewardHint'), rewardHintIcon: $('rewardHintIcon'), rewardHintText: $('rewardHintText'),
  toast: $('toast'), toastIcon: $('toastIcon'), toastText: $('toastText'),
  characterContainer: $('characterContainer'),
  intro: $('intro'), introChar: $('introChar'), introTitle: $('introTitle'),
  introRewardIcon: $('introRewardIcon'), introRewardText: $('introRewardText'), btnIntro: $('btnIntro'),
};

const favicon = new FaviconUpdater($('favicon'));
const sounds = new SoundPlayer();

let state = null;
let settings = { ...DEFAULT_SETTINGS };
let character = null;
let tickTimer = null;
let celebrating = null; // timeout id while the break-done pose plays
let toastTimer = null;
let ideaShift = 0;      // "Another idea" presses during the current break
let ideaBreakKey = null;

el.arc.style.strokeDasharray = RING_C;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [loaded, loadedSettings, ui] = await Promise.all([
    getState(), getSettings(), chrome.storage.local.get(UI_KEYS.INTRO_SEEN),
  ]);
  settings = loadedSettings;
  sounds.setEnabled(settings.soundEnabled);
  character = await createCharacter(settings.timerCharacter, el.characterContainer);
  applyCharacterText();
  render(loaded);
  requestAnimationFrame(() => requestAnimationFrame(() => el.body.removeAttribute('data-loading')));

  if (!ui[UI_KEYS.INTRO_SEEN] && loaded.status === STATUS.IDLE) showIntro();
}

init();

// ── Storage subscription — the only state input after load ───────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local') {
    // UI-only keys (intro flag) don't affect the timer
    if (Object.keys(changes).every(k => Object.values(UI_KEYS).includes(k))) return;
    const prev = state;
    const next = await getState();
    onTransition(prev, next);
    render(next);
  } else if (area === 'sync') {
    const prevKey = settings.timerCharacter;
    settings = await getSettings();
    sounds.setEnabled(settings.soundEnabled);
    if (settings.timerCharacter !== prevKey) await swapCharacter();
    if (state) render(state);
  }
});

document.addEventListener('visibilitychange', () => { if (state) render(state); });

async function swapCharacter() {
  character?.destroy();
  character = await createCharacter(settings.timerCharacter, el.characterContainer);
  applyCharacterText();
}

function applyCharacterText() {
  const info = characterInfo(settings.timerCharacter);
  el.body.dataset.char = info.kind;
  el.characterContainer.setAttribute('aria-label', `${info.name} the ${info.kind}`);
  const icon = `${SPRITE}#${info.reward}`;
  for (const use of [el.hoardIcon, el.rewardHintIcon, el.toastIcon, el.introRewardIcon]) {
    use.setAttribute('href', icon);
  }
  el.introTitle.textContent = `Hi! I’m ${info.name}.`;
  el.introRewardText.innerHTML = `<strong>Stay away for the whole break</strong> to earn a ${info.reward}!`;
}

// ── Transition effects (chimes, celebrations, rewards) ───────────────────────

function onTransition(prev, next) {
  if (!prev) return;
  if (prev.status === next.status) {
    if (!prev.snoozeUsed && next.snoozeUsed) sounds.playChime('snooze');
    return;
  }

  const wasBreak = isBreak(prev);
  if (next.status === STATUS.FOCUS_WARNING) {
    sounds.playChime('warning');
  } else if (isBreak(next) && !wasBreak) {
    sounds.playChime('break');
  } else if (wasBreak && next.status === STATUS.FOCUS) {
    celebrate(next);
  }
}

function celebrate(next) {
  clearTimeout(celebrating);
  character?.setState('break-done');
  celebrating = setTimeout(() => {
    celebrating = null;
    if (state) render(state);
  }, BREAK_DONE_MS);

  const last = next.logs?.at(-1);
  if (last && isFullBreak(last)) {
    const { reward } = characterInfo(settings.timerCharacter);
    sounds.playChime('reward');
    showToast(`+1 ${reward}! You took a full break.`);
    el.hoard.classList.remove('is-bumped');
    void el.hoard.offsetWidth; // restart the bump animation
    el.hoard.classList.add('is-bumped');
  } else {
    sounds.playChime('ready');
  }
}

function showToast(text) {
  el.toastText.textContent = text;
  el.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-shown'), TOAST_MS);
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(next) {
  state = next;
  const onBreak = isBreak(state);

  el.body.dataset.status = state.status;
  el.body.dataset.paused = String(Boolean(state.isPaused));
  el.body.dataset.phase = onBreak ? 'break' : state.status === STATUS.IDLE ? 'idle' : 'focus';

  renderRounds();
  renderHoard();
  renderControls();
  renderBreakCard();
  renderCharacter();

  clearInterval(tickTimer);
  tick();
  if (isRunning(state)) tickTimer = setInterval(tick, 1000);

  sounds.setAmbient(onBreak && !state.isPaused);
}

/** Everything that changes second by second. */
function tick() {
  const left = remainingMs(state);
  const ratio = phaseProgress(state);
  const onBreak = isBreak(state);
  const idle = state.status === STATUS.IDLE;

  el.time.textContent = formatClock(left ?? settings.focusMinutes * MINUTE);

  // Focus drains the ring toward empty; breaks fill it back up (recharge)
  const shown = idle ? 1 : onBreak ? ratio : 1 - ratio;
  el.arc.style.strokeDashoffset = RING_C * (1 - shown);
  const angle = -Math.PI / 2 + shown * 2 * Math.PI;
  el.knob.setAttribute('cx', (150 + RING_R * Math.cos(angle)).toFixed(2));
  el.knob.setAttribute('cy', (150 + RING_R * Math.sin(angle)).toFixed(2));
  el.knob.style.opacity = shown > 0.004 ? '' : '0';

  el.roundDots.style.setProperty('--p', onBreak ? 1 : ratio);
  el.caption.textContent = caption();
  setBubble(bubbleText(left));
  document.title = idle ? 'PomoFomo' : `${formatClock(left)} · ${phaseName()} — PomoFomo`;

  // Final seconds of the warning: nod off (visual only — the SW stays in warning)
  if (state.status === STATUS.FOCUS_WARNING && !state.isPaused && !celebrating) {
    character?.setState(left <= SLEEPY_MS ? 'focus-sleeping' : 'focus-tired');
  }

  favicon.update(state);
}

function renderCharacter() {
  if (!character || celebrating) return;
  const target = characterState();
  // Don't replay the break-start jump once it has settled into break-active
  if (target === 'break-start' && ['break-start', 'break-active'].includes(character.currentState)) return;
  character.setState(target);
}

function characterState() {
  if (state.isPaused) return 'idle';
  switch (state.status) {
    case STATUS.FOCUS:         return 'focus';
    case STATUS.FOCUS_WARNING: return 'focus-tired'; // tick() may deepen to sleeping
    case STATUS.BREAK:
    case STATUS.LONG_BREAK:    return 'break-start'; // settles into break-active
    default:                   return 'idle';
  }
}

function renderRounds() {
  const total = settings.sessionsBeforeLongBreak;
  const current = Math.min(state.sessionNumber, total);
  const onBreak = isBreak(state);
  const idle = state.status === STATUS.IDLE;

  el.roundDots.replaceChildren(...Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const li = document.createElement('li');
    if (n < current || (onBreak && n === current)) li.className = 'is-done';
    else if (n === current && !idle) li.className = 'is-current';
    return li;
  }));

  el.roundLabel.textContent = state.status === STATUS.LONG_BREAK
    ? 'All rounds done!'
    : `Round ${current} of ${total}`;
}

function renderHoard() {
  const { reward } = characterInfo(settings.timerCharacter);
  const count = rewardsToday(state.logs);
  el.hoardCount.textContent = count;
  el.hoardLabel.textContent = `${reward}${count === 1 ? '' : 's'} today`;
  el.hoard.title = `${count} full break${count === 1 ? '' : 's'} taken today`;
}

function renderControls() {
  const idle = state.status === STATUS.IDLE;
  const canSnooze = state.status === STATUS.FOCUS_WARNING && !state.snoozeUsed && !state.isPaused;

  el.btnStart.hidden = !idle;
  el.btnSnooze.hidden = !canSnooze;
  el.btnStop.hidden = idle;

  el.actionsNote.textContent =
    idle ? `${settings.focusMinutes} min focus, then a ${settings.shortBreakMinutes} min break`
    : canSnooze ? 'You can do this once each round.'
    : '';
}

function renderBreakCard() {
  const onBreak = isBreak(state);
  el.breakCard.hidden = !onBreak;
  if (!onBreak) return;

  const isLong = state.status === STATUS.LONG_BREAK;
  const { reward } = characterInfo(settings.timerCharacter);
  el.breakTitle.textContent = isLong ? 'Big break!' : 'Break time!';
  el.breakLede.textContent = isLong
    ? 'You finished every round! Get away from the screen for a while.'
    : 'Step away from the screen. Here’s an idea:';

  // One stable idea list per break (seeded by the log length, which only
  // changes between phases), shifted by "Another idea" presses.
  const breakKey = `${state.status}:${state.logs?.length ?? 0}`;
  if (breakKey !== ideaBreakKey) { ideaBreakKey = breakKey; ideaShift = 0; }
  showIdea(false);

  const lost = state.breakInterrupted;
  el.rewardHint.classList.toggle('is-lost', lost);
  el.rewardHintText.textContent = lost
    ? `No ${reward} this break — you went back to the screen. You can still finish your break!`
    : `Stay away for the whole break to earn a ${reward}!`;
}

function showIdea(animate) {
  const ideas = ideasFor({ isLong: state.status === STATUS.LONG_BREAK, seed: state.logs?.length ?? 0 });
  const idea = ideas[ideaShift % ideas.length];
  el.ideaArt.setAttribute('href', `${SPRITE}#${idea.icon}`);
  el.ideaTitle.textContent = idea.title;
  el.ideaText.textContent = idea.text;
  if (animate) {
    el.idea.classList.remove('is-new');
    void el.idea.offsetWidth;
    el.idea.classList.add('is-new');
  }
}

// ── Words ────────────────────────────────────────────────────────────────────

function phaseName() {
  if (state.isPaused) return 'Paused';
  switch (state.status) {
    case STATUS.FOCUS:
    case STATUS.FOCUS_WARNING: return 'Focus';
    case STATUS.BREAK:         return 'Break';
    case STATUS.LONG_BREAK:    return 'Big break';
    default:                   return '';
  }
}

function caption() {
  if (state.isPaused) return 'paused';
  switch (state.status) {
    case STATUS.FOCUS:
    case STATUS.FOCUS_WARNING: return 'until break';
    case STATUS.BREAK:         return 'of break left';
    case STATUS.LONG_BREAK:    return 'of big break left';
    default:                   return 'of focus time';
  }
}

function bubbleText(left) {
  if (celebrating) return 'Welcome back! Let’s do another round.';
  if (state.isPaused) return 'Taking a pause. We’ll pick up right where we left off.';
  const progress = phaseProgress(state);
  switch (state.status) {
    case STATUS.FOCUS:
      if (state.snoozeUsed) return 'Okay, five more minutes — then break time!';
      return progress < 0.08
        ? 'Let’s go! I’ll call you when it’s break time.'
        : 'I’m keeping time. You keep going!';
    case STATUS.FOCUS_WARNING:
      return left <= SLEEPY_MS
        ? 'Zzz… break time is coming…'
        : 'Almost break time! Find a good place to stop.';
    case STATUS.BREAK:
    case STATUS.LONG_BREAK:
      if (state.breakInterrupted && document.visibilityState === 'visible') {
        return 'Welcome back! Your break isn’t over yet.';
      }
      return state.status === STATUS.LONG_BREAK
        ? 'You did every round! Go play!'
        : 'Break time! Get up and move with me!';
    default:
      return 'Ready when you are! I’ll tell you when it’s break time.';
  }
}

function setBubble(text) {
  if (el.bubble.textContent === text) return;
  el.bubble.textContent = text;
  // Restart the pop-in so a new line feels spoken
  el.bubble.classList.add('is-swapping');
  void el.bubble.offsetWidth;
  el.bubble.classList.remove('is-swapping');
}

// ── Intro (first run) ────────────────────────────────────────────────────────

async function showIntro() {
  const introCharacter = await createCharacter(settings.timerCharacter, el.introChar);
  introCharacter.setState('break-done');
  setTimeout(() => introCharacter.setState('idle'), BREAK_DONE_MS);
  el.intro.showModal();
  el.intro.addEventListener('close', () => {
    introCharacter.destroy();
    chrome.storage.local.set({ [UI_KEYS.INTRO_SEEN]: true });
    el.btnStart.focus();
  }, { once: true });
}

el.btnIntro.addEventListener('click', () => el.intro.close());

// ── Sound unlock ─────────────────────────────────────────────────────────────
// Web Audio needs a user gesture; Start is the natural one, but any click in
// the tab unlocks (covers reloads mid-session).

document.addEventListener('click', async () => {
  const wasUnlocked = sounds.unlocked;
  await sounds.unlock();
  if (!wasUnlocked && state) sounds.setAmbient(isBreak(state) && !state.isPaused);
}, { passive: true });

// ── User actions — send and forget; storage.onChanged repaints ───────────────

el.btnStart.addEventListener('click', () => sendMsg(MSG.START));
el.btnSnooze.addEventListener('click', () => sendMsg(MSG.SNOOZE));
el.btnStop.addEventListener('click', () => sendMsg(MSG.STOP));
el.btnIdea.addEventListener('click', () => { ideaShift++; showIdea(true); });

async function sendMsg(type) {
  try {
    await chrome.runtime.sendMessage({ type });
  } catch (e) {
    console.error('[PomoFomo Timer] sendMsg failed:', type, e);
  }
}

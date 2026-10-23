// End-to-end test: loads the unpacked extension in headless Chrome and drives
// the real service worker through a full cycle (focus → warning → snooze →
// break → tab-switch nudge → bookcase rewards → long break → pause/resume →
// stop → tab recovery), then the popup and settings.
//
//   npm test                  # test the repo
//   node tools/e2e.mjs <dir>  # test another unpacked copy (e.g. an unzipped build)
//
// Screenshots of key moments land in tools/out/e2e/.
import path from 'node:path';
import { launchExtension, outDir } from './lib.mjs';

const extDir = process.argv[2];
const out = path.join(outDir('e2e'), 'run');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let failures = 0;
const check = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

const { browser, swTarget, extId } = await launchExtension(extDir);
const sw = await swTarget.worker();
sw.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errors.push(`[sw ${m.type()}] ${m.text()}`); });
const TIMER = `chrome-extension://${extId}/timer/timer.html`;

const S = () => sw.evaluate(() => chrome.storage.local.get(null));
const fire = (name, ms = 300) => sw.evaluate((n, d) => chrome.alarms.create(n, { when: Date.now() + d }), name, ms);
const waitFor = async (fn, label, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await fn()) return true; await sleep(150); }
  check(false, `timeout: ${label}`);
  return false;
};

// 1. Install opens the timer tab with the intro
await sleep(1500);
const timerTarget = await browser.waitForTarget(t => t.url().startsWith(TIMER), { timeout: 8000 });
let timer = await timerTarget.page();
timer.on('console', m => { if (m.type() === 'error') errors.push(`[timer] ${m.text()}`); });
timer.on('pageerror', e => errors.push(`[timer pageerror] ${e.message}`));
await timer.setViewport({ width: 1280, height: 760 });
await sleep(1200);
const tabs0 = await sw.evaluate(() => chrome.tabs.query({}));
const tt = tabs0.find(t => t.url.startsWith('chrome-extension'));
check(tt && tt.pinned, 'timer tab exists and is pinned on install');
check(await timer.evaluate(() => document.getElementById('intro').open), 'intro dialog shown on first run');
await timer.screenshot({ path: `${out}-01-intro.png` });
await timer.click('#btnIntro');
await sleep(500);
check((await S()).introSeen === true, 'intro dismissal saved');

// 2. Kid opens a "game" tab, then starts from the timer tab
const game = await browser.newPage();
await game.goto('data:text/html,<title>Game</title><h1>Game</h1>');
await timer.bringToFront();
await timer.click('#btnStart');
await waitFor(async () => (await S()).status === 'focus', 'focus after Start');
let st = await S();
check(st.phaseDuration === 20 * 60000, 'focus uses 20 min default');
const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
check(badge === '20m', 'toolbar badge shows minutes', badge);
const alarms = (await sw.evaluate(() => chrome.alarms.getAll())).map(a => a.name).sort();
check(alarms.includes('focus-end') && alarms.includes('focus-warning') && alarms.includes('badge-tick'), 'focus alarms scheduled', alarms.join(','));
await game.bringToFront();

// 3. Warning → notification
await fire('focus-warning');
await waitFor(async () => (await S()).status === 'focus-warning', 'warning');
await sleep(300);
let notes = await sw.evaluate(() => chrome.notifications.getAll());
check('pomofomo-warning' in notes, 'warning notification shown');

// 4. Snooze (from the timer tab)
await timer.bringToFront();
await sleep(400);
check(await timer.evaluate(() => !document.getElementById('btnSnooze').hidden), 'snooze button visible in warning');
await timer.click('#btnSnooze');
await waitFor(async () => (await S()).snoozeUsed, 'snooze');
st = await S();
check(st.status === 'focus' && st.phaseDuration === 25 * 60000, 'snooze adds 5 min and returns to focus');
// The SW clears the notification after writing state, so wait for it
if (await waitFor(async () => !('pomofomo-warning' in await sw.evaluate(() => chrome.notifications.getAll())), 'warning notification cleared by snooze')) {
  check(true, 'warning notification cleared by snooze');
}
await sleep(300);
check(await timer.evaluate(() => document.getElementById('btnSnooze').hidden), 'snooze button hidden after use');

// 5. Focus ends → break, timer tab grabs focus
await game.bringToFront();
await sleep(300);
await fire('snooze-end');
await waitFor(async () => (await S()).status === 'break', 'break');
await sleep(800);
let active = (await sw.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true })))[0];
check(active?.url?.startsWith(TIMER), 'timer tab activated at break start', active?.url);
notes = await sw.evaluate(() => chrome.notifications.getAll());
check('pomofomo-break' in notes, 'break notification shown');
st = await S();
check(st.logs.at(-1).type === 'focus' && st.logs.at(-1).snoozed === true, 'focus logged with snooze flag');
await sleep(1500);
await timer.screenshot({ path: `${out}-02-break.png` });
check(await timer.evaluate(() => !document.getElementById('breakCard').hidden), 'break card visible');
const idea1 = await timer.evaluate(() => document.getElementById('ideaTitle').textContent);
await timer.click('#btnIdea');
const idea2 = await timer.evaluate(() => document.getElementById('ideaTitle').textContent);
check(idea1 && idea2 && idea1 !== idea2, 'Another idea changes the idea', `${idea1} → ${idea2}`);

// 6. Kid sneaks back to the game → interrupted + one nudge
const gameTabId = (await sw.evaluate(() => chrome.tabs.query({}))).find(t => t.title === 'Game').id;
await sw.evaluate(id => chrome.tabs.update(id, { active: true }), gameTabId);
await waitFor(async () => (await S()).breakInterrupted === true, 'break interrupted');
await sleep(300);
notes = await sw.evaluate(() => chrome.notifications.getAll());
check('pomofomo-nudge' in notes, 'nudge notification shown');
await timer.bringToFront();
await sleep(600);
const hint = await timer.evaluate(() => document.getElementById('rewardHintText').textContent);
check(/no book/i.test(hint), 'reward hint reflects the lost book', hint);
await timer.screenshot({ path: `${out}-03-break-lost.png` });

// 7. Break ends naturally → round 2, logged as interrupted, no gem
await fire('break-end');
await waitFor(async () => (await S()).status === 'focus', 'focus round 2');
st = await S();
check(st.sessionNumber === 2, 'advanced to round 2');
check(st.logs.at(-1).type === 'shortBreak' && st.logs.at(-1).interrupted === true, 'interrupted break logged');
await sleep(400);
check((await S()).shelf.length === 0, 'nothing on the bookcase for an interrupted break');
check(await timer.evaluate(() => document.getElementById('hoardCount').textContent) === '0', 'bookcase chip shows 0');

// 8. A full break → gem + toast
await timer.evaluate(() => chrome.runtime.sendMessage({ type: 'SKIP' }));
await waitFor(async () => (await S()).status === 'break', 'break 2');
await sleep(800);
await fire('break-end');
await waitFor(async () => (await S()).status === 'focus', 'focus round 3');
await sleep(700);
st = await S();
check(st.shelf.length === 1 && st.shelf[0].k === 'book', 'full break puts a book on the bookcase');
check(await timer.evaluate(() => document.getElementById('hoardCount').textContent) === '1', 'bookcase chip shows 1');
check(await timer.evaluate(() => document.getElementById('toast').classList.contains('is-shown')), 'reward toast shown');
await timer.screenshot({ path: `${out}-04-reward.png` });
await timer.click('#hoard');
await sleep(1200);
check(await timer.evaluate(() => document.getElementById('shelf').open && document.querySelectorAll('#shelfCase .bk-item').length === 1), 'bookcase dialog shows the book');
await timer.screenshot({ path: `${out}-04b-bookcase.png` });
await timer.click('#btnShelfClose');
await sleep(300);

// Easter egg: typing "spoons" brings Otho, whose full breaks earn spoons
await timer.keyboard.type('spoons');
await sleep(800);
check((await sw.evaluate(() => chrome.storage.sync.get('timerCharacter'))).timerCharacter === 'otho', 'typing "spoons" switches to Otho');
check((await S()).othoUnlocked === true, 'Otho unlock saved');
await timer.screenshot({ path: `${out}-04c-otho.png` });

// 9. Round 3 ends → long break
await timer.evaluate(() => chrome.runtime.sendMessage({ type: 'SKIP' }));
await waitFor(async () => (await S()).status === 'longBreak', 'long break after round 3');
st = await S();
check(st.phaseDuration === 15 * 60000, 'long break uses 15 min');

// 10. Pause / resume
await timer.evaluate(() => chrome.runtime.sendMessage({ type: 'PAUSE' }));
await waitFor(async () => (await S()).isPaused, 'paused');
const pausedAlarms = (await sw.evaluate(() => chrome.alarms.getAll())).map(a => a.name);
check(pausedAlarms.length === 0, 'pause clears alarms', pausedAlarms.join(','));
await sleep(500);
await timer.screenshot({ path: `${out}-05-paused.png` });
await timer.evaluate(() => chrome.runtime.sendMessage({ type: 'RESUME' }));
await waitFor(async () => !(await S()).isPaused, 'resumed');
check((await sw.evaluate(() => chrome.alarms.getAll())).some(a => a.name === 'break-end'), 'resume reschedules break-end');

// 11. Long break ends → back to round 1, with a spoon
await fire('break-end');
await waitFor(async () => (await S()).status === 'focus' && (await S()).sessionNumber === 1, 'cycle restarts at round 1');
st = await S();
check(st.shelf.length === 2 && st.shelf[1].k === 'spoon', 'Otho\'s full break adds a spoon');

// 12. Stop
await timer.evaluate(() => chrome.runtime.sendMessage({ type: 'STOP' }));
await waitFor(async () => (await S()).status === 'idle', 'idle after stop');
check(await sw.evaluate(() => chrome.action.getBadgeText({})) === '', 'badge cleared at idle');
check((await S()).shelf.length === 2, 'bookcase survives Stop');

// 13. Closing the timer tab brings it back
const timerId = (await sw.evaluate(() => chrome.tabs.query({}))).find(t => t.url.startsWith('chrome-extension')).id;
await sw.evaluate(id => chrome.tabs.remove(id), timerId);
await sleep(1800);
const reopened = (await sw.evaluate(() => chrome.tabs.query({}))).filter(t => t.url.startsWith('chrome-extension') || t.pendingUrl?.startsWith('chrome-extension'));
check(reopened.length === 1 && reopened[0].pinned, 'timer tab recreated and pinned after close');
timer = await (await browser.waitForTarget(t => t.url().startsWith(TIMER) && t.type() === 'page')).page();
await timer.setViewport({ width: 1280, height: 760 });

// 14. Popup renders with no errors
const popup = await browser.newPage();
popup.on('pageerror', e => errors.push(`[popup pageerror] ${e.message}`));
popup.on('console', m => { if (m.type() === 'error') errors.push(`[popup] ${m.text()}`); });
await popup.setViewport({ width: 340, height: 600 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await sleep(1000);
check(await popup.evaluate(() => document.getElementById('statRounds').textContent) === '3', 'popup counts 3 rounds this week');
await popup.click('#btnView');
await sleep(500);
await popup.click('.stepper[data-key="focusMinutes"] [data-dir="1"]');
await sleep(400);
check((await sw.evaluate(() => chrome.storage.sync.get('focusMinutes'))).focusMinutes === 25, 'stepper saves focus minutes');
check(await popup.evaluate(() => !document.getElementById('buddyOtho').hidden), 'Otho shows in the picker once unlocked');
await popup.screenshot({ path: `${out}-06-popup-settings.png`, fullPage: true });
await popup.click('label.buddy:nth-child(3)');
await sleep(800);
check((await sw.evaluate(() => chrome.storage.sync.get('timerCharacter'))).timerCharacter === 'wizard', 'buddy picker saves Yumyumnia');
await popup.type('#userName', 'Sam');
await sleep(800);
check((await sw.evaluate(() => chrome.storage.sync.get('userName'))).userName === 'Sam', 'kid name saved');
await sleep(500);
const bubble = await timer.evaluate(() => document.getElementById('bubble').textContent);
check(/Sam/.test(bubble), 'buddy greets the kid by name', bubble);
await timer.screenshot({ path: `${out}-07-wizard-idle.png` });

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNo console errors.');
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);

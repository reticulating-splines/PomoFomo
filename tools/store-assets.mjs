// Chrome Web Store assets captured from the real extension: five 1280×800
// screenshots and the 128px store icon (96px art, 16px transparent padding).
// Writes into store/. Run with `npm run store` (which also makes the promo tiles).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launchExtension, outDir as scratchDir, sleep } from './lib.mjs';

const extDir = ROOT;
const outDir = path.join(ROOT, 'store');
const scratch = scratchDir('store');

const { browser, base } = await launchExtension(extDir);
await sleep(800);

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(`${base}/timer/timer.html`);
await sleep(600);

// A believable history: two weeks of rounds and a stocked bookcase
await page.evaluate(() => {
  const now = Date.now(), H = 3600000, D = 24 * H;
  const logs = [], shelf = [];
  const perDay = [3, 4, 2, 0, 5, 3, 4, 3, 2, 4, 0, 3, 5, 2];
  perDay.forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      const end = now - (13 - i) * D - k * 1.5 * H - 2 * H;
      logs.push({ type: 'focus', startedAt: end - 20 * 60000, endedAt: end, completedNaturally: true });
      const full = (i + k) % 5 !== 0;
      logs.push({ type: 'shortBreak', startedAt: end, endedAt: end + 5 * 60000, completedNaturally: true, interrupted: !full });
      if (full) shelf.push({ k: i < 6 ? 'book' : (k % 3 === 2 ? 'fireball' : 'book'), t: end + 5 * 60000 });
    }
  });
  return chrome.storage.local.set({ logs, shelf, introSeen: true });
});

async function setState(st, wait = 2800) {
  await page.evaluate(s => {
    const x = { ...s };
    if (x.elapsedMin != null) { x.startTime = Date.now() - x.elapsedMin * 60000; delete x.elapsedMin; }
    return chrome.storage.local.set(x);
  }, st);
  await sleep(wait);
}
async function setSettings(s) { await page.evaluate(v => chrome.storage.sync.set(v), s); await sleep(900); }
const shot = name => page.screenshot({ path: path.join(outDir, name) });

// 1. Focus with Ember
await setSettings({ timerCharacter: 'dragon', userName: '' });
await page.reload(); await sleep(1200);
await setState({ status: 'focus', sessionNumber: 2, elapsedMin: 7.6, phaseDuration: 20 * 60000, isPaused: false, breakInterrupted: false });
await shot('screenshot-1-focus.png');

// 2. Break with the idea card (Ember's signature idea)
await setState({ status: 'break', sessionNumber: 2, elapsedMin: 1.2, phaseDuration: 5 * 60000 }, 3200);
await shot('screenshot-2-break.png');

// 3. Two-minute heads-up with Page
await setSettings({ timerCharacter: 'book' });
await setState({ status: 'focus-warning', sessionNumber: 3, elapsedMin: 18.4, phaseDuration: 20 * 60000, snoozeUsed: false }, 3000);
await shot('screenshot-3-heads-up.png');

// 4. The bookcase, with Yumyumnia
await setSettings({ timerCharacter: 'wizard' });
await setState({ status: 'focus', sessionNumber: 1, elapsedMin: 4, phaseDuration: 20 * 60000 }, 2400);
await page.click('#hoard');
await sleep(1800);
await shot('screenshot-4-bookcase.png');
await page.evaluate(() => document.getElementById('shelf').close());

// 5. Popup over the timer tab
await setState({ status: 'longBreak', sessionNumber: 3, elapsedMin: 3, phaseDuration: 15 * 60000 }, 3200);
const bg = path.join(scratch, 'store-bg.png');
await page.screenshot({ path: bg });
const pop = await browser.newPage();
await pop.setViewport({ width: 340, height: 580, deviceScaleFactor: 2 });
await pop.goto(`${base}/popup/popup.html`);
await sleep(1500);
const popPng = path.join(scratch, 'store-popup.png');
await pop.screenshot({ path: popPng });
await pop.close();

const comp = await browser.newPage();
await comp.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
await comp.setContent(`<html><body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative">
  <img src="${b64(bg)}" style="position:absolute;inset:0;width:1280px;height:800px;filter:blur(3px) saturate(0.9);transform:scale(1.02)">
  <div style="position:absolute;inset:0;background:rgba(42,35,66,0.18)"></div>
  <img src="${b64(popPng)}" style="position:absolute;top:56px;left:50%;transform:translateX(-50%);width:400px;height:682px;border-radius:14px;box-shadow:0 4px 10px rgba(42,35,66,.12),0 30px 70px rgba(42,35,66,.35)">
</body></html>`);
await sleep(500);
await comp.screenshot({ path: path.join(outDir, 'screenshot-5-popup.png') });

// Store icon: 96px artwork centred on a transparent 128px canvas
const icon = await browser.newPage();
await icon.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });
const svgUri = `data:image/svg+xml;base64,${fs.readFileSync(path.join(extDir, 'assets/icons/icon.svg')).toString('base64')}`;
await icon.setContent(`<html><body style="margin:0;background:transparent">
  <img src="${svgUri}" width="96" height="96" style="position:absolute;left:16px;top:16px">
</body></html>`);
await sleep(600);
await icon.screenshot({ path: path.join(outDir, 'icon-128.png'), omitBackground: true });

await browser.close();
console.log('done');

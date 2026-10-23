// Marquee promo tile (1400×560) for the Chrome Web Store: the real scenery and characters with
// the wordmark. Writes into store/. Run with `npm run store`.
import path from 'node:path';
import { ROOT, launchExtension, sleep } from './lib.mjs';

const out = path.join(ROOT, 'store', 'promo-marquee-1400x560.png');
const { browser, base } = await launchExtension(ROOT);
await sleep(800);
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 });
await page.goto(`${base}/timer/timer.html`);
await sleep(400);
await page.evaluate(() => chrome.storage.local.set({ introSeen: true, status: 'break', startTime: Date.now() - 60000, phaseDuration: 300000 }));
await page.reload();
await sleep(1200);
await page.evaluate(async () => {
  for (const sel of ['.topbar', '.stage', '.footer', '.toast']) document.querySelector(sel).style.display = 'none';
  document.body.style.setProperty('--sun-x', '91%');
  document.body.style.setProperty('--sun-y', '20%');
  const svg = async file => {
    const text = await (await fetch(chrome.runtime.getURL(file))).text();
    const holder = document.createElement('div');
    holder.innerHTML = text;
    return holder.firstElementChild;
  };
  const buddy = async (file, prefix, state, size, left, bottom) => {
    const el = await svg(file);
    el.classList.add(`${prefix}--${state}`);
    el.style.cssText = `position:fixed;left:${left}px;bottom:${bottom}px;width:${size}px;height:${size}px;overflow:visible`;
    document.body.append(el);
  };
  await buddy('characters/page.svg', 'page', 'idle', 230, 735, 58);
  await buddy('characters/yumyumnia.svg', 'yumyumnia', 'idle', 240, 1110, 52);
  await buddy('characters/ember.svg', 'ember', 'idle', 300, 885, 36);
  const words = document.createElement('div');
  words.style.cssText = 'position:fixed;left:96px;top:150px;width:600px';
  words.innerHTML = `<div style="font-family:var(--font-display);font-weight:600;font-size:96px;line-height:1;color:var(--ink)">PomoFomo</div>
    <div style="margin-top:20px;font-weight:800;font-size:30px;line-height:1.35;color:var(--ink-soft)">A break timer for kids.<br>Focus. Then take the break.</div>`;
  document.body.append(words);
});
await sleep(1500);
await page.screenshot({ path: out });
await browser.close();
console.log('done');

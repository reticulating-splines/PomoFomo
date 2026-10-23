// Small promo tile (440×280) for the Chrome Web Store: the real scenery and characters with
// the wordmark. Writes into store/. Run with `npm run store`.
import path from 'node:path';
import { ROOT, launchExtension, sleep } from './lib.mjs';

const out = path.join(ROOT, 'store', 'promo-small-440x280.png');
const { browser, base } = await launchExtension(ROOT);
await sleep(800);
const page = await browser.newPage();
await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
await page.goto(`${base}/timer/timer.html`);
await sleep(400);
await page.evaluate(() => chrome.storage.local.set({ introSeen: true, status: 'idle' }));
await page.reload();
await sleep(1500);
await page.evaluate(() => {
  document.querySelector('.topbar').style.display = 'none';
  document.querySelector('.stage').style.display = 'none';
  document.querySelector('.footer').style.display = 'none';
  document.body.style.setProperty('--sun-x', '84%');
  document.body.style.setProperty('--sun-y', '22%');
  const art = document.querySelector('#characterContainer svg').cloneNode(true);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;gap:6px;padding:0 24px 30px 18px;';
  const pic = document.createElement('div');
  pic.style.cssText = 'width:168px;height:168px;flex:none;';
  art.style.cssText = 'width:100%;height:100%;overflow:visible';
  pic.append(art);
  const words = document.createElement('div');
  words.innerHTML = `<div style="font-family:var(--font-display);font-weight:600;font-size:40px;line-height:1;color:var(--ink)">PomoFomo</div>
    <div style="margin-top:10px;font-weight:800;font-size:16px;line-height:1.3;color:var(--ink-soft)">A break timer for kids.<br>Focus. Then take the break.</div>`;
  wrap.append(pic, words);
  document.body.append(wrap);
});
await sleep(1200);
await page.screenshot({ path: out });
await browser.close();
console.log('done');

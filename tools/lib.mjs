// Shared helpers for the dev scripts: launch Chrome for Testing (installed
// by puppeteer) with the unpacked extension loaded, and find its id.

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tools', 'out'); // scratch output, git-ignored

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function outDir(...parts) {
  const dir = path.join(OUT, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Launch headless Chrome with the extension at `extDir` (default: the repo). */
export async function launchExtension(extDir = ROOT) {
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [path.resolve(extDir)],
    args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
  });
  const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker');
  const extId = new URL(swTarget.url()).host;
  return { browser, swTarget, extId, base: `chrome-extension://${extId}` };
}

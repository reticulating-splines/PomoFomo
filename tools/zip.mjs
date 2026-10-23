// Builds the Chrome Web Store upload: dist/PomoFomo-<version>.zip with only
// the files the extension needs (no docs, store art, dev tools or .DS_Store).
// Run with `npm run zip`; `npm run release` also tests the unzipped result.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

// Everything the extension loads at runtime
export const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'assets',
  'characters',
  'favicon',
  'popup',
  'shared',
  'sounds',
  'timer',
];

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const dist = path.join(ROOT, 'dist');
const zipPath = path.join(dist, `PomoFomo-${version}.zip`);

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, ...EXTENSION_FILES, '-x', '*.DS_Store'], { cwd: ROOT });

const kb = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`Built ${path.relative(ROOT, zipPath)} (${kb} KB, version ${version})`);

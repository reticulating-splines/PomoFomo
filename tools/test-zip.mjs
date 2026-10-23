// Unzips dist/PomoFomo-<version>.zip into tools/out/zip-check and runs the
// end-to-end test against that copy, so what we upload is what we tested.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, OUT } from './lib.mjs';

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const zipPath = path.join(ROOT, 'dist', `PomoFomo-${version}.zip`);
const target = path.join(OUT, 'zip-check');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
execFileSync('unzip', ['-q', zipPath, '-d', target]);
console.log(`Testing ${path.relative(ROOT, zipPath)} unzipped to ${path.relative(ROOT, target)}`);
execFileSync('node', [path.join(ROOT, 'tools', 'e2e.mjs'), target], { stdio: 'inherit' });

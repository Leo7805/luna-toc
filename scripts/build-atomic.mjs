#!/usr/bin/env node
// scripts/build-atomic.mjs
//
// Atomic build:
//   1. Vite writes to dist.new/  (dist/ untouched → Chrome keeps loading old version)
//   2. rm -rf dist.old/          (cleanup previous old)
//   3. renameSync('dist', 'dist.old')   (POSIX-atomic directory rename)
//   4. renameSync('dist.new', 'dist')   (POSIX-atomic directory rename)
//
// At no observable moment can Chrome see a half-written state.

import { execSync } from 'node:child_process';
import { renameSync, rmSync, existsSync, statSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
process.chdir(ROOT);

const step = (n, msg) => console.log(`[${n}/4] ${msg}`);

step(1, 'Building to dist.new/ ...');
execSync('npx vite build --outDir dist.new', { stdio: 'inherit' });

step(2, 'Cleaning leftover dist.old/ if present ...');
if (existsSync('dist.old')) {
  rmSync('dist.old', { recursive: true, force: true });
}

step(3, 'Atomic rename dist/ → dist.old/ ...');
if (!existsSync('dist')) {
  console.warn('  (dist/ did not exist — skipping first rename)');
} else {
  renameSync('dist', 'dist.old');
}

step(4, 'Atomic rename dist.new/ → dist/ ...');
if (!existsSync('dist.new')) {
  console.error('dist.new/ was not produced by vite build — aborting');
  process.exit(1);
}
renameSync('dist.new', 'dist');

// Schedule async cleanup of dist.old/ so subsequent builds keep working.
setTimeout(() => {
  if (existsSync('dist.old')) {
    rmSync('dist.old', { recursive: true, force: true });
  }
}, 30_000);

console.log('done. dist/ now holds the new build atomically.');

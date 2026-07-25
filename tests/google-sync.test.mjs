#!/usr/bin/env node
/**
 * google-sync.test.mjs — the Gmail sync cursor file (google-sync.json) must
 * round-trip through readSync/writeSync without losing fields.
 *
 * Regression guard: readSync once stripped `lastPreviewAt` from its returned
 * object, with two consequences. checkHealth never saw "last checked …" (it read
 * the stripped object), and worse, any OTHER writer — a bounce apply, a reply log —
 * does readSync → mutate → writeSync, so the stripped object it wrote back silently
 * clobbered the freshness stamp to absent. Both are the "a valid write that quietly
 * drops a field" class this repo is paranoid about, so lock it here.
 *
 * Uses a temp TJK_DATA_DIR (invented data, OS temp dir) so the real cursor file is
 * never touched. google.mjs is imported dynamically AFTER the env is set so
 * config.mjs resolves GOOGLE_SYNC_PATH into the temp dir.
 *
 * Run: node tests/google-sync.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-sync-'));
process.env.TJK_DATA_DIR = tmp;
const syncPath = path.join(tmp, 'google-sync.json');

const { readSync, writeSync } = await import('../dashboard-web/server/lib/google.mjs');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('google-sync.test.mjs');

// Seed a cursor with a freshness stamp + one handled reply + a seen id.
const stamp = '2026-07-15T23:17:11.209Z';
fs.writeFileSync(syncPath, JSON.stringify({
  seenMessageIds: ['a'], lastCheckedAt: null,
  handledReplies: { m1: { action: 'log', appId: 5 } }, lastPreviewAt: stamp,
}) + '\n');

const s1 = readSync();
check(s1.lastPreviewAt === stamp, 'readSync surfaces lastPreviewAt (not stripped)');
check(s1.handledReplies.m1 && s1.seenMessageIds[0] === 'a', 'readSync still returns the other cursor fields');

// An UNRELATED write (logging another reply) must preserve the freshness stamp.
s1.handledReplies.m2 = { action: 'dismiss', appId: null };
writeSync(s1);
const s2 = readSync();
check(s2.lastPreviewAt === stamp, 'an unrelated writeSync round-trip preserves lastPreviewAt');
check(!!s2.handledReplies.m2, 'the unrelated change was written');

// A brand-new cursor (no file yet) defaults cleanly, lastPreviewAt included.
fs.rmSync(syncPath, { force: true });
const s3 = readSync();
check(s3.lastPreviewAt === null && Array.isArray(s3.seenMessageIds) && s3.seenMessageIds.length === 0,
  'missing cursor file → clean defaults incl. lastPreviewAt:null');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

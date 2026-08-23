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
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox("sync");
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

// The SAME regression this suite was written for, one key later. notRelatedSenders
// (the "stop surfacing this sender" list) was added after readSync's whitelist and
// was therefore dropped on every read, so the route wrote it and the next sweep's
// freshness stamp wiped it. The live file held 40 recorded not-related actions and
// 1 surviving sender. A read-modify-write helper must not decide which keys exist.
fs.writeFileSync(syncPath, JSON.stringify({
  seenMessageIds: ['a'], lastCheckedAt: null, handledReplies: {}, lastPreviewAt: stamp,
  notRelatedSenders: { 'noreply@example.com': { date: '2026-08-01' } },
  someFutureKey: { kept: true },
}) + '\n');

const n1 = readSync();
check(!!n1.notRelatedSenders['noreply@example.com'], 'readSync surfaces notRelatedSenders');
check(n1.someFutureKey && n1.someFutureKey.kept === true, 'readSync preserves a key it does not know about');

// The exact live failure: a freshness-stamp write must not clobber the suppression list.
n1.lastPreviewAt = new Date().toISOString();
writeSync(n1);
const n2 = readSync();
check(!!n2.notRelatedSenders['noreply@example.com'], 'a freshness-stamp round-trip preserves notRelatedSenders');
check(!!n2.someFutureKey, 'a freshness-stamp round-trip preserves an unknown key');

// A null in the file must not defeat a shape guarantee callers depend on.
fs.writeFileSync(syncPath, JSON.stringify({ handledReplies: null, notRelatedSenders: null }) + '\n');
const n3 = readSync();
check(n3.handledReplies && typeof n3.handledReplies === 'object', 'a null handledReplies still reads as an object');
check(n3.notRelatedSenders && typeof n3.notRelatedSenders === 'object', 'a null notRelatedSenders still reads as an object');

// A brand-new cursor (no file yet) defaults cleanly, lastPreviewAt included.
fs.rmSync(syncPath, { force: true });
const s3 = readSync();
check(s3.lastPreviewAt === null && Array.isArray(s3.seenMessageIds) && s3.seenMessageIds.length === 0,
  'missing cursor file → clean defaults incl. lastPreviewAt:null');
check(s3.notRelatedSenders && Object.keys(s3.notRelatedSenders).length === 0,
  'missing cursor file → notRelatedSenders defaults to an empty object');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

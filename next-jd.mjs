#!/usr/bin/env node
// next-jd.mjs — issue the next JD number from a PERSISTENT, monotonic counter.
//
// WHY THIS EXISTS:
// Report numbers and tracker ids were each computed as "max of what currently
// exists + 1". reports/ gets pruned/archived between batches while
// data/applications.md is never pruned, so the report max RESET low and the
// same number got reused across different companies (three different "#100"
// reports, etc.), and the report number drifted away from the tracker id
// (report #109 == tracker #745). A single counter that only ever increases
// removes both failure modes: every JD gets ONE number, used for both its
// report filename and its tracker row, and no number is ever reused — even
// after old reports are deleted.
//
// USAGE:
//   node next-jd.mjs          issue + print the next number            (e.g. 862)
//   node next-jd.mjs --pad    issue + print zero-padded 3-wide         (e.g. 862)
//   node next-jd.mjs --peek   print the highest issued number, no issue
//
// The counter lives in data/jd-counter.txt (user layer, gitignored). On first
// use it self-initializes from the highest number already present in
// applications.md and reports/, so it never collides with existing data.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const COUNTER = path.join(ROOT, 'data', 'jd-counter.txt');
const APPS = path.join(ROOT, 'data', 'applications.md');
const REPORTS = path.join(ROOT, 'reports');
const MERGED_TSV_DIR = path.join(ROOT, 'batch', 'tracker-additions', 'merged');

function maxTrackerId() {
  if (!fs.existsSync(APPS)) return 0;
  let max = 0;
  for (const line of fs.readFileSync(APPS, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = (line.split('|')[1] || '').trim();
    if (/^\d+$/.test(first)) max = Math.max(max, Number(first));
  }
  return max;
}

function maxReportNum() {
  if (!fs.existsSync(REPORTS)) return 0;
  let max = 0;
  for (const f of fs.readdirSync(REPORTS)) {
    const m = f.match(/^(\d+)-/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// Rows pruned from applications.md still leave their merged TSV behind in
// batch/tracker-additions/merged/, so a number can be "used" there without
// showing up in maxTrackerId() or maxReportNum() (e.g. its report was deleted
// too). Scan those filenames as a third floor so a stale archived number is
// never reissued.
function maxMergedTsvNum() {
  if (!fs.existsSync(MERGED_TSV_DIR)) return 0;
  let max = 0;
  for (const f of fs.readdirSync(MERGED_TSV_DIR)) {
    const m = f.match(/^(\d+)-/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// The highest number ever issued. Prefer the persisted counter; if it is
// missing, derive a safe floor from existing data so we never reuse a live id.
export function peekJd() {
  if (fs.existsSync(COUNTER)) {
    const n = parseInt(fs.readFileSync(COUNTER, 'utf8').trim(), 10);
    if (Number.isFinite(n)) return Math.max(n, maxTrackerId(), maxReportNum(), maxMergedTsvNum());
  }
  return Math.max(maxTrackerId(), maxReportNum(), maxMergedTsvNum());
}

// Issue (reserve) the next number and persist it.
export function issueJd() {
  const next = peekJd() + 1;
  fs.mkdirSync(path.dirname(COUNTER), { recursive: true });
  fs.writeFileSync(COUNTER, String(next) + '\n');
  return next;
}

// CLI entry (only when run directly, not when imported).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--peek')) {
    process.stdout.write(String(peekJd()) + '\n');
  } else {
    const n = issueJd();
    process.stdout.write((args.includes('--pad') ? String(n).padStart(3, '0') : String(n)) + '\n');
  }
}

#!/usr/bin/env node
// Check every Evaluated tracker entry and optionally move confirmed dead or
// non-actionable postings to Passed. Dry run is the default.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { withPassedReason } from './lib/passed.mjs';
import { urlForRow } from './lib/identity.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const APPS = join(DATA_DIR, 'applications.md');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const scoreThreshold = args.includes('--score') ? parseFloat(args[args.indexOf('--score') + 1]) : 0;
const confirmDelayArg = args.includes('--confirm-delay') ? Number(args[args.indexOf('--confirm-delay') + 1]) : 20;
if (!Number.isFinite(confirmDelayArg) || confirmDelayArg < 0) {
  console.error('--confirm-delay must be a non-negative number of seconds.');
  process.exit(2);
}
const confirmDelayMs = confirmDelayArg * 1000;

if (!existsSync(APPS)) {
  console.log('All checked entries are still live (no applications.md yet).');
  process.exit(0);
}

const baseText = readFileSync(APPS, 'utf8');
const lines = baseText.split('\n');
const targets = [];
for (let idx = 0; idx < lines.length; idx++) {
  const line = lines[idx];
  const row = parseTrackerLine(line);
  if (!row || row.status !== 'Evaluated') continue;
  const score = parseFloat((String(row.score).match(/[\d.]+/) || [])[0]) || 0;
  if (score < scoreThreshold) continue;
  if (/\[self-sourced\]|\[referral:|\[cowork\]/i.test(row.notes || '')) continue;
  const url = urlForRow(row, __dirname);
  if (!url || !/^https?:\/\//.test(url) || /^https?:\/\/(www\.)?example\.com/.test(url)) continue;
  targets.push({ id: row.num, company: row.company, role: row.role, score, url, lineIdx: idx, line });
}

if (targets.length === 0) {
  console.log('No Evaluated entries with verifiable URLs to check.');
  process.exit(0);
}

function runLiveness(checkTargets) {
  let output;
  try {
    output = execFileSync('node', [join(__dirname, 'check-liveness.mjs'), ...checkTargets.map(t => t.url)], {
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    output = err.stdout || '';
  }
  const outLines = output.split('\n');
  return checkTargets.map(t => {
    const statusLine = outLines.find(line => line.includes(t.url));
    if (!statusLine) return { ...t, livenessStatus: 'unknown' };
    if (/\bactive\b/i.test(statusLine)) return { ...t, livenessStatus: 'active' };
    if (/\bexpired\b/i.test(statusLine)) return { ...t, livenessStatus: 'expired' };
    if (/\buncertain\b/i.test(statusLine)) return { ...t, livenessStatus: 'uncertain' };
    return { ...t, livenessStatus: 'unknown' };
  });
}

console.log(`Checking ${targets.length} Evaluated entries for liveness...\n`);
const expired = runLiveness(targets)
  .filter(t => t.livenessStatus === 'expired' || t.livenessStatus === 'uncertain');

if (expired.length === 0) {
  console.log('All checked entries are still live.');
  process.exit(0);
}

console.log(`${expired.length} entries point to dead or non-actionable postings:\n`);
console.log('  ID    Score  Status      Company                       Role');
console.log('  ----  -----  ---------   ------------------------       ----');
for (const t of expired) {
  console.log(`  #${String(t.id).padStart(3)}  ${t.score.toFixed(1).padStart(4)}   ${t.livenessStatus.padEnd(9)}   ${t.company.padEnd(28).slice(0,28)}  ${t.role.slice(0, 60)}`);
}

if (!apply) {
  console.log('\nRun with --apply to confirm and flip these to Passed in applications.md');
  process.exit(1);
}

if (confirmDelayMs > 0) {
  console.log(`\nWaiting ${confirmDelayArg} seconds before confirming ${expired.length} liveness verdict${expired.length === 1 ? '' : 's'}...`);
  await new Promise(resolve => setTimeout(resolve, confirmDelayMs));
}

const secondResults = runLiveness(expired);
const secondById = new Map(secondResults.map(t => [t.id, t.livenessStatus]));
const confirmed = expired.filter(t => secondById.get(t.id) === t.livenessStatus);
const unconfirmed = expired.filter(t => secondById.get(t.id) !== t.livenessStatus).map(t => ({
  ...t,
  confirmationStatus: secondById.get(t.id) || 'unknown',
}));

if (unconfirmed.length > 0) {
  console.log('\nUnconfirmed, kept as Evaluated:');
  for (const t of unconfirmed) {
    console.log(`  #${t.id} ${t.company}: first ${t.livenessStatus}, confirmation ${t.confirmationStatus}`);
  }
}

const confirmedIds = new Set(confirmed.map(e => e.id));
const newLines = lines.map(line => {
  const row = parseTrackerLine(line);
  if (!row || !confirmedIds.has(row.num)) return line;
  const found = confirmed.find(e => e.id === row.num);
  const statusLabel = found?.livenessStatus === 'uncertain' ? 'no apply control visible' : 'posting closed/expired';
  const reason = `auto-discarded: ${statusLabel}`;
  return formatTrackerLine({
    ...row,
    status: 'Passed',
    notes: withPassedReason(row.notes ? `${reason}. ${row.notes}` : reason, found?.livenessStatus === 'uncertain' ? 'discarded' : 'posting_closed'),
  });
});

const newText = newLines.join('\n');
if (confirmed.length > 0 && logWritesEnabled(DATA_DIR)) {
  try {
    writeTableText({
      dataDir: DATA_DIR,
      file: 'applications.md',
      baseText,
      newText,
      rowKey: line => {
        const row = parseTrackerLine(line);
        return row ? String(row.num) : null;
      },
      buildEvents: ({ added, changed, removed }) => {
        if (added.length || removed.length) {
          throw new Error('verify-actionable may only change existing tracker rows');
        }
        return changed.map(change => {
          const before = parseTrackerLine(change.previousRaw);
          const after = parseTrackerLine(change.raw);
          return {
            type: 'status_changed',
            application_id: String(after.num),
            occurred_on: localToday(),
            payload: {
              num: after.num,
              company: after.company,
              from: before.status,
              to: after.status,
              reason: 'posting_closed',
              legacy_effects: [change.effect],
            },
          };
        });
      },
    });
  } catch (error) {
    if (error.code === 'RENDER_FAILED') {
      console.warn(`Warning: ${error.message}`);
      console.log(`\nFlipped ${confirmed.length} entries to Passed; ${unconfirmed.length} unconfirmed.`);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
} else if (confirmed.length > 0) {
  writeFileSync(APPS, newText);
}

console.log(`\nFlipped ${confirmed.length} entries to Passed; ${unconfirmed.length} unconfirmed.`);
process.exit(0);

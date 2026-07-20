#!/usr/bin/env node
// verify-actionable.mjs — liveness-check every Evaluated entry in the
// tracker. Anything that comes back "expired" gets auto-flipped to
// Discarded with reason "posting closed". Run before every dashboard
// session to make sure the "Action Required" list is real.
//
// Usage:
//   node verify-actionable.mjs              # check + show what would change
//   node verify-actionable.mjs --apply      # actually flip statuses in applications.md
//   node verify-actionable.mjs --score 4    # only verify entries with score >= 4 (faster)
//
// Uses check-liveness.mjs under the hood. Exit code 0 if all clean,
// 1 if anything stale was found.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS = join(__dirname, 'data/applications.md');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const scoreThreshold = args.includes('--score') ? parseFloat(args[args.indexOf('--score') + 1]) : 0;

// Parse Evaluated entries with score >= threshold
// Fresh install has no tracker yet — nothing to verify, so exit clean.
if (!existsSync(APPS)) {
  console.log('All checked entries are still live (no applications.md yet).');
  process.exit(0);
}
const lines = readFileSync(APPS, 'utf8').split('\n');
const targets = [];
for (let idx = 0; idx < lines.length; idx++) {
  const line = lines[idx];
  if (!line.startsWith('|') || line.includes('---')) continue;
  const parts = line.split('|').map(p => p.trim());
  if (parts.length < 10) continue;
  const [_, id, date, company, role, scoreStr, status, pdf, reportCell, notes] = parts;
  if (status !== 'Evaluated') continue;
  const score = parseFloat((scoreStr.match(/[\d.]+/) || [])[0]) || 0;
  if (score < scoreThreshold) continue;
  // Skip self-sourced/referral — user explicitly wants those
  if (/\[self-sourced\]|\[referral:|\[cowork\]/i.test(notes)) continue;
  // Extract URL from report file
  const reportMatch = reportCell.match(/\((reports\/[^)]+)\)/);
  if (!reportMatch) continue;
  const reportPath = join(__dirname, reportMatch[1]);
  let url = null;
  try {
    const reportText = readFileSync(reportPath, 'utf8');
    // Match URL up to first whitespace OR open-paren (some reports append
    // a parenthetical note like "(JD sourced via WebSearch)" to the URL line)
    const m = reportText.match(/^\*\*URL:\*\*\s*(https?:\/\/[^\s()]+)/m);
    if (m) url = m[1];
  } catch {}
  if (!url || /^https?:\/\/(www\.)?example\.com/.test(url)) continue;
  targets.push({ id: parseInt(id), company, role, score, url, lineIdx: idx, line });
}

if (targets.length === 0) {
  console.log('No Evaluated entries with verifiable URLs to check.');
  process.exit(0);
}

console.log(`Checking ${targets.length} Evaluated entries for liveness...\n`);

// Run check-liveness.mjs on the batch of URLs
const urls = targets.map(t => t.url);
let livenessOutput;
try {
  livenessOutput = execFileSync('node', [join(__dirname, 'check-liveness.mjs'), ...urls], {
    encoding: 'utf8',
    timeout: 5 * 60 * 1000, // 5 min max
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  // Non-zero exit = some URLs flagged; output is still on stdout
  livenessOutput = err.stdout || '';
}

// Parse liveness output — check-liveness.mjs prints "<icon> <status>    <url>"
// per URL (active / expired / uncertain). We treat both "expired" and
// "uncertain" as actionable: expired = dead link, uncertain = no apply
// button visible (most likely a listing page, not a real posting).
const expired = [];
const outLines = livenessOutput.split('\n');
for (const t of targets) {
  // Find the line containing the URL — the status word is on the same line, before the URL
  const statusLine = outLines.find(l => l.includes(t.url));
  if (!statusLine) continue;
  // Extract status word: position 0-3 is icon+space, then status word
  if (/\b(expired|uncertain)\b/i.test(statusLine) && !/\bactive\b/i.test(statusLine)) {
    expired.push({ ...t, livenessStatus: /expired/i.test(statusLine) ? 'expired' : 'uncertain' });
  }
}

if (expired.length === 0) {
  console.log('✅ All checked entries are still live.');
  process.exit(0);
}

console.log(`⚠️  ${expired.length} entries point to dead or non-actionable postings:\n`);
console.log('  ID    Score  Status      Company                       Role');
console.log('  ----  -----  ---------   ------------------------       ----');
for (const t of expired) {
  console.log(`  #${String(t.id).padStart(3)}  ${t.score.toFixed(1).padStart(4)}   ${t.livenessStatus.padEnd(9)}   ${t.company.padEnd(28).slice(0,28)}  ${t.role.slice(0, 60)}`);
}

if (!apply) {
  console.log('\nRun with --apply to flip these to Discarded in applications.md');
  process.exit(1);
}

// Flip statuses
const expiredIds = new Set(expired.map(e => e.id));
const newLines = lines.map(line => {
  // Read and write through lib/tracker.mjs. Hand-indexing line.split('|') here
  // used the legacy 9-column offsets, so the discard reason was prepended to the
  // Report cell rather than the notes.
  const row = parseTrackerLine(line);
  if (!row || !expiredIds.has(row.num)) return line;
  const found = expired.find(e => e.id === row.num);
  const statusLabel = found?.livenessStatus === 'uncertain' ? 'no apply control visible' : 'posting closed/expired';
  const reason = `auto-discarded: ${statusLabel}`;
  return formatTrackerLine({
    ...row,
    status: 'Discarded',
    notes: row.notes ? `${reason}. ${row.notes}` : reason,
  });
});

writeFileSync(APPS, newLines.join('\n'));
console.log(`\n✅ Flipped ${expired.length} entries to Discarded.`);
process.exit(0);

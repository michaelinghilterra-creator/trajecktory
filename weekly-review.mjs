#!/usr/bin/env node
/**
 * weekly-review.mjs — the weekly review with teeth. Deterministic, no LLM in the
 * counting: it collects the week's leading indicators, checks the floors, appends
 * to data/review-log.json, and engages or lifts the build lock in
 * data/build-lock.json. The lock governs IMPROVEMENT only; repair, data
 * integrity, live-process work, and sub-30-minute unblocks are always
 * allowed. Missing manual data reads "not logged", never zero.
 *
 * Usage:
 *   node weekly-review.mjs            print the report, write the log + lock
 *   node weekly-review.mjs --dry-run  print only, write nothing
 *   node weekly-review.mjs --json     machine-readable output
 *
 * The Friday 12:00 schedule is HANDED to you (the schtasks line below), never
 * registered silently.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runWeeklyReview } from './dashboard-web/server/lib/weekly-run.mjs';
import { KILL } from './dashboard-web/server/lib/review-thresholds.mjs';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const DRY = argv.includes('--dry-run');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The write side (collect → evaluate → upsert the log → decide the lock → persist)
// lives in lib/weekly-run.mjs so this CLI and the dashboard's "Run weekly review"
// button share ONE engine. --dry-run collects and reports but writes nothing.
const { weekStart, weekEnd, metrics, floors, lock } = runWeeklyReview({ now: new Date(), write: !DRY });

if (JSON_OUT) {
  console.log(JSON.stringify({ weekStart, weekEnd, floors, lock, metrics }, null, 2));
  process.exit(0);
}

const fmtFloor = (r) => r.available
  ? `  [${r.met ? 'OK  ' : 'MISS'}] ${r.label}: ${r.value}${r.unit} (floor ${r.floor}${r.unit})`
  : `  [n/a ] ${r.label}: not logged this week (floor ${r.floor}${r.unit})`;

console.log(`\nWeekly review   ${weekStart} to ${weekEnd}${DRY ? '   (dry run, nothing written)' : ''}\n`);
console.log('Floors (the numbers with teeth):');
for (const r of floors.results) console.log(fmtFloor(r));

console.log('\nLeading indicators:');
const li = (label, m) => console.log(`  ${label}: ${m.available ? m.value : 'not logged'}${m.source ? `   (${m.source})` : ''}`);
li('Replies on delivered mail', metrics.replies);
li('Delivered reply rate %', metrics.deliveredReplyRatePct);
li('Screens booked', metrics.screensBooked);
li('Screen objections logged', metrics.objectionsLogged);
li('Unserviced applications (WIP)', metrics.unservicedApplications);

if (lock.locked) {
  console.log(`\nBUILD LOCK ENGAGED: ${lock.reason}`);
  console.log('  Improvement work is locked. Still allowed: break-fix, data integrity, live-process work, sub-30-minute unblocks. Repairs are time-boxed at 2 hours and logged.');
} else if (floors.missed.length) {
  console.log(`\nFlagged: ${floors.missed.length} floor(s) missed this week. One more consecutive outreach-floor miss engages the build lock.`);
} else {
  console.log('\nNo build lock. Outreach floor met or not yet logged.');
}

console.log('\nKill-criteria watch (you judge these, they are not auto-decided):');
for (const k of [KILL.messageWrong, KILL.outboundInert, KILL.wrongDiagnosis]) console.log(`  - ${k.note}`);

const scriptPath = path.join(__dirname, 'weekly-review.mjs');
console.log('\nRun this automatically every Friday at noon by registering it yourself:');
console.log(`  schtasks /Create /SC WEEKLY /D FRI /ST 12:00 /TN trajecktory-weekly-review /TR "node \\"${scriptPath}\\""`);
console.log('');

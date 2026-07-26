#!/usr/bin/env node
/**
 * weekly-review.mjs — the weekly review with teeth. Deterministic, no LLM in the
 * counting: it collects the week's leading indicators, checks the floors, and
 * appends to data/review-log.json. The build-cap gate is no longer decided here:
 * it is the live rolling floor (dashboard-web/server/lib/rolling-floor.mjs), a
 * trailing-5-working-day gate surfaced in Insights > Review. This report freezes
 * the week's numbers and flags missed floors. Missing manual data reads "not
 * logged", never zero.
 *
 * Usage:
 *   node weekly-review.mjs            print the report, write the log
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

// The write side (collect → evaluate → upsert the log → persist) lives in
// lib/weekly-run.mjs so this CLI and the dashboard's "Run weekly review" button
// share ONE engine. --dry-run collects and reports but writes nothing.
const { weekStart, weekEnd, metrics, floors } = runWeeklyReview({ now: new Date(), write: !DRY });

if (JSON_OUT) {
  console.log(JSON.stringify({ weekStart, weekEnd, floors, metrics }, null, 2));
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

if (floors.missed.length) {
  console.log(`\nFlagged: ${floors.missed.length} floor(s) missed this week.`);
}
console.log('\nThe build cap is gated live by the rolling outreach floor (Insights > Review), not by this weekly report.');

console.log('\nKill-criteria watch (you judge these, they are not auto-decided):');
for (const k of [KILL.messageWrong, KILL.outboundInert, KILL.wrongDiagnosis]) console.log(`  - ${k.note}`);

const scriptPath = path.join(__dirname, 'weekly-review.mjs');
console.log('\nRun this automatically every Friday at noon by registering it yourself:');
console.log(`  schtasks /Create /SC WEEKLY /D FRI /ST 12:00 /TN trajecktory-weekly-review /TR "node \\"${scriptPath}\\""`);
console.log('');

#!/usr/bin/env node
/**
 * funnel-entry.test.mjs — the funnel's FIRST rung (enteredFunnel).
 *
 * The first rung is membership, not progression: every row in applications.md was
 * evaluated, because an evaluation is what creates the row. Asking
 * "reached >= Evaluated" instead scored every evaluated-then-declined row as
 * never-evaluated, since Discarded / SKIP / Not a Fit do not sit on FUNNEL_ORDER.
 * Rung 1 collapsed onto rung 2 (both 165), and the chart reported a 100%
 * evaluate-to-apply conversion while hiding the largest drop in the pipeline.
 *
 * A wrong count here is invisible: the chart still renders, the bars still have
 * heights, and 100% looks like good news. So the regression assertion is the point
 * of this file — rung 1 must never equal rung 2 on data where rows were declined.
 *
 * Run: node tests/funnel-entry.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { enteredFunnel, FUNNEL_ORDER, appReached, isInbound, isOutbound } from '../dashboard-web/server/lib/statuses.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('funnel-entry.test.mjs');

// Invented rows, one per shape that matters. Ids and companies are fictional.
const rows = [
  { id: 1, company: 'Northwind Foods',  status: 'Evaluated',     reached: null },
  { id: 2, company: 'Aster Robotics',   status: 'Discarded',     reached: null },
  { id: 3, company: 'Bellhaven Labs',   status: 'SKIP',          reached: null },
  { id: 4, company: 'Cobalt Freight',   status: 'Not a Fit',     reached: null },
  { id: 5, company: 'Dunmore Systems',  status: 'Closed',        reached: null },
  { id: 6, company: 'Ember Analytics',  status: 'Applied',       reached: 'Applied' },
  { id: 7, company: 'Foxglove Health',  status: 'Rejected',      reached: 'Applied' },
  { id: 8, company: 'Gantry Logistics', status: 'No Response',   reached: 'Applied' },
  { id: 9, company: 'Harlow Retail',    status: '1st Interview', reached: '1st Interview' },
];

// ── membership, not progression ──────────────────────────────────────────────
check(enteredFunnel(rows[0]) === true, 'an Evaluated row entered the funnel');
check(enteredFunnel(rows[1]) === true, 'a Discarded row entered the funnel (it was evaluated, then declined)');
check(enteredFunnel(rows[2]) === true, 'a SKIP row entered the funnel');
check(enteredFunnel(rows[3]) === true, 'a Not a Fit row entered the funnel');
check(enteredFunnel(rows[8]) === true, 'a row deep in the ladder still counts at the first rung');

// ── the single exclusion ─────────────────────────────────────────────────────
// Closed = the posting closed before the user could act. Counting it as a role
// they chose not to apply to blames them for someone else's timing, and every
// other denominator in the app excludes it.
check(enteredFunnel(rows[4]) === false, 'a Closed row is excluded (posting closed before the user could act)');

// ── the regression that motivated this file ──────────────────────────────────
const entered = rows.filter(enteredFunnel).length;
const applied = rows.filter(a => appReached(a, 'Applied')).length;
check(entered === 8, `first rung counts every row but Closed (got ${entered}, want 8)`);
check(applied === 4, `Applied counts only rows that actually got sent (got ${applied}, want 4)`);
check(entered > applied, 'rung 1 is strictly larger than rung 2 when rows were declined (the 100%-conversion bug)');

// The old rule, kept here as the thing that must never come back.
const oldRule = rows.filter(a => appReached(a, 'Evaluated')).length;
check(oldRule < entered, `asking appReached(a,'Evaluated') still undercounts (${oldRule} vs ${entered}); that is why enteredFunnel exists`);

// ── guards on the shape of the ladder itself ─────────────────────────────────
check(FUNNEL_ORDER[0] === 'Evaluated', 'Evaluated is the first rung; enteredFunnel is written for the first rung only');
check(enteredFunnel(undefined) === true || enteredFunnel(undefined) === false, 'enteredFunnel does not throw on a missing row');

// ── Warm channel tags: inbound vs outbound must not collapse ─────────────────
// Both are "warm", but only outbound is scalable: you cannot make people find you
// on demand, and the relaunch plan rests the scalable half of its case on a single
// outbound data point. Collapsing the two would erase the exact signal the 40-touch
// test exists to grow, which is why they are separate tags rather than one "warm".
check(isInbound('[inbound] recruiter reached out') === true, 'an [inbound] tag is detected');
check(isOutbound('[outbound] I messaged the hiring manager') === true, 'an [outbound] tag is detected');
check(isInbound('[outbound] note') === false, 'an outbound row is not read as inbound');
check(isOutbound('[inbound] note') === false, 'an inbound row is not read as outbound');
// Prose must never be mistaken for a tag. This row exists in the real tracker:
// its note says "Recruiter-inbound" in prose and it went untagged for months, so a
// substring match would have silently classified it while the split stayed wrong.
check(isInbound('[self-sourced] Recruiter-inbound — exempt from auto-discard') === false,
  'the word "inbound" in prose is not a tag (only the bracketed form counts)');
check(isOutbound('') === false && isInbound(undefined) === false, 'empty and undefined notes are not warm');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

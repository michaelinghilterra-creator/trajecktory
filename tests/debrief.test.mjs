#!/usr/bin/env node
/**
 * debrief.test.mjs — unit tests for lib/debrief.mjs (interview-round debriefs).
 *
 * Pins: the detection header, which rounds count as "pending a debrief" (sourced
 * from CURRENT interview-stage status, never the backfilled event log), the
 * structured-note assembler, and that the fill-in template leads with the
 * objection question and carries no em dashes.
 *
 * Run: node tests/debrief.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  OBJECTION_QUESTION, isDebriefFor, debriefTemplate, formatDebriefNote, pendingDebriefs,
} from '../dashboard-web/server/lib/debrief.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const noEmDash = s => !/[—]/.test(s) && !/--/.test(s);

console.log('debrief.test.mjs');

// ── isDebriefFor ─────────────────────────────────────────────────────────────
check(isDebriefFor('### Debrief: Phone Screen (2026-07-23)\n**Outcome:** advanced', 'Phone Screen'),
  'debrief header matches its stage');
check(isDebriefFor('### Debrief: phone screen (2026-07-23)', 'Phone Screen'),
  'stage match is case-insensitive');
check(!isDebriefFor('### Debrief: Phone Screen (2026-07-23)', '1st Interview'),
  'debrief for one stage does not match another');
check(!isDebriefFor('Just some notes about the call', 'Phone Screen'),
  'a plain note is not a debrief');

// ReDoS regression (CodeQL js/polynomial-redos). The header detector used to
// backtrack polynomially on a header prefix followed by many spaces and no "(",
// and the note text is user-provided. Feed exactly that shape and require it to
// return promptly: a linear matcher is sub-millisecond, so a generous ceiling
// still fails loudly if the backtracking pattern ever comes back.
{
  const evil = '### Debrief:' + ' '.repeat(200000);
  const t0 = Date.now();
  const r = isDebriefFor(evil, 'anything');
  const ms = Date.now() - t0;
  check(r === false && ms < 1000, `a pathological header does not hang (${ms}ms)`);
}

// ── pendingDebriefs ──────────────────────────────────────────────────────────
const apps = [
  { id: 10, company: 'Northwind Robotics', role: 'Director RevOps', status: 'Phone Screen' },
  { id: 11, company: 'Cobalt Systems',    role: 'Sr Director RevOps', status: '2nd Interview' },
  { id: 12, company: 'Aster Grid',        role: 'Director SalesOps', status: 'Applied' },
  { id: 13, company: 'Vela Analytics',    role: 'Director BI',       status: '1st Interview' },
  // Terminal row that reached 2nd Interview: every concluded round is owed a debrief.
  { id: 14, company: 'Helio Labs',        role: 'VP RevOps',         status: 'Rejected', notes: '[reached: 2nd Interview] tough final panel' },
];
const notes = {
  // 10 is still at Phone Screen (nothing concluded yet), and it is debriefed anyway → not pending
  '10': [{ timestamp: '2026-07-20T00:00:00Z', text: '### Debrief: Phone Screen (2026-07-20)\n**Objection:** none raised' }],
  // 11 debriefed Phone Screen but SKIPPED 1st Interview before reaching 2nd → 1st Interview stays pending
  '11': [{ timestamp: '2026-07-18T00:00:00Z', text: '### Debrief: Phone Screen (2026-07-18)\n**Outcome:** advanced' }],
  // 13 has a plain note, not a debrief → its concluded Phone Screen round is pending
  '13': [{ timestamp: '2026-07-21T00:00:00Z', text: 'Nice chat, felt good' }],
};
const pend = pendingDebriefs({ apps, notes });
const pendIds = pend.map(p => p.id);

check(!pendIds.includes(10), 'a still-in-progress round with its debrief is not pending');
check(pendIds.includes(11), 'a concluded round skipped before advancing stays pending');
check(!pendIds.includes(12), 'a non-interview status with no reached tag is never pending');
check(pendIds.includes(13), 'a concluded round with only a plain note is pending');
const p11 = pend.filter(p => p.id === 11);
check(p11.length === 1 && p11[0].stage === '1st Interview',
  'pending entry carries the CONCLUDED round (1st Interview), not the in-progress current stage');
check(p11[0] && p11[0].company === 'Cobalt Systems', 'pending entry carries company/role for the prompt');
// Terminal row: Phone Screen + 1st + 2nd Interview all concluded, none debriefed → all three pending.
const p14 = pend.filter(p => p.id === 14).map(p => p.stage).sort();
check(p14.length === 3 && p14.join(',') === '1st Interview,2nd Interview,Phone Screen',
  'terminal row owes a debrief for every reached round (via the [reached:] tag)');
check(pendingDebriefs({}).length === 0, 'empty input is safe');

// ── formatDebriefNote ────────────────────────────────────────────────────────
const note = formatDebriefNote('Phone Screen',
  { outcome: 'rejected', objection: 'Wanted more years in a pure RevOps title', landed: 'KPI baseline story', next: 'None, closed out' },
  { date: '2026-07-23', company: 'Northwind Robotics', role: 'Director RevOps' });
check(/^### Debrief: Phone Screen \(2026-07-23\)/.test(note), 'formatted note starts with the detection header');
check(note.includes('**Objection:** Wanted more years'), 'objection field rendered');
check(note.includes('_Northwind Robotics | Director RevOps_'), 'company/role context line rendered');
check(!note.includes('**What I would change:**'), 'empty fields are omitted');
check(isDebriefFor(note, 'Phone Screen'), 'formatted note is detectable as its own stage');
check(noEmDash(note), 'formatted note has no em dashes');

const freeform = formatDebriefNote('1st Interview', { body: 'Freeform recap goes here.' }, { date: '2026-07-23' });
check(freeform.includes('Freeform recap goes here.'), 'freeform body is appended');

// ── debriefTemplate ──────────────────────────────────────────────────────────
const tpl = debriefTemplate('Phone Screen', { company: 'Northwind Robotics', role: 'Director RevOps', date: '2026-07-23' });
check(tpl.includes(OBJECTION_QUESTION), 'template leads with the exact objection question');
check(/^### Debrief: Phone Screen \(2026-07-23\)/.test(tpl), 'template header carries stage + date');
check(tpl.includes('most important'), 'template flags the objection as the most important field');
check(noEmDash(tpl), 'template has no em dashes');
const tplNoDate = debriefTemplate('1st Interview', {});
check(tplNoDate.includes('YYYY-MM-DD'), 'template shows a date placeholder when none is given');

check(typeof OBJECTION_QUESTION === 'string' && OBJECTION_QUESTION.length > 20, 'objection question constant is present');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

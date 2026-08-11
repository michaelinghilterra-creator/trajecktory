#!/usr/bin/env node
/**
 * ta-crosslog.test.mjs — crossLogAppNums(): which applications a Sent Talent
 * Acquisition touch cross-logs a follow-up onto.
 *
 * WHY THIS EXISTS: the Unserviced/WIP gauge reads the follow-up log, NOT the TA
 * CRM. A Sent TA touch that never wrote a follow-up left the application reading
 * as untouched, so dozens of already-contacted applications showed as unserviced.
 * The fix auto-cross-logs a Sent touch onto the LIVE applications at that company.
 * The gate matters both ways: it must catch an Applied row and must NOT invent
 * outreach on an only-evaluated or closed one.
 *
 * All fixtures are invented (greek-letter companies) — no real personal data.
 *
 * Run: node tests/ta-crosslog.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { crossLogAppNums } from '../dashboard-web/server/lib/target-talent.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };
const ids = (...a) => crossLogAppNums(...a).sort((x, y) => x - y);

const app = (id, company, status) => ({ id, company, status });
const APPS = [
  app(1, 'Alphacorp', 'Applied'),
  app(2, 'Betacorp', 'Evaluated'),
  app(3, 'Gammacorp', 'Rejected'),
  app(4, 'Deltacorp', 'No Response'),
  app(5, 'Epsiloncorp', 'Offer'),
  app(6, 'Alphacorp', '1st Interview'),   // second live app at the same company
  app(7, 'Zetacorp', 'Discarded'),
];

console.log('ta-crosslog.test.mjs\n\n── auto path (no explicit app) ─────────────────────────────────────');
check(JSON.stringify(ids(APPS, 'Alphacorp')) === JSON.stringify([1, 6]),
  'a Sent touch auto-logs to EVERY live app at the company (Applied + 1st Interview)');
check(ids(APPS, 'Betacorp').length === 0, 'an only-Evaluated company gets no cross-log');
check(ids(APPS, 'Gammacorp').length === 0, 'a Rejected app gets no cross-log');
check(ids(APPS, 'Zetacorp').length === 0, 'a Discarded app gets no cross-log');
check(JSON.stringify(ids(APPS, 'Deltacorp')) === JSON.stringify([4]),
  'a ghosted No-Response app IS eligible (highest-leverage outreach case)');
check(JSON.stringify(ids(APPS, 'Epsiloncorp')) === JSON.stringify([5]), 'an Offer app is eligible');
check(ids(APPS, 'Omegacorp').length === 0, 'a company with no application at all → nothing');

console.log('\n── company matching (suffix-tolerant) ──────────────────────────────');
check(JSON.stringify(ids([app(9, 'Alphacorp Inc.', 'Applied')], 'Alphacorp')) === JSON.stringify([9]),
  '"Alphacorp" matches a tracker row spelled "Alphacorp Inc."');

console.log('\n── explicit ids win, verbatim ──────────────────────────────────────');
check(JSON.stringify(crossLogAppNums(APPS, 'Alphacorp', [2])) === JSON.stringify([2]),
  'an explicit app id is used as-is and suppresses the auto path (even an Evaluated one the user chose)');
check(JSON.stringify(crossLogAppNums(APPS, 'Betacorp', [42, '43']).sort()) === JSON.stringify([42, 43]),
  'explicit accepts numbers and numeric strings, and ignores company entirely');
check(crossLogAppNums(APPS, 'Alphacorp', []).length === 2,
  'an empty explicit list falls back to the auto path');
check(crossLogAppNums(APPS, 'Alphacorp', ['nope', null, undefined]).length === 2,
  'non-numeric explicit entries are dropped, then the auto path fills in');

console.log('\n── safety ──────────────────────────────────────────────────────────');
check(crossLogAppNums([], 'Alphacorp').length === 0, 'no apps → empty, never throws');
check(crossLogAppNums(APPS, '').length === 0, 'blank company → empty, never throws');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

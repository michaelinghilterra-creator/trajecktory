#!/usr/bin/env node
/**
 * twc.test.mjs — the TWC work-search activity report (dashboard-web/server/lib/twc.mjs).
 *
 * Three things worth locking, all silent when wrong.
 *
 * 1. SUNDAY WEEKS. TWC weeks run Sunday–Saturday, unlike activity.mjs which is
 *    Monday-based (ISO). Reusing the wrong helper would file every activity under
 *    the neighbouring benefit week and the log would still render and still add up.
 *
 * 2. DATE SOURCING. The applications.md Date column is the eval/scrape date, not the
 *    apply date. An application is dated apply-dates.json → earliest "Applied"
 *    status-event → tracker Date (approximate, flagged). Getting this order wrong
 *    silently backdates or misdates work-search activities.
 *
 * 3. WHO COUNTS. Only apps that actually reached "Applied" become application rows;
 *    an Evaluated-but-never-applied role must not appear (it would pad the log with
 *    activity the claimant never did).
 *
 * Run: node tests/twc.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

// Sandbox before the module loads: config.mjs resolves DATA_DIR at import time, so
// reading the real tracker/sidecars would make assertions depend on live data.
const tmp = makeSandbox("twc");
process.env.TJK_DATA_DIR = tmp;

fs.writeFileSync(path.join(tmp, 'applications.md'), [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 201 | 2026-07-10 | Acme | Widget Operations Manager | 4.0/5 | Applied | ❌ | — | — |  | https://acme.test/201 |',
  '| 202 | 2026-07-05 | Globex | Sprocket Analyst | 3.5/5 | Rejected | ❌ | — | — |  | https://globex.test/202 |',
  '| 203 | 2026-07-01 | Initech | Cog Coordinator | 3.0/5 | Evaluated | ❌ | — | — |  | https://initech.test/203 |',
  '| 204 | 2026-07-19 | Umbrella | Gadget Supervisor | 3.8/5 | Applied | ❌ | — | — |  | https://umbrella.test/204 |',
  '| 205 | 2026-06-30 | Stark | Gizmo Engineer | 4.2/5 | Phone Screen | ❌ | — | — |  | https://stark.test/205 |',
  '| 206 | 2026-07-02 | Wayne | Contraption Lead | 3.6/5 | Applied | ❌ | — | — |  | https://wayne.test/206 |',
  '',
].join('\n'));

// 201, 202, 205 carry real apply dates; 204 has none (falls to tracker Date,
// approximate); 206 has none but a dated "Applied" status-event below.
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({
  201: '2026-07-20', 202: '2026-07-27', 205: '2026-06-30',
}, null, 2));

fs.writeFileSync(path.join(tmp, 'status-events.tsv'),
  'app#\tdate\tstatus\tcompany\tlogged\n'
  + '205\t2026-07-24\tPhone Screen\tStark\t2026-07-24\n'   // interview activity
  + '206\t2026-07-21\tApplied\tWayne\t2026-07-21\n'         // fallback apply date for 206
  + '202\t2026-07-26\tRejected\tGlobex\t2026-07-26\n');     // terminal, not an interview

fs.writeFileSync(path.join(tmp, 'follow-ups.md'), [
  '# Follow-Ups', '',
  '| # | app# | date | company | role | channel | contact | notes |',
  '|---|------|------|---------|------|---------|---------|-------|',
  '| 1 | 201 | 2026-07-23 | Acme | Widget Operations Manager | Email | Jane Doe | Second touch |',
  // Cross-logged touch: ALSO present in the Acme correspondence log below. Must be
  // counted once, not twice. Notes carry the exact subject line, as the live
  // cross-log writes it.
  '| 2 | 201 | 2026-07-22 | Acme | Widget Operations Manager | Email | Jane Doe | Cross-logged from Talent Acquisition · Acme · Subject: Widget Operations Manager application follow-up |',
  '',
].join('\n'));

// Target-talent contacts + their correspondence logs. The report must read Sent
// touches straight from here (follow-ups.md alone misses every bulk/queue send).
fs.writeFileSync(path.join(tmp, 'target-talent.md'), [
  '# Target Talent', '',
  '| # | company | last | first | salute | title | city | state | zip | phone | email | linkedin | status | lastTouch | notes | website |',
  '|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|-----------|-------|---------|',
  '| 301 | Acme | Doe | Jane | Jane | Recruiter |  |  |  |  | jane@acme.test [v:ok:probe:2026-07-01:90] | linkedin.com/in/jane | Sent | 2026-07-24 |  |  |',
  '| 302 | Globex | Roe | Rich | Rich | TA Lead |  |  |  |  |  | linkedin.com/in/rich | Sent | 2026-07-25 |  |  |',
  '',
].join('\n'));
const ttCorr = path.join(tmp, 'target-talent-correspondence');
fs.mkdirSync(ttCorr, { recursive: true });
// 301 Acme: a NEW email follow-up (not in follow-ups.md) + the cross-logged one
// (same date/subject as follow-ups.md row 2 → must dedup).
fs.writeFileSync(path.join(ttCorr, '301.md'), [
  '## 2026-07-24 09:00 | Sent | Widget Operations Manager, quick intro',
  '', 'Hi Jane, following up on my application.', '',
  '## 2026-07-22 10:00 | Sent | Widget Operations Manager application follow-up',
  '', 'Hi Jane, applied yesterday.', '',
  '## 2026-07-23 11:00 | Received | Re: Widget Operations Manager',
  '', 'Thanks, will review.', '',
].join('\n'));
// 302 Globex: a LinkedIn connection request → a Networking activity, method LinkedIn.
fs.writeFileSync(path.join(ttCorr, '302.md'), [
  '## 2026-07-25 14:00 | Sent | LinkedIn connection request',
  '', 'Request sent.', '',
].join('\n'));

// Referrals. 501 is UNLINKED (no TA twin) so its own correspondence must be swept.
// 502 IS linked to TA 301 (same LinkedIn slug linkedin.com/in/jane), so in production
// it logs to the twin's dir; the stray own-file below simulates that and MUST be
// ignored, or the linked referral would be double-counted.
fs.writeFileSync(path.join(tmp, 'referrals.md'), [
  '# Referral tracker', '',
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |',
  '|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|',
  '| 501 | Nadia Vex | Conference | Hooli | Data Lead | Asked | 2026-07-23 |  | linkedin.com/in/nadia |  |',
  '| 502 | Jane Doe | Former colleague | Acme | Widget Operations Manager | Asked | 2026-07-20 |  | linkedin.com/in/jane |  |',
  '',
].join('\n'));
const refCorr = path.join(tmp, 'referral-correspondence');
fs.mkdirSync(refCorr, { recursive: true });
fs.writeFileSync(path.join(refCorr, '501.md'), [
  '## 2026-07-23 09:00 | Sent | LinkedIn connection request',
  '', 'Hi Nadia, would love to connect about Hooli.', '',
].join('\n'));
fs.writeFileSync(path.join(refCorr, '502.md'), [
  '## 2026-07-20 08:00 | Sent | LinkedIn connection request',
  '', 'Linked referral — logged to its twin in production; must be ignored here.', '',
].join('\n'));

// LinkedIn connects ledger (data/linkedin-connects.json). Exercises the id-based
// join + dedup added in section 5 of buildActivities:
//  - Rich Roe carries contact id 302 but a NAME that would NOT normalize-match the
//    302 correspondence connect ("R. Roe" vs "Rich Roe"), so counting it once PROVES
//    the dedup is by id, not by name.
//  - Jane Doe (id 301) is ledger-only (no correspondence connect) and must be added,
//    resolved to Acme by id, with the cached employer joined.
//  - Ghost Lead has no id and no TA name match: still counts, blank Employer.
//  - Late Person is out of the fortnight range and must be filtered out.
fs.writeFileSync(path.join(tmp, 'linkedin-connects.json'), JSON.stringify([
  { date: '2026-07-25', id: 302, name: 'R. Roe', source: 'ta' },
  { date: '2026-07-26', id: 301, name: 'Jane Doe', source: 'ta' },
  { date: '2026-07-26', name: 'Ghost Lead', source: 'ta' },
  { date: '2026-08-05', id: 301, name: 'Jane Doe', source: 'ta' },
], null, 2));

// One cached employer so the join + the cached flag are exercised. Key is
// normalizeToken('Acme') === 'acme'.
fs.writeFileSync(path.join(tmp, 'employer-directory.json'), JSON.stringify({
  version: 1,
  employers: {
    acme: { company: 'Acme', hqAddress: '1 Acme Way, Austin, TX 78701', phone: '(512) 555-0100', website: 'https://acme.com', source: 'web-search', fetchedAt: '2026-07-25T00:00:00Z' },
  },
}, null, 2));

const twc = await import('../dashboard-web/server/lib/twc.mjs');
const { toCsv } = await import('../dashboard-web/server/lib/csv.mjs');
const { buildActivities, twcWeekStart, weeklyCounts, employersInActivities, toTwcCsv, TWC_CSV_HEADERS } = twc;

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };
const find = (acts, pred) => acts.find(pred);

console.log('twc.test.mjs');

try {
  // ── 1. Sunday weeks (anchored on the same dates activity.test uses) ──────────
  check(twcWeekStart('2026-06-14') === '2026-06-14', 'a Sunday is its own week start');
  check(twcWeekStart('2026-06-15') === '2026-06-14', 'a Monday belongs to the Sunday that began its week');
  check(twcWeekStart('2026-06-20') === '2026-06-14', 'a Saturday still belongs to that Sunday–Saturday week');
  check(twcWeekStart('2026-06-21') === '2026-06-21', 'the next Sunday opens a new week');
  check(twcWeekStart('nonsense') === null, 'an unparseable date yields null, never a wrong week');

  // ── 2. Range filter + who counts ─────────────────────────────────────────────
  const narrow = buildActivities({ from: '2026-07-20', to: '2026-07-27' });
  // apps 201/202/206 (3), interview 205 (1), follow-ups.md rows 1+2 (2),
  // correspondence: 301 new email + 302 LinkedIn (2); 301's 07-22 email dedups
  // against follow-ups.md row 2 → 8 from those sources. Ledger section 5 then adds
  // two in-range connects (Jane Doe 301 on 07-26, Ghost Lead on 07-26); the Rich Roe
  // ledger row dedups against the 302 correspondence connect by id, and Late Person
  // (Jane Doe 08-05) is out of range → 10 from apps/interview/follow-ups/corr/ledger.
  // Then the UNLINKED referral 501 adds its 07-23 LinkedIn connect (+1); the LINKED
  // referral 502's own file is ignored → 11 total.
  check(narrow.length === 11, `11 activities in the fortnight incl. ledger + referral connects (got ${narrow.length})`);
  check(!narrow.some(a => a.company === 'Initech'), 'an Evaluated-but-never-applied role is excluded');
  check(!narrow.some(a => a.date === '2026-07-19'), 'an out-of-range application (204 on 07-19) is filtered out');

  // ── 2b. Outreach sourced from correspondence + dedup + LinkedIn classification ─
  const acme0722 = narrow.filter(a => a.kind === 'followup' && a.company === 'Acme' && a.date === '2026-07-22');
  check(acme0722.length === 1, `the cross-logged Acme touch (in BOTH follow-ups.md and correspondence) is counted once (got ${acme0722.length})`);
  const acmeEmail = find(narrow, a => a.company === 'Acme' && a.date === '2026-07-24' && a.method === 'Email');
  check(acmeEmail && acmeEmail.result === 'Sent follow-up',
    'a Sent email in the correspondence log (never cross-logged) becomes a Follow-up activity');
  const linkedin = find(narrow, a => a.kind === 'outreach' && a.company === 'Globex');
  check(linkedin && linkedin.company === 'Globex' && linkedin.method === 'LinkedIn'
    && linkedin.result === 'Sent connection request' && /LinkedIn connection request/.test(linkedin.activity),
    'a LinkedIn connection request becomes a Networking activity with method LinkedIn, not an email touch');

  // ── 2c. Connects ledger (section 5): id-based dedup + join + best-effort employer ─
  const globexConnects = narrow.filter(a => a.kind === 'outreach' && a.company === 'Globex' && a.date === '2026-07-25');
  check(globexConnects.length === 1,
    `a connect in BOTH correspondence and the ledger is counted once, deduped by id despite a different name (got ${globexConnects.length})`);
  const janeConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Jane Doe' && a.date === '2026-07-26');
  check(janeConnect && janeConnect.company === 'Acme' && janeConnect.method === 'LinkedIn'
    && janeConnect.result === 'Sent connection request' && janeConnect.employerAddress === '1 Acme Way, Austin, TX 78701',
    'a ledger-only connect is added, resolved to its TA company by id, with the cached employer joined');
  const ghostConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Ghost Lead');
  check(ghostConnect && ghostConnect.company === '' && ghostConnect.method === 'LinkedIn',
    'a ledger-only connect with no id and no TA name match still counts, with a blank Employer column');
  check(!narrow.some(a => a.date === '2026-08-05'),
    'an out-of-range ledger connect (Jane Doe 08-05) is filtered out');

  // ── 2d. Referral correspondence: unlinked swept, linked ignored (no double-count) ─
  const refConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Nadia Vex' && a.date === '2026-07-23');
  check(refConnect && refConnect.company === 'Hooli' && refConnect.method === 'LinkedIn'
    && refConnect.result === 'Sent connection request' && refConnect.contactId == null,
    'an UNLINKED referral\'s own LinkedIn send is counted, with its company and no TA contact id');
  check(!narrow.some(a => a.kind === 'outreach' && a.contact === 'Jane Doe' && a.date === '2026-07-20'),
    'a LINKED referral\'s own correspondence file is NOT re-read (the TA twin already covers it)');

  // ── 3. Date sourcing ─────────────────────────────────────────────────────────
  const app206 = find(narrow, a => a.kind === 'application' && a.appId === 206);
  check(app206 && app206.date === '2026-07-21', 'app 206 is dated from its "Applied" status-event, not the tracker Date');
  check(app206 && app206.dateApprox === false, 'a status-event apply date is exact, not approximate');

  const wide = buildActivities({ from: '2026-07-01', to: '2026-07-31' });
  const app204 = find(wide, a => a.kind === 'application' && a.appId === 204);
  check(app204 && app204.date === '2026-07-19' && app204.dateApprox === true,
    'app 204 (no apply date, no event) falls back to the tracker Date, flagged approximate');

  // ── 4. Kinds, results, contact/method ────────────────────────────────────────
  const app201 = find(narrow, a => a.kind === 'application' && a.appId === 201);
  check(app201 && app201.result === 'Submitted application', 'an Applied app reads "Submitted application"');
  const app202 = find(narrow, a => a.kind === 'application' && a.appId === 202);
  check(app202 && app202.result === 'Not hired', 'a Rejected app reads "Not hired"');
  const interview = find(narrow, a => a.kind === 'interview');
  check(interview && /Phone Screen/.test(interview.activity) && interview.result === 'Interviewed' && interview.role === 'Gizmo Engineer',
    'the interview event becomes an "Interviewed" row with the app role');
  const follow = find(narrow, a => a.kind === 'followup');
  check(follow && follow.contact === 'Jane Doe' && follow.method === 'Email' && follow.result === 'Sent follow-up',
    'a follow-up carries its contact, method, and result; online applications leave contact blank');
  check(app201 && app201.contact === '' && app201.method === 'Online application',
    'an online application has no contact and method "Online application"');

  // ── 5. Employer join (posting URL wins for the web page) ─────────────────────
  check(app201 && app201.employerAddress === '1 Acme Way, Austin, TX 78701' && app201.employerPhone === '(512) 555-0100',
    'a cached employer fills address + phone');
  check(app201 && app201.employerWebPage === 'https://acme.test/201', 'the posting URL is the web page, not the company website');
  check(app202 && app202.employerAddress === '', 'an un-cached employer leaves address blank (acceptable on the TWC log)');

  // ── 6. Weekly counts + employer roster ───────────────────────────────────────
  const weeks = weeklyCounts(narrow);
  check(weeks.reduce((n, w) => n + w.count, 0) === narrow.length, 'weekly counts sum to the activity total');
  check(weeks.every(w => w.byKind && ['application', 'interview', 'followup', 'outreach']
    .reduce((n, k) => n + w.byKind[k], 0) === w.count),
    'each week\'s byKind breakdown sums to that week\'s count');
  const emps = employersInActivities(wide);
  const acme = emps.find(e => e.company === 'Acme');
  const globex = emps.find(e => e.company === 'Globex');
  check(acme && acme.cached === true, 'Acme is reported as already looked up');
  check(globex && globex.cached === false, 'Globex is reported as needing look-up');

  // ── 7. CSV: header mirrors the TWC log, one line per activity, quoting works ──
  const csv = toTwcCsv(narrow);
  const lines = csv.split('\r\n');
  check(lines[0] === TWC_CSV_HEADERS.join(','), 'CSV header row mirrors the TWC column set');
  check(lines.length === narrow.length + 1, `CSV has one line per activity plus the header (got ${lines.length})`);
  const quoted = toCsv([['a,b', 'c"d', 'e\nf']]);
  check(quoted === '"a,b","c""d","e\nf"', 'toCsv quotes commas, doubles inner quotes, and quotes newlines');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

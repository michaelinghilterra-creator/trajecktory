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
  '| 207 | 2026-07-22 | Wonka | Factory Planner | 3.7/5 | Not a Fit | ❌ | - | - |  | https://wonka.test/jobs/207 |',
  '| 208 | 2026-07-20 | Kestrel | Signal Analyst | 4.1/5 | Applied | ❌ | - | - |  | https://ats.shared.test/posting?jobId=88&utm_source=one |',
  '| 209 | 2026-07-21 | Kestrel | Signal Analyst | 4.1/5 | Applied | ❌ | - | - |  | https://ats.shared.test/posting?utm_source=two&jobid=88 |',
  '| 210 | 2026-07-22 | Soylent | Process Lead | 4.0/5 | Applied | ❌ | - | - |  | https://jobs.soylent.test/posting?jobId=10 |',
  '| 211 | 2026-07-23 | Soylent | Process Lead | 4.0/5 | Applied | ❌ | - | - |  | https://jobs.soylent.test/posting?jobId=11 |',
  '| 212 | 2026-08-01 | Tyrell | Systems Liaison | 4.3/5 | Phone Screen | ❌ | - | - |  | https://tyrell.test/jobs/212 |',
  '| 213 | 2026-08-02 | Oceanic | Route Director | 4.2/5 | Applied | ❌ | - | - |  | https://oceanic.test/jobs/213 |',
  '| 214 | 2026-07-24 | Cyberdyne | Program Analyst | 3.9/5 | No Response | ❌ | - | - |  | https://cyberdyne.test/jobs/214 |',
  '| 215 | 2026-07-25 | Gringotts | Controls Lead | 3.8/5 | Closed | ❌ | - | - |  | https://gringotts.test/jobs/215 |',
  '| 216 | 2026-07-24 | Massive Dynamic | Lab Planner | 4.0/5 | Applied | ❌ | - | - |  | https://massive.test/careers |',
  '| 217 | 2026-07-25 | Massive Dynamic | Field Planner | 4.0/5 | Applied | ❌ | - | - |  | https://massive.test/careers |',
  '| 218 | 2026-07-26 | Dharma | Signal Analyst | 4.0/5 | Applied | ❌ | - | - |  | https://ats.shared.test/posting?jobId=88 |',
  '',
].join('\n'));

// 201, 202, 205 carry real apply dates; 204 has none (falls to tracker Date,
// approximate); 206 has none but a dated "Applied" status-event below.
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({
  201: '2026-07-20', 202: '2026-07-27', 205: '2026-06-30',
  208: '2026-07-20', 209: '2026-07-21', 210: '2026-07-22', 211: '2026-07-23',
  212: '2026-08-01', 213: '2026-08-02', 214: '2026-07-24', 215: '2026-07-25',
  216: '2026-07-24', 217: '2026-07-25', 218: '2026-07-26',
}, null, 2));

fs.writeFileSync(path.join(tmp, 'status-events.tsv'),
  'app#\tdate\tstatus\tcompany\tlogged\n'
  + '205\t2026-07-24\tPhone Screen\tStark\t2026-07-24\n'   // interview activity
  + '206\t2026-07-21\tApplied\tWayne\t2026-07-21\n'         // fallback apply date for 206
  + '202\t2026-07-26\tRejected\tGlobex\t2026-07-26\n'      // terminal, not an interview
  + '207\t2026-07-22\tApplied\tWonka\t2026-07-22\n'
  + '207\t2026-07-22\tNot a Fit\tWonka\t2026-07-22\n'
  + '212\t2026-03-06\tPhone Screen\tTyrell\t2026-03-06\n'
  + '215\t2026-07-20\tApplied\tGringotts\t2026-07-20\n'
  + '215\t2026-07-25\tClosed\tGringotts\t2026-07-25\n');

fs.writeFileSync(path.join(tmp, 'app-notes.json'), JSON.stringify({
  212: [{
    timestamp: '2026-03-12T10:00:00Z',
    text: '### Phone Screen booked (2026-03-02)\n\n### Debrief: Phone Screen (2026-03-11)\n\nInvented debrief.',
  }],
}, null, 2));

fs.writeFileSync(path.join(tmp, 'follow-ups.md'), [
  '# Follow-Ups', '',
  '| # | app# | date | company | role | channel | contact | notes |',
  '|---|------|------|---------|------|---------|---------|-------|',
  '| 1 | 201 | 2026-07-23 | Acme | Widget Operations Manager | Email | Jane Doe | Second touch |',
  // Cross-logged touch: ALSO present in the Acme correspondence log below. Must be
  // counted once, not twice. Notes carry the exact subject line, as the live
  // cross-log writes it.
  '| 2 | 201 | 2026-07-22 | Acme | Widget Operations Manager | Email | Jane Doe | Cross-logged from Talent Acquisition · Acme · Subject: Widget Operations Manager application follow-up |',
  '| 3 | 201 | 2026-07-23 | Acme | Widget Operations Manager | Email | Jane Doe | Second touch |',
  '| 4 | 201 | 2026-07-23 | Acme | Widget Operations Manager | Email | Drew Hill | Backfill 2026-08-11: cross-logged contact status |',
  '| 5 | 201 | 2026-07-23 | Acme | Widget Operations Manager | Email | Rowan Vale | Self name test |',
  '| 6 | 201 | 2026-07-24 | Acme | Widget Operations Manager | Email | rowan@example.test | Self email test |',
  '| 7 | 201 | 2026-07-25 | Self Test | Widget Operations Manager | Email | Quinn Stone | Company test |',
  '| 8 | 202 | 2026-07-25 | Globex | Sprocket Analyst | Email | Rich Roe | Subject: RE: LinkedIn connection request |',
  '| 9 | 202 | 2026-07-25 | Globex | Sprocket Analyst | Email | Rich Roe | Subject: LinkedIn connection request |',
  '| 10 | 201 | 2026-07-27 | Acme | Widget Operations Manager | Phone | Casey Bell | Called hiring desk |',
  '| 11 | 201 | 2026-07-26 | Acme | Widget Operations Manager | Email | Avery Fox | Subject: LINKEDIN MESSAGE |',
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
  '| 303 | Acme | Same | Sam | Sam | Recruiter |  |  |  |  |  | linkedin.com/in/sam-acme | Sent | 2026-07-27 |  |  |',
  '| 304 | Globex | Same | Sam | Sam | Recruiter |  |  |  |  |  | linkedin.com/in/sam-globex | Sent | 2026-07-27 |  |  |',
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
  { date: '2026-07-27', id: 303, name: 'Sam Same', source: 'ta' },
  { date: '2026-07-27', id: 304, name: 'Sam Same', source: 'ta' },
  { date: '2026-08-05', id: 301, name: 'Jane Doe', source: 'ta' },
], null, 2));

fs.writeFileSync(path.join(tmp, 'twc-events.json'), JSON.stringify([{
  id: 'event-one',
  date: '2026-07-24',
  type: 'Employment workshop',
  organizer: 'Skill Guild',
  contact: 'Alex Reed',
  method: 'Online',
  notes: 'Portfolio clinic',
  createdAt: '2026-07-24T18:00:00.000Z',
}], null, 2));

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
const fictionalIdentity = { fullName: 'Rowan Vale', email: 'rowan@example.test' };

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
  const narrow = buildActivities({ from: '2026-07-20', to: '2026-07-27', identity: fictionalIdentity });
  // The total covers applications, channel-specific follow-ups, interviews,
  // and company-scoped LinkedIn activity while invalid rows add nothing.
  check(narrow.length === 26, `26 distinct activities in the fortnight (got ${narrow.length})`);
  check(!narrow.some(a => a.company === 'Initech'), 'an Evaluated-but-never-applied role is excluded');
  check(!narrow.some(a => a.date === '2026-07-19'), 'an out-of-range application (204 on 07-19) is filtered out');

  // ── 2b. Outreach sourced from correspondence + dedup + LinkedIn classification ─
  const acme0722 = narrow.filter(a => a.kind === 'followup' && a.company === 'Acme' && a.date === '2026-07-22');
  check(acme0722.length === 1, `the cross-logged Acme touch (in BOTH follow-ups.md and correspondence) is counted once (got ${acme0722.length})`);
  const acmeEmail = find(narrow, a => a.company === 'Acme' && a.date === '2026-07-24' && a.method === 'Email');
  check(acmeEmail && acmeEmail.result === 'Other' && acmeEmail.note === 'Sent follow-up',
    'a Sent email uses the TWC Other result and explains the follow-up in Note');
  const linkedin = find(narrow, a => a.kind === 'outreach' && a.company === 'Globex');
  check(linkedin && linkedin.company === 'Globex' && linkedin.method === 'LinkedIn'
    && linkedin.result === 'Other' && linkedin.note === 'Sent connection request'
    && linkedin.activity === 'Networking, LinkedIn connection request',
    'a LinkedIn connection request becomes a Networking activity with method LinkedIn, not an email touch');
  const richRows = narrow.filter(a => a.contact === 'Rich Roe' && a.date === '2026-07-25');
  const richLinkedIn = richRows.filter(a => a.kind === 'outreach' && a.method === 'LinkedIn');
  const richEmail = richRows.filter(a => a.kind === 'followup' && a.method === 'Email');
  check(richLinkedIn.length === 1,
    'a plain LinkedIn request plus correspondence and ledger copies becomes one LinkedIn row');
  check(richEmail.length === 1 && richEmail[0].activity === 'Follow-up (Email)',
    'a reply-prefixed LinkedIn request subject remains one email follow-up');
  check(narrow.filter(a => a.kind === 'followup' && a.contact === 'Jane Doe' && a.date === '2026-07-23').length === 1,
    'identical follow-up rows become one activity');
  check(!narrow.some(a => a.contact === 'Drew Hill'), 'a Backfill follow-up row is excluded');
  check(!narrow.some(a => ['Rowan Vale', 'rowan@example.test'].includes(a.contact)),
    'activities addressed to the fictional candidate name or email are excluded');
  check(narrow.some(a => a.company === 'Self Test' && a.contact === 'Quinn Stone'),
    'a Self Test company row is kept when the contact is not the candidate');
  const phone = find(narrow, a => a.contact === 'Casey Bell');
  check(phone && phone.kind === 'followup' && phone.activity === 'Follow-up (Phone)' && phone.method === 'Phone',
    'a Phone follow-up keeps Phone in its label and method');
  const linkedInMessage = narrow.filter(a => a.contact === 'Avery Fox' && a.date === '2026-07-26');
  check(linkedInMessage.length === 1 && linkedInMessage[0].kind === 'outreach'
    && linkedInMessage[0].activity === 'LinkedIn message' && linkedInMessage[0].method === 'LinkedIn',
    'an uppercase LinkedIn message subject becomes one LinkedIn message row');

  // ── 2c. Connects ledger (section 5): id-based dedup + join + best-effort employer ─
  const globexConnects = narrow.filter(a => a.kind === 'outreach' && a.company === 'Globex' && a.date === '2026-07-25');
  check(globexConnects.length === 1,
    `a connect in BOTH correspondence and the ledger is counted once, deduped by id despite a different name (got ${globexConnects.length})`);
  const janeConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Jane Doe' && a.date === '2026-07-26');
  check(janeConnect && janeConnect.company === 'Acme' && janeConnect.method === 'LinkedIn'
    && janeConnect.result === 'Other' && janeConnect.note === 'Sent connection request'
    && janeConnect.employerAddress === '1 Acme Way, Austin, TX 78701',
    'a ledger-only connect is added, resolved to its TA company by id, with the cached employer joined');
  const ghostConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Ghost Lead');
  check(ghostConnect && ghostConnect.company === '' && ghostConnect.method === 'LinkedIn',
    'a ledger-only connect with no id and no TA name match still counts, with a blank Employer column');
  check(!narrow.some(a => a.date === '2026-08-05'),
    'an out-of-range ledger connect (Jane Doe 08-05) is filtered out');
  const sameNameConnects = narrow.filter(a => a.contact === 'Sam Same' && a.date === '2026-07-27');
  check(sameNameConnects.length === 2
    && sameNameConnects.some(a => a.company === 'Acme')
    && sameNameConnects.some(a => a.company === 'Globex'),
    'same-name LinkedIn contacts at different companies are both kept');

  // ── 2d. Referral correspondence: unlinked swept, linked ignored (no double-count) ─
  const refConnect = find(narrow, a => a.kind === 'outreach' && a.contact === 'Nadia Vex' && a.date === '2026-07-23');
  check(refConnect && refConnect.company === 'Hooli' && refConnect.method === 'LinkedIn'
    && refConnect.result === 'Other' && refConnect.note === 'Sent connection request' && refConnect.contactId == null,
    'an UNLINKED referral\'s own LinkedIn send is counted, with its company and no TA contact id');
  check(!narrow.some(a => a.kind === 'outreach' && a.contact === 'Jane Doe' && a.date === '2026-07-20'),
    'a LINKED referral\'s own correspondence file is NOT re-read (the TA twin already covers it)');

  // ── 3. Date sourcing ─────────────────────────────────────────────────────────
  const app206 = find(narrow, a => a.kind === 'application' && a.appId === 206);
  check(app206 && app206.date === '2026-07-21', 'app 206 is dated from its "Applied" status-event, not the tracker Date');
  check(app206 && app206.dateApprox === false, 'a status-event apply date is exact, not approximate');

  const wide = buildActivities({ from: '2026-07-01', to: '2026-07-31', identity: fictionalIdentity });
  const app204 = find(wide, a => a.kind === 'application' && a.appId === 204);
  check(app204 && app204.date === '2026-07-19' && app204.dateApprox === true,
    'app 204 (no apply date, no event) falls back to the tracker Date, flagged approximate');
  check(app204 && app204.note === 'Apply date estimated from the evaluation date',
    'an approximate application carries the estimate explanation in Note');

  // ── 4. Kinds, results, contact/method ────────────────────────────────────────
  const app201 = find(narrow, a => a.kind === 'application' && a.appId === 201);
  check(app201 && app201.result === 'Submitted job application', 'an Applied app uses the TWC submitted-job-application wording');
  const app202 = find(narrow, a => a.kind === 'application' && a.appId === 202);
  check(app202 && app202.result === 'Not hired', 'a Rejected app reads "Not hired"');
  const app214 = find(narrow, a => a.kind === 'application' && a.appId === 214);
  check(app214 && app214.result === 'No reply', 'a No Response app reads "No reply"');
  const app215 = find(narrow, a => a.kind === 'application' && a.appId === 215);
  check(app215 && app215.result === 'Other' && app215.note === 'Status: Closed',
    'a Closed app uses Other and keeps the status detail in Note');
  const interview = find(narrow, a => a.kind === 'interview');
  check(interview && interview.activity === 'Interview: Phone Screen' && interview.result === 'Interviewed'
    && interview.role === 'Gizmo Engineer' && interview.note === 'Interview date is when the status changed',
    'the interview event uses a colon label and becomes an Interviewed row with the app role');
  const follow = find(narrow, a => a.kind === 'followup');
  check(follow && follow.contact === 'Jane Doe' && follow.method === 'Email'
    && follow.result === 'Other' && follow.note === 'Sent follow-up',
    'a follow-up carries its contact, method, and result; online applications leave contact blank');
  check(app201 && app201.contact === '' && app201.method === 'Online application',
    'an online application has no contact and method "Online application"');
  const loggedEvent = find(narrow, a => a.kind === 'event');
  check(loggedEvent && loggedEvent.activity === 'Employment workshop' && loggedEvent.company === 'Skill Guild'
    && loggedEvent.method === 'Online' && loggedEvent.result === 'Other' && loggedEvent.note === 'Portfolio clinic',
    'a manually logged event carries its activity, organizer, method, result, and note');
  const allowedResults = new Set(['Submitted job application', 'Sent a résumé', 'Interviewed', 'Hired', 'Not hired', 'No reply', 'Other']);
  check(narrow.every(a => allowedResults.has(a.result)), 'every result uses TWC wording');
  check(narrow.every(a => Object.prototype.hasOwnProperty.call(a, 'note')),
    'every activity carries a Note field');
  const doubleHyphen = String.fromCharCode(45, 45);
  check(narrow.every(a => ![a.activity, a.result, a.note].some(value => String(value).includes('\u2014')
    || String(value).includes(doubleHyphen))),
    'activity labels, results, and notes avoid forbidden punctuation');

  // ── 4b. Application identity, voids, overrides, and interview dates ─────────
  check(!narrow.some(a => a.kind === 'application' && a.appId === 207),
    'an application voided later on its Applied date is excluded');
  check(narrow.some(a => a.kind === 'application' && a.appId === 208)
    && !narrow.some(a => a.kind === 'application' && a.appId === 209),
    'same-company applications sharing a posting-specific canonical keep only the earlier apply');
  check(narrow.some(a => a.kind === 'application' && a.appId === 210)
    && narrow.some(a => a.kind === 'application' && a.appId === 211),
    'same-title applications with different job ids remain distinct postings');
  check(narrow.some(a => a.kind === 'application' && a.appId === 216)
    && narrow.some(a => a.kind === 'application' && a.appId === 217),
    'two postings sharing a generic careers URL are both kept');
  check(narrow.some(a => a.kind === 'application' && a.appId === 218),
    'a posting-specific canonical shared by a different company does not collapse');

  fs.writeFileSync(path.join(tmp, 'twc-overrides.json'), '{invalid json');
  const invalidOverride = buildActivities({ from: '2026-07-20', to: '2026-07-27', identity: fictionalIdentity });
  check(invalidOverride.some(a => a.kind === 'application' && a.appId === 201)
    && !invalidOverride.some(a => a.kind === 'application' && a.appId === 207),
    'an invalid override file is safely treated as no overrides');

  fs.writeFileSync(path.join(tmp, 'twc-overrides.json'), JSON.stringify({
    applications: {
      201: { include: false },
      207: { include: true, date: '2026-07-23', note: 'Confirmed application receipt' },
    },
    interviews: [
      { appId: 213, stage: '1st Interview', date: '2026-09-05', note: 'Confirmed with interviewer' },
    ],
    exclude: [
      { date: '2026-07-23', kind: 'followup', contact: 'Jane Doe', company: 'Acme', note: 'No sent evidence' },
      { date: '2026-07-24', kind: 'application', company: 'Cyberdyne', note: 'No submitted application evidence' },
      { date: '2026-07-25', kind: 'application', note: 'Missing contact and company' },
    ],
    add: [
      { date: '2026-07-26', kind: 'followup', activity: 'Follow-up email to employer contact', company: 'Acme', role: '', contact: 'Robin Lake', method: 'Email', result: 'Other', note: 'Sent mailbox evidence' },
      { date: '2026-07-27', kind: 'followup', activity: 'Follow-up phone call', company: 'Acme', role: '', contact: 'Casey Bell', method: 'Phone', result: 'Other', note: 'Duplicate of logged call' },
      { date: '2026-07-26', kind: 'application', activity: 'Applied online for a job', company: 'Alder Works', role: 'Operations Planner', contact: '', method: 'Online application', result: 'Submitted job application', note: 'Receipt one' },
      { date: '2026-07-26', kind: 'application', activity: 'Applied online for a job', company: 'Birch Labs', role: 'Operations Planner', contact: '', method: 'Online application', result: 'Submitted job application', note: 'Receipt two' },
      { date: '2026-07-26', kind: 'application', activity: 'Applied online for a job', company: 'Alder Works', role: 'Program Planner', contact: '', method: 'Online application', result: 'Submitted job application', note: 'Receipt three' },
      { date: '2026-07-26', kind: 'application', activity: 'Applied online for a job', company: 'Alder Works', role: 'Operations Planner', contact: '', method: 'Online application', result: 'Submitted job application', note: 'Duplicate receipt' },
      { date: 'not-a-date', kind: 'followup', activity: 'Invalid correction', company: 'Acme', role: '', contact: 'Invalid Person', method: 'Email', result: 'Other', note: '' },
    ],
  }, null, 2));
  const overriddenJuly = buildActivities({ from: '2026-07-20', to: '2026-07-27', identity: fictionalIdentity });
  const forced207 = find(overriddenJuly, a => a.kind === 'application' && a.appId === 207);
  check(forced207 && forced207.date === '2026-07-23' && /Confirmed application receipt/.test(forced207.note),
    'include true restores a same-day void and its override date and note are used');
  check(!overriddenJuly.some(a => a.kind === 'application' && a.appId === 201),
    'include false excludes an application');
  check(!overriddenJuly.some(a => a.kind === 'followup' && a.date === '2026-07-23' && a.contact === 'Jane Doe')
    && overriddenJuly.some(a => a.kind === 'followup' && a.date === '2026-07-22' && a.contact === 'Jane Doe'),
    'an exclude removes exactly the matching date, kind, contact, and company row');
  check(!overriddenJuly.some(a => a.kind === 'application' && a.appId === 214),
    'a company-scoped exclude without a contact removes a contactless application');
  check(overriddenJuly.some(a => a.kind === 'application' && a.appId === 217),
    'an exclude without a contact or company is skipped');
  check(overriddenJuly.filter(a => a.kind === 'followup' && a.contact === 'Robin Lake').length === 1,
    'a valid added override appears exactly once');
  check(overriddenJuly.filter(a => a.kind === 'followup' && a.contact === 'Casey Bell').length === 1,
    'an added override that duplicates an existing row does not double-count');
  const correctedApplications = overriddenJuly.filter(a => a.kind === 'application' && a.date === '2026-07-26'
    && ['Alder Works', 'Birch Labs'].includes(a.company));
  check(correctedApplications.some(a => a.company === 'Alder Works' && a.role === 'Operations Planner')
    && correctedApplications.some(a => a.company === 'Birch Labs' && a.role === 'Operations Planner'),
    'same-day application adds at different companies are both kept');
  check(correctedApplications.length === 3
    && correctedApplications.filter(a => a.company === 'Alder Works' && a.role === 'Operations Planner').length === 1
    && correctedApplications.some(a => a.company === 'Alder Works' && a.role === 'Program Planner'),
    'application add dedupe includes company and role while exact duplicates stay single');
  check(overriddenJuly.overrideWarnings === 2,
    'invalid add and exclude entries are skipped and reported as two warnings');

  const interviewRange = buildActivities({ from: '2026-03-01', to: '2026-09-10', identity: fictionalIdentity });
  const debriefInterview = find(interviewRange, a => a.kind === 'interview' && String(a.appId) === '212');
  check(debriefInterview && debriefInterview.date === '2026-03-11'
    && debriefInterview.note === 'Interview date from debrief note',
    'a matching debrief date wins over the status date and a booked heading is ignored');
  const addedInterview = find(interviewRange, a => a.kind === 'interview' && Number(a.appId) === 213);
  check(addedInterview && addedInterview.date === '2026-09-05'
    && /Confirmed with interviewer/.test(addedInterview.note),
    'an override adds an interview even without a status event');

  // ── 5. Employer join (posting URL wins for the web page) ─────────────────────
  check(app201 && app201.employerAddress === '1 Acme Way, Austin, TX 78701' && app201.employerPhone === '(512) 555-0100',
    'a cached employer fills address + phone');
  check(app201 && app201.employerWebPage === 'https://acme.test/201', 'the posting URL is the web page, not the company website');
  check(app202 && app202.employerAddress === '', 'an un-cached employer leaves address blank (acceptable on the TWC log)');

  // ── 6. Weekly counts + employer roster ───────────────────────────────────────
  const weeks = weeklyCounts(narrow);
  check(weeks.reduce((n, w) => n + w.count, 0) === narrow.length, 'weekly counts sum to the activity total');
  check(weeks.every(w => w.byKind && ['application', 'interview', 'followup', 'outreach', 'event']
    .reduce((n, k) => n + w.byKind[k], 0) === w.count),
    'each week\'s byKind breakdown sums to that week\'s count');
  check(weeks.some(w => w.byKind && w.byKind.event === 1),
    'weekly counts include the logged event under byKind.event');
  const emps = employersInActivities(wide);
  const acme = emps.find(e => e.company === 'Acme');
  const globex = emps.find(e => e.company === 'Globex');
  check(acme && acme.cached === true, 'Acme is reported as already looked up');
  check(globex && globex.cached === false, 'Globex is reported as needing look-up');

  // ── 7. CSV: header mirrors the TWC log, one line per activity, quoting works ──
  const csv = toTwcCsv(narrow);
  const lines = csv.split('\r\n');
  check(lines[0] === TWC_CSV_HEADERS.join(','), 'CSV header row mirrors the TWC column set');
  check(TWC_CSV_HEADERS.at(-1) === 'Note', 'CSV keeps Note as its final column');
  check(lines.length === narrow.length + 1, `CSV has one line per activity plus the header (got ${lines.length})`);
  check(toTwcCsv([app204]).split('\r\n')[1].endsWith('Apply date estimated from the evaluation date'),
    'an approximate apply exports its estimate note in the last CSV column');
  const eventCsv = toTwcCsv([loggedEvent]).split('\r\n')[1];
  check(eventCsv.includes('Employment workshop') && eventCsv.includes('Skill Guild') && eventCsv.endsWith('Portfolio clinic'),
    'the CSV row carries the manually logged event');
  const quoted = toCsv([['a,b', 'c"d', 'e\nf']]);
  check(quoted === '"a,b","c""d","e\nf"', 'toCsv quotes commas, doubles inner quotes, and quotes newlines');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

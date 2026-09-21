#!/usr/bin/env node
// Cadence dates must be the user's own calendar date, never the UTC date. A US evening send used to be
// recorded as tomorrow (UTC), pushing every later step a day out, and date arithmetic must not drift in
// either direction of UTC or across a daylight-saving change.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('local-dates');
process.env.TJK_DATA_DIR = sandbox;

const talentRow = id => `| ${id} | Example Works | Contact${id} | Test | Mx. | Recruiter | Austin | TX | 78701 | | test${id}@example.test | linkedin.com/in/test-${id} | Not Contacted | | | |`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' + talentRow(950001) + '\n' + talentRow(950002) + '\n',
  'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/target-talent.mjs');
const {
  advanceSequence, completeSequence, getSequence, pauseSequence, startSequence,
} = await import('../dashboard-web/server/lib/sequences.mjs');
const { parseTargetTalentMd, readTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');

const CADENCE = 'application-day-0-1-5-12';
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

// 03:30 UTC on 2030-01-02 is 21:30 on 2030-01-01 in Chicago and 12:30 on 2030-01-02 in Tokyo.
const RealDate = Date;
const NOW = new RealDate('2030-01-02T03:30:00Z').getTime();
function freezeClock() {
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(NOW); else super(...args); }
    static now() { return NOW; }
  };
}
const thawClock = () => { globalThis.Date = RealDate; };

console.log('local-dates.test.mjs');

// Date arithmetic: day 5 and day 12 must land exactly N calendar days after the day-0 send in every zone,
// including across a US spring-forward (2026-03-08) and for zones ahead of UTC.
for (const zone of ['America/Chicago', 'Asia/Tokyo', 'UTC']) {
  process.env.TZ = zone;
  const id = 951000 + Math.abs([...zone].reduce((n, c) => n + c.charCodeAt(0), 0));
  startSequence('ta', id, CADENCE, '2026-03-06');
  advanceSequence('ta', id, '2026-03-06', 'email');
  let state = advanceSequence('ta', id, '2026-03-07', 'linkedin');
  check(state.entry.nextStepDue === '2026-03-11', `${zone}: day 5 is due 5 days after the day-0 send across the DST change`);
  state = advanceSequence('ta', id, '2026-03-11', 'email');
  check(state.entry.nextStepDue === '2026-03-18', `${zone}: day 12 is due 12 days after the day-0 send`);
}

// Defaults: with no date supplied, every sequence write uses the local date, not the UTC one.
process.env.TZ = 'America/Chicago';
freezeClock();
try {
  startSequence('ta', 952001, CADENCE);
  check(getSequence('ta', 952001).startedAt === '2030-01-01', 'a default start date is the local date, not the UTC date');
  advanceSequence('ta', 952001, undefined, 'email');
  check(getSequence('ta', 952001).anchorDate === '2030-01-01', 'a default advance date is the local date');
  pauseSequence('ta', 952001);
  check(getSequence('ta', 952001).pausedAt === '2030-01-01', 'a default pause date is the local date');
  completeSequence('ta', 952001);
  check(getSequence('ta', 952001).completedAt === '2030-01-01', 'a default completion date is the local date');

  // A detected LinkedIn acceptance with no Connected On date falls back to the local date.
  const { setLinkedInStatus } = await import('../dashboard-web/server/lib/tt-linkedin.mjs');
  const { detectAcceptances } = await import('../dashboard-web/server/lib/linkedin-acceptance.mjs');
  setLinkedInStatus(953001, 'Invite Pending', '2029-12-31');
  startSequence('ta', 953001, CADENCE, '2029-12-31');
  detectAcceptances({
    connections: [{ first: 'Ava', last: 'Example', url: 'https://www.linkedin.com/in/ava-local-dates-example/', company: 'Example Works', on: '' }],
    taRows: [{ id: 953001, first: 'Ava', last: 'Example', company: 'Example Works', linkedin: 'linkedin.com/in/ava-local-dates-example', email: '' }],
  });
  check(getSequence('ta', 953001).completedAt === '2030-01-01', 'an acceptance without a Connected On date completes the sequence on the local date');
} finally {
  thawClock();
}

// The Sent route: an evening send is recorded on the day it happened.
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  startSequence('ta', 950001, CADENCE, '2030-01-01');
  freezeClock();
  let status;
  try {
    const response = await fetch(`${base}/api/target-talent/950001/correspondence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', channel: 'LinkedIn', subject: 'Invented outreach', body: 'Invented message body.' }),
    });
    status = response.status;
  } finally {
    thawClock();
  }
  const entry = getSequence('ta', 950001);
  check(status === 200 && entry.anchorDate === '2030-01-01' && entry.nextStepDue === '2030-01-02',
    'an evening Sent message anchors the cadence on the local day and schedules day 1 for the next local day');
  const logged = readTTCorrespondence(950001).at(-1);
  check(logged?.timestamp === '2030-01-01 21:30', 'the logged message timestamp is local wall-clock time');
  check(parseTargetTalentMd().find(r => r.id === 950001)?.lastTouch === '2030-01-01',
    'the contact lastTouch is the local date');

  // A half-hour zone proves the logged minutes are local, not UTC (03:30 UTC is 09:00 in Kolkata).
  process.env.TZ = 'Asia/Kolkata';
  freezeClock();
  try {
    await fetch(`${base}/api/target-talent/950002/correspondence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', channel: 'Email', subject: 'Invented outreach', body: 'Invented message body.' }),
    });
  } finally {
    thawClock();
  }
  check(readTTCorrespondence(950002).at(-1)?.timestamp === '2030-01-02 09:00',
    'the logged time uses the local hour and minutes in a half-hour zone');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nlocal-dates: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

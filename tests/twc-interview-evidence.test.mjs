#!/usr/bin/env node
// D-1, D-3 and D-11 in the Work Search log: an interview line with a recorded event counts only when it was held
// and has evidence, is dated by the day it was held, and the export gate lists what needs a look. Invented data.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('twc-interview-evidence');
process.env.TJK_DATA_DIR = tmp;

const app = (id, company, role, status = 'Phone Screen') => `| ${id} | 2030-01-02 | ${company} | ${role} | 0.01/5 | ${status} | ❌ | - | - |  | https://jobs.zorblax.example/${id} |`;
fs.writeFileSync(path.join(tmp, 'applications.md'), [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  app(900001, 'Zorblax Widgetry', 'Example Cog Lead'),
  app(900002, 'Quennox Ratchet Works', 'Example Gear Manager'),
  app(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer'),
  app(900004, 'Zorblax Widgetry', 'Example Flange Engineer'),
  app(900005, 'Quennox Ratchet Works', 'Example Pulley Director'),
  app(900006, 'Vantrix Sprocketry', 'Example Gear Planner', 'No Response'),
  app(900007, 'Zorblax Widgetry', 'Example Widget Planner', 'No Response'),
  app(900008, 'Quennox Ratchet Works', 'Example Cog Planner', 'No Response'),
  app(900009, 'Vantrix Sprocketry', 'Example Flange Planner', 'No Response'),
].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({ 900001: '2030-01-05', 900002: '2030-01-05', 900003: '2030-01-05', 900004: '2030-01-05', 900005: '2030-01-05' }, null, 2) + '\n');
fs.writeFileSync(path.join(tmp, 'status-events.tsv'),
  'app#\tdate\tstatus\tcompany\tlogged\n'
  + '900001\t2030-03-05\tPhone Screen\tZorblax Widgetry\t2030-03-05\n'
  + '900002\t2030-03-06\tPhone Screen\tQuennox Ratchet Works\t2030-03-06\n'
  + '900003\t2030-03-07\tPhone Screen\tVantrix Sprocketry\t2030-03-07\n'
  + '900004\t2030-06-10\tPhone Screen\tZorblax Widgetry\t2030-06-10\n');
fs.writeFileSync(path.join(tmp, 'app-notes.json'), JSON.stringify({
  900006: [{ timestamp: '2030-03-15T15:00:00.123Z', text: '### Reply logged (2030-03-15)\nexample.personone@example.test: We will not be moving forward with your application [negative]\n\nInvented rejection body.' }],
  900008: [{ timestamp: '2030-03-17T15:00:00.123Z', text: '### Reply logged (2030-03-17)\nexample.personone@example.test: thanks for your time, let us know a good time to talk [positive]\n\nInvented reply body.' }],
  900009: [{ timestamp: '2030-05-17T15:00:00.123Z', text: '### Reply logged (2030-05-17)\nexample.personone@example.test: thanks for your time, let us know a good time to talk [positive]\n\nInvented reply body.' }],
  900007: [{ timestamp: '2030-03-16T15:00:00.123Z', text: '### Reply logged (2030-03-16)\nexample.personone@example.test: thanks for your time, let us know a good time to talk [positive]\n\nInvented reply body.' }],
}, null, 2) + '\n');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const { buildActivities, interviewGateLines } = await import('../dashboard-web/server/lib/twc.mjs');
const { twcGateWarnings } = await import('../dashboard-web/server/lib/twc-gate.mjs');
const { buildInterviewRecordedEvent, interviewRecordsFromEvents, interviewKey } = await import('../lib/interview-store.mjs');
const { recordInterview, readInterviewRecords } = await import('../dashboard-web/server/lib/interview-events.mjs');
const { openEventStore, appendEvents } = await import('../lib/event-store.mjs');
const { buildVoidEvent } = await import('../lib/void-events.mjs');
const { resetLogWritesCache } = await import('../lib/log-writes.mjs');

const identity = { fullName: 'Rowan Vale', email: 'rowan@example.test' };
const TODAY = '2030-06-01';
const confirm = { kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: 'confirmation-900001' };
const record = (fields, id) => ({ ...buildInterviewRecordedEvent({ recorded_on: '2030-03-10', ...fields }), id });
const recordsOf = (events) => interviewRecordsFromEvents(events);
const interviews = (activities) => activities.filter(a => a.kind === 'interview');

console.log('twc-interview-evidence.test.mjs');

// 1. No recordings: every line keeps the old rules and none is marked evidenced.
{
  const acts = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: new Map() });
  const lines = interviews(acts);
  check(lines.length === 4 && lines.every(a => a.evidenced === false), 'with nothing recorded, four lines are taken from the old rules and none is evidenced');
  check(lines.find(a => a.appId === '900001').date === '2030-03-05', 'an old rule line is dated by the status change');
}

// 2. Recordings decide the lines that have one.
const events = [
  record({ application_id: 900001, stage: 'Phone Screen', booked_on: '2030-03-05', scheduled_for: '2030-03-08', held_on: '2030-03-08', evidence: [confirm] }, 1),
  record({ application_id: 900003, stage: 'Phone Screen', held_on: '2030-03-09', evidence: [] }, 2),
  record({ application_id: 900004, stage: 'Phone Screen', scheduled_for: '2030-06-10' }, 3),
  record({ application_id: 900005, stage: 'Phone Screen', held_on: '2030-03-12', evidence: [{ kind: 'owner_confirmation', confirmed_on: '2030-03-13', ref: 'confirmation-900005' }] }, 4),
];
const records = recordsOf(events);
{
  const acts = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: records });
  const lines = interviews(acts);
  const byApp = Object.fromEntries(lines.map(a => [a.appId, a]));
  check(byApp['900001'] && byApp['900001'].date === '2030-03-08' && byApp['900001'].evidenced === true && byApp['900001'].week === '2030-03-03', 'a held line is dated by the day it was held, not the day the status changed (D-3)');
  check(byApp['900001'].evidenceRefs.join() === 'confirmation-900001' && byApp['900001'].result === 'Interviewed', 'the counted line carries its evidence reference');
  check(!byApp['900003'], 'a held line with no evidence is not counted (D-1)');
  check(!byApp['900004'], 'a scheduled line is not counted before it is held');
  check(byApp['900005'] && byApp['900005'].date === '2030-03-12' && byApp['900005'].company === 'Quennox Ratchet Works', 'a recorded line with no status change behind it counts once held');
  check(byApp['900002'] && byApp['900002'].evidenced === false && byApp['900002'].date === '2030-03-06', 'a line with no recording keeps the old rules');
  check(lines.length === 3, 'three interview rows in all');
  const narrow = buildActivities({ from: '2030-03-03', to: '2030-03-09', identity, today: TODAY, interviewRecords: records });
  check(interviews(narrow).map(a => a.appId).sort().join() === '900001,900002', 'the date range filters on the held day');
  const before = buildActivities({ from: '2030-03-05', to: '2030-03-05', identity, today: TODAY, interviewRecords: records });
  check(interviews(before).length === 0, 'the old status change day no longer holds the interview');
}

// 2b. Strict (store on): a line with no recording is not counted; it is listed and the gate asks about it.
{
  const acts = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: records, strictInterviews: true });
  const lines = interviews(acts);
  check(lines.map(a => a.appId).sort().join() === '900001,900005', 'strict: only lines with a recording that says held with evidence are counted');
  check(acts.strictInterviews === true && acts.unrecordedInterviews.map(l => `${l.appId}|${l.stage}|${l.date}`).join() === '900002|Phone Screen|2030-03-06', 'strict: the line with no recording is listed with its old date');
  const gateLines = interviewGateLines(acts, records, TODAY);
  check(gateLines.length === 5 && gateLines.find(l => l.id === 900002).held_on === '2030-03-06' && gateLines.find(l => l.id === 900002).evidence.length === 0, 'strict: the gate still checks the unrecorded line, as held with no evidence');
  const relaxed = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: records, strictInterviews: false });
  check(interviews(relaxed).map(a => a.appId).sort().join() === '900001,900002,900005' && relaxed.unrecordedInterviews.length === 0 && relaxed.strictInterviews === false, 'not strict (store off): the line with no recording keeps the old rules');
  const none = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: new Map(), strictInterviews: true });
  check(interviews(none).length === 0 && none.unrecordedInterviews.length === 4, 'strict with nothing recorded: no interview counts and all four lines are listed');
}

// 3. A held date in the future is never counted.
{
  const future = recordsOf([record({ application_id: 900001, stage: 'Phone Screen', held_on: '2030-07-01', evidence: [confirm] }, 1)]);
  const acts = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY, interviewRecords: future });
  check(!interviews(acts).some(a => a.appId === '900001'), 'a held date after today is not counted');
}

// 4. The gate lines (D-11).
{
  const acts = buildActivities({ identity, today: TODAY, interviewRecords: records });
  const gateLines = interviewGateLines(acts, records, TODAY);
  const keys = gateLines.map(l => interviewKey(l.id, l.stage)).sort();
  check(keys.length === 5, 'five lines are checked: four recorded ones and the one still on the old rules');
  const old = gateLines.find(l => l.id === 900002);
  check(old && old.held_on === '2030-03-06' && old.evidence.length === 0, 'an old rule line is checked as held with no evidence');
  check(old.stage === 'Phone Screen', 'an old rule line keeps its stage text exactly, with no leading space');
  const future = interviewGateLines([{ kind: 'interview', evidenced: false, appId: '900009', activity: 'Interview: Phone Screen', date: '2030-07-01' }], new Map(), TODAY);
  check(future[0].scheduled_for === '2030-07-01' && future[0].held_on === undefined, 'an old rule line dated after today is checked as scheduled');
  check(interviewGateLines([{ kind: 'interview', evidenced: true, appId: '900001', activity: 'Interview: Phone Screen', date: '2030-03-08' }, { kind: 'application', appId: '1' }], new Map(), TODAY).length === 0, 'counted lines and other kinds add nothing');
  check(interviewGateLines([{ kind: 'interview', evidenced: false, appId: '900001', activity: 'Interview: phone  screen', date: '2030-03-05' }], records, TODAY).length === 4, 'a line that has a recording is not counted twice');

  const gate = twcGateWarnings({ from: '2030-03-01', to: '2030-03-31', today: TODAY, interviewRecords: records });
  const types = gate.warnings.map(w => `${w.type}:${w.id}`).sort();
  check(gate.warn_only === true && gate.blocking === false && gate.count === gate.warnings.length, 'with the store off (not strict) the gate only warns');
  const strictGate = twcGateWarnings({ from: '2030-03-01', to: '2030-03-31', today: TODAY, interviewRecords: records, strictInterviews: true });
  check(strictGate.blocking === true && strictGate.warn_only === false && strictGate.count === gate.count, 'with the store on (strict) the gate blocks');
  check(types.join() === 'status_mismatch:900006,unconfirmed_interview:900002,unconfirmed_interview:900003', 'the range lists the line with no recording, the held line with no evidence and a No Response that has a rejection on record');
  const mismatch = gate.warnings.find(w => w.id === 900006);
  check(gate.other_replies_in_range === 2, 'plain replies on No Response applications inside the range are counted, not listed, and one outside the range is not counted');
  check(mismatch.mismatch_type === 'rejection_after_no_response' && mismatch.company === 'Vantrix Sprocketry', 'a status mismatch warning names its type and company');
  const first = gate.warnings.find(w => w.id === 900003);
  check(first.company === 'Vantrix Sprocketry' && first.role === 'Example Sprocket Designer' && first.stage === 'Phone Screen' && first.reasons.join() === 'no_evidence', 'a warning names the company, role, stage and reason');
  const june = twcGateWarnings({ from: '2030-06-01', to: '2030-06-30', today: TODAY, interviewRecords: records });
  check(june.warnings.map(w => `${w.type}:${w.id}`).join() === 'scheduled_in_range:900004', 'a scheduled interview inside the range is listed');
  const quiet = twcGateWarnings({ from: '2030-08-01', to: '2030-08-31', today: TODAY, interviewRecords: records });
  check(quiet.count === 0, 'a range with nothing to look at has no warnings');
  const throwsOn = (fn, field) => { try { fn(); return false; } catch (error) { return error instanceof TypeError && error.message === field; } };
  check(throwsOn(() => twcGateWarnings({ from: 'x', to: '2030-03-31', today: TODAY, interviewRecords: records }), 'from'), 'a bad from date is refused');
  check(throwsOn(() => twcGateWarnings({ from: '2030-03-01', to: '2030-02-30', today: TODAY, interviewRecords: records }), 'to'), 'a bad to date is refused');
  check(throwsOn(() => twcGateWarnings({ from: '2030-04-01', to: '2030-03-01', today: TODAY, interviewRecords: records }), 'from'), 'a range in the wrong order is refused');
}

// 5. Through a real event store: off means nothing recorded, on keeps the recordings, a void takes one out (D-10).
{
  check(readInterviewRecords(tmp).size === 0, 'with the event store off, no lines are read');
  let refused = null;
  try { recordInterview({ application_id: 900001, stage: 'Phone Screen', recorded_on: '2030-03-10', held_on: '2030-03-08', evidence: [confirm] }, tmp); } catch (error) { refused = error; }
  check(refused && refused.code === 'STORE_OFF', 'with the event store off, recording is refused');

  fs.writeFileSync(path.join(tmp, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));
  const store = openEventStore(path.join(tmp, 'trajecktory.db'));
  store.db.close();
  resetLogWritesCache();
  const ids = recordInterview({ application_id: 900001, stage: 'Phone Screen', recorded_on: '2030-03-10', booked_on: '2030-03-05', held_on: '2030-03-08', evidence: [confirm] }, tmp);
  check(Array.isArray(ids) && ids.length === 1, 'with the event store on, recording stores one event');
  let stored = readInterviewRecords(tmp);
  check(stored.get(interviewKey(900001, 'Phone Screen')).held_on === '2030-03-08', 'the recorded line is read back');
  const acts = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY });
  check(interviews(acts).find(a => a.appId === '900001').date === '2030-03-08', 'the log reads the store by itself and dates the line by the day it was held');

  const voidStore = openEventStore(path.join(tmp, 'trajecktory.db'));
  appendEvents(voidStore, [buildVoidEvent({ target_event_id: ids[0], reason_code: 'wrong_record', evidence_ref: 'owner', actor: 'owner', occurred_on: '2030-03-11', definitions_version: 'v1.1' })]);
  voidStore.db.close();
  resetLogWritesCache();
  stored = readInterviewRecords(tmp);
  check(stored.size === 0, 'a voided recording is no longer read');
  const after = buildActivities({ from: '2030-01-01', to: '2030-12-31', identity, today: TODAY });
  check(!interviews(after).some(a => a.appId === '900001') && after.unrecordedInterviews.some(l => l.appId === '900001'), 'with the store on, a line whose recording is voided is not counted and is listed as having no recording');

  let bad = null;
  try { recordInterview({ application_id: 900001, stage: 'Phone Screen', recorded_on: '2030-03-10' }, tmp); } catch (error) { bad = error; }
  check(bad instanceof TypeError, 'a recording with no dates is refused before anything is written');
}

// 6. The route: read only, and it never blocks the CSV.
{
  const express = (await import('express')).default;
  const { router } = await import('../dashboard-web/server/routes/setup-modules.mjs');
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url) => fetch(`${base}${url}`).then(async response => ({ status: response.status, body: await response.json().catch(() => null), response }));
  try {
    const before = fs.readFileSync(path.join(tmp, 'status-events.tsv'), 'utf8');
    let r = await get('/api/setup/twc/gate?from=2030-03-01&to=2030-03-31');
    check(r.status === 200 && r.body.blocking === true && Array.isArray(r.body.warnings) && r.body.from === '2030-03-01', 'the gate route answers 200 with the warnings, and says it blocks (the store is on here)');
    check(r.body.warnings.some(w => w.id === 900002), 'the route lists the line with no recording (scheduled here, because the real today is before 2030)');
    r = await get('/api/setup/twc/gate?from=2030-03-01');
    check(r.status === 400, 'a missing date is a 400');
    r = await get('/api/setup/twc/gate?from=2030-04-01&to=2030-03-01');
    check(r.status === 400, 'a range in the wrong order is a 400');
    r = await get('/api/setup/twc/export?from=2030-03-01&to=2030-03-31');
    check(r.status === 409 && r.body.blocked === true && r.body.gate.count > 0, 'the CSV export is refused with the items when there are any (D-11 blocking)');
    check(r.response.headers.get('content-disposition') === null, 'a refused export carries no file');
    r = await get('/api/setup/twc/export?from=2030-03-01&to=2030-03-31&acknowledged=1');
    check(r.status === 200 && /text\/csv/.test(r.response.headers.get('content-type')), 'the CSV is served when the person says to download anyway');
    r = await get('/api/setup/twc/export?from=2030-03-01&to=2030-03-31&acknowledged=0');
    check(r.status === 409, 'only acknowledged=1 counts as download anyway');
    r = await get('/api/setup/twc/export?from=2030-08-01&to=2030-08-31');
    check(r.status === 200 && /text\/csv/.test(r.response.headers.get('content-type')), 'a range with nothing to look at is served without asking');
    r = await get('/api/setup/twc/export?to=2030-03-31');
    check(r.status === 409, 'a range with no start is checked from the beginning and refused too');
    r = await get('/api/setup/twc/export?from=2030-04-01&to=2030-03-01');
    check(r.status === 400, 'a range in the wrong order is a 400 on the export too');
    check(fs.readFileSync(path.join(tmp, 'status-events.tsv'), 'utf8') === before, 'the gate changed no file');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

console.log(`\ntwc-interview-evidence: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

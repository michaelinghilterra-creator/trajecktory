#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { openEventStore } from '../lib/event-store.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXED_NOW = '2035-06-07T12:34:00.000Z';
const APP_HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n|- |- |- |- |- |- |- |- |- |- |-|\n';
const TT_HEADER = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|- |- |- |- |- |- |- |- |- |- |- |- |- |- |- |-|\n';
const REF_HEADER = '# Referral tracker\n\n| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n|- |- |- |- |- |- |- |- |- |-|\n';

function fixture(dir, eventStore = false) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'applications.md'), APP_HEADER
    + '| 41 | 2035-06-01 | Examplecorp | Example Engineer | 4/5 | Applied |  |  |  | Invented note | https://example.test/jobs/41 |\n');
  fs.writeFileSync(path.join(dir, 'target-talent.md'), TT_HEADER
    + '| 1 | Examplecorp | Example | Pat |  | Talent Lead |  |  |  |  | pat@example.test [v:valid:test:2035-06-01] | linkedin.com/in/pat-example | Not Contacted |  | Invented note | example.test |\n'
    + '| 3 | Othercorp | Other | Pat |  | Other Lead |  |  |  |  | other@example.test | linkedin.com/in/pat-other | Not Contacted |  | Invented note | example.test |\n'
    + '| 4 | 100% Pure | Percent | Perry |  | People Lead |  |  |  |  | perry@example.test | linkedin.com/in/perry-percent | Not Contacted |  | Invented note | example.test |\n');
  fs.writeFileSync(path.join(dir, 'referrals.md'), REF_HEADER
    + '| 1 | Pat Example | Invented colleague | Examplecorp Inc | Example Engineer | Not Asked |  | Talent Lead · from TA Outreach #1 | linkedin.com/in/pat-example | pat@example.test |\n'
    + '| 2 | Riley Example | Invented colleague | Examplecorp Inc | Example Engineer | Not Asked |  | Engineering Manager · connected 2035-01-01 | linkedin.com/in/riley-example | riley@example.test [v:valid:test:2035-06-01] |\n'
    + '| 3 | Avery Example | Invented colleague | Othercorp | Other Engineer | Not Asked |  | Other Manager | linkedin.com/in/avery-example | avery@example.test |\n');
  fs.writeFileSync(path.join(dir, 'contact-links.json'), JSON.stringify({
    version: 1,
    pins: { 'ta:1': { with: 'referral:1', by: 'manual', at: '2035-01-01' }, 'referral:1': { with: 'ta:1', by: 'manual', at: '2035-01-01' } },
  }, null, 2));
  if (eventStore) {
    fs.writeFileSync(path.join(dir, 'event-store.json'), '{"writes":"on"}\n');
    const outputDir = path.join(dir, 'fixture-output');
    fs.mkdirSync(outputDir);
    const store = openEventStore(path.join(dir, 'trajecktory.db'));
    importDataFolder(store, { dataDir: dir, outputDir, ownerName: 'Pat Example', definitionsVersion: 'v1', importedOn: '2035-06-01' });
    store.close();
  }
}

async function request(router, method, url, body) {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.json();
  await new Promise(resolve => server.close(resolve));
  return { status: response.status, body: responseBody };
}

async function worker() {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return new NativeDate(FIXED_NOW).getTime(); }
  };
  const action = process.env.TJK_PM_ACTION;
  const { router } = await import('../dashboard-web/server/routes/person-messages.mjs');
  const tt = await import('../dashboard-web/server/lib/target-talent.mjs');
  const referrals = await import('../dashboard-web/server/lib/referrals.mjs');
  const followups = await import('../dashboard-web/server/lib/followups.mjs');
  const result = {};

  if (action === 'company') {
    result.response = await request(router, 'GET', '/api/people/by-company/Examplecorp');
  } else if (action === 'company-percent') {
    result.response = await request(router, 'GET', '/api/people/by-company/100%25%20Pure');
  } else if (action === 'ta-sent' || action === 'event-on') {
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Sent', channel: 'email', subject: 'Example subject', body: 'Example body',
    });
    result.messages = tt.readTTCorrespondence(1);
    result.row = tt.parseTargetTalentMd().find(row => row.id === 1);
    result.followups = followups.parseFollowupsMd();
    if (action === 'event-on') {
      const { openDataStore } = await import('../lib/log-writes.mjs');
      const { readEvents } = await import('../lib/event-store.mjs');
      result.events = readEvents(openDataStore(process.env.TJK_DATA_DIR));
    }
  } else if (action === 'referral-sent') {
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'referral:2', direction: 'Sent', channel: 'LinkedIn', subject: 'Referral subject', body: 'Referral body',
    });
    result.messages = referrals.readReferralCorrespondence(2);
    result.row = referrals.parseReferralsMd().find(row => row.id === 2);
    result.followups = followups.parseFollowupsMd();
  } else if (action === 'twin-sent') {
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'referral:1', direction: 'Sent', channel: 'Email', subject: 'Twin subject', body: 'Twin body',
    });
    result.taMessages = tt.readTTCorrespondence(1);
    result.referralMessages = referrals.readReferralCorrespondence(1);
  } else if (action === 'ta-received') {
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Received', channel: 'Email', subject: 'Reply subject', body: 'Thanks for reaching out',
    });
    result.messages = tt.readTTCorrespondence(1);
    result.followups = followups.parseFollowupsMd();
  } else if (action === 'sequence-side-effects') {
    const sequences = await import('../dashboard-web/server/lib/sequences.mjs');
    sequences.startSequence('ta', 1, 'application-day-0-1-5-12', '2035-06-07');
    result.sent = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Sent', channel: 'Email', subject: 'Sequence subject', body: 'Sequence body',
    });
    result.afterSent = sequences.getSequence('ta', 1);
    result.received = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Received', channel: 'Email', subject: 'Reply subject', body: 'Thanks for reaching out',
    });
    result.afterReply = sequences.getSequence('ta', 1);
  } else if (action === 'linkedin-side-effects') {
    const connects = await import('../dashboard-web/server/lib/connects.mjs');
    const linkedin = await import('../dashboard-web/server/lib/tt-linkedin.mjs');
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn message', body: 'LinkedIn body',
    });
    result.connects = connects.readConnects();
    result.linkedinStatus = linkedin.getLinkedInStatus(1);
  } else if (action === 'internal-dates') {
    const { localStamp } = await import('../lib/local-date.mjs');
    result.expectedStamp = localStamp();
    result.response = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Sent', channel: 'Email', subject: 'Date subject', body: 'Date body',
      today: '2099-01-01 | OVERRIDE', stamp: '2099-01-01 01:01\nOVERRIDE',
    });
    result.messages = tt.readTTCorrespondence(1);
    result.row = tt.parseTargetTalentMd().find(row => row.id === 1);
    result.followups = followups.parseFollowupsMd();
  } else if (action === 'errors') {
    result.badPerson = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:999', direction: 'Sent', subject: 'Example subject', body: 'Example body',
    });
    result.badApp = await request(router, 'POST', '/api/applications/999/messages', {
      personRef: 'ta:1', direction: 'Sent', subject: 'Example subject', body: 'Example body',
    });
    result.badSubject = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:1', direction: 'Sent', subject: ' ', body: 'Example body',
    });
    result.wrongCompany = await request(router, 'POST', '/api/applications/41/messages', {
      personRef: 'ta:3', direction: 'Sent', subject: 'Example subject', body: 'Example body',
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.env.TJK_PM_WORKER === '1') {
  await worker();
  process.exit(0);
}

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function run(action, eventStore = false) {
  const dir = makeRepoSandbox(ROOT, `person-messages-${action}`);
  fixture(dir, eventStore);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TJK_PM_WORKER: '1', TJK_PM_ACTION: action, TJK_DATA_DIR: dir },
  });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `Worker ${action} failed`);
  return JSON.parse(child.stdout.trim());
}

console.log('person-messages.test.mjs');

const company = run('company').response;
check(company.status === 200 && company.body.people.length === 2, 'by-company returns only the two resolved Examplecorp people');
check(company.body.people.some(person => person.ref === 'ta:1' && person.refs.includes('referral:1')), 'a TA and referral person appears once with the TA ref');
check(company.body.people.some(person => person.ref === 'referral:2' && person.title === 'Engineering Manager'), 'suffix matching includes the referral-only person and derives the title');
check(company.body.people.every(person => !person.email.includes('[v:')) && !company.body.people.some(person => person.name === 'Avery Example'), 'emails are clean and another company is excluded');

const percentCompany = run('company-percent').response;
check(percentCompany.status === 200 && percentCompany.body.people.length === 1 && percentCompany.body.people[0].company === '100% Pure', 'by-company accepts an Express-decoded company name containing a percent sign');

const taSent = run('ta-sent');
check(taSent.response.status === 200 && taSent.response.body.followupN === 1, 'sent TA message returns its follow-up number');
check(taSent.messages.length === 1 && taSent.row.lastTouch === '2035-06-07' && taSent.row.status === 'Sent', 'sent TA message adds one entry and advances the contact');
check(taSent.followups.length === 1 && taSent.followups[0].contact === 'Pat Example' && taSent.followups[0].notes.startsWith('Cross-logged from person card'), 'sent TA message adds one named cross-log row');

const referralSent = run('referral-sent');
check(referralSent.messages.length === 1 && referralSent.row.lastTouch === '2035-06-07' && referralSent.row.status === 'Catching Up', 'unlinked referral stores the message and advances its ladder');
check(referralSent.followups.length === 1 && referralSent.response.body.followupN === 1, 'unlinked referral sent message adds one follow-up row');

const twinSent = run('twin-sent');
check(twinSent.response.body.linkedTo === 'ta:1' && twinSent.taMessages.length === 1 && twinSent.referralMessages.length === 0, 'linked referral writes only to its TA twin');

const received = run('ta-received');
check(received.messages.length === 1 && received.messages[0].direction === 'Received', 'received TA message is stored');
check(received.followups.length === 0 && received.response.body.followupN === null, 'received TA message does not add a follow-up row');

const sequenceEffects = run('sequence-side-effects');
check(sequenceEffects.sent.status === 200 && sequenceEffects.afterSent?.step === 1, 'sent TA message advances its active outreach sequence');
check(sequenceEffects.received.status === 200 && sequenceEffects.afterReply?.paused === true && sequenceEffects.afterReply?.pausedAt === '2035-06-07', 'human TA reply pauses its active outreach sequence');

const linkedinEffects = run('linkedin-side-effects');
check(linkedinEffects.response.status === 200
  && linkedinEffects.linkedinStatus === 'Invite Pending'
  && linkedinEffects.connects?.some(entry => entry.source === 'ta' && entry.id === 1 && entry.date === '2035-06-07'),
'sent LinkedIn TA message records the connection request and Invite Pending state');

const internalDates = run('internal-dates');
check(internalDates.response.status === 200
  && internalDates.messages[0]?.timestamp === internalDates.expectedStamp
  && internalDates.row.lastTouch === '2035-06-07'
  && internalDates.followups[0]?.date === '2035-06-07',
'request-only date overrides cannot replace generated correspondence, contact, or follow-up dates');

const errors = run('errors');
check(errors.badPerson.status === 400, 'bad person ref returns 400');
check(errors.badApp.status === 404, 'unknown application returns 404');
check(errors.badSubject.status === 400, 'empty subject returns 400');
check(errors.wrongCompany.status === 400
  && errors.wrongCompany.body.error === "That person is not at this application's company",
'person outside the application company returns the specific 400 error');

const eventOn = run('event-on', true);
check(eventOn.response.status === 200 && eventOn.messages.length === 1 && eventOn.followups.length === 1, 'event-store sent write renders both correspondence and follow-up data');
check(eventOn.events.some(event => event.payload?.reason === 'correspondence_written') && eventOn.events.some(event => event.type === 'message_sent'), 'event-store sent write logs both effects');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox("person-context");
process.env.TJK_DATA_DIR = sandbox;

fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '| 1 | Acme | Doe | Jane |  | Recruiter |  |  |  |  | jane@acme.example | https://linkedin.com/in/jane-doe-ex | Sent |  |  |  |\n' +
  '| 2 | Beta | Roe | Rob |  | Talent Partner |  |  |  |  | rob@beta.example |  | Sent |  |  |  |\n',
  'utf8');

fs.writeFileSync(path.join(sandbox, 'referrals.md'),
  '# Referral tracker\n\n' +
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n' +
  '| 1 | Jane Doe | Former teammate | Acme | Engineer | Asked |  |  | https://www.linkedin.com/in/jane-doe-ex | jane@acme.example |\n',
  'utf8');

fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '| 1 | 2026-08-01 | Acme | Engineer | 4.5 | Applied |  |  |  |  | https://jobs.example/1 |\n',
  'utf8');

fs.mkdirSync(path.join(sandbox, 'target-talent-correspondence'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'referral-correspondence'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'target-talent-correspondence', '1.md'),
  '## 2026-08-02 09:00 | Sent | LinkedIn | Hello\n\nTA message\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'referral-correspondence', '1.md'),
  '## 2026-08-04 10:00 | Sent | Email | Follow up\n\nReferral message\n', 'utf8');

const express = (await import('express')).default;
const { router: targetTalent } = await import('../dashboard-web/server/routes/target-talent.mjs');
const { router: referrals } = await import('../dashboard-web/server/routes/referrals.mjs');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(targetTalent);
app.use(referrals);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed++;
  } else {
    console.log(`  FAIL ${message}`);
    failed++;
  }
}
async function get(route) {
  const response = await fetch(base + route);
  return { status: response.status, body: await response.json() };
}

console.log('person-context.test.mjs');
const ta = await get('/api/target-talent/1');
const referral = await get('/api/referrals/1/detail');
check(ta.status === 200 && referral.status === 200, 'both detail endpoints respond');
check(JSON.stringify(ta.body.person.refs) === JSON.stringify(referral.body.person.refs), 'both endpoints return identical person refs');
check(ta.body.person.refs.includes('ta:1') && ta.body.person.refs.includes('referral:1'), 'shared LinkedIn URL merges both refs');
check(ta.body.timeline.some(event => event.store === 'ta') && ta.body.timeline.some(event => event.store === 'referral'), 'TA detail timeline contains both stores');
check(referral.body.timeline.some(event => event.store === 'ta') && referral.body.timeline.some(event => event.store === 'referral'), 'referral detail timeline contains both stores');
check(ta.body.personLastTouch === '2026-08-04 10:00' && referral.body.personLastTouch === '2026-08-04 10:00', 'last touch is newest outbound event across both stores');
check(Array.isArray(ta.body.correspondence) && Array.isArray(ta.body.relatedApps), 'TA response preserves correspondence and relatedApps');
check(Array.isArray(referral.body.correspondence) && Array.isArray(referral.body.relatedApps), 'referral response preserves correspondence and relatedApps');

const single = await get('/api/target-talent/2');
check(single.body.person.refs.length === 1 && single.body.person.refs[0] === 'ta:2', 'single store contact has one ref');
check(single.body.person.matchedBy === 'single', 'single store contact reports single match');
check(single.status === 200 && single.body.person, 'missing influencer file does not prevent resolution');
check(!fs.existsSync(path.join(sandbox, 'contact-links.json')), 'detail reads do not create contact links');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try {
  const undici = await import('undici');
  await undici.getGlobalDispatcher().close();
} catch {}
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

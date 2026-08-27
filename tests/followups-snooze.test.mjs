#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('followups-snooze');
process.env.TJK_DATA_DIR = sandbox;

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/followups.mjs');
const { router: referralsRouter } = await import('../dashboard-web/server/routes/referrals.mjs');
const { appendReferralRows, REFERRAL_HEADER } = await import('../dashboard-web/server/lib/referrals.mjs');
const { readSnooze, writeSnooze, readMute, isMuted } = await import('../dashboard-web/server/lib/sidecars.mjs');

// A referral only reaches the queue when there is a LIVE APPLICATION at its
// employer, so the fixture needs one or nothing is ever queued and every
// assertion below passes vacuously. Rows are written with the canonical
// tracker writers, never hand-rolled.
const { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine } = await import('../lib/tracker.mjs');
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
   formatTrackerLine({
     num: 9001, date: '2026-08-01', company: 'Example Company', role: 'Staff Engineer',
     score: '4.0/5', status: 'Applied', pdf: '', resume: '', report: '', notes: '', url: '',
   }), ''].join('\n'), 'utf8');

// Seed the book so appendReferralRows (which assigns max+1) lands these on
// 7001..7007. Fixture ids must match no real contact row: a low integer beside a
// comment about two books sharing an id turns the number into a pointer at a real
// person, which is the reason the other suites were moved into this band too.
fs.writeFileSync(path.join(sandbox, 'referrals.md'), REFERRAL_HEADER, 'utf8');
appendReferralRows([{ name: 'Seed Row', how: 'Former colleague', where: 'Example Company', status: 'No' }]);
{
  const seeded = fs.readFileSync(path.join(sandbox, 'referrals.md'), 'utf8')
    .replace(/^\| 1 \|/m, '| 7000 |');
  fs.writeFileSync(path.join(sandbox, 'referrals.md'), seeded, 'utf8');
}

for (let i = 1; i <= 7; i++) {
  appendReferralRows([{
    name: `Referral Person ${i}`,
    how: 'Former colleague',
    where: 'Example Company',
    target: 'Engineering',
    status: 'Not Asked',
    linkedin: `linkedin.com/in/referral-person-${i}`,
  }]);
}

const app = express();
app.use(express.json());
app.use(router);
app.use(referralsRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (url, body) => fetch(base + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json().catch(() => ({})) }));
const getQueue = () => fetch(base + '/api/followups/queue').then(response => response.json()).then(body => body.queue || []);
const getReferralQueue = () => fetch(base + '/api/referrals/followups').then(response => response.json()).then(body => body.queue || []);

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  console.log(`  ok ${message}`);
  passed++;
};

console.log('followups-snooze.test.mjs');

let response = await post('/api/followups/snooze', { source: 'referral', id: 7007, days: 14 });
check(response.status === 200, 'snoozing a referral returns 200');
check(!!readSnooze().referral['7007'], 'referral snooze is written to the referral bucket');

response = await post('/api/followups/snooze', { source: 'influencer', id: 7007, days: 14 });
check(response.status === 200 && !!readSnooze().influencer['7007'], 'snoozing an influencer returns 200');

response = await post('/api/followups/snooze', { source: 'unknown', id: 7007, days: 14 });
check(response.status === 400, 'an unknown snooze source still returns 400');

let queue = await getQueue();
check(!queue.some(row => row.source === 'referral'), 'the main queue excludes referrals');
queue = await getReferralQueue();
check(!queue.some(row => row.source === 'referral' && row.id === 7007), 'a snoozed referral is absent from the referral queue');
check(!readSnooze().app['7007'], 'snoozing referral 7007 leaves application 7007 untouched');

const expired = readSnooze();
expired.referral['7007'] = '2000-01-01';
writeSnooze(expired);
queue = await getReferralQueue();
check(queue.some(row => row.source === 'referral' && row.id === 7007), 'a referral returns after its snooze date has passed');

fs.writeFileSync(path.join(sandbox, 'followup-snooze.json'), JSON.stringify({
  app: { '1': '2099-01-01' },
  ta: { '2': '2099-01-02' },
  contactless: { '3': '2099-01-03' },
}, null, 2));
const legacySnooze = readSnooze();
check(legacySnooze.app['1'] === '2099-01-01' && legacySnooze.ta['2'] === '2099-01-02' && legacySnooze.contactless['3'] === '2099-01-03', 'legacy snooze buckets remain intact');
check(Object.keys(legacySnooze.referral).length === 0 && Object.keys(legacySnooze.influencer).length === 0, 'new snooze buckets default to empty objects');

fs.writeFileSync(path.join(sandbox, 'followup-mute.json'), JSON.stringify({ '7012': true }, null, 2));
check(isMuted(7012) && readMute().app['7012'], 'a legacy flat mute file reads application 7012 as muted');

response = await post('/api/followups/mute', { source: 'referral', id: 7007 });
check(response.status === 200 && isMuted(7007, 'referral'), 'referral 7007 can be muted');
check(!isMuted(7007, 'app'), 'referral 7007 and application 7007 mute independently');
queue = await getReferralQueue();
check(!queue.some(row => row.source === 'referral' && row.id === 7007), 'a muted referral is absent from the referral queue');

response = await post('/api/followups/unmute', { source: 'referral', id: 7007 });
check(response.status === 200 && !isMuted(7007, 'referral'), 'referral 7007 can be unmuted');
queue = await getReferralQueue();
check(queue.some(row => row.source === 'referral' && row.id === 7007), 'unmuting returns the referral row');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(`${passed} passed, 0 failed`);

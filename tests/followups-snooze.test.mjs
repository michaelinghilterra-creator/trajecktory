#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('followups-snooze');
process.env.TJK_DATA_DIR = sandbox;

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/followups.mjs');
const { appendReferralRows } = await import('../dashboard-web/server/lib/referrals.mjs');
const { readSnooze, writeSnooze, readMute, isMuted } = await import('../dashboard-web/server/lib/sidecars.mjs');

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
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (url, body) => fetch(base + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json().catch(() => ({})) }));
const getQueue = () => fetch(base + '/api/followups/queue').then(response => response.json()).then(body => body.queue || []);

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  console.log(`  ok ${message}`);
  passed++;
};

console.log('followups-snooze.test.mjs');

let response = await post('/api/followups/snooze', { source: 'referral', id: 7, days: 14 });
check(response.status === 200, 'snoozing a referral returns 200');
check(!!readSnooze().referral['7'], 'referral snooze is written to the referral bucket');

response = await post('/api/followups/snooze', { source: 'influencer', id: 7, days: 14 });
check(response.status === 200 && !!readSnooze().influencer['7'], 'snoozing an influencer returns 200');

response = await post('/api/followups/snooze', { source: 'unknown', id: 7, days: 14 });
check(response.status === 400, 'an unknown snooze source still returns 400');

let queue = await getQueue();
check(!queue.some(row => row.source === 'referral' && row.id === 7), 'a snoozed referral is absent from the queue');
check(!readSnooze().app['7'], 'snoozing referral 7 leaves application 7 untouched');

const expired = readSnooze();
expired.referral['7'] = '2000-01-01';
writeSnooze(expired);
queue = await getQueue();
check(queue.some(row => row.source === 'referral' && row.id === 7), 'a referral returns after its snooze date has passed');

fs.writeFileSync(path.join(sandbox, 'followup-snooze.json'), JSON.stringify({
  app: { '1': '2099-01-01' },
  ta: { '2': '2099-01-02' },
  contactless: { '3': '2099-01-03' },
}, null, 2));
const legacySnooze = readSnooze();
check(legacySnooze.app['1'] === '2099-01-01' && legacySnooze.ta['2'] === '2099-01-02' && legacySnooze.contactless['3'] === '2099-01-03', 'legacy snooze buckets remain intact');
check(Object.keys(legacySnooze.referral).length === 0 && Object.keys(legacySnooze.influencer).length === 0, 'new snooze buckets default to empty objects');

fs.writeFileSync(path.join(sandbox, 'followup-mute.json'), JSON.stringify({ '12': true }, null, 2));
check(isMuted(12) && readMute().app['12'], 'a legacy flat mute file reads application 12 as muted');

response = await post('/api/followups/mute', { source: 'referral', id: 7 });
check(response.status === 200 && isMuted(7, 'referral'), 'referral 7 can be muted');
check(!isMuted(7, 'app'), 'referral 7 and application 7 mute independently');
queue = await getQueue();
check(!queue.some(row => row.source === 'referral' && row.id === 7), 'a muted referral is absent from the queue');

response = await post('/api/followups/unmute', { source: 'referral', id: 7 });
check(response.status === 200 && !isMuted(7, 'referral'), 'referral 7 can be unmuted');
queue = await getQueue();
check(queue.some(row => row.source === 'referral' && row.id === 7), 'unmuting returns the referral row');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(`${passed} passed, 0 failed`);

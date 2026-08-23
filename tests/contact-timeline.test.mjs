#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTimeline, buildDisplayTimeline, personLastTouch } from '../dashboard-web/server/lib/contact-timeline.mjs';

const person = { members: { ta: { id: 1 }, referral: { id: 2 } } };
const correspondence = {
  'ta:1': [
    { timestamp: '2026-08-02', direction: 'Sent', channel: 'Email', subject: 'Hello', body: 'First' },
    { timestamp: '2026-08-03', direction: 'Draft', channel: 'Email', subject: 'Draft', body: 'Saved' },
  ],
  'referral:2': [{ timestamp: '2026-08-01 09:00', direction: 'Received', channel: 'Email', subject: 'Re', body: 'Reply' }],
};
const opts = { correspondence, linkedinMap: {}, engagementLog: [] };
assert.deepEqual(buildTimeline(person, opts).map(event => event.at), ['2026-08-01 09:00', '2026-08-02', '2026-08-03']);
assert.deepEqual(buildTimeline(person, opts), buildTimeline(person, opts));
assert.equal(buildTimeline(person, opts).some(event => event.direction === 'Draft'), true);
assert.equal(personLastTouch(person, opts), '2026-08-02');

const screenshot = {
  correspondence: { 'ta:1': [{ timestamp: '2026-08-01', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request', body: 'Connect' }] },
  linkedinMap: { 1: { state: 'Connected', updated: '2026-08-05' } },
  engagementLog: [],
};
assert.deepEqual(buildTimeline({ members: { ta: { id: 1 } } }, screenshot).map(event => event.kind), ['invite-sent', 'invite-accepted']);
assert.equal(personLastTouch({ members: { ta: { id: 1 } } }, screenshot), '2026-08-01');

const duplicateOpts = {
  correspondence: {
    'ta:1': [
      { timestamp: '2026-08-06 08:00', direction: 'Sent', channel: 'Email', subject: 'A', body: 'Same body' },
      { timestamp: '2026-08-06 09:00', direction: 'Sent', channel: 'Email', subject: 'B', body: 'Same body' },
    ],
    'referral:2': [{ timestamp: '2026-08-06', direction: 'Sent', channel: 'Email', subject: 'C', body: ' same  body ' }],
  },
  linkedinMap: {}, engagementLog: [],
};
assert.equal(buildTimeline(person, duplicateOpts).length, 3);
const display = buildDisplayTimeline(person, duplicateOpts);
assert.equal(display.length, 2);
assert.equal(display.filter(event => event.store === 'ta').length, 2);

console.log('contact-timeline.test.mjs passed');

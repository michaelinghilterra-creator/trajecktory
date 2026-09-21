#!/usr/bin/env node
/**
 * due-sequence-contacts.test.mjs - sequence due-date and channel-gating coverage
 * for computeDueSequenceContacts(), using the real application cadence template.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('due-sequence-contacts');
process.env.TJK_DATA_DIR = sandbox;

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = localDate();
const past = localDate(-3);
const future = localDate(3);
const oldTouch = localDate(-20);
const sequenceId = 'application-day-0-1-5-12';

const sequences = {
  'ta:1': { sequenceId, startedAt: oldTouch, step: 2, nextStepDue: today, paused: false, completedAt: null, firstChannel: 'linkedin' },
  'ta:2': { sequenceId, startedAt: today, step: 0, nextStepDue: future, paused: false, completedAt: null },
  'ta:3': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: true, completedAt: null },
  'ta:4': { sequenceId, startedAt: oldTouch, step: 4, nextStepDue: null, paused: false, completedAt: today },
  'ta:5': { sequenceId, startedAt: oldTouch, step: 2, nextStepDue: past, paused: false, completedAt: null, firstChannel: 'linkedin' },
  'ta:6': { sequenceId, startedAt: oldTouch, step: 1, nextStepDue: past, paused: false, completedAt: null, firstChannel: 'email' },
  'ta:7': { sequenceId, startedAt: today, step: 0, nextStepDue: today, paused: false, completedAt: null },
  'ta:8': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: false, completedAt: null },
  'ta:9': { sequenceId, startedAt: oldTouch, step: 3, nextStepDue: past, paused: false, completedAt: null, firstChannel: 'linkedin' },
  'ta:10': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: false, completedAt: null },
  'ta:12': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: false, completedAt: null },
  'referral:11': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: false, completedAt: null },
};
fs.writeFileSync(path.join(sandbox, 'contact-sequences.json'), JSON.stringify(sequences, null, 2));

const email = id => `contact${id}@example.test [v:ok:test:${today}:90]`;
const linkedin = id => `linkedin.com/in/contact-${id}`;
const contactRow = ({ id, company = 'Brightwave Labs', emailCell = '', linkedinUrl = '', notes = '', status = 'Sent' }) =>
  `| ${id} | ${company} | Example | Contact${id} |  | Platform Leader |  |  |  |  | ${emailCell} | ${linkedinUrl} | ${status} | ${oldTouch} | ${notes} |  |`;

fs.writeFileSync(path.join(sandbox, 'target-talent.md'), [
  '# Target Talent',
  '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  contactRow({ id: 1, emailCell: email(1), linkedinUrl: linkedin(1), notes: '[tier:hm] row-shape fixture' }),
  contactRow({ id: 2, emailCell: email(2), linkedinUrl: linkedin(2) }),
  contactRow({ id: 3, emailCell: email(3), linkedinUrl: linkedin(3) }),
  contactRow({ id: 4, emailCell: email(4), linkedinUrl: linkedin(4) }),
  contactRow({ id: 5, linkedinUrl: linkedin(5) }),
  contactRow({ id: 6, emailCell: email(6) }),
  contactRow({ id: 7, linkedinUrl: linkedin(7) }),
  contactRow({ id: 8, company: 'Dormant Works', emailCell: email(8), linkedinUrl: linkedin(8) }),
  contactRow({ id: 9, emailCell: email(9) }),
  contactRow({ id: 10 }),
  contactRow({ id: 11, emailCell: email(11), linkedinUrl: linkedin(11) }),
  contactRow({ id: 12, emailCell: email(12), linkedinUrl: linkedin(12), status: 'Archived' }),
  '',
].join('\n'), 'utf8');

const { computeDueSequenceContacts } = await import('../dashboard-web/server/lib/followups.mjs');
const { getActiveSequences, getTemplate } = await import('../dashboard-web/server/lib/sequences.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('due-sequence-contacts.test.mjs');
check(getTemplate(sequenceId)?.id === sequenceId, 'uses the real application cadence template');
check(!getActiveSequences().some(entry => entry.key === 'ta:4'), 'completed sequences are excluded from active sequences');

const apps = [
  { company: 'Brightwave Labs', status: 'Applied' },
  { company: 'Dormant Works', status: 'Rejected' },
];
const result = computeDueSequenceContacts({ apps });
const ids = new Set(result.map(row => row.id));

check(ids.has(1) && ids.has(7) && ids.has(9), 'steps due today or in the past surface');
check(!ids.has(2), 'a future sequence step does not surface');
check(!ids.has(3), 'a paused sequence does not surface');
check(!ids.has(4), 'a completed sequence does not surface');
check(!ids.has(5), 'an email step is gated when the contact has no email');
check(!ids.has(6), 'a LinkedIn step is gated when the contact has no LinkedIn');
check(ids.has(7) && result.find(row => row.id === 7)?.channel === 'linkedin',
  'an either-channel step surfaces with the available channel');
check(!ids.has(8), 'a contact without a live application is ineligible');
check(!ids.has(10), 'an either-channel step is gated when the contact has no channel');
check(!ids.has(11), 'unsupported non-TA sequence sources do not surface');
check(!ids.has(12), 'an archived contact with an otherwise-due sequence does not surface');

const shaped = result.find(row => row.id === 1);
const expectedFields = [
  'source', 'id', 'company', 'role', 'score', 'status', 'applyDate', 'lastTouchDate',
  'daysSinceLastTouch', 'daysSinceApply', 'fuCount', 'cap', 'coachVerdict', 'coachLevel',
  'klass', 'muted', 'channelBucket', 'hasEmail', 'hasLinkedIn', 'channel', 'sector',
  'notes', 'followups', 'taFirst', 'taLast', 'taEmail', 'linkedin', 'isPrincipal',
];
check(shaped && expectedFields.every(field => Object.hasOwn(shaped, field)), 'row preserves the complete stale-contact shape');
check(shaped?.coachVerdict === 'First follow-up due (day 5).', 'coach verdict names the due template touch');
check(shaped?.coachLevel === 'overdue' && shaped?.fuCount === 2 && shaped?.cap === 4,
  'row carries overdue level and sequence progress');
check(shaped?.channelBucket === 3 && shaped?.hasEmail === true && shaped?.hasLinkedIn === true,
  'row carries channel bucket and availability flags');
check(shaped?.isPrincipal === true, 'row carries the parsed hiring-principal flag');

console.log(`\ndue sequence contacts: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

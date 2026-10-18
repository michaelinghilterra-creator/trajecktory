#!/usr/bin/env node
import { contactIdsToRevive, reviveNotes, withWasTag } from '../dashboard-web/server/lib/contact-revive.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++;
  } else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('contact-revive.test.mjs');

const apps = [
  { id: 1, company: 'Alpha Works Software', status: 'Applied', date: '2031-01-10' },
  { id: 2, company: 'Beta Labs', status: 'Rejected', date: '2031-01-11' },
];
const rows = [
  { id: 11, company: 'Alpha Works', status: 'Archived', lastTouch: '2031-01-12', notes: 'Warm reply · [was:Replied]' },
  { id: 12, company: 'Alpha Works', status: 'Archived', lastTouch: '', notes: 'Archived 2031-01-13: left the company' },
  { id: 13, company: 'Alpha Works', status: 'Archived', lastTouch: '', notes: '[no-revive]' },
  { id: 14, company: 'Beta Labs', status: 'Archived', lastTouch: '2031-01-14', notes: '' },
  { id: 15, company: 'Other Example', status: 'Archived', lastTouch: '', notes: '' },
  { id: 16, company: 'Alpha Works', status: 'Archived', lastTouch: '2031-01-15', notes: 'No prior tag' },
  { id: 17, company: 'Alpha Works', status: 'Archived', lastTouch: '', notes: 'No prior tag' },
];

const revived = contactIdsToRevive(apps, rows, 'Alpha Works Software');
check(JSON.stringify(revived.map(row => row.id)) === JSON.stringify([11, 16, 17]), 'only automatic archives at a live alias company qualify');
check(revived.find(row => row.id === 11)?.status === 'Replied', 'a real status in the was tag is restored');
check(revived.find(row => row.id === 16)?.status === 'Sent', 'last touch falls back to Sent');
check(revived.find(row => row.id === 17)?.status === 'Not Contacted', 'no last touch falls back to Not Contacted');
check(!revived.some(row => row.id === 12), 'manual archive marker is skipped');
check(!revived.some(row => row.id === 13), 'no-revive tag is skipped');
check(!revived.some(row => row.id === 15), 'other company is skipped');
check(contactIdsToRevive(apps, rows, 'Beta Labs').length === 0, 'a live application is required');

const tagged = withWasTag('Useful context', 'Meeting Scheduled');
check(tagged === 'Useful context · [was:Meeting Scheduled]', 'withWasTag appends the prior status');
check(reviveNotes(tagged) === 'Useful context', 'was tag round trip restores the original notes');
check(withWasTag('Context · [was:Sent]', 'Replied') === 'Context · [was:Replied]', 'withWasTag replaces an existing tag');
check(withWasTag('Context', 'Archived') === 'Context', 'Archived is never recorded as a prior status');
check(reviveNotes('[was:Sent] · Context') === 'Context', 'reviveNotes removes a leading tag and separator');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

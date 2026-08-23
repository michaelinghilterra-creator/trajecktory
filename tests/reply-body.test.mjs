#!/usr/bin/env node
/**
 * reply-body.test.mjs: full inbound reply body retention and safe projection.
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

// SANDBOX FIRST. config.mjs resolves DATA_DIR at import time, so this assignment
// must precede the dynamic imports below. Static imports would be hoisted and
// could make this test write to the real user data directory.
const tmp = makeSandbox('reply-body');
process.env.TJK_DATA_DIR = tmp;

const {
  scanDecisions, logReplyToContact, previewEntry, MAX_CORR_BODY,
} = await import('../dashboard-web/server/lib/google.mjs');
const { TARGET_TALENT_MD } = await import('../dashboard-web/server/config.mjs');
const { readTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const gmailMessage = ({ id, body, snippet, subject = 'Application update' }) => ({
  id, snippet,
  payload: {
    headers: [
      { name: 'From', value: 'Recruiter <recruiter@fictional.example>' },
      { name: 'Subject', value: subject },
      { name: 'Date', value: 'Mon, 10 Aug 2026 14:30:00 +0000' },
    ],
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/plain', body: { data: b64(body) } }],
  },
});

console.log('reply-body.test.mjs');
check(TARGET_TALENT_MD.startsWith(tmp), 'contact writes are sandboxed');
fs.mkdirSync(path.dirname(TARGET_TALENT_MD), { recursive: true });
fs.writeFileSync(TARGET_TALENT_MD, [
  '# Target Talent', '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | Fictional Labs | Finch | River | | Recruiter | | | | | recruiter@fictional.example | | Sent | 2026-08-01 | | |', '',
].join('\n'));

const marker = 'BODY_MARKER_NEAR_800';
const body900 = 'A'.repeat(780) + marker + 'B'.repeat(100);
const snippet180 = 'S'.repeat(180);
const decisions = scanDecisions({
  messages: [gmailMessage({ id: 'm1', body: body900, snippet: snippet180 })],
  taRows: [{ id: 1, source: 'ta', name: 'River Finch', company: 'Fictional Labs', email: 'recruiter@fictional.example' }],
});
const reply = decisions.replies[0];
check(reply.body.length > 200, 'scan decision carries more than 200 body characters');
check(reply.body !== reply.snippet, 'full body differs from snippet');
check(reply.snippet === snippet180, 'snippet remains present and unchanged');

logReplyToContact({ source: 'ta', id: 1 }, { subject: 'Application update', body: body900, timestamp: '2026-08-10T14:30:00Z', advanceStatus: false });
let stored = readTTCorrespondence(1);
check(stored[0].body.length > 200, 'contact card retains more than 200 characters');
check(stored[0].body.includes(marker), 'contact card retains a marker near character 800');

const longBody = 'L'.repeat(MAX_CORR_BODY + 500);
logReplyToContact({ source: 'ta', id: 1 }, { subject: 'Long reply', body: longBody, timestamp: '2026-08-11T14:30:00Z', advanceStatus: false });
stored = readTTCorrespondence(1);
const longStored = stored.find(m => m.subject === 'Long reply').body;
check(longStored.length <= MAX_CORR_BODY, 'overlong body respects the correspondence cap');
check(longStored.endsWith('[Message truncated at 20000 characters]'), 'overlong body has an explicit truncation marker');

logReplyToContact({ source: 'ta', id: 1 }, { subject: 'Heading reply', body: 'First line\n## 2026-01-01 | Sent | Fake split\nLast line', timestamp: '2026-08-12T14:30:00Z', advanceStatus: false });
stored = readTTCorrespondence(1);
check(stored.filter(m => m.subject === 'Heading reply').length === 1, 'heading-like body line remains one correspondence message');
check(stored.length === 3, 'body heading does not create a phantom correspondence entry');

const projected = previewEntry({ msgId: 'm2', body: 'P'.repeat(1500), snippet: 'short' });
check(projected.bodyPreview.length <= 1000, 'list body preview is bounded');
check(projected.bodyChars === 1500, 'list projection reports full body length');
check(!Object.prototype.hasOwnProperty.call(projected, 'body'), 'list projection removes the body property');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

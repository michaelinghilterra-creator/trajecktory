#!/usr/bin/env node
/**
 * linkedin-acceptance.test.mjs — the "acceptance → warm motion" pieces:
 *   - detectAcceptances: an exact LinkedIn-slug match against a fresh Connections
 *     import auto-flips an Invite-Pending TA contact to Connected (and never a
 *     non-match). computePendingAcceptances surfaces name+company matches to confirm.
 *   - computeJustConnectedQueue: a connected-but-not-yet-messaged contact at a live
 *     application surfaces as "Just connected"; gated / already-DM'd ones drop.
 *
 * All fixtures are invented contacts at .example handles — no real personal data.
 * Sandbox TJK_DATA_DIR BEFORE importing so every file read/write is hermetic.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-liaccept-'));
process.env.TJK_DATA_DIR = sandbox;

const { detectAcceptances, computePendingAcceptances } = await import('../dashboard-web/server/lib/linkedin-acceptance.mjs');
const { computeJustConnectedQueue } = await import('../dashboard-web/server/lib/followups.mjs');
const { setLinkedInStatus, readLinkedInMap } = await import('../dashboard-web/server/lib/tt-linkedin.mjs');
const { saveConnections } = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');
const { writeTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { isLinkedInEntry } = await import('../dashboard-web/server/lib/channels.mjs');

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('linkedin-acceptance.test.mjs');

// ── detectAcceptances ─────────────────────────────────────────────────────────
setLinkedInStatus(1, 'Invite Pending', '2023-05-01');   // will slug-match → flips
setLinkedInStatus(2, 'Invite Pending', '2023-05-01');   // name+company only → stays, confirm
setLinkedInStatus(3, 'Invite Pending', '2023-05-01');   // shared name, different company → no match

const taRows = [
  { id: 1, first: 'Jane', last: 'Doe', company: 'Acme',  linkedin: 'linkedin.com/in/jane-doe-ex', email: '' },
  { id: 2, first: 'John', last: 'Roe', company: 'Beta',  linkedin: 'linkedin.com/in/john-roe-ex', email: '' },
  { id: 3, first: 'Jane', last: 'Doe', company: 'Gamma', linkedin: '', email: '' },
];
const connections = [
  { first: 'Jane', last: 'Doe', url: 'https://www.linkedin.com/in/jane-doe-ex/', company: 'Acme', position: 'Recruiter', on: '18 May 2023' },
  { first: 'John', last: 'Roe', url: 'https://www.linkedin.com/in/someone-else-ex/', company: 'Beta', position: 'Recruiter', on: '19 May 2023' },
];
const { flipped } = detectAcceptances({ connections, taRows });
check(flipped.length === 1 && flipped[0].id === 1, 'exact slug match auto-flips exactly the matched contact');
check(readLinkedInMap()['1']?.state === 'Connected', 'sidecar flipped to Connected');
check(readLinkedInMap()['1']?.updated === '2023-05-18', 'acceptance date parsed from "Connected On"');
check(readLinkedInMap()['2']?.state === 'Invite Pending', 'name+company-only match is NOT auto-flipped');
check(readLinkedInMap()['3']?.state === 'Invite Pending', 'shared name at a different company is NOT touched');

// ── computePendingAcceptances ─────────────────────────────────────────────────
saveConnections(connections);
const pending = computePendingAcceptances({ taRows });
const pendIds = pending.map(p => p.id);
check(pendIds.includes(2), 'name+company match surfaces as a confirm candidate');
check(!pendIds.includes(1), 'a slug-matched (already flipped) contact is not a confirm candidate');
check(!pendIds.includes(3), 'a shared name at a different company is not a false confirm candidate');

// ── computeJustConnectedQueue ─────────────────────────────────────────────────
setLinkedInStatus(10, 'Connected', '2023-06-01');
setLinkedInStatus(11, 'Connected', '2023-06-01');
const taRows2 = [
  { id: 10, first: 'Amy', last: 'Lin', company: 'Acme', status: 'Sent', linkedin: 'linkedin.com/in/amy-lin-ex', email: '', linkedinStatus: 'Connected' },
  { id: 11, first: 'Bo',  last: 'Kay', company: 'Zeta', status: 'Sent', linkedin: 'linkedin.com/in/bo-kay-ex',  email: '', linkedinStatus: 'Connected' },
  { id: 12, first: 'Cy',  last: 'Fox', company: 'Acme', status: 'Sent', linkedin: 'linkedin.com/in/cy-fox-ex',  email: '', linkedinStatus: 'Not Connected' },
];
const apps = [{ company: 'Acme', status: 'Applied' }];   // Zeta not applied
const q = computeJustConnectedQueue({ taRows: taRows2, apps });
const qIds = q.map(r => r.id);
check(qIds.includes(10), 'connected + live application + no DM surfaces');
check(!qIds.includes(11), 'connected but no live application is gated out');
check(!qIds.includes(12), 'a not-connected contact is gated out');
const row10 = q.find(r => r.id === 10);
check(row10?.queueReason === 'Just connected' && row10?.freeDm === true && row10?.channel === 'linkedin', 'row is tagged Just connected / freeDm / linkedin');

writeTTCorrespondence(10, [{ timestamp: '2023-06-05 10:00', direction: 'Sent', channel: 'LinkedIn', subject: 'Great to connect', body: 'hello' }]);
const q2 = computeJustConnectedQueue({ taRows: taRows2, apps });
check(!q2.map(r => r.id).includes(10), 'a LinkedIn DM sent after connecting drops the contact from the queue');

// ── Regression (the Patricia bug): a LinkedIn DM logged WITHOUT a proper channel
//    tag — the pre-fix writer stored channel=Email with subject "LinkedIn message",
//    and some Saturday entries came through as uppercase "LINKEDIN" — must STILL
//    count as a LinkedIn touch. Otherwise the warm queue can't see it and re-pitches
//    someone already messaged.
setLinkedInStatus(20, 'Connected', '2023-06-01');
setLinkedInStatus(21, 'Connected', '2023-06-01');
setLinkedInStatus(22, 'Connected', '2023-06-01');
const taRows3 = [
  { id: 20, first: 'Di', last: 'One', company: 'Acme', status: 'Sent', linkedin: 'linkedin.com/in/di-one-ex', email: '', linkedinStatus: 'Connected' },
  { id: 21, first: 'El', last: 'Two', company: 'Acme', status: 'Sent', linkedin: 'linkedin.com/in/el-two-ex', email: '', linkedinStatus: 'Connected' },
  { id: 22, first: 'Fi', last: 'Six', company: 'Acme', status: 'Sent', linkedin: 'linkedin.com/in/fi-six-ex', email: '', linkedinStatus: 'Connected' },
];
writeTTCorrespondence(20, [{ timestamp: '2023-06-05 10:00', direction: 'Sent', channel: 'Email',    subject: 'LinkedIn message', body: 'hi' }]);  // untagged (defaults Email)
writeTTCorrespondence(21, [{ timestamp: '2023-06-05 10:00', direction: 'Sent', channel: 'LINKEDIN',  subject: 'follow up',       body: 'hi' }]);  // uppercase channel token
writeTTCorrespondence(22, [{ timestamp: '2023-06-05 10:00', direction: 'Sent', channel: 'Email',    subject: 'LINKEDIN MESSAGE', body: 'hi' }]);  // uppercase subject, no channel (Saturday shape)
const q3ids = computeJustConnectedQueue({ taRows: taRows3, apps }).map(r => r.id);
check(!q3ids.includes(20), 'untagged LinkedIn DM (subject "LinkedIn message") drops the contact');
check(!q3ids.includes(21), 'uppercase LINKEDIN channel token round-trips and drops the contact');
check(!q3ids.includes(22), 'uppercase "LINKEDIN MESSAGE" subject counts and drops the contact');

// Direct classifier unit checks
check(isLinkedInEntry({ channel: 'Email', subject: 'LinkedIn message' }) === true,  'isLinkedInEntry: untagged LinkedIn-message subject → true');
check(isLinkedInEntry({ channel: 'LINKEDIN', subject: 'x' }) === true,               'isLinkedInEntry: LINKEDIN channel (any case) → true');
check(isLinkedInEntry({ channel: 'Email', subject: 'LINKEDIN MESSAGE' }) === true,   'isLinkedInEntry: uppercase LinkedIn subject → true');
check(isLinkedInEntry({ channel: 'Email', subject: 'Re: your application' }) === false, 'isLinkedInEntry: a real email subject → false');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);

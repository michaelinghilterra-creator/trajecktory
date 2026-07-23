#!/usr/bin/env node
/**
 * connect-queue.test.mjs — unit tests for the LinkedIn connect-queue build.
 *
 * Covers three pieces that let us reach people we cannot email:
 *   1. computeConnectQueue (followups.mjs): who lands in the queue — a real
 *      LinkedIn handle, no sendable email, not already connected/archived.
 *   2. channelFor (followups.mjs): the warm/cold channel picker, pinned to the
 *      corrected rule that an UNVERIFIED address is not an email channel.
 *   3. fitConnectNote / buildConnectPrompt (linkedin-ssi.mjs): the shared 300-char
 *      trimmer and the generic prompt assembler behind the note generator.
 *
 * All fixtures are invented contacts at .example domains — no real personal data.
 *
 * Run: node tests/connect-queue.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { computeConnectQueue, channelFor } from '../dashboard-web/server/lib/followups.mjs';
import { fitConnectNote, buildConnectPrompt } from '../dashboard-web/server/lib/linkedin-ssi.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('connect-queue.test.mjs');

// ── Fixtures: invented TA + recruiter rows, shaped like the parser output ─────
const ta = (o) => ({
  id: o.id, first: o.first, last: o.last, title: o.title, company: o.company,
  email: o.email || '', verified: { state: o.state || 'unverified' },
  linkedin: o.linkedin || '', status: o.status, notes: o.notes || '',
});
const rec = (o) => ({
  id: o.id, first: o.first, last: o.last, title: o.title, firm: o.firm,
  email: o.email || '', verified: { state: o.state || 'unverified' },
  linkedin: o.linkedin || '', status: o.status, notes: o.notes || '',
});

const taRows = [
  // live verified email → belongs to the email motion, NOT the connect queue
  ta({ id: 1, first: 'Dana', last: 'Whitlock', title: 'VP Talent', company: 'Brightwave Labs',
       email: 'dana.whitlock@brightwave.example', state: 'ok',
       linkedin: 'linkedin.com/in/dana-whitlock-ex', status: 'Sent' }),
  // hard-bounced email + LinkedIn → IN the queue
  ta({ id: 2, first: 'Reese', last: 'Calder', title: 'Head of TA', company: 'Northwind Robotics',
       email: 'reese.calder@northwind.example', state: 'bounced',
       linkedin: 'linkedin.com/in/reese-calder-ex', status: 'Bounced' }),
  // unverified email + LinkedIn → IN the queue (unverified is not sendable)
  ta({ id: 3, first: 'Alex', last: 'Moreno', title: 'Recruiting Lead', company: 'Cobalt Systems',
       email: 'alex.moreno@cobalt.example', state: 'unverified',
       linkedin: 'linkedin.com/in/alex-moreno-ex', status: 'Not Contacted' }),
  // already a 1st-degree connection → excluded (message directly, no request)
  ta({ id: 4, first: 'Sam', last: 'Ito', title: 'Director TA', company: 'Umbra Tech',
       linkedin: 'linkedin.com/in/sam-ito-ex', status: 'Connected' }),
  // dead opportunity → excluded
  ta({ id: 5, first: 'Jo', last: 'Park', title: 'TA Lead', company: 'Vela Analytics',
       linkedin: 'linkedin.com/in/jo-park-ex', status: 'Archived' }),
  // no LinkedIn handle → not reachable here, excluded
  ta({ id: 6, first: 'Chris', last: 'Vaughn', title: 'CTO', company: 'Delta Forge',
       status: 'Not Contacted' }),
  // org-blocked mailbox ("reach on LinkedIn") + LinkedIn → IN the queue
  ta({ id: 7, first: 'Morgan', last: 'Yee', title: 'VP People', company: 'Aster Grid',
       email: 'morgan.yee@aster.example', state: 'blocked',
       linkedin: 'linkedin.com/in/morgan-yee-ex', status: 'Blocked' }),
  // NO email on file at all, only a LinkedIn handle → IN the queue, and the "find
  // an address" case that must read differently from "address present, unverified"
  ta({ id: 8, first: 'Tay', last: 'Okonkwo', title: 'Head of People', company: 'Meridian AI',
       linkedin: 'linkedin.com/in/tay-okonkwo-ex', status: 'Not Contacted' }),
];

const recruiterRows = [
  // risky (catch-all) counts as sendable → email motion, NOT the queue
  rec({ id: 101, first: 'Pat', last: 'Lindqvist', title: 'Partner', firm: 'Keystone Search',
        email: 'pat@keystone.example', state: 'risky',
        linkedin: 'linkedin.com/in/pat-lindqvist-ex', status: 'Sent' }),
  // invalid mailbox + LinkedIn → IN the queue, company drawn from `firm`
  rec({ id: 102, first: 'Robin', last: 'Achebe', title: 'Managing Director', firm: 'Halcyon Partners',
        email: 'robin@halcyon.example', state: 'invalid',
        linkedin: 'linkedin.com/in/robin-achebe-ex', status: 'Dormant' }),
];

// ── computeConnectQueue ──────────────────────────────────────────────────────
const q = computeConnectQueue({ taRows, recruiterRows });
const ids = q.map(r => `${r.source}:${r.id}`);

check(q.length === 5, `queue holds exactly the 5 reachable-only contacts (got ${q.length})`);
check(ids.includes('ta:2'), 'bounced-email TA contact with LinkedIn is queued');
check(ids.includes('ta:3'), 'unverified-email TA contact with LinkedIn is queued');
check(ids.includes('ta:7'), 'org-blocked TA contact with LinkedIn is queued');
check(ids.includes('ta:8'), 'no-email TA contact with only a LinkedIn handle is queued');
check(ids.includes('recruiter:102'), 'invalid-email recruiter with LinkedIn is queued');
check(!ids.includes('ta:1'), 'contact with a verified email is NOT queued (email motion)');
check(!ids.includes('recruiter:101'), 'recruiter with a risky-but-sendable email is NOT queued');
check(!ids.includes('ta:4'), 'already-Connected contact is NOT queued');
check(!ids.includes('ta:5'), 'Archived (dead-opp) contact is NOT queued');
check(!ids.includes('ta:6'), 'contact with no LinkedIn handle is NOT queued');

const robin = q.find(r => r.id === 102);
check(robin && robin.company === 'Halcyon Partners', 'recruiter company is taken from `firm`');
check(robin && robin.source === 'recruiter', 'recruiter source tagged');
check(robin && robin.emailState === 'invalid', 'emailState carries why they landed here');
const reese = q.find(r => r.id === 2);
check(reese && reese.name === 'Reese Calder', 'name assembled from first + last');

// hasEmail: the no-email-vs-unverified distinction (#12). An address on file
// (even a dead one) is hasEmail=true; a contact with only a LinkedIn handle is
// hasEmail=false, so the UI can say "no email on file" vs "email unverified".
const tay = q.find(r => r.id === 8);
check(tay && tay.hasEmail === false, 'no-email contact has hasEmail=false');
const alex = q.find(r => r.id === 3);
check(alex && alex.hasEmail === true && alex.emailState === 'unverified',
  'unverified-email contact has hasEmail=true with emailState "unverified"');
check(reese && reese.hasEmail === true, 'bounced-email contact still has an address on file (hasEmail=true)');
check(robin && robin.hasEmail === true, 'invalid-email recruiter still has an address on file (hasEmail=true)');

// sorted by company, then name
check(q[0].company === 'Aster Grid', `sorted by company first (got "${q[0].company}")`);
check(q[q.length - 1].company === 'Northwind Robotics', 'sort puts Northwind last');

// empty input is safe
check(computeConnectQueue({ taRows: [], recruiterRows: [] }).length === 0, 'empty rows → empty queue');

// ── channelFor: the corrected unverified-is-not-a-channel rule ────────────────
check(channelFor('Brightwave Labs', taRows) === 'email', 'verified email → email channel');
check(channelFor('Cobalt Systems', taRows) === 'linkedin',
  'UNVERIFIED email + LinkedIn → linkedin (not email): the corrected rule');
check(channelFor('Northwind Robotics', taRows) === 'linkedin', 'bounced email + LinkedIn → linkedin');
check(channelFor('Delta Forge', taRows) === 'none', 'no usable email and no LinkedIn → none');

// ── fitConnectNote: 300-char trim keeping the sign-off ───────────────────────
const short = fitConnectNote('Hi Alex, good to connect. Thanks, Jordan', 'Jordan');
check(short.text === 'Hi Alex, good to connect. Thanks, Jordan', 'under-limit note passes through unchanged');
check(short.length === short.text.length, 'reported length matches text');

const longBody = 'Hi Alex, ' + 'I lead revenue operations and analytics and would value comparing notes on pipeline hygiene and forecast accuracy across the funnel. '.repeat(4) + 'Thanks, Jordan';
const trimmed = fitConnectNote(longBody, 'Jordan');
check(longBody.length > 300, 'fixture is genuinely over the cap');
check(trimmed.length <= 300, `trimmed note is within LinkedIn's 300-char cap (got ${trimmed.length})`);
check(/Thanks, Jordan$/.test(trimmed.text), 'sign-off is preserved after trimming');

// ── buildConnectPrompt: the generic assembler ────────────────────────────────
const prompt = buildConnectPrompt({
  senderName: 'Jordan Example', senderFirst: 'Jordan', senderHeadline: 'RevOps Leader',
  recipientName: 'Robin Achebe', recipientFirst: 'Robin', recipientRole: 'Managing Director',
  recipientCompany: 'Halcyon Partners', guidance: 'places GTM / RevOps leaders',
  cvExcerpt: '(cv)', tone: 'Warm', toneText: 'Be warm.', targetMax: 280,
});
check(prompt.includes('Robin Achebe'), 'prompt names the recipient');
check(prompt.includes('Halcyon Partners'), 'prompt includes recipient company when provided');
check(prompt.includes('places GTM / RevOps leaders'), 'prompt carries the caller-composed guidance');
check(prompt.includes('280 characters'), 'prompt states the target character cap');
check(prompt.includes('NO em dashes'), 'prompt keeps the no-em-dash hard rule');
check(prompt.includes('Thanks, Jordan'), 'prompt instructs the "Thanks, <sender first>" sign-off');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

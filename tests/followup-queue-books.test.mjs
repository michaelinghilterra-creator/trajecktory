#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox("fuq-books");
process.env.TJK_DATA_DIR = tmp;

const { computeFollowupQueue, computeContactFollowups } = await import('../dashboard-web/server/lib/followups.mjs');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ok ${message}`); passed++; }
  else { console.log(`  not ok ${message}`); failed++; }
};
const verified = { state: 'ok' };
const ta = (id, first, last, company, extra = {}) => ({ id, first, last, company, title: 'Recruiter', status: 'Not Contacted', linkedin: `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`, email: '', verified: { state: 'unverified' }, ...extra });
const referral = (id, name, status, extra = {}) => ({ id, name, status, where: 'No Requisition Inc', target: 'Operator', linkedin: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`, email: '', verified: { state: 'unverified' }, ...extra });
const old = '2020-01-02';

console.log('followup-queue-books.test.mjs');

const notAsked = referral(1, 'Warm Person', 'Not Asked');
let queue = computeFollowupQueue({ taRows: [], referralRows: [notAsked], influencers: [], apps: [], pins: {} });
// This used to assert that a referral without a live application appeared. The
// referral book now requires the same strict application trigger as target talent.
check(!queue.some(row => row.source === 'referral' && row.id === 1), 'referral without a live application does not appear');

queue = computeFollowupQueue({ taRows: [], referralRows: [notAsked], influencers: [], apps: [{ company: 'No Requisition Inc', status: 'Applied' }], pins: {} });
check(queue.some(row => row.source === 'referral' && row.id === 1 && row.queueReason === 'Reach out'), 'referral with a live application appears as Reach out');

queue = computeFollowupQueue({ taRows: [], referralRows: [referral(2, 'Finished Intro', 'Intro Made')], influencers: [], apps: [], pins: {} });
check(!queue.some(row => row.source === 'referral' && row.id === 2), 'Intro Made referral never appears');

const coldTa = ta(3, 'Cold', 'Gatekeeper', 'No Requisition Inc');
check(computeFollowupQueue({ taRows: [coldTa], referralRows: [], influencers: [], apps: [], pins: {} }).length === 0, 'TA contact without a live application does not appear');
check(computeFollowupQueue({ taRows: [coldTa], referralRows: [], influencers: [], apps: [{ company: 'No Requisition Inc', status: 'Applied' }], pins: {} }).some(row => row.source === 'ta' && row.id === 3), 'TA contact with a live application still appears');

const influencer = { id: 4, name: 'Visible Voice', linkedinUrl: 'https://linkedin.com/in/visible-voice', following: true, connected: false, engaged: false };
const untouched = { id: 5, name: 'Untouched Voice', linkedinUrl: 'https://linkedin.com/in/untouched-voice', following: false, connected: false, engaged: false };
queue = computeFollowupQueue({ taRows: [], referralRows: [], influencers: [influencer, untouched], apps: [], pins: {} });
check(queue.some(row => row.id === 4) && !queue.some(row => row.id === 5), 'eligible unconnected influencer appears and untouched influencer does not');

const engaged = { id: 6, name: 'Engaged Voice', linkedinUrl: 'https://linkedin.com/in/engaged-voice', following: true, connected: true, engaged: true, lastEngagement: old };
queue = computeContactFollowups({ taRows: [], referralRows: [], influencers: [engaged], apps: [], pins: {}, timelineOpts: { engagementLog: [{ influencerId: 6, date: old, actionType: 'Comment' }] } });
const engagedRow = queue.find(row => row.source === 'influencer' && row.id === 6);
check(engagedRow?.capState?.linkedin?.sent === 0 && engagedRow?.capped === false, 'engagement does not consume the DM cap');

const twinTa = ta(7, 'Same', 'Person', 'Live Co', { linkedin: 'https://linkedin.com/in/same-person' });
const twinReferral = referral(7, 'Same Person', 'Not Asked', { linkedin: 'https://linkedin.com/in/same-person', where: 'Live Co' });
queue = computeFollowupQueue({ taRows: [twinTa], referralRows: [twinReferral], influencers: [], apps: [{ company: 'Live Co', status: 'Applied' }], pins: {} });
check(queue.filter(row => row.name === 'Same Person').length === 1, 'person merged across referral and TA appears once');

const rankedTa = ta(8, 'Ranked', 'Cold', 'Live Co');
const rankedReferral = referral(8, 'Ranked Warm', 'Not Asked', { where: 'Live Co' });
queue = computeFollowupQueue({ taRows: [rankedTa], referralRows: [rankedReferral], influencers: [], apps: [{ company: 'Live Co', status: 'Applied' }], pins: {} });
check(queue.findIndex(row => row.source === 'referral') < queue.findIndex(row => row.source === 'ta'), 'warm referral outranks cold TA at equal staleness');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
// ── a connected contact is never treated as a first touch ────────────────────
// Both halves of this reached the screen: a row badged "Just connected" also
// carried "Not contacted", and its draft asked to connect with somebody already
// connected. The cause is that both signals are derived from each book's own
// status vocabulary, and a referral sits at "Not Asked" however much has actually
// passed between you.
console.log('\nconnected contacts are not first touches');
{
  // Mirrors what the client's isAlreadyInvited must conclude. Kept in step with
  // dashboard-web/src/connect.jsx; if that logic moves, this should move with it.
  const alreadyInvited = (c) =>
    c.linkedinStatus === 'Connected' || !!c.freeDm ||
    !!(c.companyOutreach && c.companyOutreach.selfLastTouch) ||
    ['Sent', 'Replied', 'Meeting Scheduled'].includes(c.status);

  const connectedReferral = { source: 'referral', id: 7001, status: 'Not Asked', linkedinStatus: 'Connected', freeDm: true, companyOutreach: {} };
  check(alreadyInvited(connectedReferral) === true,
    'a connected referral counts as already invited, so it drafts a message not a connect note');

  const stranger = { source: 'referral', id: 7002, status: 'Not Asked', companyOutreach: {} };
  check(alreadyInvited(stranger) === false,
    'a referral you have never touched is still a genuine first touch');

  const sentTa = { source: 'ta', id: 5, status: 'Sent', companyOutreach: {} };
  check(alreadyInvited(sentTa) === true, 'the target-talent status path is unchanged');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

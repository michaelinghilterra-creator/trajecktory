#!/usr/bin/env node
/**
 * one-bucket.test.mjs: every contact is in exactly ONE bucket.
 *
 * Referral > DM > TA, highest wins. The bucket is derived by resolvePeople from
 * the rows a person holds; nothing is stored. Covers the derivation, the queue
 * and draft routing that follow it, the add paths that must not file a second
 * row, and the guard that fails when one person holds live rows in two buckets.
 * Invented people at .example companies only.
 *
 * Run: node tests/one-bucket.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('one-bucket');
process.env.TJK_DATA_DIR = tmp;

const { resolvePeople, bucketConflicts, rowBucket, bucketSource } =
  await import('../dashboard-web/server/lib/contact-identity.mjs');
const { computeFollowupQueue, computeReferralFollowups, computeContactFollowups, computeConnectQueue, computeEmailQueue, computeBothQueue } =
  await import('../dashboard-web/server/lib/followups.mjs');
const { bucketOwner } = await import('../dashboard-web/server/lib/person-context.mjs');
const { findExistingContact, heldContactRows } = await import('../lib/contact-match.mjs');
const { mergeStakeholderAdditions } = await import('../lib/stakeholder-additions.mjs');
const { matchConnections } = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('one-bucket.test.mjs');

const li = slug => `https://www.linkedin.com/in/${slug}`;
const ta = o => ({
  email: '', verified: { state: 'unverified' }, title: 'Contact', notes: '', isPrincipal: false,
  status: 'Not Contacted', influenceTier: 'ta', ...o,
});
const referral = o => ({ how: 'LinkedIn connection', target: '', lastTouch: '', notes: '', status: 'Not Asked', ...o });
const apps = ['Quillon Labs', 'Vexor Systems', 'Brindle Works', 'Harbor Group'].map(company => ({ company, status: 'Applied' }));

// One person per bucket, plus the conflict shapes the rule exists for.
const books = {
  ta: [
    ta({ id: 1, first: 'Tamsin', last: 'Orde', company: 'Quillon Labs', linkedin: li('tamsin-orde-ex'), influenceTier: 'exec' }),
    ta({ id: 2, first: 'Rowan', last: 'Pell', company: 'Vexor Systems', linkedin: li('rowan-pell-ex'), influenceTier: 'hm' }),
    ta({ id: 3, first: 'Imogen', last: 'Vale', company: 'Brindle Works', linkedin: li('imogen-vale-ex'), influenceTier: 'ta' }),
    ta({ id: 4, first: 'Corin', last: 'Hask', company: 'Harbor Group', linkedin: li('corin-hask-ex'), influenceTier: 'peer' }),
    ta({ id: 5, first: 'Sable', last: 'Drew', company: 'Harbor Group', linkedin: li('sable-drew-ex'), influenceTier: 'agency' }),
    ta({ id: 6, first: 'Wren', last: 'Alder', company: 'Quillon Labs', linkedin: li('wren-alder-ex'), influenceTier: 'ta' }),
    ta({ id: 7, first: 'Lark', last: 'Moss', company: 'Vexor Systems', linkedin: li('lark-moss-ex'), influenceTier: 'exec', status: 'Archived' }),
  ],
  referrals: [
    referral({ id: 10, name: 'Tamsin Orde', where: 'Quillon Labs', linkedin: li('tamsin-orde-ex') }),
    referral({ id: 11, name: 'Wren Alder', where: 'Quillon Labs', linkedin: li('wren-alder-ex'), status: 'Archived' }),
    referral({ id: 12, name: 'Lark Moss', where: 'Vexor Systems', linkedin: li('lark-moss-ex') }),
    referral({ id: 13, name: 'Fenn Marsh', where: 'Harbor Group', linkedin: li('fenn-marsh-ex'), status: 'Archived' }),
  ],
  influencers: [{ id: 20, name: 'Pip Rook', company: 'Harbor Group', linkedinUrl: li('pip-rook-ex') }],
};

console.log('\n1. The bucket is derived per person');
const people = resolvePeople({ ...books, pins: {} });
const byRef = ref => people.find(p => p.refs.includes(ref));
check(byRef('ta:1').bucket === 'Referral' && byRef('ta:1') === byRef('referral:10'), 'a live referral row beats an exec TA row for the same person');
check(byRef('ta:1').bucketRef === 'referral:10', 'the owning row is the referral row');
check(byRef('ta:2').bucket === 'DM', 'an hm tier TA row alone is DM');
check(byRef('ta:3').bucket === 'TA', 'a ta tier row alone is TA');
check(byRef('ta:4').bucket === 'DM', 'a peer tier row is DM (peers go in DM)');
check(byRef('ta:5').bucket === 'TA', 'an agency recruiter is TA');
check(byRef('ta:6').bucket === 'TA' && byRef('ta:6').bucketRef === 'ta:6', 'an archived referral does not hold a bucket: the live TA row wins');
check(byRef('ta:7').bucket === 'Referral' && byRef('ta:7') === byRef('referral:12'), 'a live referral beats an archived exec row');
check(byRef('referral:13').bucket === 'Referral' && byRef('referral:13').bucketLive === false, 'an all-archived person keeps a fallback bucket but is not live');
check(byRef('influencer:20').bucket === null, 'an influencer alone has no contact bucket');
check(rowBucket('ta', { influenceTier: 'exec' }) === 'DM' && rowBucket('ta', {}) === 'TA' && rowBucket('referral', {}) === 'Referral', 'a row with no tier defaults to TA');
check(bucketSource('Referral') === 'referral' && bucketSource('DM') === 'ta' && bucketSource('TA') === 'ta' && bucketSource(null) === null, 'DM and TA live in the TA book');
check(JSON.stringify(byRef('ta:1').liveBuckets) === '["Referral","DM"]', 'liveBuckets lists every bucket the person holds live rows in');

console.log('\n2. The guard: one person, two live buckets');
const conflicts = bucketConflicts(people);
const conflictRefs = conflicts.map(p => p.refs.join('+')).sort();
check(conflicts.length === 1 && conflictRefs[0] === 'referral:10+ta:1', 'exactly the live referral + exec TA person is flagged');
check(!conflictRefs.some(r => r.includes('ta:6')), 'an archived row never makes a conflict');
check(bucketConflicts(resolvePeople({ ta: books.ta.filter(r => r.id !== 1), referrals: books.referrals, pins: {} })).length === 0, 'the guard is empty once the lower row is gone');
const twoTa = resolvePeople({ ta: [
  ta({ id: 30, first: 'Hale', last: 'Pike', company: 'Quillon Labs', linkedin: li('hale-pike-ex'), influenceTier: 'exec' }),
  ta({ id: 31, first: 'Hale', last: 'Pike', company: 'Quillon Labs', linkedin: li('hale-pike-ex'), influenceTier: 'ta' }),
], pins: {} });
check(bucketConflicts(twoTa).length === 1 && twoTa[0].bucket === 'DM' && twoTa[0].bucketRef === 'ta:30', 'two live TA rows at different tiers conflict and resolve to the higher tier');
check(bucketConflicts([]).length === 0 && bucketConflicts(undefined).length === 0, 'the guard tolerates empty input');

console.log('\n3. The queue lists each person once, in their bucket only');
const opts = { taRows: books.ta, referralRows: books.referrals, influencers: books.influencers, apps, pins: {} };
const refsOf = rows => rows.map(r => `${r.source}:${r.id}`).sort();
const connect = computeConnectQueue(opts);
check(refsOf(connect).includes('ta:3') && !refsOf(connect).includes('ta:1') && !refsOf(connect).includes('ta:7'), 'the connect queue skips TA rows whose person is a referral');
check(computeEmailQueue(opts).every(r => r.id !== 1) && computeBothQueue(opts).every(r => r.id !== 1), 'the email and both queues skip them too');
const merged = computeFollowupQueue({ ...opts, excludeReferrals: true });
check(merged.every(r => r.id !== 1 && r.id !== 7), 'the TA and DM follow-up queue never lists a referral-bucket person');
check(merged.find(r => r.id === 2)?.bucket === 'DM' && merged.find(r => r.id === 3)?.bucket === 'TA' && merged.find(r => r.id === 4)?.bucket === 'DM', 'each remaining row carries its bucket');
const referralQueue = computeReferralFollowups(opts);
check(refsOf(referralQueue).join() === 'referral:10,referral:12' && referralQueue.every(r => r.bucket === 'Referral'), 'the referral queue lists the referral-bucket people, tagged Referral');
const full = computeFollowupQueue(opts);
const fullPeople = full.map(r => byRef(`${r.source}:${r.id}`).id);
check(new Set(fullPeople).size === fullPeople.length, 'the full queue lists no person twice');
check(!full.some(r => r.source === 'ta' && (r.id === 1 || r.id === 7)), 'the full queue drops the cold TA row of a referral person even when the referral row is listed');
const contacts = computeContactFollowups({ ...opts, staleApps: [] });
check(contacts.every(c => c.id !== 1 && c.id !== 7) && contacts.every(c => c.bucket === 'DM' || c.bucket === 'TA'), 'the contact follow-up list carries only DM and TA people');

// A referral that is not yet due still owns the person: the TA row stays quiet.
const resting = computeFollowupQueue({ ...opts, referralRows: books.referrals.map(r => r.id === 10 ? { ...r, status: 'Asked', lastTouch: '2030-01-01' } : r), excludeReferrals: false });
check(resting.every(r => !(r.source === 'ta' && r.id === 1)), 'a referral that is not due does not hand the person back to the cold row');

// The guard over the queue itself: no person in both lists.
const inBoth = new Set(refsOf(merged).map(ref => byRef(ref).id).filter(id => refsOf(referralQueue).map(ref => byRef(ref).id).includes(id)));
check(inBoth.size === 0, 'no person appears in both the referral list and the TA/DM list');

console.log('\n4. Drafting follows the bucket');
const owner = bucketOwner('ta', 1, { ta: books.ta, referrals: books.referrals, influencers: books.influencers, pins: {} });
check(owner.source === 'referral' && owner.id === 10 && owner.bucket === 'Referral', 'a draft asked for the cold TA row is routed to the referral row');
const ownTa = bucketOwner('ta', 2, { ta: books.ta, referrals: books.referrals, influencers: books.influencers, pins: {} });
check(ownTa.source === 'ta' && ownTa.id === 2 && ownTa.bucket === 'DM', 'a DM person keeps their own row');
const unknown = bucketOwner('ta', 999, { ta: books.ta, referrals: books.referrals, influencers: [], pins: {} });
check(unknown.source === 'ta' && unknown.id === 999 && unknown.bucket === null, 'an unresolved ref is answered as asked');

console.log('\n5. Add paths see referral rows');
const held = heldContactRows({ ta: books.ta, referrals: books.referrals });
const newcomer = { first: 'Tamsin', last: 'Orde', company: 'Quillon Labs Commerce', linkedin: li('tamsin-orde-ex') };
const hit = findExistingContact({ first: 'Rowan', last: 'Pell', company: 'Vexor Systems', linkedin: li('rowan-pell-ex') }, held);
check(hit?.id === 2 && hit.source !== 'referral', 'a TA-book match is still found');
const referralHit = findExistingContact(newcomer, held.filter(r => r.id !== 1 || r.source === 'referral'));
check(referralHit?.source === 'referral' && referralHit.id === 10, 'a person who is a live referral is found by a TA add');
check(findExistingContact({ first: 'Fenn', last: 'Marsh', company: 'Harbor Group', linkedin: li('fenn-marsh-ex') }, held) === null, 'an archived referral does not block an add');
check(findExistingContact(newcomer, held)?.source === 'referral', 'when both books hold the person the referral row is the representative');
const sourcing = mergeStakeholderAdditions([
  { first: 'Tamsin', last: 'Orde', company: 'Quillon Labs', title: 'VP Sales', linkedin: li('tamsin-orde-ex'), email: 'tamsin.orde@example.test', source: 'agent' },
], { today: '2030-01-15', existingRows: heldContactRows({ ta: [], referrals: books.referrals }) });
check(sourcing.people.length === 0 && sourcing.matched.length === 1 && sourcing.matched[0].existingSource === 'referral', 'the sourcing merge reports a referral match instead of adding a TA row');

console.log('\n6. The connections import does not file a second live row');
const active = [{ company: 'Quillon Labs', role: 'Analyst' }];
const none = { names: new Set(), urls: new Set() };
const sample = [
  { first: 'Tamsin', last: 'Orde', company: 'Quillon Labs', position: 'VP RevOps', url: li('tamsin-orde-ex') },
  { first: 'Dune', last: 'Ashby', company: 'Quillon Labs', position: 'Analyst', url: li('dune-ashby-ex') },
  { first: 'Elm', last: 'Garrow', company: 'Elsewhere Corp', position: 'Director of Revenue Operations', url: li('elm-garrow-ex') },
];
const liveTa = books.ta.filter(r => r.status !== 'Archived');
const held2 = matchConnections({ connections: sample, active, existing: none, taRows: liveTa });
check(held2.heldInTa.map(c => c.first).join() === 'Tamsin', 'a connection already in the TA book is held back, not filed as a referral');
check(held2.stage1.map(c => c.first).join() === 'Dune' && held2.stage2.map(c => c.first).join() === 'Elm', 'everyone else is staged as before');
const archivedOnly = matchConnections({ connections: sample, active, existing: none, taRows: [] });
check(archivedOnly.heldInTa.length === 0 && archivedOnly.stage1.length === 2, 'with no live TA row nothing is held back');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

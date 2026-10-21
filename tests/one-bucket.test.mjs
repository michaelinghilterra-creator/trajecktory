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

console.log('\n6. The connections import promotes instead of filing a second live row');
const active = [{ company: 'Quillon Labs', role: 'Analyst' }];
const none = { names: new Set(), urls: new Set() };
const sample = [
  { first: 'Tamsin', last: 'Orde', company: 'Quillon Labs', position: 'VP RevOps', url: li('tamsin-orde-ex') },
  { first: 'Dune', last: 'Ashgrove', company: 'Quillon Labs', position: 'Analyst', url: li('dune-ashgrove-ex') },
  { first: 'Elm', last: 'Garrow', company: 'Elsewhere Corp', position: 'Senior Director, Zorblax Revenue Operations', url: li('elm-garrow-ex') },
];
const liveTa = books.ta.filter(r => r.status !== 'Archived');
const m = matchConnections({ connections: sample, active, existing: none, taRows: liveTa, referralRows: books.referrals });
check(m.promote.map(x => x.connection.first).join() === 'Tamsin' && m.promote[0].taRows.map(r => r.id).join() === '1', 'a connection already live in the TA book is listed to promote');
check(m.promote[0].referral?.id === 10, 'the live referral row already on file is the one kept');
check(m.stage1.map(c => c.first).join() === 'Dune' && m.stage2.map(c => c.first).join() === 'Elm', 'everyone else is staged as before');
const noTa = matchConnections({ connections: sample, active, existing: none, taRows: [], referralRows: [] });
check(noTa.promote.length === 0 && noTa.stage1.length === 2, 'with no live TA row nothing is promoted');
const noRef = matchConnections({ connections: sample, active, existing: none, taRows: liveTa, referralRows: [] });
check(noRef.promote[0].referral === null, 'with no referral row yet the promotion files one');

console.log('\n7. Promotion on real files: carry-over, idempotence, guard');
const fs = await import('node:fs');
const path = await import('node:path');
const { appendTTRows, parseTargetTalentMd, updateTTLine } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { appendReferralRows, parseReferralsMd, REFERRAL_HEADER } = await import('../dashboard-web/server/lib/referrals.mjs');
const { saveConnections, reconcile, promoteToReferral } = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');
const TT_HEAD = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';
fs.writeFileSync(path.join(tmp, 'target-talent.md'), TT_HEAD);
fs.writeFileSync(path.join(tmp, 'referrals.md'), REFERRAL_HEADER);
fs.writeFileSync(path.join(tmp, 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n| 1 | 2030-01-02 | Quillon Labs | Analyst | 4.2/5 | Applied | N | N |  |  |  |\n');
const [a] = appendTTRows([
  { company: 'Quillon Labs', first: 'Tamsin', last: 'Orde', title: 'VP RevOps', email: 'tamsin.orde@example.test [v:ok:hunter:2030-01-03:90]', linkedin: li('tamsin-orde-ex'), notes: '[tier:exec] intro idea' },
  { company: 'Quillon Labs', first: 'Imogen', last: 'Vale', title: 'Recruiter', email: 'imogen.vale@example.test', linkedin: li('imogen-vale-ex'), notes: '' },
]);
updateTTLine(a.id, { status: 'Sent', lastTouch: '2030-03-05' });
const [r1] = appendReferralRows([{ name: 'Imogen Vale', how: '1st-degree LinkedIn connection', where: 'Quillon Labs', target: '', status: 'Not Asked', lastTouch: '2030-02-01', notes: 'Recruiter', linkedin: li('imogen-vale-ex'), email: '' }]);
saveConnections([
  { first: 'Tamsin', last: 'Orde', url: li('tamsin-orde-ex'), email: '', company: 'Quillon Labs', position: 'VP RevOps', on: '01 Jan 2030' },
  { first: 'Imogen', last: 'Vale', url: li('imogen-vale-ex'), email: '', company: 'Quillon Labs', position: 'Recruiter', on: '01 Jan 2030' },
], 'cli');

const before = bucketConflicts(resolvePeople({ ta: parseTargetTalentMd(), referrals: parseReferralsMd(), pins: {} })).length;
check(before === 1, 'one person starts with a live TA row and a live referral already');
const first = reconcile({ seedPool: true });
const taAfter = parseTargetTalentMd(), refAfter = parseReferralsMd();
const tamsinRef = refAfter.find(r => r.name === 'Tamsin Orde');
const tamsinTa = taAfter.find(r => r.id === a.id);
check(first.promoted === 2, 'both connections are promoted');
check(!!tamsinRef && refAfter.filter(r => r.name === 'Tamsin Orde').length === 1, 'a referral row is filed for the person who had none');
check(taAfter.filter(r => r.status !== 'Archived').length === 0 && taAfter.length === 2, 'the TA rows are archived, never deleted');
check(tamsinRef.email === 'tamsin.orde@example.test' && tamsinRef.verified.hadTag && tamsinRef.verified.state === 'ok', 'the TA email is carried over with its verification tag');
check(tamsinRef.lastTouch === '2030-03-05', 'the later TA last touch is carried over');
const imogenRef = refAfter.find(r => r.id === r1.id);
check(imogenRef.email === 'imogen.vale@example.test' && imogenRef.lastTouch === '2030-02-01', 'an existing referral gets the missing email and keeps its own later or equal last touch');
check(refAfter.filter(r => r.name === 'Imogen Vale').length === 1, 'a referral row already present is not duplicated');
const marker = `TA #${a.id} moved to Referral #${tamsinRef.id}`;
const sep = ' · ';
check(tamsinRef.notes.includes(`${sep}${marker} (one-bucket rule, `) && tamsinTa.notes.includes(`${sep}${marker} (one-bucket rule, `), 'both rows carry the move note with the middle-dot separator');
check(first.bucketConflicts === 0 && bucketConflicts(resolvePeople({ ta: taAfter, referrals: refAfter, pins: {} })).length === 0, 'the guard reports zero people with two live buckets after the import');
const snapshot = JSON.stringify([taAfter, refAfter]);
const second = reconcile({ seedPool: true });
check(second.promoted === 0 && JSON.stringify([parseTargetTalentMd(), parseReferralsMd()]) === snapshot, 'running the import twice changes nothing');
check(promoteToReferral({ referral: { ...tamsinRef }, taRows: [tamsinTa], today: '2030-04-01' }).length === 0, 'an already archived TA row is never moved again');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

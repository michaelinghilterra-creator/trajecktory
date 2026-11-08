#!/usr/bin/env node

import assert from 'node:assert/strict';
import { linkedinKey } from '../dashboard-web/server/lib/contact-identity.mjs';
import { resolveReferralLink } from '../dashboard-web/server/lib/referrals.mjs';

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (error) {
    console.log(`  not ok ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

const _normName = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function referenceResolve(refRow, taRows = []) {
  const taRef = (refRow.notes || '').match(/TA Outreach #(\d+)/i);
  if (taRef) { const c = taRows.find(r => r.id === parseInt(taRef[1], 10)); if (c) return { source: 'ta', contact: c }; }
  const s = linkedinKey(refRow.linkedin);
  if (s) { const ta = taRows.find(r => linkedinKey(r.linkedin) === s); if (ta) return { source: 'ta', contact: ta }; }
  const nn = _normName(refRow.name), nc = _normName(refRow.where);
  if (nn && nn.length >= 4) {
    const ta = taRows.find(r => _normName(`${r.first} ${r.last}`) === nn && (!nc || _normName(r.company) === nc));
    if (ta) return { source: 'ta', contact: ta };
  }
  return null;
}

let seed = 246813579;
function nextInt(limit) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % limit;
}

const names = [
  ['Example', 'Personone'],
  ['Sample', 'Persontwo'],
  ['Demo', 'Personthree'],
  ['Test', 'Personfour'],
  ['', ''],
  ['Al', 'B'],
];
const companies = ['Acme Example', 'Globex Example', 'Initech Example', 'Umbrella Example', ''];
const slugs = ['example-personone', 'sample-persontwo', 'démo-personthree', 'test-personfour', ''];

const targetRows = Array.from({ length: 40 }, (_, i) => {
  const [first, last] = names[nextInt(names.length)];
  const slug = slugs[nextInt(slugs.length)];
  const linkedin = slug
    ? `https://www.linkedin.com/in/${i % 2 ? slug.toUpperCase() : slug}${i % 3 ? '/' : ''}`
    : '';
  return {
    id: i === 8 ? 900001 : i === 9 ? '900001' : 900001 + (i % 31),
    first,
    last,
    company: companies[nextInt(companies.length)],
    linkedin,
    email: `person${i}@example.test`,
  };
});

const referralRows = Array.from({ length: 60 }, (_, i) => {
  const target = targetRows[nextInt(targetRows.length)];
  const mode = i % 5;
  return {
    name: mode === 3 ? 'Al B' : `${target.first} ${target.last}`.trim(),
    where: mode === 4 ? companies[nextInt(companies.length)] : target.company,
    notes: mode === 0
      ? `Introduced from TA Outreach #${i % 4 ? target.id : 999999}`
      : '',
    linkedin: mode === 1 || mode === 4 ? target.linkedin : '',
    email: `referral${i}@example.test`,
  };
});

function assertSameResult(actual, expected) {
  if (expected === null) {
    assert.equal(actual, null);
    return;
  }
  assert.equal(actual.source, expected.source);
  assert.equal(actual.contact, expected.contact);
}

for (let i = 0; i < referralRows.length; i++) {
  check(`randomized referral ${i + 1} matches the reference`, () => {
    assertSameResult(resolveReferralLink(referralRows[i], targetRows), referenceResolve(referralRows[i], targetRows));
  });
}

check('the same target array stays correct across repeated calls', () => {
  for (const referral of referralRows) {
    assertSameResult(resolveReferralLink(referral, targetRows), referenceResolve(referral, targetRows));
  }
});

check('a pushed row is found after the length guard rebuilds the index', () => {
  const added = {
    id: 900099,
    first: 'Added',
    last: 'Exampleperson',
    company: 'Acme Example',
    linkedin: 'https://www.linkedin.com/in/added-exampleperson',
    email: 'added@example.test',
  };
  targetRows.push(added);
  const referral = { notes: 'TA Outreach #900099', name: '', where: '', linkedin: '' };
  const result = resolveReferralLink(referral, targetRows);
  assert.equal(result.source, 'ta');
  assert.equal(result.contact, added);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

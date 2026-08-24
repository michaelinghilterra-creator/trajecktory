#!/usr/bin/env node
/**
 * stakeholder-additions.test.mjs: unit tests for the deterministic validation
 * and merge gate between person discovery and the contact book.
 *
 * WHY THIS EXISTS: a plausible name and title are not evidence that a person
 * exists. These fixtures pin every rejection and downgrade rule, provenance,
 * deduplication, and the injected single-write boundary without file or network
 * access.
 *
 * Run: node tests/stakeholder-additions.test.mjs
 */

import {
  END_MARKER,
  START_MARKER,
  mergeStakeholderAdditions,
  parseProvenance,
  parseStakeholderAdditions,
  sanitizePersonField,
  stampProvenance,
  validateStakeholder,
} from '../lib/stakeholder-additions.mjs';
import { parseInfluenceTier } from '../lib/influence-tier.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

function hasReason(result, reason) {
  return result.ok === false && result.reasons.includes(reason);
}

const today = '2026-08-24';
const base = {
  first: 'Avery',
  last: 'Quill',
  company: 'Acme Example',
  title: 'Director of Revenue Operations',
  source: 'agent',
};
const linked = { ...base, linkedin: 'https://www.linkedin.com/in/avery-example' };

console.log('stakeholder-additions.test.mjs');

const fenced = parseStakeholderAdditions([
  'before', START_MARKER, '```json', JSON.stringify([linked, null, { ...linked, first: 'Robin' }]),
  '```', END_MARKER, 'after',
].join('\n'));
check(fenced.people.length === 2, 'parses a fenced JSON array between the markers');
check(fenced.errors.includes('entry 1: not an object'), 'parsing reports a bad entry without discarding its neighbours');
check(parseStakeholderAdditions('nothing').errors[0].includes('no STAKEHOLDER_ADDITIONS block'),
  'missing marker block returns an error');
check(parseStakeholderAdditions(`${START_MARKER}\nnope\n${END_MARKER}`).errors[0].includes('not valid JSON'),
  'invalid JSON returns an error');
check(parseStakeholderAdditions(`${START_MARKER}\n{}\n${END_MARKER}`).errors[0].includes('not a JSON array'),
  'a non-array payload returns an error');
check(sanitizePersonField(' A|B\r\n C ', 5) === 'A B C', 'sanitizer removes table delimiters and line breaks');

check(hasReason(validateStakeholder(null, { today }), 'candidate is not an object'),
  'rejects a non-object candidate with its specific reason');
check(hasReason(validateStakeholder({ ...linked, first: '' }, { today }), 'first name is missing'),
  'rejects a missing first name with its specific reason');
check(hasReason(validateStakeholder({ ...linked, last: '' }, { today }), 'last name is missing'),
  'rejects a missing last name with its specific reason');
check(hasReason(validateStakeholder({ ...linked, first: 'First', last: 'Last' }, { today }), 'first name is a placeholder'),
  'rejects a placeholder first name with its specific reason');
check(hasReason(validateStakeholder({ ...linked, first: 'First', last: 'Last' }, { today }), 'last name is a placeholder'),
  'rejects a placeholder last name with its specific reason');
check(hasReason(validateStakeholder({ ...linked, company: '' }, { today }), 'company is missing'),
  'rejects a missing company with its specific reason');
check(hasReason(validateStakeholder({ ...linked, title: '' }, { today }), 'title is missing'),
  'rejects a missing title with its specific reason');
check(hasReason(validateStakeholder({ ...linked, title: 'Individual Contributor' }, { today }), 'title cannot be classified'),
  'rejects a title the classifier cannot place');
check(hasReason(validateStakeholder(base, { today }), 'no corroboration'),
  'rejects a name and title with no corroboration');
check(hasReason(validateStakeholder({ ...linked, source: 'mystery' }, { today }), 'source is not hunter, agent, or manual'),
  'rejects an unknown source with its specific reason');

check(validateStakeholder(linked, { today }).ok, 'a valid LinkedIn profile corroborates a candidate');
check(validateStakeholder({ ...base, source: 'hunter', sourceCount: 2 }, { today }).ok,
  'a positive numeric public-source count corroborates a candidate');
const knownEmail = validateStakeholder({ ...base, email: 'avery@acme.example' }, {
  today,
  knownDomain: 'acme.example',
});
check(knownEmail.ok && knownEmail.person.email === 'avery@acme.example',
  'an address at the known company domain corroborates a candidate');

const mismatchedOnly = validateStakeholder({ ...base, email: 'avery@other.example' }, {
  today,
  knownDomain: 'acme.example',
});
check(hasReason(mismatchedOnly, 'no corroboration'), 'a different-domain email does not corroborate a candidate');
const mismatchedWithEvidence = validateStakeholder({ ...linked, email: 'avery@other.example' }, {
  today,
  knownDomain: 'acme.example',
});
check(mismatchedWithEvidence.ok && mismatchedWithEvidence.person.email === ''
  && mismatchedWithEvidence.person.warnings.some(warning => warning.includes('domain does not match')),
  'a different-domain email is dropped with a warning when other evidence exists');
const malformedFields = validateStakeholder({
  ...base,
  sourceCount: 1,
  linkedin: 'https://profiles.example/avery',
  email: 'not-an-address',
}, { today });
check(malformedFields.ok && malformedFields.person.linkedin === '' && malformedFields.person.email === ''
  && malformedFields.person.warnings.length === 2,
  'malformed profile and email fields are dropped with separate warnings');

let malformedDateRefused = false;
try {
  stampProvenance('', { tier: 'hm', source: 'manual', date: '08/24/2026' });
} catch (error) {
  malformedDateRefused = error instanceof TypeError && error.message.includes('YYYY-MM-DD');
}
check(malformedDateRefused, 'stampProvenance refuses a malformed date');

let appendCalls = 0;
let appended = [];
const merge = mergeStakeholderAdditions([
  { ...linked, notes: 'found|in\npublic source' },
  { ...linked },
  { ...linked, first: 'Robin', source: 'mystery' },
], {
  today,
  appendRows(rows) {
    appendCalls++;
    appended = rows;
  },
});
check(appendCalls === 1 && appended.length === 1 && merge.added === 1,
  'appendRows is called exactly once with only accepted unique rows');
check(merge.duplicates === 1 && merge.rejected.length === 1,
  'same-run duplicates and rejected candidates receive separate accounting');
check(merge.people.length + merge.rejected.length + merge.duplicates === 3,
  'accepted, rejected, and duplicate totals account for every candidate');
const allRejected = mergeStakeholderAdditions([
  base,
  { ...linked, first: 'Robin', company: '' },
], { today });
check(allRejected.rejected.length === 2
  && allRejected.rejected[0].reasons.includes('no corroboration')
  && allRejected.rejected[1].reasons.includes('company is missing'),
  'every rejected candidate is reported with its own reasons');
check(!/[|\r\n]/.test(appended[0].notes), 'unsafe notes characters never reach appendRows');
check(parseInfluenceTier(appended[0].notes) === appended[0].tier,
  'accepted notes round-trip through the shared influence-tier parser');
const provenance = parseProvenance(appended[0].notes);
check(provenance.source === 'agent' && provenance.date === today,
  'accepted notes round-trip through the provenance parser');

let rejectedAppendCalls = 0;
const rejectedMerge = mergeStakeholderAdditions([base], {
  today,
  appendRows() { rejectedAppendCalls++; },
});
check(rejectedAppendCalls === 0 && rejectedMerge.rejected.length === 1,
  'appendRows is not called when every candidate is rejected');

const dryRun = mergeStakeholderAdditions([linked, base], { today });
check(dryRun.added === 0 && dryRun.people.length === 1 && dryRun.rejected.length === 1
  && dryRun.errors.length === 0,
  'omitting appendRows writes nothing and preserves full accounting');

let duplicateRows = null;
const existingDuplicate = mergeStakeholderAdditions([linked], {
  today,
  existingRows: [{ company: ' ACME   EXAMPLE ', first: 'Avery', last: 'Quill' }],
  appendRows(rows) { duplicateRows = rows; },
});
check(existingDuplicate.duplicates === 1 && duplicateRows === null,
  'a normalized duplicate of an existing row is counted and not written');

let sameRunRows = [];
const sameRun = mergeStakeholderAdditions([linked, { ...linked }], {
  today,
  appendRows(rows) { sameRunRows = rows; },
});
check(sameRun.people.length === 1 && sameRunRows.length === 1 && sameRun.duplicates === 1,
  'two identical candidates in one run produce one write');

let knownDomainRows = [];
mergeStakeholderAdditions([{ ...base, email: 'avery@acme.example' }], {
  today,
  knownDomains: { acmeexample: 'acme.example' },
  appendRows(rows) { knownDomainRows = rows; },
});
check(knownDomainRows.length === 1, 'normalized company lookup supplies the validator known domain');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

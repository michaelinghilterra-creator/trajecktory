#!/usr/bin/env node
/**
 * pii-blindspots.test.mjs pins pure term derivation, precision filtering,
 * normalization, safe masking, decoded base64 and hex matches, and added-line
 * findings with invented data.
 *
 * Run: node tests/pii-blindspots.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  deriveTerms,
  isDistinctive,
  maskValue,
  scanAddedLines,
} from '../lib/pii-blindspots.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

console.log('pii-blindspots.test.mjs');

const profile = [
  'full_name: Zorina Quell',
  'email: zorina.quell@identity.example',
  'phone: +1 (202) 555-0147',
].join('\n');
const targetTalent = [
  '| ID | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | Quartz Nebula Labs | Venn | Orlena | Ms. | Global Platform Strategy Architect | City | ST | 00000 | 202.555.0147 | orlena@contact.example | profile.example/orlena | New | | | quartz.example |',
  '| 2 | Quartz Nebula Labs | Rook | Tavian | Mr. | Global Platform Strategy Architect | City | ST | 00000 | 202-555-0147 | tavian@contact.example | profile.example/tavian | New | | | quartz.example |',
].join('\n');
const apps = [
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-01 | Quartz Nebula Labs | Global Platform Strategy Architect | 5/5 | Evaluated | | | | Call (202) 555 0147 | https://jobs.example/one |',
].join('\n');
const referrals = [
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | Ysolde Maren Vale | Former peer | Quartz Nebula Labs | Global Platform Strategy Architect | Not Asked | | Call 1-202-555-0147 | profile.example/ysolde | ysolde@referral.example |',
].join('\n');

const terms = deriveTerms({ profile, cv: '', apps, targetTalent, referrals });
function realTerms() {
  return [
    ...terms.identity,
    ...terms.people,
    ...terms.companies,
    ...terms.titles,
    ...terms.phones,
    ...terms.emails,
  ];
}
check(terms.identity.has('Zorina Quell'), 'identity includes the full name');
check(terms.identity.has('Zorina'), 'identity includes the first name alone');
check(terms.people.has('Orlena Venn'), 'contact book includes a third-party full name');
check(!terms.people.has('Orlena') && !terms.people.has('Venn'), 'contact name halves are not terms');
check(!terms.people.has('First Last'), 'contact-book header words never become a person');
check(!terms.people.has('Name How'), 'referral header words never become a person');
check(!isDistinctive('Sales', 'company'), 'generic company is rejected');
check(isDistinctive('Quartz Nebula Labs', 'company'), 'distinctive company is accepted');
check(!isDistinctive('Platform Architect', 'title'), 'two-word title is rejected');
check(isDistinctive('Global Platform Strategy Architect', 'title'), 'four-word distinctive title is accepted');
check(terms.phones.size === 1 && terms.phones.has('2025550147'), 'five phone formats normalize to one term');
check(terms.derivedFrom.cv === false, 'empty source is reported as not derived');

const addedLines = [
  { file: 'fixture-a.mjs', line: 'const greeting = "Zorina";' },
  { file: 'fixture-b.mjs', line: 'const callback = "202 555 0147";' },
  { file: 'fixture-c.mjs', line: 'const contact = "Orlena Venn";' },
  { file: 'fixture-d.mjs', line: 'const value = "first sales manager data";' },
  { file: 'fixture-e.mjs', line: `const blob = "${'Q'.repeat(40)}";` },
  { file: 'fixture-f.mjs', line: `const digest = "${'ab'.repeat(16)}";` },
];
const scanned = scanAddedLines(addedLines, terms);
check(scanned.findings.some(finding => finding.kind === 'identity' && finding.file === 'fixture-a.mjs'), 'first name alone produces an identity finding');
check(scanned.findings.some(finding => finding.kind === 'phone' && finding.file === 'fixture-b.mjs'), 'differently formatted phone produces a phone finding');
check(scanned.findings.some(finding => finding.kind === 'person' && finding.file === 'fixture-c.mjs'), 'third-party full name produces a person finding');
check(!scanned.findings.some(finding => finding.file === 'fixture-d.mjs'), 'generic words produce no finding');
const encoded = scanned.findings.filter(finding => finding.kind === 'encoded');
check(encoded.some(finding => finding.file === 'fixture-e.mjs'), 'base64-looking run produces an encoded finding');
check(encoded.some(finding => finding.file === 'fixture-f.mjs'), 'hex run produces an encoded finding');
check(encoded.every(finding => finding.maskedTerm === null), 'encoded findings have null masked terms');

const encodedRuleLines = [
  { file: 'bare-base64.mjs', line: `const blob = "${'Qz'.repeat(24)}";` },
  { file: 'bare-long-hex.mjs', line: `const digest = "${'ab'.repeat(24)}";` },
  { file: 'git-object.mjs', line: `const objectId = "${'ab'.repeat(20)}";` },
  { file: 'git-url.md', line: `https://example.test/commit/${'ab'.repeat(20)}` },
  { file: 'abbreviated.md', line: '([abc1234](https://example.test/commit/abc1234))' },
  { file: 'base64-url.md', line: `https://example.test/assets/${'Qz'.repeat(24)}` },
];
const encodedRuleFindings = scanAddedLines(encodedRuleLines, terms).findings
  .filter(finding => finding.kind === 'encoded');
check(encodedRuleFindings.some(finding => finding.file === 'bare-base64.mjs'), 'bare base64 run of at least 40 characters is a finding');
check(encodedRuleFindings.some(finding => finding.file === 'bare-long-hex.mjs'), 'bare 48 character hex run is a finding');
check(!encodedRuleFindings.some(finding => finding.file === 'git-object.mjs'), 'exact lowercase 40 character git object id is ignored');
check(!encodedRuleFindings.some(finding => finding.file === 'git-url.md'), '40 character hex run in an HTTPS URL is ignored');
check(!encodedRuleFindings.some(finding => finding.file === 'abbreviated.md'), 'abbreviated hex id in a markdown link target is ignored');
check(!encodedRuleFindings.some(finding => finding.file === 'base64-url.md'), 'base64 run in an HTTPS URL is ignored');

const b64 = value => Buffer.from(value, 'utf8').toString('base64');
const b64url = value => Buffer.from(value, 'utf8').toString('base64url');
const hex = value => Buffer.from(value, 'utf8').toString('hex');
const decodedLines = [
  { file: 'b64-phone.mjs', line: `const v = "${b64('call 202-555-0147')}";` },
  { file: 'b64url-company.mjs', line: `const v = "${b64url('team at Quartz Nebula Labs??')}";` },
  { file: 'hex-person.mjs', line: `const v = "${hex('Orlena Venn')}";` },
  { file: 'b64-identity.mjs', line: `const v = "${b64('hello Zorina')}";` },
  { file: 'nested.mjs', line: `const v = "${b64(b64('202.555.0147'))}";` },
  { file: 'url-hidden.md', line: `https://example.test/p/${b64url('Orlena Venn')}` },
  { file: 'b64-generic.mjs', line: `const v = "${b64('first sales manager data')}";` },
  { file: 'random-hash.mjs', line: `const v = "${'9f'.repeat(4)}${'c3a1'.repeat(6)}";` },
];
const decodedFindings = scanAddedLines(decodedLines, terms).findings;
const decodedHit = (file, kind, via) => decodedFindings.some(finding => finding.file === file
  && finding.kind === kind && finding.via === via);
check(decodedHit('b64-phone.mjs', 'phone', 'base64'), 'base64 phone is decoded into a phone finding');
check(decodedHit('b64url-company.mjs', 'company', 'base64'), 'base64url company is decoded into a company finding');
check(decodedHit('hex-person.mjs', 'person', 'hex'), 'hex third-party name is decoded into a person finding');
check(decodedHit('b64-identity.mjs', 'identity', 'base64'), 'base64 first name is decoded into an identity finding');
check(decodedHit('nested.mjs', 'phone', 'base64+base64'), 'base64 of base64 phone is decoded two levels');
check(decodedHit('url-hidden.md', 'person', 'base64'), 'encoded name inside a URL segment is still a finding');
check(!decodedFindings.some(finding => finding.file === 'b64-generic.mjs'), 'encoded generic words produce no finding');
check(!decodedFindings.some(finding => finding.file === 'random-hash.mjs' && finding.via), 'random hex decodes to no finding');
check(decodedFindings.every(finding => !realTerms().includes(finding.maskedTerm)), 'decoded findings never expose an unmasked real term');
check(!scanned.findings.some(finding => finding.via), 'plain matches carry no decoded marker');

const duplicateLine ='Call 202-555-0147, then retry 202-555-0147.';
const duplicateFindings = scanAddedLines([
  { file: 'duplicate.mjs', line: duplicateLine },
  { file: 'separate.mjs', line: 'First location: 202-555-0147.' },
  { file: 'separate.mjs', line: 'Second location: 202-555-0147.' },
], terms).findings.filter(finding => finding.kind === 'phone');
check(duplicateFindings.filter(finding => finding.file === 'duplicate.mjs').length === 1, 'one line matching the same term twice yields one finding');
check(duplicateFindings.filter(finding => finding.file === 'separate.mjs').length === 2, 'different lines matching the same term yield two findings');
check(duplicateFindings[0]?.fixture === duplicateLine, 'the first occurrence is the surviving finding');

check(scanned.findings.every(finding => !realTerms().includes(finding.maskedTerm)), 'no finding exposes an unmasked real term');
check(maskValue('Invented') === 'I******d', 'mask keeps first and last character');
check(maskValue('abc') === '***', 'mask returns three stars for short input');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

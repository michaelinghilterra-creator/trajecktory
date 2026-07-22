#!/usr/bin/env node
/**
 * identity.test.mjs — unit tests for lib/identity.mjs, the ONE place that
 * decides whether two things are the same posting.
 *
 * WHY THIS EXISTS:
 * "Have I seen this job?" used to be answered by four different URL matchers and
 * four different company+role matchers, none sharing code. They disagreed, so
 * one set of triage results rendered a different count on every screen and none
 * was right, and distinct requisitions were merged onto one tracker row and lost.
 *
 * Every failure in this class is SILENT — a wrong row is a valid row, a missing
 * row is just a shorter table. Tests are the only guard.
 *
 * Run: node tests/identity.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  canonicalUrl, normalizeCompany, sameRole, roleSignature,
  urlFromReport, buildDecidedIndex, findDecided,
} from '../lib/identity.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('identity.test.mjs');

// ── canonicalUrl ──────────────────────────────────────────────────────────────
console.log('\n1. canonicalUrl');

check(canonicalUrl('https://x.com/a?utm_source=b') === 'https://x.com/a', 'strips utm_ tracking params');
check(canonicalUrl('https://x.com/a?gh_src=abc') === 'https://x.com/a', 'strips gh_src');
check(canonicalUrl('https://x.com/a/') === 'https://x.com/a', 'strips a trailing slash');
check(canonicalUrl('https://jobs.lever.co/co/uuid/apply') === 'https://jobs.lever.co/co/uuid', 'strips a trailing /apply');
check(canonicalUrl('https://jobs.ashbyhq.com/co/uuid/application') === 'https://jobs.ashbyhq.com/co/uuid', 'strips a trailing /application');
check(canonicalUrl('') === '' && canonicalUrl(null) === '' && canonicalUrl(undefined) === '', 'empty/null/undefined are safe');

// "apply" as a substring of a company slug must survive.
check(canonicalUrl('https://jobs.lever.co/applyacme/uuid') === 'https://jobs.lever.co/applyacme/uuid',
  'a company slug starting with "apply" is left intact');

// ReDoS pin. The original implementation used a regex whose optional greedy
// tail was re-scanned to end-of-string from every candidate start position, so
// a URL repeating the apply segment cost O(n^2). Posting URLs come from scanned
// job boards, so that input is not ours to trust. Budget is generous enough not
// to flake on a loaded machine while still failing loudly if quadratic returns:
// the old code took minutes on this input.
{
  const evil = 'https://x.com' + '/apply'.repeat(5000) + '/x';
  const t0 = Date.now();
  canonicalUrl(evil);
  const ms = Date.now() - t0;
  check(ms < 1000, `pathological repeated-segment URL stays linear (${ms}ms)`);
}

// gh_jid is the ONLY distinguishing id on some Greenhouse boards. Stripping it
// once collapsed whole boards' worth of postings onto a single dedup key.
check(canonicalUrl('https://co.com/careers/job?gh_jid=123') !== canonicalUrl('https://co.com/careers/job?gh_jid=456'),
  'gh_jid survives, so two postings on one static path stay distinct');

// THE REGRESSION PIN. Some ATS hosts serve many employers from one static path,
// with the posting id ONLY in the query string. A normalizer that keeps just
// gh_jid drops those ids, so unrelated postings canonicalize identically and the
// gate suppresses a live job as already-decided. Widening the id keys fixes it.
const sharedHostA = 'https://ats.example.com/recruitment/recruitment.html?cid=aaa111&jobId=100001';
const sharedHostB = 'https://ats.example.com/recruitment/recruitment.html?cid=bbb222&jobId=100002';
check(canonicalUrl(sharedHostA) !== canonicalUrl(sharedHostB),
  'two shared-host postings differing only by id query params do NOT collide');

// Hosts vary the casing of the same param across links to one posting.
check(canonicalUrl('https://x.com/r?jobId=9') === canonicalUrl('https://x.com/r?jobid=9'),
  'id query keys match case-insensitively');

// ── normalizeCompany / sameRole ───────────────────────────────────────────────
console.log('\n2. company and role identity');

check(normalizeCompany('Northwind, Inc.') === 'northwindinc', 'company normalizes to alphanumerics');
check(normalizeCompany(null) === '', 'null company is safe');

check(sameRole('Director, Platform Engineering', 'Director of Platform Engineering') === true,
  'punctuation and filler do not change a role');
check(sameRole('Sr. Director, Infrastructure', 'Senior Director, Infrastructure') === true, 'Sr folds to Senior');
check(sameRole('Vice President, Platform Engineering', 'VP, Platform Engineering') === true,
  '"vice president" folds to vp');

// Level is its own axis — this is what the deleted loose matcher got wrong.
check(sameRole('Director, Platform Engineering', 'VP, Platform Engineering') === false,
  'different explicit levels are different postings');
check(sameRole('Data Strategy', 'Data Operations') === false, 'different core nouns are different postings');
check(sameRole('Data Operations', 'Data Operations Planning') === false,
  'a superset title does not collapse onto its subset');

// THE OTHER REGRESSION PIN. Identical titles at one employer are NOT proof of
// one posting: three requisitions really did share a title, and merging them
// silently destroyed two evaluations. sameRole says true here — which is exactly
// why callers must let a differing URL veto it, and must never DELETE on it.
check(sameRole('Director, Platform Engineering', 'Director, Platform Engineering') === true,
  'identical titles match on the role axis alone...');
check(canonicalUrl('https://jobs.ashbyhq.com/co/aaa') !== canonicalUrl('https://jobs.ashbyhq.com/co/bbb'),
  '...but their differing URLs keep them distinct, which is what must win');

check(roleSignature('Senior Director, Platform Engineering').levels.has('senior'), 'roleSignature exposes levels');
check(roleSignature('Senior Director, Platform Engineering').core.has('platform'), 'roleSignature exposes core nouns');

// ── urlFromReport + the decided index ─────────────────────────────────────────
console.log('\n3. resolving rows to URLs');

const sb = mkdtempSync(join(tmpdir(), 'identity-test-'));
mkdirSync(join(sb, 'reports'), { recursive: true });
mkdirSync(join(sb, 'data'), { recursive: true });

writeFileSync(join(sb, 'reports/9001-v1.md'), '---\n{ "schema": "trajecktory-report/v1", "url": "https://jobs.example.com/a/111" }\n---\n# body\n');
writeFileSync(join(sb, 'reports/9002-legacy.md'), '# Legacy\n**URL:** https://jobs.example.com/b/222\n**Score:** 3.0\n');
writeFileSync(join(sb, 'reports/9003-nourl.md'), '# No url here\nsome prose\n');

check(urlFromReport('[9001](reports/9001-v1.md)', sb) === 'https://jobs.example.com/a/111', 'reads a v1 JSON frontmatter url');
check(urlFromReport('[9002](reports/9002-legacy.md)', sb) === 'https://jobs.example.com/b/222', 'reads a legacy **URL:** header');
check(urlFromReport('[9003](reports/9003-nourl.md)', sb) === null, 'a report with no url returns null');
check(urlFromReport('[9009](reports/9009-missing.md)', sb) === null, 'a missing report file returns null, does not throw');
check(urlFromReport('', sb) === null && urlFromReport(null, sb) === null, 'empty/null report link is safe');

const HEADER = [
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
].join('\n');

writeFileSync(join(sb, 'data/applications.md'), [
  HEADER,
  '| 9001 | 2020-01-01 | Alpha | Director, Platform Engineering | 4.0/5 | Discarded | ❌ | — | [1](reports/9001-v1.md) | n |',
  '| 9002 | 2020-01-02 | Beta | Director, Data Engineering | 3.0/5 | Rejected | ❌ | — | [2](reports/9002-legacy.md) | n |',
  '| 9003 | 2020-01-03 | Gamma | Head of Site Reliability | 3.5/5 | Evaluated | ❌ | — | [3](reports/9003-nourl.md) | n |',
  '',
].join('\n'));

const idx = buildDecidedIndex({ appsPath: join(sb, 'data/applications.md'), rootDir: sb });
check(idx.byUrl.size === 2, 'index holds the 2 rows whose URL resolved');
check(idx.noUrlByCompany.get('gamma')?.length === 1, 'the url-less row is held for the role fallback');

check(findDecided(idx, 'https://jobs.example.com/a/111')?.num === 9001, 'finds a decided posting by exact url');
check(findDecided(idx, 'https://jobs.example.com/a/111/apply?utm_source=x')?.num === 9001,
  'finds it through a cosmetic url variant');
check(findDecided(idx, 'https://jobs.example.com/zzz/999') === null, 'an unseen url is not decided');
check(findDecided(idx, 'https://jobs.example.com/a/111')?.status === 'Discarded', 'reports the existing status');

// Role fallback engages ONLY for tracker rows with no resolvable url.
check(findDecided(idx, 'https://new.example.com/x', { company: 'Gamma', role: 'Head of Site Reliability' })?.num === 9003,
  'role fallback matches a url-less tracker row');
check(findDecided(idx, 'https://new.example.com/x', { company: 'Alpha', role: 'Director, Platform Engineering' }) === null,
  'role fallback does NOT fire for a row that HAS a url — a differing url wins');

// Ambiguity guard: a stripped shared-host path serving two employers must not gate.
writeFileSync(join(sb, 'reports/9004-a.md'), '---\n{ "url": "https://shared.host/careers" }\n---\n');
writeFileSync(join(sb, 'reports/9005-b.md'), '---\n{ "url": "https://shared.host/careers" }\n---\n');
writeFileSync(join(sb, 'data/apps2.md'), [
  HEADER,
  '| 9004 | 2020-01-04 | CompanyOne | Director, Platform Engineering | 4.0/5 | Discarded | ❌ | — | [9004](reports/9004-a.md) | n |',
  '| 9005 | 2020-01-05 | TotallyOther | Director, Data Engineering | 3.0/5 | Rejected | ❌ | — | [9005](reports/9005-b.md) | n |',
  '',
].join('\n'));
const idx2 = buildDecidedIndex({ appsPath: join(sb, 'data/apps2.md'), rootDir: sb });
check(idx2.ambiguous.has('https://shared.host/careers'), 'one id-less url across two employers is flagged ambiguous');
check(findDecided(idx2, 'https://shared.host/careers') === null, 'an ambiguous url never suppresses');

// ...but the same-employer-two-spellings case must still suppress, because that
// is a real duplicate. Measured against a real tracker, every ambiguity flag was
// this case and none was a true cross-employer collision.
writeFileSync(join(sb, 'reports/9006-a.md'), '---\n{ "url": "https://jobs.ashbyhq.com/co/aaa-111" }\n---\n');
writeFileSync(join(sb, 'reports/9007-b.md'), '---\n{ "url": "https://jobs.ashbyhq.com/co/aaa-111" }\n---\n');
writeFileSync(join(sb, 'data/apps3.md'), [
  HEADER,
  '| 9006 | 2020-01-06 | Northwind | Staff Platform Engineer | 4.0/5 | Discarded | ❌ | — | [9006](reports/9006-a.md) | n |',
  '| 9007 | 2020-01-07 | Northwind Inc. | Staff Platform Engineer | 3.0/5 | Closed | ❌ | — | [9007](reports/9007-b.md) | n |',
  '',
].join('\n'));
const idx3 = buildDecidedIndex({ appsPath: join(sb, 'data/apps3.md'), rootDir: sb });
check(idx3.ambiguous.size === 0, 'one employer spelled two ways is NOT ambiguous');
check(findDecided(idx3, 'https://jobs.ashbyhq.com/co/aaa-111')?.num === 9006, 'and it still suppresses, reporting the first row');

rmSync(sb, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * scan-parsers.test.mjs — pin the ATS detection + response parsing in scan.mjs.
 *
 * Focus: the SmartRecruiters + Workable support added on top of the existing
 * Greenhouse/Ashby/Lever/Workday parsers. Importing scan.mjs must NOT start a
 * scan (main() is guarded to direct CLI invocation only) — if that guard
 * regresses, this file hangs/scan-writes and the failure is loud.
 *
 * Fixtures are fully synthetic (invented companies/ids), mirroring the real API
 * response SHAPE so the parsers are genuinely exercised without any live calls.
 * Run: node tests/scan-parsers.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { detectApi, parseWorkable, parseSmartRecruiters } from '../scan.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

// ── 1. detectApi — SmartRecruiters ───────────────────────────────────────────
console.log('\n1. detectApi: SmartRecruiters');
{
  const a = detectApi({ careers_url: 'https://careers.smartrecruiters.com/AcmeCo' });
  check(a?.type === 'smartrecruiters', `careers.smartrecruiters.com/{id} → smartrecruiters (${a?.type})`);
  check(a?.meta?.companyId === 'AcmeCo', `companyId captured (${a?.meta?.companyId})`);
  check(a?.url === 'https://api.smartrecruiters.com/v1/companies/AcmeCo/postings',
    `postings API url built (${a?.url})`);

  const b = detectApi({ careers_url: 'https://jobs.smartrecruiters.com/AcmeCo/74400-sr-manager' });
  check(b?.type === 'smartrecruiters' && b?.meta?.companyId === 'AcmeCo',
    'jobs.smartrecruiters.com/{id}/{posting} → same companyId');
}

// ── 2. detectApi — Workable ──────────────────────────────────────────────────
console.log('\n2. detectApi: Workable');
{
  const a = detectApi({ careers_url: 'https://apply.workable.com/acmehr/' });
  check(a?.type === 'workable', `apply.workable.com/{slug} → workable (${a?.type})`);
  check(a?.url === 'https://apply.workable.com/api/v1/widget/accounts/acmehr?details=true',
    `widget API url built (${a?.url})`);

  const b = detectApi({ careers_url: 'https://acmehr.workable.com/jobs' });
  check(b?.type === 'workable' && /accounts\/acmehr\?/.test(b?.url || ''),
    'subdomain {slug}.workable.com → workable with slug');

  // The bare apply host with no slug must NOT resolve to slug "apply".
  const c = detectApi({ careers_url: 'https://apply.workable.com/' });
  check(!c || c.type !== 'workable' || !/accounts\/apply\?/.test(c.url || ''),
    'apply.workable.com/ (no slug) does not mis-detect slug "apply"');
}

// ── 3. detectApi — regressions (existing platforms + skip) ───────────────────
console.log('\n3. detectApi: existing platforms still work, bespoke still null');
{
  check(detectApi({ careers_url: 'https://jobs.ashbyhq.com/acme' })?.type === 'ashby', 'ashby still detected');
  check(detectApi({ careers_url: 'https://jobs.lever.co/acme' })?.type === 'lever', 'lever still detected');
  check(detectApi({ api: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' })?.type === 'greenhouse',
    'greenhouse still detected');
  check(detectApi({ careers_url: 'https://acme.com/careers' }) === null, 'bespoke careers page → null');
}

// ── 4. parseWorkable ─────────────────────────────────────────────────────────
console.log('\n4. parseWorkable');
{
  const fixture = { name: 'AcmeHR', jobs: [
    { title: 'Director of Revenue Operations', url: 'https://apply.workable.com/acmehr/j/ABC123/',
      shortlink: 'https://acmehr.workable.com/j/ABC123', telecommuting: true, department: 'Operations',
      city: 'Austin', state: 'TX', country: 'US', published_on: '2026-07-20', created_at: '2026-07-01' },
    { title: 'Office Manager', url: 'https://apply.workable.com/acmehr/j/DEF456/',
      telecommuting: false, department: 'People', city: '', state: '', country: 'US', created_at: '2026-06-01' },
  ]};
  const offers = parseWorkable(fixture, 'AcmeHR');
  check(offers.length === 2, `maps all jobs (${offers.length}/2)`);
  check(offers[0].title === 'Director of Revenue Operations', 'title from j.title');
  check(offers[0].url === 'https://apply.workable.com/acmehr/j/ABC123/', 'url prefers j.url');
  check(offers[0].location === 'Austin, TX, US', `location joins city/state/country (${offers[0].location})`);
  check(offers[0].postedAt === '2026-07-20', 'postedAt prefers published_on');
  check(/remote/.test(offers[0].remoteHint), 'telecommuting:true → "remote" in remoteHint');
  check(offers[1].postedAt === '2026-06-01', 'postedAt falls back to created_at');
  check(!/remote/.test(offers[1].remoteHint), 'telecommuting:false → no "remote"');
  check(offers[1].location === 'US', 'empty city/state dropped from location');
}

// ── 5. parseSmartRecruiters ──────────────────────────────────────────────────
console.log('\n5. parseSmartRecruiters');
{
  const fixture = { content: [
    { id: '744000133907678', name: 'Sr. Director, Revenue Analytics', releasedDate: '2026-06-24T10:00:11.853Z',
      location: { city: 'Austin', region: 'TX', country: 'us', remote: false, hybrid: true, fullLocation: 'Austin, TX, United States' } },
    { id: '744000999', name: 'Remote Analyst', releasedDate: '2026-07-02T00:00:00.000Z',
      location: { city: '', region: '', country: 'us', remote: true, hybrid: false } },
  ]};
  const offers = parseSmartRecruiters(fixture, 'Acme Co', 'AcmeCo');
  check(offers.length === 2, `maps all postings (${offers.length}/2)`);
  check(offers[0].title === 'Sr. Director, Revenue Analytics', 'title from j.name');
  check(offers[0].url === 'https://jobs.smartrecruiters.com/AcmeCo/744000133907678',
    `public posting url built from companyId + id (${offers[0].url})`);
  check(offers[0].location === 'Austin, TX, United States', 'location prefers fullLocation');
  check(offers[0].postedAt === '2026-06-24T10:00:11.853Z', 'postedAt from releasedDate');
  check(/hybrid/.test(offers[0].remoteHint) && !/remote/.test(offers[0].remoteHint.replace('hybrid','')),
    'hybrid:true reflected in remoteHint');
  check(offers[1].location === 'us', 'falls back to city/region/country join when no fullLocation');
  check(/remote/.test(offers[1].remoteHint), 'remote:true → "remote" in remoteHint');
}

console.log(`\n📊 scan parsers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

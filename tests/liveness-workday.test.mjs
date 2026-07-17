#!/usr/bin/env node
/**
 * liveness-workday.test.mjs — unit tests for the Workday CXS-API liveness path
 * in liveness-core.mjs (parseWorkdayUrl + checkWorkdayLiveness).
 *
 * Context: Workday serves job pages (…/job/…_R12345) as JS-rendered SPAs that
 * 404 / time out on a raw Playwright navigation even when the posting is live,
 * so classifyLiveness() systematically false-flagged every Workday URL as dead.
 * We now resolve those via the public CXS JSON API instead. These tests are
 * deterministic — they inject a stub `fetchImpl`, so no network is touched.
 *
 * Run: node tests/liveness-workday.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { parseWorkdayUrl, checkWorkdayLiveness, workdaySiteFromCareersUrl } from '../liveness-core.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('liveness-workday.test.mjs');

// ── parseWorkdayUrl ───────────────────────────────────────────────────────────

const contoso = parseWorkdayUrl(
  'https://contoso.wd1.myworkdayjobs.com/job/Remote-New-York-United-States-of-America/Director--Revenue-Operations_R00000'
);
check(contoso?.tenant === 'contoso' && contoso?.shard === 'wd1',
  'short-form: extracts tenant + shard');
check(contoso?.siteFromUrl === null,
  'short-form: no site in path → siteFromUrl null');
check(contoso?.reqId === 'R00000',
  'short-form: extracts trailing _R00000 requisition id');
check(contoso?.externalPath === '/job/Remote-New-York-United-States-of-America/Director--Revenue-Operations_R00000',
  'short-form: externalPath starts at /job/');

const full = parseWorkdayUrl(
  'https://datarobot.wd1.myworkdayjobs.com/en-US/DataRobot_External_Careers/job/VP--Revenue-Operations---Strategy_R-102632'
);
check(full?.siteFromUrl === 'DataRobot_External_Careers',
  'full-form: extracts site, dropping the en-US locale segment');
check(full?.reqId === 'R-102632',
  'full-form: requisition id keeps internal dashes (R-102632)');
check(full?.externalPath === '/job/VP--Revenue-Operations---Strategy_R-102632',
  'full-form: externalPath excludes locale + site prefix');

const dashedReq = parseWorkdayUrl(
  'https://alkami.wd12.myworkdayjobs.com/job/US-Remote/Director--Go-To-Market-Financial-Planning---Analysis_JR-000627-1'
);
check(dashedReq?.reqId === 'JR-000627-1',
  'requisition id after the LAST underscore only (JR-000627-1)');

check(parseWorkdayUrl('https://contoso.wd1.myworkdayjobs.com/contoso') === null,
  'board / careers-home URL (no /job/) → null (use Playwright)');
check(parseWorkdayUrl('https://boards.greenhouse.io/acme/jobs/123') === null,
  'non-Workday URL → null');
check(parseWorkdayUrl('') === null && parseWorkdayUrl(null) === null,
  'empty / non-string input → null');
check(parseWorkdayUrl(
  'https://contoso.wd1.myworkdayjobs.com/job/Remote/Director_R00000?src=indeed#top'
)?.reqId === 'R00000',
  'query string + hash are ignored when extracting the req id');

// ── workdaySiteFromCareersUrl (portals.yml hint extraction) ───────────────────

check(workdaySiteFromCareersUrl('https://contoso.wd1.myworkdayjobs.com/contoso') === 'contoso',
  'careers_url: bare site path → site');
check(workdaySiteFromCareersUrl('https://alkami.wd12.myworkdayjobs.com/Alkami') === 'Alkami',
  'careers_url: preserves site-name casing (Alkami)');
check(workdaySiteFromCareersUrl('https://datarobot.wd1.myworkdayjobs.com/en-US/DataRobot_External_Careers') === 'DataRobot_External_Careers',
  'careers_url: drops leading en-US locale, returns the real site (not "en-US")');
check(workdaySiteFromCareersUrl('https://adobe.wd5.myworkdayjobs.com/external_experienced/') === 'external_experienced',
  'careers_url: trailing slash tolerated');
check(workdaySiteFromCareersUrl('https://jobs.lever.co/acme') === null,
  'careers_url: non-Workday host → null');

// ── checkWorkdayLiveness (injected fetch) ─────────────────────────────────────
//
// Stub builder: given a router (url, init) → { status, body }, returns a
// fetch-shaped impl. `body` is the parsed JSON object (or undefined for none).
function stubFetch(router) {
  return async (url, init) => {
    const { status = 200, body } = router(url, init) || {};
    return {
      status,
      ok: status >= 200 && status < 300,
      async json() {
        if (body === undefined) throw new Error('no json body');
        return body;
      },
    };
  };
}

const ZENDESK_URL =
  'https://contoso.wd1.myworkdayjobs.com/job/Remote-New-York-United-States-of-America/Director--Revenue-Operations_R00000';

// 1) Direct detail endpoint returns the posting → active.
{
  const fetchImpl = stubFetch((url) => {
    if (url.includes('/wday/cxs/contoso/contoso/job/')) {
      return { status: 200, body: { jobPostingInfo: { title: 'Director, Sales Strategy', canApply: true } } };
    }
    return { status: 200, body: { total: 0, jobPostings: [] } };
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v?.result === 'active', 'detail endpoint 200 + title → active');
}

// 2) Detail 404, but search-by-req finds the posting → active (search fallback).
{
  const fetchImpl = stubFetch((url, init) => {
    if (init?.method === 'POST') {
      return { status: 200, body: { total: 1, jobPostings: [
        { title: 'Director, Sales Strategy', externalPath: '/job/Remote/Director--Revenue-Operations_R00000' },
      ] } };
    }
    return { status: 404 };   // detail miss
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v?.result === 'active', 'search returns matching requisition → active (detail-independent)');
}

// 3) Valid site, req genuinely absent (detail 404 + empty search) → expired.
{
  const fetchImpl = stubFetch((url, init) => {
    if (init?.method === 'POST') return { status: 200, body: { total: 0, jobPostings: [] } };
    return { status: 404 };
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v?.result === 'expired', 'valid site + requisition absent → expired');
}

// 4) Wrong site (404) tried first, correct site (tenant) resolves it → active.
//    siteFromUrl is null for the short form, so candidates are [hint, tenant].
{
  const calls = [];
  const fetchImpl = stubFetch((url, init) => {
    calls.push(url);
    if (url.includes('/wday/cxs/contoso/WrongSite/')) return { status: 404 };   // bad hint
    if (url.includes('/wday/cxs/contoso/contoso/job/')) {
      return { status: 200, body: { jobPostingInfo: { title: 'Director, Sales Strategy' } } };
    }
    return { status: 200, body: { total: 0, jobPostings: [] } };
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { siteHints: ['WrongSite'], fetchImpl });
  check(v?.result === 'active', 'falls through a wrong site hint to the tenant site → active');
  check(calls.some((u) => u.includes('/WrongSite/')) && calls.some((u) => u.includes('/contoso/')),
    'tried the wrong hint before the tenant fallback');
}

// 5) Every candidate site 404s (site unresolvable) → null (Playwright fallback).
{
  const fetchImpl = stubFetch(() => ({ status: 404 }));
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v === null, 'no resolvable career site → null (defer to Playwright)');
}

// 6) Network failure on every request → null (never a false "dead").
{
  const fetchImpl = async () => { throw new Error('ECONNRESET'); };
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v === null, 'network error throughout → null (defer to Playwright, not expired)');
}

// 7) Non-Workday URL → null without any fetch.
{
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200, ok: true, json: async () => ({}) }; };
  const v = await checkWorkdayLiveness('https://boards.greenhouse.io/acme/jobs/123', { fetchImpl });
  check(v === null && called === false, 'non-Workday URL → null, fetch never called');
}

// 8) Requisition-id substring must not false-match (R327 ≠ R00000).
{
  const fetchImpl = stubFetch((url, init) => {
    if (init?.method === 'POST') {
      return { status: 200, body: { total: 1, jobPostings: [
        { title: 'Other', externalPath: '/job/Remote/Something_R327' },   // shorter id
      ] } };
    }
    return { status: 404 };   // detail miss
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v?.result === 'expired', 'partial req-id (R327) does NOT satisfy R00000 → expired');
}

// 9) Detail served but canApply:false (closed posting) → not active; the open-
//    reqs board search doesn't list it → expired.
{
  const fetchImpl = stubFetch((url, init) => {
    if (init?.method === 'POST') return { status: 200, body: { total: 0, jobPostings: [] } };
    return { status: 200, body: { jobPostingInfo: { title: 'Director, Sales Strategy', canApply: false } } };
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { fetchImpl });
  check(v?.result === 'expired', 'detail 200 but canApply:false + absent from board → expired');
}

// 10) Multi-site tenant: the FIRST valid career site lacks the req, but a LATER
//     candidate hosts it. Must NOT short-circuit to expired on the first valid
//     site — must exhaust candidates and return active (Finding B).
{
  const fetchImpl = stubFetch((url, init) => {
    // "SiteA" is a real career site (search 200) that does NOT have the req.
    if (url.includes('/wday/cxs/contoso/SiteA/')) {
      return init?.method === 'POST'
        ? { status: 200, body: { total: 0, jobPostings: [] } }
        : { status: 404 };   // detail miss on SiteA
    }
    // The tenant-default site DOES host it.
    if (url.includes('/wday/cxs/contoso/contoso/job/')) {
      return { status: 200, body: { jobPostingInfo: { title: 'Director, Sales Strategy', canApply: true } } };
    }
    return { status: 200, body: { total: 0, jobPostings: [] } };
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { siteHints: ['SiteA'], fetchImpl });
  check(v?.result === 'active',
    'multi-site: first valid site lacks the req but a later candidate has it → active (no premature expired)');
}

// 11) All valid sites genuinely lack the req → expired only AFTER exhausting them.
{
  const seenSites = new Set();
  const fetchImpl = stubFetch((url, init) => {
    const m = url.match(/\/wday\/cxs\/contoso\/([^/]+)\//);
    if (m) seenSites.add(m[1]);
    if (init?.method === 'POST') return { status: 200, body: { total: 0, jobPostings: [] } };
    return { status: 404 };   // detail miss everywhere
  });
  const v = await checkWorkdayLiveness(ZENDESK_URL, { siteHints: ['SiteA'], fetchImpl });
  check(v?.result === 'expired' && seenSites.has('SiteA') && seenSites.has('contoso'),
    'expired only after every candidate site (hint + tenant) was searched');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

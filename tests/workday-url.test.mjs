#!/usr/bin/env node
// Workday links: the scanner must store a real page (careers-site segment included),
// and canonicalUrl must treat the old site-less shape and the corrected shape as ONE
// posting, so fixing the link does not make every Workday job look new again.

import { detectApi, parseWorkday } from '../scan.mjs';
import { canonicalUrl } from '../lib/identity.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

const BASE = 'https://zorblax.wd1.myworkdayjobs.com';
const posting = (externalPath) => ({ jobPostings: [{ title: 'Widget Operations Manager', externalPath, locationsText: 'Remote' }] });
const PATH = '/job/Example-City/Widget-Operations-Manager_JR900001-1';

console.log('workday-url.test.mjs');

console.log('\n1. parseWorkday builds a real page URL');
{
  check(parseWorkday(posting(PATH), 'Zorblax', BASE, 'ZorblaxCareers')[0].url === `${BASE}/ZorblaxCareers${PATH}`, 'site segment is included');
  check(parseWorkday(posting(PATH), 'Zorblax', BASE)[0].url === `${BASE}${PATH}`, 'no site keeps the legacy shape');
  check(parseWorkday(posting(PATH), 'Zorblax', BASE, '')[0].url === `${BASE}${PATH}`, 'empty site keeps the legacy shape');
  check(parseWorkday(posting(PATH), 'Zorblax', BASE, 'en-US/ZorblaxCareers')[0].url === `${BASE}/en-US/ZorblaxCareers${PATH}`, 'a locale-prefixed site keeps both segments');
  check(parseWorkday(posting(PATH), 'Zorblax', BASE, '/ZorblaxCareers/')[0].url === `${BASE}/ZorblaxCareers${PATH}`, 'leading and trailing slashes never double up');
  check(parseWorkday(posting(''), 'Zorblax', BASE, 'ZorblaxCareers')[0].url === '', 'a posting with no externalPath yields an empty url');
}

console.log('\n2. detectApi carries the site through');
{
  const d = detectApi({ careers_url: `${BASE}/ZorblaxCareers` });
  check(d && d.type === 'workday' && d.meta.site === 'ZorblaxCareers' && d.meta.baseUrl === BASE, 'workday detection returns baseUrl and site');
  check(d && d.url === `${BASE}/wday/cxs/zorblax/ZorblaxCareers/jobs`, 'the API url is unchanged');
}

console.log('\n3. canonicalUrl: one posting, however the link is spelled');
{
  const oldShape = `${BASE}${PATH}`;
  const key = canonicalUrl(oldShape);
  check(key.startsWith('workday:'), 'a Workday posting keys on tenant, shard and the /job/ path');
  check(canonicalUrl(`${BASE}/ZorblaxCareers${PATH}`) === key, 'corrected shape equals the old shape');
  check(canonicalUrl(`${BASE}/en-US/ZorblaxCareers${PATH}`) === key, 'locale-prefixed shape equals the old shape');
  check(canonicalUrl(`${BASE}/ZorblaxCareers${PATH}?source=example`) === key, 'a query string does not split it');
  check(canonicalUrl(`${BASE}/ZorblaxCareers${PATH}/apply`) === key, 'the apply page is the same posting');
  check(canonicalUrl(`https://ZORBLAX.WD1.myworkdayjobs.com/ZorblaxCareers${PATH}`) === key, 'host case does not split it');
}

console.log('\n4. different postings stay different');
{
  const a = canonicalUrl(`${BASE}/ZorblaxCareers${PATH}`);
  const b = canonicalUrl(`${BASE}/ZorblaxCareers/job/Example-City/Widget-Operations-Manager_JR900002-1`);
  const c = canonicalUrl(`https://quennox.wd1.myworkdayjobs.com/ZorblaxCareers${PATH}`);
  check(a !== b, 'a different requisition is a different posting');
  check(a !== c, 'the same path at another tenant is a different posting');
}

console.log('\n5. non-posting URLs are not collapsed');
{
  check(!canonicalUrl(`${BASE}/ZorblaxCareers`).startsWith('workday:'), 'a board URL is not a posting key');
  check(!canonicalUrl(`${BASE}/ZorblaxCareers?q=widget`).startsWith('workday:'), 'a search URL is not a posting key');
  check(!canonicalUrl('https://jobs.example.test/zorblax/1').startsWith('workday:'), 'a non-Workday URL is untouched by the rule');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

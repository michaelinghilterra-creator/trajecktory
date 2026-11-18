#!/usr/bin/env node

import { braveProfileSearch, buildPeopleQueries, collectPeople, parseProfileHit } from '../lib/people-search.mjs';

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
};

console.log('people-search.test.mjs');

const talent = buildPeopleQueries({ company: 'Zorblax Systems', tier: 'talent' });
const revops = buildPeopleQueries({ company: 'Zorblax Systems', tier: 'principal', track: 'revops' });
const salesdev = buildPeopleQueries({ company: 'Quennox Labs', tier: 'principal', track: 'salesdev' });
check(talent.length === 4 && talent.every(q => q.startsWith('site:linkedin.com/in "Zorblax Systems"')), 'talent builds four ordered profile queries');
check(talent[0].endsWith('recruiter') && talent[3].includes('HR business partner'), 'talent query roles are ordered');
check(revops.length === 5 && revops[0].includes('revenue operations') && revops[4].includes('VP marketing'), 'revops builds five requested queries');
check(salesdev.length === 5 && salesdev[1].includes('sales development') && salesdev[2].includes('business development'), 'sales development builds five requested queries');

const accepted = parseProfileHit({
  url: 'https://uk.linkedin.com/in/Avery-Example-000?trk=public#detail',
  title: 'Avery Example - Head of Talent - Zorblax Systems | LinkedIn',
  description: 'Avery leads recruiting at Zorblax Systems.',
});
check(accepted?.linkedin === 'https://www.linkedin.com/in/Avery-Example-000/', 'country subdomain is normalized and slug case is kept');
check(accepted?.name === 'Avery Example' && accepted?.headline === 'Head of Talent - Zorblax Systems', 'dash title yields name and headline');
const simple = parseProfileHit({ url: 'https://www.linkedin.com/in/jordan-sample-000/', title: 'Jordan Sample | LinkedIn', description: '' });
check(simple?.name === 'Jordan Sample' && simple.headline === '', 'simple LinkedIn title is parsed');
const unicodeDash = parseProfileHit({ url: 'https://ca.linkedin.com/in/jordan-sample-001', title: 'Jordan Sample \u2013 Recruiter | LinkedIn', description: 'x'.repeat(350) });
check(unicodeDash?.headline === 'Recruiter' && unicodeDash.snippet.length === 300, 'unicode dash is parsed and snippet is truncated');
check(parseProfileHit({ url: 'https://www.linkedin.com/company/zorblax/', title: 'Zorblax Systems | LinkedIn' }) === null, 'company URLs are rejected');
check(parseProfileHit({ url: 'https://www.linkedin.com/jobs/view/123/', title: 'Role | LinkedIn' }) === null, 'jobs URLs are rejected');
check(parseProfileHit({ url: 'https://linkedin.com/in/avery-example-000', title: 'Avery Example | LinkedIn' }) === null, 'bare LinkedIn host is rejected');
check(parseProfileHit({ url: 'https://www.linkedin.com/in/avery-example-000', title: 'Avery | LinkedIn' }) === null, 'one word names are rejected');

const sleepCalls = [];
let queryIndex = 0;
const collected = await collectPeople({
  company: 'Zorblax Systems', tier: 'talent', maxQueries: 3, delayMs: 17,
  sleep: async ms => { sleepCalls.push(ms); },
  search: async () => {
    queryIndex += 1;
    if (queryIndex === 2) throw new Error('temporary fixture failure');
    return [{
      url: queryIndex === 1
        ? 'https://www.linkedin.com/in/avery-example-000?one=1'
        : 'https://uk.linkedin.com/in/avery-example-000?two=2',
      title: 'Avery Example - Recruiter | LinkedIn', description: 'Current at Zorblax Systems',
    }];
  },
});
check(collected.people.length === 1 && collected.queriesRun === 3, 'collection dedupes normalized URLs and counts queries');
check(collected.errors.length === 1 && collected.errors[0].error.includes('temporary'), 'partial failures are recorded');
check(sleepCalls.length === 2 && sleepCalls.every(ms => ms === 17), 'injected sleep runs between queries');

let cappedCalls = 0;
const capped = await collectPeople({
  company: 'Quennox Labs', tier: 'talent', maxPeople: 1, delayMs: 1,
  search: async () => {
    cappedCalls += 1;
    return [{ url: 'https://www.linkedin.com/in/jordan-sample-000', title: 'Jordan Sample | LinkedIn', description: '' }];
  },
  sleep: async () => {},
});
check(capped.people.length === 1 && cappedCalls === 1, 'people cap stops later queries');

let totalFailure;
try {
  await collectPeople({
    company: 'Quennox Labs', tier: 'talent', maxQueries: 2, delayMs: 0,
    search: async () => { throw new Error('fixture outage'); }, sleep: async () => {},
  });
} catch (error) {
  totalFailure = error;
}
check(totalFailure?.message.startsWith('people search failed:'), 'total failure throws the required error prefix');
check(totalFailure?.queriesRun === 2, 'total failure reports attempted query count');

let fetchUrl, fetchOptions;
const brave = braveProfileSearch('fixture-key', {
  fetchFn: async (url, options) => {
    fetchUrl = url; fetchOptions = options;
    return { ok: true, json: async () => ({ web: { results: [{ url: 'profile', title: 'title', description: 'snippet' }] } }) };
  },
});
const braveResults = await brave('site:linkedin.com/in "Zorblax Systems" recruiter');
check(fetchUrl.includes('count=20') && fetchUrl.includes(encodeURIComponent('Zorblax Systems')), 'Brave request encodes the query and count');
check(fetchOptions.headers['X-Subscription-Token'] === 'fixture-key', 'Brave request sends the subscription header');
check(braveResults[0].description === 'snippet', 'Brave response maps description');
let braveError;
try {
  await braveProfileSearch('fixture-key', { fetchFn: async () => ({ ok: false, status: 429 }) })('query');
} catch (error) {
  braveError = error;
}
check(braveError?.message === 'Brave API HTTP 429', 'Brave non-OK status throws the required message');

// One role's query must not use up the whole list before the other roles run.
let shareQuery = 0;
const shared = await collectPeople({
  company: 'Zorblax Systems', tier: 'principal', track: 'revops', delayMs: 0, maxPerQuery: 2,
  sleep: async () => {},
  search: async () => {
    shareQuery += 1;
    return Array.from({ length: 5 }, (_, index) => ({
      url: `https://www.linkedin.com/in/jordan-sample-${shareQuery}${index}`,
      title: 'Jordan Sample - Director | LinkedIn', description: 'Current at Zorblax Systems',
    }));
  },
});
check(shared.queriesRun === 5 && shared.people.length === 10, 'each query adds at most its share so every role query runs');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

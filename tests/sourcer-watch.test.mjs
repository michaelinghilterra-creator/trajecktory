#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildWatchNight, isWatchDate, listWatchDates } from '../lib/sourcer-watch.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
}

console.log('sourcer-watch.test.mjs');

const root = makeSandbox('sourcer-watch');
const date = '2035-04-09';
const nightDir = join(root, 'inbox', date);
mkdirSync(nightDir, { recursive: true });

const candidates = [
  { site: 'careerpages', url: 'https://example.test/jobs/title', title: 'Director of Widget Operations', company: 'Zorblax Systems', location: 'Remote', posted: '2035-04-08', segment: 'cyber', description: '<p>never send this</p>' },
  { site: 'hardpages', url: 'https://example.test/jobs/location', title: 'Director of Widget Operations', company: 'Quennox Labs', location: 'Chicago', posted: '2035-04-07', segment: 'cyber' },
  { site: 'careerpages', url: 'https://example.test/jobs/duplicate', title: 'Director of Widget Operations', company: 'Zorblax Systems' },
  { site: 'careerpages', url: 'https://example.test/jobs/old', title: 'Director of Widget Operations', company: 'Quennox Labs' },
  { site: 'hardpages', url: 'https://example.test/jobs/prefilter', title: 'Director of Widget Operations', company: 'Zorblax Systems' },
  { site: 'careerpages', url: 'https://example.test/jobs/evaluated?utm_source=watch', applyUrl: 'https://example.test/apply/evaluated', title: 'Director of Widget Operations', company: 'Quennox Labs' },
  { site: 'hardpages', url: 'https://example.test/jobs/kept', title: 'Director of Widget Operations', company: 'Zorblax Systems' },
  { site: 'othersite', url: 'https://example.test/jobs/ignored', title: 'Director of Widget Operations', company: 'Quennox Labs' },
];
const jsonl = [JSON.stringify(candidates[0]), '{bad json', ...candidates.slice(1).map(row => JSON.stringify(row))].join('\r\n');
writeFileSync(join(nightDir, 'candidates.jsonl'), jsonl);

const rejects = [
  'stage\treason\tsite\tchannel\turl\ttitle\tcompany',
  'gate-title\ttitle\tcareerpages\twatch\thttps://example.test/jobs/title\tDirector of Widget Operations\tZorblax Systems',
  'gate-location\tlocation\thardpages\twatch\thttps://example.test/jobs/location\tDirector of Widget Operations\tQuennox Labs',
  'deduplicate\tduplicate\tcareerpages\twatch\thttps://example.test/jobs/duplicate\tDirector of Widget Operations\tZorblax Systems',
  'age-gate\tage\tcareerpages\twatch\thttps://example.test/jobs/old\tDirector of Widget Operations\tQuennox Labs',
  'spark-prefilter\tprefilter\thardpages\twatch\thttps://example.test/jobs/prefilter\tDirector of Widget Operations\tZorblax Systems',
].join('\r\n');
writeFileSync(join(root, `rejects-${date}-cyber.tsv`), rejects);

writeFileSync(join(root, `summary-${date}.json`), JSON.stringify({
  ingest: { writtenBySite: { careerpages: 4, hardpages: 3, othersite: 50 } },
  eval: { reports: [{ reportNum: 42, company: 'Quennox Labs', role: 'Director of Widget Operations', score: '4.1/5', status: 'Evaluated', url: 'https://example.test/jobs/evaluated' }] },
}));
writeFileSync(join(nightDir, 'stats.json'), JSON.stringify({
  sites: {
    careerpages: { health: { fetched: 12, errors: 1, note: 'ignored' } },
    othersite: { health: { fetched: 99 } },
  },
}));

const night = buildWatchNight({ stateDir: root, date, sites: ['careerpages', 'hardpages'] });
check(night.roles.length === 7, 'filters candidates to watched sites and skips a bad JSON line');
check(night.totals.found === 7 && night.totals.dropped === 5 && night.totals.evaluated === 1 && night.totals.kept === 1, 'counts found, dropped, evaluated, and kept roles');
check(night.totals.strong === 1, 'counts scores at or above the strong threshold');
check(night.roles[0].outcome === 'evaluated' && night.roles[0].score === 4.1 && night.roles[0].reportNum === 42, 'joins an evaluation by canonical URL and parses its score');
check(night.roles.some(role => role.url.endsWith('/kept') && role.outcome === 'kept' && role.reason === 'No result recorded'), 'keeps a role with no recorded result');
check(night.byOutcome['Title filter'] === 1 && night.byOutcome.Location === 1, 'maps title and location gate labels');
check(night.byOutcome.Duplicate === 1 && night.byOutcome['Too old'] === 1 && night.byOutcome['Pre-filter'] === 1, 'maps duplicate, age, and pre-filter labels');
check(night.health.careerpages.fetched === 12 && night.health.careerpages.errors === 1 && !('note' in night.health.careerpages), 'passes through numeric health fields only');
check(!JSON.stringify(night).includes('never send this') && !('description' in night.roles[0]), 'never includes candidate descriptions');

const emptyDate = '2031-02-03';
mkdirSync(join(root, 'inbox', emptyDate), { recursive: true });
const empty = buildWatchNight({ stateDir: root, date: emptyDate, sites: ['careerpages'] });
check(empty.roles.length === 0 && empty.totals.found === 0, 'tolerates all optional files being missing');

for (let day = 1; day <= 31; day++) {
  const value = `2032-01-${String(day).padStart(2, '0')}`;
  mkdirSync(join(root, 'inbox', value), { recursive: true });
}
const dates = listWatchDates(root);
check(dates.length === 30, 'caps listed dates at 30');
check(dates.every((value, index) => index === 0 || dates[index - 1] > value), 'lists dates newest first');
check(dates[0] === date, 'includes the newest inbox date first');
check(isWatchDate('2038-12-31'), 'accepts a valid date');
check(!isWatchDate('2038-2-03') && !isWatchDate('2038-02-31') && !isWatchDate('../2038-02-03'), 'rejects bad date shapes and invalid calendar dates');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

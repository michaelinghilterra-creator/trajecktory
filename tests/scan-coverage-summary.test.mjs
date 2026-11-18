import { GONE_QUIET_THRESHOLD, summarizeCoverage } from '../lib/scan-coverage.mjs';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.error(`  FAIL ${label}`); failed++; }
}

const coverage = {
  z: { name: 'Zorblax Systems', ats: 'greenhouse', lastOutcome: 'http_404', last404: '2031-01-02' },
  q: { name: 'Quennox Labs', ats: 'ashby', lastOutcome: 'error', updated: '2031-01-03' },
  a: { name: 'Asterix Works', ats: 'lever', lastOutcome: 'zero', consecutiveZero: GONE_QUIET_THRESHOLD, lastFound: '2030-12-01' },
  p: { name: 'Paused Labs', ats: 'workday', lastOutcome: 'skipped_paused', updated: '2031-01-04' },
  n: { name: 'No Feed Labs', ats: 'custom', lastOutcome: 'skipped_no_api', updated: '2031-01-05' },
  h: { name: 'Healthy Labs', ats: 'lever', lastOutcome: 'found', lastFound: '2031-01-06' },
  x: { name: 'Excluded Labs', ats: 'lever', lastOutcome: 'error', updated: '2031-01-07' },
};

const result = summarizeCoverage(coverage, {
  today: '2031-01-08',
  isTracked: entry => entry.name !== 'Excluded Labs',
});
check(result.total === 6 && result.healthy === 1, 'counts tracked and healthy boards');
check(result.counts.not_found === 1, 'labels not found');
check(result.counts.error === 1, 'labels error');
check(result.counts.paused === 1, 'labels paused');
check(result.counts.no_feed === 1, 'labels no feed');
check(result.counts.quiet === 1, 'labels quiet at the shared threshold');
check(!result.problems.some(problem => problem.name === 'Excluded Labs'), 'applies the tracked predicate');
check(result.problems.map(problem => problem.problem).join(',') === 'error,no_feed,not_found,paused,quiet', 'sorts by problem label');

const below = summarizeCoverage({ a: { name: 'Zorblax Systems', lastOutcome: 'zero', consecutiveZero: 3 } }, { zeroStreak: 4 });
check(below.healthy === 1, 'keeps a zero streak below the requested threshold healthy');
const sameLabel = summarizeCoverage({
  z: { name: 'Zorblax Systems', lastOutcome: 'error' },
  q: { name: 'Quennox Labs', lastOutcome: 'error' },
});
check(sameLabel.problems.map(problem => problem.name).join(',') === 'Quennox Labs,Zorblax Systems', 'sorts equal labels by company name');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

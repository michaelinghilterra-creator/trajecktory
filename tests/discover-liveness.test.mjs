#!/usr/bin/env node
import {
  checkDiscoveredJobs,
  cleanSearchTitle,
  findCurrentGreenhousePosting,
} from '../lib/discover-liveness.mjs';

let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { console.log(`  ok ${name}`); passed++; }
  else { console.log(`  FAIL ${name}`); failed++; }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const response = (status, body) => ({ status, json: async () => body });

console.log('discover-liveness.test.mjs');

check(
  cleanSearchTitle('Job Application for Chief Sprocket Wrangler at Zorblax Widgetry') === 'Chief Sprocket Wrangler',
  'cleanSearchTitle strips the application prefix and company suffix',
);
check(cleanSearchTitle('  Sprocket Polisher  ') === 'Sprocket Polisher', 'cleanSearchTitle leaves a plain title unchanged');
check(
  cleanSearchTitle('Polisher at Large at Quennox Ratchet Works') === 'Polisher at Large',
  'cleanSearchTitle strips only the last company suffix',
);
check(cleanSearchTitle(null) === '', 'cleanSearchTitle returns an empty string for a non string');

{
  const jobs = [
    { url: 'https://example.test/live', company: 'Quennox Ratchet Works', title: 'Live Role' },
    { url: 'https://example.test/undecided', company: 'Quennox Ratchet Works', title: 'Undecided Ratchet Role' },
    { url: 'https://example.test/probe-throws', company: 'Quennox Ratchet Works', title: 'Probe Throws' },
    { url: 'https://example.test/replaced', company: 'Quennox Ratchet Works', title: 'Current Role' },
    { url: 'https://example.test/closed', company: 'Quennox Ratchet Works', title: 'Closed Role' },
    { url: 'https://example.test/find-throws', company: 'Quennox Ratchet Works', title: 'Find Throws' },
  ];
  const delays = new Map([
    [jobs[0].url, 20],
    [jobs[1].url, 2],
    [jobs[2].url, 14],
    [jobs[3].url, 1],
    [jobs[4].url, 10],
    [jobs[5].url, 3],
  ]);
  let inFlight = 0;
  let maxInFlight = 0;
  const probe = async (url) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(delays.get(url));
    inFlight -= 1;
    if (url.endsWith('/probe-throws')) throw new Error('invented probe fault');
    if (url.endsWith('/live')) return { verdict: 'live', reason: 'available' };
    if (url.endsWith('/undecided')) return { verdict: 'unknown', reason: 'indeterminate' };
    return { verdict: 'gone', reason: `closed ${url.split('/').at(-1)}` };
  };
  const replacementUrl = 'https://job-boards.greenhouse.io/quennoxratchet/jobs/222222';
  const findCurrent = async (url) => {
    if (url.endsWith('/replaced')) return replacementUrl;
    if (url.endsWith('/find-throws')) throw new Error('invented lookup fault');
    return null;
  };

  const result = await checkDiscoveredJobs(jobs, { probe, findCurrent, concurrency: 2 });
  check(result.keep[0] === jobs[0], 'a live posting is kept unchanged');
  check(result.keep[1] === jobs[1], 'an unknown posting is kept unchanged');
  check(result.keep[2] === jobs[2], 'a posting is kept when its probe throws');
  check(
    result.keep[3].url === replacementUrl && result.keep[3].title === jobs[3].title,
    'a gone posting with a current match is kept at the new URL',
  );
  check(
    result.replaced.length === 1
      && result.replaced[0].from === jobs[3].url
      && result.replaced[0].to === replacementUrl
      && result.replaced[0].title === jobs[3].title,
    'a current match is listed as a replacement',
  );
  check(
    result.closed[0].url === jobs[4].url && result.closed[0].reason === 'closed closed',
    'a gone posting without a current match is closed with its reason',
  );
  check(result.closed[1].url === jobs[5].url, 'a gone posting is closed when current lookup throws');
  check(
    result.keep.map((job) => job.title).join('|') === 'Live Role|Undecided Ratchet Role|Probe Throws|Current Role'
      && result.closed.map((job) => job.title).join('|') === 'Closed Role|Find Throws',
    'keep and closed preserve input order when probes resolve out of order',
  );
  check(maxInFlight <= 2, 'probe concurrency never exceeds the configured limit');
}

{
  const originalUrl = 'https://job-boards.greenhouse.io/zorblaxwidgetry/jobs/111111';
  const title = 'Job Application for Chief Sprocket Wrangler at Zorblax Widgetry';
  const calls = [];
  const matched = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, {
        jobs: [
          { id: 111111, title: 'Chief Sprocket Wrangler' },
          { id: 222222, title: 'Chief Sprocket Wrangler' },
        ],
      });
    },
    timeoutMs: 25,
  });
  check(
    matched === 'https://job-boards.greenhouse.io/zorblaxwidgetry/jobs/222222',
    'findCurrentGreenhousePosting returns a different job with the cleaned title',
  );
  check(
    calls.length === 1
      && calls[0].url === 'https://boards-api.greenhouse.io/v1/boards/zorblaxwidgetry/jobs'
      && calls[0].options.signal instanceof AbortSignal,
    'findCurrentGreenhousePosting fetches the board with a timeout signal',
  );

  const sameId = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async () => response(200, { jobs: [{ id: 111111, title: 'Chief Sprocket Wrangler' }] }),
  });
  check(sameId === null, 'findCurrentGreenhousePosting does not return the original job id');

  const noTitleMatch = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async () => response(200, { jobs: [{ id: 222222, title: 'Gearbox Choir Director' }] }),
  });
  check(noTitleMatch === null, 'findCurrentGreenhousePosting returns null without a title match');

  const nonOk = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async () => response(503, {}),
  });
  check(nonOk === null, 'findCurrentGreenhousePosting returns null for a non 200 response');

  const thrown = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async () => { throw new Error('invented network fault'); },
  });
  check(thrown === null, 'findCurrentGreenhousePosting returns null when fetch throws');

  const badJson = await findCurrentGreenhousePosting(originalUrl, title, {
    fetchImpl: async () => ({ status: 200, json: async () => { throw new SyntaxError('invented json fault'); } }),
  });
  check(badJson === null, 'findCurrentGreenhousePosting returns null for bad JSON');
}

{
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response(200, { jobs: [] });
  };
  const otherHost = await findCurrentGreenhousePosting(
    'https://example.test/quennoxratchet/jobs/111111',
    'Example Role',
    { fetchImpl },
  );
  check(otherHost === null && calls === 0, 'a non Greenhouse URL returns null without fetching');

  const badToken = await findCurrentGreenhousePosting(
    'https://boards.greenhouse.io/example..corp/jobs/111111',
    'Example Role',
    { fetchImpl },
  );
  check(badToken === null && calls === 0, 'a token containing two dots returns null without fetching');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

#!/usr/bin/env node
import { probePostingGone } from '../lib/ats-gone.mjs';

let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { console.log(`  ok ${name}`); passed++; }
  else { console.log(`  FAIL ${name}`); failed++; }
}

function response(status, body) {
  return { status, json: async () => body };
}

async function probe(url, handler) {
  const calls = [];
  const result = await probePostingGone(url, {
    fetchImpl: async (target, options) => {
      calls.push({ target, options });
      return handler(target, options);
    },
    timeoutMs: 25,
  });
  return { result, calls };
}

console.log('ats-gone.test.mjs');

const greenhouseUrl = 'https://job-boards.greenhouse.io/zorblaxwidgetry/jobs/123456';
for (const [status, verdict] of [[200, 'live'], [404, 'gone'], [500, 'unknown']]) {
  const { result, calls } = await probe(greenhouseUrl, async () => response(status, {}));
  check(result.verdict === verdict, `Greenhouse ${status} is ${verdict}`);
  check(calls.length === 1 && calls[0].target === 'https://boards-api.greenhouse.io/v1/boards/zorblaxwidgetry/jobs/123456', `Greenhouse ${status} uses the job API`);
  check(calls[0].options.headers.accept === 'application/json' && calls[0].options.signal instanceof AbortSignal, `Greenhouse ${status} sets request controls`);
}

{
  const { result } = await probe(greenhouseUrl, async () => { throw new Error('fictional network fault'); });
  check(result.verdict === 'unknown', 'a thrown request error is unknown');
}
{
  const { result } = await probe(greenhouseUrl, async () => { throw new DOMException('timed out', 'TimeoutError'); });
  check(result.verdict === 'unknown' && result.reason.includes('timed out'), 'a timeout is unknown');
}

const leverUrl = 'https://jobs.lever.co/quennoxratchet/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
for (const [status, verdict] of [[200, 'live'], [404, 'gone']]) {
  const { result } = await probe(leverUrl, async () => response(status, {}));
  check(result.verdict === verdict, `Lever ${status} is ${verdict}`);
}

const ashbyId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ashbyUrl = `https://jobs.ashbyhq.com/flibberanalytics/${ashbyId}`;
{
  const { result } = await probe(ashbyUrl, async () => response(404, {}));
  check(result.verdict === 'gone' && result.reason === 'ashby: board removed (404)', 'Ashby board 404 is gone');
}
{
  const { result } = await probe(ashbyUrl, async () => response(200, { jobs: [{ id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }] }));
  check(result.verdict === 'gone' && result.reason === 'ashby: not on the board', 'Ashby missing listing is gone');
}
{
  const upper = ashbyId.toUpperCase();
  const { result } = await probe(ashbyUrl, async () => response(200, { jobs: [{ id: upper }] }));
  check(result.verdict === 'live', 'Ashby id matching is case insensitive');
}
{
  const { result } = await probe(ashbyUrl, async () => response(200, { jobs: [{ jobUrl: `https://jobs.ashbyhq.com/flibberanalytics/${ashbyId}` }] }));
  check(result.verdict === 'live', 'Ashby job URL matching is live');
}
{
  const { result } = await probe(ashbyUrl, async () => ({ status: 200, json: async () => { throw new SyntaxError('not json'); } }));
  check(result.verdict === 'unknown', 'Ashby non JSON body is unknown');
}

for (const [url, name] of [
  ['https://zorblax.wd1.myworkdayjobs.com/en-US/Careers/job/Widget-Keeper', 'Workday'],
  ['local:jds/zorblax-widget-keeper.md', 'local path'],
  ['https://boards.greenhouse.io/../jobs/123456', 'bad segment'],
  ['not a url', 'non http string'],
]) {
  const { result, calls } = await probe(url, async () => { throw new Error('must not run'); });
  check(result.verdict === 'unknown', `${name} is unknown`);
  check(calls.length === 0, `${name} makes no request`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

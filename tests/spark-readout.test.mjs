#!/usr/bin/env node
/**
 * Pins the probability readout protocol, parsing, retries and endpoint probe.
 *
 * Run: node tests/spark-readout.test.mjs
 */

import { readFileSync } from 'node:fs';

process.env.TJK_SPARK_URL = 'http://spark.example.test';
process.env.TJK_SPARK_MODEL = 'test-model';

const {
  READOUT_DIMENSIONS, formatSection, buildUserMessage, fieldPrefix, ratingPrefix, afterPrefix,
  readDistribution, readChoice, scoreOneReadout, probeReadout, _setSleep,
} = await import('../lib/spark-readout.mjs');

_setSleep(async () => {});

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

console.log('spark-readout.test.mjs');

const golden = JSON.parse(readFileSync(new URL('./fixtures/spark-readout-golden.json', import.meta.url), 'utf8'));
check(formatSection() === golden.format_section, 'format section matches the golden string byte for byte');
check(buildUserMessage(golden.preamble, golden.jd) === golden.user, 'user message matches the golden string byte for byte');
for (const expected of golden.prefixes) {
  let actual;
  if (expected.kind === 'field') {
    const done = expected.key === 'jdLevel' ? {} : { jdLevel: golden.inputs.before.jdLevel };
    actual = fieldPrefix(done, expected.key);
  } else if (expected.kind === 'rating') {
    const prior = {};
    for (const [key] of READOUT_DIMENSIONS) {
      if (key === expected.key) break;
      prior[key] = golden.inputs.ratings[key];
    }
    actual = ratingPrefix(golden.inputs.before, prior, expected.key);
  } else {
    const done = expected.key === 'scoreCeiling'
      ? {}
      : expected.key === 'ceilingBasis'
        ? golden.inputs.after_done_for_basis
        : golden.inputs.after_done_for_reason;
    actual = afterPrefix(golden.inputs.before, golden.inputs.ratings, done, expected.key);
  }
  check(actual === expected.prefix, `${expected.kind} prefix for ${expected.key} matches the golden string`);
}

{
  const certain = readDistribution([{ token: '4', logprob: 0 }]);
  check(certain.argmax === 4 && certain.ev === 4 && certain.sd === 0, 'a certain digit produces a certain distribution');
  const split = readDistribution([{ token: '1', logprob: Math.log(0.25) }, { token: '3', logprob: Math.log(0.75) }]);
  check(Math.abs(split.ev - 2.5) < 1e-12 && split.argmax === 3, 'a split distribution has the expected value and argmax');
  const withNull = readDistribution([{ token: '2', logprob: null }, { token: '5', logprob: 0 }]);
  check(withNull.argmax === 5 && withNull.probs[2] === 0, 'a null log probability contributes zero mass');
  check(readDistribution([{ token: 'x', logprob: 0 }]) === null, 'non-digit tokens produce no distribution');
  const tie = readDistribution([{ token: '2', logprob: 0 }, { token: '4', logprob: 0 }]);
  check(tie.argmax === 2, 'a distribution tie goes to the lower value');
  check(readDistribution([{ token: ' 3', logprob: 0 }]).argmax === 3, 'spaces around a digit are ignored');
}

{
  check(readChoice([{ token: 'n', logprob: 0 }], ['n', '0']).value === 'n', 'choice parsing selects n');
  const ignored = readChoice([{ token: 'n', logprob: null }, { token: '0', logprob: 0 }], ['n', '0']);
  check(ignored.value === '0' && ignored.probs.n === 0, 'a null choice log probability is ignored');
  const tie = readChoice([{ token: 'n', logprob: 0 }, { token: '0', logprob: 0 }], ['n', '0']);
  check(tie.value === 'n', 'a choice tie goes to the first label');
}

function okResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function modelResponse(body, requests, options = {}) {
  requests.push(body);
  const prefix = body.messages[1].content;
  const isCeiling = prefix.includes('"scoreCeiling":"') && !prefix.includes('"ceilingBasis":"');
  const isBasis = prefix.includes('"ceilingBasis":"');
  const isLocation = prefix.includes('"location":') && !prefix.includes('"buildDepth":');
  const isChoice = isCeiling || isBasis;
  if (body.logprobs) {
    let token = isCeiling
      ? (options.scoreCeiling ?? 'n')
      : isBasis
        ? (options.ceilingBasis ?? 'n')
        : isLocation
          ? (options.locationRating ?? '4')
          : '4';
    if (options.massRetry && !isChoice && !options.retriedOnce) {
      if (!prefix.endsWith(' ')) token = 'word';
      else options.retriedOnce = true;
    }
    const topLogprobs = isLocation && options.locationTopLogprobs
      ? options.locationTopLogprobs
      : [{ token, logprob: 0 }];
    return okResponse({
      choices: [{ logprobs: { content: [{ top_logprobs: topLogprobs }] } }],
      usage: { completion_tokens: 1 },
    });
  }
  return okResponse({ choices: [{ message: { content: 'Director"' } }], usage: { completion_tokens: 2 } });
}

async function readoutCase(id, options) {
  const requests = [];
  globalThis.fetch = async (_url, init) => modelResponse(JSON.parse(init.body), requests, options);
  return scoreOneReadout(
    { id, jdText: `Invented posting ${id} for Zorblax Widgetry.` },
    { preamble: '# P' },
  );
}

{
  const requests = [];
  globalThis.fetch = async (_url, init) => modelResponse(JSON.parse(init.body), requests);
  const result = await scoreOneReadout(
    { id: 'x', jdText: 'Invented posting for Zorblax Widgetry.' },
    { preamble: '# P' },
  );
  check(result.ok === true && Number.isFinite(result.score), 'mocked readout returns a valid numeric production score');
  check(result.finishReason === 'readout', 'mocked readout carries the readout finish reason');
  check(requests.every((body) => body.continue_final_message === true && body.temperature === 0), 'every request continues the assistant prefix at zero temperature');
  const ratings = requests.filter((body) => body.logprobs);
  check(ratings.every((body) => body.top_logprobs === 20 && body.max_tokens === 1), 'rating requests ask for one token and twenty log probabilities');
}

{
  const locationAuthored = await readoutCase('location-authored', {
    scoreCeiling: '1', ceilingBasis: 'l', locationRating: '4',
  });
  const codeLocation = await readoutCase('code-location', {
    scoreCeiling: 'n', locationRating: '1',
  });
  const levelAuthored = await readoutCase('level-authored', {
    scoreCeiling: '2', ceilingBasis: 'v', locationRating: '4',
  });
  const rawLocation = JSON.parse(locationAuthored.raw);
  const rawCode = JSON.parse(codeLocation.raw);
  const rawLevel = JSON.parse(levelAuthored.raw);

  check(locationAuthored.data.scoreCeiling === null && rawLocation.scoreCeiling === null &&
    locationAuthored.score > levelAuthored.score,
  'a model-authored location cap is dropped and scores above the surviving level cap');
  check(codeLocation.data.scoreCeiling === 1.5 && rawCode.scoreCeiling === 1.5 &&
    codeLocation.data.ceilingReason.includes('location rating 1') && rawCode.ceilingReason.includes('location rating 1'),
  'location rating 1 receives the shipped code cap and reason');
  const unsureLocation = await readoutCase('unsure-location', {
    scoreCeiling: 'n',
    locationTopLogprobs: [
      { token: '1', logprob: Math.log(0.6) },
      { token: '3', logprob: Math.log(0.4) },
    ],
  });
  check(unsureLocation.data.scoreCeiling === null,
    'location expected rating 1.8 does not receive the code cap');
  const confidentLocation = await readoutCase('confident-location', {
    scoreCeiling: 'n',
    locationTopLogprobs: [
      { token: '1', logprob: Math.log(0.9) },
      { token: '2', logprob: Math.log(0.1) },
    ],
  });
  check(confidentLocation.data.scoreCeiling === 1.5 &&
    confidentLocation.data.ceilingReason.includes('location rating 1'),
  'location expected rating 1.1 receives the code cap and reason');
  check(levelAuthored.data.scoreCeiling === 2 && levelAuthored.data.ceilingBasis === 'level' &&
    rawLevel.scoreCeiling === 2 && rawLevel.ceilingBasis === 'level',
  'a model-authored level cap survives with its mapped basis');
  check(locationAuthored.data.globalScore.every((entry) => Number.isInteger(entry.hardVal)) &&
    rawLocation.globalScore.every((entry) => Number.isInteger(entry.hardVal)),
  'every globalScore entry has an integer hardVal');
}

{
  const requests = [];
  const options = { massRetry: true, retriedOnce: false };
  globalThis.fetch = async (_url, init) => modelResponse(JSON.parse(init.body), requests, options);
  const result = await scoreOneReadout(
    { id: 'retry-mass', jdText: 'Invented posting for Zorblax Widgetry.' },
    { preamble: '# P' },
  );
  check(result.ok === true, 'a rating with no mass succeeds after the spaced-prefix retry');
  check(requests.some((body) => body.logprobs && body.messages[1].content.endsWith(' ')), 'the mass retry appends one space to the prefix');
}

{
  const requests = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) return { ok: false, status: 500 };
    return modelResponse(JSON.parse(init.body), requests);
  };
  const result = await scoreOneReadout(
    { id: 'retry-http', jdText: 'Invented posting for Quennox Ratchet Works.' },
    { preamble: '# P' },
  );
  check(result.ok === true && calls > 1, 'an HTTP 500 is retried and then succeeds');

  globalThis.fetch = async () => ({ ok: false, status: 400 });
  const bad = await scoreOneReadout(
    { id: 'bad-http', jdText: 'Invented posting for Quennox Ratchet Works.' },
    { preamble: '# P' },
  );
  check(bad.ok === false && bad.endpointError === true && bad.reason.startsWith('endpoint:'), 'an HTTP 400 returns an endpoint error without throwing');
}

{
  globalThis.fetch = async () => okResponse({
    choices: [{ logprobs: { content: [{ top_logprobs: [{ token: '3', logprob: 0 }] }] } }],
  });
  check((await probeReadout()).ok === true, 'probe accepts a digit as the first top token');

  let retryCalls = 0;
  globalThis.fetch = async (_url, init) => {
    retryCalls++;
    const prefix = JSON.parse(init.body).messages[1].content;
    return okResponse({
      choices: [{ logprobs: { content: [{ top_logprobs: [{ token: prefix.endsWith(' ') ? '3' : ' ', logprob: 0 }] }] } }],
    });
  };
  check((await probeReadout()).ok === true && retryCalls === 2, 'probe accepts a digit from the spaced-prefix retry');

  let failedCalls = 0;
  globalThis.fetch = async () => {
    failedCalls++;
    return okResponse({
      choices: [{ logprobs: { content: [{ top_logprobs: [{ token: '{"', logprob: 0 }] }] } }],
    });
  };
  const probe = await probeReadout();
  check(probe.ok === false && failedCalls === 2 && probe.reason.includes('continue_final_message'), 'probe explains when both calls ignore the assistant continuation');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

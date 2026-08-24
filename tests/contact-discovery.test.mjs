#!/usr/bin/env node
/**
 * Pin the shared per-company discovery logic without credentials or network.
 * Every person and URL is an invented .example fixture.
 */

import {
  discoverTalentAtCompany,
  discoverPrincipalAtCompany,
  resolveTimeoutMs,
} from '../dashboard-web/server/lib/contact-discovery.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('contact-discovery.test.mjs');

check(resolveTimeoutMs(9e15) === 90_000, 'an absurd timeout is clamped to the default ceiling');
check(
  resolveTimeoutMs(-1) === 1_000 && resolveTimeoutMs(0) === 1_000,
  'negative and zero timeouts are clamped to the floor',
);
check(
  [NaN, '1000', null].every(value => resolveTimeoutMs(value) === 90_000),
  'non-finite timeout values fall back to the default without throwing',
);
check(resolveTimeoutMs(2_500) === 2_500, 'a shorter timeout is honored for tests and callers');

const calls = [];
const generate = async (prompt, options) => {
  calls.push({ prompt, options });
  return `Search complete. ${JSON.stringify([{
    first: 'Avery',
    last: 'Example',
    title: 'Talent Partner',
    linkedin: 'https://linkedin.example/in/avery-example',
    confidence: 'high',
    notes: 'Invented fixture source.',
  }])}`;
};

const talent = await discoverTalentAtCompany({
  company: 'Talent Example',
  exampleRole: 'Operations Lead',
  model: 'model.example',
  generate,
});
check(
  talent.company === 'Talent Example'
    && talent.exampleRole === 'Operations Lead'
    && talent.suggestions.length === 1
    && talent.suggestions[0].first === 'Avery',
  'talent search returns parsed suggestions',
);
check(
  calls.length === 1
    && calls[0].prompt.includes('Talent Example')
    && calls[0].options.model === 'model.example',
  'the injected generate function receives the prompt and model options',
);

let fallbackModelOptions;
await discoverTalentAtCompany({
  company: 'Fallback Model Example',
  model: 42,
  generate: async (_prompt, options) => {
    fallbackModelOptions = options;
    return '[]';
  },
});
check(
  typeof fallbackModelOptions.model === 'string' && fallbackModelOptions.model !== 42,
  'a non-string model falls back to the configured draft model',
);

const principal = await discoverPrincipalAtCompany({
  company: 'Principal Example',
  exampleRole: 'Revenue Operations',
  generate: async () => JSON.stringify([
    {
      first: 'Parker',
      last: 'Leader',
      title: 'VP Revenue Operations',
      linkedin: 'https://linkedin.example/in/parker-leader',
      confidence: 'high',
      notes: 'Invented fixture source.',
    },
    {
      first: 'Riley',
      last: 'Director',
      title: 'Director Revenue Operations',
      linkedin: 'https://linkedin.example/in/riley-director',
      confidence: 'medium',
      notes: 'Invented fixture source. [principal]',
    },
  ]),
});
check(
  principal.suggestions.length === 2
    && principal.suggestions.every(suggestion => /\[principal\]/i.test(suggestion.notes))
    && principal.suggestions.every(suggestion => suggestion.validation && typeof suggestion.validation.ok === 'boolean'),
  'principal search stamps notes and attaches validation to every suggestion',
);

const failedCall = await discoverTalentAtCompany({
  company: 'Failure Example',
  generate: async () => { throw new Error('Invented generator failure'); },
});
check(
  failedCall.error === 'Invented generator failure' && failedCall.suggestions.length === 0,
  'a thrown model call returns a company error instead of rejecting',
);

const unparseable = await discoverTalentAtCompany({
  company: 'Unparseable Example',
  generate: async () => 'No structured result.',
});
check(
  !unparseable.error && Array.isArray(unparseable.suggestions) && unparseable.suggestions.length === 0,
  'unparseable model text returns an empty suggestion list',
);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

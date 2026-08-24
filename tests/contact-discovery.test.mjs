#!/usr/bin/env node
/**
 * Pin the shared per-company discovery logic without credentials or network.
 * Every person and URL is an invented .example fixture.
 */

import {
  discoverTalentAtCompany,
  discoverPrincipalAtCompany,
} from '../dashboard-web/server/lib/contact-discovery.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('contact-discovery.test.mjs');

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

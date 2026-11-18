#!/usr/bin/env node

import { discoverTalentAtCompany } from '../dashboard-web/server/lib/contact-discovery.mjs';

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
};

console.log('contact-discovery-search.test.mjs');

const hits = Array.from({ length: 30 }, (_, index) => ({
  url: `https://www.linkedin.com/in/avery-example-${String(index).padStart(3, '0')}`,
  title: 'Avery Example - Recruiter at Zorblax Systems | LinkedIn',
  description: 'Current recruiter at Zorblax Systems.',
}));
let labelOptions;
const labelled = await discoverTalentAtCompany({
  company: 'Zorblax Systems', exampleRole: 'Operations Lead',
  search: async () => hits,
  generate: async (prompt, options) => {
    labelOptions = options;
    check(prompt.includes('Avery Example') && prompt.includes('Never output a link'), 'search-first discovery sends the label prompt');
    return '[{"n":1,"current":true,"tier":"talent","title":"Recruiter","confidence":"high","reason":"Current employee."}]';
  },
});
// Every talent role query runs, because one query may only add its share of people.
check(labelled.searchesUsed === 4 && labelled.suggestions.length === 1, 'search-first discovery returns a labelled suggestion and count');
check(labelled.suggestions[0].linkedin === 'https://www.linkedin.com/in/avery-example-000/', 'search-first discovery keeps the search result link');
check(labelOptions.maxTokens === 3000 && !Object.hasOwn(labelOptions, 'tools'), 'label call has no tools');

let emptyModelCalls = 0;
const empty = await discoverTalentAtCompany({
  company: 'Quennox Labs', exampleRole: 'Operations Lead',
  search: async () => [],
  generate: async () => { emptyModelCalls += 1; return '[]'; },
});
check(empty.suggestions.length === 0 && empty.searchesUsed === 4, 'zero hits is a normal empty result with all searches counted');
check(emptyModelCalls === 0, 'zero hits skips the model call');

let fallbackOptions;
await discoverTalentAtCompany({
  company: 'Quennox Labs', exampleRole: 'Operations Lead',
  generate: async (prompt, options) => {
    fallbackOptions = options;
    check(prompt.includes('up to 3 people') && prompt.includes('copied exactly from a search result'), 'fallback prompt requests the new limit and exact links');
    return '[]';
  },
});
check(fallbackOptions.tools[0].max_uses === 4, 'fallback model search allows four tool uses');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

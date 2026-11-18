#!/usr/bin/env node

import { discoverTalentAtCompany } from '../dashboard-web/server/lib/contact-discovery.mjs';

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
};

console.log('contact-discovery-search.test.mjs');

const hits = [
  { url: 'https://www.linkedin.com/in/avery-example-000', title: 'Avery Example - Recruiter at Zorblax Systems | LinkedIn', description: 'Current recruiter at Zorblax Systems.' },
  { url: 'https://www.linkedin.com/in/jordan-sample-000', title: 'Jordan Sample - Chief Technology Officer | LinkedIn', description: 'Current executive at Zorblax Systems.' },
  { url: 'https://www.linkedin.com/in/riley-placeholder-000', title: 'Riley Placeholder - Office Manager | LinkedIn', description: 'Current employee at Zorblax Systems.' },
  { url: 'https://www.linkedin.com/in/avery-example-001', title: 'Avery Example - Someone hiring a Widget Director (title not stated) | LinkedIn', description: 'Current employee at Zorblax Systems.' },
];
let labelOptions;
const labelled = await discoverTalentAtCompany({
  company: 'Zorblax Systems', exampleRole: 'Operations Lead',
  search: async () => hits,
  generate: async (prompt, options) => {
    labelOptions = options;
    check(prompt.includes('Avery Example') && prompt.includes('Never output a link'), 'search-first discovery sends the label prompt');
    return '[{"n":1,"current":true,"tier":"talent","title":"Recruiter at Zorblax Systems","confidence":"high","reason":"Current employee."},{"n":2,"current":true,"tier":"talent","title":"Chief Technology Officer","confidence":"high","reason":"Current employee."},{"n":3,"current":true,"tier":"talent","title":"Office Manager","confidence":"high","reason":"Current employee."},{"n":4,"current":true,"tier":"talent","title":"Someone hiring a Widget Director (title not stated)","confidence":"high","reason":"Current employee."}]';
  },
});
// Every talent role query runs, because one query may only add its share of people.
check(labelled.searchesUsed === 4 && labelled.suggestions.length === 1, 'search-first discovery returns a labelled suggestion and count');
check(labelled.suggestions[0].linkedin === 'https://www.linkedin.com/in/avery-example-000/', 'search-first discovery keeps the search result link');
check(labelled.suggestions[0].title === 'Recruiter', 'search-first discovery cleans the accepted title');
check(labelled.leftOut.no_title === 1 && labelled.leftOut.out_of_scope === 1 && labelled.leftOut.unclassified === 1, 'search-first discovery counts every screened reason');
check(labelOptions.maxTokens === 3000 && !Object.hasOwn(labelOptions, 'tools'), 'label call has no tools');

let emptyModelCalls = 0;
const empty = await discoverTalentAtCompany({
  company: 'Quennox Labs', exampleRole: 'Operations Lead',
  search: async () => [],
  generate: async () => { emptyModelCalls += 1; return '[]'; },
});
check(empty.suggestions.length === 0 && empty.searchesUsed === 4, 'zero hits is a normal empty result with all searches counted');
check(empty.leftOut.no_title === 0 && empty.leftOut.out_of_scope === 0 && empty.leftOut.unclassified === 0, 'zero hits returns empty left-out counts');
check(emptyModelCalls === 0, 'zero hits skips the model call');

let fallbackOptions;
const fallback = await discoverTalentAtCompany({
  company: 'Quennox Labs', exampleRole: 'Operations Lead',
  generate: async (prompt, options) => {
    fallbackOptions = options;
    check(prompt.includes('up to 3 people') && prompt.includes('copied exactly from a search result'), 'fallback prompt requests the new limit and exact links');
    return JSON.stringify([
      { first: 'Avery', last: 'Example', title: 'Recruiter at Quennox Labs', linkedin: 'https://www.linkedin.com/in/avery-example-002/' },
      { first: 'Jordan', last: 'Sample', title: 'Chief Technology Officer', linkedin: 'https://www.linkedin.com/in/jordan-sample-001/' },
      { first: 'Riley', last: 'Placeholder', title: 'Office Manager', linkedin: 'https://www.linkedin.com/in/riley-placeholder-001/' },
      { first: 'Avery', last: 'Example', title: 'Title not stated', linkedin: 'https://www.linkedin.com/in/avery-example-003/' },
    ]);
  },
});
check(fallbackOptions.tools[0].max_uses === 4, 'fallback model search allows four tool uses');
check(fallback.suggestions.length === 1 && fallback.suggestions[0].title === 'Recruiter', 'fallback offers only a clean title accepted by the classifier');
check(fallback.leftOut.no_title === 1 && fallback.leftOut.out_of_scope === 1 && fallback.leftOut.unclassified === 1, 'fallback returns the same left-out counts');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

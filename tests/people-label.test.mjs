#!/usr/bin/env node

import {
  applyLabels,
  applyLabelsWithDrops,
  buildLabelPrompt,
  cleanTitle,
  isOutOfScopeExecutive,
  MAX_KEEP_PRINCIPAL,
  MAX_KEEP_TALENT,
} from '../lib/people-label.mjs';

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
};

console.log('people-label.test.mjs');

const people = [
  { name: 'Avery Example', headline: 'Recruiter at Zorblax Systems', snippet: 'Current recruiter at Zorblax Systems.', linkedin: 'https://www.linkedin.com/in/avery-example-000/' },
  { name: 'Jordan Sample', headline: 'VP Sales at Zorblax Systems', snippet: 'Current sales leader.', linkedin: 'https://www.linkedin.com/in/jordan-sample-000/' },
  { name: 'Avery Example', headline: 'Chief Revenue Officer', snippet: 'Zorblax Systems executive.', linkedin: 'https://www.linkedin.com/in/avery-example-001/' },
];
const prompt = buildLabelPrompt({ company: 'Zorblax Systems', tier: 'principal', exampleRole: 'Revenue Operations Lead', people });
check(people.every(person => prompt.includes(person.name) && prompt.includes(person.linkedin)), 'prompt lists every supplied person');
check(prompt.includes('Never output a link') && !prompt.includes('"linkedin"'), 'prompt forbids model link output');
check(prompt.includes('current is true only') && prompt.includes('similar name is other'), 'prompt states current employer rules');

const labels = [
  { n: 1, current: true, tier: 'talent', title: 'Talent Partner', confidence: 'high', reason: 'Current talent employee.', linkedin: 'https://wrong.example/one' },
  { n: 2, current: true, tier: 'hm', title: 'VP Sales', confidence: 'medium', reason: 'Leads sales.', linkedin: 'https://wrong.example/two' },
  { n: 3, current: true, tier: 'exec', title: '', confidence: 'high', reason: 'Executive leader.' },
  { n: 2, current: false, tier: 'exec', title: 'Former leader', confidence: 'high', reason: 'Former employee.' },
  { n: 1, current: true, tier: 'other', title: 'Other', confidence: 'high', reason: 'Similar company.' },
  { n: 99, current: true, tier: 'exec', title: 'Unknown', confidence: 'high', reason: 'Out of range.' },
];

const talent = applyLabels({ people, labels, tier: 'talent', maxKeep: MAX_KEEP_TALENT });
check(talent.length === 1 && talent[0].first === 'Avery' && talent[0].last === 'Example', 'talent run keeps only talent labels');
check(talent[0].linkedin === people[0].linkedin, 'output link always comes from the search hit');
check(Object.keys(talent[0]).join(',') === 'first,last,title,city,state,linkedin,confidence,notes', 'output has exactly the suggestion shape');

const principal = applyLabels({ people, labels, tier: 'principal', maxKeep: 1 });
check(principal.length === 1 && principal[0].first === 'Avery', 'principal keeps executives and hiring managers with high confidence first');
check(principal[0].title === people[2].headline, 'empty model title falls back to the headline');
check(principal[0].notes === 'Executive leader.', 'model reason becomes notes');
check(MAX_KEEP_TALENT === 2 && MAX_KEEP_PRINCIPAL === 5, 'default keep limits are exported');

const unknownCurrent = applyLabels({
  people,
  labels: [{ n: 2, current: 'unknown', tier: 'hm', title: 'VP Sales', confidence: 'low', reason: 'Employer timing is unclear.' }],
  tier: 'principal', maxKeep: 5,
});
check(unknownCurrent.length === 1, 'unknown current status is not dropped');

check(cleanTitle('  Chief Revenue Officer   at Zorblax Systems  ', 'Zorblax Systems') === 'Chief Revenue Officer', 'cleanTitle trims whitespace and removes an at employer');
check(cleanTitle('Chief Revenue Officer @ Zorblax Systems', 'Zorblax Systems') === 'Chief Revenue Officer', 'cleanTitle removes an at-sign employer');
check(cleanTitle('Chief Revenue Officer | Zorblax Systems!', 'Zorblax Systems') === 'Chief Revenue Officer', 'cleanTitle removes a matching pipe employer after punctuation normalization');
check(cleanTitle('Chief Revenue Officer - Zorblax Systems', 'Zorblax Systems') === 'Chief Revenue Officer', 'cleanTitle removes a matching dash employer');
check(cleanTitle('VP, Sales and Marketing', 'Zorblax Systems') === 'VP, Sales and Marketing', 'cleanTitle preserves a compound title');
check(cleanTitle('Head of Widgets, Quennox Unit', 'Zorblax Systems') === 'Head of Widgets, Quennox Unit', 'cleanTitle preserves a non-matching comma suffix');
check(cleanTitle('Someone hiring a Widget Director (title not stated)', 'Zorblax Systems') === '', 'cleanTitle rejects a person description with no stated title');
check(cleanTitle('Someone who is hiring a revenue leader', 'Zorblax Systems') === '', 'cleanTitle rejects a sentence describing a person');
check(cleanTitle('X'.repeat(121), 'Zorblax Systems') === '', 'cleanTitle rejects titles over 120 characters');

for (const title of ['Chief Technology Officer', 'CTO', 'Director of IT', 'Head of Security', 'Chief Legal Officer', 'Director of Data Engineering']) {
  check(isOutOfScopeExecutive(title), `${title} is out of scope`);
}
for (const title of ['VP Product Marketing', 'Chief Operating Officer', 'VP Sales Engineering', 'Chief Product and Revenue Officer']) {
  check(!isOutOfScopeExecutive(title), `${title} remains in scope`);
}

const screenedPeople = [
  { name: 'Avery Example', headline: 'Someone hiring a Widget Director (title not stated)', linkedin: 'https://www.linkedin.com/in/avery-example-002/' },
  { name: 'Jordan Sample', headline: 'Chief Technology Officer', linkedin: 'https://www.linkedin.com/in/jordan-sample-001/' },
  { name: 'Riley Placeholder', headline: 'Office Manager', linkedin: 'https://www.linkedin.com/in/riley-placeholder-000/' },
  { name: 'Avery Example', headline: 'Recruiter at Zorblax Systems', linkedin: 'https://www.linkedin.com/in/avery-example-003/' },
  { name: 'Jordan Sample', headline: 'Talent Partner', linkedin: 'https://www.linkedin.com/in/jordan-sample-002/' },
];
const screenedLabels = screenedPeople.map((person, index) => ({
  n: index + 1,
  current: true,
  tier: 'talent',
  title: person.headline,
  confidence: index < 3 ? 'high' : 'medium',
  reason: 'Current employee.',
}));
const classified = title => /recruiter|talent partner/i.test(title) ? 'ta' : null;
const screened = applyLabelsWithDrops({
  people: screenedPeople,
  labels: screenedLabels,
  tier: 'talent',
  maxKeep: 2,
  company: 'Zorblax Systems',
  classify: classified,
});
check(screened.suggestions.length === 2, 'maxKeep applies after dropped people are removed');
check(screened.suggestions[0].title === 'Recruiter' && screened.suggestions[1].title === 'Talent Partner', 'kept titles are cleaned before output');
check(screened.dropped.map(item => item.reason).join(',') === 'no_title,out_of_scope,unclassified', 'applyLabelsWithDrops reports every drop reason');
check(screened.dropped.every(item => Object.keys(item).join(',') === 'name,reason'), 'dropped output never leaks a title');
check(screened.dropped.every(item => ['Avery Example', 'Jordan Sample', 'Riley Placeholder'].includes(item.name)), 'dropped output contains first and last name only');
const plainScreened = applyLabels({
  people: screenedPeople,
  labels: screenedLabels,
  tier: 'talent',
  maxKeep: 2,
  company: 'Zorblax Systems',
  classify: classified,
});
check(Array.isArray(plainScreened) && plainScreened.length === 2, 'applyLabels still returns the plain suggestions array');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

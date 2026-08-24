#!/usr/bin/env node
/**
 * hunter-domain.test.mjs: unit tests for the read-only Hunter Domain Search
 * mapper, hostname guard, and budget guard.
 *
 * WHY THIS EXISTS
 * Domain Search discovers people rather than guessing them, but its response is
 * still untrusted external input and every searched company spends a shared
 * Hunter credit. These tests pin normalization, junk-mailbox removal, safe URL
 * input, and the credit ceiling without a key or network access.
 *
 * Run: node tests/hunter-domain.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  DEFAULT_DOMAIN_LIMIT,
  hunterDomainSearch,
  mapDomainSearch,
  planDomainBudget,
} from '../lib/hunter-domain.mjs';
import { classifyTitle } from '../lib/influence-tier.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('hunter-domain.test.mjs');

const fixture = {
  data: {
    domain: ' ACME.EXAMPLE ',
    organization: 'Acme Example Works',
    pattern: '{first}.{last}',
    accept_all: true,
    emails: [
      {
        first_name: 'Avery', last_name: 'Quill', position: 'Director of Revenue Operations',
        seniority: 'executive', department: 'sales', value: 'AVERY@ACME.EXAMPLE ',
        type: 'personal', confidence: 91, linkedin: 'https://linkedin.example/avery',
        sources: [{ uri: 'https://source.example/one' }, { uri: 'https://source.example/two' }],
      },
      { value: 'info@acme.example', type: 'generic', confidence: 99 },
      {
        first_name: 'Robin', last_name: 'Vale', value: 'robin@acme.example',
        type: 'personal', confidence: '87', sources: [],
      },
      {
        first_name: 'Sam', last_name: 'North', position: 'Recruiter',
        value: 'sam@acme.example', type: 'personal',
      },
    ],
  },
};

const mapped = mapDomainSearch(fixture);
check(mapped.candidates.length === 3, 'maps every personal candidate and drops the generic entry');
check(mapped.candidates.map(c => c.first).join(',') === 'Avery,Robin,Sam', 'preserves personal candidate order');
check(mapped.candidates[0].email === 'avery@acme.example', 'normalizes candidate email');
check(mapped.candidates[0].fullName === 'Avery Quill' && mapped.candidates[0].sourceCount === 2,
  'maps the normalized name and source count');
check(mapped.candidates[0].proposedTier === classifyTitle(mapped.candidates[0].title),
  'proposed tier uses classifyTitle');
check(mapped.candidates[1].title === '' && mapped.candidates[1].proposedTier === null,
  'keeps a candidate with no position and proposes no tier');
check(mapped.candidates[1].confidence === null && mapped.candidates[2].confidence === null,
  'string and missing confidence values become null');
check(mapped.domain === 'acme.example' && mapped.organization === 'Acme Example Works'
  && mapped.pattern === '{first}.{last}' && mapped.acceptAll === true,
  'carries domain metadata and catch-all status');

for (const malformed of [{}, { data: null }, { data: { emails: 'nope' } }, undefined]) {
  check(mapDomainSearch(malformed).candidates.length === 0, 'malformed response returns no candidates');
}
const empty = mapDomainSearch({ data: {} });
check(empty.domain === '' && empty.organization === '' && empty.pattern === '' && empty.acceptAll === false,
  'missing domain metadata receives empty defaults');

for (const domain of ['https://acme.example', 'acme.example/jobs', 'acme example', 'user@acme.example']) {
  await hunterDomainSearch(domain, 'unused').then(
    () => check(false, `rejects unsafe domain ${domain}`),
    error => check(/plain hostname/.test(error.message), `rejects unsafe domain ${domain}`),
  );
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async url => ({
  status: 200,
  json: async () => ({ data: { domain: new URL(url).searchParams.get('domain'), emails: [] } }),
});
try {
  for (const domain of ['acme.example', 'sub.acme.example']) {
    const result = await hunterDomainSearch(domain, 'invented-key');
    check(result.domain === domain, `accepts plain hostname ${domain} without network access`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

check(planDomainBudget({ needed: 100, limit: 40, creditsLeft: 3 }) === 3,
  'credits cap an explicit larger limit');
check(planDomainBudget({ needed: 100, limit: 40, creditsLeft: 0 }) === 0,
  'zero credits give zero searches');
check(planDomainBudget({ needed: 100, creditsLeft: null }) === DEFAULT_DOMAIN_LIMIT,
  'unknown credits fall back to the default cap');
check(planDomainBudget({ needed: 3, limit: 25, creditsLeft: 50 }) === 3,
  'never returns more than needed');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

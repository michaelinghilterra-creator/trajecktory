#!/usr/bin/env node
/**
 * Mount the real discovery router against an isolated contact book. The Hunter
 * account and directory calls are stubbed so this suite spends no credits and
 * cannot depend on a developer's network or account data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('hunter-discovery-route');
process.env.TJK_DATA_DIR = sandbox;
// Whitespace prevents dashboard-web/.env from supplying a local key while the
// missing-key case runs. Individual success cases replace it with a fake key.
process.env.HUNTER_API_KEY = ' ';
process.env.MILLIONVERIFIER_API_KEY = ' ';

const header = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const existing = '| 1 | Acme Example | Existing | Erin |  | Talent Partner |  |  |  |  |  |  | Not Contacted |  |  | https://www.acme.example/careers |\n';
const targetFile = path.join(sandbox, 'target-talent.md');
fs.writeFileSync(targetFile, header + existing, 'utf8');
const originalContactBook = fs.readFileSync(targetFile, 'utf8');

const nativeFetch = globalThis.fetch;
let domainCalls = [];
let creditsLeft = 10;
let throwingDomain = '';
globalThis.fetch = async url => {
  const parsed = new URL(url);
  if (parsed.pathname === '/v2/account') {
    return { json: async () => ({ data: { requests: { searches: { available: creditsLeft, used: 0 } } } }) };
  }
  if (parsed.pathname !== '/v2/domain-search') throw new Error(`Unexpected fetch: ${url}`);
  const domain = parsed.searchParams.get('domain');
  domainCalls.push(domain);
  if (domain === throwingDomain) throw new Error(`Directory unavailable for ${domain}`);
  // Corroborated ONLY by an address at the known domain: no sources array, no
  // profile URL. This is what catches a knownDomains map keyed with the wrong
  // company normalizer, which drops the domain check silently and rejects the
  // person as uncorroborated. A company name carrying a legal suffix is where
  // the two normalizers in this repo disagree.
  const names = domain === 'suffix.example'
    ? [{ first_name: 'Dana', last_name: 'Domain', position: 'VP Revenue Operations', value: 'dana@suffix.example', type: 'personal' }]
    : domain === 'beta.example'
    ? [{ first_name: 'Bailey', last_name: 'Beta', position: 'VP Revenue Operations', value: 'bailey@beta.example', type: 'personal', sources: [{}] }]
    : [
        { first_name: 'Avery', last_name: 'Accepted', position: 'Director Revenue Operations', value: `avery@${domain}`, type: 'personal', sources: [{}] },
        { first_name: 'Nora', last_name: 'NoSource', position: 'Recruiter', type: 'personal', sources: [] },
        { first_name: 'Erin', last_name: 'Existing', position: 'Talent Partner', value: `erin@${domain}`, type: 'personal', sources: [{}] },
      ];
  return { status: 200, json: async () => ({ data: { domain, emails: names } }) };
};

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
// Server config deliberately loads dashboard-web/.env during import. Restore the
// whitespace override afterward so a developer's real key stays neutralized.
process.env.HUNTER_API_KEY = ' ';
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async body => {
  const response = await nativeFetch(`${base}/api/tt-reconcile/discover-hunter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('hunter-discovery-route.test.mjs');

const missingKey = await post({ companies: [{ company: 'Acme Example' }] });
check(missingKey.status === 400 && /HUNTER_API_KEY/.test(missingKey.body.error), 'missing key returns 400 with the key name');
check(domainCalls.length === 0, 'missing key makes no Hunter directory fetch');

process.env.HUNTER_API_KEY = 'invented-key';
domainCalls = [];
creditsLeft = 10;
const discovered = await post({
  companies: [
    { company: 'Acme Example' },
    { company: 'No Site Example' },
  ],
});
const acme = discovered.body.results?.[0];
check(discovered.status === 200 && acme?.domain === 'acme.example', 'resolves an existing company website to a bare domain');
check(acme?.suggestions.length === 1 && acme.suggestions[0].first === 'Avery', 'returns a corroborated candidate as a suggestion');
check(acme?.suggestions[0].tier === 'hm' && /\[tier:hm\]/.test(acme.suggestions[0].notes) && /\[src:hunter:\d{4}-\d{2}-\d{2}\]/.test(acme.suggestions[0].notes), 'accepted suggestion carries a tier and stamped notes');
check(acme?.rejected.some(person => person.name === 'Nora NoSource' && person.reasons.includes('no corroboration')), 'uncorroborated candidate is rejected with a reason');
check(acme?.duplicates === 1 && !acme.suggestions.some(person => person.first === 'Erin'), 'existing contact is a duplicate rather than a suggestion');
check(discovered.body.unresolved?.includes('No Site Example') && !domainCalls.includes('nosite.example'), 'company without a domain is unresolved and never searched');
check(discovered.body.creditsSpent === 1, 'credits spent counts searched companies rather than requested companies');

domainCalls = [];
creditsLeft = 1;
const budgeted = await post({
  companies: [
    { company: 'Alpha Example', domain: 'alpha.example' },
    { company: 'Beta Example', domain: 'beta.example' },
  ],
  limit: 2,
});
check(budgeted.body.creditsSpent === 1 && budgeted.body.skippedBudget?.includes('Beta Example'), 'company beyond the credit budget is named as skipped');
check(domainCalls.length === 1 && domainCalls[0] === 'alpha.example', 'budgeted company is not searched');

const tooMany = await post({ companies: Array.from({ length: 16 }, (_, i) => ({ company: `Company ${i}`, domain: `company${i}.example` })) });
check(tooMany.status === 400 && /Max 15/.test(tooMany.body.error), 'more than 15 companies returns 400');

domainCalls = [];
creditsLeft = 10;
throwingDomain = 'broken.example';
const partial = await post({
  companies: [
    { company: 'Broken Example', domain: 'broken.example' },
    { company: 'Beta Example', domain: 'beta.example' },
  ],
});
const broken = partial.body.results.find(result => result.company === 'Broken Example');
const beta = partial.body.results.find(result => result.company === 'Beta Example');
check(/Directory unavailable/.test(broken?.error || ''), 'one company fetch failure returns its error');
check(beta?.suggestions.length === 1 && beta.suggestions[0].first === 'Bailey', 'one fetch failure leaves another company result intact');
check(fs.readFileSync(targetFile, 'utf8') === originalContactBook, 'discovery never writes to the contact file');

creditsLeft = 10;
throwingDomain = null;
const suffixed = await post({ companies: [{ company: 'Suffix Example, Inc.', domain: 'suffix.example' }] });
const suffixResult = suffixed.body.results?.[0];
check(suffixResult?.suggestions.length === 1 && suffixResult.suggestions[0].first === 'Dana',
  'an address at the known domain corroborates a person at a company with a legal suffix');
check((suffixResult?.rejected || []).length === 0,
  'the domain check is not silently skipped by a mismatched company key');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
globalThis.fetch = nativeFetch;
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

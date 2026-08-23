#!/usr/bin/env node
import { suggestMerges } from '../dashboard-web/server/lib/contact-merge-suggest.mjs';

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};
const person = (ref, name, company, extra = {}) => ({ id: ref, refs: [ref], matchedBy: 'single', name, company, ...extra });
const suggested = (a, b) => suggestMerges([a, b]).length === 1;

console.log('contact-merge-suggest.test.mjs');
check(suggested(person('ta:1', 'Jane Smith', 'Acme'), person('referral:1', 'Jane Jones Smith', 'Acme')), 'same company and shared surname across stores is suggested');
check(!suggested(person('ta:1', 'Jane Smith', 'Acme'), person('referral:1', 'Jane Smith', 'Beta')), 'same name at different companies is not suggested');
check(!suggested(person('ta:1', 'Jane Smith', 'Acme'), person('referral:1', 'Maria Jones', 'Acme')), 'same company without a shared token is not suggested');
check(suggestMerges([{ id: 'ta:1', refs: ['ta:1', 'referral:1'], matchedBy: 'linkedinKey', name: 'Jane Smith', company: 'Acme' }]).length === 0, 'rows already grouped are not suggested');
check(!suggested(person('ta:1', 'Jane Smith', 'Acme', { matchedBy: 'pin' }), person('referral:1', 'Jane Smith', 'Acme')), 'a side pinned alone is not suggested');
check(!suggested(person('ta:1', 'Jane Smith', 'Acme'), person('ta:2', 'Jane Smith', 'Acme')), 'rows in the same store are not suggested');
check(!suggested(person('ta:1', 'Jo Li', 'Acme'), person('referral:1', 'Li Wu', 'Acme')), 'a two character token does not qualify');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

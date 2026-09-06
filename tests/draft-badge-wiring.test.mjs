#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '../dashboard-web/node_modules/esbuild/lib/main.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'dashboard-web', 'src');

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
  console.log(`  ok ${message}`);
};
const read = (name) => readFileSync(join(SRC, name), 'utf8');

console.log('draft-badge-wiring.test.mjs');

const surfaces = ['followups.jsx', 'referrals.jsx', 'connect.jsx', 'target-talent.jsx'];
for (const name of surfaces) {
  const source = read(name);
  check(/\.review\b/.test(source), `${name} reads review from a draft response`);
  check(source.includes('DraftScoreBadge'), `${name} renders DraftScoreBadge`);
  check(source.includes('/api/drafts/improve') || source.includes('onImprove'), `${name} wires draft improvement`);
  check(source.includes('surfaceId'), `${name} uses the server surfaceId`);
  check(/(?:setProposedDraft|setLiProposed|setEmProposed)\((?:d|res)\.draft \|\| null\)/.test(source), `${name} stores improve output as a proposal`);
  check(source.includes('new AbortController()') && source.includes('signal: controller.signal'), `${name} makes improvement cancellable`);
  check(source.includes("reviewOf: 'self'") || source.includes("setReviewOf('self')"), `${name} labels generated reviews as self-scored`);
  check(source.includes("reviewOf: 'independent'") || source.includes("setReviewOf('independent')"), `${name} labels rerun reviews as independent`);
}

const shared = read('shared.jsx');
check(
  shared.includes('function DraftScoreBadge({ review, reviewOf, onRerun, onImprove, busy, improving })'),
  'DraftScoreBadge accepts reviewOf, onImprove, and improving',
);
check(shared.includes('self-scored'), 'DraftScoreBadge labels a self score');
check(shared.includes('independent'), 'DraftScoreBadge labels an independent score');
check(shared.includes("reviewOf === 'original' ? 'was ' : ''"), 'DraftScoreBadge keeps the was prefix for an original score');
check(shared.includes('onImprove &&') && shared.includes('Improve this draft'), 'DraftScoreBadge gates and labels the improve button');

const jsxFiles = readdirSync(SRC).filter(name => name.endsWith('.jsx'));
check(jsxFiles.every(name => !read(name).includes('reviewOf: null')), 'no JSX file sets reviewOf to null');

for (const name of ['posts.jsx', 'linkedin-ssi.jsx']) {
  check(!read(name).includes('DraftScoreBadge'), `${name} has no draft score badge`);
}

const connect = read('connect.jsx');
const targetTalent = read('target-talent.jsx');
check(connect.includes('value={emailBody}') && connect.includes('body: snapshot'), 'connect.jsx edits and improves an unwrapped body');
check(targetTalent.includes('value={draftBody}') && targetTalent.includes('body: snapshot'), 'target-talent.jsx edits and improves an unwrapped body');

for (const name of ['shared.jsx', ...surfaces]) {
  await transform(read(name), { loader: 'jsx', sourcefile: name });
  passed++;
  console.log(`  ok ${name} parses as JSX`);
}

console.log(`\n draft badge wiring: ${passed} checks passed`);

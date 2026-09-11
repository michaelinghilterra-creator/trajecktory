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
  check(source.includes('review: null') && source.includes('reviewPending: true'), `${name} shows the draft before its background review finishes`);
  check(source.includes('DraftScoreBadge'), `${name} renders DraftScoreBadge`);
  check(source.includes('/api/drafts/improve') || source.includes('onImprove'), `${name} wires draft improvement`);
  check(source.includes('surfaceId'), `${name} uses the server surfaceId`);
  check(source.includes('window.tjkGradeDraft'), `${name} starts review through the shared background grader`);
  check(source.includes('gradeContext: next.gradeContext'), `${name} passes the stored gradeContext to the grader`);
  check(source.includes('pending={') && source.includes('.reviewPending}'), `${name} passes pending state to DraftScoreBadge`);
  const editAwareGrades = (source.match(/reviewOf: unchanged \? 'independent' : 'original'/g) || []).length;
  check(source.includes('=== gradedBody') && source.includes('=== gradedSubject')
    && editAwareGrades >= (name === 'connect.jsx' ? 2 : 1),
  `${name} labels every completed grade as original when the graded body or subject was edited`);
  check(/gradeContext\?\.appId/.test(source), `${name} prefers gradeContext appId for draft improvement`);
  check(/(?:setProposedDraft|setLiProposed|setEmProposed)\((?:d|res)\.draft \? \{/.test(source), `${name} stores improve output and both scores as a proposal`);
  check(source.includes('new AbortController()') && source.includes('signal: controller.signal'), `${name} makes improvement cancellable`);
  check(!source.includes("reviewOf: 'self'") && !source.includes("setReviewOf('self')"), `${name} never labels generated reviews as self-scored`);
  check((source.includes("reviewOf: 'independent'") || source.includes("setReviewOf('independent')")
    || source.includes("reviewOf: unchanged ? 'independent' : 'original'"))
    && source.includes('originalScore:') && source.includes('newScore:')
    && !source.includes('Current:') && source.includes('Improved:')
    && source.includes('newScore -') && source.includes('review?.dimensions'),
  `${name} labels reviews independently and shows the proposed score delta and dimensions`);
}

const shared = read('shared.jsx');
check(
  shared.includes('function DraftScoreBadge({ review, reviewOf, pending, onRerun, onImprove, busy, improving })'),
  'DraftScoreBadge accepts reviewOf, pending, onImprove, and improving',
);
check(shared.includes("window.tjkGradeDraft = async function") && shared.includes("window.tjkMutate('/api/drafts/review'")
  && shared.includes('JSON.stringify({ body, subject, surfaceId, gradeContext })'),
'the shared grader is the only request-body builder for independent reviews');
check(surfaces.every(name => !read(name).includes('/api/drafts/review')), 'draft surfaces do not build review requests themselves');
check(shared.includes('pending && !review') && shared.includes('grading...') && shared.includes('badgeColor(null)'), 'DraftScoreBadge renders a muted pending pill');
check(shared.includes('dim.name || dim.id.replace(/_/g, " ")'), 'DraftScoreBadge prefers dimension display names');
check(!shared.includes('Get independent review'), 'DraftScoreBadge removes the redundant independent-review button');
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

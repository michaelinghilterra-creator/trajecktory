#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeSandbox } from './helpers/sandbox.mjs';

const dimensions = [
  'relevance', 'personalization', 'evidence', 'earned_ask', 'clarity',
  'ask_strength', 'length_fit', 'authenticity', 'subject',
];
const grade = (baseScore, overrides = {}) => JSON.stringify({
  dimensions: dimensions.map((id) => ({
    id,
    score: overrides[id] ?? baseScore,
    explanation: `The ${id} dimension is scored from the message.`,
  })),
  top_fixes: ['Keep the strongest grounded sentence.'],
});
const partialGrade = (score) => JSON.stringify({
  dimensions: [{
    id: 'relevance',
    score,
    explanation: 'The relevance dimension is scored from the message.',
  }],
  top_fixes: ['Keep the strongest grounded sentence.'],
});
const rewrite = (subject, body) => JSON.stringify({ subject, body });

process.env.TJK_FAKE_LLM = '1';
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Fallback', body: 'Fallback body.' });
process.env.TJK_FAKE_LLM_SEQ = JSON.stringify([
  rewrite('Better Acme note', 'Acme serves 12,000 organizations. Would this fit the Engineer opening?'),
  grade(6),
  grade(7),
  rewrite('Barely different', 'Acme serves 12,000 organizations. Would this suit the Engineer opening?'),
  grade(6),
  grade(6, { authenticity: 8 }),
  rewrite('Ungradable comparison', 'Acme serves 12,000 organizations. Is the Engineer opening active?'),
  'not-json',
  grade(7),
  rewrite('Incomplete original', 'Acme serves 12,000 organizations. Does this fit the Engineer opening?'),
  partialGrade(6),
  grade(7),
  rewrite('Incomplete rewrite', 'Acme serves 12,000 organizations. Could this fit the Engineer opening?'),
  grade(6),
  partialGrade(7),
]);

const sandbox = makeSandbox('draft-improve');
process.env.TJK_DATA_DIR = sandbox;
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportName = `draft-improve-research-${process.pid}-${Date.now()}.md`;
const reportRelative = `reports/${reportName}`;
const reportAbsolute = path.join(root, reportRelative);
const fence = '-'.repeat(3);
fs.mkdirSync(path.dirname(reportAbsolute), { recursive: true });
fs.writeFileSync(reportAbsolute, `${fence}\n${JSON.stringify({
  schema: 'trajecktory-report/v1',
  id: 77,
  summary: { companyBrief: 'Acme serves 12,000 organizations.' },
}, null, 2)}\n${fence}\n# Acme research\n`, 'utf8');
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  `| 77 | 2026-01-01 | Acme | Engineer | 4.5/5 | Applied | | | [77](${reportRelative}) | | https://jobs.example.com/acme/77 |\n`,
  'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/drafts.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};
const postImprove = (body) => fetch(`${base}/api/drafts/improve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (response) => ({ status: response.status, body: await response.json() }));
const gradeContext = {
  appId: 77,
  recipientRole: 'Chief People Officer',
  recipientTier: 'exec',
  appliedRole: 'Engineer',
  appliedDate: '2026-01-01',
};

console.log('draft-improve.test.mjs');

try {
  const clearGain = await postImprove({
    subject: 'Acme note',
    body: 'Acme serves 12,000 organizations. Is the Engineer opening relevant?',
    surfaceId: 'ta_email',
    fixes: ['Make the closing question more direct.'],
    gradeContext,
  });
  const originalEvidence = clearGain.body.originalReview?.dimensions?.find((item) => item.id === 'evidence');
  const rewriteEvidence = clearGain.body.review?.dimensions?.find((item) => item.id === 'evidence');
  check(clearGain.status === 200
    && clearGain.body.improved === true
    && clearGain.body.draft?.body.includes('Would this fit')
    && clearGain.body.originalReview?.score === 60
    && clearGain.body.review?.score === 70,
  'a rewrite ten points higher is returned as improved');
  check(originalEvidence?.score === 6 && rewriteEvidence?.score === 7
    && !clearGain.body.originalReview?.unsourcedWarning
    && !clearGain.body.review?.unsourcedWarning,
  'both comparison grades receive the same application research');

  const onePointGain = await postImprove({
    subject: 'Acme note',
    body: 'Acme serves 12,000 organizations. Is the Engineer opening relevant?',
    surfaceId: 'ta_email',
    fixes: ['Make the closing question more direct.'],
    gradeContext,
  });
  check(onePointGain.status === 200
    && onePointGain.body.improved === false
    && onePointGain.body.draft === null
    && onePointGain.body.originalReview?.score === 60
    && onePointGain.body.review?.score === 61,
  'a rewrite only one point higher is withheld');

  const failedGrade = await postImprove({
    subject: 'Acme note',
    body: 'Acme serves 12,000 organizations. Is the Engineer opening relevant?',
    surfaceId: 'ta_email',
    fixes: ['Make the closing question more direct.'],
    gradeContext,
  });
  check(failedGrade.status === 200
    && failedGrade.body.improved === false
    && failedGrade.body.draft === null
    && failedGrade.body.reason === 'grade-failed'
    && failedGrade.body.originalReview === null
    && failedGrade.body.review?.score === 70,
  'a failed comparison grade withholds the rewrite and returns grade-failed');

  const incompleteOriginal = await postImprove({
    subject: 'Acme note',
    body: 'Acme serves 12,000 organizations. Is the Engineer opening relevant?',
    surfaceId: 'ta_email',
    fixes: ['Make the closing question more direct.'],
    gradeContext,
  });
  check(incompleteOriginal.status === 200
    && incompleteOriginal.body.improved === false
    && incompleteOriginal.body.draft === null
    && incompleteOriginal.body.reason === 'grade-incomplete'
    && incompleteOriginal.body.originalReview?.incomplete === true
    && incompleteOriginal.body.review?.incomplete !== true,
  'an incomplete original grade withholds the rewrite and returns grade-incomplete');

  const incompleteRewrite = await postImprove({
    subject: 'Acme note',
    body: 'Acme serves 12,000 organizations. Is the Engineer opening relevant?',
    surfaceId: 'ta_email',
    fixes: ['Make the closing question more direct.'],
    gradeContext,
  });
  check(incompleteRewrite.status === 200
    && incompleteRewrite.body.improved === false
    && incompleteRewrite.body.draft === null
    && incompleteRewrite.body.reason === 'grade-incomplete'
    && incompleteRewrite.body.originalReview?.incomplete !== true
    && incompleteRewrite.body.review?.incomplete === true,
  'an incomplete rewrite grade withholds the rewrite and returns grade-incomplete');
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch { /* older node / no undici */ }
  fs.rmSync(reportAbsolute, { force: true });
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

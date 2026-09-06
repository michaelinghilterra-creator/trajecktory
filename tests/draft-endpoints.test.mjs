#!/usr/bin/env node
/**
 * draft-endpoints.test.mjs — route smoke tests for the draft endpoints.
 *
 * Mounts the draft routers on a bare Express app (no origin-guard middleware) and
 * stubs the model with TJK_FAKE_LLM, so each handler runs its FULL path — including
 * response assembly — without a key or a network call. A handler that throws on a
 * dangling variable in that path fails HERE, in CI, instead of when the user clicks
 * Draft. This is exactly the class of bug that shipped as followup-message's
 * "src is not defined" (a ReferenceError after generateText, at res.json).
 *
 * Fixtures are invented contacts at .example handles — no real personal data.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_FAKE_LLM = '1';
// Most draft handlers JSON.parse the model output, so the stub is a JSON object.
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body for the smoke test.' });
const sandbox = makeSandbox("drafts");
process.env.TJK_DATA_DIR = sandbox;

// Minimal target-talent.md so parseTargetTalentMd finds a contact (appendTTRows does
// not create the file). Columns per the parser: id|company|last|first|salute|title|
// city|state|zip|phone|email|linkedin|status|lastTouch|notes|website.
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' +
  '| 1 | Acme | Doe | Jane | Ms. | Recruiter | Austin | TX | 78701 | 555 | jane@acme.example | linkedin.com/in/jane-doe-ex | Sent |  |  |  |\n',
  'utf8');

const express = (await import('express')).default;
const { router: linkedinDrafts } = await import('../dashboard-web/server/routes/linkedin-drafts.mjs');
const { router: targetTalent } = await import('../dashboard-web/server/routes/target-talent.mjs');
const { router: referrals } = await import('../dashboard-web/server/routes/referrals.mjs');
const { router: draftsRouter } = await import('../dashboard-web/server/routes/drafts.mjs');
const { appendReferralRows } = await import('../dashboard-web/server/lib/referrals.mjs');
const { setLinkedInStatus } = await import('../dashboard-web/server/lib/tt-linkedin.mjs');

// Contact 1 accepted the invite (exercises the free-DM followup-message path); one
// referral for the referral drafter.
setLinkedInStatus(1, 'Connected', '2023-06-01');
const [refRow] = appendReferralRows([{ name: 'Rob Roe', how: '1st-degree LinkedIn connection', where: 'Beta', target: '', status: 'Not Asked', lastTouch: '', linkedin: 'linkedin.com/in/rob-roe-ex', email: '', notes: '' }]);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(linkedinDrafts); app.use(targetTalent); app.use(referrals); app.use(draftsRouter);
const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('draft-endpoints.test.mjs');

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const cases = [
  ['connect-note (first-touch, ad-hoc)',            '/api/linkedin-drafts/connect-note',    { name: 'Test Person', firstName: 'Test', role: 'Recruiter', company: 'Acme' }],
  ['followup-message (already-invited / connected)', '/api/linkedin-drafts/followup-message', { source: 'ta', id: 1 }],
  ['target-talent email draft',                     '/api/target-talent/1/draft',           {}],
  ['referral draft',                                `/api/referrals/${refRow.id}/draft`,     {}],
  ['referral LinkedIn draft (real DM)',             `/api/referrals/${refRow.id}/draft`,     { channel: 'linkedin', topic: 'ask' }],
  ['target-talent LinkedIn draft (real DM)',        '/api/target-talent/1/draft',            { channel: 'linkedin', interviewStage: 'general' }],
];
for (const [name, p, body] of cases) {
  const res = await post(p, body);
  check(res.status === 200 && !res.body.error, `${name} → 200 (${res.body.error || 'ok'})`);
  check(typeof res.body.surfaceId === 'string' && typeof res.body.reviewStatus === 'string', `${name} returns surface and review status`);
}

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Open with the result.'] },
  score: 71,
  dimensions: [
    { id: 'relevance', score: 7, explanation: 'q' },
    { id: 'clarity', score: 6, explanation: 'q' },
  ],
  subject: 'Stub subject',
  body: 'Stub body for the smoke test.',
});
for (const [name, p, body] of cases) {
  const res = await post(p, body);
  check(res.status === 200 && res.body.review?.score > 0 && res.body.reviewStatus === 'ok', `${name} returns a successful rubric review`);
}

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body for the smoke test.' });

// Independent review endpoint
const reviewRes = await post('/api/drafts/review', {
  body: 'Test draft body for independent review.',
  surfaceId: 'ta_email',
});
check(reviewRes.status === 500, 'independent review returns 500 when model output is unparseable (fake LLM)');

const badSurface = await post('/api/drafts/review', { body: 'Test', surfaceId: 'not_a_surface' });
check(badSurface.status === 400, 'independent review rejects unknown surfaceId');

const noBody = await post('/api/drafts/review', { surfaceId: 'ta_email' });
check(noBody.status === 400, 'independent review rejects missing body');

// A short_public surface is a registered surface with rubric: false. It must be
// refused as a bad request, not fall through to the generic 500 that reads like
// a model failure.
const rubricOff = await post('/api/drafts/review', { body: 'Test', surfaceId: 'li_comment' });
check(rubricOff.status === 400, 'independent review rejects a surface the rubric does not grade');

const improveNoBody = await post('/api/drafts/improve', { surfaceId: 'ta_email' });
check(improveNoBody.status === 400, 'improve rejects missing body');

const improveBadSurface = await post('/api/drafts/improve', { body: 'Test', surfaceId: 'not_a_surface' });
check(improveBadSurface.status === 400, 'improve rejects unknown surfaceId');

const improveRubricOff = await post('/api/drafts/improve', { body: 'Test', surfaceId: 'li_comment' });
check(improveRubricOff.status === 400, 'improve rejects a surface the rubric does not grade');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Open with the result.'] },
  score: 71,
  dimensions: [
    { id: 'relevance', score: 7, explanation: 'q' },
    { id: 'clarity', score: 6, explanation: 'q' },
  ],
  subject: 'Stub subject',
  body: 'Stub body for the smoke test.',
});
const improveOriginal = { subject: 'Original subject', body: 'Original body.' };
const improveRes = await post('/api/drafts/improve', {
  ...improveOriginal,
  surfaceId: 'ta_email',
  recipientFirst: 'Jane',
});
check(improveRes.status === 200
  && improveRes.body.ok === true
  && typeof improveRes.body.draft?.body === 'string'
  && improveRes.body.draft.body.length > 0
  && improveRes.body.review?.score > 0
  && improveRes.body.reviewOf === 'original'
  && JSON.stringify(improveRes.body.original) === JSON.stringify(improveOriginal),
'improve returns the rewritten draft, original review label, score, and echoed input');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Shorten the note.'] },
  dimensions: [
    { id: 'relevance', score: 7, explanation: 'q' },
    { id: 'clarity', score: 6, explanation: 'q' },
  ],
  body: 'x'.repeat(350),
});
const improveConnectNote = await post('/api/drafts/improve', {
  body: 'Original connection note.',
  surfaceId: 'connect_note_generic',
});
check(improveConnectNote.status === 200 && improveConnectNote.body.draft?.body.length === 300,
  'improve hard fits character capped surfaces to the profile limit');

// Shut down cleanly and let the event loop DRAIN rather than process.exit() —
// on Windows a forced exit that races a mid-close handle (the server socket or
// undici's keep-alive fetch pool) trips a libuv assertion. Close both, then just
// set the exit code and return so Node exits on its own with no open handles.
server.closeAllConnections?.();
await new Promise((resolve) => server.close(() => resolve()));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch { /* older node / no undici */ }
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;

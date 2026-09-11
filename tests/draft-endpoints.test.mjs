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
import { fileURLToPath } from 'url';
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_FAKE_LLM = '1';
// Most draft handlers JSON.parse the model output, so the stub is a JSON object.
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body for the smoke test.' });
const sandbox = makeSandbox("drafts");
process.env.TJK_DATA_DIR = sandbox;
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportName = `lap-j-research-${process.pid}-${Date.now()}.md`;
const reportRelative = `reports/${reportName}`;
const reportAbsolute = path.join(root, reportRelative);
const fence = '-'.repeat(3);
fs.mkdirSync(path.dirname(reportAbsolute), { recursive: true });
fs.writeFileSync(reportAbsolute, `${fence}\n${JSON.stringify({
  schema: 'trajecktory-report/v1',
  id: 77,
  summary: { companyBrief: 'Acme serves 12,000 organizations and supports 87,654 deployments, including 95 of the Fortune 100.' },
}, null, 2)}\n${fence}\n# Report body\nBody fallback should not win.\n`, 'utf8');
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  `| 77 | 2026-01-01 | Acme | Engineer | 4.5/5 | Applied | | | [77](${reportRelative}) | | https://jobs.example.com/acme/77 |\n` +
  '| 78 | 2026-02-01 | EvalCo | Platform Lead | 4.0/5 | Evaluated | | | | | https://jobs.example.com/evalco/78 |\n' +
  '| 79 | 2026-03-01 | NoFitCo | Data Lead | 3.0/5 | Not a Fit | | | | | https://jobs.example.com/nofitco/79 |\n',
  'utf8');
fs.writeFileSync(path.join(sandbox, 'follow-ups.md'),
  '# Follow-Ups\n\n| # | app# | date | company | role | channel | contact | notes |\n' +
  '|---|------|------|---------|------|---------|---------|-------|\n' +
  '| 1 | 77 | 2026-01-08 | Acme | Engineer | Email | Hiring team | First follow-up |\n' +
  '| 2 | 77 | 2026-01-15 | Acme | Engineer | LinkedIn | Jane Doe | Second follow-up |\n',
  'utf8');

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
const { router: linkedinDrafts, mergeConnectPacketContext } = await import('../dashboard-web/server/routes/linkedin-drafts.mjs');
const { router: targetTalent, buildTargetTalentAugustPrompt } = await import('../dashboard-web/server/routes/target-talent.mjs');
const { router: referrals, buildReferralAugustPrompt } = await import('../dashboard-web/server/routes/referrals.mjs');
const { router: draftsRouter } = await import('../dashboard-web/server/routes/drafts.mjs');
const { router: followups } = await import('../dashboard-web/server/routes/followups.mjs');
const { buildConnectPrompt } = await import('../dashboard-web/server/lib/linkedin-ssi.mjs');
const { buildPacket, buildPacketFromFields, renderFactBlock } = await import('../lib/outreach-packet.mjs');
const { buildAugustPrompt, wrapReferralDraft } = await import('../lib/outreach-voice.mjs');
const { appendReferralRows } = await import('../dashboard-web/server/lib/referrals.mjs');
const { setLinkedInStatus } = await import('../dashboard-web/server/lib/tt-linkedin.mjs');

// Contact 1 accepted the invite (exercises the free-DM followup-message path); one
// referral for the referral drafter.
setLinkedInStatus(1, 'Connected', '2023-06-01');
const [refRow] = appendReferralRows([{ name: 'Rob Roe', how: '1st-degree LinkedIn connection', where: 'Acme', target: '', status: 'Not Asked', lastTouch: '', linkedin: 'linkedin.com/in/rob-roe-ex', email: '', notes: 'Chief People Officer · connected 29 Jul 2026' }]);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(linkedinDrafts); app.use(targetTalent); app.use(referrals); app.use(followups); app.use(draftsRouter);
const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('draft-endpoints.test.mjs');

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const routePacket = buildPacketFromFields({
  kind: 'ta_dm', name: 'Avery Example', role: 'Recruiter', company: 'Acme',
  sender: { fullName: 'Jordan Example', firstName: 'Jordan', cv: 'Fixture CV.', voiceRules: 'Be precise.' },
});
check(buildTargetTalentAugustPrompt(routePacket, { interviewStage: 'general' }) === buildAugustPrompt(routePacket),
  'target-talent fresh/general prompt stays byte-identical to buildAugustPrompt');
const replyIntent = 'REPLY. Respond directly and specifically to their most recent message in the thread below. Pick up what they said and advance it. Do not restart the conversation.';
const taReplyPrompt = buildTargetTalentAugustPrompt(routePacket, {
  mode: 'reply', interviewStage: 'general', intentGuidance: replyIntent,
});
check(taReplyPrompt.includes(replyIntent) && !taReplyPrompt.includes('FIRST / FRESH TOUCH'),
  'target-talent reply replaces the August first-touch intent without contradiction');
const firstInterviewGuidance = 'FIRST INTERVIEW STAGE. You are early in the interview loop. Reference momentum ("enjoyed the conversation", "following the process") without naming details you may not have. Reinforce one differentiated strength and signal continued interest.';
check(buildTargetTalentAugustPrompt(routePacket, {
  interviewStage: '1st Interview', stageGuidance: firstInterviewGuidance,
}).includes(firstInterviewGuidance),
  'target-talent LinkedIn prompt includes first-interview stage guidance');
const taEmailPacket = { ...routePacket, kind: 'ta_email', surfaceId: 'ta_email' };
check(buildTargetTalentAugustPrompt(taEmailPacket, {
  channel: 'email', interviewStage: 'general',
}) === buildAugustPrompt(taEmailPacket),
  'target-talent email general prompt stays byte-identical to buildAugustPrompt');
check(buildTargetTalentAugustPrompt(taEmailPacket, {
  channel: 'email', interviewStage: '1st Interview', stageGuidance: firstInterviewGuidance,
}).includes(firstInterviewGuidance),
  'target-talent email prompt includes first-interview stage guidance');

const referralPacket = { ...routePacket, kind: 'referral_dm', surfaceId: 'referral_dm' };
check(buildReferralAugustPrompt(referralPacket, { topic: 'reconnect' }) === buildAugustPrompt(referralPacket),
  'referral reconnect prompt stays byte-identical to buildAugustPrompt');
const askGuidance = 'THE REFERRAL ASK. Make one specific ask.';
const askLine = 'A good ask here is to flag his application for the Engineer role to the hiring manager.';
const referralAskPrompt = buildReferralAugustPrompt(referralPacket, {
  topic: 'ask', topicGuidance: askGuidance, referralAskLine: askLine,
});
check(referralAskPrompt.includes(askGuidance)
  && referralAskPrompt.includes(`GOAL: ${askGuidance}`)
  && referralAskPrompt.includes(askLine)
  && !referralAskPrompt.includes('Reconnect with no ask.'),
  'referral non-reconnect topic replaces both August intent and packet goal and keeps the ask line');

const connectPacket = { ...routePacket, kind: 'connect_note', surfaceId: 'connect_note_influencer' };
const unchangedPacket = mergeConnectPacketContext(connectPacket);
check(unchangedPacket === connectPacket && buildAugustPrompt(unchangedPacket) === buildAugustPrompt(connectPacket),
  'stored connection-note packet stays identical when no request context is supplied');
const contextualPacket = mergeConnectPacketContext(connectPacket, {
  tone: 'Warm', reason: 'Met at the summit', angleGuidance: 'Reference Post', referralTarget: 'Engineer opening',
});
check(contextualPacket.recipient.notesExcerpt.includes('Reason: Met at the summit')
  && contextualPacket.recipient.notesExcerpt.includes('Angle guidance: Reference Post')
  && contextualPacket.recipient.notesExcerpt.includes('Referral target: Engineer opening')
  && contextualPacket.recipient.notesExcerpt.includes('Tone guidance:'),
  'stored connection-note packet merges tone, reason, angle, and referral target');
check(wrapReferralDraft('Body text.', referralPacket) === 'Hi Avery,\n\nBody text.\n\nBest,\nJordan',
  'referral drafts receive the deterministic greeting and sign-off wrapper');
const applicationPacket = buildPacket({ source: 'application', id: 77, kind: 'app_followup' });
check(applicationPacket.applicationFollowups?.count === 2
  && applicationPacket.applicationFollowups?.lastDate === '2026-01-15'
  && /That was \d+ days ago\./.test(renderFactBlock(applicationPacket)),
  'application packets read prior follow-up count, last date, and application timing into shared facts');

const cases = [
  ['connect-note (first-touch, ad-hoc)',             '/api/linkedin-drafts/connect-note',     { name: 'Test Person', firstName: 'Test', role: 'Recruiter', company: 'No Report Co' }, { source: 'ta', id: null, appId: null, recipientRole: 'Recruiter', recipientTier: 'ta', appliedRole: '', appliedDate: '' }],
  ['followup-message (already-invited / connected)', '/api/linkedin-drafts/followup-message', { source: 'ta', id: 1 }, { source: 'ta', id: 1, appId: 77, recipientRole: 'Recruiter', recipientTier: 'ta', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
  ['target-talent email draft',                      '/api/target-talent/1/draft',            {}, { source: 'ta', id: 1, appId: 77, recipientRole: 'Recruiter', recipientTier: 'ta', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
  ['referral draft',                                 `/api/referrals/${refRow.id}/draft`,      {}, { source: 'referral', id: refRow.id, appId: 77, recipientRole: 'Chief People Officer', recipientTier: 'exec', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
  ['referral LinkedIn draft (real DM)',              `/api/referrals/${refRow.id}/draft`,      { channel: 'linkedin', topic: 'ask' }, { source: 'referral', id: refRow.id, appId: 77, recipientRole: 'Chief People Officer', recipientTier: 'exec', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
  ['target-talent LinkedIn draft (real DM)',         '/api/target-talent/1/draft',             { channel: 'linkedin', interviewStage: 'general' }, { source: 'ta', id: 1, appId: 77, recipientRole: 'Recruiter', recipientTier: 'ta', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
  ['application follow-up email',                    '/api/followups/77/draft',                {}, { source: undefined, id: undefined, appId: 77, recipientRole: '', recipientTier: '', appliedRole: 'Engineer', appliedDate: '2026-01-01' }],
];
for (const [name, p, body, expectedContext] of cases) {
  const res = await post(p, body);
  check(res.status === 200 && !res.body.error, `${name} → 200 (${res.body.error || 'ok'})`);
  check(typeof res.body.surfaceId === 'string'
    && res.body.review === null
    && res.body.reviewStatus === 'pending'
    && res.body.gradeContext?.surfaceId === res.body.surfaceId
    && res.body.gradeContext?.source === expectedContext.source
    && res.body.gradeContext?.id === expectedContext.id
    && res.body.gradeContext?.appId === expectedContext.appId
    && res.body.gradeContext?.recipientRole === expectedContext.recipientRole
    && res.body.gradeContext?.recipientTier === expectedContext.recipientTier
    && res.body.gradeContext?.appliedRole === expectedContext.appliedRole
    && res.body.gradeContext?.appliedDate === expectedContext.appliedDate,
  `${name} returns a pending review and its grade context`);
}

for (const [channel, body] of [['email', {}], ['LinkedIn', { channel: 'linkedin', topic: 'reconnect' }]]) {
  const res = await post(`/api/referrals/${refRow.id}/draft`, body);
  check(/^Hi Rob,\n\nStub body for the smoke test\.\n\nBest,\n\S+$/u.test(res.body.draft?.body || ''),
    `referral ${channel} response includes deterministic greeting and sender sign-off`);
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
  check(res.status === 200 && res.body.review === null && res.body.reviewStatus === 'pending',
    `${name} does not await a rubric review even when the model returns one`);
}

const noReportSmoke = await post('/api/linkedin-drafts/connect-note', {
  name: 'No Report Contact', firstName: 'No', role: 'Recruiter', company: 'No Report Co',
});
check(noReportSmoke.status === 200
  && noReportSmoke.body.review === null
  && noReportSmoke.body.reviewStatus === 'pending'
  && noReportSmoke.body.gradeContext?.appId === null,
  'generation succeeds with a pending review when no company report resolves');

for (const company of ['EvalCo', 'NoFitCo']) {
  const res = await post('/api/linkedin-drafts/connect-note', {
    name: `${company} Contact`, firstName: company, role: 'Recruiter', company,
  });
  check(res.status === 200
    && res.body.gradeContext?.appliedRole === ''
    && res.body.gradeContext?.appliedDate === '',
  `${company} non-submitted application leaves applied role and date empty`);
}

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'personalization', fixes: ['Keep the company figure grounded.'] },
  dimensions: [
    { id: 'personalization', score: 8, explanation: 'The company fact is specific.' },
    { id: 'clarity', score: 8, explanation: 'The message is clear.' },
  ],
  subject: 'Acme deployments',
  body: 'Acme supports 87,654 deployments.',
});
const researchCases = [
  ['target-talent email', '/api/target-talent/1/draft', {}],
  ['target-talent direct message', '/api/target-talent/1/draft', { channel: 'linkedin', interviewStage: 'general' }],
  ['referral email', `/api/referrals/${refRow.id}/draft`, {}],
  ['referral direct message', `/api/referrals/${refRow.id}/draft`, { channel: 'linkedin', topic: 'ask' }],
  ['LinkedIn connection note', '/api/linkedin-drafts/connect-note', { name: 'Acme Contact', firstName: 'Acme', role: 'Recruiter', company: 'Acme' }],
  ['LinkedIn follow-up', '/api/linkedin-drafts/followup-message', { source: 'ta', id: 1 }],
];
for (const [name, p, body] of researchCases) {
  const res = await post(p, body);
  check(res.status === 200
    && res.body.review === null
    && res.body.reviewStatus === 'pending'
    && res.body.gradeContext?.appId === 77,
  `${name} returns the application research id for background grading`);
}

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body for the smoke test.' });

// Independent review endpoint
const reviewRes = await post('/api/drafts/review', {
  body: 'Test draft body for independent review.',
  surfaceId: 'ta_email',
});
check(reviewRes.status === 500, 'independent review returns 500 when model output is unparseable (fake LLM)');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  dimensions: [
    { id: 'evidence', score: 8, explanation: 'The company figure is grounded.' },
    { id: 'personalization', score: 8, explanation: 'The company fact is specific.' },
  ],
  top_fixes: ['Keep the company figure grounded.'],
});
const reviewWithResearch = await post('/api/drafts/review', {
  body: 'Acme serves 12,000 organizations.',
  subject: 'Acme data integrity',
  surfaceId: 'ta_email',
  gradeContext: {
    surfaceId: 'ta_email', source: 'ta', id: 1, appId: 77,
    recipientRole: 'Chief People Officer', recipientTier: 'exec',
    appliedRole: 'Engineer', appliedDate: '2026-01-01',
  },
});
const reviewedEvidence = reviewWithResearch.body.review?.dimensions
  ?.find((dimension) => dimension.id === 'evidence')?.score;
check(reviewWithResearch.status === 200
  && reviewedEvidence === 8
  && !reviewWithResearch.body.review?.unsourcedWarning,
  'independent review uses gradeContext application research for evidence grounding');

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
  gradeContext: {
    appId: 77, recipientRole: 'Chief People Officer', recipientTier: 'exec',
    appliedRole: 'Engineer', appliedDate: '2026-01-01',
  },
  originalScore: 100,
});
check(improveRes.status === 200
  && improveRes.body.ok === true
  && improveRes.body.improved === false
  && improveRes.body.draft === null
  && improveRes.body.review?.score > 0
  && improveRes.body.originalReview?.score === improveRes.body.review?.score
  && improveRes.body.reviewOf === 'independent'
  && !Object.hasOwn(improveRes.body, 'originalScore')
  && JSON.stringify(improveRes.body.original) === JSON.stringify(improveOriginal),
'improve withholds a rewrite that does not beat the freshly regraded original by three points');

const improveTooManyFixes = await post('/api/drafts/improve', {
  ...improveOriginal,
  surfaceId: 'ta_email',
  fixes: Array.from({ length: 9 }, (_, index) => `Fix ${index + 1}`),
});
check(improveTooManyFixes.status === 400, 'improve rejects more than eight supplied fixes');

const improveOversizedFix = await post('/api/drafts/improve', {
  ...improveOriginal,
  surfaceId: 'ta_email',
  fixes: ['x'.repeat(501)],
});
check(improveOversizedFix.status === 400, 'improve rejects a supplied fix longer than 500 characters');

const improveMissingApp = await post('/api/drafts/improve', {
  ...improveOriginal,
  surfaceId: 'ta_email',
  appId: 999999,
});
check(improveMissingApp.status === 200 && improveMissingApp.body.ok === true,
  'improve succeeds when the application id cannot be resolved');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'evidence', fixes: ['Keep the company figure grounded.'] },
  dimensions: [
    { id: 'evidence', score: 8, explanation: 'The company figure is grounded.' },
    { id: 'personalization', score: 8, explanation: 'The company fact is specific.' },
  ],
  subject: 'Acme data integrity',
  body: 'Acme serves 12,000 organizations.',
});
const improveWithResearch = await post('/api/drafts/improve', {
  body: 'Acme is an impressive company.',
  subject: 'Acme',
  surfaceId: 'ta_email',
  appId: 77,
});
const sourcedEvidence = improveWithResearch.body.review?.dimensions
  ?.find((dimension) => dimension.id === 'evidence')?.score;
check(improveWithResearch.status === 200 && sourcedEvidence === 8
  && !improveWithResearch.body.review?.unsourcedWarning,
  'improve accepts a company figure sourced only by the application report');

const improveWithoutResearch = await post('/api/drafts/improve', {
  body: 'Acme is an impressive company.',
  subject: 'Acme',
  surfaceId: 'ta_email',
});
const unsourcedEvidence = improveWithoutResearch.body.review?.dimensions
  ?.find((dimension) => dimension.id === 'evidence')?.score;
check(improveWithoutResearch.status === 200 && unsourcedEvidence === 3
  && improveWithoutResearch.body.review?.unsourcedWarning,
  'improve independent grading caps a company figure when no application research is supplied');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'ask_strength', fixes: ['Make the next step specific.'] },
  dimensions: [
    { id: 'relevance', score: 8, explanation: 'The message is relevant.' },
    { id: 'ask_strength', score: 9, explanation: 'The ask is concise.' },
  ],
  subject: 'Acme reporting',
  body: "The reporting work maps to Acme.\n\nI'd welcome a pointer to whoever owns this role if that's not you",
});
const improveTemplatedAsk = await post('/api/drafts/improve', {
  body: 'Original message.',
  subject: 'Acme',
  surfaceId: 'ta_email',
});
check(improveTemplatedAsk.status === 200
  && improveTemplatedAsk.body.ok === true
  && improveTemplatedAsk.body.draft === null
  && improveTemplatedAsk.body.review?.templatedAskWarning === true,
  'improve comparison grades still cap a templated ask and withhold a non-improving rewrite');

process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Shorten the note.'] },
  dimensions: [
    { id: 'relevance', score: 7, explanation: 'q' },
    { id: 'clarity', score: 6, explanation: 'q' },
  ],
  body: 'x'.repeat(350),
});
const connectGrade = (score, explanation) => JSON.stringify({
  dimensions: ['personalization', 'relevance', 'ask_strength', 'clarity', 'authenticity']
    .map((id) => ({ id, score, explanation })),
  top_fixes: ['Keep the relevant opening.'],
});
process.env.TJK_FAKE_LLM_SEQ = JSON.stringify([
  JSON.stringify({ body: 'x'.repeat(350) }),
  connectGrade(5, 'The original is generic.'),
  connectGrade(8, 'The rewrite is relevant.'),
]);
const improveConnectNote = await post('/api/drafts/improve', {
  body: 'Original connection note.',
  surfaceId: 'connect_note_generic',
});
delete process.env.TJK_FAKE_LLM_SEQ;
check(improveConnectNote.status === 200 && improveConnectNote.body.draft?.body.length === 300,
  'improve hard fits character capped surfaces to the profile limit');

const connectPrompt = buildConnectPrompt({
  senderName: 'Jordan Example', senderFirst: 'Jordan', recipientName: 'Avery Example',
  recipientRole: 'Recruiter', recipientCompany: 'Acme', appliedRole: 'Engineer',
});
check(connectPrompt.includes('He submitted an application for the Engineer role')
  && connectPrompt.includes('Give one specific, grounded reason to connect.'),
  'connection-note prompt carries the applied role in the shared facts and uses the August instruction');
const connectPromptWithoutDigest = buildConnectPrompt({
  senderName: 'Jordan Example', senderFirst: 'Jordan', recipientName: 'Avery Example',
  recipientRole: 'Recruiter', recipientCompany: 'Acme', cvExcerpt: '',
});
check(!connectPromptWithoutDigest.includes('(CV not available)')
  && !connectPromptWithoutDigest.includes('ABOUT JORDAN'),
  'connection-note prompt omits the digest section when the digest is absent');

const outreachRouteFiles = [
  'dashboard-web/server/routes/linkedin-drafts.mjs',
  'dashboard-web/server/routes/target-talent.mjs',
  'dashboard-web/server/routes/referrals.mjs',
  'dashboard-web/server/routes/followups.mjs',
];
const outreachRouteSource = outreachRouteFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
check((outreachRouteSource.match(/generateText\(prompt, \{\s*model: draftModel\(\), maxTokens: 900, label: `draft:\$\{packet\.surfaceId\}`/g) || []).length === 8,
  'all eight outreach draft paths use the rated August model-call envelope');
const liFollowupSource = fs.readFileSync(path.join(root, 'dashboard-web/server/routes/linkedin-drafts.mjs'), 'utf8');
const targetTalentSource = fs.readFileSync(path.join(root, 'dashboard-web/server/routes/target-talent.mjs'), 'utf8');
const liFollowupBlock = liFollowupSource.slice(
  liFollowupSource.indexOf("router.post('/api/linkedin-drafts/followup-message'"),
  liFollowupSource.indexOf("router.post('/api/linkedin-drafts/archive-contact'"),
);
check(liFollowupBlock.includes("buildPacket({ source, id, kind: 'li_followup' })")
  && liFollowupBlock.includes('buildAugustPrompt(packet)'),
  'LinkedIn follow-up builds the August prompt from the shared stored-contact packet');
const augustFixturePrompt = buildAugustPrompt(buildPacketFromFields({
  kind: 'li_followup', name: 'Avery Example', role: 'Recruiter', company: 'Acme',
  sender: { fullName: 'Jordan Example', firstName: 'Jordan', cv: 'Fixture CV.' },
}));
check((augustFixturePrompt.match(/CV:\nFixture CV\./g) || []).length === 1,
  'LinkedIn follow-up supplies the CV exactly once through the shared fact packet');
const augustVoiceSource = fs.readFileSync(path.join(root, 'lib/outreach-voice.mjs'), 'utf8');
check(!augustVoiceSource.includes('A soft redirect ask is allowed')
  && !augustVoiceSource.includes('Name the ${role(packet)} role after that opener'),
  'shared August instructions contain no Lap 7 tier-ask or applied-role additions');
check(augustVoiceSource.includes('THIS IS NOT A NEW CONNECTION REQUEST. The invite is already out.')
  && augustVoiceSource.includes('Write a purposeful message. Do not write "I would like to connect".'),
  'both not-connected LinkedIn DM surfaces use the tested August state instructions');
const referralSource = fs.readFileSync(path.join(root, 'dashboard-web/server/routes/referrals.mjs'), 'utf8');
check((referralSource.match(/\$\{referralAsk\(appliedRole\)\}/g) || []).length === 2
  && !referralSource.includes('tierAsk(')
  && referralSource.includes('A good ask here is to flag his application for the ${appliedRole} role to the hiring manager'),
  'referral email and DM use the suggested referral ask independently of recipient tier');

const nonReferralPromptSources = [
  liFollowupSource,
  fs.readFileSync(path.join(root, 'dashboard-web/server/lib/linkedin-ssi.mjs'), 'utf8'),
  targetTalentSource,
  fs.readFileSync(path.join(root, 'dashboard-web/server/routes/followups.mjs'), 'utf8'),
];
check(nonReferralPromptSources.every((source) => source.includes('buildAugustPrompt'))
  && !augustVoiceSource.includes('Do NOT pitch a job-search tool or job-search article'),
  'every non-referral outreach surface uses the tested August prompt without Lap 7 additions');
const referralReconnectPrompt = buildAugustPrompt(buildPacketFromFields({
  kind: 'referral_email', name: 'Avery Example', role: 'Peer', company: 'Acme',
  sender: { fullName: 'Jordan Example', firstName: 'Jordan', cv: 'Fixture CV.' },
}));
check(!referralReconnectPrompt.includes('A good ask here is')
  && referralReconnectPrompt.includes('Reconnect with no ask.'),
  'referral reconnect keeps the tested August no-ask instruction unchanged');
check(augustFixturePrompt.includes('Use only these facts. Do not invent or infer missing details.')
  && !outreachRouteSource.includes('recent funding/news'),
  'outreach grounding comes from the shared tested fact-packet guardrail');

const draftsSource = fs.readFileSync(path.join(root, 'dashboard-web/server/routes/drafts.mjs'), 'utf8');
check(/const contextOptions = draftGradeContext\(gradeContext\)/.test(draftsSource)
  && /gradeIndependently\(body, surfaceId,[\s\S]*?\.\.\.contextOptions/.test(draftsSource),
  '/api/drafts/review uses the shared validated grading context');
check(/const contextOptions = draftGradeContext\(gradeContext, appId\)/.test(draftsSource)
  && /buildImprovePrompt\(surfaceId,[\s\S]*?\.\.\.contextOptions/.test(draftsSource)
  && /const gradeOptions = \{[\s\S]*?\.\.\.contextOptions/.test(draftsSource)
  && /Promise\.all\(\[[\s\S]*?gradeIndependently\(body[\s\S]*?gradeIndependently\(finished\.body/.test(draftsSource),
  '/api/drafts/improve uses one shared context for its rewrite and parallel comparison grades');

// Shut down cleanly and let the event loop DRAIN rather than process.exit() —
// on Windows a forced exit that races a mid-close handle (the server socket or
// undici's keep-alive fetch pool) trips a libuv assertion. Close both, then just
// set the exit code and return so Node exits on its own with no open handles.
server.closeAllConnections?.();
await new Promise((resolve) => server.close(() => resolve()));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch { /* older node / no undici */ }
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
try { fs.rmSync(reportAbsolute, { force: true }); } catch {}
process.exitCode = failed ? 1 : 0;

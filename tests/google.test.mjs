#!/usr/bin/env node
/**
 * google.test.mjs — unit tests for the Gmail READ path core (lib/google.mjs).
 *
 * Covers the pieces that decide what gets recorded, with an injected fetch and
 * invented message fixtures so no live inbox is touched:
 *   - getAccessToken: reuse-when-valid, refresh-when-stale, persistence.
 *   - googleStatus: connection facts, scope parsing, no secrets.
 *   - parseGmailMessage / extractEmail: header + base64url body extraction.
 *   - classifyReply: positive / negative / neutral heuristics.
 *   - matchAddress: exact email match to a TA row.
 *   - scanDecisions: hard bounce → flip, soft bounce → no flip, reply routing.
 *
 * Run: node tests/google.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

// SANDBOX FIRST. getAccessToken persists a refreshed token through writeTokens()
// unless the caller passes its own `save`, and one health-check case here does not.
// With no TJK_DATA_DIR that write lands on the REAL data/google-tokens.json, so a
// plain `node test-all.mjs` silently replaced a live Gmail refresh token with the
// fixture's 'r' and logged the user out of their own mailbox. It fails as an
// authentication error hours later, nowhere near the test run, and the credential
// cannot be recovered — only re-granted by hand.
//
// config.mjs resolves DATA_DIR at import time, so the env var MUST be set before
// google.mjs loads. Static imports are hoisted above assignments, which is why the
// module is imported dynamically below. Same pattern as google-sync.test.mjs.
const tmp = makeSandbox("google");
process.env.TJK_DATA_DIR = tmp;

const {
  getAccessToken, googleStatus, checkHealth, parseGmailMessage, extractEmail,
  classifyReply, matchAddress, matchByCompanyDomain, matchBySubject, scanDecisions, tokenScopes,
  candidateAppsFor, rankCandidateApps, fetchMessagesConcurrent, logReplyToContact,
} = await import('../dashboard-web/server/lib/google.mjs');
const { APP_NOTES_PATH, GOOGLE_TOKENS_PATH, TARGET_TALENT_MD } = await import('../dashboard-web/server/config.mjs');
const { parseTargetTalentMd, readTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { addNote, findNoteByMsgId, readAppNotes } = await import('../dashboard-web/server/lib/notes.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
async function checkThrows(fn, msg) {
  try { await fn(); check(false, msg); }
  catch { check(true, msg); }
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');

console.log('google.test.mjs');

// The sandbox is load-bearing, so assert it rather than trusting it. If someone
// restores a static import, DATA_DIR resolves to the real data/ before this file
// can redirect it, and this suite goes back to destroying a live credential while
// every assertion still passes. That is precisely the failure this catches.
check(GOOGLE_TOKENS_PATH.startsWith(tmp),
  'token writes are sandboxed to a temp dir, never the real data/google-tokens.json');

// ── getAccessToken ───────────────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
await (async () => {
  // still valid → reuse, no network
  let fetchCalled = false;
  const tok = await getAccessToken({
    tokens: { refresh_token: 'r', access_token: 'STILL-GOOD', expiry_date: NOW + 3_600_000 },
    now: NOW, fetchImpl: () => { fetchCalled = true; throw new Error('should not fetch'); },
  });
  check(tok === 'STILL-GOOD', 'valid access token is reused');
  check(fetchCalled === false, 'no refresh call when token is still valid');
})();

await (async () => {
  // expired → refresh, persist, return new
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  let saved = null;
  const fetchImpl = async (url, opts) => {
    check(url.includes('oauth2.googleapis.com/token'), 'refresh hits the Google token endpoint');
    check(/grant_type=refresh_token/.test(opts.body), 'refresh sends grant_type=refresh_token');
    return { ok: true, json: async () => ({ access_token: 'NEW-TOKEN', expires_in: 3600, token_type: 'Bearer' }) };
  };
  const tok = await getAccessToken({
    tokens: { refresh_token: 'r', access_token: 'OLD', expiry_date: NOW - 1000 },
    now: NOW, fetchImpl, save: (t) => { saved = t; },
  });
  check(tok === 'NEW-TOKEN', 'stale token is refreshed');
  check(saved && saved.access_token === 'NEW-TOKEN', 'refreshed token is persisted');
  check(saved && saved.refresh_token === 'r', 'refresh token is preserved across refresh');
  check(saved && saved.expiry_date === NOW + 3_600_000, 'new expiry is computed as an absolute epoch');
})();

await checkThrows(
  () => getAccessToken({ tokens: { access_token: 'x' }, now: NOW }),
  'no refresh token → throws (not connected)');

// ── googleStatus ─────────────────────────────────────────────────────────────
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const st = googleStatus({ refresh_token: 'r', scope: SCOPE, expiry_date: NOW + 1000, connectedEmail: 'me@example.test' }, NOW);
check(st.connected === true, 'status reports connected with a refresh token');
check(st.canReadMail === true, 'gmail.modify scope grants read');
check(st.scopes.length === 2, 'scopes parsed from the space-separated string');
check(st.expired === false, 'unexpired token reads not-expired');
check(!('access_token' in st) && !('refresh_token' in st), 'status leaks no token values');
check(googleStatus(null, NOW).connected === false, 'no tokens → not connected');
check(tokenScopes({ scope: SCOPE }).length === 2, 'tokenScopes splits the scope string');

// ── checkHealth ──────────────────────────────────────────────────────────────
// The reconnect signal. Distinguishes benign access-token staleness (silently
// refreshed) from a dead refresh token (needs re-consent). fetch + clock injected;
// tokens injected so readTokens is never hit. (readSync reads the real cursor file
// read-only for freshness; only connected/healthy/reason are asserted here.)
await (async () => {
  // no refresh token → not connected, no network
  const h = await checkHealth({ tokens: { access_token: 'x' }, now: NOW, fetchImpl: () => { throw new Error('should not fetch'); } });
  check(h.connected === false && h.healthy === false && h.reason === 'not_connected', 'no refresh token → not_connected');
})();
await (async () => {
  // cached access token still valid → healthy, no network
  let fetched = false;
  const h = await checkHealth({
    tokens: { refresh_token: 'r', access_token: 'GOOD', expiry_date: NOW + 3_600_000, connectedEmail: 'me@example.test' },
    now: NOW, fetchImpl: () => { fetched = true; throw new Error('should not fetch'); },
  });
  check(h.connected === true && h.healthy === true && h.reason === 'ok', 'valid cached access token → ok');
  check(fetched === false, 'a healthy cached token is not re-refreshed');
  check(h.connectedEmail === 'me@example.test' && !('access_token' in h) && !('refresh_token' in h), 'health carries the email but leaks no token values');
})();
await (async () => {
  // stale access token but refresh succeeds → healthy
  const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'FRESH', expires_in: 3600 }) });
  const h = await checkHealth({ tokens: { refresh_token: 'r', access_token: 'OLD', expiry_date: NOW - 1000 }, now: NOW, fetchImpl });
  check(h.healthy === true && h.reason === 'ok', 'stale access token + successful refresh → ok');
})();
await (async () => {
  // refresh fails (expired/revoked refresh token) → reconnect
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });
  const h = await checkHealth({ tokens: { refresh_token: 'dead', access_token: 'OLD', expiry_date: NOW - 1000 }, now: NOW, fetchImpl });
  check(h.connected === true && h.healthy === false && h.reason === 'reconnect', 'failed refresh → connected but reconnect');
})();

// ── parseGmailMessage / extractEmail ─────────────────────────────────────────
const rawReply = {
  id: 'm-reply', threadId: 't1', snippet: 'Great to connect',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Example Personone <personone@zorblax.example>' },
      { name: 'To', value: 'me@example.test' },
      { name: 'Subject', value: 'Re: Example Gadget Director' },
      { name: 'Date', value: 'Sat, 15 Jun 2030 09:00:00 -0500' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Great to connect. Are you available for a call next week to discuss next steps?') } },
    ],
  },
};
const pm = parseGmailMessage(rawReply);
check(pm.from === 'Example Personone <personone@zorblax.example>', 'From header extracted');
check(pm.subject === 'Re: Example Gadget Director', 'Subject header extracted');
check(pm.text.includes('discuss next steps'), 'base64url text/plain body decoded');
check(extractEmail(pm.from) === 'personone@zorblax.example', 'address pulled from a "Name <addr>" header');
check(parseGmailMessage({ id: 'x', snippet: 'hi', payload: {} }).text === 'hi', 'falls back to snippet when no body');

// ── classifyReply ────────────────────────────────────────────────────────────
check(classifyReply({ subject: 'Re: role', text: 'Can we schedule a call to discuss next steps?' }) === 'positive', 'scheduling/next-steps → positive');
check(classifyReply({ text: 'Unfortunately we have decided to move forward with other candidates.' }) === 'negative', 'rejection language → negative');
check(classifyReply({ text: 'Thanks for the note, will review and circle back.' }) === 'neutral', 'ambiguous → neutral');
check(classifyReply({ subject: 'we interviewed many strong candidates', text: 'unfortunately not a fit' }) === 'negative', 'negative wins over an interview-ish word');

// ── matchAddress ─────────────────────────────────────────────────────────────
const taRows = [
  { id: 2, first: 'Reese', last: 'Calder', company: 'Northwind Robotics', email: 'reese.calder@northwind.example' },
  { id: 900113, first: 'Example', last: 'Personone', company: 'Zorblax Widgetry', email: 'personone@zorblax.example' },
];
check(matchAddress('PERSONONE@zorblax.example', { taRows })?.source === 'ta', 'contact matched case-insensitively');
check(matchAddress('reese.calder@northwind.example', { taRows })?.company === 'Northwind Robotics', 'TA match carries company');
check(matchAddress('nobody@unknown.example', { taRows }) === null, 'unknown sender → no match');

// ── scanDecisions ────────────────────────────────────────────────────────────
const hardDsn = {
  id: 'm-bounce', snippet: 'Delivery Status Notification (Failure)',
  payload: {
    headers: [
      { name: 'From', value: 'Mail Delivery Subsystem <mailer-daemon@mail.example>' },
      { name: 'Subject', value: 'Delivery Status Notification (Failure)' },
    ],
    parts: [{ mimeType: 'text/plain', body: { data: b64(
      'Your message could not be delivered.\nFinal-Recipient: rfc822; reese.calder@northwind.example\nStatus: 5.1.1\nDiagnostic: user unknown\n') } }],
  },
};
const softDsn = {
  id: 'm-soft', snippet: 'Delivery delayed',
  payload: {
    headers: [
      { name: 'From', value: 'postmaster@northwind.example' },
      { name: 'Subject', value: 'Delivery Status Notification (Delay)' },
    ],
    parts: [{ mimeType: 'text/plain', body: { data: b64(
      'This is a warning. Delivery is temporarily deferred.\nFinal-Recipient: rfc822; reese.calder@northwind.example\nStatus: 4.2.2\n') } }],
  },
};
const unknownReply = {
  id: 'm-other',
  payload: { headers: [{ name: 'From', value: 'News <news@unknown.example>' }, { name: 'Subject', value: 'Weekly digest' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Here is your weekly digest.') } }] },
};

const dec = scanDecisions({ messages: [hardDsn, softDsn, rawReply, unknownReply], taRows });
const hard = dec.bounces.find(b => b.msgId === 'm-bounce');
check(hard && hard.kind === 'hard', 'hard DSN classified as hard');
check(hard && hard.address === 'reese.calder@northwind.example', 'bounced Final-Recipient extracted');
check(hard && hard.flip && hard.flip.source === 'ta' && hard.flip.state === 'bounced', 'hard bounce for a known contact produces a bounced flip');
const soft = dec.bounces.find(b => b.msgId === 'm-soft');
check(soft && soft.kind === 'soft', 'soft DSN classified as soft');
check(soft && soft.flip === null, 'soft bounce produces no flip (transient, never kill an address)');
const rep = dec.replies.find(r => r.msgId === 'm-reply');
check(rep && rep.contact?.source === 'ta' && rep.sentiment === 'positive', 'reply from a known contact routed with sentiment');
check(dec.other.some(o => o.msgId === 'm-other'), 'reply from an unknown sender surfaced as other, not dropped');

// ── matchByCompanyDomain (tier-2: unknown sender, known company) ──────────────
// The matcher reads the domain's ROOT label (TLD-agnostic), so .example fixtures
// exercise it exactly like real domains would. Real domains are forbidden in
// tracked tests (PII gate), and the generic-domain set is by definition real
// consumer domains, so that specific branch is covered in prod, not here.
const apps = [
  { id: 900101, company: 'Northwind Robotics' },
  { id: 900102, company: 'Corvane Systems, Inc.' },
];
const companyMatchOptions = {
  emailDate: '2030-03-10T15:00:00Z',
  applyDates: { 900101: '2030-03-04', 900102: '2030-03-05' },
};
check(matchByCompanyDomain('careers@northwindrobotics.example', apps, companyMatchOptions)?.appId === 900101, 'sender domain exactly matching joined company tokens suggests the app');
check(matchByCompanyDomain('careers@northwindrobotics.example', apps, companyMatchOptions)?.confidence === 'high', 'an exact joined-token domain match is high confidence');
check(matchByCompanyDomain('careers@northwind.example', apps, companyMatchOptions)?.appId === 900101
  && matchByCompanyDomain('careers@northwind.example', apps, companyMatchOptions)?.confidence === 'medium',
  'a domain root matching leading company tokens is medium confidence');
check(matchByCompanyDomain('talent@corvane.example', apps, companyMatchOptions)?.appId === 900102, 'domain root matches despite an Inc./Systems suffix on the company');
check(matchByCompanyDomain('talent@corvane.example', apps, companyMatchOptions)?.confidence === 'high', 'an exact root/company-token match is high confidence');
check(matchByCompanyDomain('system@joqibmail.test', [{ id: 900115, company: 'Qib' }]) === null,
  'domain matching requires equality, so joqibmail does not match Qib');
check(matchByCompanyDomain('noreply@lever.example', apps) === null, 'an ATS mail domain (lever) is not a company match → null');
check(matchByCompanyDomain('hi@unrelated-vendor.example', apps) === null, 'a domain matching no application → null');

// scanDecisions attaches the guess to an unknown sender at a known company
const firstContact = {
  id: 'm-first',
  payload: { headers: [{ name: 'From', value: 'Talent Team <careers@northwindrobotics.example>' }, { name: 'Subject', value: 'Your application' }, { name: 'Date', value: 'Sun, 10 Mar 2030 15:00:00 +0000' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Thanks for applying. We would love to set up a call.') } }] },
};
const dec2 = scanDecisions({ messages: [firstContact], taRows, apps, applyDates: companyMatchOptions.applyDates });
const guessed = dec2.other.find(o => o.msgId === 'm-first');
check(guessed && guessed.companyGuess?.appId === 900101, 'unknown sender at a known company carries a companyGuess to the right app');
check(guessed && guessed.sentiment === 'positive', 'the company-guessed first-contact email is still sentiment-classified');

// ── candidateAppsFor: reply → which application(s) ───────────────────────────
// Invented applications shaped like parseApplicationsMd output.
const appRows = [
  { id: 900116, company: 'Northwind Robotics', role: 'Example Ratchet Lead', status: 'Applied' },
  { id: 900117, company: 'Northwind Robotics', role: 'Example Pulley Manager', status: 'Applied' },
  { id: 900112, company: 'Corvane Systems', role: 'Example Gadget Lead', status: 'Responded' },
];
const northwind = candidateAppsFor('Northwind Robotics', appRows);
check(northwind.length === 2, 'both roles at the same company are candidates, so the user picks which');
check(northwind.every(a => a.role && a.status), 'each candidate carries role + status for the picker');
check(candidateAppsFor('corvane systems', appRows).length === 1 && candidateAppsFor('corvane systems', appRows)[0].id === 900112, 'case- and punctuation-insensitive match finds the single Corvane app');
check(candidateAppsFor('Nonexistent Co', appRows).length === 0, 'a company with no application yields no candidates');
check(candidateAppsFor('', appRows).length === 0 && candidateAppsFor(null, appRows).length === 0, 'empty/null company is safe');

// ── matchBySubject: the tier-3 subject matcher (the Kestrel case) ────────────
const subjApps = [
  { id: 900103, company: 'Kestrel', role: 'Example Gizmo Lead', status: 'Applied' },
  { id: 900104, company: 'Corvane Systems', role: 'Example Gadget Lead', status: 'Applied' },
  { id: 900105, company: 'Bex Systems', role: 'Example Sprocket Director', status: 'Applied' },
];
const subjectMatchOptions = {
  emailDate: '2030-03-10T15:00:00Z',
  applyDates: { 900103: '2030-03-04', 900104: '2030-03-04', 900105: '2030-03-04' },
};
const kestrel = matchBySubject('Update on your Kestrel Application', subjApps, subjectMatchOptions);
check(kestrel && kestrel.appId === 900103 && kestrel.confidence === 'subject', 'a subject naming the company resolves to its application (the Kestrel case)');
check(matchBySubject('Re: your Kestrel, Inc. application', subjApps, subjectMatchOptions)?.appId === 900103, 'company tokens stay whole-word matched when the subject adds a legal suffix');
check(matchBySubject('Following up on your Corvane Systems role', subjApps, subjectMatchOptions)?.appId === 900104, 'a multi-word company matches as consecutive whole tokens');
check(matchBySubject('Weekly newsletter, nothing to see here', subjApps) === null, 'a subject naming no known company matches nothing');

const collisionApps = [
  { id: 900118, company: 'Plica', role: 'Example Cog Director', status: 'Applied' },
  { id: 900106, company: 'Northwind', role: 'Platform Lead', status: 'Applied' },
];
check(matchBySubject('Your application to Northwind', collisionApps, { emailDate: '2030-03-10', applyDates: { 900106: '2030-03-04' } })?.appId === 900106,
  'whole-word subject matching picks Northwind instead of Plica');
check(matchBySubject('Thank you for your application', collisionApps) === null,
  'a generic application subject does not match Plica');
check(matchBySubject('Update from Acme Robotics', [{ id: 900107, company: 'Acme Robotics', role: 'Systems Lead', status: 'Applied' }], { emailDate: '2030-03-10', applyDates: { 900107: '2030-03-04' } })?.appId === 900107,
  'multi-word company tokens match when they appear consecutively');
check(matchBySubject('Your application to Lumora', [{ id: 900108, company: 'Lumora Technologies', role: 'Systems Lead', status: 'Applied' }], { emailDate: '2030-03-10', applyDates: { 900108: '2030-03-04' } })?.appId === 900108,
  'a generic-word company matches on its distinctive core tokens');
check(matchBySubject('Update on your Kestrel application', [{ id: 900109, company: 'Kestrel, Inc.', role: 'Example Gizmo Lead', status: 'Applied' }], { emailDate: '2030-03-10', applyDates: { 900109: '2030-03-04' } })?.appId === 900109,
  'a legal-suffix company matches on its distinctive core tokens');

const rankingDate = '2030-03-20T15:00:00Z';
const statusRankApps = [
  { id: 900001, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'Applied' },
  { id: 900002, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'Not a Fit' },
];
const statusRankOptions = { emailDate: rankingDate, applyDates: { 900001: '2030-03-04', 900002: '2030-03-04' } };
check(matchBySubject('Update from Zorblax Widgetry', statusRankApps, statusRankOptions)?.appId === null,
  'different statuses do not break a tie between otherwise identical eligible candidates');
check(candidateAppsFor('Zorblax Widgetry', statusRankApps, statusRankOptions)[0]?.id === 900001,
  'candidateAppsFor returns the same-company candidates in ranked order');

const roleRankApps = [
  { id: 900119, company: 'Solstice Labs', role: 'Product Operations Manager', status: 'Applied' },
  { id: 900120, company: 'Solstice Labs', role: 'Data Platform Engineer', status: 'Applied' },
];
const roleRankOptions = {
  emailDate: rankingDate,
  applyDates: { 900119: '2030-03-18', 900120: '2030-03-18' },
};
check(matchBySubject('Solstice Labs update for Data Platform Engineer', roleRankApps, roleRankOptions)?.appId === 900120,
  'subject role text breaks a tie between two applied rows');

const recentRankApps = [
  { id: 900121, company: 'Woodgrove', role: 'Platform Engineer', status: 'Applied' },
  { id: 900122, company: 'Woodgrove', role: 'Platform Engineer', status: 'Applied' },
];
check(matchBySubject('Update from Woodgrove', recentRankApps, {
  emailDate: rankingDate,
  applyDates: { 900121: '2030-03-12', 900122: '2030-03-19' },
})?.appId === 900122, 'the most recent eligible apply date breaks the final tie');

const futureApplyApps = [
  { id: 900123, company: 'Tailspin Works', role: 'Platform Engineer', status: 'Applied' },
  { id: 900124, company: 'Tailspin Works', role: 'Platform Engineer', status: 'Applied' },
];
check(matchBySubject('Update from Tailspin Works', futureApplyApps, {
  emailDate: '2030-03-10T15:00:00Z',
  applyDates: { 900123: '2030-03-11', 900124: '2030-03-19' },
})?.appId === null, 'future apply dates cannot break a pre-email candidate tie');

const ambiguousApps = [
  { id: 900125, company: 'Contoso Dynamics', role: 'Product Strategist', status: 'Applied' },
  { id: 900126, company: 'Contoso Dynamics', role: 'Example Gizmo Architect', status: 'Applied' },
];
const ambiguousOptions = {
  emailDate: rankingDate,
  applyDates: { 900125: '2030-03-18', 900126: '2030-03-18' },
};
const ambiguousGuess = matchBySubject('An update from Contoso Dynamics', ambiguousApps, ambiguousOptions);
const ambiguousCandidates = candidateAppsFor('Contoso Dynamics', ambiguousApps, {
  ...ambiguousOptions,
  subject: 'An update from Contoso Dynamics',
});
check(ambiguousGuess?.appId === null && ambiguousCandidates.length === 2,
  'a true same-company tie returns no guess and lists both candidates');

const eligibleBeatsStatusApps = [
  { id: 900003, company: 'Quennox Ratchet Works', role: 'Example Pulley Director', status: 'Applied' },
  { id: 900004, company: 'Quennox Ratchet Works', role: 'Example Cog Lead', status: 'No Response' },
];
check(matchBySubject('Update from Quennox Ratchet Works', eligibleBeatsStatusApps, {
  emailDate: '2030-03-20T15:00:00Z',
  applyDates: { 900004: '2030-03-04' },
})?.appId === 900004, 'an eligible No Response row beats an Applied row with no apply date');

const noDateApp = [{ id: 900005, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'Applied' }];
const noDateRank = rankCandidateApps('Zorblax Widgetry', noDateApp, { emailDate: '2030-03-20T15:00:00Z' });
check(matchBySubject('Zorblax Widgetry application update', noDateApp, { emailDate: '2030-03-20T15:00:00Z' })?.appId === null
  && noDateRank.suggestedAppId === null,
  'a single candidate with no apply date is not suggested by subject or candidate ranking');

const futureSingle = [{ id: 900006, company: 'Quennox Ratchet Works', role: 'Example Pulley Director', status: 'Applied' }];
check(matchBySubject('Quennox Ratchet Works application update', futureSingle, {
  emailDate: '2030-03-04T15:00:00Z',
  applyDates: { 900006: '2030-03-05' },
})?.appId === null, 'a single candidate applied after the email is not suggested');

const unknownEmailDateApp = [{ id: 900007, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'Applied' }];
check(matchBySubject('Zorblax Widgetry application update', unknownEmailDateApp, {
  emailDate: 'not-a-date', applyDates: { 900007: '2030-03-04' },
})?.appId === null && matchBySubject('Zorblax Widgetry application update', unknownEmailDateApp, {
  applyDates: { 900007: '2030-03-04' },
})?.appId === null, 'an unparseable or missing email date prevents a suggestion');

const roleWinsApps = [
  { id: 900008, company: 'Quennox Ratchet Works', role: 'Example Pulley Director', status: 'Not a Fit' },
  { id: 900009, company: 'Quennox Ratchet Works', role: 'Example Sprocket Lead', status: 'Applied' },
];
check(matchBySubject('Quennox Ratchet Works update for Example Pulley Director', roleWinsApps, {
  emailDate: '2030-03-20T15:00:00Z',
  applyDates: { 900008: '2030-03-04', 900009: '2030-03-10' },
})?.appId === 900008, 'an older eligible row wins when only its role appears in the subject');

const recentWinsApps = [
  { id: 900010, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'Not a Fit' },
  { id: 900011, company: 'Zorblax Widgetry', role: 'Example Pulley Director', status: 'Applied' },
];
check(matchBySubject('Update from Zorblax Widgetry', recentWinsApps, {
  emailDate: '2030-03-20T15:00:00Z',
  applyDates: { 900010: '2030-03-04', 900011: '2030-03-10' },
})?.appId === 900011, 'the more recent eligible row wins when neither role appears in the subject');

const domainRankApps = [
  { id: 900012, company: 'Quennox Ratchet Works', role: 'Example Cog Lead', status: 'Applied' },
  { id: 900013, company: 'Quennox Ratchet Works', role: 'Example Pulley Director', status: 'No Response' },
];
check(matchByCompanyDomain('reply@quennoxratchetworks.example', domainRankApps, {
  emailDate: '2030-03-20T15:00:00Z', applyDates: { 900013: '2030-03-04' },
})?.appId === 900013, 'domain matching ranks all same-company rows instead of returning the first tracker row');

const rankedCandidates = rankCandidateApps('Quennox Ratchet Works', domainRankApps, {
  emailDate: '2030-03-20T15:00:00Z', applyDates: { 900013: '2030-03-04' },
});
check(rankedCandidates.suggestedAppId === 900013
  && rankedCandidates.candidates[0]?.id === 900013
  && rankedCandidates.candidates[0]?.applyDate === '2030-03-04'
  && rankedCandidates.candidates[1]?.applyDate === null,
  'rankCandidateApps returns ranked apply dates and the ranking suggestion');

check(matchBySubject('your Bex Systems update', subjApps, subjectMatchOptions)?.appId === 900105,
  'a short company word matches when the full token sequence is present');

const shortCore = [
  { id: 900110, company: 'Art Systems', role: 'Example Sprocket Director', status: 'Applied' },
  { id: 900111, company: 'Ion Group, Inc.', role: 'Director', status: 'Applied' },
];
const shortCoreOptions = { emailDate: '2030-03-10', applyDates: { 900110: '2030-03-04', 900111: '2030-03-04' } };
check(matchBySubject('Reminder: Your Upcoming Interview with Art Systems', shortCore, shortCoreOptions)?.appId === 900110,
  'a scheduler-sent interview reminder resolves via the full company name');
check(matchBySubject('You have an interview with Ion Group, Inc', shortCore, shortCoreOptions)?.appId === 900111,
  'a company written with its legal suffix still resolves on the full name');
check(matchBySubject('Your quarterly operations report is ready', shortCore) === null,
  'short company words do not match inside longer subject words');
check(matchBySubject('Update from Art', shortCore) === null,
  'a three-character distinctive core never matches on its own');

// scanDecisions tier-3: an ATS-sent email (no domain signal) falls through to the subject.
const atsMsg = {
  id: 'm-ats',
  payload: { headers: [{ name: 'From', value: 'no-reply@greenhouse-mail.test' }, { name: 'Subject', value: 'Update on your Kestrel application' }, { name: 'Date', value: 'Sun, 10 Mar 2030 15:00:00 +0000' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('We have decided not to move forward at this time.') } }] },
};
const decAts = scanDecisions({ messages: [atsMsg], taRows, apps: subjApps, applyDates: subjectMatchOptions.applyDates });
const atsGuess = decAts.other.find(o => o.msgId === 'm-ats');
check(atsGuess && atsGuess.companyGuess?.appId === 900103, 'scanDecisions subject-matches an ATS-sent email the domain tier cannot');
check(atsGuess && atsGuess.companyGuess?.confidence === 'subject', 'the subject-tier guess is labeled');
check(atsGuess && atsGuess.sentiment === 'negative', 'the ATS rejection is still classified negative');
check(rep && rep.threadId === 't1', 'reply decisions carry the Gmail thread id');

const gmailNoteMeta = { msgId: 'msg-note-1', threadId: 'thread-note-1', sender: 'talent@northwind.example' };
const firstNoteWrite = addNote(900127, 'Invented reply note', gmailNoteMeta);
const duplicateNoteWrite = addNote(900127, 'Duplicate invented reply note', gmailNoteMeta);
const storedGmailNotes = readAppNotes()['900127'] || [];
check(firstNoteWrite.added === true && duplicateNoteWrite.added === false && storedGmailNotes.length === 1,
  'addNote stores one entry when the same Gmail message id is logged twice');
check(storedGmailNotes[0]?.msgId === gmailNoteMeta.msgId
  && storedGmailNotes[0]?.threadId === gmailNoteMeta.threadId
  && storedGmailNotes[0]?.sender === gmailNoteMeta.sender,
  'addNote stores optional Gmail message metadata');

const crossAppMeta = { msgId: 'm900010', threadId: 't900010', sender: 'example.personone@zorblax.example' };
addNote(900020, 'First invented cross-application note', crossAppMeta);
const notesBeforeCrossAppDuplicate = fs.readFileSync(APP_NOTES_PATH, 'utf8');
const crossAppDuplicate = addNote(900021, 'Duplicate invented cross-application note', crossAppMeta);
const notesAfterCrossAppDuplicate = fs.readFileSync(APP_NOTES_PATH, 'utf8');
check(crossAppDuplicate.added === false
  && notesAfterCrossAppDuplicate === notesBeforeCrossAppDuplicate
  && findNoteByMsgId(crossAppMeta.msgId) === '900020',
  'a Gmail message id already saved under application A cannot be added under application B');

// ── fetchMessagesConcurrent: bounded-concurrency fetch ────────────────────────
const ids20 = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}` }));
let inflight = 0, peak = 0;
const getImpl = async ({ id }) => {
  inflight++; peak = Math.max(peak, inflight);
  await new Promise(r => setTimeout(r, 1));
  inflight--;
  if (id === 'id-7') throw new Error('unreadable');
  return { id };
};
const fetched = await fetchMessagesConcurrent(ids20, { accessToken: 'x', concurrency: 5, getImpl });
check(fetched.length === 19, 'fetches every id, skipping the one that throws (20 → 19)');
check(peak <= 5, `respects the concurrency cap (peak inflight ${peak} <= 5)`);
check((await fetchMessagesConcurrent([], { accessToken: 'x', getImpl })).length === 0, 'empty id list → empty result, no throw');

// ── logReplyToContact: a detected reply lands on the CONTACT's timeline ────────
// The trust bug: the reply action wrote a note on the application and flipped its
// status, but never recorded the received email on the contact's correspondence
// card, so a chased reply looked dropped. Pin that it now writes a Received entry
// and advances the contact to Replied, without regressing a further stage.
{
  const fields = ['900114', 'Acme Corp', 'Persontwo', 'Example', '', '', '', '', '', '', 'example.persontwo@example.com', '', 'Sent', '2030-07-20', '', ''];
  const rowFor = (status) => '| ' + fields.map((f, i) => i === 12 ? status : f).join(' | ') + ' |';
  const mdFor = (status) => [
    '# Target Talent', '',
    '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    rowFor(status), '',
  ].join('\n');

  fs.writeFileSync(TARGET_TALENT_MD, mdFor('Sent'));
  const before = parseTargetTalentMd().find(r => r.id === 900114);
  check(before && before.status === 'Sent', 'fixture: TA contact #900114 starts at Sent');

  const wrote = logReplyToContact(
    { source: 'ta', id: 900114, company: 'Acme Corp' },
    { subject: 'Re: Following up on the Analytics role', body: 'Thanks, but we decided to go another direction.', timestamp: 'Mon, 29 Jul 2030 10:15:00 -0400' },
  );
  check(wrote === true, 'logReplyToContact reports it wrote to the contact');

  const received = readTTCorrespondence(900114).find(m => m.direction === 'Received');
  check(!!received, 'a Received entry is written to the contact card');
  check(!!received && /Following up/.test(received.subject), 'the received entry keeps the email subject');
  check(!!received && /another direction/.test(received.body), 'the received entry keeps the email body');
  check(!!received && /^2030-07-29/.test(received.timestamp), 'the received entry is stamped with the email date, not today');

  check(parseTargetTalentMd().find(r => r.id === 900114)?.status === 'Replied', 'the contact advances Sent → Replied');

  // Never regress a further stage: a reply into a Connected contact keeps Connected.
  fs.writeFileSync(TARGET_TALENT_MD, mdFor('Connected'));
  logReplyToContact({ source: 'ta', id: 900114, company: 'Acme Corp' }, { subject: 'x', body: 'y' });
  check(parseTargetTalentMd().find(r => r.id === 900114)?.status === 'Connected', 'a reply never regresses a contact past Replied');

  // Never resurrect a terminal status: a reply into an Archived contact records
  // the correspondence but leaves them Archived (the old stage map flipped it).
  fs.writeFileSync(TARGET_TALENT_MD, mdFor('Archived'));
  const arcBefore = readTTCorrespondence(900114).length;
  logReplyToContact({ source: 'ta', id: 900114, company: 'Acme Corp' }, { subject: 'Automatic reply', body: 'ooo' });
  check(parseTargetTalentMd().find(r => r.id === 900114)?.status === 'Archived', 'a reply never resurrects an Archived contact');
  check(readTTCorrespondence(900114).length === arcBefore + 1, 'the Received entry is still recorded for an Archived contact');

  // advanceStatus:false appends the entry but leaves the status line untouched (the backfill path).
  fs.writeFileSync(TARGET_TALENT_MD, mdFor('Sent'));
  const bfBefore = readTTCorrespondence(900114).length;
  logReplyToContact({ source: 'ta', id: 900114, company: 'Acme Corp' }, { subject: 'backfilled', body: 'b', advanceStatus: false });
  check(parseTargetTalentMd().find(r => r.id === 900114)?.status === 'Sent', 'advanceStatus:false leaves status at Sent (pure correspondence insert)');
  check(readTTCorrespondence(900114).length === bfBefore + 1, 'advanceStatus:false still appends the Received entry');

  check(logReplyToContact({ source: 'ta', id: 99999 }, { subject: 's', body: 'b' }) === false, 'an unknown contact id returns false, not a throw');
  check(logReplyToContact(null, {}) === false, 'a null contact returns false');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

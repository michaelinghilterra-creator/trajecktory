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
 *   - matchAddress: exact email match to a TA or recruiter row.
 *   - scanDecisions: hard bounce → flip, soft bounce → no flip, reply routing.
 *
 * Run: node tests/google.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  getAccessToken, googleStatus, parseGmailMessage, extractEmail,
  classifyReply, matchAddress, matchByCompanyDomain, scanDecisions, tokenScopes,
  candidateAppsFor,
} from '../dashboard-web/server/lib/google.mjs';

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

// ── parseGmailMessage / extractEmail ─────────────────────────────────────────
const rawReply = {
  id: 'm-reply', threadId: 't1', snippet: 'Great to connect',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Pat Lindqvist <pat@keystone.example>' },
      { name: 'To', value: 'me@example.test' },
      { name: 'Subject', value: 'Re: Director RevOps' },
      { name: 'Date', value: 'Mon, 15 Jun 2026 09:00:00 -0500' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Great to connect. Are you available for a call next week to discuss next steps?') } },
    ],
  },
};
const pm = parseGmailMessage(rawReply);
check(pm.from === 'Pat Lindqvist <pat@keystone.example>', 'From header extracted');
check(pm.subject === 'Re: Director RevOps', 'Subject header extracted');
check(pm.text.includes('discuss next steps'), 'base64url text/plain body decoded');
check(extractEmail(pm.from) === 'pat@keystone.example', 'address pulled from a "Name <addr>" header');
check(parseGmailMessage({ id: 'x', snippet: 'hi', payload: {} }).text === 'hi', 'falls back to snippet when no body');

// ── classifyReply ────────────────────────────────────────────────────────────
check(classifyReply({ subject: 'Re: role', text: 'Can we schedule a call to discuss next steps?' }) === 'positive', 'scheduling/next-steps → positive');
check(classifyReply({ text: 'Unfortunately we have decided to move forward with other candidates.' }) === 'negative', 'rejection language → negative');
check(classifyReply({ text: 'Thanks for the note, will review and circle back.' }) === 'neutral', 'ambiguous → neutral');
check(classifyReply({ subject: 'we interviewed many strong candidates', text: 'unfortunately not a fit' }) === 'negative', 'negative wins over an interview-ish word');

// ── matchAddress ─────────────────────────────────────────────────────────────
const taRows = [{ id: 2, first: 'Reese', last: 'Calder', company: 'Northwind Robotics', email: 'reese.calder@northwind.example' }];
const recruiterRows = [{ id: 101, first: 'Pat', last: 'Lindqvist', firm: 'Keystone Search', email: 'pat@keystone.example' }];
check(matchAddress('PAT@keystone.example', { taRows, recruiterRows })?.source === 'recruiter', 'recruiter matched case-insensitively');
check(matchAddress('reese.calder@northwind.example', { taRows, recruiterRows })?.company === 'Northwind Robotics', 'TA match carries company');
check(matchAddress('nobody@unknown.example', { taRows, recruiterRows }) === null, 'unknown sender → no match');

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

const dec = scanDecisions({ messages: [hardDsn, softDsn, rawReply, unknownReply], taRows, recruiterRows });
const hard = dec.bounces.find(b => b.msgId === 'm-bounce');
check(hard && hard.kind === 'hard', 'hard DSN classified as hard');
check(hard && hard.address === 'reese.calder@northwind.example', 'bounced Final-Recipient extracted');
check(hard && hard.flip && hard.flip.source === 'ta' && hard.flip.state === 'bounced', 'hard bounce for a known contact produces a bounced flip');
const soft = dec.bounces.find(b => b.msgId === 'm-soft');
check(soft && soft.kind === 'soft', 'soft DSN classified as soft');
check(soft && soft.flip === null, 'soft bounce produces no flip (transient, never kill an address)');
const rep = dec.replies.find(r => r.msgId === 'm-reply');
check(rep && rep.contact?.source === 'recruiter' && rep.sentiment === 'positive', 'reply from a known recruiter routed with sentiment');
check(dec.other.some(o => o.msgId === 'm-other'), 'reply from an unknown sender surfaced as other, not dropped');

// ── matchByCompanyDomain (tier-2: unknown sender, known company) ──────────────
// The matcher reads the domain's ROOT label (TLD-agnostic), so .example fixtures
// exercise it exactly like real domains would. Real domains are forbidden in
// tracked tests (PII gate), and the generic-domain set is by definition real
// consumer domains, so that specific branch is covered in prod, not here.
const apps = [
  { id: 501, company: 'Northwind Robotics' },
  { id: 502, company: 'Cobalt Systems, Inc.' },
];
check(matchByCompanyDomain('careers@northwind.example', apps)?.appId === 501, 'sender domain (substring of company) → app suggested');
check(matchByCompanyDomain('careers@northwind.example', apps)?.confidence === 'medium', 'a substring match is medium confidence');
check(matchByCompanyDomain('talent@cobalt.example', apps)?.appId === 502, 'domain root matches despite an Inc./Systems suffix on the company');
check(matchByCompanyDomain('talent@cobalt.example', apps)?.confidence === 'high', 'an exact root/company-token match is high confidence');
check(matchByCompanyDomain('noreply@lever.example', apps) === null, 'an ATS mail domain (lever) is not a company match → null');
check(matchByCompanyDomain('hi@unrelated-vendor.example', apps) === null, 'a domain matching no application → null');

// scanDecisions attaches the guess to an unknown sender at a known company
const firstContact = {
  id: 'm-first',
  payload: { headers: [{ name: 'From', value: 'Talent Team <careers@northwind.example>' }, { name: 'Subject', value: 'Your application' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Thanks for applying. We would love to set up a call.') } }] },
};
const dec2 = scanDecisions({ messages: [firstContact], taRows, recruiterRows, apps });
const guessed = dec2.other.find(o => o.msgId === 'm-first');
check(guessed && guessed.companyGuess?.appId === 501, 'unknown sender at a known company carries a companyGuess to the right app');
check(guessed && guessed.sentiment === 'positive', 'the company-guessed first-contact email is still sentiment-classified');

// ── candidateAppsFor: reply → which application(s) ───────────────────────────
// Invented applications shaped like parseApplicationsMd output.
const appRows = [
  { id: 601, company: 'Northwind Robotics', role: 'RevOps Lead', status: 'Applied' },
  { id: 602, company: 'Northwind Robotics', role: 'Sales Ops Manager', status: 'Applied' },
  { id: 603, company: 'Cobalt Systems', role: 'Analytics Lead', status: 'Responded' },
];
const northwind = candidateAppsFor('Northwind Robotics', appRows);
check(northwind.length === 2, 'both roles at the same company are candidates, so the user picks which');
check(northwind.every(a => a.role && a.status), 'each candidate carries role + status for the picker');
check(candidateAppsFor('cobalt systems', appRows).length === 1 && candidateAppsFor('cobalt systems', appRows)[0].id === 603, 'case- and punctuation-insensitive match finds the single Cobalt app');
check(candidateAppsFor('Nonexistent Co', appRows).length === 0, 'a company with no application yields no candidates');
check(candidateAppsFor('', appRows).length === 0 && candidateAppsFor(null, appRows).length === 0, 'empty/null company is safe');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

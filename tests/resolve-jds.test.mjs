#!/usr/bin/env node
/**
 * resolve-jds.test.mjs — unit tests for the JD snapshot gate.
 *
 * Covers the pure logic (no network): URL → ATS descriptor parsing, HTML→text
 * decoding, portals hint extraction, pending-row tokenizing, and the pipeline
 * repoint. fetchJdText is exercised with an injected fetch stub so endpoint
 * construction and JD parsing are tested without hitting the real APIs.
 *
 * Run: node tests/resolve-jds.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { htmlToText, parsePostingUrl, fetchJdText } from '../lib/ats-jd.mjs';
import { buildHintIndex, parsePendingRow, repointPipeline } from '../resolve-jds.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('resolve-jds.test.mjs');

// ── parsePostingUrl: recognized single-posting URLs ──────────────────────────
check(eq(parsePostingUrl('https://job-boards.greenhouse.io/netbrain/jobs/5153327007'),
  { ats: 'greenhouse', board: 'netbrain', id: '5153327007' }), 'greenhouse direct board URL');
check(eq(parsePostingUrl('https://www.avetta.com/careers/job?gh_jid=7703015003'),
  { ats: 'greenhouse', id: '7703015003', needsBoard: true }), 'greenhouse gh_jid on company domain → needsBoard');
check(eq(parsePostingUrl('https://jobs.ashbyhq.com/poshmark/0d86cc2f-daea-40cf-b1d8-e704f586b21e'),
  { ats: 'ashby', slug: 'poshmark', id: '0d86cc2f-daea-40cf-b1d8-e704f586b21e' }), 'ashby posting URL');
check(eq(parsePostingUrl('https://jobs.smartrecruiters.com/experian/744000138950689'),
  { ats: 'smartrecruiters', company: 'experian', id: '744000138950689' }), 'smartrecruiters posting URL');
check(parsePostingUrl('https://jobs.lever.co/company/2b4c1d1e-1111-2222-3333-444455556666')?.ats === 'lever',
  'lever posting URL');
check(parsePostingUrl('https://8x8inc.wd5.myworkdayjobs.com/job/US-Remote/VP--Revenue-Operations_R2659')?.ats === 'workday',
  'workday /job/ URL');

// ── parsePostingUrl: NOT single-posting URLs → null ──────────────────────────
check(parsePostingUrl('https://app.eightfold.ai/careers/search') === null, 'eightfold search page → null');
check(parsePostingUrl('https://www.ontinue.com/careers/open-positions/') === null, 'ontinue listing page → null');
check(parsePostingUrl('https://careers3-powerschool.icims.com/jobs/intro') === null, 'iCIMS generic URL → null');
check(parsePostingUrl('https://job-boards.greenhouse.io/netbrain') === null, 'greenhouse board home (no /jobs/id) → null');
check(parsePostingUrl('not a url') === null, 'non-URL → null');

// ── htmlToText ───────────────────────────────────────────────────────────────
check(htmlToText('<p>Hello</p><p>World</p>') === 'Hello\nWorld', 'flattens <p> to newlines');
check(htmlToText('<ul><li>a</li><li>b</li></ul>') === '- a\n- b', 'lists become dashes');
check(htmlToText('R&amp;D &mdash; 5&#39;s') === "R&D — 5's", 'decodes entities');
check(htmlToText('<b>x</b>') === 'x', 'strips inline tags');

// ── buildHintIndex from portals.yml ──────────────────────────────────────────
const PORTALS_FIXTURE = `
tracked_companies:
  - name: Avetta, LLC
    careers_url: https://job-boards.greenhouse.io/avetta
    api: https://boards-api.greenhouse.io/v1/boards/avetta/jobs
  - name: 8x8, Inc.
    careers_url: https://8x8inc.wd5.myworkdayjobs.com/8x8_External_Careers
`;
const hints = buildHintIndex(PORTALS_FIXTURE);
check(hints.get('avetta')?.greenhouseBoard === 'avetta', 'hint: greenhouse board from portals');
check(hints.get('8x8')?.workdaySite === '8x8_External_Careers', 'hint: workday site from portals');

// ── parsePendingRow ──────────────────────────────────────────────────────────
const row = parsePendingRow('- [ ] https://x.com/j?gh_jid=9#a | Acme Co | Director, RevOps');
check(row.url === 'https://x.com/j?gh_jid=9#a' && row.company === 'Acme Co' && row.title === 'Director, RevOps',
  'parsePendingRow splits url/company/title');
check(parsePendingRow('- [x] done') === null, 'parsePendingRow ignores non-pending rows');

// ── repointPipeline: THE trailing-fragment guard ─────────────────────────────
// A naive substring replace of the URL leaves "#open-roles" / "&gh_jid=" glued to
// the new local: path. Tokenizing on " | " and swapping the whole first token
// prevents it. This test exists because that bug shipped once (manual pull).
const md = [
  '- [ ] https://www.workato.com/careers?gh_jid=8644259002#open-roles | Workato | Sales Operations Manager',
  '- [ ] https://untouched.example/x | Other | Role',
].join('\n');
const out = repointPipeline(md, new Map([
  ['https://www.workato.com/careers?gh_jid=8644259002#open-roles', 'local:jds/workato-som.md'],
]));
check(out.includes('- [ ] local:jds/workato-som.md | Workato | Sales Operations Manager'),
  'repoint replaces the whole URL token — no trailing #open-roles');
check(!/local:jds\/workato-som\.md[#&]/.test(out), 'no fragment glued to the local path');
check(out.includes('- [ ] https://untouched.example/x | Other | Role'), 'unresolved rows are left untouched');

// ── fetchJdText with an injected fetch stub (no network) ─────────────────────
const stub = (payloads) => async (url) => {
  const key = Object.keys(payloads).find(k => url.includes(k));
  return { ok: !!key, status: key ? 200 : 404, json: async () => payloads[key] };
};
const gh = await fetchJdText({ ats: 'greenhouse', board: 'netbrain', id: '1' },
  { fetchImpl: stub({ 'boards-api.greenhouse.io/v1/boards/netbrain/jobs/1': { title: 'VP RevOps', content: '<p>Lead the team</p>' } }) });
check(gh.title === 'VP RevOps' && gh.text === 'Lead the team', 'fetchJdText greenhouse: right endpoint + parsed');

let threw = false;
try { await fetchJdText({ ats: 'greenhouse', id: '1', needsBoard: true }, { fetchImpl: stub({}) }); }
catch (e) { threw = e.code === 'NEEDS_BOARD'; }
check(threw, 'fetchJdText throws NEEDS_BOARD when a gh_jid has no board hint');

const ash = await fetchJdText({ ats: 'ashby', slug: 'poshmark', id: 'uuid-1' },
  { fetchImpl: stub({ 'posting-api/job-board/poshmark': { jobs: [{ id: 'uuid-1', title: 'Dir Analytics', descriptionHtml: '<p>Own data</p>' }] } }) });
check(ash.text === 'Own data', 'fetchJdText ashby: finds posting by id on the board');

// ── done ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

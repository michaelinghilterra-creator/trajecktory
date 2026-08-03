#!/usr/bin/env node
/**
 * resolve-jds.test.mjs — unit tests for the JD snapshot gate.
 *
 * Covers the pure logic (no network): URL → ATS descriptor parsing, HTML→text
 * decoding, portals hint extraction, pending-row tokenizing, and the pipeline
 * repoint. fetchJdText is exercised with an injected fetch stub so endpoint
 * construction and JD parsing are tested without hitting the real APIs.
 *
 * All companies/slugs below are invented (Acme/Globex/Initech/Hooli/Contoso) —
 * this is a tracked, published file, so it names no real posting.
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
check(eq(parsePostingUrl('https://job-boards.greenhouse.io/acmerobotics/jobs/5100000001'),
  { ats: 'greenhouse', board: 'acmerobotics', id: '5100000001' }), 'greenhouse direct board URL');
check(eq(parsePostingUrl('https://www.contoso.example/careers/job?gh_jid=7100000001'),
  { ats: 'greenhouse', id: '7100000001', needsBoard: true }), 'greenhouse gh_jid on company domain → needsBoard');
check(eq(parsePostingUrl('https://jobs.ashbyhq.com/globex/0d86cc2f-1111-2222-3333-444455556666'),
  { ats: 'ashby', slug: 'globex', id: '0d86cc2f-1111-2222-3333-444455556666' }), 'ashby posting URL');
check(eq(parsePostingUrl('https://jobs.smartrecruiters.com/initech/744000100000001'),
  { ats: 'smartrecruiters', company: 'initech', id: '744000100000001' }), 'smartrecruiters posting URL');
check(parsePostingUrl('https://jobs.lever.co/umbrella/2b4c1d1e-1111-2222-3333-444455556666')?.ats === 'lever',
  'lever posting URL');
check(parsePostingUrl('https://hooli.wd5.myworkdayjobs.com/job/US-Remote/VP-RevOps_R1001')?.ats === 'workday',
  'workday /job/ URL');

// ── parsePostingUrl: NOT single-posting URLs → null ──────────────────────────
check(parsePostingUrl('https://app.talentcloud.example/careers/search') === null, 'unknown SPA search page → null');
check(parsePostingUrl('https://www.contoso.example/careers/open-positions/') === null, 'listing page → null');
check(parsePostingUrl('https://careers-x.icims.com/jobs/intro') === null, 'iCIMS generic URL → null');
check(parsePostingUrl('https://job-boards.greenhouse.io/acmerobotics') === null, 'greenhouse board home (no /jobs/id) → null');
check(parsePostingUrl('not a url') === null, 'non-URL → null');

// ── htmlToText ───────────────────────────────────────────────────────────────
check(htmlToText('<p>Hello</p><p>World</p>') === 'Hello\nWorld', 'flattens <p> to newlines');
check(htmlToText('<ul><li>a</li><li>b</li></ul>') === '- a\n- b', 'lists become dashes');
check(htmlToText('R&amp;D &mdash; 5&#39;s') === "R&D — 5's", 'decodes entities');
check(htmlToText('<b>x</b>') === 'x', 'strips inline tags');
check(!htmlToText('<scr<script>ipt>x</scr</script>ipt>').includes('<script'),
  'nested/crafted tags fully stripped — no residual <script (CodeQL js/incomplete-multi-character-sanitization)');
check(htmlToText('&amp;lt;') === '&lt;',
  'no double-unescape: &amp;lt; stays literal &lt; (CodeQL js/double-escaping)');

// ── buildHintIndex from portals.yml ──────────────────────────────────────────
const PORTALS_FIXTURE = `
tracked_companies:
  - name: Acme Robotics, LLC
    careers_url: https://job-boards.greenhouse.io/acmerobotics
    api: https://boards-api.greenhouse.io/v1/boards/acmerobotics/jobs
  - name: Hooli, Inc.
    careers_url: https://hooli.wd5.myworkdayjobs.com/Hooli_External_Careers
`;
const hints = buildHintIndex(PORTALS_FIXTURE);
check(hints.get('acme robotics')?.greenhouseBoard === 'acmerobotics', 'hint: greenhouse board from portals');
check(hints.get('hooli')?.workdaySite === 'Hooli_External_Careers', 'hint: workday site from portals');

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
  '- [ ] https://www.contoso.example/careers?gh_jid=8100000001#open-roles | Contoso | Sales Operations Manager',
  '- [ ] https://untouched.example/x | Other | Role',
].join('\n');
const out = repointPipeline(md, new Map([
  ['https://www.contoso.example/careers?gh_jid=8100000001#open-roles', 'local:jds/contoso-som.md'],
]));
check(out.includes('- [ ] local:jds/contoso-som.md | Contoso | Sales Operations Manager'),
  'repoint replaces the whole URL token — no trailing #open-roles');
check(!/local:jds\/contoso-som\.md[#&]/.test(out), 'no fragment glued to the local path');
check(out.includes('- [ ] https://untouched.example/x | Other | Role'), 'unresolved rows are left untouched');

// ── fetchJdText with an injected fetch stub (no network) ─────────────────────
const stub = (payloads) => async (url) => {
  const key = Object.keys(payloads).find(k => url.includes(k));
  return { ok: !!key, status: key ? 200 : 404, json: async () => payloads[key] };
};
const gh = await fetchJdText({ ats: 'greenhouse', board: 'acmerobotics', id: '1' },
  { fetchImpl: stub({ 'boards-api.greenhouse.io/v1/boards/acmerobotics/jobs/1': { title: 'VP RevOps', content: '<p>Lead the team</p>' } }) });
check(gh.title === 'VP RevOps' && gh.text === 'Lead the team', 'fetchJdText greenhouse: right endpoint + parsed');

let threw = false;
try { await fetchJdText({ ats: 'greenhouse', id: '1', needsBoard: true }, { fetchImpl: stub({}) }); }
catch (e) { threw = e.code === 'NEEDS_BOARD'; }
check(threw, 'fetchJdText throws NEEDS_BOARD when a gh_jid has no board hint');

const ash = await fetchJdText({ ats: 'ashby', slug: 'globex', id: 'uuid-1' },
  { fetchImpl: stub({ 'posting-api/job-board/globex': { jobs: [{ id: 'uuid-1', title: 'Dir Analytics', descriptionHtml: '<p>Own data</p>' }] } }) });
check(ash.text === 'Own data', 'fetchJdText ashby: finds posting by id on the board');

// ── done ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

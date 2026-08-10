#!/usr/bin/env node
/**
 * portal-additions.test.mjs — pins the single-owner writer for agent-discovered
 * companies (lib/portal-additions.mjs).
 *
 * Permanent guard for the 2026-08-10 incident: the Agent Scan could not grow
 * portals.yml (the shared eval sandbox denies writing it) and its WebSearch
 * discovery invented phantom roles. The fix moves the write to the server: the
 * agent emits a structured PORTAL_ADDITIONS block, and this module validates and
 * merges it. These tests pin the properties that make that safe — an
 * attacker-influenced entry can never become a fetched host, dead/hallucinated
 * slugs are rejected, and known companies (incl. ATS migrations) are not
 * re-added.
 *
 * Run: node tests/portal-additions.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parsePortalAdditions, sanitizeCompanyName, verifyBoardLive, mergePortalAdditions,
  START_MARKER, END_MARKER,
} from '../lib/portal-additions.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('portal-additions.test.mjs');

const wrap = (arr) => `some agent prose\n${START_MARKER}\n${JSON.stringify(arr)}\n${END_MARKER}\ntrailing summary`;

// ── parse + validate ─────────────────────────────────────────────────────────
{
  const { companies, errors } = parsePortalAdditions(wrap([
    { name: 'Acme Corp', ats: 'greenhouse', slug: 'acme' },
    { name: 'Beta', ats: 'ashby', slug: 'beta-co' },
    { name: 'Gamma', ats: 'lever', slug: 'gamma' },
  ]));
  check(companies.length === 3 && errors.length === 0, 'parses a clean 3-company block');
  check(companies[0].ats === 'greenhouse' && companies[0].slug === 'acme', 'keeps ats + slug');
}
{
  const { companies, errors } = parsePortalAdditions('no markers here at all');
  check(companies.length === 0 && errors.length === 1, 'missing block → empty + one error, never throws');
}
{
  // Fenced JSON despite instruction not to — must still parse (defense in depth).
  const fenced = `${START_MARKER}\n\`\`\`json\n${JSON.stringify([{ name: 'X', ats: 'lever', slug: 'x' }])}\n\`\`\`\n${END_MARKER}`;
  const { companies } = parsePortalAdditions(fenced);
  check(companies.length === 1, 'strips a whole-block markdown code fence');
}
{
  // The security-critical rejections.
  const { companies, errors } = parsePortalAdditions(wrap([
    { name: 'Evil', ats: 'greenhouse', slug: 'acme/../../etc' },      // path traversal in slug
    { name: 'Evil2', ats: 'greenhouse', slug: 'acme?x=1' },           // query smuggling
    { name: 'Evil3', ats: 'workday', slug: 'acme' },                  // non-scannable ATS
    { name: 'Evil4', ats: 'greenhouse', slug: '' },                   // empty slug
    { name: 'Good', ats: 'greenhouse', slug: 'good-co' },             // the one valid entry
  ]));
  check(companies.length === 1 && companies[0].slug === 'good-co', 'rejects unsafe slugs and non-ATS platforms, keeps the valid one');
  check(errors.length === 4, 'reports one error per rejected entry (nothing dropped silently)');
}
{
  // A URL is NOT accepted as identity — only ats+slug. An agent-supplied host
  // must never survive to be fetched.
  const { companies, errors } = parsePortalAdditions(wrap([{ name: 'Sneaky', careers_url: 'https://evil.example/greenhouse' }]));
  check(companies.length === 0 && errors.length === 1, 'a raw URL entry (no ats/slug) is rejected');
}

// ── name sanitization ────────────────────────────────────────────────────────
{
  check(sanitizeCompanyName('Acme, Inc. (A-LIGN) & Co') === 'Acme, Inc. (A-LIGN) & Co', 'keeps real-company punctuation');
  check(!/[\r\n]/.test(sanitizeCompanyName('Bad\nName')), 'strips newlines');
  check(!sanitizeCompanyName('# comment start').startsWith('#'), 'strips a YAML-hostile leading #');
  check(!sanitizeCompanyName('key: value').includes(':'), 'removes colons (no accidental YAML mapping)');
}

// ── verifyBoardLive (injected fetch, no network) ─────────────────────────────
{
  const ok = await verifyBoardLive('greenhouse', 'acme', { fetchImpl: async () => ({ ok: true, json: async () => ({ jobs: [1, 2, 3] }) }) });
  check(ok.live === true && ok.jobCount === 3, 'a 200 with a job list → live, with count');
  const dead = await verifyBoardLive('ashby', 'nope', { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  check(dead.live === false, 'a non-200 → dead (rejected)');
  const netErr = await verifyBoardLive('lever', 'x', { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  check(netErr.live === null, 'a network error → unknown (fails open)');
}

// ── merge into portals.yml ───────────────────────────────────────────────────
const PORTALS = `# Portal Scanner Configuration
title_filter:
  positive:
    - "Revenue Operations"
tracked_companies:
  - name: Existing Co
    careers_url: https://job-boards.greenhouse.io/existingco
    api: https://boards-api.greenhouse.io/v1/boards/existingco/jobs
    enabled: true
  - name: Migrated Co
    careers_url: https://jobs.ashbyhq.com/migratedco-new
    enabled: true
`;
function tmpPortals() {
  const dir = mkdtempSync(join(tmpdir(), 'portals-'));
  const p = join(dir, 'portals.yml');
  writeFileSync(p, PORTALS, 'utf8');
  return p;
}
const liveFetch = async () => ({ ok: true, json: async () => ({ jobs: [1] }) });

{
  const p = tmpPortals();
  const { companies } = parsePortalAdditions(wrap([{ name: 'Fresh Co', ats: 'greenhouse', slug: 'freshco' }]));
  const r = await mergePortalAdditions(p, companies, { today: '2026-08-10', fetchImpl: liveFetch });
  const after = readFileSync(p, 'utf8');
  check(r.added === 1 && after.includes('Fresh Co'), 'adds a genuinely-new company');
  // Exact-line equality, NOT a URL `.includes()` (which trips CodeQL's
  // js/incomplete-url-substring-sanitization even in a test): asserts the api line
  // was CONSTRUCTED from the slug, byte for byte.
  const expectedApiLine = 'api: https://boards-api.greenhouse.io/v1/boards/freshco/jobs';
  check(after.split('\n').some(l => l.trim() === expectedApiLine), 'CONSTRUCTS the api URL from the slug (never a supplied host)');
  check(after.includes('Existing Co') && after.includes('Migrated Co'), 'leaves existing entries intact');
}
{
  // Already tracked by slug → skipped as duplicate, file unchanged.
  const p = tmpPortals();
  const before = readFileSync(p, 'utf8');
  const { companies } = parsePortalAdditions(wrap([{ name: 'Existing Co', ats: 'greenhouse', slug: 'existingco' }]));
  const r = await mergePortalAdditions(p, companies, { today: '2026-08-10', fetchImpl: liveFetch });
  check(r.added === 0 && r.skippedDuplicate === 1, 'a slug already tracked is skipped as duplicate');
  check(readFileSync(p, 'utf8') === before, 'no write when nothing new');
}
{
  // Same NAME, different board (ATS migration shape) → surfaced as a collision,
  // never silently added.
  const p = tmpPortals();
  const { companies } = parsePortalAdditions(wrap([{ name: 'Migrated Co', ats: 'greenhouse', slug: 'migratedco-old' }]));
  const r = await mergePortalAdditions(p, companies, { today: '2026-08-10', fetchImpl: liveFetch });
  check(r.added === 0 && r.collisions.length === 1, 'a name-match on a different board is a surfaced collision, not an add');
  check(r.collisions[0].existing === 'Migrated Co', 'the collision names the existing entry');
}
{
  // A hallucinated slug whose board 404s → rejected, not parked as a dead entry.
  const p = tmpPortals();
  const deadFetch = async () => ({ ok: false, json: async () => ({}) });
  const { companies } = parsePortalAdditions(wrap([{ name: 'Phantom Co', ats: 'greenhouse', slug: 'phantomco' }]));
  const r = await mergePortalAdditions(p, companies, { today: '2026-08-10', fetchImpl: deadFetch });
  check(r.added === 0 && r.skippedDead === 1, 'a dead/hallucinated board is rejected, not added');
  check(!readFileSync(p, 'utf8').includes('Phantom Co'), 'the phantom company never reaches portals.yml');
}
{
  // Two new companies where one shares a slug within the same run → second is a
  // dupe against the first (intra-run dedupe).
  const p = tmpPortals();
  const { companies } = parsePortalAdditions(wrap([
    { name: 'Dup A', ats: 'lever', slug: 'dupco' },
    { name: 'Dup B', ats: 'lever', slug: 'dupco' },
  ]));
  const r = await mergePortalAdditions(p, companies, { today: '2026-08-10', fetchImpl: liveFetch });
  check(r.added === 1 && r.skippedDuplicate === 1, 'same slug twice in one run adds once, dedupes the second');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

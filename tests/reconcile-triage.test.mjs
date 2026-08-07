#!/usr/bin/env node
/**
 * reconcile-triage.test.mjs — pins the pipeline.md ↔ triage-results.tsv
 * reconciliation matcher.
 *
 * Formalizes matching logic built ad hoc during the 2026-08-06 mass-triage
 * session: triage never checks off a pipeline row (by design), so an
 * already-scored role sits open forever unless something reconciles it. Four
 * real representation-drift shapes were found and fixed that day (see
 * lib/reconcile-triage.mjs's header for the full story) — this test pins each
 * one so a future edit can't silently regress it.
 *
 * Run: node tests/reconcile-triage.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { buildTriageIndex, buildTrackedIdIndex, alreadyHandledByTriage } from '../lib/reconcile-triage.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('reconcile-triage.test.mjs');

const TRIAGE_TSV = [
  'url\tcompany\ttitle\tscore\trationale\tdate',
  'https://job-boards.greenhouse.io/acme/jobs/1\tAcme\tDirector, RevOps\t3.5\tgood fit\t2026-08-06',
  'local:jds/globex-head-of-gtm-ai.md\tGlobex\tChief Widget Wrangling Officer\t3.7\tsolid\t2026-08-06',
  'https://x.example/umbrella-corp-cfo-role\tUmbrella Corp\tChief Financial Officer - Regional\t0.5\tno\t2026-08-06',
].join('\n');

const APPLICATIONS_MD = [
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 4200 | 2026-07-29 | Contoso | Director, GTM Ops | 4.4/5 | Applied | ❌ | — | [4200](reports/4200-contoso-2026-07-29.md) | note | https://x.example/4200 |',
].join('\n');

const triageIndex = buildTriageIndex(TRIAGE_TSV);
const trackedIds = buildTrackedIdIndex(APPLICATIONS_MD);

// ── buildTriageIndex ─────────────────────────────────────────────────────
check(triageIndex.urls.has('https://job-boards.greenhouse.io/acme/jobs/1'), 'indexes the exact scored URL');
check(triageIndex.keys.has('acme::director, revops'), 'indexes company::title lowercase key');
check(triageIndex.titles.has('chief widget wrangling officer'), 'indexes title alone');

// ── buildTrackedIdIndex ──────────────────────────────────────────────────
check(trackedIds.has('4200'), 'extracts tracker row id from applications.md');
check(!trackedIds.has('9999'), 'does not invent an id that is not present');

// ── alreadyHandledByTriage: layer 1, exact URL ───────────────────────────
{
  const row = { url: 'https://job-boards.greenhouse.io/acme/jobs/1', rest: ' | Acme | Director, RevOps' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === 'exact URL already in triage-results.tsv', 'exact URL match is the strongest, first-checked signal');
}

// ── layer 2: exact company+title, survives a DIFFERENT url (the
// resolve-jds.mjs repoint-after-scoring shape from the real incident) ────
{
  const row = { url: 'local:jds/acme-director-revops.md', rest: ' | Acme | Director, RevOps' };
  const reason = alreadyHandledByTriage(row, { triageIndex, trackedIds });
  check(reason === 'exact company+title match', 'company+title match survives a URL that differs from the one it was originally scored under');
}
{
  // A DIFFERENT role at the same company must NOT be treated as covered —
  // matching on company name alone silently ate a genuinely different,
  // unscored posting during the 2026-08-06 session (real company names
  // withheld here; the shape of the bug is what matters, not who it hit).
  const row = { url: 'local:jds/acme-vp-sales.md', rest: ' | Acme | VP, Sales' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === null, 'a different title at an already-scored company is NOT falsely matched');
}

// ── layer 3: blank-company numbered-batch rows, title embeds company ────
{
  const row = { url: 'local:jds/1200-globex.md', rest: ' | | Chief Widget Wrangling Officer' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === 'exact title match (company field blank)', 'blank-company row matches on exact title alone');
}
{
  const row = { url: 'local:jds/1201-globex.md', rest: ' | | Chief Widget Wrangling Officer — Globex' };
  const reason = alreadyHandledByTriage(row, { triageIndex, trackedIds });
  check(reason === 'title substring match (company embedded in title text)', 'blank-company row with company embedded IN the title text matches via substring');
}
{
  const row = { url: 'local:jds/1202-globex.md', rest: ' | | Globex — Chief Widget Wrangling Officer' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) !== null, 'substring match works with the company prefix on either side of the title');
}
{
  // Guard: a short generic title must not substring-match everything.
  const row = { url: 'local:jds/1203-x.md', rest: ' | | Manager' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === null, 'a short generic title does not false-positive via substring matching');
}

// ── layer 4: filename-embedded tracker id (fully evaluated in an earlier
// session, pipeline row never checked off) ───────────────────────────────
{
  const row = { url: 'local:jds/4200-contoso.md', rest: ' | | 4200-contoso' };
  const reason = alreadyHandledByTriage(row, { triageIndex, trackedIds });
  check(reason === 'tracker row #4200 already exists in applications.md', 'a numbered pipeline row whose id already has a tracker entry is recognized as fully handled');
}
{
  const row = { url: 'local:jds/9999-unknown.md', rest: ' | | 9999-unknown' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === null, 'an unmatched numbered id (no tracker row) is correctly left open');
}

// ── a genuinely new, unscored role is never falsely matched ─────────────
{
  const row = { url: 'https://brandnew.example/job/1', rest: ' | Brand New Co | Totally Fresh Role' };
  check(alreadyHandledByTriage(row, { triageIndex, trackedIds }) === null, 'a genuinely new posting under every signal returns null (never false-positive)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * no-real-postings.test.mjs — no tracked file may disclose a posting the user
 * actually evaluated.
 *
 * WHY verify-no-pii.mjs IS NOT ENOUGH:
 * That gate covers owner identity, third-party contacts, compensation and career
 * figures. Employers and job titles are deliberately outside it, so it returns 0
 * on a fixture containing a real company and a real job title. An audit found
 * test fixtures matching real tracker rows verbatim in files that had passed
 * every gate for months, because fixtures get written to look plausible and a
 * plausible job title in the user's own field IS one of the user's job titles.
 *
 * WHAT COUNTS AS DISCLOSURE, AND WHAT DOES NOT:
 * A job title on its own usually discloses nothing. The ordinary titles of the
 * user's field appear throughout this product — in its mock data, its starter
 * config, its mode docs — because that is the KIND of job the tool exists to
 * find, and thousands of employers post the same words. Flagging those would
 * mean flagging the product's own subject matter, and a check that fires on 60
 * legitimate lines is a check people switch off.
 *
 * (No example is quoted here on purpose. The first draft of this comment used a
 * real title from the tracker as its illustration of a harmless one, inside the
 * file written to stop exactly that. A rule against quoting a leak will quote
 * the leak if you let it.) Two things do disclose:
 *
 *   1. A PAIR. One file containing both the employer AND the job title from the
 *      SAME tracker row is that row, restated. Unambiguous.
 *   2. A DISTINCTIVE TITLE. A title carrying content beyond the user's own
 *      target-role vocabulary is specific to one posting rather than generic to
 *      the field, so a verbatim match is not coincidence.
 *
 * HOW IT AVOIDS BECOMING THE LEAK:
 * Real values are read at RUN time from data/applications.md, and the vocabulary
 * that decides "generic" is read from portals.yml. Both are gitignored, so
 * nothing real is committed here, and on a fresh clone the suite skips rather
 * than blocking a contributor over data they do not have.
 *
 * There is deliberately no hardcoded ignore list either. Such a list would name
 * the employers it excuses, which is the exact disclosure being prevented.
 *
 * FAILURE OUTPUT IS MASKED, because CI logs on a public repo are public. It
 * prints file, line and category. Run it locally to see the value.
 *
 * Run: node tests/no-real-postings.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
const check = (cond, msg, detail) => {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); if (detail) for (const d of detail) console.log(`       ${d}`); failed++; }
};
const skip = (why) => {
  console.log(`\n  ⏭️  ${why}`);
  console.log('\n🟢 no-real-postings: skipped');
  process.exit(0);
};

const APPS = join(ROOT, 'data/applications.md');
if (!existsSync(APPS)) skip('no data/applications.md — nothing to compare against (expected on a fresh clone)');

// ── The real rows, read at run time and never written down ──────────────────
const rows = [];
for (const line of readFileSync(APPS, 'utf-8').split('\n')) {
  if (!line.startsWith('|')) continue;
  const c = line.split('|').map((s) => s.trim());
  if (c.length < 10 || !/^\d+$/.test(c[1])) continue;
  if (c[3] && c[4]) rows.push({ company: c[3], role: c[4] });
}
if (!rows.length) skip('tracker has no rows yet');

// ── The user's own target-role vocabulary, from their config ────────────────
// A title built only from these phrases describes the field, not a posting.
const vocab = new Set();
for (const src of ['portals.yml', 'templates/portals.example.yml']) {
  const p = join(ROOT, src);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf-8');
  const block = text.slice(text.indexOf('positive:'), text.indexOf('negative:'));
  for (const m of block.matchAll(/^\s*-\s*["']?([^"'\n#]+)/gm)) {
    for (const w of m[1].toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) if (w.length > 2) vocab.add(w);
  }
}
// Seniority words carry no information about WHICH posting a title refers to.
for (const w of ['director', 'senior', 'staff', 'principal', 'lead', 'head', 'chief', 'manager',
  'vice', 'president', 'associate', 'junior', 'intern', 'remote', 'hybrid', 'onsite']) vocab.add(w);

const content = (title) => title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !vocab.has(w));
// Distinctive titles only: those with content the user's own vocabulary does not
// already describe.
const distinctive = new Map();
for (const r of rows) if (r.role.length >= 12 && content(r.role).length > 0) distinctive.set(r.role, r.company);

// ── The files that actually ship ────────────────────────────────────────────
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => /\.(mjs|jsx|js|md|json|yml|yaml|html|ps1|iss|txt)$/i.test(f));
} catch { skip('not a git checkout — cannot determine which files ship'); }

const SELF = 'tests/no-real-postings.test.mjs';
const mask = (v) => (v.length <= 6 ? '******' : `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

const pairHits = [], titleHits = [];
for (const rel of tracked) {
  if (rel === SELF) continue;
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf-8'); } catch { continue; }

  // 1. Employer AND its own role on the SAME LINE: that row, restated.
  //
  // Same line, not merely same file. A file of mock rows mentions many employers
  // and many titles, and pairing every one against every other reports a leak
  // whenever some row borrows an employer and some other row borrows a title —
  // which fired on exactly that shape the first time this ran. A restated row is
  // the two together.
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const r of rows) {
      if (r.company.length < 4 || r.role.length < 8) continue;
      if (!line.includes(r.role)) continue;
      if (!new RegExp(`\\b${esc(r.company)}\\b`).test(line)) continue;
      pairHits.push(`${rel}:${i + 1}  [PAIR] ${mask(r.company)} + ${mask(r.role)}`);
    }
  });
  // 2. A title specific enough that a verbatim match is not coincidence.
  for (const [role] of distinctive) {
    const i = text.indexOf(role);
    if (i !== -1) titleHits.push(`${rel}:${lineOf(text, i)}  [DISTINCTIVE TITLE] ${mask(role)}`);
  }
}

console.log(`\n  compared ${tracked.length} tracked files against ${rows.length} tracker rows`);
console.log(`  (${distinctive.size} titles judged distinctive; the rest are generic to the field)`);
check(pairHits.length === 0, 'no tracked file restates an employer together with its job title', pairHits);
check(titleHits.length === 0, 'no tracked file contains a distinctive real job title', titleHits);

console.log(`\n${failed === 0 ? '🟢' : '🔴'} no-real-postings: ${passed} passed, ${failed} failed`);
if (failed) console.log('   Run locally to see the values. Replace them with invented content.');
process.exit(failed === 0 ? 0 : 1);

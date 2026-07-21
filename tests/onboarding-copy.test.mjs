#!/usr/bin/env node
// Guards the onboarding explainer copy in dashboard-web/src/launchpad.jsx.
//
// A first-install session produced the same four questions at nearly every step:
// "What does this do?", "Why do I have to do this?", "How does this help me?",
// and "So what?" The copy at the time answered at most the first, in language
// like "Confirms Node, dependencies, Playwright, and the data folders are in
// place" and "the single biggest lever on evaluation quality".
//
// Prose rots one edit at a time and nobody notices, so the standard is a test:
//
//   1. STRUCTURE  every section carries all four fields, and a valid score badge.
//   2. JARGON     the specific words that failed in that session stay out.
//   3. READING    Flesch-Kincaid grade level stays at or below MAX_GRADE.
//
// On (3): the goal stated in the feedback was "5th grade so everyone
// understands". Literal grade 5 is achievable for a single sentence but not
// across copy that has to stay specific — "Two jobs can look the same on paper"
// is about grade 6 and does real work that its grade-5 rewrite does not. So the
// GATE is 6 and the AIM is 5, which is an honest place to draw the line rather
// than a promise the copy would quietly break.
//
// FK is implemented here rather than pulled in, both to keep the repo
// dependency-free and because the formula is short enough to read.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'dashboard-web/src/launchpad.jsx');

const MAX_GRADE = 6;

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

// ── Flesch-Kincaid grade level ───────────────────────────────────────────────
// 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // Strip silent endings before counting vowel groups; keep a floor of 1 so a
  // word never scores zero and deflates the whole passage.
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function fkGrade(text) {
  const sentences = (text.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

// ── Pull the copy out of the source ──────────────────────────────────────────
// Parsing the literals beats importing: launchpad.jsx is JSX with no exports and
// attaches itself to `window`, so it cannot be imported by a node test.
const src = readFileSync(SRC, 'utf8');

function extractEntries(arrayName) {
  const start = src.indexOf(`const ${arrayName} = [`);
  if (start === -1) return [];
  // Walk to the matching close bracket so a nested array cannot end it early.
  let i = src.indexOf('[', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (!depth) { end = i; break; } }
  }
  const body = src.slice(start, end);
  // Entries close with `' },` on the same line as their last field, so slice on
  // the entry STARTS rather than trying to match a closing brace.
  const starts = [...body.matchAll(/^ {2}\{ id: '([^']+)'/gm)].map(m => ({ id: m[1], at: m.index }));
  return starts.map((s, i) => {
    const rest = body.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : body.length);
    const field = (name) => {
      const fm = rest.match(new RegExp(`\\b${name}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
      return fm ? fm[1].replace(/\\'/g, "'") : null;
    };
    return { id: s.id, does: field('does'), sowhat: field('sowhat'),
             affectsScore: field('affectsScore'), ifYouSkip: field('ifYouSkip') };
  });
}

const sections = extractEntries('LP_SECTIONS');
const optional = extractEntries('LP_OPTIONAL');
const all = [...sections, ...optional];

console.log('\n🧪 onboarding copy\n');
console.log('1. Extraction');
check(sections.length === 11, `found all 11 sections (got ${sections.length})`);
check(optional.length === 7, `found all 7 optional boosters (got ${optional.length})`);

console.log('\n2. Structure — every entry answers all four questions');
const VALID_SCORE = ['yes', 'no', 'filter'];
for (const e of all) {
  const missing = ['does', 'sowhat', 'affectsScore', 'ifYouSkip'].filter(f => !e[f]);
  check(missing.length === 0, `${e.id}: has does/sowhat/affectsScore/ifYouSkip${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
}
for (const e of all) {
  check(VALID_SCORE.includes(e.affectsScore), `${e.id}: affectsScore is yes|no|filter (got "${e.affectsScore}")`);
}

console.log('\n3. Jargon — the words that actually confused a first-time user');
// Every term here failed in a real session. Add to this list, do not remove from
// it: a word only earns a place after it has demonstrably cost someone.
const BANNED = [
  'Node', 'Playwright', 'dependencies', 'geo filter', 'scanner exclusions',
  'lever on evaluation quality', 'workflow step', 'match quality', 'YAML',
  'API endpoint', 'stamped onto',
];
for (const e of all) {
  const blob = `${e.does} ${e.sowhat} ${e.ifYouSkip}`;
  const hits = BANNED.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(blob));
  check(hits.length === 0, `${e.id}: no jargon${hits.length ? ` (found: ${hits.join(', ')})` : ''}`);
}

console.log(`\n4. Reading level — Flesch-Kincaid grade <= ${MAX_GRADE}`);
for (const e of all) {
  const blob = [e.does, e.sowhat, e.ifYouSkip].filter(Boolean).join(' ');
  const g = fkGrade(blob);
  check(g <= MAX_GRADE, `${e.id}: grade ${g.toFixed(1)}`);
}

const overall = fkGrade(all.map(e => [e.does, e.sowhat, e.ifYouSkip].join(' ')).join(' '));
console.log(`\n  Overall onboarding copy grade level: ${overall.toFixed(1)}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

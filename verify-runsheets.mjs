#!/usr/bin/env node
// verify-runsheets.mjs - validate runsheet-v1 sidecars against templates/runsheet-schema-v1.md
//
//   node verify-runsheets.mjs            # all *.run.md under interview-prep/
//   node verify-runsheets.mjs --json     # machine-readable
//
// Checks the FRONTMATTER, never the prose. Deliberately mirrors verify-reports.mjs's
// role, but does NOT clone its structure: that script probes legacy markdown headings,
// which for a v1 file always come back empty, so it reports a green light that means
// nothing. This one fails loudly on structure instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREP_DIR = path.resolve(__dirname, 'interview-prep');
const BANK = path.join(PREP_DIR, 'story-bank.md');
const SCHEMA_ID = 'trajecktory-runsheet/v1';

const CAP_CUES = 48;
const CAP_SECTIONS = 8;
// tag must not assert anything the renderer derives
const DERIVABLE_IN_TAG = /\b(\d+\s*homes?|use once|hero\b|round \d|1st|2nd|3rd|4th interview)\b/i;

const jsonMode = process.argv.includes('--json');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith('.run.md')) out.push(full);
  }
  return out;
}

// Story ids are H3s in the bank: "### 12. [Theme] Title"
function bankIds() {
  if (!fs.existsSync(BANK)) return null;
  const ids = new Set();
  for (const line of fs.readFileSync(BANK, 'utf8').split('\n')) {
    const m = line.match(/^###\s+(\d+)\./);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

function check(file, ids) {
  const errs = [];
  const warns = [];
  const raw = fs.readFileSync(file, 'utf8');

  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { errs: ['No JSON frontmatter (expected --- ... --- at the top).'], warns };

  let d;
  try {
    d = JSON.parse(m[1]);
  } catch (err) {
    return { errs: [`Frontmatter is not valid JSON: ${err.message}`], warns };
  }

  // exact match, never a regex: a v2 file must not validate as v1
  if (d.schema !== SCHEMA_ID) errs.push(`schema is "${d.schema}", expected exactly "${SCHEMA_ID}".`);

  for (const [f, t] of [['id', 'number'], ['company', 'string'], ['role', 'string'],
                        ['stage', 'string'], ['round', 'number'], ['template', 'string'],
                        ['prep', 'string'], ['generated', 'string']]) {
    if (d[f] === undefined) errs.push(`missing required field "${f}".`);
    else if (typeof d[f] !== t) errs.push(`"${f}" must be ${t}, got ${typeof d[f]}.`);
  }
  if (d.template && !['screen', 'hm-round', 'final-loop'].includes(d.template))
    errs.push(`template "${d.template}" is not screen|hm-round|final-loop.`);
  if (d.generated && !/^\d{4}-\d{2}-\d{2}$/.test(d.generated))
    errs.push(`generated "${d.generated}" is not YYYY-MM-DD.`);

  const sections = Array.isArray(d.sections) ? d.sections : [];
  const answers = d.answers && typeof d.answers === 'object' ? d.answers : {};
  if (!sections.length) errs.push('sections[] is empty.');
  if (!Object.keys(answers).length) errs.push('answers{} is empty.');

  const cues = sections.flatMap(s => (s.cues || []).map(c => ({ ...c, section: s.id })));

  // referential integrity, both directions
  const reached = new Set();
  for (const c of cues) {
    if (!answers[c.answer]) errs.push(`cue "${c.cue}" points at missing answer "${c.answer}".`);
    else reached.add(c.answer);
  }
  for (const k of Object.keys(answers))
    if (!reached.has(k)) errs.push(`answer "${k}" is an ORPHAN, reachable by no cue.`);

  // the net
  const panic = sections.filter(s => s.style === 'panic');
  if (panic.length === 0) errs.push('no style:"panic" section. Every board needs the blank-recovery net.');
  if (panic.length > 1) errs.push(`${panic.length} panic sections, expected exactly 1.`);
  if (d.fallbacks) errs.push('fallbacks[] is retired. The panic SECTION is the net (see schema).');

  // caps
  if (cues.length > CAP_CUES) errs.push(`${cues.length} cues exceeds the ${CAP_CUES} cap. It will scroll.`);
  if (sections.length > CAP_SECTIONS) errs.push(`${sections.length} sections exceeds the ${CAP_SECTIONS} cap.`);

  // hero
  const heroes = Object.keys(answers).filter(k => answers[k].hero);
  if (heroes.length > 1) errs.push(`${heroes.length} answers set hero:true, at most 1 allowed.`);
  if (d.template === 'screen' && heroes.length)
    warns.push('a screen board with a hero: the hero usually belongs to the next round.');

  for (const [k, a] of Object.entries(answers)) {
    if (!Array.isArray(a.spoken) || !a.spoken.length) errs.push(`answer "${k}" has no spoken[].`);
    const blob = JSON.stringify([a.spoken, a.notes]);
    if (/<\/?(b|strong|i|em)>/i.test(blob)) errs.push(`answer "${k}" has raw HTML in spoken/notes. Use **markdown**.`);
    if (a.tag && DERIVABLE_IN_TAG.test(a.tag))
      errs.push(`answer "${k}" tag "${a.tag}" asserts a derivable fact. The renderer computes it.`);
    if (a.story != null) {
      if (!Number.isInteger(a.story)) errs.push(`answer "${k}" story must be an integer.`);
      else if (ids && !ids.has(a.story)) errs.push(`answer "${k}" story #${a.story} does not resolve in story-bank.md.`);
    }
  }

  return { errs, warns, stats: { cues: cues.length, answers: Object.keys(answers).length, sections: sections.length } };
}

const ids = bankIds();
const files = walk(PREP_DIR);
const results = files.map(f => ({ file: path.relative(PREP_DIR, f), ...check(f, ids) }));
const failed = results.filter(r => r.errs.length);

if (jsonMode) {
  console.log(JSON.stringify({ ok: !failed.length, checked: results.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

if (!files.length) {
  console.log('No .run.md files found under interview-prep/.');
  process.exit(0);
}
if (!ids) console.log('⚠️  story-bank.md not found, skipping story-id resolution.\n');

for (const r of results) {
  const tag = r.errs.length ? '❌' : r.warns.length ? '⚠️ ' : '✅';
  const s = r.stats ? ` (${r.stats.cues} cues, ${r.stats.answers} answers, ${r.stats.sections} sections)` : '';
  console.log(`${tag} ${r.file}${s}`);
  r.errs.forEach(e => console.log(`     ERROR: ${e}`));
  r.warns.forEach(w => console.log(`     warn:  ${w}`));
}

console.log('\n' + '='.repeat(50));
console.log(`📊 Run sheets: ${results.length - failed.length}/${results.length} valid`);
console.log(failed.length ? '🔴 Fix the errors above before rendering.' : '🟢 All run sheets valid.');
process.exit(failed.length ? 1 : 0);

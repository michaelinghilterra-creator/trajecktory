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

// The shipped worked examples. They are TRACKED, they are what every generated board
// is copied from, and until they were added here nothing checked them: this script
// walked interview-prep/ only, which is gitignored, so CI validated zero files and
// passed. A schema drift in the files the mode tells the agent to imitate would have
// shipped green.
//
// There is one per SHAPE, and that is the point. When only the hm-round example
// existed, every claim the docs made about the `screen` shape had to be measured off
// a real board in the author's gitignored interview-prep/, because it was the only
// screen board in existence. Documentation sourced from a private file cannot be
// checked by anyone else and quietly leaks whatever it measured. A shape with no
// shipped example is a shape whose spec is unverifiable.
//
// They are checked for STRUCTURE ONLY. Their `story` ids point at the fictional bank
// in their own prose, not at the user's story-bank.md.
const EXAMPLES = [
  path.resolve(__dirname, 'templates', 'runsheet-example.run.md'),
  path.resolve(__dirname, 'templates', 'runsheet-example-screen.run.md'),
];

// `stage` is what the dashboard picker matches a board on, so a value outside the
// canonical ladder produces a board that validates clean and is then never found.
// Silent, and invisible until the morning of the call. Read the labels out of
// templates/states.yml rather than retyping them, so the retired generic "Interview"
// cannot come back and a new rung is picked up for free. Parsed with a line regex,
// not js-yaml, to keep this script dependency-free like the rest of the verifiers.
function canonicalStages() {
  const file = path.resolve(__dirname, 'templates', 'states.yml');
  try {
    const txt = fs.readFileSync(file, 'utf-8');
    const labels = [...txt.matchAll(/^\s*label:\s*(.+?)\s*$/gm)].map(m => m[1].replace(/^["']|["']$/g, ''));
    const stages = labels.filter(l => /^(Phone Screen|\dst Interview|\dnd Interview|\drd Interview|\dth Interview)$/.test(l));
    return stages.length ? stages : null;
  } catch { return null; }
}
const STAGES = canonicalStages();

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

  // \r?\n, not \n: git checks tracked files out as CRLF wherever core.autocrlf is
  // on, which is the Windows default and this project's primary platform. An
  // LF-only anchor reports "No JSON frontmatter" for a file whose frontmatter is
  // perfectly well formed. CI runs on Linux and checks out LF, so this failed on
  // Windows only and would never have shown up in a green pipeline.
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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
  if (STAGES && typeof d.stage === 'string' && !STAGES.includes(d.stage))
    errs.push(`stage "${d.stage}" is not a canonical status. Expected one of: ${STAGES.join(', ')}. The picker matches on this, so a non-canonical value renders a board nothing can find.`);
  if (!STAGES) warns.push('templates/states.yml unreadable, so "stage" was not checked against the canonical ladder.');
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
const userFiles = walk(PREP_DIR);
const examples = EXAMPLES.filter(p => fs.existsSync(p));

// Story-id resolution is a USER-file check. Running it against the shipped example
// would tie a tracked file's pass/fail to a gitignored one: green on a machine whose
// bank happens to hold every id the example cites, red on one whose bank is
// shorter, and skipped entirely in CI where interview-prep/ does not exist. Three
// different verdicts for one unchanged file. The example gets null.
const targets = [
  ...examples.map(p => ({ path: p, ids: null, label: path.relative(__dirname, p) })),
  ...userFiles.map(f => ({ path: f, ids, label: path.relative(PREP_DIR, f) })),
];

const results = targets.map(t => ({ file: t.label, ...check(t.path, t.ids) }));
const failed = results.filter(r => r.errs.length);

if (jsonMode) {
  console.log(JSON.stringify({ ok: !failed.length, checked: results.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

if (!targets.length) {
  console.log('No .run.md files found, and the shipped examples in templates/ are missing.');
  process.exit(0);
}
// Only meaningful when there are user files to resolve ids for; the example never
// resolves them by design.
if (!ids && userFiles.length) console.log('⚠️  story-bank.md not found, skipping story-id resolution.\n');
if (!userFiles.length) console.log('No .run.md files under interview-prep/ yet — checking the shipped examples only.\n');

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

#!/usr/bin/env node
/**
 * verify-release-notes.mjs — check a release body against the house format in
 * docs/RELEASING.md ("Release notes: the house format").
 *
 * WHY A CHECK AND NOT A CHECKLIST ITEM:
 * The existing Release health workflow already catches the two ways notes fail
 * loudly: an empty body, and a body still holding the raw Release Please
 * changelog. Neither covers the way they fail QUIETLY, which is a body that was
 * genuinely written but drifted from the format. RELEASING.md names the drift
 * itself: "Terse developer bullet points are the recurring regression here, and
 * they are the one thing to check before publishing." A recurring regression
 * that a human is asked to check before publishing is the definition of
 * something to automate.
 *
 * The stakes are not cosmetic. The dashboard renders this body in Setup →
 * Change Log and in the update banner, so it is read by someone deciding
 * whether to accept an update. A missing Install block leaves anyone who does
 * not already have trajecktory with no way to install it, and an installer
 * pointer naming the wrong tag sends them to a download that does not exist.
 *
 * TWO MODES, BECAUSE ONE RULE CANNOT RUN IN CI:
 *   --file <path>   lint a draft before publishing (local)
 *   --tag <vX.Y.Z>  lint a published release (local or CI)
 *
 * The structural rules run in both. The rule against naming a real company,
 * person or figure from the maintainer's own job search can ONLY run locally,
 * because it needs data/applications.md and config/profile.yml, which are
 * gitignored and never reach a CI runner. Running it there would pass
 * vacuously, and a check that cannot fail is worse than no check: it reads as
 * coverage. So it is skipped explicitly, and says that it skipped.
 *
 * Usage:
 *   node verify-release-notes.mjs --file notes.md
 *   node verify-release-notes.mjs --tag v1.23.1
 *   node verify-release-notes.mjs                  # newest release
 *
 * Exit code: 0 clean, 1 one or more rules broken.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`verify-release-notes.mjs — check a release body against docs/RELEASING.md

  node verify-release-notes.mjs --file <path>   lint a draft before publishing
  node verify-release-notes.mjs --tag <vX.Y.Z>  lint a published release
  node verify-release-notes.mjs                 lint the newest release`);
  process.exit(0);
}

const problems = [];
const notes = [];
const fail = (rule, detail, fix) => problems.push({ rule, detail, fix });

// ── Load the body ────────────────────────────────────────────────────────────
const file = argOf('--file');
let tag = argOf('--tag');
let body = '';
let source = '';

if (file) {
  if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }
  body = readFileSync(file, 'utf-8');
  source = file;
} else {
  try {
    if (!tag) {
      tag = execFileSync('git', ['tag', '-l', 'v*'], { cwd: ROOT, encoding: 'utf-8' })
        .split('\n').map((s) => s.trim()).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    }
    if (!tag) { console.log('No version tags yet — nothing to check.'); process.exit(0); }
    body = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--json', 'body'], { cwd: ROOT, encoding: 'utf-8' })).body || '';
    source = tag;
  } catch {
    console.error('Could not read the release body. Pass --file <path>, or check that gh is installed and authenticated.');
    process.exit(1);
  }
}

const lines = body.split('\n');
const firstReal = lines.find((l) => l.trim().length) || '';

// ── 1. Opens with prose, not a heading ───────────────────────────────────────
// The reader sees this first, inside the app. A heading first means the body is
// structured like a changelog rather than addressed to anyone.
if (/^#{1,6}\s/.test(firstReal.trim())) {
  fail('opening paragraph', 'the body opens with a heading',
    'Start with one or two sentences characterising the release ("Data integrity release.", "Maintenance release."), what it addresses, and whether it is recommended.');
}
if (/^##\s+\[\d+\.\d+\.\d+\]\(.*\/compare\//.test(firstReal.trim())) {
  fail('auto-generated body', 'this is still the raw Release Please changelog',
    'Rewrite it per docs/RELEASING.md. The Change Log tab and the update banner render this text.');
}

// ── 2. The Install (Windows) block ───────────────────────────────────────────
// RELEASING.md: "It is not optional and it is not generated." Most releases
// carry no installer, so this block is the only install path a new user has.
const hasInstall = /^##\s+Install \(Windows\)\s*$/m.test(body);
if (!hasInstall) {
  fail('Install (Windows)', 'the block is missing',
    'Paste it verbatim from docs/RELEASING.md, immediately after the opening paragraph. Without it, anyone who does not already have trajecktory has no way to install.');
} else {
  if (!/\*\*Already installed\?\*\*/.test(body)) {
    fail('Install (Windows)', 'no "Already installed?" paragraph', 'Copy the whole block verbatim from docs/RELEASING.md.');
  }
  if (!/\*\*New install\?\*\*/.test(body)) {
    fail('Install (Windows)', 'no "New install?" paragraph', 'Copy the whole block verbatim from docs/RELEASING.md.');
  }
}

// ── 3. The installer pointer names a tag that really has one ─────────────────
// RELEASING.md warns against assuming here, because the newest release carrying
// an .exe is usually NOT the one being written and is often several behind.
// Guessing sends people to a download that does not exist.
const pointer = body.match(/trajecktory-setup-(v\d+\.\d+\.\d+)\.exe/);
if (hasInstall && !pointer && !/attached to this release/i.test(body)) {
  fail('installer pointer', 'no installer filename in the Install block',
    'Name the newest release that actually carries a trajecktory-setup-*.exe asset, or point at this release\'s own attached installer.');
} else if (pointer) {
  const pointsAt = pointer[1];
  // Two legitimate shapes, per RELEASING.md. Most releases carry no installer
  // and point at an older one that does, which needs a link. A release that
  // DOES ship its own replaces that paragraph with "from the assets below", and
  // requiring a tag link there would flag a correctly written body.
  const selfAttached = /assets below/i.test(body) || (tag && pointsAt === tag);
  if (!selfAttached && !body.includes(`/releases/tag/${pointsAt}`)) {
    fail('installer pointer', `names ${pointsAt} but does not link to that tag`,
      'When pointing at another release, the filename and the link must name the same one.');
  }
  // Either way the named release has to actually carry the file.
  try {
    const assets = JSON.parse(execFileSync('gh', ['release', 'view', pointsAt, '--json', 'assets'], { cwd: ROOT, encoding: 'utf-8' })).assets || [];
    if (!assets.some((a) => /setup.*\.exe$/i.test(a.name))) {
      fail('installer pointer', `${pointsAt} carries no setup .exe asset`,
        'Look up the newest release that actually has one rather than assuming; a wrong pointer is a dead download.');
    }
  } catch {
    notes.push(`could not verify that ${pointsAt} carries an installer (gh unavailable or offline)`);
  }
}

// ── 4. What changed, with at least one prose section ─────────────────────────
if (!/^##\s+What changed\s*$/m.test(body)) {
  fail('What changed', 'the section is missing',
    'Add "## What changed" with one ### subheading per change, each written as prose: symptom first, then cause, then what is true now.');
} else if (!/^###\s+/m.test(body)) {
  fail('What changed', 'no ### subheadings under it',
    'One ### per change. A single undivided block is a changelog entry, not notes.');
}

// ── 5. Bullets live in exactly one place ─────────────────────────────────────
// The named recurring regression. Everything above "### For contributors" is
// meant to be prose a reader can follow.
const contribIdx = lines.findIndex((l) => /^###\s+For contributors\s*$/.test(l.trim()));
const stray = [];
const limit = contribIdx === -1 ? lines.length : contribIdx;
let fenced = false;
for (let i = 0; i < limit; i++) {
  const l = lines[i];
  if (/^\s*```/.test(l)) { fenced = !fenced; continue; }
  if (fenced) continue;                     // code blocks legitimately contain dashes
  if (/^\s*[-*+]\s+\S/.test(l)) stray.push(i + 1);
}
if (stray.length) {
  fail('prose, not bullets', `${stray.length} bullet line(s) before "### For contributors" (line${stray.length === 1 ? '' : 's'} ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ', …' : ''})`,
    'RELEASING.md calls this the recurring regression. Rewrite them as sentences; bullets belong only under "### For contributors".');
}
if (contribIdx === -1) {
  fail('For contributors', 'the section is missing',
    'Add "### For contributors" for file names, module boundaries and test coverage. It is where a reader wanting mechanical detail goes looking.');
}

// ── 6. No real values from the maintainer's job search (LOCAL ONLY) ──────────
// Cannot run in CI: the sources are gitignored and never reach a runner, so the
// check would pass vacuously and read as coverage it does not have.
const APPS = join(ROOT, 'data/applications.md');
const PROFILE = join(ROOT, 'config/profile.yml');
if (!existsSync(APPS)) {
  notes.push('skipped the real-values check: data/applications.md is not present (expected in CI, where it is gitignored). Run this locally before publishing.');
} else {
  const cos = new Set(), roles = new Set();
  for (const line of readFileSync(APPS, 'utf-8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 10 || !/^\d+$/.test(c[1])) continue;
    // Multi-word employers only: single-word ones collide with ordinary English
    // and would make this fire constantly, which is how a check gets ignored.
    if (c[3] && c[3].trim().split(/\s+/).length >= 2) cos.add(c[3].trim());
    if (c[4] && c[4].trim().length >= 12) roles.add(c[4].trim());
  }
  const people = new Set();
  if (existsSync(PROFILE)) {
    const fn = (readFileSync(PROFILE, 'utf-8').match(/^\s*full_name:\s*["']?([^"'\n#]+)/m) || [])[1];
    if (fn) for (const p of fn.trim().split(/\s+/)) if (p.length > 2) people.add(p);
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mask = (v) => (v.length <= 6 ? '******' : `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`);
  const found = [];
  for (const co of cos) if (new RegExp(`\\b${esc(co)}\\b`, 'i').test(body)) found.push(`employer ${mask(co)}`);
  for (const r of roles) if (body.includes(r)) found.push(`job title ${mask(r)}`);
  for (const p of people) if (new RegExp(`\\b${esc(p)}\\b`).test(body)) found.push('a person');
  if (found.length) {
    fail('real values', found.join(', '),
      'The body is published and rendered inside the product, and never passes through the commit hook or the PII gate. Describe the shape, never the value.');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nverify-release-notes — ${source}`);
for (const n of notes) console.log(`  ⏭️  ${n}`);
if (!problems.length) {
  console.log('  ✅ matches the house format in docs/RELEASING.md\n');
  process.exit(0);
}
console.log(`\n  ${problems.length} problem(s):\n`);
for (const p of problems) {
  console.log(`  ❌ ${p.rule}: ${p.detail}`);
  console.log(`     ${p.fix}\n`);
}
console.log('  Spec: docs/RELEASING.md → "Release notes: the house format"\n');
process.exit(1);

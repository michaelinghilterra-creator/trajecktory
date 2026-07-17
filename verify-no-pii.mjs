#!/usr/bin/env node
/**
 * verify-no-pii.mjs — the ship gate for personal data.
 *
 * Two call sites, one engine (same pattern as render-runsheet.mjs `derive()`):
 *   - `node verify-no-pii.mjs`                  scans every TRACKED file (what the repo publishes)
 *   - `node verify-no-pii.mjs --payload <dir>`  scans a built installer payload (what the .exe ships)
 * Both are the same question, because installer/build-bundle.ps1 packs the payload
 * with `git archive HEAD`: tracked == published == distributed.
 *
 * THIS FILE IS TRACKED. It therefore contains no name, email, phone, employer,
 * counterparty or compensation figure as a literal. Every term is derived at
 * runtime from gitignored sources. A leak-checker must not be the leak.
 *
 * On a fresh clone the derivation sources are absent, every derived check yields
 * zero terms, and the structural checks (archives, comp literals) still apply.
 * Exit 0 = clean, 1 = leak.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const payloadIdx = argv.indexOf('--payload');
const PAYLOAD = payloadIdx !== -1 ? argv[payloadIdx + 1] : null;
const JSON_OUT = argv.includes('--json');

const hits = [];
const leak = (file, why, detail) => hits.push({ file, why, detail });
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── the files under scrutiny ────────────────────────────────────────────────
// Repo mode: git ls-files (tracked == shipped). Payload mode: walk the dir.
// NOTE: no extension allowlist. The CV zip that shipped in v1.14.0 was invisible
// precisely because the old scan only looked at .md/.mjs/.json/etc.
const SKIP_DIR = /(^|[\\/])(node_modules|ms-playwright|\.git)([\\/]|$)/;
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
function targets() {
  if (PAYLOAD) return walk(PAYLOAD);
  return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT })
    .split('\n').filter(Boolean).map((f) => join(ROOT, f));
}

// Files where the maintainer's own contact/attribution legitimately appears.
// Mirrors the allowlists in test-all.mjs and build-bundle.ps1.
// Attribution and contact files only: an MIT LICENSE must name the copyright
// holder, and a CODE_OF_CONDUCT must give an enforcement contact. Nothing else
// belongs here. Notably absent are this file and test-all.mjs: both derive their
// terms at runtime and are supposed to hold no literal, so exempting them would
// only ever hide a mistake — which it did, on the first draft of this file.
const IDENTITY_ALLOW = new Set([
  'README.md', 'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
  'SECURITY.md', 'SUPPORT.md', 'NOTICE.md', 'AGENTS.md', 'CLAUDE.md', 'package.json',
  'FUNDING.yml',
]);

// ── 1. ARCHIVES ────────────────────────────────────────────────────────────
// An archive stores its contents DEFLATE-compressed, so no plaintext scan can
// see inside one. v1.14.0 shipped a .zip holding a real CV and a real evaluation
// report; both the repo scan and the installer scan read straight past it.
// Rule: ship no archive. If one ever legitimately must ship, add it here and
// justify it — the point is that the decision is explicit rather than silent.
const ARCHIVE_EXT = new Set(['.zip', '.docx', '.xlsx', '.pptx', '.jar', '.7z', '.rar', '.gz', '.tgz', '.bz2']);
const ARCHIVE_ALLOW = new Set([]);

// ── 2. COMPENSATION ────────────────────────────────────────────────────────
// A walk-away is the number a candidate holds back in a negotiation; publishing
// it inverts the negotiation for every role they pursue. v1.14.0 shipped a real
// walk-away and a real OTE band as dashboard defaults.
// Deriving "his numbers" from profile.yml is not enough: profile.yml declared
// a declared range while the hardcoded defaults were different numbers, so two of the three would
// have passed. The invariant is structural instead — a comp key in a tracked
// file may hold ONLY a value from this neutral set. Anything else is either a
// real number or an unreviewed one, and both should stop the build.
const COMP_KEYS = /\b(targetLow|targetHigh|walkAway|target_low|target_high|walk_away)\b\s*[:=]\s*\{?\s*(\d{2,4})/g;
const COMP_NEUTRAL = new Set(['100', '140', '90']);

// ── derivation sources (all gitignored) ────────────────────────────────────
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };

// identity: owner name/email/phone + surname, plus the email localpart bound to
// an "@". The localpart must NOT be matched bare: a maintainer's GitHub handle is
// usually built from it (handle + the 12345+handle@users.noreply.github.com commit
// address), and both are public by design and load-bearing — they appear in the
// repo origin, trusted-signers, and the self-update channel. Requiring the "@"
// keeps localpart@elsewhere.com in scope while letting the public handle through.
const identity = [];       // literal substring match
const identityRx = [];     // regex match
const profile = read('config/profile.yml');
if (profile) {
  for (const key of ['full_name', 'email', 'phone']) {
    const m = profile.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)`, 'm'));
    if (!m || !m[1].trim()) continue;
    const val = m[1].trim();
    identity.push(val);
    if (key === 'full_name') { const s = val.split(/\s+/).pop(); if (s && s.length > 2) identity.push(s); }
    if (key === 'email') identityRx.push({ re: new RegExp(`\\b${rx(val.split('@')[0])}@`), label: `${val.split('@')[0]}@…` });
  }
}

// third-party emails: every address the owner has collected about someone else.
// v1.14.0 shipped a real recruiter's work email in a tracked fixture.
const thirdParty = new Set();
for (const src of ['data/target-talent.md', 'data/follow-ups.md']) {
  const t = read(src);
  if (!t) continue;
  for (const m of t.matchAll(/[\w.+-]+@[\w.-]+\.\w{2,}/g)) {
    if (identity.some((i) => i.includes('@') && m[0] === i)) continue;
    thirdParty.add(m[0]);
  }
}

// career figures: the distinctive money amounts in the owner's CV and story bank.
// A template whose example is written from a real bio (an employer, a tenure, a
// revenue figure, a real story title) ships that bio to every user, and no
// identity/comp/company rule catches it — the amount is not a salary, not a
// company, and not a name. Money tokens are the highest-signal, lowest-noise handle
// on this class: they are rare, exact, and an amount in someone's CV is theirs.
//
// Do NOT paste a real example of the thing here to illustrate it. The first draft
// of this comment quoted the actual revenue figure it exists to catch, which put
// that figure into a tracked file — and this file was allowlisted, so the check
// skipped itself and reported clean. A leak-checker must not be the leak, and an
// allowlist is how it becomes one.
const figures = new Set();
const cvText = ['cv.md', 'interview-prep/story-bank.md', 'article-digest.md']
  .map(read).filter(Boolean).join('\n');
for (const m of cvText.matchAll(/\$\d+(?:\.\d+)?[KMB]\b/g)) figures.add(m[0]);

// Employer names and story titles from the same sources. These need a heuristic
// (there is no employer field to read) and the obvious one — every proper noun in
// the CV — is unusable: it flags LinkedIn, RevOps, MEDDPICC, OpenAI, SaaS, i.e.
// the industry vocabulary any CV shares with any codebase in this domain. What
// distinguishes an employer is that it is a CamelCase/compound token in HIS CV
// that a generic corpus would not contain, so subtract the vocabulary explicitly.
// Story titles come from the story-bank headings, which are already his phrasing.
const GENERIC = new Set(['LinkedIn', 'RevOps', 'MEDDPICC', 'ZoomInfo', 'OpenAI', 'SaaS', 'STAR',
  'FIRST', 'AMEA', 'EMEA', 'LATAM', 'APAC', 'GitHub', 'YouTube', 'PowerBI', 'BigQuery', 'HubSpot',
  'Marketo', 'Salesforce', 'Workday', 'Greenhouse', 'JavaScript', 'TypeScript', 'PostgreSQL',
  'ChatGPT', 'ClaudeCode', 'PowerPoint', 'NetSuite', 'QuickBooks', 'DataRobot', 'SalesLoft']);
const career = new Map();
for (const m of cvText.matchAll(/\b[A-Z][a-z]+[A-Z][A-Za-z]{2,}\b/g)) {
  if (!GENERIC.has(m[0])) career.set(m[0], 'employer/product from the owner CV');
}
for (const m of (read('interview-prep/story-bank.md') || '').matchAll(/^#{1,4}\s+(.{10,70})$/gm)) {
  const t = m[1].replace(/[*_`#]/g, '').trim();
  if (t.split(/\s+/).length >= 4) career.set(t, 'story title from the owner story bank');
}

// pipeline state. A company name alone is NOT a leak, and this is the trap that
// makes a naive rule useless: templates/portals.example.yml ships ~45 real tech
// companies as a product feature, dashboard-web/src/data.js ships ~53 fabricated
// demo rows that reuse real company names, and the owner has tracked hundreds of
// companies spanning most of tech. Any list of tech employers collides with his
// tracker by coincidence. Flagging company+status alone yields ~9 false positives
// on this repo and zero true ones, and a gate that cries wolf gets switched off.
//
// What makes a line HIS data is CORRESPONDENCE with a real row: the same company
// carrying the same date/role/score. Require two independent field matches (a
// single one is coincidence), or a report link bearing that row's tracker id.
// This is the rule that separates a real evaluation report from a demo row.
const AMBIGUOUS = /^(Array|Toast|Later|Fetch|Honor|Render|Outreach|Ashby|Engine|Invoca|Lever|Greenhouse|Notion|Figma|Vercel|Included|Uplight|Instacart|Jane|Popl|Sparrow|Future|Proof|Cohere|Salesforce|Twilio|Stripe|Block)$/i;
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pipeline = new Map();
const apps = read('data/applications.md');
if (apps) {
  for (const line of apps.split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 7 || !/^\d+$/.test(c[1] || '')) continue;
    const co = (c[3] || '').replace(/[,.]?\s*(Inc|LLC|Corp|Corporation|Ltd)\.?$/i, '').trim();
    if (!co || co.length < 5 || AMBIGUOUS.test(co) || !/^[A-Z]/.test(co)) continue;
    if (!pipeline.has(co)) pipeline.set(co, []);
    pipeline.get(co).push({ id: c[1], date: c[2], role: c[4], score: String(c[5] || '').replace('/5', '').trim() });
  }
}

// interview state. Distinct from pipeline state above, and NOT reducible to it.
// `interview-prep/{Company}/` names a company the owner is actively interviewing
// with: one token, yet unambiguous, because that folder exists only when a round is
// live. The correspondence rule needs two matching fields and reads straight past
// this. AGENTS.md documents this exact path convention, so the SHAPE is expected in
// tracked docs and only the company makes it a leak; the example must use an
// invented one. This is not hypothetical: a real hiring manager name reached the
// public repo inside precisely this path, and a history scan found the real company
// still sitting in old revisions of AGENTS.md and modes/interview-prep.md.
const prepPaths = new Map();
for (const co of pipeline.keys()) prepPaths.set(`interview-prep/${co}/`, co);

// ── the sweep ──────────────────────────────────────────────────────────────
const files = targets();
for (const abs of files) {
  const name = basename(abs);
  const rel = abs.replace(ROOT, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
  let st; try { st = statSync(abs); } catch { continue; }
  if (!st.isFile()) continue;

  // 1. archives — structural, no content read required
  if (ARCHIVE_EXT.has(extname(abs).toLowerCase()) && !ARCHIVE_ALLOW.has(name)) {
    leak(rel, 'ARCHIVE', `${extname(abs)} — contents cannot be scanned; ship no archives`);
    continue;
  }

  let buf; try { buf = readFileSync(abs); } catch { continue; }

  // Binary content is not scannable as text and must not be treated as if it were.
  // A PNG stores its pixels zlib-compressed, so rendered text never appears as
  // plaintext bytes, while random bytes DO occasionally spell a short token — a
  // screenshot in docs/ matched one of the money figures below by pure chance.
  // Scanning binaries for strings is therefore all false positive and no signal,
  // which is exactly why archives are refused structurally above rather than
  // searched. (The figure itself is deliberately not quoted here: it is real, and
  // this file is tracked. Naming a leak while documenting it is how it ships.)
  //
  // The residual risk this leaves is real but not solvable by grep: a SCREENSHOT of
  // a real dashboard leaks whatever is on screen, and no byte scan can see it. That
  // is a human review item, called out in docs/ rather than pretended away here.
  if (buf.subarray(0, 8192).includes(0)) continue;
  const text = buf.toString('utf8');

  // 2. owner identity (skips attribution files)
  if (!IDENTITY_ALLOW.has(name)) {
    for (const term of identity) {
      if (text.includes(term)) leak(rel, 'OWNER IDENTITY', term);
    }
    for (const { re, label } of identityRx) {
      if (re.test(text)) leak(rel, 'OWNER IDENTITY', label);
    }
  }

  // 3. third-party identity — never allowlisted. Another person's work email is
  //    theirs, and no attribution file has a reason to carry one.
  for (const addr of thirdParty) {
    if (text.includes(addr)) leak(rel, 'THIRD-PARTY EMAIL', addr);
  }

  // 3b. career content from the owner's own CV / story bank
  if (!IDENTITY_ALLOW.has(name)) {
    for (const f of figures) {
      if (text.includes(f)) {
        leak(rel, 'CAREER FIGURE', `${f} — appears in the owner CV/story bank; example content in a shipped file must be invented`);
      }
    }
    for (const [t, why] of career) {
      const re = t.length < 12 ? new RegExp(`\\b${rx(t)}\\b`) : null;
      if (re ? re.test(text) : text.includes(t)) {
        leak(rel, 'CAREER CONTENT', `"${t}" — ${why}; example content in a shipped file must be invented`);
      }
    }
  }

  // 3c. interview state — a real company in an interview-prep path
  for (const [p, co] of prepPaths) {
    if (text.includes(p)) {
      leak(rel, 'INTERVIEW STATE', `${p} — "${co}" is a company in the tracker; a prep folder names a live interview round. Use an invented company in examples.`);
    }
  }

  // 4. compensation literals
  for (const m of text.matchAll(COMP_KEYS)) {
    if (!COMP_NEUTRAL.has(m[2])) {
      leak(rel, 'COMP LITERAL', `${m[1]} = ${m[2]} (neutral set: ${[...COMP_NEUTRAL].join('/')}; real targets belong in the gitignored config/profile.yml)`);
    }
  }

  // 5. pipeline state — correspondence, not mere co-occurrence (see note above).
  //
  // The unit of correspondence differs by shape, and getting this wrong misses the
  // exact thing that shipped. An evaluation report is a PROSE document about one
  // company: the company sits in the title and the date/score sit on their own
  // lines further down, so a per-line rule reads right past a verbatim copy of one
  // (this is how the real reports hid in tests/fixtures/). A demo table is one row
  // per line, where file-level matching would cross-contaminate unrelated rows.
  // So: prose matches at file scope, structured data matches at line scope.
  if (pipeline.size && /\.(md|json|mjs|js|jsx|tsv|csv|ya?ml|html?|txt)$/i.test(abs)) {
    const prose = /\.(md|markdown|html?|txt)$/i.test(abs);
    const seen = new Set();
    const check = (hay, where) => {
      const nhay = norm(hay);
      for (const [co, rows] of pipeline) {
        if (!new RegExp(`\\b${rx(co)}\\b`).test(hay)) continue;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          const match = [];
          if (r.date && hay.includes(r.date)) match.push(`date ${r.date}`);
          if (r.role && r.role.length > 6 && nhay.includes(norm(r.role))) match.push(`role "${r.role}"`);
          if (r.score && new RegExp(`\\b${rx(r.score)}\\s*/\\s*5\\b`).test(hay)) match.push(`score ${r.score}`);
          const linked = new RegExp(`reports/${rx(r.id)}-|\\[${rx(r.id)}\\]\\(reports/`).test(hay);
          if (match.length >= 2 || linked) {
            seen.add(r.id);
            leak(where, 'PIPELINE STATE',
              `reproduces tracker row ${r.id} (${co}): ${linked ? `report link for #${r.id}` : match.join(' + ')}`);
          }
        }
      }
    };
    if (prose) check(text, rel);
    else text.split('\n').forEach((line, i) => check(line, `${rel}:${i + 1}`));
  }
}

// ── report ─────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: hits.length === 0, scanned: files.length, hits }, null, 2));
  process.exit(hits.length ? 1 : 0);
}
const scope = PAYLOAD ? `payload ${PAYLOAD}` : 'tracked tree';
console.log(`Scanning ${scope}: ${files.length} files`);
console.log(`  derived: ${identity.length} identity, ${thirdParty.size} third-party, ${pipeline.size} companies`);
if (!hits.length) {
  console.log('  OK — no personal data found.');
  process.exit(0);
}
console.log(`\n${hits.length} LEAK(S):`);
for (const h of hits) console.log(`  [${h.why}] ${h.file}\n      ${h.detail}`);
console.log('\nThese files ship to every user (repo + installer payload). Refusing to pass.');
process.exit(1);

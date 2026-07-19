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
// execFileSync for anything that interpolates a value: it takes an argv array and
// spawns git directly, with no shell to interpret metacharacters. execSync stays
// only for fully constant command strings, where there is nothing to inject.
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const payloadIdx = argv.indexOf('--payload');
const PAYLOAD = payloadIdx !== -1 ? argv[payloadIdx + 1] : null;
const JSON_OUT = argv.includes('--json');
// --messages [range]  scan COMMIT MESSAGES instead of files.
// --msg-file <path>   scan one message file (the commit-msg hook path).
const msgIdx = argv.indexOf('--messages');
const MESSAGES = msgIdx !== -1;
const MSG_RANGE = MESSAGES && argv[msgIdx + 1] && !argv[msgIdx + 1].startsWith('--') ? argv[msgIdx + 1] : null;
const msgFileIdx = argv.indexOf('--msg-file');
const MSG_FILE = msgFileIdx !== -1 ? argv[msgFileIdx + 1] : null;
// --staged  scan only the files being committed, reading their STAGED content.
// This is the pre-commit hook's mode: a full-tree scan takes seconds (it correlates
// every file against hundreds of tracker rows) and a hook that slow gets disabled.
// It is also the more correct question at commit time — what is about to be
// committed, not what happens to be sitting in the working tree.
const STAGED = argv.includes('--staged');

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
  if (STAGED) {
    // Added/Copied/Modified only: a deletion cannot introduce data.
    return execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT })
      .split('\n').filter(Boolean).map((f) => join(ROOT, f));
  }
  return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT })
    .split('\n').filter(Boolean).map((f) => join(ROOT, f));
}

// In --staged mode read the INDEX copy, not the working tree: with a partially
// staged file the two differ, and the index is what the commit will contain.
// `rel` is a REPO FILENAME, so it is attacker-influenced: anyone who can get a
// file into the index chooses it. Interpolated into a shell string, a name like
// `$(...)` or a backticked one executes when the pre-commit hook runs this in
// --staged mode. argv form passes it to git as one literal argument instead.
function readTarget(abs, rel) {
  if (!STAGED) { try { return readFileSync(abs); } catch { return null; } }
  try { return execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch { return null; }
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
// it inverts the negotiation for every role they pursue. A real walk-away and a
// real OTE band once shipped as dashboard defaults.
//
// Deriving the owner's figures from profile.yml is NOT sufficient, and this is the
// whole reason the rule is shaped the way it is: the values hardcoded as defaults
// were not the values declared in profile.yml, so a derive-and-compare check would
// have matched some and waved the rest through. The invariant is structural instead
// — a comp key in a tracked file may hold ONLY a value from the neutral set below.
// Anything else is either a real number or an unreviewed one, and both should stop
// the build.
//
// Do not restore the illustrative figures that this comment used to carry. They were
// the owner's real band and walk-away, they sat here for hours, and they reached a
// built installer: every check above was blind to them because they were prose, not
// a key assignment. Describe the shape; never write the values.
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

// Customized profile SCALARS beyond the three identity keys. The gate read only
// full_name/email/phone, so a real gitignored profile value hardcoded as a default
// in shipped code was invisible — that shipped the owner's private Obsidian vault
// taxonomy as a fallback path in apply.mjs, the same family as the walk-away leak
// (a gitignored value pasted into shipped code). Derive EVERY distinctive scalar in
// profile.yml that is NOT also the placeholder in the tracked profile.example.yml
// (so it is genuinely user-customized, not a shipped default like resume_dir
// "output"). The example-subtraction is load-bearing: without it, benign shared
// defaults would flag. The length/shape gate keeps a city or currency from adding
// noise.
const profileScalars = new Map();
{
  const example = read('config/profile.example.yml') || '';
  const exampleVals = new Set(
    [...example.matchAll(/^\s*[\w-]+:\s*["']?([^"'\n#]+)/gm)].map((m) => m[1].trim()).filter(Boolean),
  );
  // Only two shapes are distinctive enough to flag without crying wolf (verified by
  // running: the broad "any scalar >= 12 chars" version produced 4 false positives —
  // a format string, an enum, a YAML-key parse artifact, and a generic career level —
  // and zero of those is personal data). A gate that fires on those gets switched off.
  //   (a) PATH-SHAPED: 2+ path separators. This is the vault-path leak, and the shape
  //       of any private filesystem path a user might paste into code.
  //   (b) LONG FREE TEXT: >= 18 chars WITH a space, no format braces / colons. Catches
  //       a customized headline or summary sentence; excludes enums (no space), format
  //       strings ({...}), and keys (trailing colon).
  const prof = read('config/profile.yml') || '';
  for (const m of prof.matchAll(/^\s*([\w-]+):\s*["']?([^"'\n#]+)/gm)) {
    const key = m[1], val = m[2].trim();
    if (exampleVals.has(val)) continue;                    // shipped placeholder, not user data
    if (/[{}]/.test(val) || val.endsWith(':')) continue;   // format string / parse artifact
    const pathShaped = (val.match(/[\\/]/g) || []).length >= 2;
    const longFreeText = val.length >= 18 && /\s/.test(val);
    if (pathShaped || longFreeText) profileScalars.set(val, key);
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

// Career METRICS as prose. A hero metric or a story Result is his real achievement,
// and it leaked as an example title ("N days to N hours") in the batch prompt. It is
// not a $-figure, not CamelCase, not a story heading, so nothing above saw it. Derive
// the distinctive number-bearing spans from hero_metric and the story-bank Result
// lines, and register BOTH the "→" and the spelled-out "to" form (the leak paraphrased
// the arrow). Anchoring to a span that actually appears in his gitignored sources is
// what keeps this from flagging generic "reduced X to Y" process copy.
const metricText = [
  (read('config/profile.yml') || '').match(/hero_metric:\s*["']?([^"'\n#]+)/)?.[1] || '',
  ...[...(read('interview-prep/story-bank.md') || '').matchAll(/\*\*R[^:]*:\*\*\s*(.{10,120})/g)].map((m) => m[1]),
].join('\n');
for (const m of metricText.matchAll(/\b\d+\+?\s*[A-Za-z]+\s*(?:→|->|to)\s*\d+\+?\s*[A-Za-z]+/g)) {
  const span = m[0].replace(/\s+/g, ' ').trim();
  figures.add(span.replace(/→|->/g, 'to'));
  figures.add(span.replace(/\bto\b/g, '→'));
}
for (const m of metricText.matchAll(/\b\d{2,}\+?-[A-Za-z]{3,}\b/g)) figures.add(m[0]); // hyphenated-number tokens, e.g. "NN-slide" (real values not quoted here — this file is tracked)

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

// Distinctive CV LINES. The CamelCase and $-figure rules above see only a fraction
// of a resume; the bulk of its identifying content is multi-word Title-Case prose
// (a role title, a summary sentence, an employer+dates line) that matches neither.
// That gap shipped his verbatim role title, subtitle, summary opening and AoE line
// as the `locator` values in templates/cv-template-slots.json, and again in
// modes/docx-light.md and a test fixture. It also shipped his phone in a dotted
// form the hyphen-based identity rule never saw.
//
// The match unit is a whole distinctive LINE (or its leading prefix — the docx slot
// tool uses the first few words of the summary/AoE lines as prefix locators). A
// 25+ char verbatim span of someone's CV in a tracked file is never coincidental:
// generic industry vocabulary is single words, never a 25-char line. That is what
// keeps this near zero false positives where a per-token rule could not.
// Two false-positive sources, learned by running this against the tree (examples
// below are described, NOT quoted: quoting a real cv.md line here would leak it into
// this tracked file, which the rule then flags — that is not hypothetical, an
// earlier draft did exactly that):
//   - Generic resume SECTION HEADERS (an "…Experience" / "…Tools & Platforms" title)
//     are his cv.md lines but identify nobody. Stoplist them (CV_SECTION_HEADER).
//   - PREFIXES of a job-title-with-dates header (a "#### <Role> | <dates>" line) are
//     generic titles that the fabricated demo rows in data.js legitimately reuse. So
//     generate a prefix ONLY from non-header body lines; the real prefix-style slot
//     locators are the openings of the summary and areas-of-expertise BODY lines, so
//     they are still caught. A full job-title line is kept: it carries his dates and
//     is distinctive.
const CV_SECTION_HEADER = /^(professional |work |additional relevant )?(experience|summary|profile|objective|areas? of expertise|core competencies|technical skills|selected tools( & platforms)?|skills|education|certifications?|projects?|publications?|awards?|languages?|interests?|references?|contact|employment history)$/i;
const cvLines = new Set();
for (let raw of (read('cv.md') || '').split('\n')) {
  const isHeader = /^\s*#{1,6}\s/.test(raw);
  const line = raw.replace(/^[#>\s*+\-]+/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const words = line.split(' ').filter(Boolean);
  if (line.length < 25 || words.length < 3 || !/[A-Za-z]/.test(line)) continue;
  if (CV_SECTION_HEADER.test(line)) continue;     // generic section header, identifies nobody
  cvLines.add(line);
  if (!isHeader) {                                // prefix only from body lines (see note)
    let pfx = '';
    for (const w of words) { pfx = pfx ? `${pfx} ${w}` : w; if (pfx.length >= 25) break; }
    if (pfx.length >= 25 && pfx.length < line.length) cvLines.add(pfx);
  }
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

// Report PATHS as correspondence. A report filename reports/{id}-{slug}-{date}.md
// reproduces a real tracker row (id + company-slug + date), but the pipeline rule
// above matches the company DISPLAY name (e.g. "Example Co") while the path carries
// the SLUG ("example-co"), so a real evaluation used as a doc "worked example" slips
// past. Match on the id+date pair being adjacent in a reports/ path: both matching one
// real row is strong correspondence and effectively never coincidental. (An audit
// refuted a real instance of this once; the real company slug is deliberately not
// quoted here, since this file is tracked and the rule would then flag itself.)
const trackerIdDate = new Set();
{
  const appsSrc = read('data/applications.md') || '';
  for (const line of appsSrc.split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 3 || !/^\d+$/.test(c[1] || '') || !/^\d{4}-\d{2}-\d{2}$/.test(c[2] || '')) continue;
    trackerIdDate.add(`${c[1]}:${c[2]}`);
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

// ── COMMIT MESSAGES ────────────────────────────────────────────────────────
// A commit message is published exactly as surely as a file, and nothing here used
// to look at one. That is not hypothetical: while the file gate above was being
// built, three commit messages in this repo named the interview counterparties and
// one spelled out the owner's real compensation band and walk-away in prose. The
// gate scanned files, so it saw none of it.
//
// Scope is origin/main..HEAD, the unpushed commits. That is the only window where a
// message can still be amended; once pushed it is published and a check is too late.
// A fresh clone has HEAD == origin/main, so the range is empty and this is a no-op.
function commitMessages() {
  if (MSG_FILE) {
    // commit-msg hook: the message being written, before the commit exists
    try { return [{ id: '(pending)', body: readFileSync(MSG_FILE, 'utf8') }]; } catch { return []; }
  }
  let range = MSG_RANGE;
  if (!range) {
    // Default to unpushed work. Prefer the tracked upstream; fall back to origin/main.
    for (const cand of ['@{upstream}..HEAD', 'origin/main..HEAD', 'origin/HEAD..HEAD']) {
      try {
        execFileSync('git', ['rev-list', '--count', cand], { cwd: ROOT, stdio: 'pipe' });
        range = cand;
        break;
      } catch { /* no such ref here */ }
    }
  }
  if (!range) return [];   // no remote to compare against: nothing is "unpushed"
  try {
    // `range` comes from --messages argv when given, so it is also interpolated.
    const raw = execFileSync('git', ['log', '--format=%H%x00%B%x1e', range],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    return raw.split('\x1e').filter((r) => r.trim()).map((r) => {
      const [id, body] = r.split('\x00');
      return { id: id.trim().slice(0, 8), body: body || '' };
    });
  } catch { return []; }
}

// Compensation written as PROSE, rather than assigned to a key. COMP_KEYS is
// structural (a comp key assigned a number) and cannot see a sentence that simply
// states the figures, which is the form that actually shipped: a commit message
// narrating a declared range and a real walk-away, and later a docs table quoting
// them as its example. Bare numbers are far too common to flag alone, so require a
// compensation word on the same line.
//
// Applies to FILES and MESSAGES both. It was message-only for one iteration, and in
// that window a rule written to forbid quoting these figures quoted them, into a
// tracked file, and this scan walked straight past. Same class, both surfaces.
//
// THREE digits per figure, not two. A comp band is a thousands value (three digits
// here); a two-digit pair is a ratio, and "50/50 below the activity band" in a JSX
// layout comment is a false positive that would train someone to ignore this gate.
const COMP_WORD = /\b(walk[- ]?away|OTE|target(Low|High)?|comp|compensation|salary|base pay|floor|ceiling|band)\b/i;
const COMP_PROSE = /\b[1-9]\d{2}\s*\/\s*[1-9]\d{2}(?:\s*\/\s*[1-9]\d{2})?\b/;

function scanMessages() {
  const msgs = commitMessages();
  for (const { id, body } of msgs) {
    const where = `commit ${id}`;
    for (const term of identity) if (body.includes(term)) leak(where, 'OWNER IDENTITY', term);
    for (const { re, label } of identityRx) if (re.test(body)) leak(where, 'OWNER IDENTITY', label);
    for (const addr of thirdParty) if (body.includes(addr)) leak(where, 'THIRD-PARTY EMAIL', addr);
    for (const f of figures) if (body.includes(f)) leak(where, 'CAREER FIGURE', `${f} — from the owner CV/story bank`);
    for (const [t, why] of career) {
      const re = t.length < 12 ? new RegExp(`\\b${rx(t)}\\b`) : null;
      if (re ? re.test(body) : body.includes(t)) leak(where, 'CAREER CONTENT', `"${t}" — ${why}`);
    }
    for (const [p, co] of prepPaths) {
      if (body.includes(p) || body.includes(`interview-prep/${co}`)) {
        leak(where, 'INTERVIEW STATE', `${p} — "${co}" is a company in the tracker`);
      }
    }
    for (const m of body.matchAll(COMP_KEYS)) {
      if (!COMP_NEUTRAL.has(m[2])) leak(where, 'COMP LITERAL', `${m[1]} = ${m[2]}`);
    }
    if (COMP_WORD.test(body) && COMP_PROSE.test(body)) {
      leak(where, 'COMP IN PROSE',
        `${(body.match(COMP_PROSE) || [''])[0]} next to a compensation word. A real band or walk-away does not belong in a published message; describe the shape, not the numbers.`);
    }
  }
  return msgs.length;
}

// ── message mode: scan messages and report, never touching the file sweep ───
if (MESSAGES || MSG_FILE) {
  const n = scanMessages();
  const scope = MSG_FILE ? 'the message being committed' : `${n} unpushed commit message(s)`;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: hits.length === 0, scanned: n, hits }, null, 2));
    process.exit(hits.length ? 1 : 0);
  }
  console.log(`Scanning ${scope}`);
  console.log(`  derived: ${identity.length} identity, ${thirdParty.size} third-party, ${figures.size} figures, ${prepPaths.size} prep paths`);
  if (!hits.length) { console.log('  OK — no personal data in any message.'); process.exit(0); }
  console.log(`\n${hits.length} LEAK(S) IN COMMIT MESSAGE(S):`);
  for (const h of hits) console.log(`  [${h.why}] ${h.file}\n      ${h.detail}`);
  console.log('\nA commit message is published like any file, and it is NOT covered by the');
  console.log('file scan. Amend before pushing: git commit --amend  (or rebase for older ones).');
  process.exit(1);
}

// ── derivation health ──────────────────────────────────────────────────────
// A checker that derives NOTHING finds nothing and reports "OK". That output is
// indistinguishable from a real all-clear, and it is the exact failure that let
// test-all.mjs section 6 pass for months while doing nothing (a `2>/dev/null` that
// Windows cmd could not honour made every grep fail, and the empty result read as
// "no leaks"). This file is one schema change away from the same lie: rename
// `full_name` in profile.yml, or reformat the tracker table, and identity,
// third-party, company, figure, career and prep-path checking all silently switch
// off while the summary still prints OK.
//
// So: assert the derivation actually worked. Only assert what is CERTAIN. A source
// that is ABSENT is not a fault (a fresh clone has no profile.yml and genuinely has
// nothing to leak); a source that is PRESENT but yields nothing is a broken parser.
// A CV with no money figures is legitimate, so figures are never asserted.
const health = [];
{
  const prof = read('config/profile.yml');
  if (prof && identity.length === 0) {
    health.push('config/profile.yml exists but yielded 0 identity terms — the full_name/email/phone parser is broken (renamed field? reformatted?). Identity checking is OFF.');
  }
  const talent = read('data/target-talent.md');
  if (talent && /@[\w.-]+\.\w{2,}/.test(talent) && thirdParty.size === 0) {
    health.push('data/target-talent.md contains email addresses but yielded 0 third-party terms — the parser is broken. Third-party checking is OFF.');
  }
  const appsSrc = read('data/applications.md');
  if (appsSrc && /^\|\s*\d+\s*\|/m.test(appsSrc) && pipeline.size === 0) {
    health.push('data/applications.md has table rows but yielded 0 companies — the row parser is broken. Pipeline/interview-state checking is OFF.');
  }
}
if (health.length) {
  console.error('\nDERIVATION FAILURE — this check cannot certify anything:\n');
  for (const h of health) console.error(`  ${h}`);
  console.error('\nA source is present but produced no terms, so the scan would report a vacuous');
  console.error('OK. Refusing to pass. Fix the parser, or delete the source if it is genuinely gone.');
  process.exit(2);
}

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

  const buf = readTarget(abs, rel);
  if (!buf) continue;

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
    // 2b. any customized profile scalar hardcoded into a tracked file
    for (const [val, key] of profileScalars) {
      if (text.includes(val)) {
        leak(rel, 'PROFILE VALUE', `${key} = "${val.slice(0, 44)}${val.length > 44 ? '…' : ''}" — a user value from the gitignored config/profile.yml. Read it from profile at runtime; never hardcode it in shipped code.`);
      }
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
    for (const line of cvLines) {
      if (text.includes(line)) {
        leak(rel, 'CV LINE', `"${line.slice(0, 50)}${line.length > 50 ? '…' : ''}" — a verbatim line from the owner CV. If a slot locator, the whole cv-template-slots file is user-layer and must be gitignored; if an example, invent it.`);
      }
    }
  }

  // 3c. interview state — a real company in an interview-prep path
  for (const [p, co] of prepPaths) {
    if (text.includes(p)) {
      leak(rel, 'INTERVIEW STATE', `${p} — "${co}" is a company in the tracker; a prep folder names a live interview round. Use an invented company in examples.`);
    }
  }

  // 3d. report path reproducing a real tracker row (id + date), slug-form
  if (/\.(md|mjs|js|jsx|ya?ml|json|txt)$/i.test(abs)) {
    for (const m of text.matchAll(/reports\/(\d+)-[a-z0-9-]+-(\d{4}-\d{2}-\d{2})\.md/g)) {
      if (trackerIdDate.has(`${m[1]}:${m[2]}`)) {
        leak(`${rel}`, 'TRACKER ROW (report path)', `${m[0]} reproduces real tracker row #${m[1]} (${m[2]}). Use a fictional example path (an id/date matching no real row).`);
      }
    }
  }

  // 4. compensation literals
  for (const m of text.matchAll(COMP_KEYS)) {
    if (!COMP_NEUTRAL.has(m[2])) {
      leak(rel, 'COMP LITERAL', `${m[1]} = ${m[2]} (neutral set: ${[...COMP_NEUTRAL].join('/')}; real targets belong in the gitignored config/profile.yml)`);
    }
  }

  // 4b. compensation stated as prose (see the note on COMP_PROSE above).
  // WINDOW, not line. A comment block or a paragraph states the subject once and the
  // figures several lines later, so a per-line rule sees a comp word with no numbers
  // and then numbers with no comp word, and reports clean on both. That is exactly
  // how a real band and walk-away survived in this very file's own comment and
  // reached a built installer. Same lesson as the prose-vs-line scope in the
  // pipeline-state rule below; it simply was not applied here.
  {
    const lines = text.split('\n');
    const W = 6;
    for (let i = 0; i < lines.length; i++) {
      if (!COMP_PROSE.test(lines[i])) continue;
      const near = lines.slice(Math.max(0, i - W), i + W + 1).join('\n');
      if (COMP_WORD.test(near)) {
        leak(`${rel}:${i + 1}`, 'COMP IN PROSE',
          `${(lines[i].match(COMP_PROSE) || [''])[0]} within ${W} lines of a compensation word. Describe the shape, not the numbers: a real band or walk-away must not ship.`);
      }
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

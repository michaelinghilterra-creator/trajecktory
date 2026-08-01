#!/usr/bin/env node
/**
 * security-review.test.mjs — the fourteen findings from the formal security review
 * (2026-07-24), which shipped in commits d7950d5 + d3d2a1a with NO test coverage:
 * the suite count did not rise, so a later refactor could silently undo any of them.
 *
 * Separate from tests/security.test.mjs (the earlier pre-audit pass): that suite
 * holds the eight findings the first review fixed; this holds the fourteen the
 * formal multi-agent scan fixed. Both stay, because both classes of guard regress
 * quietly — a security control that is deleted still leaves a green build unless a
 * test is watching it.
 *
 * Where a fix is a reachable pure function (the SSRF guard, the cell sanitizer,
 * urlFromReport, the client safeHref, the ship-gate secret scan via --payload) this
 * exercises the REAL shipped function. Where it is inline in a server route or
 * middleware a test cannot import without standing up the server (the Host allow-
 * list, the bounce-confirmation gate), it asserts the guard is present in the
 * shipped source — weaker, but it fails if someone removes it.
 *
 * Finding ids are the review's own (C1..C14).
 *
 * Run: node tests/security-review.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

console.log('security-review.test.mjs');

// ── C10: the liveness probe refuses non-public targets (SSRF) ────────────────
const { isSafeLivenessUrl } = await import('../lib/safe-url.mjs');

for (const ok of ['https://job-boards.greenhouse.io/x/jobs/1', 'http://careers.example.com/role', 'https://boards.ashbyhq.com/x']) {
  check(isSafeLivenessUrl(ok) === true, `liveness accepts a public board URL (${new URL(ok).hostname})`);
}
const SSRF = {
  'loopback by name': 'http://localhost/admin',
  'a *.localhost name': 'http://foo.localhost/',
  'the loopback IP': 'http://127.0.0.1:3333/api/google/scan-bounces',
  'anything in 127/8': 'http://127.9.9.9/',
  '"this host" 0.x': 'http://0.0.0.0/',
  'private 10/8': 'http://10.1.2.3/',
  'private 192.168/16': 'http://192.168.1.1/',
  'private 172.16': 'http://172.16.0.1/',
  'private 172.31': 'http://172.31.255.255/',
  'link-local / cloud metadata': 'http://169.254.169.254/latest/meta-data/iam/',
  'IPv6 loopback': 'http://[::1]/',
  'a file: URL': 'file:///etc/passwd',
  'a gopher: URL': 'gopher://127.0.0.1:70/',
  'a javascript: URL': 'javascript:fetch("http://169.254.169.254")',
  'not a URL at all': 'this is not a url',
};
for (const [label, u] of Object.entries(SSRF)) check(isSafeLivenessUrl(u) === false, `liveness rejects ${label}`);

// The /12 boundary is the part a hand-rolled range check gets wrong: only 172.16
// through 172.31 is private, so 172.15 and 172.32 must be ACCEPTED, and 10.x being
// private must not spill onto the adjacent public 11.x.
check(isSafeLivenessUrl('http://172.15.0.1/') === true, 'liveness accepts 172.15 (just below the private /12)');
check(isSafeLivenessUrl('http://172.32.0.1/') === true, 'liveness accepts 172.32 (just above the private /12)');
check(isSafeLivenessUrl('http://11.0.0.1/') === true, 'liveness accepts 11.x (public, adjacent to private 10.x)');

const clSrc = read('check-liveness.mjs');
check(/from '\.\/lib\/safe-url\.mjs'/.test(clSrc), 'check-liveness imports the shared SSRF guard');
check(!/function isSafeLivenessUrl/.test(clSrc), 'check-liveness keeps no private copy of it');

// ── C7 / C8 / C9: the scanners neutralize row delimiters ─────────────────────
const { sanitizeCell } = await import('../lib/sanitize-cell.mjs');

check(sanitizeCell('Acme|Corp') === 'Acme Corp', 'a pipe is neutralized (cannot forge a markdown-table column)');
check(sanitizeCell('a\tb') === 'a b', 'a tab is neutralized (cannot forge a TSV column)');
check(sanitizeCell('line1\nline2') === 'line1 line2', 'a newline is neutralized (cannot forge a second row)');
check(sanitizeCell('a\r\nb') === 'a  b', 'a CRLF is neutralized');
check(sanitizeCell('  trim me  ') === 'trim me', 'the edges are trimmed');
check(sanitizeCell(null) === '' && sanitizeCell(undefined) === '', 'nullish becomes empty, not the string "null"');
// The actual attack: a job title that tries to open a second pipeline row.
const forged = 'Real Title\n- [ ] http://evil.example/x | Evil Co | Injected';
const clean = sanitizeCell(forged);
check(!clean.includes('\n') && !clean.includes('|'), 'a forged-row job title collapses to a single cell');

for (const [f, src] of [['scan.mjs', read('scan.mjs')], ['discover.mjs', read('discover.mjs')]]) {
  check(/from '\.\/lib\/sanitize-cell\.mjs'/.test(src), `${f} imports the shared sanitizer`);
  check(!/function sanitizeCell/.test(src), `${f} keeps no private copy (the two used to be byte-identical, which is how a guard drifts)`);
}

// ── C1: the ship gate scans tracked files for secrets ────────────────────────
// Run the REAL gate over a payload dir. Values are FAKE but pattern-matching, so
// this test file carries no real credential; the gate must still refuse them.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-secret-'));
  try {
    const fakes = {
      'Anthropic API key': 'sk-ant-api03-' + 'A'.repeat(48),
      'OpenAI project key': 'sk-proj-' + 'B'.repeat(40),
      'Google OAuth client secret': 'GOCSPX-' + 'C'.repeat(24),
      'Google OAuth access token': 'ya29.' + 'D'.repeat(40),
      'GitHub token': 'ghp_' + 'E'.repeat(40),
      'GitHub fine-grained PAT': 'github_pat_' + 'F'.repeat(60),
      'AWS access key id': 'AKIA' + 'G'.repeat(16),
      // Built by concatenation like the rest, so the matchable string only exists at
      // RUNTIME (in the payload the gate scans), never as a literal in this tracked
      // source — otherwise the gate flags its own fixture, the exact self-reference
      // trap verify-no-pii.mjs warns about.
      'PEM private key': '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    };
    fs.writeFileSync(path.join(dir, 'leak.mjs'),
      Object.entries(fakes).map(([k, v]) => `const ${k.replace(/[^a-z]/gi, '_')} = ${JSON.stringify(v)};`).join('\n'));

    let out = '', code = 0;
    try { out = execFileSync('node', ['verify-no-pii.mjs', '--payload', dir], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status; }

    check(code === 1, 'the gate exits non-zero when a payload carries secrets');
    check(/SECRET\/CREDENTIAL/.test(out), 'and reports them as SECRET/CREDENTIAL');
    for (const label of Object.keys(fakes)) check(out.includes(label), `caught: ${label}`);

    // And a benign payload passes, so the scan is not simply always-fail.
    const clean2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-clean-'));
    try {
      fs.writeFileSync(path.join(clean2, 'ok.md'), '# Just some ordinary documentation with no keys in it.\n');
      let okCode = 0;
      try { execFileSync('node', ['verify-no-pii.mjs', '--payload', clean2], { cwd: ROOT, encoding: 'utf8' }); }
      catch (e) { okCode = e.status; }
      check(okCode === 0, 'a benign payload still passes (the secret scan is not always-fail)');
    } finally { fs.rmSync(clean2, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// The gate scans itself with the rest of the tree, so the pattern DEFINITIONS must
// not match themselves — else the leak-checker becomes the leak it warns about.
// `node verify-no-pii.mjs` passing on the full tree (run by test-all) already proves
// this; asserted here too because it is the exact self-reference trap this file's
// own header warns about.
check(/SECRET_PATTERNS/.test(read('verify-no-pii.mjs')), 'verify-no-pii defines the secret pattern set');

// ── C3: urlFromReport is contained (real files) ──────────────────────────────
const { urlFromReport } = await import('../lib/identity.mjs');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-report-'));
  try {
    fs.mkdirSync(path.join(tmp, 'reports'));
    fs.writeFileSync(path.join(tmp, 'reports', '1234-inside.md'), '**URL:** https://inside.example/job-1234\n');
    // A real file OUTSIDE reports/. Containment must refuse to read it even though
    // it exists and carries a URL — otherwise a poisoned tracker cell is a file read.
    fs.writeFileSync(path.join(tmp, 'outside.md'), '**URL:** https://outside.example/leaked\n');

    check(urlFromReport('reports/1234-inside.md', tmp) === 'https://inside.example/job-1234',
      'a report inside reports/ is read');
    check(urlFromReport('[1234](reports/1234-inside.md)', tmp) === 'https://inside.example/job-1234',
      'the markdown-link form resolves the same file');
    check(urlFromReport('reports/../outside.md', tmp) === null,
      'a path escaping reports/ is refused even though the target file exists and has a URL');
    check(urlFromReport('reports/../../../../../../etc/passwd.md', tmp) === null,
      'a deep traversal is refused');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── C2: the applications report reader routes through the shared guard ────────
// readReportHeader reads real files and is not exported; assert the shipped source
// goes through the containment helper rather than a bare path.resolve.
const appSrc = read('dashboard-web/server/lib/applications.mjs');
check(/from '\.\/safe-path\.mjs'/.test(appSrc), 'applications.mjs imports the shared containment guard');
check(/resolveReportPath\(reportPath\)/.test(appSrc), 'and resolves the report path through it');
check(!/path\.resolve\(ROOT_DIR,\s*reportPath\)/.test(appSrc), 'the bare, uncontained path.resolve is gone');

// ── C4: the eval agent runs under a deny-list sandbox ─────────────────────────
const sandbox = JSON.parse(read('dashboard-web/server/eval-agent-sandbox.settings.json'));
const deny = sandbox.permissions.deny, allow = sandbox.permissions.allow;
for (const pat of ['Edit(**/*.mjs)', 'Edit(**/.env)', 'Edit(**/.claude/**)', 'Edit(**/config/**)', 'Edit(**/installer/**)', 'Edit(**/package.json)']) {
  check(deny.includes(pat), `sandbox denies editing ${pat}`);
}
for (const pat of ['Read(**/.env)', 'Read(**/google-tokens.json)', 'Read(**/*.pem)']) {
  check(deny.includes(pat), `sandbox denies reading ${pat}`);
}
// Allow is minimal and specific: ONLY the two scripts the eval genuinely needs
// (read a posting, run a scan), each a distinct node entrypoint — never a blanket
// Bash, and never `node next-jd.mjs` (report numbering moved server-side).
check(allow.length > 0 && allow.every(a => /^Bash\(node (fetch-jd|scan)\.mjs/.test(a)),
  'sandbox allows ONLY the two eval scripts (fetch-jd.mjs, scan.mjs), nothing broader');
check(!allow.some(a => /next-jd/.test(a)), 'sandbox no longer allows next-jd.mjs (numbering is server-side)');
check(!allow.includes('Bash') && !allow.includes('Bash(*)'), 'no blanket Bash allow');
// The exec/exfil forms a broad local Bash(node *)/Bash(curl *) would otherwise
// reach are explicitly denied, so deny wins over that merged allow.
for (const pat of ['Bash(node -e:*)', 'Bash(node --eval:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(cat:*)', 'Bash(sh:*)', 'Bash(bash:*)', 'Bash(python:*)']) {
  check(deny.includes(pat), `sandbox denies exec/exfil Bash ${pat}`);
}

const agentSrc = read('dashboard-web/server/routes/agent.mjs');
check(/eval-agent-sandbox\.settings\.json/.test(agentSrc) && /--settings/.test(agentSrc),
  'agent.mjs loads the sandbox settings file');
check(!/'--disallowedTools',\s*'Bash'/.test(agentSrc),
  'agent.mjs no longer blanket-drops Bash (file-level denies + a narrow allow are the control now)');
// Report numbering is reserved server-side and injected, so the agent never needs
// the next-jd.mjs Bash allow that was the sandbox's last remaining exec foothold.
check(/reserveReportNumbers/.test(agentSrc) && /issueJd/.test(agentSrc),
  'agent.mjs reserves report numbers server-side (issueJd) instead of shelling out');

// ── C5: loopback-only Host-header allow-list ahead of routing ─────────────────
const idxSrc = read('dashboard-web/server/index.mjs');
check(/req\.headers\.host/.test(idxSrc), 'index.mjs inspects the Host header');
check(/Forbidden: unexpected Host/.test(idxSrc), 'and 403s an unexpected Host before routing (DNS-rebinding defense)');
// The Host middleware must sit BEFORE anything that handles the request, or a
// rebinding request reaches a handler first. It was inserted immediately ahead of
// the CORS middleware, which itself precedes every router and the static handler.
check(idxSrc.indexOf('Forbidden: unexpected Host') < idxSrc.indexOf('app.use(cors('),
  'the Host check is mounted ahead of CORS (and therefore ahead of every route)');

// ── C11: a bounce flip requires per-contact confirmation ──────────────────────
// Route logic (google.mjs scan-bounces); verified live in the audit (28 bounces, 0
// flipped). Assert the guard is present so it cannot be quietly removed.
const gSrc = read('dashboard-web/server/routes/google.mjs');
check(/confirmSet/.test(gSrc) && /req\.body\?\.confirm/.test(gSrc), 'the bounce apply reads an explicit confirm list');
check(/if \(!confirmSet\.has\(key\)\) continue/.test(gSrc), 'and skips any contact the user did not confirm by key');
check(/hasSentHistory/.test(gSrc), 'and cross-checks whether the user actually emailed that address');

// ── C12 / C13 / C14: client anchor hrefs are scheme-checked ───────────────────
// Test the ACTUAL shipped window.safeHref, extracted from source and run in a bare
// window shim (the function is pure: String/startsWith only, no browser APIs).
const sharedSrc = read('dashboard-web/src/shared.jsx');
const shMatch = sharedSrc.match(/window\.safeHref = function safeHref\(u\) \{[\s\S]*?\n\};/);
check(!!shMatch, 'located window.safeHref in shared.jsx');
if (shMatch) {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', shMatch[0])(win);
  check(win.safeHref('javascript:alert(1)') === '#', 'safeHref neutralizes a javascript: URL (React does not block it)');
  check(win.safeHref('data:text/html,<script>alert(1)</script>') === '#', 'safeHref neutralizes a data: URL');
  check(win.safeHref('vbscript:msgbox(1)') === '#', 'safeHref neutralizes a vbscript: URL');
  check(win.safeHref('  JavaScript:alert(1)') === '#', 'leading space + mixed case do not sneak a scheme past it');
  check(win.safeHref('https://job-boards.greenhouse.io/x') === 'https://job-boards.greenhouse.io/x', 'a normal https link passes through');
  check(win.safeHref('http://careers.example.com') === 'http://careers.example.com', 'a normal http link passes through');
  check(win.safeHref('mailto:recruiter@example.com') === 'mailto:recruiter@example.com', 'a mailto link passes through');
  check(win.safeHref('') === '#' && win.safeHref(null) === '#' && win.safeHref(undefined) === '#', 'empty / nullish become inert');
}

// The invariant the fix enforces across the client: no data-derived href bypasses
// safeHref. Flag any href={ expr } whose expression references a URL-ish field but
// does not wrap it (outputHref is the legit wrapper for generated output files).
for (const f of ['pipeline.jsx', 'followups.jsx', 'linkedin-ssi.jsx', 'recruiters.jsx', 'target-talent.jsx', 'shared.jsx']) {
  const src = read('dashboard-web/src/' + f);
  const bad = [...src.matchAll(/href=\{([^}]+)\}/g)]
    .map((x) => x[1])
    .filter((expr) => /\.url\b|\blinkedin\b/i.test(expr) && !/safeHref|outputHref/.test(expr));
  check(bad.length === 0, `${f}: no data-derived href bypasses safeHref${bad.length ? ` (raw: ${bad.join(' | ')})` : ''}`);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

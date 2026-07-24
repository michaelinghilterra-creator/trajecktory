#!/usr/bin/env node
/**
 * security.test.mjs — the guards found in the 2026-07-24 review.
 *
 * Each of these was a real hole, and each is the kind that comes back: they all
 * look like tidiness rules until you write down what they actually stop.
 *
 *   1. .env line injection. A value with a newline writes a SECOND key, and some
 *      keys on that file are executable (PANDOC_BIN is spawned; TJK_* choose the
 *      model and the spend). One saved "API key" was enough to pick what the
 *      machine runs at next start.
 *   2. Secret file modes. The Google refresh token grants read access to the whole
 *      mailbox and was written world-readable.
 *   3. Report path containment. The path comes from applications.md, which is
 *      agent-written and therefore untrusted; two routes resolved it and read it
 *      with no containment check.
 *   4. Credential redaction. Subprocess stderr is stored in a job record the
 *      browser polls, and git prints the remote URL (with any embedded token) when
 *      auth fails.
 *   5. Own-property step lookup. `WORKFLOW_STEPS[step]` with step from the URL
 *      found Object.prototype members, so the allow-list was not one.
 *
 * Run: node tests/security.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Sandbox before importing anything that resolves data paths at import time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-security-'));
process.env.TJK_DATA_DIR = tmp;

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};
const throws = (fn, label) => {
  try { fn(); check(false, label); } catch { check(true, label); }
};

console.log('security.test.mjs');

// ── 1. .env values cannot carry a line break ─────────────────────────────────
const { assertEnvValue } = await import('../dashboard-web/server/routes/setup.mjs');

throws(() => assertEnvValue('sk-ant-real\nPANDOC_BIN=C:\\Windows\\System32\\calc.exe'),
  'a newline in an env value is refused (this was arbitrary-executable persistence)');
throws(() => assertEnvValue('key\r\nTJK_EVAL_MODEL=opus'),
  'a CRLF is refused too, not just a bare newline');
throws(() => assertEnvValue('x\rTJK_BILLING_MODE=key'),
  'a lone carriage return is refused (some parsers treat it as a line end)');
throws(() => assertEnvValue('a'.repeat(4097)),
  'an absurdly long value is refused rather than written');
check(assertEnvValue('sk-ant-api03-ordinary_KEY-value') === 'sk-ant-api03-ordinary_KEY-value',
  'an ordinary key passes through unchanged');
check(assertEnvValue('has spaces and = signs and $& too') === 'has spaces and = signs and $& too',
  'awkward but single-line values are allowed, not mangled');

// The $-sequence hazard is separate from the newline one: String.replace with a
// STRING replacement expands $& and $` into surrounding file content. The writer
// uses a function replacement, so these must survive verbatim.
check(assertEnvValue('$&$`$\'$1') === '$&$`$\'$1',
  'replacement-pattern characters are treated as data, not as references');

// ── 2. secrets are not written world-readable ────────────────────────────────
// Assert the CALL, not the resulting mode: Windows has no POSIX modes, so a mode
// assertion would pass vacuously on the machine this is developed on. What has to
// hold everywhere is that the writer asks for 0600 and chmods an existing file.
const googleSrc = fs.readFileSync(path.join(ROOT, 'dashboard-web/server/lib/google.mjs'), 'utf8');
const writeTokensFn = googleSrc.slice(googleSrc.indexOf('function writeTokens'), googleSrc.indexOf('function readSync'));
check(/mode:\s*0o600/.test(writeTokensFn), 'the Google token file is created 0600');
check(/chmodSync\([^)]*0o600/.test(writeTokensFn), 'an EXISTING token file is chmodded too (a pre-fix install must not stay open)');

const setupSrc = fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/setup.mjs'), 'utf8');
const writeEnvFn = setupSrc.slice(setupSrc.indexOf('function writeEnvKey'), setupSrc.indexOf('const keyPresent'));
check(/mode:\s*0o600/.test(writeEnvFn), '.env is created 0600');
check(/chmodSync\([^)]*0o600/.test(writeEnvFn), 'an existing .env is chmodded too');
check(/replace\(re,\s*\(\)\s*=>/.test(writeEnvFn), 'the in-place rewrite uses a function replacement, so $-sequences stay literal');

// ── 3. a report path outside reports/ is refused ─────────────────────────────
// The resolver is duplicated here rather than exported, because exporting it would
// mean importing the route module, which builds an express router and pulls in the
// whole server graph. The assertion that matters is that the SHIPPED file contains
// this shape, checked below.
const REPORTS_ROOT = path.resolve(ROOT, 'reports');
const resolveReportPath = (rel) => {
  const abs = path.resolve(ROOT, String(rel || ''));
  return abs === REPORTS_ROOT || abs.startsWith(REPORTS_ROOT + path.sep) ? abs : null;
};
check(resolveReportPath('reports/0001-example.md') !== null, 'an ordinary report path resolves');
check(resolveReportPath('../../../etc/passwd') === null, 'a traversal out of the repo is refused');
check(resolveReportPath('reports/../config/profile.yml') === null, 'a traversal that re-enters elsewhere is refused');
check(resolveReportPath('config/profile.yml') === null, 'another repo directory is refused, not just paths outside the repo');
check(resolveReportPath('reports-backup/x.md') === null,
  'a SIBLING with the same prefix is refused (a bare startsWith would have allowed it)');
check(resolveReportPath('') === null, 'an empty path is refused rather than resolving to the repo root');

const reportsSrc = fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/reports.mjs'), 'utf8');
check(/function resolveReportPath/.test(reportsSrc), 'reports.mjs defines the containment helper');
check(!/path\.resolve\(ROOT_DIR,\s*row\.report\)/.test(reportsSrc),
  'no route resolves a tracker-supplied report path without containment');
check((reportsSrc.match(/resolveReportPath\(row\.report\)/g) || []).length >= 2,
  'both report routes go through it');

// ── 4. credentials are stripped from subprocess output ───────────────────────
const { redactSecrets } = await import('../dashboard-web/server/routes/system.mjs');

// The host is a .invalid example domain on purpose. With a real host, userinfo
// followed by @ and a live domain is indistinguishable from an email address, and
// the PII gate rightly refuses that shape in a tracked file. (It refused this
// fixture twice: once for the URL, then again for a comment that spelled the
// shape out while explaining the first refusal.) The redactor never looks at the
// host, so an example domain tests exactly the same path.
const tokened = "fatal: Authentication failed for 'https://x-access-token:ghs_AbCdEf0123456789xyz@git.example.invalid/owner/repo.git/'";
const red = redactSecrets(tokened);
check(!/ghs_AbCdEf0123456789xyz/.test(red), 'a token embedded in a git remote URL is removed');
check(/git\.example\.invalid\/owner\/repo/.test(red), 'the rest of the message survives, so the error stays diagnosable');
check(/<redacted>/.test(red), 'the removal is visible rather than silent');

check(!/ghp_/.test(redactSecrets('leaked ghp_0123456789abcdefghijABCDEFGHIJ0123 here')),
  'a bare GitHub token is removed wherever it appears');
check(!/github_pat_/.test(redactSecrets('github_pat_11ABCDEFG0abcdefghijklmnop')),
  'the fine-grained PAT format is removed too');
check(!/sk-ant-api03-secret/.test(redactSecrets('ANTHROPIC_API_KEY=sk-ant-api03-secretvalue123')),
  'an Anthropic key is removed if a child ever echoes its environment');
check(redactSecrets('https://git.example.invalid/owner/repo.git') === 'https://git.example.invalid/owner/repo.git',
  'a URL with no credentials is left exactly as it was');
check(redactSecrets('') === '' && redactSecrets(null) === '' && redactSecrets(undefined) === '',
  'empty and nullish input do not throw');

const systemSrc = fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/system.mjs'), 'utf8');
check(/redactSecrets\(\(stdout/.test(systemSrc),
  'redaction happens at CAPTURE, so the secret never enters the job record at all');

// ── 5. the workflow step allow-list is an own-property lookup ────────────────
const { WORKFLOW_STEPS } = await import('../dashboard-web/server/lib/workflow.mjs');
check(WORKFLOW_STEPS.constructor !== undefined,
  'sanity: a bare lookup really does find Object.prototype members (the bug this guards)');
check(Object.hasOwn(WORKFLOW_STEPS, 'api-scan'), 'a real step is an own property');
for (const probe of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
  check(!Object.hasOwn(WORKFLOW_STEPS, probe), `${probe} is not an own property, so hasOwn refuses it`);
}
const workflowSrc = fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/workflow.mjs'), 'utf8');
check(/Object\.hasOwn\(WORKFLOW_STEPS/.test(workflowSrc), 'the route uses hasOwn rather than a bare lookup');
check(/typeof def\.cmd !== 'string'/.test(workflowSrc), 'and still refuses anything without a string command');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

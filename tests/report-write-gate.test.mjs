#!/usr/bin/env node
/**
 * report-write-gate.test.mjs — pins the write-time report syntax gate.
 *
 * A report's JSON frontmatter is a single blob emitted by a model, and until this
 * gate existed nothing parsed it between the model and the disk. Report 1869
 * closed the `leadStory` OBJECT with `],` instead of `},`; that one character made
 * the frontmatter unparseable, and because every reader parses all reports in one
 * pass, the single bad file took down the whole read until a health check found it.
 *
 * validateReportMarkdown is deliberately STRICTER than hasV1Frontmatter. That
 * helper sniffs for a "schema" key and falls back to the legacy prose parser when
 * it does not find one, which is right for READING the legacy reports but wrong
 * for a fresh write: a v1 report whose JSON broke before the schema key would
 * sniff as legacy and be parsed as prose, silently dropping every field. These
 * tests pin both halves — real breakage is caught, legacy reports are left alone.
 *
 * Run: node tests/report-write-gate.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { validateReportMarkdown, hasV1Frontmatter } from '../dashboard-web/server/v1-loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('report-write-gate.test.mjs');

const wrap = (json) => `---\n${json}\n---\n# Narrative body\n`;
const good = wrap(JSON.stringify({ schema: 'trajecktory-report/v1', id: 9001, url: 'https://example.com/job', leadStory: { title: 't', reason: 'r', script: 's' } }, null, 2));

// ── the happy path stays quiet ───────────────────────────────────────────────
check(validateReportMarkdown(good, 'reports/9001-ok.md').ok, 'a well-formed v1 report passes');

// ── the exact 1869 failure: object closed with a square bracket ──────────────
const bracketMismatch = [
  '---',
  '{',
  '  "schema": "trajecktory-report/v1",',
  '  "id": 9002,',
  '  "leadStory": {',
  '    "title": "trajecktory",',
  '    "script": "one line"',
  '  ],',                       // ← should be `},` — the bug that shipped
  '  "redFlagQs": []',
  '}',
  '---',
  '# body',
  '',
].join('\n');
const bm = validateReportMarkdown(bracketMismatch, 'reports/9002-bad.md');
check(!bm.ok, 'an object closed with "]," is rejected (the report 1869 failure)');
check(/line 8/.test(bm.error), 'the error names the FILE line, not a byte offset into the frontmatter');
check(/\],/.test(bm.error), 'the error shows the offending line so it can be found without counting bytes');
check(/9002-bad\.md/.test(bm.error), 'the error names the report it came from');

// The offset shift matters: JSON.parse counts from the start of the frontmatter
// BODY, so an unshifted number points one line above the real fault.
check(!/line 7[^0-9]/.test(bm.error), 'the line number is shifted past the opening fence, not left off by one');

// ── an unclosed fence ────────────────────────────────────────────────────────
const unclosed = '---\n{ "schema": "trajecktory-report/v1", "id": 9003 }\n# body with no closing fence\n';
check(!validateReportMarkdown(unclosed, 'reports/9003-x.md').ok, 'a frontmatter fence that is never closed is rejected');

// ── parses, but would be read as prose ───────────────────────────────────────
// This is the same class of loss as a syntax error: hasV1Frontmatter sniffs for
// the schema tag, so a tagless block silently falls through to the legacy parser
// and every frontmatter field is dropped without any error anywhere.
const noSchema = wrap(JSON.stringify({ id: 9004, score: 4.1 }));
check(!hasV1Frontmatter(noSchema), 'precondition: a tagless JSON block does NOT sniff as v1');
check(!validateReportMarkdown(noSchema, 'reports/9004-x.md').ok, 'valid JSON with no "schema" tag is rejected (it would be read as prose and lose every field)');

// ── legacy prose reports are none of this gate\'s business ───────────────────
const legacy = '# Evaluation: Example Co\n\n**URL:** https://example.com/job\n\n## A) Match on CV\n\nSome prose.\n';
check(validateReportMarkdown(legacy, 'reports/0500-legacy.md').ok, 'a legacy prose report (no fence) passes untouched');
const yamlish = '---\ntitle: Something\n---\n\n# body\n';
check(validateReportMarkdown(yamlish, 'reports/0501-yaml.md').ok, 'a non-JSON fenced block is out of scope and passes');

// ── degenerate input ─────────────────────────────────────────────────────────
check(!validateReportMarkdown('', 'reports/9005-empty.md').ok, 'an empty file is rejected');
check(!validateReportMarkdown('   \n', 'reports/9006-blank.md').ok, 'a whitespace-only file is rejected');
check(!validateReportMarkdown(wrap('[1, 2, 3]'), 'reports/9007-arr.md').ok, 'a JSON array as frontmatter is rejected (must be an object)');

// ── the gate agrees with the real read path ──────────────────────────────────
// Anything this gate passes must actually load, or the gate is theater.
const { parseV1 } = await import('../dashboard-web/server/v1-loader.mjs');
check(hasV1Frontmatter(good) && parseV1(good).data.id === 9001, 'a report the gate passes parses cleanly through the real read path');

// -- the PostToolUse hook wrapper --------------------------------------------
// scripts/hook-report-frontmatter.mjs is the outermost guard: it fires on the tool
// call itself, so it covers the write paths the dashboard agent runner cannot see
// (batch/batch-runner.sh, a plain `claude` session). Its contract is narrow and
// easy to break by accident, so pin it: SILENCE is the success signal, and a hook
// that crashes or chatters on an unrelated edit is worse than no hook at all.
const HOOK = path.join(ROOT, 'scripts', 'hook-report-frontmatter.mjs');
const runHook = (payload) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', cwd: ROOT,
  });
  return { out: (r.stdout || '').trim(), code: r.status };
};

const okReport = path.join(REPORTS, '9101-hook-ok.md');
fs.writeFileSync(okReport, good);
const okRun = runHook({ tool_name: 'Write', tool_input: { file_path: 'reports/9101-hook-ok.md' } });
check(okRun.out === '' && okRun.code === 0, 'hook stays silent on a valid report');

// The report 1869 shape, end to end through the hook.
const badReport = path.join(REPORTS, '9102-hook-bad.md');
fs.writeFileSync(badReport, bracketMismatch);
const badRun = runHook({ tool_name: 'Write', tool_input: { file_path: 'reports/9102-hook-bad.md' } });
let parsedBad = null;
try { parsedBad = JSON.parse(badRun.out); } catch { /* stays null, asserted below */ }
check(parsedBad !== null, 'hook emits parseable JSON on a malformed report');
check(parsedBad !== null && parsedBad.decision === 'block', 'hook blocks so the writing agent is told to repair it');
check(parsedBad !== null && /line 8/.test(parsedBad.reason || ''), 'the block reason carries the file line');
check(badRun.code === 0, 'hook exits 0 even when blocking (the JSON carries the verdict, not the exit code)');

// Everything below must be a silent no-op. These fire on ORDINARY edits, so any
// output would be noise on every unrelated file an agent touches.
const quietCases = [
  ['a source file outside reports/',  { tool_name: 'Edit',  tool_input: { file_path: 'lib/score.mjs' } }],
  ['a path escaping reports/ via ..', { tool_name: 'Write', tool_input: { file_path: 'reports/../data/applications.md' } }],
  ['a non-markdown file in reports/', { tool_name: 'Write', tool_input: { file_path: 'reports/notes.txt' } }],
  ['a report that does not exist',    { tool_name: 'Write', tool_input: { file_path: 'reports/9199-gone.md' } }],
  ['a payload with no file_path',     { tool_name: 'Bash',  tool_input: { command: 'ls' } }],
  ['malformed stdin',                 'not json at all'],
  ['empty stdin',                     ''],
];
for (const [label, payload] of quietCases) {
  const r = runHook(payload);
  check(r.out === '' && r.code === 0, `hook is a silent no-op on ${label}`);
}

fs.unlinkSync(okReport);
fs.unlinkSync(badReport);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

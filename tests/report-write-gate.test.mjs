#!/usr/bin/env node
/**
 * report-write-gate.test.mjs — pins the write-time report syntax gate.
 *
 * A report's JSON frontmatter is a single blob emitted by a model, and until this
 * gate existed nothing parsed it between the model and the disk. Report 9001
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
import { validateReportMarkdown, validateReportShape, hasV1Frontmatter } from '../dashboard-web/server/v1-loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('report-write-gate.test.mjs');

const wrap = (json) => `---\n${json}\n---\n# Narrative body\n`;
const good = wrap(JSON.stringify({ schema: 'trajecktory-report/v1', id: 9001, url: 'https://example.com/job', leadStory: { title: 't', reason: 'r', script: 's' } }, null, 2));

const validShapeData = {
  schema: 'trajecktory-report/v1',
  id: 900001,
  company: 'Example Co',
  role: 'Example Director',
  domain: 'Example Software',
  url: 'https://example.com/jobs/900001',
  date: '2030-01-01',
  jdSnapshot: 'jds/900001-example-co.md',
  globalScore: [
    { key: 'fit', dim: 'Fit', val: 4, max: 5, evidence: 'Relevant example experience' },
    { key: 'northStar', dim: 'North Star', val: 4, max: 5, evidence: 'Matches the example target' },
    { key: 'level', dim: 'Level', val: 4, max: 5, evidence: 'Scope matches the example level' },
    { key: 'comp', dim: 'Comp', val: 3, max: 5, evidence: 'Example range is disclosed' },
    { key: 'location', dim: 'Location', val: 5, max: 5, evidence: 'Example role is remote' },
    { key: 'buildDepth', dim: 'Build Depth', val: 4, max: 5, evidence: 'Example work includes building' },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5, evidence: 'No example warning signs' },
  ],
  comp: { stated: 'Example range not disclosed', sources: [], walkaway: 100 },
  legitimacy: { tier: 'High Confidence', signals: [] },
};
const validShaped = wrap(JSON.stringify(validShapeData, null, 2));
const changed = (patch) => ({ ...validShapeData, ...patch });

// ── the happy path stays quiet ───────────────────────────────────────────────
check(validateReportMarkdown(good, 'reports/9001-ok.md').ok, 'a well-formed v1 report passes');

check(validateReportShape(validShapeData).ok, 'the exported shape validator accepts a complete canonical report');
check(validateReportMarkdown(validShaped, 'reports/900001-shaped.md', { shape: true }).ok, 'a fully shaped report passes the opt-in gate');

const mapShapeData = changed({ globalScore: { fit: 3, level: 5 } });
const mapShape = wrap(JSON.stringify(mapShapeData));
const mapVerdict = validateReportMarkdown(mapShape, 'reports/900002-map.md', { shape: true });
check(!mapVerdict.ok && mapVerdict.kind === 'shape' && /object map/.test(mapVerdict.error), 'an object-map globalScore fails with an explicit object map error');

const listedVerdict = validateReportMarkdown(wrap(JSON.stringify(changed({ comp: { listed: '$100K' } }))), 'reports/900003-comp.md', { shape: true });
check(!listedVerdict.ok && /rename "listed" to "stated"/.test(listedVerdict.error), 'comp.listed fails with a rename-to-stated instruction');

const summaryVerdict = validateReportMarkdown(wrap(JSON.stringify(changed({ summary: 'text' }))), 'reports/900004-summary.md', { shape: true });
check(!summaryVerdict.ok && /summary:.*expected an object/.test(summaryVerdict.error), 'summary as a string fails');
const cvMatchVerdict = validateReportMarkdown(wrap(JSON.stringify(changed({ cvMatch: ['text'] }))), 'reports/900005-cv.md', { shape: true });
check(!cvMatchVerdict.ok && /cvMatch:.*array of objects/.test(cvMatchVerdict.error), 'cvMatch string items fail');
const signalsVerdict = validateReportMarkdown(wrap(JSON.stringify(changed({ legitimacy: { tier: 'High Confidence', signals: ['text'] } }))), 'reports/900006-signals.md', { shape: true });
check(!signalsVerdict.ok && /legitimacy\.signals:.*array of objects/.test(signalsVerdict.error), 'legitimacy signal strings fail');
const tierVerdict = validateReportMarkdown(wrap(JSON.stringify(changed({ legitimacy: { tier: 'Tier 1', signals: [] } }))), 'reports/900007-tier.md', { shape: true });
check(!tierVerdict.ok && /legitimacy\.tier:.*Tier 1/.test(tierVerdict.error), 'a non-canonical legitimacy tier fails');

const missingEvidence = structuredClone(validShapeData);
delete missingEvidence.globalScore[0].evidence;
check(/evidence/.test(validateReportMarkdown(wrap(JSON.stringify(missingEvidence)), 'reports/900008-evidence.md', { shape: true }).error || ''), 'a score entry missing evidence fails');
const unknownKey = structuredClone(validShapeData);
unknownKey.globalScore[0].key = 'culture';
check(/canonical score key/.test(validateReportMarkdown(wrap(JSON.stringify(unknownKey)), 'reports/900009-key.md', { shape: true }).error || ''), 'an unknown globalScore key fails');
const duplicateKey = structuredClone(validShapeData);
duplicateKey.globalScore[1].key = 'fit';
check(/duplicate "fit"/.test(validateReportMarkdown(wrap(JSON.stringify(duplicateKey)), 'reports/900010-duplicate.md', { shape: true }).error || ''), 'a duplicate globalScore key fails');
const aboveMax = structuredClone(validShapeData);
aboveMax.globalScore[0].val = 6;
check(/0 <= val <= max/.test(validateReportMarkdown(wrap(JSON.stringify(aboveMax)), 'reports/900011-max.md', { shape: true }).error || ''), 'a score value above max fails');

const exemptMap = { ...mapShapeData, date: '2020-01-01' };
check(validateReportMarkdown(wrap(JSON.stringify(exemptMap)), 'reports/900012-old.md', { shape: true }).ok, 'a map-shaped report before the enforcement date is exempt');
const noDateMap = { ...mapShapeData };
delete noDateMap.date;
check(!validateReportMarkdown(wrap(JSON.stringify(noDateMap)), 'reports/900013-no-date.md', { shape: true }).ok, 'a map-shaped report with no date is enforced');
check(validateReportMarkdown(mapShape, 'reports/900014-no-opts.md').ok, 'the map-shaped report passes without shape opts');

const manyViolations = {
  schema: 'trajecktory-report/v1', date: '2030-01-02',
  summary: 'bad', levelMatch: 'bad', leadStory: 'bad', comp: 'bad',
  cvMatch: ['bad'], gaps: ['bad'], sellSenior: ['bad'], customizationCV: ['bad'],
  customizationLI: ['bad'], starStories: ['bad'], redFlagQs: ['bad'], keywords: [1],
  recommendation: 1, downlevelPlan: 1,
};
const manyVerdict = validateReportMarkdown(wrap(JSON.stringify(manyViolations)), 'reports/900015-many.md', { shape: true });
check(!manyVerdict.ok && /\n- \.\.\.and \d+ more$/.test(manyVerdict.error), 'more than 12 shape violations produce the truncated tail');

// ── the exact 9001 failure: object closed with a square bracket ──────────────
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
check(!bm.ok, 'an object closed with "]," is rejected (the report 9001 failure)');
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
const hookSandbox = makeRepoSandbox(ROOT, 'report-write-gate');
fs.mkdirSync(path.join(hookSandbox, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(hookSandbox, 'dashboard-web', 'server'), { recursive: true });
fs.mkdirSync(path.join(hookSandbox, 'reports'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'hook-report-frontmatter.mjs'), path.join(hookSandbox, 'scripts', 'hook-report-frontmatter.mjs'));
fs.copyFileSync(path.join(ROOT, 'dashboard-web', 'server', 'v1-loader.mjs'), path.join(hookSandbox, 'dashboard-web', 'server', 'v1-loader.mjs'));
fs.cpSync(path.join(ROOT, 'lib'), path.join(hookSandbox, 'lib'), { recursive: true });
const HOOK = path.join(hookSandbox, 'scripts', 'hook-report-frontmatter.mjs');
const REPORTS = path.join(hookSandbox, 'reports');
const runHook = (payload) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', cwd: hookSandbox,
  });
  return { out: (r.stdout || '').trim(), code: r.status };
};

const okReport = path.join(REPORTS, '900001-hook-ok.md');
fs.writeFileSync(okReport, validShaped);
const okRun = runHook({ tool_name: 'Write', tool_input: { file_path: 'reports/900001-hook-ok.md' } });
check(okRun.out === '' && okRun.code === 0, 'hook stays silent on a valid report');

// The report 9001 shape, end to end through the hook.
const badReport = path.join(REPORTS, '9102-hook-bad.md');
fs.writeFileSync(badReport, bracketMismatch);
const badRun = runHook({ tool_name: 'Write', tool_input: { file_path: 'reports/9102-hook-bad.md' } });
let parsedBad = null;
try { parsedBad = JSON.parse(badRun.out); } catch { /* stays null, asserted below */ }
check(parsedBad !== null, 'hook emits parseable JSON on a malformed report');
check(parsedBad !== null && parsedBad.decision === 'block', 'hook blocks so the writing agent is told to repair it');
check(parsedBad !== null && /line 8/.test(parsedBad.reason || ''), 'the block reason carries the file line');
check(badRun.code === 0, 'hook exits 0 even when blocking (the JSON carries the verdict, not the exit code)');

const shapeReport = path.join(REPORTS, '900016-hook-shape.md');
fs.writeFileSync(shapeReport, mapShape);
const shapeRun = runHook({ tool_name: 'Write', tool_input: { file_path: 'reports/900016-hook-shape.md' } });
let parsedShape = null;
try { parsedShape = JSON.parse(shapeRun.out); } catch { /* stays null, asserted below */ }
check(parsedShape !== null && parsedShape.decision === 'block', 'hook blocks a shape-invalid report');
check(parsedShape !== null && /does not match the report schema/.test(parsedShape.reason || ''), 'shape block reason explains that the parsed report misses the schema');
check(parsedShape !== null && /templates\/report-schema-v1\.md/.test(parsedShape.reason || ''), 'shape block reason points to the report schema');

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
fs.unlinkSync(shapeReport);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

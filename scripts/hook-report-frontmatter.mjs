#!/usr/bin/env node
/**
 * hook-report-frontmatter.mjs — Claude Code PostToolUse gate for reports/.
 *
 * WHY THIS EXISTS
 * A report's JSON frontmatter is one blob emitted by a model. Report 1869 closed
 * the `leadStory` OBJECT with `],` instead of `},`; that single character made the
 * frontmatter unparseable, and because every reader parses all reports in one
 * pass, the one bad file took down the whole read. It sat on disk until the next
 * health check.
 *
 * The dashboard's agent runner already checks reports it writes (see
 * dashboard-web/server/routes/agent.mjs). This hook covers what that cannot see:
 * batch/batch-runner.sh, a plain `claude` session, any path that writes a report
 * without going through the server. It fires on the tool call itself, so there is
 * no path left where a broken report reaches disk unnoticed.
 *
 * CONTRACT
 * stdin  — the PostToolUse payload: { tool_name, tool_input:{file_path,...}, ... }
 * stdout — nothing at all when the file is fine (silence is the success signal),
 *          or a JSON object with decision:"block" so the model is told to fix it.
 * exit   — always 0. A hook that crashes must never wedge an unrelated edit, so
 *          every failure mode here degrades to "say nothing and get out of the way".
 *
 * Validation itself is NOT reimplemented here — it imports the same
 * validateReportMarkdown the dashboard and the read path use, so there is exactly
 * one definition of what a valid report is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Silence is the success signal — used for "fine", "not a report", and every
// internal failure. Never throws, never writes to stderr.
function quiet() { process.exit(0); }

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    // No stdin at all (someone ran this by hand) resolves empty rather than hanging.
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
  });
}

const raw = await readStdin();
let payload;
try { payload = JSON.parse(raw); } catch { quiet(); }
if (!payload || typeof payload !== 'object') quiet();

// Write reports the path in tool_input; some tools echo it back on the response.
const filePath =
  (payload.tool_input && payload.tool_input.file_path) ||
  (payload.tool_response && payload.tool_response.filePath) || '';
if (typeof filePath !== 'string' || !filePath) quiet();

// The hook can be registered from more than one project root — this repo, or a
// workspace one level up that holds it — so a RELATIVE file_path means different
// things depending on which session fired. Absolute paths (what the Write and Edit
// tools actually pass) need no base at all; for the relative case, try the cwd
// first and this repo second, and take whichever lands inside reports/.
// Containment is checked on the resolved path, so a `../` escape is rejected here
// rather than reaching readFileSync.
const REPORTS = path.join(ROOT, 'reports');
function reportRelPath(p) {
  const bases = path.isAbsolute(p) ? [null] : [process.cwd(), ROOT];
  for (const base of bases) {
    const abs = base === null ? path.normalize(p) : path.resolve(base, p);
    const rel = path.relative(REPORTS, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) continue;
    if (!/\.md$/i.test(rel)) continue;
    return { abs, rel };
  }
  return null;
}

const target = reportRelPath(filePath);
if (!target) quiet();
const { abs, rel } = target;

// PostToolUse runs AFTER the write, so the bytes that actually landed are on disk.
// That covers Edit too, whose tool_input carries only a diff.
let md;
try { md = fs.readFileSync(abs, 'utf8'); } catch { quiet(); }

let verdict;
try {
  const { validateReportMarkdown } = await import(
    new URL('../dashboard-web/server/v1-loader.mjs', import.meta.url)
  );
  verdict = validateReportMarkdown(md, `reports/${rel}`);
} catch {
  // The validator moved or the checkout is partial. Not the writer's problem.
  quiet();
}
if (!verdict || verdict.ok) quiet();

// decision:"block" feeds `reason` back to the model and lets the turn continue, so
// the agent that wrote the report is the one that repairs it, while the run is
// still live and the content is still in context.
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason:
    `The report you just wrote has broken JSON frontmatter and cannot be loaded by the dashboard.\n\n` +
    `${verdict.error}\n\n` +
    `Fix that line in reports/${rel} now. The frontmatter must be one JSON object between the "---" fences, ` +
    `carrying "schema": "trajecktory-report/v1". Do not continue to the next step until it parses.`,
  systemMessage: `Report frontmatter is malformed and was flagged for repair: ${verdict.error}`,
}));
process.exit(0);

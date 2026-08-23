#!/usr/bin/env node
/**
 * pipeline.test.mjs — unit tests for lib/pipeline.mjs, the single owner of
 * data/pipeline.md checkbox state.
 *
 * Every assertion here reproduces a REAL incident from the "triage wrote nothing /
 * queue clogged" cluster (four in ten days). If any of these regress, this suite
 * goes red in test-all instead of the user discovering it days later through an
 * empty triage run.
 *
 * Run: node tests/pipeline.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { canonicalUrl } from '../lib/identity.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';
import {
  parsePipelineRow, readPipelineRows, markDone, handledOpenRows, reconcileHandled, sourceUrlOf, pipelineInbox,
} from '../lib/pipeline.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const dir = makeSandbox("pipeline-test");
function fixture(name, content) { const p = join(dir, name); writeFileSync(p, content, 'utf8'); return p; }

console.log('pipeline.test.mjs');

// ── parsing ───────────────────────────────────────────────────────────────────
check(parsePipelineRow('- [ ] https://x.com/1 | Co | Title').state === 'open', 'LF open row parses as open');
check(parsePipelineRow('- [x] https://x.com/1').state === 'done', '[x] parses as done');
check(parsePipelineRow('- [!] https://x.com/1 — gated').state === 'dead', '[!] parses as dead');
check(parsePipelineRow('- [ ] local:jds/foo.md | Co | T').url === 'local:jds/foo.md', 'local: URL captured');
check(parsePipelineRow('# a heading') === null, 'non-row returns null');
{
  const r = parsePipelineRow('- [ ] https://x.com/1 | Co\r');
  check(r && r.cr === true && r.url === 'https://x.com/1', 'trailing \\r is detected, not swallowed into the URL');
}

// ── INCIDENT 1: CRLF rows were silently skipped by the old "(.*)$" regex ────────
{
  const url = 'https://acme.com/jobs/42';
  const file = fixture('crlf.md', `# Pipeline\r\n- [ ] ${url} | Acme | Role\r\n- [ ] https://other.com/9 | Other | R\n`);
  const flipped = markDone(file, [canonicalUrl(url)]);
  const out = readFileSync(file, 'utf8');
  check(flipped === 1, 'markDone flips a CRLF row (the core recurring bug)');
  check(out.includes(`- [x] ${url} | Acme | Role\r\n`), 'flipped CRLF row keeps its \\r\\n ending');
  check(out.includes('- [ ] https://other.com/9 | Other | R\n'), 'untouched LF row keeps its bare \\n ending (no ending drift)');
}

// ── INCIDENT 2: local:jds/ rows were ignored by http-only matchers ──────────────
{
  const file = fixture('local.md', `- [ ] local:jds/foo.md | Co | Title\n`);
  const flipped = markDone(file, [canonicalUrl('local:jds/foo.md')]);
  check(flipped === 1, 'markDone flips a local:jds/ row');
  check(readFileSync(file, 'utf8').startsWith('- [x] local:jds/foo.md'), 'local: row is checked off');
}

// ── markDone only touches OPEN rows, and is idempotent ──────────────────────────
{
  const url = 'https://acme.com/x';
  const file = fixture('states.md', `- [x] ${url}\n- [!] https://d.com/1 — gated\n- [ ] https://n.com/2 | N | R\n`);
  check(markDone(file, [canonicalUrl(url)]) === 0, 'markDone does not re-flip an already-done row');
  check(markDone(file, [canonicalUrl('https://d.com/1')]) === 0, 'markDone never un-gates a "- [!]" row');
  markDone(file, [canonicalUrl('https://n.com/2')]);
  const again = markDone(file, [canonicalUrl('https://n.com/2')]);
  check(again === 0, 'markDone is idempotent (second call flips nothing)');
}

// ── INCIDENT 2b: evaluated local: rows bridge to the tracker via Source URL ──────
{
  mkdirSync(join(dir, 'jds'), { recursive: true });
  writeFileSync(join(dir, 'jds/bar.md'), '# Role\n\n**Source URL:** https://real.co/posting/7\n', 'utf8');
  const file = fixture('bridge.md', '- [ ] local:jds/bar.md | Co | T\n- [ ] local:jds/new.md | Co | New\n');
  const handled = new Set([canonicalUrl('https://real.co/posting/7')]); // tracker stores the REAL url
  const rows = handledOpenRows(file, handled, dir);
  check(rows.length === 1 && rows[0].url === 'local:jds/bar.md', 'an evaluated local: row is matched via its snapshot Source URL');
}

// ── sourceUrlOf, exported directly (2026-08-06: the dashboard's triage-results
// view hit this exact gap outside pipeline.md — a triage card scored under a
// local:jds/ snapshot never suppressed once the role was deep-dived, because
// the tracker holds the real URL and nothing resolved the snapshot back to it) ─
{
  check(sourceUrlOf('local:jds/bar.md', dir) === canonicalUrl('https://real.co/posting/7'),
    'sourceUrlOf resolves a local:jds/ url to its snapshot Source URL, canonicalized');
  check(sourceUrlOf('https://real.co/posting/7', dir) === null,
    'sourceUrlOf returns null for a non-local: url (nothing to resolve)');
  check(sourceUrlOf('local:jds/does-not-exist.md', dir) === null,
    'sourceUrlOf returns null (not throws) for a missing snapshot file');
  check(sourceUrlOf('local:jds/bar.md', null) === null,
    'sourceUrlOf returns null when no rootDir is given, rather than throwing');
}

// Three real header formats coexist in jds/, from three different ingestion
// paths built at different times. Matching only the newest ("**Source URL:**")
// left every older-batch snapshot unresolvable — the bug this test pins.
{
  writeFileSync(join(dir, 'jds/ashby-batch.md'), '# Role\n\n**URL:** https://ashby.example/posting/1\n', 'utf8');
  check(sourceUrlOf('local:jds/ashby-batch.md', dir) === canonicalUrl('https://ashby.example/posting/1'),
    'sourceUrlOf resolves the "**URL:**" header format (an earlier Ashby-pull batch)');

  writeFileSync(join(dir, 'jds/obsidian-batch.md'), '# Role\nURL: https://obsidian.example/posting/2\n', 'utf8');
  check(sourceUrlOf('local:jds/obsidian-batch.md', dir) === canonicalUrl('https://obsidian.example/posting/2'),
    'sourceUrlOf resolves a bare "URL:" header with no markdown bold at all (the original Obsidian-clip ingestion)');
}

// ── INCIDENT 3+4: dismissed rows stayed open forever → reconcileHandled closes them
{
  const kept = 'https://keep.com/new';
  const gone = 'https://dismissed.com/old';
  const file = fixture('reconcile.md', `- [ ] ${gone} | X | Dismissed\r\n- [ ] ${kept} | Y | New\n`);
  const dismissed = fixture('dismissed.tsv', `url\tdate\n${gone}\t2026-08-06\n`);
  const apps = fixture('apps.md', '# Applications Tracker\n');

  const dry = reconcileHandled(file, { appsPath: apps, dismissedPath: dismissed, rootDir: dir, apply: false });
  check(dry.flipped === 1, 'dry-run reports the dismissed-but-open row as a violation');
  check(readFileSync(file, 'utf8').includes(`- [ ] ${gone}`), 'dry-run does NOT write (invariant is read-only)');

  const wet = reconcileHandled(file, { appsPath: apps, dismissedPath: dismissed, rootDir: dir, apply: true });
  const out = readFileSync(file, 'utf8');
  check(wet.flipped === 1, 'apply flips exactly the dismissed row');
  check(out.includes(`- [x] ${gone} | X | Dismissed\r\n`), 'dismissed CRLF row checked off, ending preserved');
  check(out.includes(`- [ ] ${kept} | Y | New\n`), 'the genuinely-new row is left open');
  check(readPipelineRows(file, 'open').length === 1, 'exactly one open row remains after reconcile');
}

// ── The eval agent no longer edits pipeline.md; the post-run pass marks its rows ─
// done from the STAGED tracker TSV (evaluated, pre-Merge) and needs-manual-jd.tsv
// (deferred). This is what replaced the removed, race-prone LLM self-mark.
{
  const ws = makeSandbox("pipeline-eval");
  mkdirSync(join(ws, 'reports'), { recursive: true });
  mkdirSync(join(ws, 'batch/tracker-additions/merged'), { recursive: true });
  mkdirSync(join(ws, 'data'), { recursive: true });

  const evaled = 'https://acme.com/jobs/900';
  const deferred = 'https://workday.com/jobs/xyz';
  const fresh = 'https://new.com/1';

  // A report written this run (v1 frontmatter carries the real URL), and its
  // STAGED tracker TSV (not yet merged) with the report link in column 7.
  writeFileSync(join(ws, 'reports/900-acme-2026-08-06.md'), `\`\`\`json\n{"url":"${evaled}","score":4.1}\n\`\`\`\n\n# Acme\n`, 'utf8');
  writeFileSync(join(ws, 'batch/tracker-additions/900-acme.tsv'),
    `900\t2026-08-06\tAcme\tRevOps\tEvaluated\t4.1/5\t✅\t[900](reports/900-acme-2026-08-06.md)\tstrong\n`, 'utf8');
  // A posting the eval could not read → deferred to manual paste (URL in col 0).
  writeFileSync(join(ws, 'data/needs-manual-jd.tsv'), `url\tcompany\trole\n${deferred}\tWorkday Co\tRevOps\n`, 'utf8');

  const pipe = join(ws, 'data/pipeline.md');
  writeFileSync(pipe, `- [ ] ${evaled} | Acme | RevOps\r\n- [ ] ${deferred} | Workday Co | RevOps\n- [ ] ${fresh} | New | R\n`, 'utf8');

  const r = reconcileHandled(pipe, {
    appsPath: join(ws, 'data/applications.md'),          // absent: nothing merged yet
    dismissedPath: join(ws, 'data/triage-dismissed.tsv'), // absent
    additionsDir: join(ws, 'batch/tracker-additions'),
    needsManualPath: join(ws, 'data/needs-manual-jd.tsv'),
    rootDir: ws,
    apply: true,
  });
  const out = readFileSync(pipe, 'utf8');
  check(r.flipped === 2, 'reconcile closes the staged-evaluated AND the deferred row (no LLM edit needed)');
  check(out.includes(`- [x] ${evaled}`), 'staged-but-unmerged evaluated row is checked off from its tracker TSV');
  check(out.includes(`- [x] ${deferred}`), 'deferred (needs-manual) row is checked off');
  check(out.includes(`- [ ] ${fresh}`), 'a genuinely-new row is still left open');
}

// ── pipelineInbox (Discovery Inbox grouping) ─────────────────────────────────
// Groups the queue into what the dashboard shows so a discovered role is never
// invisible: pending ("- [ ]"), gated-with-reason ("- [!]"), and a done count.
{
  const md = [
    '## Pendientes', '',
    '- [ ] local:jds/e.md | Globex | Senior Director, GTM',
    '- [ ] https://jobs.ashbyhq.com/x/abc | Initech | Revenue Operations Lead',
    '- [!] https://job-boards.greenhouse.io/x/jobs/1 | Hooli | Director, GTM Ops — gated: unsupported ATS platform',
    '- [x] local:jds/o.md | Acme | Sales Operations Manager',
  ].join('\n');
  const inbox = pipelineInbox(md);
  check(inbox.counts.pending === 2 && inbox.counts.gated === 1 && inbox.counts.done === 1,
    'pipelineInbox groups rows by state (2 pending, 1 gated, 1 done)');
  check(inbox.pending[0].readable === true && inbox.pending[1].readable === false,
    'pending readable flag distinguishes a local:jds snapshot from a raw ATS URL');
  check(inbox.gated[0].title === 'Director, GTM Ops' && /unsupported ATS platform/.test(inbox.gated[0].reason),
    'gated row splits the title from its gate reason');
  check(inbox.pending[0].company === 'Globex' && inbox.pending[0].title === 'Senior Director, GTM',
    'pending row parses company + title');
  check(pipelineInbox('').counts.pending === 0, 'empty pipeline text is an empty inbox (no throw)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

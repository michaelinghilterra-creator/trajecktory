#!/usr/bin/env node
// verify-reports.mjs — health check for the dashboard drawer
//
// Runs every report in `reports/` through the dashboard parser and flags
// any that produce empty rendered output for a section that exists in
// the .md file. Catches format drift between batch agents and the parser
// BEFORE the user sees a broken drawer.
//
// Usage:
//   node verify-reports.mjs               # check all reports
//   node verify-reports.mjs --recent 30   # only check the 30 newest
//   node verify-reports.mjs --json        # machine-readable output
//
// Exit code 0 if all reports parse cleanly, 1 if any section has data
// in the .md but produces nothing in the parsed object.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseReport } from './dashboard-web/server/parser.mjs';
import { hasV1Frontmatter, parseV1, v1ToCheatsheet } from './dashboard-web/server/v1-loader.mjs';
import { reconcileHandled } from './lib/pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(__dirname, 'reports');

const args = process.argv.slice(2);
const recentN = args.includes('--recent') ? parseInt(args[args.indexOf('--recent') + 1], 10) : null;
const jsonOut = args.includes('--json');

// True if the section has at least one numbered/bulleted item or table row
// AND the section is NOT a "not applicable / do not apply" stub (those are correctly empty)
const hasListContent = (sectionText) => {
  if (!sectionText) return false;
  // Skip sections explicitly marked as not applicable / do not customize
  // (these reports correctly produce empty parsed output for low-fit roles)
  const head = sectionText.slice(0, 400).replace(/\*\*/g, '');
  if (/^\s*(?:not applicable|not recommended|do not (?:customize|apply|pursue)|recommend(?:ation)?[:\s]+do not|## E\) Logistics)/im.test(head)) {
    return false;
  }
  const lines = sectionText.split('\n');
  // Bullet/numbered item OR table row (not a separator)
  return lines.some(l => /^\s*(?:\d+\.|[-*•])\s+\S/.test(l)) ||
         lines.filter(l => /^\|.+\|/.test(l.trim()) && !/^\|[-:|\s]+\|$/.test(l.trim())).length >= 2;
};

const extractSection = (md, letter) => {
  const start = new RegExp(`^##\\s+(block\\s+|bloque\\s+|blok\\s+)?${letter}([).\\s—\\-]|$)`, 'im');
  const m = md.match(start);
  if (!m) return null;
  const startIdx = md.indexOf(m[0]);
  const headingLine = md.slice(startIdx, md.indexOf('\n', startIdx));
  // Skip old-format sections that re-use the letter for a different topic
  // (e.g., "## E) Logistics" instead of customization)
  const semanticByLetter = {
    D: /(comp|demand|salary|compensation)/i,
    E: /(custom|personali|tailoring|cv\s+change)/i,
    F: /(interview|star|stor)/i,
    G: /(legitima|posting|verify|verification|signal)/i,
  };
  const expected = semanticByLetter[letter];
  if (expected && !expected.test(headingLine)) return null;
  const rest = md.slice(startIdx + m[0].length);
  const next = rest.match(/\n##\s+(block\s+|bloque\s+|blok\s+)?[A-Z][).\s—\-]/i);
  return next ? rest.slice(0, next.index) : rest;
};

// Fresh install has no reports/ directory yet — nothing to verify, exit clean.
if (!fs.existsSync(REPORTS)) {
  console.log('No reports/ directory yet — nothing to verify.');
  process.exit(0);
}
let files = fs.readdirSync(REPORTS)
  .filter(f => /^\d+.*\.md$/.test(f))
  .sort((a, b) => parseInt(b) - parseInt(a));
if (recentN) files = files.slice(0, recentN);

// An unexpanded template/shell variable in a report url means a batch wrote a
// literal like `local:...\...$file` — the substitution never ran. That
// string is not a real path and, worse, the SAME literal stands in for many
// files, so it silently collides unrelated postings onto one identity (this is
// exactly what orphaned five evaluations on 2026-08-10). canonicalUrl now treats
// such a url as unresolvable, but the bad DATA still needs a loud, same-day
// failure so it is fixed at the source instead of quietly becoming a url-less row.
// Linear on every branch — the mustache branch matches the opening `{{` only, not
// `{{.*?}}` (whose lazy inner match is a polynomial-ReDoS sink on report urls that
// originate from scanned, untrusted sources). Mirrors canonicalUrl in lib/identity.mjs.
const TEMPLATE_VAR = /\$\{?\w+\}?|%\w+%|\{\{/;
const badUrlReports = [];
function reportUrlOf(md) {
  if (hasV1Frontmatter(md)) { try { return parseV1(md).data.url || null; } catch { return null; } }
  const m = md.match(/^\*\*URL:\*\*\s*(\S+)/m);
  return m ? m[1] : null;
}

const results = [];
for (const file of files) {
  const md = fs.readFileSync(path.join(REPORTS, file), 'utf8');
  const num = file.match(/^(\d+)/)[1];
  const rurl = reportUrlOf(md);
  if (rurl && /^local:/i.test(rurl) && TEMPLATE_VAR.test(rurl)) badUrlReports.push({ num, file, url: rurl });
  const v1 = hasV1Frontmatter(md) ? parseV1(md).data : null;
  const cs = v1 ? v1ToCheatsheet(v1) : parseReport(md);

  // Block A is always present; the Overview tab needs companyBrief + keywords to look complete
  const hasBlockA = !!extractSection(md, 'A');

  // In a v1 report `summary` (which carries companyBrief) and `keywords` are
  // OPTIONAL sections — templates/report-schema-v1.md says to omit them when not
  // generated — so a report that never produced them is complete, not drifted.
  // Presence of a "## A)" heading cannot stand in for them either: under v1, A is
  // "Match on CV", not a role summary. Real drift for a v1 report is the
  // frontmatter CARRYING the field while the conversion drops it, so check the
  // frontmatter itself. Legacy prose reports keep the Block A test.
  const hasBriefSource    = v1 ? !!v1.summary?.companyBrief    : hasBlockA;
  const hasKeywordsSource = v1 ? (v1.keywords?.length || 0) > 0 : hasBlockA;

  const checks = [
    { letter: 'A', name: 'CompanyBrief',  hasMd: hasBriefSource,
      hasParsed: !!cs.companyBrief },
    { letter: 'A', name: 'Keywords',      hasMd: hasKeywordsSource,
      hasParsed: (cs.keywords?.length || 0) > 0 },
    { letter: 'D', name: 'Comp',          hasMd: hasListContent(extractSection(md, 'D')) || /\$[\d,]+K?/.test(extractSection(md, 'D') || ''),
      hasParsed: (cs.comp?.stated || cs.comp?.market || (cs.comp?.sources?.length > 0)) },
    { letter: 'E', name: 'Customize',     hasMd: hasListContent(extractSection(md, 'E')),
      hasParsed: (cs.customizationCV?.length > 0 || cs.customizationLI?.length > 0) },
    { letter: 'F', name: 'Interview',     hasMd: hasListContent(extractSection(md, 'F')),
      hasParsed: (cs.starStories?.length > 0) },
    { letter: 'G', name: 'Legitimacy',    hasMd: hasListContent(extractSection(md, 'G')) || /\*\*tier/i.test(extractSection(md, 'G') || ''),
      hasParsed: (cs.legitimacySignals?.length > 0) },
  ];

  const drift = checks.filter(c => c.hasMd && !c.hasParsed);
  if (drift.length > 0) {
    results.push({ file, num, drift: drift.map(d => `${d.letter}:${d.name}`) });
  }
}

// ── Pipeline queue invariant ─────────────────────────────────────────────────
// The recurring "triage wrote nothing" bug was always the same shape: a pipeline
// row for an ALREADY evaluated-or-dismissed posting sat "- [ ]" open and clogged
// the triage window. Assert it can't: no open row may be already-handled. This is
// dry-run (reports only, never rewrites), and turns silent drift into a loud, same-
// day failure of the mandatory health check instead of a mystery a week later.
const queue = reconcileHandled(path.join(__dirname, 'data/pipeline.md'), {
  appsPath: path.join(__dirname, 'data/applications.md'),
  dismissedPath: path.join(__dirname, 'data/triage-dismissed.tsv'),
  additionsDir: path.join(__dirname, 'batch/tracker-additions'),
  needsManualPath: path.join(__dirname, 'data/needs-manual-jd.tsv'),
  rootDir: __dirname,
  apply: false,
});

if (jsonOut) {
  console.log(JSON.stringify({ total: files.length, drift: results, queueClog: queue.rows.map(r => r.url), badUrls: badUrlReports }, null, 2));
} else {
  console.log(`\nChecked ${files.length} reports`);
  if (badUrlReports.length === 0) {
    console.log('✅ No report carries an unexpanded template variable in its url');
  } else {
    console.log(`\n🛑 ${badUrlReports.length} report(s) have an UNEXPANDED template variable in the url frontmatter:\n`);
    for (const r of badUrlReports) console.log(`  ${r.num}  ${r.url}  →  ${r.file}`);
    console.log('\nThese are garbage identities (a batch wrote the literal, unsubstituted). Fix the url in each');
    console.log('report frontmatter (set the real posting URL, or "" if unknown) before merging.\n');
  }
  if (results.length === 0) {
    console.log('✅ All sections parse cleanly');
  } else {
    console.log(`⚠️  ${results.length} reports have format drift (content in .md but parser returns nothing):\n`);
    for (const r of results) {
      console.log(`  ${r.num}  ${r.drift.join(', ')}  →  ${r.file}`);
    }
    console.log('');
    console.log('Fix: either update parser.mjs to handle the new format, or re-run the eval.');
  }
  if (queue.flipped === 0) {
    console.log('✅ Pipeline queue clean — no already-handled rows left open\n');
  } else {
    console.log(`\n⚠️  ${queue.flipped} pipeline row(s) are already evaluated/dismissed but still "- [ ]" open (queue clog):\n`);
    for (const r of queue.rows) console.log(`  ${r.url.slice(0, 84)}`);
    console.log('\nFix: node reconcile-pipeline.mjs --apply  (the dashboard also self-heals after each run)\n');
  }
}

process.exit(results.length === 0 && queue.flipped === 0 && badUrlReports.length === 0 ? 0 : 1);

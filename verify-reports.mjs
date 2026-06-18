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

let files = fs.readdirSync(REPORTS)
  .filter(f => /^\d+.*\.md$/.test(f))
  .sort((a, b) => parseInt(b) - parseInt(a));
if (recentN) files = files.slice(0, recentN);

const results = [];
for (const file of files) {
  const md = fs.readFileSync(path.join(REPORTS, file), 'utf8');
  const num = file.match(/^(\d+)/)[1];
  const cs = hasV1Frontmatter(md) ? v1ToCheatsheet(parseV1(md).data) : parseReport(md);

  // Block A is always present; the Overview tab needs companyBrief + keywords to look complete
  const hasBlockA = !!extractSection(md, 'A');

  const checks = [
    { letter: 'A', name: 'CompanyBrief',  hasMd: hasBlockA,
      hasParsed: !!cs.companyBrief },
    { letter: 'A', name: 'Keywords',      hasMd: hasBlockA,
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

if (jsonOut) {
  console.log(JSON.stringify({ total: files.length, drift: results }, null, 2));
} else {
  console.log(`\nChecked ${files.length} reports`);
  if (results.length === 0) {
    console.log('✅ All sections parse cleanly\n');
  } else {
    console.log(`⚠️  ${results.length} reports have format drift (content in .md but parser returns nothing):\n`);
    for (const r of results) {
      console.log(`  ${r.num}  ${r.drift.join(', ')}  →  ${r.file}`);
    }
    console.log('');
    console.log('Fix: either update parser.mjs to handle the new format, or re-run the eval.');
    console.log('');
  }
}

process.exit(results.length === 0 ? 0 : 1);

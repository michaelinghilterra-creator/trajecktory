#!/usr/bin/env node
// company-audit.mjs — analyzes historical scores by company to identify
// chronic underperformers and recommend disabling them in portals.yml.
//
// Usage:
//   node company-audit.mjs                # show all underperforming companies
//   node company-audit.mjs --min-evals 3  # only companies with 3+ evaluations
//   node company-audit.mjs --apply        # auto-disable in portals.yml
//
// Logic:
//   - For each company in applications.md, calculate avg score, max score, count
//   - Flag a company as "chronic underperformer" if:
//     * 3+ evaluations exist AND
//     * max score < 3.0 (no evaluation ever cleared the apply threshold)
//   - Use --apply to set `enabled: false` on flagged companies in portals.yml

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.join(__dirname, 'data/applications.md');
const PORTALS = path.join(__dirname, 'portals.yml');

const args = process.argv.slice(2);
const minEvals = args.includes('--min-evals') ? parseInt(args[args.indexOf('--min-evals') + 1], 10) : 3;
const apply = args.includes('--apply');

// Parse applications.md
const lines = fs.readFileSync(APPS, 'utf8').split('\n');
const byCompany = new Map();
for (const l of lines) {
  // | id | date | company | role | score/5 | status | ... |
  const m = l.match(/^\|\s*\d+\s*\|\s*[\d-]+\s*\|\s*([^|]+?)\s*\|\s*[^|]+\|\s*([\d.]+|N\/A)\s*\/?5?\s*\|/);
  if (!m) continue;
  const company = m[1].trim();
  const scoreStr = m[2];
  if (scoreStr === 'N/A') continue;
  const score = parseFloat(scoreStr);
  if (isNaN(score)) continue;
  if (!byCompany.has(company)) byCompany.set(company, []);
  byCompany.get(company).push(score);
}

// Find underperformers
const underperformers = [];
for (const [company, scores] of byCompany.entries()) {
  if (scores.length < minEvals) continue;
  const max = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (max < 3.0) {
    underperformers.push({ company, evals: scores.length, max, avg: avg.toFixed(2) });
  }
}

underperformers.sort((a, b) => a.max - b.max || a.evals - b.evals);

console.log(`\nAnalyzed ${byCompany.size} companies (${minEvals}+ evaluations required to flag)\n`);

if (underperformers.length === 0) {
  console.log('✅ No chronic underperformers found.');
  process.exit(0);
}

console.log(`⚠️  ${underperformers.length} chronic underperformers (max score never cleared 3.0):\n`);
console.log('  Max  | Avg  | Evals | Company');
console.log('  -----|------|-------|--------');
for (const u of underperformers) {
  console.log(`  ${u.max.toFixed(1)}  | ${u.avg} | ${String(u.evals).padStart(5)} | ${u.company}`);
}

if (!apply) {
  console.log('\nRun with --apply to set enabled: false on these companies in portals.yml');
  process.exit(0);
}

// Apply: rewrite portals.yml with enabled: false for flagged companies
let portalsText = fs.readFileSync(PORTALS, 'utf8');
const portalsLines = portalsText.split('\n');
let modified = 0;

for (const u of underperformers) {
  // Find "- name: <company>" line
  const escapedName = u.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRx = new RegExp(`^\\s*-\\s*name:\\s*${escapedName}\\s*$`, 'i');
  const nameIdx = portalsLines.findIndex(l => nameRx.test(l));
  if (nameIdx < 0) continue;

  // Find the "enabled:" line within the next 8 lines
  for (let i = nameIdx + 1; i < Math.min(nameIdx + 10, portalsLines.length); i++) {
    if (/^\s*-\s*name:/.test(portalsLines[i])) break; // hit next company
    if (/^\s*enabled:\s*true/.test(portalsLines[i])) {
      portalsLines[i] = portalsLines[i].replace(/enabled:\s*true/, `enabled: false  # auto-disabled: ${u.evals} evals, max ${u.max.toFixed(1)}`);
      modified++;
      break;
    }
  }
}

if (modified > 0) {
  fs.writeFileSync(PORTALS, portalsLines.join('\n'));
  console.log(`\n✅ Disabled ${modified} companies in portals.yml`);
} else {
  console.log('\n⚠️  No companies were modified (none had enabled: true matching).');
}

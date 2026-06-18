#!/usr/bin/env node
// Apply the triage cut list to data/recruiters.md.
// Reads the flat ID list at the bottom of data/recruiter-triage-recommendations.md
// and removes those rows from data/recruiters.md.

import fs from 'fs';

const SRC = 'data/recruiters.md';
const REPORT = 'data/recruiter-triage-recommendations.md';

// Extract cut IDs from report's flat-list code block
const reportText = fs.readFileSync(REPORT, 'utf8');
const flatMatch = reportText.match(/## Flat cut list[\s\S]*?```\n([\s\S]*?)\n```/);
if (!flatMatch) { console.error('No flat cut list found in report'); process.exit(1); }
const cutIds = new Set(flatMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));

console.log(`Cuts to apply: ${cutIds.size}`);

// Filter recruiters.md
const text = fs.readFileSync(SRC, 'utf8');
const lines = text.split('\n');
const out = [];
let kept = 0, removed = 0;

for (const line of lines) {
  if (!line.startsWith('| ')) { out.push(line); continue; }
  const parts = line.split('|').map(p => p.trim());
  const id = parseInt(parts[1], 10);
  // Preserve header + separator rows
  if (isNaN(id)) { out.push(line); continue; }
  if (cutIds.has(id)) { removed++; continue; }
  out.push(line);
  kept++;
}

fs.writeFileSync(SRC, out.join('\n'));
console.log(`✅ Wrote ${SRC}`);
console.log(`   ${kept} kept · ${removed} removed`);

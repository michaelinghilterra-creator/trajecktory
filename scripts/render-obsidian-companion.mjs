#!/usr/bin/env node
// Render schema-v1 report JSON into clean Obsidian Markdown matching the
// 5/29 Semgrep template. Either backfill an existing broken Obsidian file
// (extracting the JSON from inside it) or generate a new one from a source
// report in career-ops/reports/.
//
// Usage:
//   node scripts/render-obsidian-companion.mjs --backfill
//   node scripts/render-obsidian-companion.mjs --from-source <reportFile>
//   node scripts/render-obsidian-companion.mjs --all-broken

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The Obsidian companion folder is machine-specific, so it comes from the
// environment rather than a hardcoded path. Set OBSIDIAN_VAULT_DIR to your
// vault's "Code Applied" folder. Empty when unset; the CLI guards on it below.
const VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR || '';
const REPORTS_DIR = path.resolve('reports');

function extractJsonFromObsidianFile(content) {
  // The broken format is:
  //   # Heading
  //   **Applied:** ...
  //   ---
  //   ---
  //   { json }
  //   ---
  //   # Heading
  //   ---
  //   yaml frontmatter
  //   ---
  //   narrative
  //
  // Find the JSON block (starts with `{` after the second `---`).
  const lines = content.split(/\r?\n/);
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('{') && lines[i].trim() === '{') {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) return null;

  // Find matching closing `}` by brace counting.
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) {
      jsonEnd = i;
      break;
    }
  }
  if (jsonEnd === -1) return null;

  const jsonText = lines.slice(jsonStart, jsonEnd + 1).join('\n');
  // Capture any trailing narrative (after the closing `---` that follows JSON).
  const trailing = lines.slice(jsonEnd + 1).join('\n');
  return { jsonText, trailing };
}

function extractJsonFromSourceReport(content) {
  // Source reports: --- newline { json } newline --- newline narrative
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return null;
  return { jsonText: m[1], trailing: m[2] };
}

function fmtScoreEmoji(score) {
  if (score >= 4.0) return '🟢';
  if (score >= 3.0) return '🟡';
  return '🔴';
}

function safeStr(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

function mdTable(headers, rows) {
  const align = headers.map(() => '---').join('|');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${align.split('|').map(() => '---').join('|')}|`;
  const body = rows.map(r => `| ${r.map(c => safeStr(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function render(report, opts = {}) {
  const r = report;
  const sum = r.summary || {};
  const company = r.company;
  const role = r.role;
  const date = r.date;
  const score = r.score;
  const url = r.url || '';
  const todayFormal = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const status = opts.status || 'applied';
  const appliedStr = opts.appliedDate || todayFormal;

  const sections = [];

  sections.push(`# ${company} — ${role}`);
  sections.push('---');
  sections.push('type: company-research');
  sections.push(`status: ${status}`);
  sections.push(`created: ${date}`);
  sections.push(`updated: ${new Date().toISOString().slice(0, 10)}`);
  sections.push('tags: [job-search, company-research]');
  sections.push('---');
  sections.push('');
  sections.push('');
  sections.push(`**Applied:** ${appliedStr}`);
  sections.push(`**Score:** ${score}/5`);
  sections.push(`**Status:** Applied`);
  sections.push('');
  sections.push('---');
  sections.push('');
  sections.push(`# Evaluation: ${company} — ${role}`);
  sections.push('');
  sections.push(`**Date:** ${date}`);
  if (url) sections.push(`**URL:** ${url}`);
  if (sum.archetypeDetected) sections.push(`**Archetype:** ${sum.archetypeDetected}`);
  sections.push(`**Score:** ${score}/5 ${fmtScoreEmoji(score)}`);
  if (r.legitimacy?.tier) {
    const concl = r.legitimacy.conclusion ? ` — ${r.legitimacy.conclusion}` : '';
    sections.push(`**Legitimacy:** ${r.legitimacy.tier}${concl}`);
  }
  sections.push(`**PDF:** ❌`);
  if (r.domain) sections.push(`**Domain:** ${r.domain}`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // A) Role Summary
  sections.push('## A) Role Summary');
  sections.push('');
  const roleRows = [];
  if (sum.archetypeDetected) roleRows.push(['Archetype detected', sum.archetypeDetected]);
  if (r.domain) roleRows.push(['Domain', r.domain]);
  if (sum.function) roleRows.push(['Function', sum.function]);
  if (sum.seniority) roleRows.push(['Seniority', sum.seniority]);
  if (sum.remote) roleRows.push(['Remote', sum.remote]);
  if (sum.teamSize) roleRows.push(['Team size', sum.teamSize]);
  if (sum.compStated) roleRows.push(['Comp stated', sum.compStated]);
  if (sum.tldr) roleRows.push(['TL;DR', sum.tldr]);
  if (roleRows.length) {
    sections.push(mdTable(['Attribute', 'Detail'], roleRows));
    sections.push('');
  }
  if (sum.companyBrief) {
    sections.push(`**Company:** ${sum.companyBrief}`);
    sections.push('');
  }
  if (r.recommendation) {
    sections.push(`**Recommendation:** ${r.recommendation}`);
    sections.push('');
  }

  // B) CV Match
  if (r.cvMatch?.length || r.gaps?.length) {
    sections.push('---');
    sections.push('');
    sections.push('## B) CV Match');
    sections.push('');
    if (r.cvMatch?.length) {
      const rows = r.cvMatch.map(m => [m.req, m.evidence, m.strength + (m.note ? ` — ${m.note}` : '')]);
      sections.push(mdTable(['Requirement', 'Evidence', 'Strength'], rows));
      sections.push('');
    }
    if (r.gaps?.length) {
      sections.push('### Gap Table');
      sections.push('');
      const rows = r.gaps.map(g => [g.gap, g.blocker, g.mitigation]);
      sections.push(mdTable(['Gap', 'Blocker?', 'Mitigation'], rows));
      sections.push('');
    }
  }

  // C) Level & Strategy
  if (r.levelMatch || r.sellSenior?.length || r.downlevelPlan) {
    sections.push('---');
    sections.push('');
    sections.push('## C) Level & Strategy');
    sections.push('');
    if (r.levelMatch) {
      const lm = r.levelMatch;
      sections.push(`**JD level:** ${safeStr(lm.jdLevel)}  `);
      sections.push(`**Natural level:** ${safeStr(lm.naturalLevel)}  `);
      sections.push(`**Verdict:** ${safeStr(lm.verdict)}`);
      sections.push('');
    }
    if (r.sellSenior?.length) {
      sections.push('### Sell-Senior Plan');
      sections.push('');
      for (const s of r.sellSenior) {
        sections.push(`- **${s.claim}**`);
        if (s.proof) sections.push(`  - *Proof:* ${s.proof}`);
        if (s.phrase) sections.push(`  - *Phrase:* "${s.phrase}"`);
      }
      sections.push('');
    }
    if (r.downlevelPlan) {
      sections.push(`**Downlevel plan:** ${r.downlevelPlan}`);
      sections.push('');
    }
  }

  // D) Comp
  if (r.comp) {
    sections.push('---');
    sections.push('');
    sections.push('## D) Comp');
    sections.push('');
    const c = r.comp;
    const cRows = [];
    if (c.stated) cRows.push(['Stated', c.stated]);
    if (c.walkaway) cRows.push(['Walkaway floor', `$${c.walkaway}K`]);
    if (c.score !== undefined) cRows.push(['Score', `${c.score}/5`]);
    if (c.verdict) cRows.push(['Verdict', c.verdict]);
    if (c.market) cRows.push(['Market', c.market]);
    if (cRows.length) {
      sections.push(mdTable(['Field', 'Value'], cRows));
      sections.push('');
    }
    if (c.sources?.length) {
      sections.push('### Comp Sources');
      sections.push('');
      sections.push(mdTable(['Source', 'Data', 'Note'], c.sources.map(s => [s.src, s.data, s.note || ''])));
      sections.push('');
    }
  }

  // E) Customization
  if (r.customizationCV?.length || r.customizationLI?.length) {
    sections.push('---');
    sections.push('');
    sections.push('## E) Customization');
    sections.push('');
    if (r.customizationCV?.length) {
      sections.push('### CV');
      sections.push('');
      sections.push(mdTable(['Section', 'Current', 'Change', 'Why'], r.customizationCV.map(x => [x.section, x.current, x.change, x.why])));
      sections.push('');
    }
    if (r.customizationLI?.length) {
      sections.push('### LinkedIn');
      sections.push('');
      sections.push(mdTable(['Section', 'Current', 'Change', 'Why'], r.customizationLI.map(x => [x.section, x.current, x.change, x.why])));
      sections.push('');
    }
  }

  // F) Interview
  if (r.leadStory || r.starStories?.length || r.redFlagQs?.length) {
    sections.push('---');
    sections.push('');
    sections.push('## F) Interview Prep');
    sections.push('');
    if (r.leadStory) {
      sections.push('### Lead Story');
      sections.push('');
      sections.push(`**Title:** ${r.leadStory.title}`);
      if (r.leadStory.reason) sections.push(`**Why this one:** ${r.leadStory.reason}`);
      if (r.leadStory.script) {
        sections.push('');
        sections.push('**Script:**');
        sections.push('');
        sections.push(`> ${r.leadStory.script}`);
      }
      sections.push('');
    }
    if (r.starStories?.length) {
      sections.push('### STAR Stories');
      sections.push('');
      for (const s of r.starStories) {
        sections.push(`#### ${s.title}`);
        if (s.req) sections.push(`*Requirement:* ${s.req}`);
        sections.push('');
        if (s.S) sections.push(`- **S:** ${s.S}`);
        if (s.T) sections.push(`- **T:** ${s.T}`);
        if (s.A) sections.push(`- **A:** ${s.A}`);
        if (s.R) sections.push(`- **R:** ${s.R}`);
        if (s.Reflection) sections.push(`- **Reflection:** ${s.Reflection}`);
        sections.push('');
      }
    }
    if (r.redFlagQs?.length) {
      sections.push('### Red-Flag Questions');
      sections.push('');
      for (const q of r.redFlagQs) {
        sections.push(`**Q:** ${q.q}`);
        if (q.behind) sections.push(`*What's behind it:* ${q.behind}`);
        if (q.a) sections.push(`**A:** ${q.a}`);
        sections.push('');
      }
    }
  }

  // G) Legitimacy
  if (r.legitimacy) {
    sections.push('---');
    sections.push('');
    sections.push('## G) Legitimacy');
    sections.push('');
    const lg = r.legitimacy;
    if (lg.tier) sections.push(`**Tier:** ${lg.tier}`);
    if (lg.conclusion) sections.push(`**Conclusion:** ${lg.conclusion}`);
    if (lg.signals?.length) {
      sections.push('');
      sections.push(mdTable(['Signal', 'Good?', 'Finding'], lg.signals.map(s => [s.signal, s.good ? '✅' : '⚠️', s.finding])));
    }
    sections.push('');
  }

  // Keywords
  if (r.keywords?.length) {
    sections.push('---');
    sections.push('');
    sections.push('## Keywords');
    sections.push('');
    sections.push(r.keywords.map(k => `\`${k}\``).join(' · '));
    sections.push('');
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function processBroken(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const extracted = extractJsonFromObsidianFile(content);
  if (!extracted) {
    console.warn(`SKIP (no JSON found): ${path.basename(filePath)}`);
    return false;
  }
  let report;
  try {
    report = JSON.parse(extracted.jsonText);
  } catch (e) {
    console.warn(`SKIP (JSON parse error): ${path.basename(filePath)} — ${e.message}`);
    return false;
  }

  // Try to extract original applied date from the file
  const appliedMatch = content.match(/\*\*Applied:\*\*\s*(.+)/);
  const appliedDate = appliedMatch ? appliedMatch[1].trim() : null;

  const rendered = render(report, { appliedDate, status: 'applied' });
  fs.writeFileSync(filePath, rendered, 'utf8');
  console.log(`OK: ${path.basename(filePath)}`);
  return true;
}

function processSource(reportFile, appliedDate) {
  const content = fs.readFileSync(reportFile, 'utf8');
  const extracted = extractJsonFromSourceReport(content);
  if (!extracted) { console.warn(`SKIP (no frontmatter): ${reportFile}`); return null; }
  let report;
  try { report = JSON.parse(extracted.jsonText); }
  catch (e) { console.warn(`SKIP (JSON error): ${reportFile} — ${e.message}`); return null; }

  const dateMDY = report.date.split('-');
  const dateMMDDYYYY = `${dateMDY[1]}-${dateMDY[2]}-${dateMDY[0]}`;
  const safeRole = report.role.replace(/[/\\:*?"<>|]/g, '-');
  const noteName = `${dateMMDDYYYY} - ${report.company} - ${safeRole}.md`;
  const outPath = path.join(VAULT_DIR, noteName);

  const rendered = render(report, { appliedDate, status: 'applied' });
  fs.writeFileSync(outPath, rendered, 'utf8');
  console.log(`CREATED: ${noteName}`);
  return outPath;
}

export { render, extractJsonFromSourceReport, extractJsonFromObsidianFile };

// ── CLI ──────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (!invokedDirectly) {
  // Imported as a module — skip CLI dispatch.
} else {
const args = process.argv.slice(2);
const mode = args[0];

if (!VAULT_DIR && (mode === '--all-broken' || mode === '--from-source')) {
  console.error(`OBSIDIAN_VAULT_DIR is not set. Point it at your Obsidian "Code Applied" folder before running ${mode}, e.g. OBSIDIAN_VAULT_DIR="/path/to/Obsidian Vault/.../01 Code Applied".`);
  process.exit(1);
}

if (mode === '--all-broken') {
  const files = fs.readdirSync(VAULT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(VAULT_DIR, f));
  let fixed = 0;
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('"schema": "trajecktory-report')) {
      if (processBroken(f)) fixed++;
    }
  }
  console.log(`\n${fixed} files fixed.`);
} else if (mode === '--from-source') {
  const reportFile = args[1];
  const appliedDate = args[2];
  processSource(reportFile, appliedDate);
} else if (mode === '--backfill') {
  const filePath = args[1];
  processBroken(filePath);
} else {
  console.error('Usage: --all-broken | --backfill <file> | --from-source <reportFile> [appliedDate]');
  process.exit(1);
}
}

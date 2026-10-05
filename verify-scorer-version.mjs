#!/usr/bin/env node
// verify-scorer-version.mjs - scorer version stamp guard.
//
// A derived score only stays interpretable if the report says which scoring
// rules produced it. This guard detects derived reports with no scorerVersion,
// or with a stale scorerVersion, and prints the exact repair command. Detection
// without a remedy is how guards become decoration.
//
// Usage:
//   node verify-scorer-version.mjs
//   node verify-scorer-version.mjs --json
// Exit 0 if every derived report is stamped with the current scorer, 1 on any
// missing or stale stamp, 2 when reports/ cannot be read.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCORER_VERSION } from './lib/score.mjs';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';

export function findScorerVersionIssues({ reports, current = SCORER_VERSION } = {}) {
  const missing = [];
  const stale = [];
  let checked = 0;
  for (const report of reports || []) {
    if (report?.data?.scoreSource !== 'derived') continue;
    checked++;
    const version = report.data.scorerVersion;
    if (!version) missing.push(report.id);
    else if (version !== current) stale.push({ id: report.id, version });
  }
  return { checked, missing, stale, ok: missing.length === 0 && stale.length === 0 };
}

function isMain() {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

function reportIdOf(file, data) {
  if (data && data.id !== undefined && data.id !== null && String(data.id).trim()) return String(data.id).trim();
  const m = path.basename(file).match(/^(\d+)/);
  return m ? m[1] : null;
}

function listReportFiles(reportsDir) {
  return fs.readdirSync(reportsDir).filter(f => f.endsWith('.md')).map(f => path.join(reportsDir, f));
}

function loadReports(reportsDir) {
  return listReportFiles(reportsDir).flatMap(file => {
    let md;
    try { md = fs.readFileSync(file, 'utf8'); } catch { return []; }
    if (!hasV1Frontmatter(md)) return [];
    try {
      const { data } = parseV1(md);
      const id = reportIdOf(file, data);
      return id ? [{ id, data }] : [];
    } catch {
      return [];
    }
  });
}

function cappedIds(ids) {
  const first = ids.slice(0, 20).join(', ');
  const more = ids.length > 20 ? ` and ${ids.length - 20} more` : '';
  return first ? `${first}${more}` : '';
}

function main() {
  const jsonOut = process.argv.includes('--json');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const reportsDir = path.join(__dirname, 'reports');

  let reports;
  try {
    reports = loadReports(reportsDir);
  } catch (e) {
    const result = { error: 'reports-unreadable', ok: false };
    if (jsonOut) console.log(JSON.stringify(result, null, 2));
    else console.log('reports directory cannot be read');
    process.exit(2);
  }

  const result = findScorerVersionIssues({ reports });
  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(`checked ${result.checked} derived reports against scorerVersion ${SCORER_VERSION}: ${result.missing.length} missing, ${result.stale.length} stale`);
  if (result.ok) process.exit(0);

  if (result.missing.length) {
    console.log(`missing: ${cappedIds(result.missing)}`);
    console.log('remedy: node compute-scores.mjs --all --stamp-version --apply');
  }
  if (result.stale.length) {
    console.log(`stale: ${cappedIds(result.stale.map(s => s.id))}`);
    console.log('remedy: node compute-scores.mjs --all --apply');
    console.log('then: node resync-tracker-scores.mjs --apply');
  }
  process.exit(1);
}

if (isMain()) main();

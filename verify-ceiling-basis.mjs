#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';

export const CEILING_BASIS_REQUIRED_SINCE = '2026-11-09';
export const CEILING_BASES = ['comp', 'location', 'level', 'builddepth', 'requirement', 'visa', 'other'];

export function findCeilingBasisIssues({ reports, since = CEILING_BASIS_REQUIRED_SINCE } = {}) {
  const missing = [];
  const invalid = [];
  let checked = 0;
  for (const report of reports || []) {
    const data = report?.data;
    if (!data || typeof data.scoreCeiling !== 'number' || !Number.isFinite(data.scoreCeiling)) continue;
    if (typeof data.date !== 'string' || data.date < since) continue;
    checked++;
    if (typeof data.ceilingBasis !== 'string' || !data.ceilingBasis.trim()) {
      missing.push(report.id);
      continue;
    }
    const basis = data.ceilingBasis.trim().toLowerCase();
    if (!CEILING_BASES.includes(basis)) invalid.push({ id: report.id, basis });
  }
  return { checked, missing, invalid, ok: missing.length === 0 && invalid.length === 0 };
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

function capped(values) {
  const first = values.slice(0, 20).join(', ');
  const more = values.length > 20 ? ` and ${values.length - 20} more` : '';
  return first ? `${first}${more}` : '';
}

function main() {
  const jsonOut = process.argv.includes('-' + '-json');
  const reportsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reports');
  let reports;
  try {
    reports = loadReports(reportsDir);
  } catch {
    const result = { error: 'reports-unreadable', ok: false };
    if (jsonOut) console.log(JSON.stringify(result, null, 2));
    else console.log('reports directory cannot be read');
    process.exit(2);
  }
  const result = findCeilingBasisIssues({ reports });
  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  console.log(`checked ${result.checked} reports with a score ceiling since ${CEILING_BASIS_REQUIRED_SINCE}: ${result.missing.length} missing a ceilingBasis, ${result.invalid.length} with an unknown basis`);
  if (!result.ok) {
    console.log(`missing: ${capped(result.missing)}`);
    console.log(`invalid: ${result.invalid.map(item => `${item.id}=${item.basis}`).join(', ')}`);
    console.log('remedy: set ceilingBasis in the report frontmatter (one of comp, location, level, buildDepth, requirement, visa, other) or re-run the evaluation');
  }
  process.exit(result.ok ? 0 : 1);
}

if (isMain()) main();

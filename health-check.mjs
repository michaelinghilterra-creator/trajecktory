#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const HEALTH_CHECKS = [
  'verify-reports.mjs',
  'verify-score-drift.mjs',
  'verify-report-derivation.mjs',
  'verify-report-numbering.mjs',
  'audit-orphan-reports.mjs',
];

function outputLines(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function warningLine(lines) {
  return lines.find(line => {
    if (/\b(?:0|no)\s+warnings?\b|warnings?\s*:\s*0\b/i.test(line)) return false;
    return /\bwarn(?:ing)?\b/i.test(line) || line.includes('⚠');
  }) || null;
}

export function aggregateHealthChecks(checks, runCheck) {
  const results = checks.map(name => {
    const child = runCheck(name);
    const lines = outputLines(child);
    const warning = warningLine(lines);
    const failed = child.status !== 0 || Boolean(child.error);
    const firstFlag = warning || (failed ? (lines[0] || child.error?.message || `exit ${child.status}`) : null);
    return { name, status: child.status, failed, warning, firstFlag, lines };
  });
  const flagged = results.filter(result => result.failed || result.warning);
  return {
    ok: flagged.length === 0,
    results,
    flagged,
    summary: flagged.length
      ? `Health checks flagged: ${flagged.map(item => `${item.name}: ${item.firstFlag}`).join(' | ')}`
      : `Health checks passed: ${results.length}`,
  };
}

export function runHealthChecks() {
  return aggregateHealthChecks(HEALTH_CHECKS, name => spawnSync(process.execPath, [name], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    encoding: 'utf8',
  }));
}

function isMain() {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}

if (isMain()) {
  const result = runHealthChecks();
  for (const item of result.results) {
    const label = item.failed || item.warning ? 'FLAG' : 'PASS';
    console.log(`${label} ${item.name}${item.firstFlag ? `: ${item.firstFlag}` : ''}`);
  }
  console.log(result.summary);
  process.exitCode = result.ok ? 0 : 1;
}

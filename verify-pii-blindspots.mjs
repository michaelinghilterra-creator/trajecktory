#!/usr/bin/env node
/**
 * verify-pii-blindspots.mjs provides a second opinion on personal data.
 *
 * verify-no-pii.mjs remains the ship gate. It asks whether any forbidden value
 * exists anywhere in what trajecktory ships. This narrower checker asks whether
 * one range added a value matching a real gitignored source. It never replaces
 * the gate.
 *
 * The checker exists because planted-value measurements showed four gaps in the
 * gate: the owner's first name alone, the owner's phone in five formats, a third
 * party's full name from the contact book, and a distinctive company from the
 * tracker all exited clean. Only added lines are scanned because whole changed
 * files bury new evidence under old matches. Distinctiveness filtering prevents
 * table headers and generic code words from becoming noisy evidence.
 *
 * THIS FILE IS TRACKED. It contains no name, email, phone, employer,
 * counterparty, or private figure as a literal. Sensitive terms are derived at
 * runtime and are masked before reporting. Like the ship gate, this only works
 * locally because its gitignored derivation sources never reach a CI runner.
 *
 * Exit 0 means clean, 1 means findings, and 2 means the range cannot be certified.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { deriveTerms, scanAddedLines } from './lib/pii-blindspots.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const rangeIndex = argv.indexOf('--range');
const RANGE = rangeIndex >= 0 ? argv[rangeIndex + 1] : 'origin/main..HEAD';
const JSON_OUT = argv.includes('--json');
const SOURCE_PATHS = {
  profile: 'config/profile.yml',
  cv: 'cv.md',
  apps: 'data/applications.md',
  targetTalent: 'data/target-talent.md',
  referrals: 'data/referrals.md',
};
const IDENTITY_ALLOW = new Set([
  'README.md', 'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'NOTICE.md', 'AGENTS.md',
  'CLAUDE.md', 'package.json', 'FUNDING.yml',
]);

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 27,
  });
}

function readSources() {
  const sources = {};
  const missing = [];
  let readable = 0;
  for (const [key, path] of Object.entries(SOURCE_PATHS)) {
    try {
      sources[key] = readFileSync(join(ROOT, path), 'utf8');
      readable++;
    } catch {
      sources[key] = '';
      missing.push(path);
    }
  }
  return { sources, missing, readable };
}

function addedLinesForRange(range) {
  const diff = git(['diff', '--no-ext-diff', '--no-color', '--unified=0', '--diff-filter=AM', range, '--']);
  const addedLines = [];
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (file && line.startsWith('+')) {
      addedLines.push({ file, line: line.slice(1) });
    }
  }
  return addedLines;
}

function changedFilesForRange(range) {
  return git(['diff', '--name-only', '--diff-filter=AM', range, '--'])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function binaryFilesForRange(range) {
  const files = [];
  const numstat = git(['diff', '--numstat', '--diff-filter=AM', range, '--']);
  for (const line of numstat.split(/\r?\n/)) {
    const [added, deleted, file] = line.split('\t');
    if (added === '-' && deleted === '-' && file) files.push(file);
  }
  return files;
}

function countFindings(findings, kind) {
  return findings.filter(finding => finding.kind === kind).length;
}

function outputText(result) {
  console.log(`PII blind-spot check: ${result.range}`);
  const categories = [
    ['identity', 'identity'],
    ['people', 'person'],
    ['companies', 'company'],
    ['titles', 'title'],
    ['phones', 'phone'],
    ['emails', 'email'],
    ['encoded', 'encoded'],
  ];
  for (const [checkedKey, findingKind] of categories) {
    console.log(`  ${checkedKey}: ${result.checked[checkedKey]} real values checked, ${countFindings(result.findings, findingKind)} findings`);
  }

  for (const finding of result.findings) {
    const masked = finding.maskedTerm === null ? 'human review required' : finding.maskedTerm;
    console.log(`  [${finding.kind}] ${finding.file}: ${finding.fixture}`);
    console.log(`      matched: ${masked}`);
  }
  for (const file of result.identityAllowTouched) {
    console.log(`  [identity allowlist] ${file}: stray-email checking is disabled in this file`);
  }
  for (const file of result.binaryFiles) {
    console.log(`  [binary] ${file}: content cannot be cleared by this added-line checker`);
  }
  if (result.missingSources.length) {
    console.log(`  Missing derivation sources: ${result.missingSources.join(', ')}`);
  }
  if (result.exitCode === 0) console.log('Clean');
  if (result.exitCode === 1) console.log('Findings require review');
  if (result.exitCode === 2) console.log('Cannot certify this range');
}

function main() {
  if (rangeIndex >= 0 && (!RANGE || RANGE.startsWith('--'))) {
    const result = { error: '--range requires a git range', exitCode: 2 };
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    else console.error(result.error);
    process.exit(2);
  }

  let addedLines;
  let changedFiles;
  let binaryFiles;
  try {
    addedLines = addedLinesForRange(RANGE);
    changedFiles = changedFilesForRange(RANGE);
    binaryFiles = binaryFilesForRange(RANGE);
  } catch (error) {
    const result = { error: `Could not read git range: ${error.message}`, exitCode: 2 };
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    else console.error(result.error);
    process.exit(2);
  }

  const { sources, missing, readable } = readSources();
  const terms = deriveTerms(sources);
  const { findings, checked } = scanAddedLines(addedLines, terms);
  const identityAllowTouched = changedFiles.filter(file => IDENTITY_ALLOW.has(basename(file)));
  let exitCode = findings.length || identityAllowTouched.length ? 1 : 0;
  if (readable === 0 || binaryFiles.length) exitCode = 2;
  const result = {
    range: RANGE,
    checked,
    findings,
    identityAllowTouched,
    binaryFiles,
    missingSources: missing,
    derivedFrom: terms.derivedFrom,
    exitCode,
  };

  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  else outputText(result);
  process.exit(exitCode);
}

main();

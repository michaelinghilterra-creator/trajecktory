#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkReviewedBinaries,
  listTrackedBinaries,
  parseReviewed,
} from '../lib/reviewed-binaries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${message}`);
    failed += 1;
  }
}

console.log('reviewed-binaries.test.mjs');

const blobA = 'a'.repeat(40);
const blobB = 'b'.repeat(40);
const cleanBinaries = [{ blob: blobA, path: 'docs/example-image.png' }];
const cleanReviewed = parseReviewed(`blob\tpath\tnote\n${blobA}\tdocs/example-image.png\tinvented image\n`);

{
  const result = checkReviewedBinaries(cleanBinaries, []);
  check(result.unreviewed.length === 1 && result.unreviewed[0].path === 'docs/example-image.png',
    'reports an invented unreviewed binary');
}

{
  const reviewed = parseReviewed(`blob\tpath\tnote\n${blobB}\tdocs/example-image.png\tinvented image\n`);
  const result = checkReviewedBinaries(cleanBinaries, reviewed);
  check(result.changed.length === 1 && result.changed[0].reviewedBlob === blobB,
    'reports an invented binary whose blob changed');
}

{
  const reviewed = parseReviewed(`blob\tpath\tnote\n${blobA}\tdocs/retired-image.png\tinvented image\n`);
  const result = checkReviewedBinaries([], reviewed);
  check(result.stale.length === 1 && result.stale[0].path === 'docs/retired-image.png',
    'reports an invented stale review row');
}

{
  const result = checkReviewedBinaries(cleanBinaries, cleanReviewed);
  check(result.unreviewed.length === 0 && result.changed.length === 0 && result.stale.length === 0,
    'accepts a clean invented review list');
}

{
  const tsv = fs.readFileSync(path.join(root, 'docs', 'reviewed-binaries.tsv'), 'utf8');
  const result = checkReviewedBinaries(listTrackedBinaries(root), parseReviewed(tsv));
  const findings = [
    ...result.unreviewed.map((entry) => ({ kind: 'unreviewed', ...entry })),
    ...result.changed.map((entry) => ({ kind: 'changed', ...entry })),
    ...result.stale.map((entry) => ({ kind: 'stale', ...entry })),
  ];
  if (findings.length === 0) {
    check(true, 'every tracked binary has its reviewed blob recorded');
  } else {
    for (const entry of findings) {
      const blob = entry.blob || entry.reviewedBlob || '<blob>';
      console.log(`  ${entry.kind}: ${entry.path}`);
      console.log(`    Open it, confirm it shows no real personal data, then record "${blob}\t${entry.path}\t<note>" in docs/reviewed-binaries.tsv.`);
    }
    check(false, 'every tracked binary has its reviewed blob recorded');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

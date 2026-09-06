#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractCompanyResearch,
  loadCompanyResearch,
} from '../dashboard-web/server/lib/report-research.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ok ${message}`);
    passed++;
  } else {
    console.log(`  not ok ${message}`);
    failed++;
  }
}

console.log('report-research.test.mjs');

const fixture = fs.readFileSync(path.join(HERE, 'fixtures', 'v1-report.md'), 'utf8');
const structured = extractCompanyResearch(fixture);
check(structured.startsWith('Acme AI is an invented company')
  && !structured.includes('# Full Narrative'),
  'structured companyBrief takes precedence over the report body');

check(extractCompanyResearch('Legacy report body text.', { bodyLimit: 12 }) === 'Legacy repor',
  'legacy report text uses the bounded body fallback');

const fence = '-'.repeat(3);
const noBrief = `${fence}\n${JSON.stringify({ schema: 'trajecktory-report/v1', summary: {} })}\n${fence}\nSpecific body fallback text.`;
check(extractCompanyResearch(noBrief, { bodyLimit: 13 }) === 'Specific body',
  'a v1 report without companyBrief uses only its bounded narrative body');

check(loadCompanyResearch('reports/../package.json') === '',
  'the shared loader refuses a traversal style report value');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

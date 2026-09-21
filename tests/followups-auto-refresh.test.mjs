#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '../dashboard-web/node_modules/esbuild/lib/main.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = name => readFileSync(join(ROOT, 'dashboard-web', 'src', name), 'utf8');
const source = readSource('followups.jsx');

let failed = 0;
const check = (condition, message) => {
  if (condition) {
    console.log(`  ok ${message}`);
  } else {
    console.log(`  fail ${message}`);
    failed++;
  }
};

console.log('followups-auto-refresh.test.mjs');

check(
  source.includes('useRef: useRefF'),
  'source contains useRef: useRefF',
);

check(
  source.includes("document.addEventListener('visibilitychange', onVisible)")
    && source.includes("document.removeEventListener('visibilitychange', onVisible)"),
  'source contains visibilitychange event listeners',
);

check(
  source.includes('clearInterval(timer)'),
  'source contains clearInterval(timer)',
);

check(
  source.includes('10 * 60 * 1000') && source.includes('5 * 60 * 1000'),
  'source contains 10 * 60 * 1000 and 5 * 60 * 1000',
);

const quietStart = source.indexOf('const quiet = () => {');
const quietEnd = source.indexOf('const onVisible');
const quietText = source.slice(quietStart, quietEnd);

check(
  quietText.includes("fetch('/api/followups/stale')") && !quietText.includes('setLoading('),
  'quiet function contains fetch and does not contain setLoading',
);

const useEffectCount = source.split('useEffectF(() => { load(); }, []);').length - 1;
check(
  useEffectCount === 1,
  'source contains useEffectF(() => { load(); }, []); exactly once',
);

try {
  await transform(source, { loader: 'jsx' });
  check(true, 'source parses as jsx');
} catch (err) {
  check(false, 'source parses as jsx');
}

console.log(`\nfollowups auto refresh: ${failed} checks failed`);

process.exit(failed > 0 ? 1 : 0);

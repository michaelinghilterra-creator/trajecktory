#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '../dashboard-web/node_modules/esbuild/lib/main.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = name => readFileSync(join(ROOT, 'dashboard-web', 'src', name), 'utf8');
const connect = readSource('connect.jsx');
const targetTalent = readSource('target-talent.jsx');

let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
  console.log(`  ok ${message}`);
};

console.log('sequence-panel-refresh.test.mjs');

check(
  connect.includes('function SequencePanel({ source, id, toast, refreshKey })')
    && connect.includes('}, [source, id, refreshKey]);'),
  'SequencePanel reloads when refreshKey changes',
);
check(
  targetTalent.includes('const [sequenceRefreshKey, setSequenceRefreshKey] = useState(0);')
    && targetTalent.includes('if (msg.direction === "Sent") setSequenceRefreshKey(key => key + 1);'),
  'successful Sent correspondence increments the sequence refresh counter',
);
check(
  targetTalent.includes('refreshKey={sequenceRefreshKey}'),
  'ContactPanel passes its refresh counter to SequencePanel',
);

await transform(connect, { loader: 'jsx', sourcefile: 'connect.jsx' });
await transform(targetTalent, { loader: 'jsx', sourcefile: 'target-talent.jsx' });
passed += 2;
console.log('  ok connect.jsx parses as JSX');
console.log('  ok target-talent.jsx parses as JSX');

console.log(`\nsequence panel refresh: ${passed} checks passed`);

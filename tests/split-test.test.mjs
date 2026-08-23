#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

console.log('split-test.test.mjs');

const sandbox = makeSandbox('split-test');
process.env.TJK_DATA_DIR = sandbox;
const { assignSplitTest, readSplitTest, splitTestSummary, SPLIT_TEST_PATH } =
  await import('../dashboard-web/server/lib/split-test.mjs');
const clear = () => { try { fs.unlinkSync(SPLIT_TEST_PATH); } catch {} };

clear();
for (let id = 7001; id <= 7004; id++) assignSplitTest(id, 4.1, '2026-08-18');
check(['A', 'B', 'A', 'B'].every((arm, index) => readSplitTest().assignments[String(7001 + index)].arm === arm), 'arms alternate A, B, A, B by assignment order');

clear();
check(assignSplitTest(7101, 3.49, '2026-08-18') === null, 'a score below the minimum is not assigned');
check(!fs.existsSync(SPLIT_TEST_PATH), 'a rejected score writes no sidecar record');

clear();
const first = assignSplitTest(7201, 4.2, '2026-08-18');
const again = assignSplitTest(7201, 4.8, '2026-08-19');
const next = assignSplitTest(7202, 4.0, '2026-08-19');
check(first.arm === 'A' && again.arm === 'A' && again.score === 4.2, 'an assignment is permanent');
check(next.arm === 'B' && Object.keys(readSplitTest().assignments).length === 2, 'reassigning an application does not consume a slot');

clear();
for (let id = 7301; id <= 7332; id++) assignSplitTest(id, 4.0, '2026-08-20');
const full = splitTestSummary();
check(Object.keys(full.assignments).length === 30 && full.remaining === 0, 'assignment stops at the target');
check(full.counts.A === 15 && full.counts.B === 15, 'target counts stay balanced');

clear();
assignSplitTest(7401, 4.0, '2026-08-21', { minScore: 4.0, target: 2 });
assignSplitTest(7402, 3.8, '2026-08-22', { minScore: 3.5, target: 30 });
assignSplitTest(7403, 4.1, '2026-08-22', { minScore: 3.5, target: 30 });
const frozen = readSplitTest();
check(frozen.minScore === 4.0 && frozen.target === 2, 'configuration is frozen on the first write');
check(!frozen.assignments['7402'] && frozen.assignments['7403'], 'later constants do not reinterpret the frozen configuration');

clear();
check(Object.keys(readSplitTest().assignments).length === 0, 'a missing sidecar reads as empty');
fs.writeFileSync(path.join(sandbox, 'split-test.json'), '{not json', 'utf8');
check(Object.keys(readSplitTest().assignments).length === 0, 'an unparseable sidecar reads as empty');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

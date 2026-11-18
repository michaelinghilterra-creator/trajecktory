import fs from 'node:fs';
import path from 'node:path';
import { loadWorkflowJobs, persistWorkflowJobs } from '../dashboard-web/server/routes/workflow.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.error(`  FAIL ${label}`); failed++; }
}

const dir = makeSandbox('workflow-jobs');
try {
  const file = path.join(dir, 'workflow-jobs.json');
  const source = new Map();
  for (let index = 0; index < 55; index++) {
    source.set(`wf-${index}`, { step: 'health', status: index === 54 ? 'running' : 'done', startedAt: index, output: `step ${index}` });
  }
  check(persistWorkflowJobs(file, source), 'persists workflow jobs atomically');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(stored.length === 50 && stored[0][0] === 'wf-54', 'keeps the 50 most recent workflow jobs');

  const loaded = new Map();
  check(loadWorkflowJobs(file, loaded, () => 12345), 'loads the stored workflow jobs');
  const interrupted = loaded.get('wf-54');
  check(interrupted.status === 'interrupted', 'marks a persisted running workflow as interrupted');
  check(interrupted.error === 'Interrupted by a dashboard restart. Steps already finished were kept. Run it again to continue.', 'uses the restart recovery message');
  check(interrupted.output === 'step 54' && interrupted.finishedAt === 12345, 'keeps finished step output and records interruption time');
  check(loaded.get('wf-53').status === 'done', 'preserves terminal workflow jobs');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(root, 'batch', 'batch-runner.sh'), 'utf8');

test('sandbox branch uses the dashboard evaluation policy', () => {
  const branch = text.match(/if \[\[ "\$SANDBOX" == "true" \]\]; then([\s\S]*?)\n {2}else/)?.[1] || '';
  assert.match(branch, /--permission-mode acceptEdits/);
  assert.match(branch, /--settings "\$PROJECT_DIR\/dashboard-web\/server\/eval-agent-sandbox\.settings\.json"/);
  assert.match(branch, /--allowedTools "Bash\(node compute-scores\.mjs:\*\)"/);
  assert.match(branch, /--add-dir "\$jd_dir"/);
  assert.doesNotMatch(branch, /dangerously-skip-permissions/);
});

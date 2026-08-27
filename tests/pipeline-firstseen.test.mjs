import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import {
  enrichInboxDates, firstSeenKey, readPipelineFirstSeen,
  scanHistoryFirstSeen, writePipelineFirstSeen,
} from '../dashboard-web/server/lib/pipeline-firstseen.mjs';

const raw = 'https://boards.greenhouse.io/example/jobs/1234567?gh_src=noise';
const canonical = firstSeenKey(raw);
const history = scanHistoryFirstSeen([
  'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
  `${raw}\t2026-08-20\tgreenhouse\tRole\tExample\tadded`,
  `${canonical}\t2026-08-18\tgreenhouse\tRole\tExample\tadded`,
].join('\n'));
assert.equal(history[canonical], '2026-08-18', 'canonical scan index keeps the earliest date');
assert.equal(history[raw], '2026-08-20', 'scan index retains a raw-url fallback');

const sidecar = {};
const source = { counts: { pending: 1, gated: 1, done: 0 }, pending: [{ url: raw }], gated: [{ url: 'https://example.com/job' }] };
const first = enrichInboxDates(source, sidecar, history, '2026-08-27');
assert.equal(first.inbox.pending[0].dateAdded, '2026-08-18');
assert.equal(first.inbox.gated[0].dateAdded, '2026-08-27');
assert.equal(first.changed, true);
const second = enrichInboxDates(source, sidecar, {}, '2026-09-01');
assert.equal(second.inbox.pending[0].dateAdded, '2026-08-18', 'sidecar keeps scan-derived dates stable');
assert.equal(second.inbox.gated[0].dateAdded, '2026-08-27', 'sidecar keeps stamped dates stable');
assert.equal(second.changed, false);

const dir = makeSandbox('pipeline-firstseen');
const file = path.join(dir, 'pipeline-firstseen.json');
assert.deepEqual(readPipelineFirstSeen(file), {}, 'missing sidecar is empty');
fs.writeFileSync(file, '{broken', 'utf8');
assert.deepEqual(readPipelineFirstSeen(file), {}, 'corrupt sidecar is empty');
writePipelineFirstSeen(file, sidecar);
assert.deepEqual(readPipelineFirstSeen(file), sidecar, 'atomic writer persists the index');
console.log('pipeline-firstseen.test.mjs');

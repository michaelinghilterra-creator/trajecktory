import fs from 'node:fs';
import path from 'node:path';
import { cachedScanHistoryFirstSeen, clearScanHistoryCache } from '../dashboard-web/server/routes/discovery.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.error(`  FAIL ${label}`); failed++; }
}

const dir = makeSandbox('discovery-cache');
try {
  const file = path.join(dir, 'scan-history.tsv');
  clearScanHistoryCache();
  fs.writeFileSync(file, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://example.test/a\t2031-01-01\tlever\tRole\tZorblax Systems\tadded\n');
  const first = cachedScanHistoryFirstSeen(file);
  const cached = cachedScanHistoryFirstSeen(file);
  check(first === cached, 'reuses the cached index when size and mtime are unchanged');
  check(first['https://example.test/a'] === '2031-01-01', 'parses the initial index');

  fs.appendFileSync(file, 'https://example.test/b\t2031-01-02\tlever\tRole\tQuennox Labs\tadded\n');
  const sizeChanged = cachedScanHistoryFirstSeen(file);
  check(sizeChanged !== first && sizeChanged['https://example.test/b'] === '2031-01-02', 'invalidates the cache when size changes');

  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('2031-01-02', '2031-01-03'));
  const future = new Date('2039-01-01T00:00:00Z');
  fs.utimesSync(file, future, future);
  const mtimeChanged = cachedScanHistoryFirstSeen(file);
  check(mtimeChanged['https://example.test/b'] === '2031-01-03', 'invalidates the cache when mtime changes at the same size');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

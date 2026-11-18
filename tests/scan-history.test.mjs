import fs from 'node:fs';
import path from 'node:path';
import { readHistoryRows, readHistoryUrls } from '../lib/scan-history.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.error(`  FAIL ${label}`); failed++; }
}

const dir = makeSandbox('scan-history');
try {
  const file = path.join(dir, 'scan-history.tsv');
  const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
  const lines = [
    'https://example.test/jobs/one\t2031-01-01\tgreenhouse\tBuilder\tZorblax Systems\tadded',
    'https://example.test/jobs/two\t2031-01-02\tashby\tAnalyst\tQuennox Labs\tskipped_title',
  ];
  fs.writeFileSync(file, `${header}\r\n${lines.join('\r\n')}\r\n`, 'utf8');
  const rows = [...readHistoryRows(file, { chunkSize: 7 })];
  check(rows.length === 2, 'reads CRLF rows across tiny chunk boundaries');
  check(rows[0].company === 'Zorblax Systems' && rows[1].status === 'skipped_title', 'parses named row fields');
  check(readHistoryUrls(file, { normalize: value => value.toUpperCase(), chunkSize: 5 }).has('HTTPS://EXAMPLE.TEST/JOBS/ONE'), 'normalizes URL values');
  check([...readHistoryRows(file, { filter: row => row.company === 'Quennox Labs', chunkSize: 9 })].length === 1, 'filters streamed rows');

  const empty = path.join(dir, 'empty.tsv');
  fs.writeFileSync(empty, '', 'utf8');
  check([...readHistoryRows(empty)].length === 0, 'reads an empty file');
  check(readHistoryUrls(path.join(dir, 'missing.tsv')).size === 0, 'returns an empty set for a missing file');

  const generated = path.join(dir, 'generated.tsv');
  const generatedLines = Array.from({ length: 2000 }, (_, index) =>
    `https://example.test/jobs/${index}\t2035-02-03\tlever\tRole ${index}\tZorblax Systems\tadded`);
  const generatedText = `${header}\n${generatedLines.join('\n')}\n`;
  fs.writeFileSync(generated, generatedText, 'utf8');
  const oldResult = new Set(generatedText.split('\n').slice(1).map(line => line.split('\t')[0]).filter(Boolean));
  const streamed = readHistoryUrls(generated, { chunkSize: 31 });
  check(streamed.size === oldResult.size && [...oldResult].every(url => streamed.has(url)), 'matches the old whole file URL result on 2,000 rows');
  check([...readHistoryRows(generated, { chunkSize: 13 })].length === 2000, 'yields every generated row');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

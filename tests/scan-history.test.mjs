import fs from 'node:fs';
import path from 'node:path';
import {
  AGEABLE_STATUSES,
  compactHistory,
  isAgedOut,
  readHistoryRows,
  readHistoryUrls,
} from '../lib/scan-history.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.error(`  FAIL ${label}`); failed++; }
}

const dir = makeSandbox('scan-history');
try {
  const cutoff = new Date('2035-01-01T00:00:00Z').getTime();
  check(AGEABLE_STATUSES.join(',') === 'added,skipped_dup,skipped_title',
    'exports the scanner ageable statuses');
  for (const status of AGEABLE_STATUSES) {
    check(isAgedOut({ status, firstSeen: '2030-01-01' }, cutoff),
      `${status} ages out before the cutoff`);
  }
  for (const status of ['skipped_expired', 'skipped_location', 'skipped_other']) {
    check(!isAgedOut({ status, firstSeen: '2030-01-01' }, cutoff),
      `${status} remains permanent`);
  }
  check(!isAgedOut({ status: 'skipped_title', firstSeen: '' }, cutoff)
    && !isAgedOut({ status: 'skipped_title', firstSeen: 'bad-date' }, cutoff),
  'empty and unreadable dates never age out');

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

  const compactFile = path.join(dir, 'compact.tsv');
  const longTitle = `Boundary ${'x'.repeat(80)}`;
  const compactLines = [
    `${header}\r`,
    `https://example.test/jobs/old-dup\t2030-01-01\tlever\t${longTitle}\tZorblax Systems\tskipped_dup\r`,
    'https://example.test/jobs/old-title\t2031-02-03\tashby\tAnalyst\tQuennox Labs\tskipped_title\r',
    'https://example.test/jobs/old-added\t2030-03-04\tlever\tBuilder\tZorblax Systems\tadded\r',
    'https://example.test/jobs/old-expired\t2030-04-05\tlever\tBuilder\tQuennox Labs\tskipped_expired\r',
    'https://example.test/jobs/old-location\t2030-05-06\tlever\tBuilder\tZorblax Systems\tskipped_location\r',
    'https://example.test/jobs/new-title\t2039-06-07\tlever\tBuilder\tQuennox Labs\tskipped_title\r',
  ];
  const compactFixture = `${compactLines.join('\n')}\n`;
  fs.writeFileSync(compactFile, compactFixture, 'utf8');
  let written;
  const compacted = compactHistory(compactFile, {
    cutoffMs: cutoff,
    chunkSize: 17,
    write: (filePath, content, encoding) => { written = { filePath, content, encoding }; },
  });
  const expectedKept = `${[compactLines[0], ...compactLines.slice(3)].join('\n')}\n`;
  check(compacted.before === 6 && compacted.kept === 4 && compacted.dropped === 2,
    'compaction drops only aged ageable skip rows');
  check(written?.filePath === compactFile && written.encoding === 'utf8'
    && written.content === expectedKept,
  'compaction preserves CRLF kept lines byte-identically and in order across chunk boundaries');
  check(written.content.includes('\tadded\r\n')
    && written.content.includes('\tskipped_expired\r\n')
    && written.content.includes('\tskipped_location\r\n'),
  'default compaction keeps added and permanent skip statuses');

  const unchangedFile = path.join(dir, 'unchanged.tsv');
  fs.writeFileSync(unchangedFile, `${header}\n${lines[0]}\n`, 'utf8');
  let unchangedWrites = 0;
  const unchanged = compactHistory(unchangedFile, {
    cutoffMs: new Date('2030-01-01T00:00:00Z').getTime(),
    write: () => { unchangedWrites++; },
  });
  check(unchanged.dropped === 0 && unchangedWrites === 0,
    'compaction does not write when no rows are dropped');
  check(JSON.stringify(compactHistory(path.join(dir, 'missing-compact.tsv'), { cutoffMs: cutoff }))
    === JSON.stringify({ before: 0, kept: 0, dropped: 0 }),
  'compaction handles a missing file');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

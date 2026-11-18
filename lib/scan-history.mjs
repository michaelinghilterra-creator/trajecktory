import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { atomicWriteFileSync } from './atomic-write.mjs';

const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const AGEABLE_STATUSES = Object.freeze(['added', 'skipped_dup', 'skipped_title']);
const DEFAULT_COMPACT_STATUSES = AGEABLE_STATUSES.filter(status => status.startsWith('skipped_'));

function parseHistoryLine(line) {
  const raw = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!raw || raw.startsWith('url\t')) return null;
  const columns = raw.split('\t');
  const [url = '', firstSeen = '', portal = '', title = '', company = '', status = ''] = columns;
  return { url, firstSeen, portal, title, company, status, columns, raw };
}

export function* readHistoryLines(filePath, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE;
  const buffer = Buffer.alloc(size);
  const decoder = new StringDecoder('utf8');
  let carry = '';
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const text = carry + decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split('\n');
      carry = lines.pop() || '';
      yield* lines;
    }
    carry += decoder.end();
    if (carry) yield carry;
  } finally {
    fs.closeSync(fd);
  }
}

export function isAgedOut({ status, firstSeen }, cutoffMs) {
  if (!AGEABLE_STATUSES.includes(status)) return false;
  const entryTime = new Date(firstSeen || '').getTime();
  return Number.isFinite(entryTime) && entryTime < cutoffMs;
}

export function* readHistoryRows(filePath, { filter, chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  for (const line of readHistoryLines(filePath, { chunkSize })) {
    const row = parseHistoryLine(line);
    if (row && (!filter || filter(row))) yield row;
  }
}

export function* readHistoryRawRows(filePath, { filter, chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  for (const line of readHistoryLines(filePath, { chunkSize })) {
    const row = parseHistoryLine(line);
    if (row && (!filter || filter(row))) yield { ...row, rawLine: line };
  }
}

export function readHistoryUrls(filePath, { normalize = value => value, filter, chunkSize } = {}) {
  const urls = new Set();
  for (const row of readHistoryRows(filePath, { filter, chunkSize })) {
    if (!row.url) continue;
    const value = normalize(row.url);
    if (value) urls.add(value);
  }
  return urls;
}

export function compactHistory(filePath, {
  cutoffMs,
  statuses = DEFAULT_COMPACT_STATUSES,
  write = atomicWriteFileSync,
  chunkSize,
} = {}) {
  if (!fs.existsSync(filePath)) return { before: 0, kept: 0, dropped: 0 };

  const statusSet = new Set(statuses);
  const keptLines = [];
  let before = 0;
  let kept = 0;
  let dropped = 0;

  for (const line of readHistoryLines(filePath, { chunkSize })) {
    const row = parseHistoryLine(line);
    if (!row) {
      keptLines.push(line);
      continue;
    }

    before++;
    if (statusSet.has(row.status) && isAgedOut(row, cutoffMs)) {
      dropped++;
      continue;
    }
    kept++;
    keptLines.push(line);
  }

  if (dropped > 0) {
    const descriptor = fs.openSync(filePath, 'r');
    let endsWithLf = false;
    try {
      const size = fs.fstatSync(descriptor).size;
      if (size > 0) {
        const lastByte = Buffer.alloc(1);
        fs.readSync(descriptor, lastByte, 0, 1, size - 1);
        endsWithLf = lastByte[0] === 0x0a;
      }
    } finally {
      fs.closeSync(descriptor);
    }
    const output = keptLines.join('\n') + (endsWithLf ? '\n' : '');
    write(filePath, output, 'utf8');
  }

  return { before, kept, dropped };
}

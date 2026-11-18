import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_CHUNK_SIZE = 64 * 1024;

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

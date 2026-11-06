#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExemptFromAutoDiscard } from './lib/discard.mjs';
import { buildSimilarityIndex, findSimilarPosting, snapshotTextForRow } from './lib/jd-similarity.mjs';
import { canonicalPostingUrl, normalizeCompany, urlForRow } from './lib/identity.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';
import { withPassedReason } from './lib/passed.mjs';
import { formatTrackerLine, parseTrackerLine } from './lib/tracker.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? path.resolve(process.env.TJK_DATA_DIR) : path.join(ROOT, 'data');
const APPS_FILE = path.join(DATA_DIR, 'applications.md');
const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const ONLY = onlyArg
  ? new Set(onlyArg.slice('--only='.length).split(',').map((value) => value.trim()).filter(Boolean))
  : null;

if (!fs.existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to tag.');
  process.exit(0);
}

const content = fs.readFileSync(APPS_FILE, 'utf8');
const newline = content.includes('\r\n') ? '\r\n' : '\n';
const lines = content.split(newline);
const index = buildSimilarityIndex({ appsPath: APPS_FILE, rootDir: ROOT, allCompanies: true });
const firstPostingNum = new Map();
for (const line of lines) {
  const row = parseTrackerLine(line);
  if (!row) continue;
  const canonical = canonicalPostingUrl(urlForRow(row, ROOT) || '', ROOT);
  if (!canonical) continue;
  const key = `${normalizeCompany(row.company)}\0${canonical}`;
  const current = firstPostingNum.get(key);
  if (current === undefined || row.num < current) firstPostingNum.set(key, row.num);
}
const tags = [];
const samePostings = [];
let skipped = 0;

for (const line of lines) {
  const row = parseTrackerLine(line);
  if (!row || row.status !== 'Evaluated') continue;
  if (ONLY && !ONLY.has(String(row.num))) continue;
  if (isExemptFromAutoDiscard(row.notes)) {
    skipped += 1;
    continue;
  }
  const text = snapshotTextForRow(row, ROOT);
  if (text === null) continue;
  const resolvedUrl = urlForRow(row, ROOT) || '';
  const postingCanonical = canonicalPostingUrl(resolvedUrl, ROOT);
  const companyKey = normalizeCompany(row.company);
  const samePostingNum = postingCanonical
    ? firstPostingNum.get(`${companyKey}\0${postingCanonical}`)
    : null;
  if (samePostingNum != null && samePostingNum < row.num) {
    samePostings.push({ row, earlierNum: samePostingNum });
    continue;
  }
  const earlier = findSimilarPosting(index, {
    company: row.company,
    role: row.role,
    text,
    url: resolvedUrl,
    rootDir: ROOT,
    beforeNum: row.num,
  });
  if (!earlier) continue;
  tags.push({ row, earlier, pct: Math.round(earlier.similarity * 100) });
}

tags.sort((a, b) => a.row.num - b.row.num);
console.log(`${tags.length} rows to tag`);
for (const tag of tags) {
  console.log(`#${tag.row.num} ${tag.row.company} | ${tag.row.role} -> dup-of #${tag.earlier.num} (${tag.earlier.status}), ${tag.pct}% alike`);
}
for (const item of samePostings.sort((a, b) => a.row.num - b.row.num)) {
  console.log(`same posting, use dedup-tracker: #${item.row.num} -> #${item.earlierNum}`);
}
console.log(`Skipped: ${skipped} user-sourced rows`);

if (!APPLY) {
  console.log('Report only, nothing written. Re-run with --apply to tag these rows.');
  process.exit(0);
}

if (tags.length === 0) process.exit(0);

const tagByNum = new Map(tags.map((tag) => [tag.row.num, tag]));
const out = lines.map((line) => {
  const row = parseTrackerLine(line);
  const tag = row ? tagByNum.get(row.num) : null;
  if (!tag) return line;
  const detail = `dup-of #${tag.earlier.num} (${tag.earlier.status}, ${tag.pct}% alike). ${row.notes}`.trim();
  return formatTrackerLine({
    ...row,
    status: 'Passed',
    notes: withPassedReason(detail, 'duplicate'),
  });
});
const newText = out.join(newline);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const backup = `${APPS_FILE}.bak-${stamp}-dupe-tag`;

try {
  fs.copyFileSync(APPS_FILE, backup);
  if (logWritesEnabled(DATA_DIR)) {
    writeTableText({
      dataDir: DATA_DIR,
      file: 'applications.md',
      baseText: content,
      newText,
      rowKey: line => {
        const row = parseTrackerLine(line);
        return row ? String(row.num) : null;
      },
      buildEvents: ({ added, changed, removed }) => {
        if (added.length || removed.length) throw new Error('tag-duplicate-reposts may only update existing tracker rows');
        return changed.map((change) => {
          const before = parseTrackerLine(change.previousRaw);
          const row = parseTrackerLine(change.raw);
          return {
            type: 'status_changed',
            application_id: String(row.num),
            occurred_on: localToday(),
            payload: {
              ref: `app:${row.num}`,
              fields: ['status', 'notes'],
              from: before.status,
              to: row.status,
              legacy_effects: [change.effect],
            },
          };
        });
      },
    });
  } else {
    fs.writeFileSync(APPS_FILE, newText);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Tagged ${tags.length} rows as duplicate reposts.`);

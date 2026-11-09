#!/usr/bin/env node

// Retags tracker rows that the nightly sourcer found but that were labelled [self-sourced].
//
// merge-tracker used to tag every row whose URL was not in pipeline.md as [self-sourced], and the nightly
// path never goes through pipeline.md, so the sourcer's finds were labelled as the user's own picks. That
// label exempts a row from auto-discard, the dead-link sweep and the repost tagger. This script moves the
// rows it can PROVE came from the sourcer to [auto-sourced]: the row's posting URL must match a note that
// carries the sourcer's openclaw tag. Anything it cannot prove stays as it is.
//
//   node retag-auto-sourced.mjs --notes <dir> [--notes <dir> ...]            dry run, counts only
//   node retag-auto-sourced.mjs --notes <dir> [--notes <dir> ...] --apply    writes, with a backup
//
// TJK_DATA_DIR points it at a scratch copy of data/ for a rehearsal.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, urlForRow } from './lib/identity.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';
import { formatTrackerLine, parseTrackerLine } from './lib/tracker.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? path.resolve(process.env.TJK_DATA_DIR) : path.join(ROOT, 'data');
const APPS_FILE = path.join(DATA_DIR, 'applications.md');
const SOURCE_LOG = path.join(DATA_DIR, 'source-corrections.tsv');
const APPLY = process.argv.includes('--apply');

const noteDirs = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--notes' && process.argv[i + 1]) noteDirs.push(path.resolve(process.argv[i + 1]));
}
if (noteDirs.length === 0) {
  console.error('Give at least one notes folder: node retag-auto-sourced.mjs --notes <dir> [--notes <dir>] [--apply]');
  process.exit(2);
}
if (!fs.existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to retag.');
  process.exit(0);
}

// Posting URLs of notes the sourcer wrote. Reads only the frontmatter block of each note.
const sourcerUrls = new Set();
let notesRead = 0;
for (const dir of noteDirs) {
  if (!fs.existsSync(dir)) {
    console.error(`Notes folder not found: ${dir}`);
    process.exit(2);
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const lines = fs.readFileSync(path.join(dir, entry.name), 'utf8').split(/\r?\n/);
    if (lines[0] !== '---') continue;
    const close = lines.indexOf('---', 1);
    const block = lines.slice(1, close < 0 ? 40 : close).join('\n');
    notesRead += 1;
    if (!/\bopenclaw\b/i.test(block)) continue;
    const source = block.match(/^source:\s*"?([^"\n]+)"?\s*$/m);
    const canonical = source ? canonicalUrl(source[1].trim()) : '';
    if (canonical) sourcerUrls.add(canonical);
  }
}

const content = fs.readFileSync(APPS_FILE, 'utf8');
const newline = content.includes('\r\n') ? '\r\n' : '\n';
const lines = content.split(newline);
const retag = new Map();
let selfTagged = 0;
for (const line of lines) {
  const row = parseTrackerLine(line);
  if (!row || !/\[self-sourced\]/i.test(row.notes || '')) continue;
  selfTagged += 1;
  const url = urlForRow(row, ROOT) || row.url || '';
  if (url && sourcerUrls.has(canonicalUrl(url))) retag.set(row.num, row);
}

const byStatus = {};
for (const row of retag.values()) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
console.log(`notes read: ${notesRead}, sourcer notes: ${sourcerUrls.size}`);
console.log(`rows tagged [self-sourced]: ${selfTagged}`);
console.log(`rows to retag as [auto-sourced]: ${retag.size}`);
console.log(`left as [self-sourced] (no sourcer note matches): ${selfTagged - retag.size}`);
console.log(`by status: ${JSON.stringify(byStatus)}`);

if (!APPLY) {
  console.log('Report only, nothing written. Re-run with --apply to retag these rows.');
  process.exit(0);
}
if (retag.size === 0) process.exit(0);

const out = lines.map((line) => {
  const row = parseTrackerLine(line);
  if (!row || !retag.has(row.num)) return line;
  return formatTrackerLine({ ...row, notes: row.notes.replace(/\[self-sourced\]/i, '[auto-sourced]') });
});
const newText = out.join(newline);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const backup = `${APPS_FILE}.bak-${stamp}-auto-sourced`;

try {
  fs.copyFileSync(APPS_FILE, backup);
  if (logWritesEnabled(DATA_DIR)) {
    writeTableText({
      dataDir: DATA_DIR,
      file: 'applications.md',
      baseText: content,
      newText,
      rowKey: (line) => {
        const row = parseTrackerLine(line);
        return row ? String(row.num) : null;
      },
      buildEvents: ({ added, changed, removed }) => {
        if (added.length || removed.length) throw new Error('retag-auto-sourced may only update existing tracker rows');
        return changed.map((change) => {
          const row = parseTrackerLine(change.raw);
          return {
            type: 'legacy_record',
            occurred_on: localToday(),
            payload: {
              reason: 'tracker_row_updated',
              num: row.num,
              ref: `app:${row.num}`,
              fields: ['notes'],
              legacy_effects: [change.effect],
            },
          };
        });
      },
    });
  } else {
    fs.writeFileSync(APPS_FILE, newText);
  }
  // The same audit trail merge-tracker keeps for every source-tag change it makes.
  const header = 'date\taction\tnum\tcompany\trole\turl\n';
  if (!fs.existsSync(SOURCE_LOG)) fs.writeFileSync(SOURCE_LOG, header, 'utf8');
  const clean = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  const logRows = [...retag.values()].map((row) => [localToday(), 'retagged-auto-sourced', row.num, row.company, row.role, row.url].map(clean).join('\t'));
  fs.appendFileSync(SOURCE_LOG, `${logRows.join('\n')}\n`, 'utf8');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Retagged ${retag.size} rows as [auto-sourced]. Backup: ${path.basename(backup)}`);

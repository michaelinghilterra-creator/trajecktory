import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'retag-auto-sourced.mjs');
const flag = name => '-' + `-${name}`;
const tempRoot = path.join(root, '.test-sandboxes');
fs.mkdirSync(tempRoot, { recursive: true });
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;

function note(url, tagged) {
  const boundary = '-'.repeat(3);
  const tags = tagged ? 'tags:\n  - "Open Roles"\n  - "openclaw"\n' : 'tags:\n  - "Open Roles"\n';
  return `${boundary}\nsource: "${url}"\n${tags}${boundary}\nInvented posting\n`;
}

function trackerRow(num, status, notes) {
  return formatTrackerLine({
    num,
    date: `2033-01-0${num}`,
    company: num % 2 ? 'Quennox Ratchet Works' : 'Zorblax Widgetry',
    role: 'Revenue Systems Director',
    score: '4.0/5',
    status,
    pdf: 'x',
    resume: null,
    report: `[${num}](reports/${num}-fixture.md)`,
    notes,
    url: `https://jobs.example.test/roles/${num}`,
  });
}

function runRetag(data, folders, apply = false) {
  const args = [script];
  for (const folder of folders) args.push(flag('notes'), folder);
  if (apply) args.push(flag('apply'));
  return execFileSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, TJK_DATA_DIR: data },
    encoding: 'utf8',
  });
}

test('retag script reports, applies, audits, and classifies exact matches', async () => {
  const tmp = makeSandbox('auto-sourced-retag');
  const data = path.join(tmp, 'data');
  const triaged = path.join(tmp, 'Triaged');
  const openRoles = path.join(tmp, 'Open Roles');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(triaged, { recursive: true });
  fs.mkdirSync(openRoles, { recursive: true });

  const rows = [
    trackerRow(1, 'Evaluated', '[self-sourced] First invented note'),
    trackerRow(2, 'Passed', '[self-sourced] Second invented note'),
    trackerRow(3, 'Applied', '[self-sourced] Third invented note'),
    trackerRow(4, 'Evaluated', '[self-sourced] Untagged note match'),
    trackerRow(5, 'Evaluated', '[self-sourced] No note match'),
    trackerRow(6, 'Evaluated', 'No source tag'),
  ];
  const apps = path.join(data, 'applications.md');
  const original = ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, ...rows, ''].join('\n');
  fs.writeFileSync(apps, original);
  fs.writeFileSync(path.join(triaged, 'One.md'), note('https://jobs.example.test/roles/1?utm_source=fixture', true));
  fs.writeFileSync(path.join(triaged, 'Two.md'), note('https://jobs.example.test/roles/2', true));
  fs.writeFileSync(path.join(openRoles, 'Three.md'), note('https://jobs.example.test/roles/3', true));
  fs.writeFileSync(path.join(openRoles, 'Four.md'), note('https://jobs.example.test/roles/4', false));
  fs.writeFileSync(path.join(openRoles, 'Six.md'), note('https://jobs.example.test/roles/6', true));

  const dryOutput = runRetag(data, [triaged, openRoles]);
  assert.match(dryOutput, /rows to retag as \[auto-sourced\]: 3/);
  assert.equal(fs.readFileSync(apps, 'utf8'), original);

  const applyOutput = runRetag(data, [triaged, openRoles], true);
  assert.match(applyOutput, /Retagged 3 rows as \[auto-sourced\]/);
  const changed = fs.readFileSync(apps, 'utf8');
  const before = new Map(rows.map(line => [parseTrackerLine(line).num, parseTrackerLine(line)]));
  const after = new Map(changed.split(/\r?\n/).map(parseTrackerLine).filter(Boolean).map(row => [row.num, row]));
  for (const num of [1, 2, 3]) {
    assert.match(after.get(num).notes, /\[auto-sourced\]/);
    assert.doesNotMatch(after.get(num).notes, /\[self-sourced\]/);
    assert.equal(after.get(num).status, before.get(num).status);
    assert.equal(
      formatTrackerLine({ ...after.get(num), notes: after.get(num).notes.replace('[auto-sourced]', '[self-sourced]') }),
      rows[num - 1],
    );
  }
  assert.equal(changed.split(/\r?\n/).find(line => /^\| 4 \|/.test(line)), rows[3]);
  assert.equal(changed.split(/\r?\n/).find(line => /^\| 5 \|/.test(line)), rows[4]);
  assert.equal(changed.split(/\r?\n/).find(line => /^\| 6 \|/.test(line)), rows[5]);

  const backups = fs.readdirSync(data).filter(name => name.includes('.bak-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(data, backups[0]), 'utf8'), original);
  const corrections = fs.readFileSync(path.join(data, 'source-corrections.tsv'), 'utf8');
  assert.equal(corrections.split(/\r?\n/).filter(line => line.includes('retagged-auto-sourced')).length, 3);

  const secondOutput = runRetag(data, [triaged, openRoles], true);
  assert.match(secondOutput, /rows to retag as \[auto-sourced\]: 0/);
  assert.equal(fs.readdirSync(data).filter(name => name.includes('.bak-')).length, 1);

  const missingNotes = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, TJK_DATA_DIR: data },
    encoding: 'utf8',
  });
  assert.notEqual(missingNotes.status, 0);

  process.env.TJK_DATA_DIR = data;
  const applicationsUrl = pathToFileURL(path.join(root, 'dashboard-web', 'server', 'lib', 'applications.mjs')).href;
  const { parseApplicationsMd } = await import(`${applicationsUrl}?fixture=${Date.now()}`);
  const parsed = parseApplicationsMd();
  assert.equal(parsed.find(row => row.id === 1).source, 'Auto-sourced');
});

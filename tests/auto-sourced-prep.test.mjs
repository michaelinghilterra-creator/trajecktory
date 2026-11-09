import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { canonicalUrl } from '../lib/identity.mjs';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'batch', 'obsidian-prep.mjs');
const flag = name => '-' + `-${name}`;
const tempRoot = path.join(root, '.test-sandboxes');
fs.mkdirSync(tempRoot, { recursive: true });
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;

function obsidian(source, title, body = '', { company = '', created = '', tags = false } = {}) {
  const boundary = '-'.repeat(3);
  const extra = `${company ? `company: "${company}"\n` : ''}${created ? `created: "${created}"\n` : ''}`;
  const tagLines = tags ? 'tags:\n  - "Open Roles"\n  - "openclaw"\n' : '';
  return `${boundary}\nsource: "${source}"\ntitle: "${title}"\n${extra}${tagLines}${boundary}\n${body}\n`;
}

function prepare(tmp) {
  const source = path.join(tmp, 'Open Roles');
  const triaged = path.join(tmp, 'Triaged');
  const dupes = path.join(tmp, 'Dupes');
  const repo = path.join(tmp, 'repo');
  for (const dir of [source, triaged, path.join(repo, 'data'), path.join(repo, 'batch')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(repo, 'data', 'applications.md'), [
    '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, '',
  ].join('\n'));
  return { source, triaged, dupes, repo };
}

function runPrep({ source, triaged, dupes, repo }, apply = true) {
  const args = [script,
    flag('source'), source, flag('triaged'), triaged, flag('dupes'), dupes,
    flag('repo'), repo,
  ];
  if (apply) args.push(flag('apply'));
  return execFileSync(process.execPath, args, { encoding: 'utf8' });
}

test('prep lists only tagged survivors in canonical form', () => {
  const tmp = makeSandbox('auto-sourced-prep-tagged');
  const setup = prepare(tmp);
  const tagged = 'https://jobs.example.test/roles/1?utm_source=fixture';
  fs.writeFileSync(path.join(setup.source, 'Tagged.md'), obsidian(
    tagged, 'Revenue Systems Director', 'Invented posting body',
    { company: 'Quennox Ratchet Works', created: '2031-01-01', tags: true },
  ));
  fs.writeFileSync(path.join(setup.source, 'Plain.md'), obsidian(
    'https://jobs.example.test/roles/2', 'Revenue Systems Director', 'Another invented posting body',
    { company: 'Zorblax Widgetry', created: '2031-01-02' },
  ));

  runPrep(setup);

  const lines = fs.readFileSync(path.join(setup.repo, 'batch', 'obsidian-auto-sourced.txt'), 'utf8')
    .split(/\r?\n/).filter(Boolean);
  // The local: note path is listed too: merge-tracker sees that path, not the posting URL, for most notes.
  assert.deepEqual(lines, [canonicalUrl(tagged), `local:${path.resolve(setup.source, 'Tagged.md')}`]);
});

test('prep rewrites an empty auto sourced list when no survivor is tagged', () => {
  const tmp = makeSandbox('auto-sourced-prep-empty');
  const setup = prepare(tmp);
  fs.writeFileSync(path.join(setup.source, 'Plain.md'), obsidian(
    'https://jobs.example.test/roles/3', 'Revenue Systems Director', 'Invented posting body',
    { company: 'Quennox Ratchet Works', created: '2031-02-01' },
  ));

  runPrep(setup);

  assert.equal(fs.readFileSync(path.join(setup.repo, 'batch', 'obsidian-auto-sourced.txt'), 'utf8'), '\n');
});

test('prep excludes a tagged note quarantined by the tracker', () => {
  const tmp = makeSandbox('auto-sourced-prep-quarantine');
  const setup = prepare(tmp);
  const url = 'https://jobs.example.test/roles/4';
  const row = formatTrackerLine({
    num: 4,
    date: '2031-03-01',
    company: 'Quennox Ratchet Works',
    role: 'Revenue Systems Director',
    score: '4.0/5',
    status: 'Evaluated',
    pdf: 'x',
    resume: null,
    report: '[4](reports/4-quennox.md)',
    notes: '',
    url,
  });
  fs.writeFileSync(path.join(setup.repo, 'data', 'applications.md'), [
    '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row, '',
  ].join('\n'));
  fs.writeFileSync(path.join(setup.source, 'Tagged.md'), obsidian(
    url, 'Revenue Systems Director', 'Invented posting body',
    { company: 'Quennox Ratchet Works', created: '2031-03-02', tags: true },
  ));

  runPrep(setup);

  assert.equal(fs.readFileSync(path.join(setup.repo, 'batch', 'obsidian-auto-sourced.txt'), 'utf8'), '\n');
  assert.ok(fs.existsSync(path.join(setup.dupes, 'Tagged.md')));
});

test('prep dry run does not write the auto sourced list', () => {
  const tmp = makeSandbox('auto-sourced-prep-dry');
  const setup = prepare(tmp);
  fs.writeFileSync(path.join(setup.source, 'Tagged.md'), obsidian(
    'https://jobs.example.test/roles/5', 'Revenue Systems Director', 'Invented posting body',
    { company: 'Quennox Ratchet Works', created: '2031-04-01', tags: true },
  ));

  runPrep(setup, false);

  assert.equal(fs.existsSync(path.join(setup.repo, 'batch', 'obsidian-auto-sourced.txt')), false);
});

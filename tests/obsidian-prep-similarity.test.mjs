import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { jdSimilarity } from '../lib/jd-similarity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'batch', 'obsidian-prep.mjs');
const flag = name => '-' + `-${name}`;

function obsidian(source, title, body = '', { company = '', created = '' } = {}) {
  const boundary = '-'.repeat(3);
  const extra = `${company ? `company: "${company}"\n` : ''}${created ? `created: "${created}"\n` : ''}`;
  return `${boundary}\nsource: "${source}"\ntitle: "${title}"\n${extra}${boundary}\n${body}\n`;
}

function trackerRow(fields) {
  return formatTrackerLine({
    num: fields.num,
    date: '2030-01-05',
    company: fields.company,
    role: fields.role,
    score: '4.0/5',
    status: fields.status || 'Evaluated',
    pdf: 'x',
    resume: null,
    report: fields.report || `[${fields.num}](reports/${fields.num}-report.md)`,
    notes: '',
    url: fields.url,
  });
}

function alphabetic(index) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = letters[value % letters.length] + result;
    value = Math.floor(value / letters.length);
  }
  return result;
}

function postingWords(prefix, count, offset = 0) {
  return Array.from({ length: count }, (_, index) => `${prefix}${alphabetic(index + offset)}`);
}

const baseWords = postingWords('quennoxratchetcomponent', 220);
const baseText = baseWords.join(' ');
const nearCopyText = [...baseWords.slice(0, -12), ...postingWords('near', 12)].join(' ');
const differentText = postingWords('zorblaxwidget', 220).join(' ');

assert.ok(jdSimilarity(nearCopyText, baseText) >= 0.6);
assert.ok(jdSimilarity(differentText, baseText) < 0.6);

function prepare(tmp) {
  const source = path.join(tmp, 'Open Roles');
  const triaged = path.join(tmp, 'Triaged');
  const dupes = path.join(tmp, 'Dupes');
  const repo = path.join(tmp, 'repo');
  for (const dir of [source, triaged, path.join(repo, 'data'), path.join(repo, 'jds'), path.join(repo, 'batch')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { source, triaged, dupes, repo };
}

function runPrep({ source, triaged, dupes, repo }) {
  return execFileSync(process.execPath, [script,
    flag('source'), source, flag('triaged'), triaged, flag('dupes'), dupes,
    flag('repo'), repo, flag('apply'),
  ], { encoding: 'utf8' });
}

test('prep quarantines a similar tracker snapshot repost', () => {
  const tmp = makeSandbox('obsidian-prep-similar-tracker');
  try {
    const setup = prepare(tmp);
    const trackerUrl = 'https://jobs.example.test/roles/900001';
    const pendingUrl = 'https://jobs.example.test/roles/900002';
    fs.writeFileSync(path.join(setup.repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
      trackerRow({
        num: 900001,
        company: 'Quennox Ratchet Works Inc.',
        role: 'Revenue Systems Director',
        status: 'Applied',
        url: trackerUrl,
        report: '[900001](reports/900001-quennox.md)',
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(setup.repo, 'jds', '900001-quennox.md'), baseText);
    fs.writeFileSync(path.join(setup.source, 'Pending.md'), obsidian(
      pendingUrl,
      'Revenue Systems Director',
      nearCopyText,
      { company: 'Quennox Ratchet Works', created: '2030-01-06' },
    ));

    const output = runPrep(setup);

    assert.match(output, /quarantined similar-repost: 1/);
    assert.match(output, /similar-repost#900001 \(Applied\)/);
    assert.ok(fs.existsSync(path.join(setup.dupes, 'Pending.md')));
    assert.doesNotMatch(fs.readFileSync(path.join(setup.repo, 'batch', 'batch-input.tsv'), 'utf8'), /900002|Pending\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prep quarantines a similar evaluated triaged note', () => {
  const tmp = makeSandbox('obsidian-prep-similar-triaged');
  try {
    const setup = prepare(tmp);
    fs.writeFileSync(path.join(setup.repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, '',
    ].join('\n'));
    fs.writeFileSync(path.join(setup.triaged, 'Evaluated.md'), obsidian(
      'https://jobs.example.test/roles/900003',
      'Growth Analytics Lead',
      baseText,
      { company: 'Zorblax Widgetry', created: '2030-02-01' },
    ));
    fs.writeFileSync(path.join(setup.source, 'Pending.md'), obsidian(
      'https://jobs.example.test/roles/900004',
      'Growth Analytics Lead',
      nearCopyText,
      { company: 'Zorblax Widgetry', created: '2030-02-02' },
    ));

    const output = runPrep(setup);

    assert.match(output, /similar-evaluated-note/);
    assert.ok(fs.existsSync(path.join(setup.dupes, 'Pending.md')));
    assert.doesNotMatch(fs.readFileSync(path.join(setup.repo, 'batch', 'batch-input.tsv'), 'utf8'), /900004|Pending\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prep keeps the larger similar note from the same run', () => {
  const tmp = makeSandbox('obsidian-prep-similar-run');
  try {
    const setup = prepare(tmp);
    fs.writeFileSync(path.join(setup.repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, '',
    ].join('\n'));
    fs.writeFileSync(path.join(setup.source, 'Near.md'), obsidian(
      'https://jobs.example.test/roles/900005',
      'Revenue Systems Director',
      nearCopyText,
      { company: 'Quennox Ratchet Works', created: '2030-03-01' },
    ));
    fs.writeFileSync(path.join(setup.source, 'Base.md'), obsidian(
      'https://jobs.example.test/roles/900006',
      'Revenue Systems Director',
      baseText,
      { company: 'Quennox Ratchet Works', created: '2030-03-02' },
    ));

    const output = runPrep(setup);
    const input = fs.readFileSync(path.join(setup.repo, 'batch', 'batch-input.tsv'), 'utf8').trim().split('\n');

    assert.match(output, /similar-same-run/);
    assert.ok(input.length === 2);
    assert.match(input[1], /Base\.md/);
    assert.doesNotMatch(input[1], /Near\.md/);
    assert.ok(fs.existsSync(path.join(setup.dupes, 'Near.md')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prep preserves text role and length similarity negatives', () => {
  const tmp = makeSandbox('obsidian-prep-similar-negatives');
  try {
    const setup = prepare(tmp);
    fs.writeFileSync(path.join(setup.repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
      trackerRow({
        num: 900001,
        company: 'Quennox Ratchet Works Inc.',
        role: 'Revenue Systems Director',
        status: 'Applied',
        url: 'https://jobs.example.test/roles/900001',
        report: '[900001](reports/900001-quennox.md)',
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(setup.repo, 'jds', '900001-quennox.md'), baseText);
    fs.writeFileSync(path.join(setup.source, 'Different Text.md'), obsidian(
      'https://jobs.example.test/roles/900007',
      'Revenue Systems Director',
      differentText,
      { company: 'Quennox Ratchet Works', created: '2030-04-01' },
    ));
    fs.writeFileSync(path.join(setup.source, 'Different Role.md'), obsidian(
      'https://jobs.example.test/roles/900008',
      'Pricing Strategy Director',
      nearCopyText,
      { company: 'Quennox Ratchet Works', created: '2030-04-02' },
    ));
    fs.writeFileSync(path.join(setup.source, 'Short Body.md'), obsidian(
      'https://jobs.example.test/roles/900009',
      'Revenue Systems Director',
      baseWords.slice(0, 60).join(' '),
      { company: 'Quennox Ratchet Works', created: '2030-04-03' },
    ));

    const output = runPrep(setup);
    const input = fs.readFileSync(path.join(setup.repo, 'batch', 'batch-input.tsv'), 'utf8').trim().split('\n');

    assert.ok(input.length === 4);
    assert.match(input.join('\n'), /Different Text\.md/);
    assert.match(input.join('\n'), /Different Role\.md/);
    assert.match(input.join('\n'), /Short Body\.md/);
    assert.doesNotMatch(output, /quarantined similar-repost/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

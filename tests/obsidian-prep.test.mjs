import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

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
    date: '2026-08-27',
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

test('prep deduplicates, keeps reopened and thin files, and writes joined batch files', () => {
  const tmp = makeSandbox('obsidian-prep');
  try {
    const source = path.join(tmp, 'Open Roles');
    const triaged = path.join(tmp, 'Triaged');
    const dupes = path.join(tmp, 'Dupes');
    const repo = path.join(tmp, 'repo');
    for (const dir of [source, triaged, path.join(repo, 'data'), path.join(repo, 'batch')]) fs.mkdirSync(dir, { recursive: true });
    const existingUrl = 'https://jobs.example.test/roles/100001';
    const oldUrl = 'https://jobs.example.test/roles/200001';
    fs.writeFileSync(path.join(repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
      trackerRow({ num: 7, company: 'Known Co', role: 'Platform Director', url: existingUrl, status: 'Applied' }),
      trackerRow({ num: 8, company: 'Reopen Co', role: 'Revenue Director', url: oldUrl }),
      '',
    ].join('\r\n'));

    fs.writeFileSync(path.join(source, 'Already.md'), obsidian(existingUrl, 'Platform Director', 'full posting'));
    fs.writeFileSync(path.join(source, 'Pair.md'), obsidian('https://jobs.example.test/roles/300001', 'Pair Role', 'small'));
    fs.writeFileSync(path.join(source, 'Pair 1.md'), obsidian('https://jobs.example.test/roles/300001', 'Pair Role', 'a much larger posting body that should win'));
    const reopened = path.join(source, 'Reopened.md');
    fs.writeFileSync(reopened, obsidian('https://jobs.example.test/roles/200002', 'Revenue Director', 'new requisition'));
    const thin = path.join(source, 'Thin.md');
    fs.writeFileSync(thin, obsidian('https://jobs.example.test/roles/400001', 'Thin Role'));

    const output = execFileSync(process.execPath, [script,
      flag('source'), source, flag('triaged'), triaged, flag('dupes'), dupes,
      flag('repo'), repo, flag('thin-bytes'), '200', flag('apply'),
    ], { encoding: 'utf8' });

    assert.match(output, /Already\.md\s+.*applications#7 \(Applied\)/);
    assert.match(output, /Pair\.md\s+.*same-run/);
    assert.match(output, /THIN[\s\S]*Thin\.md/);
    assert.ok(fs.existsSync(path.join(dupes, 'Already.md')));
    assert.ok(fs.existsSync(path.join(dupes, 'Pair.md')));
    assert.ok(fs.existsSync(path.join(source, 'Pair 1.md')));

    const input = fs.readFileSync(path.join(repo, 'batch', 'batch-input.tsv'), 'utf8').trim().split('\n').map(line => line.split('\t'));
    assert.deepEqual(input[0], ['id', 'url', 'source', 'notes']);
    assert.deepEqual(input.slice(1).map(row => row[0]), ['1', '2', '3']);
    assert.ok(input.slice(1).every(row => row[1].startsWith('local:') && path.isAbsolute(row[1].slice(6)) && row[2] === 'obsidian'));
    assert.ok(!input.some(row => row.join('\t').includes('Already.md')));
    assert.ok(input.some(row => row[1] === `local:${path.resolve(reopened)}`));

    const manifest = fs.readFileSync(path.join(repo, 'batch', 'obsidian-manifest.tsv'), 'utf8').trim().split('\n').map(line => line.split('\t'));
    assert.deepEqual(manifest[0], ['id', 'source_file', 'source_url', 'bytes']);
    assert.deepEqual(manifest.slice(1).map(row => row[0]), ['1', '2', '3']);
    assert.ok(manifest.some(row => row[1] === path.resolve(thin) && row[2] === 'https://jobs.example.test/roles/400001'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prep deduplicates pipeline, handled and active reposts before max selection', () => {
  const tmp = makeSandbox('obsidian-prep-dedup-max');
  try {
    const source = path.join(tmp, 'Open Roles');
    const triaged = path.join(tmp, 'Triaged');
    const dupes = path.join(tmp, 'Dupes');
    const repo = path.join(tmp, 'repo');
    for (const dir of [source, triaged, path.join(repo, 'data'), path.join(repo, 'batch')]) fs.mkdirSync(dir, { recursive: true });
    const pipelineUrl = 'https://jobs.example.test/roles/900001';
    const handledUrl = 'https://jobs.example.test/roles/900002';
    fs.writeFileSync(path.join(repo, 'data', 'pipeline.md'), `- [ ] ${pipelineUrl} | Zorblax Widgetry | Pipeline Role\n`);
    fs.writeFileSync(path.join(repo, 'data', 'triage-dismissed.tsv'), `url\treason\n${handledUrl}\tduplicate\n`);
    fs.writeFileSync(path.join(repo, 'data', 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
      trackerRow({ num: 900003, company: 'Quennox Ratchet Works', role: 'Active Role', url: 'https://jobs.example.test/roles/900003', status: 'Applied' }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(source, 'Pipeline.md'), obsidian(pipelineUrl, 'Pipeline Role'));
    fs.writeFileSync(path.join(source, 'Handled.md'), obsidian(handledUrl, 'Handled Role'));
    fs.writeFileSync(path.join(source, 'Repost.md'), obsidian('https://jobs.example.test/roles/900004', 'Active Role', '', { company: 'Quennox Ratchet Works' }));
    const dates = ['2030-01-04', '2030-01-01', '2030-01-03', '2030-01-02'];
    const names = ['Fourth.md', 'First.md', 'Third.md', 'Second.md'];
    names.forEach((name, index) => fs.writeFileSync(path.join(source, name),
      obsidian(`https://jobs.example.test/roles/${900010 + index}`, `${name} Role`, '', { created: dates[index] })));

    const output = execFileSync(process.execPath, [script,
      flag('source'), source, flag('triaged'), triaged, flag('dupes'), dupes,
      flag('repo'), repo, flag('max'), '2', flag('apply'),
    ], { encoding: 'utf8' });

    assert.match(output, /quarantined pipeline: 1/);
    assert.match(output, /quarantined handled: 1/);
    assert.match(output, /quarantined active-repost: 1/);
    assert.match(output, /deferred: 2/);
    const input = fs.readFileSync(path.join(repo, 'batch', 'batch-input.tsv'), 'utf8');
    assert.match(input, /First\.md/);
    assert.match(input, /Second\.md/);
    assert.doesNotMatch(input, /Third\.md|Fourth\.md/);
    assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /roleSignature/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { formatTrackerLine, parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'batch', 'obsidian-postfix.mjs');
const flag = name => '-' + `-${name}`;

function row(num, company, status, report, url) {
  return formatTrackerLine({ num, date: '2026-08-27', company, role: 'Director', score: '2.5/5', status, pdf: 'x', resume: null, report, notes: '', url });
}

test('postfix repairs this run, recovers strays, and leaves unrelated rows alone', () => {
  const tmp = makeSandbox('obsidian-postfix');
  try {
    const repo = path.join(tmp, 'repo');
    const source = path.join(tmp, 'Open Roles');
    const dest = path.join(tmp, 'Triaged');
    const reports = path.join(repo, 'reports');
    const stray = path.join(repo, 'batch', 'reports');
    const data = path.join(repo, 'data');
    for (const dir of [source, reports, stray, data]) fs.mkdirSync(dir, { recursive: true });
    const sourceFile = path.join(source, 'Role.md');
    const realUrl = 'https://jobs.example.test/roles/900001';
    const reportFile = '001-acme-2026-08-27.md';
    const boundary = '-'.repeat(3);
    fs.writeFileSync(sourceFile, 'source role');
    fs.writeFileSync(path.join(reports, reportFile), `${boundary}\n{"url": "local:C:/Open Roles/Role.md", "score": 2.5}\n${boundary}\n**URL:** ${realUrl}\nReport\n`);
    fs.writeFileSync(path.join(stray, '003-stray.md'), 'recover me');
    fs.writeFileSync(path.join(stray, '004-clash.md'), 'do not overwrite');
    fs.writeFileSync(path.join(reports, '004-clash.md'), 'keep me');
    fs.writeFileSync(path.join(repo, 'batch', 'obsidian-manifest.tsv'), `id\tsource_file\tsource_url\tbytes\n1\t${sourceFile}\t${realUrl}\t20\n`);
    fs.writeFileSync(path.join(repo, 'batch', 'batch-state.tsv'), 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\tlocal:x\tcompleted\ta\tb\t1\t2.5\t\t0\n');
    fs.writeFileSync(path.join(data, 'applications.md'), [
      '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
      row(1, 'Acme', 'Discarded', `[001](reports/${reportFile})`, 'http://old.test'),
      row(2, 'Other', 'Discarded', '[002](reports/002-other.md)', 'http://other.test'),
      '',
    ].join('\r\n'));

    const output = execFileSync(process.execPath, [script, flag('source'), source, flag('dest'), dest, flag('repo'), repo, flag('apply')], { encoding: 'utf8' });
    assert.match(output, /stray reports recovered: 1/);
    assert.match(output, /report urls fixed: 1/);
    assert.match(output, /tracker urls fixed: 1/);
    assert.match(output, /rows re-flipped: 1/);
    assert.match(output, /source files moved: 1/);
    assert.match(output, /source files unmoved: 0/);
    assert.match(fs.readFileSync(path.join(reports, reportFile), 'utf8'), new RegExp(realUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const rows = fs.readFileSync(path.join(data, 'applications.md'), 'utf8').split(/\r?\n/).map(parseTrackerLine).filter(Boolean);
    assert.equal(rows.find(item => item.num === 1).url, realUrl);
    assert.equal(rows.find(item => item.num === 1).status, 'Evaluated');
    assert.equal(rows.find(item => item.num === 2).status, 'Discarded');
    assert.ok(fs.existsSync(path.join(reports, '003-stray.md')));
    assert.equal(fs.readFileSync(path.join(reports, '004-clash.md'), 'utf8'), 'keep me');
    assert.ok(fs.existsSync(path.join(stray, '004-clash.md')));
    assert.ok(fs.existsSync(path.join(dest, 'Role.md')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('postfix leaves completed sources when reports are missing or lack a URL header', () => {
  const tmp = makeSandbox('obsidian-postfix-unmoved');
  try {
    const repo = path.join(tmp, 'repo');
    const source = path.join(tmp, 'Open Roles');
    const dest = path.join(tmp, 'Triaged');
    for (const dir of [source, path.join(repo, 'reports'), path.join(repo, 'batch'), path.join(repo, 'data')]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const missing = path.join(source, 'Missing.md');
    const invalid = path.join(source, 'Invalid.md');
    fs.writeFileSync(missing, 'missing report');
    fs.writeFileSync(invalid, 'invalid report');
    fs.writeFileSync(path.join(repo, 'reports', '002-invalid.md'), '# Report without URL header\n');
    fs.writeFileSync(path.join(repo, 'batch', 'obsidian-manifest.tsv'), [
      'id\tsource_file\tsource_url\tbytes',
      `1\t${missing}\thttps://jobs.example.test/roles/900001\t20`,
      `2\t${invalid}\thttps://jobs.example.test/roles/900002\t20`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'batch', 'batch-state.tsv'), [
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
      '1\tlocal:x\tcompleted\ta\tb\t1\t4.0\t\t0',
      '2\tlocal:y\tcompleted\ta\tb\t2\t4.0\t\t0',
      '',
    ].join('\n'));

    const output = execFileSync(process.execPath, [script, flag('source'), source, flag('dest'), dest, flag('repo'), repo, flag('apply')], { encoding: 'utf8' });
    assert.match(output, /not moved \(no valid report\): 1/);
    assert.match(output, /not moved \(no valid report\): 2/);
    assert.match(output, /source files unmoved: 2/);
    assert.ok(fs.existsSync(missing));
    assert.ok(fs.existsSync(invalid));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('postfix archives a source whose v1 report carries the URL only in JSON frontmatter', () => {
  const tmp = makeSandbox('obsidian-postfix-v1-url');
  try {
    const repo = path.join(tmp, 'repo');
    const source = path.join(tmp, 'Open Roles');
    const dest = path.join(tmp, 'Triaged');
    for (const dir of [source, path.join(repo, 'reports'), path.join(repo, 'batch'), path.join(repo, 'data')]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const note = path.join(source, 'V1.md');
    fs.writeFileSync(note, 'v1 report note');
    fs.writeFileSync(path.join(repo, 'reports', '003-zorblax-widgetry-2030-01-01.md'),
      '---\n{"schema": "v1", "url": "https://jobs.example.test/roles/900003", "score": 4.1}\n---\n# Report\n');
    fs.writeFileSync(path.join(repo, 'batch', 'obsidian-manifest.tsv'), [
      'id\tsource_file\tsource_url\tbytes',
      `1\t${note}\thttps://jobs.example.test/roles/900003\t20`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'batch', 'batch-state.tsv'), [
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
      '1\tlocal:x\tcompleted\ta\tb\t3\t4.1\t\t0',
      '',
    ].join('\n'));
    const output = execFileSync(process.execPath, [script, flag('source'), source, flag('dest'), dest, flag('repo'), repo, flag('apply')], { encoding: 'utf8' });
    assert.match(output, /source files moved: 1/);
    assert.ok(!fs.existsSync(note));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

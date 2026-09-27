import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { main } from '../batch/obsidian-nightly.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = name => '-' + `-${name}`;

function fixture(name) {
  const repo = makeRepoSandbox(root, name);
  const source = path.join(repo, 'source');
  const triaged = path.join(repo, 'triaged');
  const dupes = path.join(repo, 'dupes');
  for (const dir of [source, triaged, dupes, path.join(repo, 'batch'), path.join(repo, 'data')]) fs.mkdirSync(dir, { recursive: true });
  for (const file of ['merge-tracker.mjs', 'compute-scores.mjs', 'resync-tracker-scores.mjs', 'clean-generated-text.mjs', 'verify-actionable.mjs', 'health-check.mjs', 'verify-pipeline.mjs']) {
    fs.writeFileSync(path.join(repo, file), 'process.exitCode = 0;\n');
  }
  for (const file of ['obsidian-prep.mjs', 'obsidian-postfix.mjs']) fs.writeFileSync(path.join(repo, 'batch', file), 'process.exitCode = 0;\n');
  fs.writeFileSync(path.join(repo, 'batch', 'drain-wrapper.sh'), '#!/usr/bin/env bash\n');
  const summary = path.join(repo, 'batch', 'summary.json');
  const args = [flag('repo'), repo, flag('source'), source, flag('triaged'), triaged, flag('dupes'), dupes, flag('summary'), summary];
  return { repo, source, triaged, dupes, summary, args };
}

function result(stdout = '', status = 0) {
  return { status, stdout, stderr: '' };
}

test('billing gate aborts before commands run', () => {
  const fx = fixture('obsidian-nightly-billing');
  let calls = 0;
  const code = main(fx.args, { env: { ANTHROPIC_API_KEY: 'test-only' }, run: () => { calls++; return result(); } });
  assert.equal(code, 2);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(fs.readFileSync(fx.summary, 'utf8')).reason, 'billing-gate');
});

test('held lock aborts', () => {
  const fx = fixture('obsidian-nightly-lock');
  fs.writeFileSync(path.join(fx.repo, 'batch', 'obsidian-nightly.lock'), `${process.pid}\t2030-01-01T00:00:00.000Z\n`);
  const code = main(fx.args, { env: {}, run: () => result() });
  assert.equal(code, 2);
  assert.equal(JSON.parse(fs.readFileSync(fx.summary, 'utf8')).reason, 'locked');
});

test('zero survivors skips drain', () => {
  const fx = fixture('obsidian-nightly-empty');
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (String(args[0]).endsWith('obsidian-prep.mjs')) return result('scanned: 0\nsurvivors: 0\ndeferred: 0\nTHIN\n');
    return result();
  };
  assert.equal(main(fx.args, { env: {}, run }), 0);
  assert.ok(!calls.some(([, args]) => String(args[0]).endsWith('drain-wrapper.sh')));
});

test('verify finding returns one and summary includes reports and score bands', () => {
  const fx = fixture('obsidian-nightly-findings');
  fs.writeFileSync(path.join(fx.source, 'Role.md'), 'role');
  const run = (command, args) => {
    const script = String(args[0]);
    if (script.endsWith('obsidian-prep.mjs')) {
      fs.writeFileSync(path.join(fx.repo, 'batch', 'batch-state.tsv'), [
        'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
        '1\thttps://jobs.example.test/roles/900001\tcompleted\ta\tb\t900001\t4.6\t\t0', '',
      ].join('\n'));
      fs.writeFileSync(path.join(fx.repo, 'data', 'applications.md'), [
        '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
        formatTrackerLine({ num: 900001, date: '2030-01-01', company: 'Zorblax Widgetry', role: 'Widget Director', score: '4.6/5', status: 'Evaluated', pdf: 'x', resume: null, report: '[900001](reports/900001-zorblax.md)', notes: '', url: 'https://jobs.example.test/roles/900001' }), '',
      ].join('\n'));
      return result('scanned: 1\nsurvivors: 1\ndeferred: 0\nTHIN\n');
    }
    if (script.endsWith('drain-wrapper.sh')) return result('DRAIN_RESULT completed=1 failed=0 skipped=0\n');
    if (script.endsWith('obsidian-postfix.mjs')) return result('source files moved: 1\nsource files unmoved: 0\nreport urls fixed: 1\ntracker urls fixed: 1\nrows re-flipped: 0\n');
    if (script.endsWith('verify-pipeline.mjs')) return result('finding', 1);
    return result();
  };
  assert.equal(main(fx.args, { env: {}, run }), 1);
  const summary = JSON.parse(fs.readFileSync(fx.summary, 'utf8'));
  assert.equal(summary.schema, 'obsidian-nightly/v1');
  assert.equal(summary.status, 'findings');
  assert.equal(summary.reports[0].company, 'Zorblax Widgetry');
  assert.equal(summary.scoreBands['4.5+'], 1);
  assert.equal(summary.postfix.urlsRepaired, 2);
});

test('failed drain still runs postfix and reports findings', () => {
  const fx = fixture('obsidian-nightly-drain-fail');
  const calls = [];
  const run = (command, args) => {
    const script = String(args[0]);
    calls.push(script);
    if (script.endsWith('obsidian-prep.mjs')) return result('scanned: 1\nsurvivors: 1\ndeferred: 0\nTHIN\n');
    if (script.endsWith('drain-wrapper.sh')) return result('DRAIN_RESULT completed=0 failed=1 skipped=0\n', 1);
    return result();
  };
  assert.equal(main(fx.args, { env: {}, run }), 1);
  assert.ok(calls.some(script => script.endsWith('obsidian-postfix.mjs')));
  assert.equal(JSON.parse(fs.readFileSync(fx.summary, 'utf8')).status, 'findings');
});

test('dry run writes nothing', () => {
  const fx = fixture('obsidian-nightly-dry');
  let calls = 0;
  const code = main([...fx.args, flag('dry-run')], { env: {}, run: () => { calls++; return result(); } });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.ok(!fs.existsSync(fx.summary));
  assert.ok(!fs.existsSync(path.join(fx.repo, 'batch', 'obsidian-nightly.lock')));
});

test('missing paths print usage and exit two', () => {
  assert.equal(main([], { env: {}, run: () => result() }), 2);
});

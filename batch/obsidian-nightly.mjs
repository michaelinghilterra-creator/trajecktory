#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTrackerLine } from '../lib/tracker.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepo = path.resolve(scriptDir, '..');
const flag = name => '-' + `-${name}`;

function usage() {
  console.error('Usage: node batch/obsidian-nightly.mjs --source <dir> --triaged <dir> --dupes <dir> [--max 50] [--summary <file>] [--dry-run] [--no-sandbox] [--repo <dir>]');
}

export function argumentsFor(argv, env = process.env) {
  const result = {
    source: env.TJK_OBSIDIAN_SOURCE || '',
    triaged: env.TJK_OBSIDIAN_TRIAGED || '',
    dupes: env.TJK_OBSIDIAN_DUPES || '',
    max: env.TJK_OBSIDIAN_MAX || '50',
    repo: defaultRepo,
    summary: '',
    dryRun: false,
    sandbox: true,
  };
  const values = new Map([
    [flag('source'), 'source'], [flag('triaged'), 'triaged'], [flag('dupes'), 'dupes'],
    [flag('max'), 'max'], [flag('summary'), 'summary'], [flag('repo'), 'repo'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag('dry-run')) result.dryRun = true;
    else if (argv[i] === flag('no-sandbox')) result.sandbox = false;
    else if (values.has(argv[i])) result[values.get(argv[i])] = argv[++i] || '';
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  result.repo = path.resolve(result.repo);
  result.source = result.source ? path.resolve(result.source) : '';
  result.triaged = result.triaged ? path.resolve(result.triaged) : '';
  result.dupes = result.dupes ? path.resolve(result.dupes) : '';
  result.max = Number(result.max);
  if (!Number.isInteger(result.max) || result.max < 1) throw new Error('max must be a positive integer');
  result.summary = result.summary ? path.resolve(result.summary) : path.join(result.repo, 'batch', 'nightly-summary.json');
  return result;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function livePidIn(file) {
  if (!fs.existsSync(file)) return null;
  const pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
  return pidAlive(pid) ? pid : null;
}

function tail(text, count = 40) {
  return String(text || '').split(/\r?\n/).filter(Boolean).slice(-count);
}

function commandText(command, args) {
  return [command, ...args].map(part => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function runStep(run, step, command, args, options = {}) {
  const result = run(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout,
  });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  return {
    step,
    exitCode,
    ok: exitCode === 0 && !result.error,
    tail: tail(`${result.stdout || ''}\n${result.stderr || ''}`),
    stdout: String(result.stdout || ''),
  };
}

function parsePrep(text) {
  const result = { scanned: 0, survivors: 0, quarantined: {}, thin: 0, deferred: 0 };
  for (const line of String(text).split(/\r?\n/)) {
    let match = line.match(/^(scanned|survivors|deferred):\s*(\d+)/);
    if (match) result[match[1]] = Number(match[2]);
    match = line.match(/^quarantined\s+(.+):\s*(\d+)/);
    if (match) result.quarantined[match[1]] = Number(match[2]);
  }
  const thinBlock = String(text).match(/(?:^|\n)THIN\r?\n([\s\S]*)$/)?.[1] || '';
  result.thin = thinBlock.split(/\r?\n/).filter(line => line.includes('\t')).length;
  return result;
}

function numberFrom(text, label) {
  const match = String(text).match(new RegExp(`${label}:?\\s*(\\d+)`, 'i'));
  return match ? Number(match[1]) : 0;
}

function parseDrain(text) {
  const match = String(text).match(/DRAIN_RESULT completed=(\d+) failed=(\d+) skipped=(\d+)/);
  return match ? { completed: Number(match[1]), failed: Number(match[2]), skipped: Number(match[3]) }
    : { completed: 0, failed: 0, skipped: 0 };
}

function parsePostfix(text) {
  return {
    moved: numberFrom(text, 'source files moved'),
    unmoved: numberFrom(text, 'source files unmoved'),
    urlsRepaired: numberFrom(text, 'report urls fixed') + numberFrom(text, 'tracker urls fixed'),
    reflipped: numberFrom(text, 'rows re-flipped'),
  };
}

function completedRows(statePath) {
  if (!fs.existsSync(statePath)) return [];
  const lines = fs.readFileSync(statePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split('\t') || [];
  const at = name => header.indexOf(name);
  return lines.map(line => line.split('\t')).filter(cols => cols[at('status')] === 'completed').map(cols => ({
    id: cols[at('id')], reportNum: Number.parseInt(cols[at('report_num')], 10),
    stateScore: cols[at('score')], url: cols[at('url')],
  })).filter(row => Number.isInteger(row.reportNum));
}

function reportSummary(repo, completed) {
  const trackerPath = path.join(repo, 'data', 'applications.md');
  const tracker = fs.existsSync(trackerPath)
    ? fs.readFileSync(trackerPath, 'utf8').split(/\r?\n/).map(parseTrackerLine).filter(Boolean)
    : [];
  return completed.map(item => {
    const row = tracker.find(candidate => candidate.num === item.reportNum);
    return {
      id: item.id,
      reportNum: item.reportNum,
      company: row?.company || '',
      role: row?.role || '',
      score: row?.score || item.stateScore || '',
      status: row?.status || '',
      url: row?.url || item.url || '',
    };
  });
}

function scoreBands(reports) {
  const bands = { '4.5+': 0, '4.0-4.4': 0, '3.5-3.9': 0, '<3.5': 0 };
  for (const report of reports) {
    const score = Number.parseFloat(report.score);
    if (!Number.isFinite(score)) continue;
    if (score >= 4.5) bands['4.5+']++;
    else if (score >= 4.0) bands['4.0-4.4']++;
    else if (score >= 3.5) bands['3.5-3.9']++;
    else bands['<3.5']++;
  }
  return bands;
}

function markdownBacklog(source) {
  if (!fs.existsSync(source)) return 0;
  return fs.readdirSync(source, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md')).length;
}

function modelCheck(repo, startedMs, expected) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projects)) return null;
  const repoName = path.basename(repo).toLowerCase();
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl') && fs.statSync(full).mtimeMs >= startedMs) files.push(full);
    }
  };
  for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.toLowerCase().includes(repoName)) walk(path.join(projects, entry.name));
  }
  const ids = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // "<synthetic>" marks CLI-generated messages (errors, interrupts), not a model choice.
    for (const match of text.matchAll(/"model"\s*:\s*"([^"]+)"/g)) if (match[1] !== '<synthetic>') ids.push(match[1]);
  }
  return ids.length ? ids.every(id => id === expected) : null;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const run = dependencies.run || spawnSync;
  const env = dependencies.env || process.env;
  let options;
  try { options = argumentsFor(argv, env); }
  catch (error) { console.error(`Error: ${error.message}`); usage(); return 2; }
  if (!options.source || !options.triaged || !options.dupes) { usage(); return 2; }

  const startedAt = new Date().toISOString();
  const startedMs = Date.parse(startedAt);
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const summary = {
    schema: 'obsidian-nightly/v1', startedAt, finishedAt: null, status: 'ok',
    model, modelVerified: null, sandbox: options.sandbox,
    prep: { scanned: 0, survivors: 0, quarantined: {}, thin: 0, deferred: 0 },
    drain: { completed: 0, failed: 0, skipped: 0 },
    postfix: { moved: 0, unmoved: 0, urlsRepaired: 0, reflipped: 0 },
    reports: [], scoreBands: { '4.5+': 0, '4.0-4.4': 0, '3.5-3.9': 0, '<3.5': 0 },
    steps: [], backlog: markdownBacklog(options.source),
  };
  const lockPath = path.join(options.repo, 'batch', 'obsidian-nightly.lock');
  const runnerLock = path.join(options.repo, 'batch', 'batch-runner.pid');
  let locked = false;
  const finish = (status, reason, code, write = true) => {
    summary.status = status;
    if (reason) summary.reason = reason;
    summary.finishedAt = new Date().toISOString();
    summary.backlog = markdownBacklog(options.source);
    if (write && !options.dryRun) atomicJson(options.summary, summary);
    return code;
  };

  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return finish('aborted', 'billing-gate', 2);
  const held = livePidIn(lockPath);
  if (held) return finish('aborted', 'locked', 2);
  const runnerPid = livePidIn(runnerLock);
  if (runnerPid) return finish('aborted', 'runner-busy', 2);

  const bash = env.TJK_BASH || 'bash';
  const prepArgs = [path.join(options.repo, 'batch', 'obsidian-prep.mjs'), flag('source'), options.source,
    flag('triaged'), options.triaged, flag('dupes'), options.dupes, flag('apply'), flag('max'), String(options.max), flag('repo'), options.repo];
  const drainArgs = [path.join(options.repo, 'batch', 'drain-wrapper.sh'), flag('fresh')];
  if (options.sandbox) drainArgs.push(flag(''), flag('sandbox'));
  const postfixArgs = [path.join(options.repo, 'batch', 'obsidian-postfix.mjs'), flag('source'), options.source,
    flag('dest'), options.triaged, flag('apply'), flag('repo'), options.repo];

  if (options.dryRun) {
    const plans = [
      [process.execPath, [path.join(options.repo, 'merge-tracker.mjs')]],
      [process.execPath, prepArgs], [bash, drainArgs], [process.execPath, postfixArgs],
      [process.execPath, [path.join(options.repo, 'compute-scores.mjs'), flag('all'), flag('apply')]],
      [process.execPath, [path.join(options.repo, 'resync-tracker-scores.mjs'), flag('apply'), flag('only'), '<tonight-ids>']],
      [process.execPath, [path.join(options.repo, 'clean-generated-text.mjs'), 'reports', flag('apply')]],
      [process.execPath, [path.join(options.repo, 'merge-tracker.mjs')]],
      [process.execPath, [path.join(options.repo, 'verify-actionable.mjs'), flag('apply')]],
      [process.execPath, [path.join(options.repo, 'health-check.mjs')]],
      [process.execPath, [path.join(options.repo, 'verify-pipeline.mjs')]],
    ];
    for (const [command, args] of plans) console.log(commandText(command, args));
    return 0;
  }

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    if (fs.existsSync(lockPath)) {
      if (livePidIn(lockPath)) return finish('aborted', 'locked', 2);
      fs.unlinkSync(lockPath);
    }
    try {
      fs.writeFileSync(lockPath, `${process.pid}\t${startedAt}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') return finish('aborted', 'locked', 2);
      throw error;
    }
    locked = true;
    const commandEnv = { ...env, ANTHROPIC_MODEL: model };

    const required = (step, command, args, opts = {}) => {
      const result = runStep(run, step, command, args, { cwd: options.repo, env: commandEnv, ...opts });
      summary.steps.push({ step: result.step, exitCode: result.exitCode, ok: result.ok, tail: result.tail });
      return result;
    };

    let result = required('merge-orphans', process.execPath, [path.join(options.repo, 'merge-tracker.mjs')], { timeout: 10 * 60 * 1000 });
    if (!result.ok) return finish('aborted', 'merge-orphans', 2);
    result = required('prep', process.execPath, prepArgs, { timeout: 10 * 60 * 1000 });
    summary.prep = parsePrep(result.stdout);
    if (!result.ok) return finish('aborted', 'prep', 2);

    let drainFailed = false;
    if (summary.prep.survivors > 0) {
      result = required('drain', bash, drainArgs, { cwd: path.join(options.repo, 'batch'), timeout: 3.5 * 60 * 60 * 1000 });
      summary.drain = parseDrain(result.stdout);
      // A failed drain still leaves completed rows behind. Postfix must run for them, or their
      // tracker rows keep local: URLs and tomorrow's prep evaluates the same roles again.
      drainFailed = !result.ok;
      result = required('postfix', process.execPath, postfixArgs, { timeout: 10 * 60 * 1000 });
      summary.postfix = parsePostfix(result.stdout);
      if (!result.ok) return finish('aborted', 'postfix', 2);
    }

    const completed = completedRows(path.join(options.repo, 'batch', 'batch-state.tsv'));
    const post = [
      ['compute-scores', 'compute-scores.mjs', [flag('all'), flag('apply')], 10 * 60 * 1000],
    ];
    if (completed.length) post.push(['resync-tracker-scores', 'resync-tracker-scores.mjs', [flag('apply'), flag('only'), completed.map(row => row.reportNum).join(',')], 10 * 60 * 1000]);
    post.push(
      ['clean-generated-text', 'clean-generated-text.mjs', ['reports', flag('apply')], 10 * 60 * 1000],
      ['merge-tracker', 'merge-tracker.mjs', [], 10 * 60 * 1000],
      ['verify-actionable', 'verify-actionable.mjs', [flag('apply')], 45 * 60 * 1000],
      ['health-check', 'health-check.mjs', [], 10 * 60 * 1000],
      ['verify-pipeline', 'verify-pipeline.mjs', [], 10 * 60 * 1000],
    );
    let findings = drainFailed || summary.drain.failed > 0 || summary.postfix.unmoved > 0;
    for (const [step, script, args, timeout] of post) {
      result = required(step, process.execPath, [path.join(options.repo, script), ...args], { timeout });
      if (!result.ok) findings = true;
    }

    summary.reports = reportSummary(options.repo, completed);
    summary.scoreBands = scoreBands(summary.reports);
    summary.modelVerified = modelCheck(options.repo, startedMs, model);
    if (summary.modelVerified === false) findings = true;
    return finish(findings ? 'findings' : 'ok', '', findings ? 1 : 0);
  } catch (error) {
    summary.steps.push({ step: 'nightly', exitCode: 1, ok: false, tail: tail(error.stack || error.message) });
    return finish('aborted', 'exception', 2);
  } finally {
    if (locked) {
      try { fs.unlinkSync(lockPath); } catch { /* lock already absent */ }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

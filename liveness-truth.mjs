#!/usr/bin/env node
// Record human liveness checks and compare them with checker verdicts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalUrl } from './lib/identity.mjs';
import { localToday } from './lib/local-date.mjs';
import { parseTrackerLine } from './lib/tracker.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.TJK_DATA_DIR || path.join(scriptDir, 'data'));
const truthPath = path.join(dataDir, 'liveness-truth.tsv');
const flag = name => `--${name}`;

function usage() {
  console.error(`Usage:
  node liveness-truth.mjs record <url-or-tracker-id> <live|dead> [${flag('note')} <text>]
  node liveness-truth.mjs report [${flag('json')}]`);
}

function clean(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function trackerUrl(id) {
  const applicationsPath = path.join(dataDir, 'applications.md');
  if (!fs.existsSync(applicationsPath)) fail(`Unknown tracker id: ${id}`);
  for (const line of fs.readFileSync(applicationsPath, 'utf8').split(/\r?\n/)) {
    const row = parseTrackerLine(line);
    if (row?.num !== Number(id)) continue;
    if (!/^https?:\/\//.test(row.url || '')) fail(`Tracker id ${id} has no http(s) url`);
    return row.url;
  }
  fail(`Unknown tracker id: ${id}`);
}

function record(args) {
  if (args.length < 2) {
    usage();
    process.exit(2);
  }
  const [target, truth, ...rest] = args;
  if (truth !== 'live' && truth !== 'dead') fail(`Invalid truth value: ${truth}`);

  let note = '';
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== flag('note')) fail(`Expected ${flag('note')} <text>`);
    note = rest[1];
  }

  const isId = /^\d+$/.test(target);
  const url = isId ? trackerUrl(target) : target;
  if (!fs.existsSync(truthPath)) {
    fs.writeFileSync(truthPath, 'date\turl\tid\ttruth\tnote\n');
  }
  const fields = [localToday(), url, isId ? target : '', truth, note].map(clean);
  fs.appendFileSync(truthPath, `${fields.join('\t')}\n`);
  console.log(`Recorded ${truth} for ${url}`);
}

function report(asJson) {
  const truths = new Map();
  for (const row of readRows(truthPath)) {
    const key = canonicalUrl(row.url);
    if (key) truths.set(key, row);
  }

  const verdicts = new Map();
  const sources = [
    { file: 'gate-history.tsv', field: 'result' },
    { file: 'liveness-observations.tsv', field: 'verdict' },
  ];
  for (const source of sources) {
    for (const row of readRows(path.join(dataDir, source.file))) {
      const verdict = row[source.field];
      if (!['active', 'expired', 'uncertain'].includes(verdict)) continue;
      const key = canonicalUrl(row.url);
      if (!key) continue;
      const current = verdicts.get(key);
      if (!current || row.date >= current.date) verdicts.set(key, { date: row.date, verdict });
    }
  }

  const byVerdict = {
    active: { live: 0, dead: 0 },
    expired: { live: 0, dead: 0 },
    uncertain: { live: 0, dead: 0 },
  };
  let unmatched = 0;
  for (const [key, truth] of truths) {
    const checker = verdicts.get(key);
    if (!checker) {
      unmatched++;
      continue;
    }
    if (truth.truth === 'live' || truth.truth === 'dead') {
      byVerdict[checker.verdict][truth.truth]++;
    }
  }
  const result = {
    byVerdict,
    falseDead: byVerdict.expired.live,
    falseLive: byVerdict.active.dead,
    unmatched,
  };

  if (asJson) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log('Verdict\tLive\tDead');
  for (const verdict of ['active', 'expired', 'uncertain']) {
    console.log(`${verdict}\t${byVerdict[verdict].live}\t${byVerdict[verdict].dead}`);
  }
  console.log(`False dead (checker expired, actually live): ${result.falseDead}`);
  console.log(`False live (checker active, actually dead): ${result.falseLive}`);
  console.log(`Unmatched: ${result.unmatched}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'record') {
  record(args);
} else if (command === 'report') {
  if (args.length > 1 || (args.length === 1 && args[0] !== flag('json'))) {
    usage();
    process.exit(2);
  }
  report(args[0] === flag('json'));
} else {
  usage();
  process.exit(2);
}

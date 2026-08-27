#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerLine, formatTrackerLine } from '../lib/tracker.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const flag = name => '-' + `-${name}`;

function argumentsFor(argv) {
  const result = { repo: path.resolve(scriptDir, '..'), apply: false };
  const values = new Map([[flag('source'), 'source'], [flag('dest'), 'dest'], [flag('repo'), 'repo']]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag('apply')) result.apply = true;
    else if (values.has(argv[i])) result[values.get(argv[i])] = argv[++i];
  }
  return result;
}

function table(pathname) {
  if (!fs.existsSync(pathname)) return [];
  const lines = fs.readFileSync(pathname, 'utf8').split(/\r?\n/);
  return lines.slice(1).filter(Boolean).map(line => line.split('\t'));
}

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function availableDestination(dir, basename) {
  const parsed = path.parse(basename);
  let name = parsed.name;
  let destination = path.join(dir, basename);
  while (fs.existsSync(destination)) {
    name += ' (dup)';
    destination = path.join(dir, `${name}${parsed.ext}`);
  }
  return destination;
}

function moveFile(source, destination) {
  try { fs.renameSync(source, destination); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}

function rewriteTracker(appsPath, transform, apply) {
  if (!fs.existsSync(appsPath)) return 0;
  const text = fs.readFileSync(appsPath, 'utf8');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let changed = 0;
  const next = lines.map(line => {
    const row = parseTrackerLine(line);
    if (!row) return line;
    const replacement = transform(row);
    if (!replacement) return line;
    changed++;
    return formatTrackerLine(replacement);
  });
  if (changed && apply) fs.writeFileSync(appsPath, next.join(newline));
  return changed;
}

function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (!options.source || !options.dest) {
    console.error('Error: source and dest are required');
    process.exitCode = 1;
    return;
  }
  const repo = path.resolve(options.repo);
  const reportsDir = path.join(repo, 'reports');
  const strayDir = path.join(repo, 'batch', 'reports');
  const appsPath = path.join(repo, 'data', 'applications.md');
  const manifestPath = path.join(repo, 'batch', 'obsidian-manifest.tsv');
  const statePath = path.join(repo, 'batch', 'batch-state.tsv');
  let recovered = 0;
  if (options.apply) fs.mkdirSync(reportsDir, { recursive: true });
  for (const basename of markdownFiles(strayDir)) {
    const source = path.join(strayDir, basename);
    const destination = path.join(reportsDir, basename);
    if (fs.existsSync(destination)) {
      console.log(`conflict, skipped ${basename}`);
      continue;
    }
    if (options.apply) moveFile(source, destination);
    else console.log(`would recover ${basename}`);
    recovered++;
  }

  const manifest = new Map(table(manifestPath).map(row => [String(row[0]), { sourceFile: row[1], sourceUrl: row[2] || '' }]));
  const completed = new Map();
  for (const row of table(statePath)) {
    const reportNum = Number.parseInt(row[5], 10);
    if (row[2] === 'completed' && Number.isInteger(reportNum)) completed.set(String(row[0]), reportNum);
  }
  const reportsIndex = new Map();
  for (const basename of markdownFiles(reportsDir)) {
    const num = Number.parseInt(basename, 10);
    if (Number.isInteger(num)) reportsIndex.set(num, basename);
  }
  if (!options.apply) {
    for (const basename of markdownFiles(strayDir)) {
      const num = Number.parseInt(basename, 10);
      if (Number.isInteger(num) && !reportsIndex.has(num) && !fs.existsSync(path.join(reportsDir, basename))) reportsIndex.set(num, basename);
    }
  }

  let reportUrls = 0;
  let trackerUrls = 0;
  const runNums = new Set();
  const matches = [];
  for (const [id, item] of manifest) {
    if (!completed.has(id)) continue;
    const reportNum = completed.get(id);
    const reportFile = reportsIndex.get(reportNum);
    if (!item.sourceUrl) { console.log(`skip id ${id}: empty source url`); continue; }
    if (!reportFile) { console.log(`skip id ${id}: report ${reportNum} missing`); continue; }
    runNums.add(reportNum);
    matches.push({ reportNum, reportFile, realUrl: item.sourceUrl });
    const reportPath = path.join(reportsDir, reportFile);
    if (fs.existsSync(reportPath)) {
      const text = fs.readFileSync(reportPath, 'utf8');
      const match = text.match(/"url"\s*:\s*"([^"]*)"/);
      if (match && match[1] !== item.sourceUrl) {
        const next = text.replace(/"url"\s*:\s*"[^"]*"/, () => `"url": "${item.sourceUrl}"`);
        if (options.apply) fs.writeFileSync(reportPath, next);
        else console.log(`would fix report url ${reportFile}`);
        reportUrls++;
      }
    }
  }

  trackerUrls = rewriteTracker(appsPath, row => {
    const match = matches.find(item => path.basename(row.reportPath || '') === item.reportFile)
      || matches.find(item => row.num === item.reportNum);
    if (!match || row.url === match.realUrl) return null;
    if (!options.apply) console.log(`would fix tracker url ${row.num}`);
    return { ...row, url: match.realUrl };
  }, options.apply);

  const reflipped = rewriteTracker(appsPath, row => {
    if (!runNums.has(row.num) || row.status !== 'Discarded') return null;
    console.log(`${options.apply ? 'flipped' : 'would flip'} ${row.num}, ${row.company}`);
    return { ...row, status: 'Evaluated' };
  }, options.apply);

  let moved = 0;
  if (options.apply) fs.mkdirSync(options.dest, { recursive: true });
  for (const [id, item] of manifest) {
    if (!completed.has(id)) continue;
    const sourceFile = path.resolve(item.sourceFile);
    const sourceRoot = path.resolve(options.source);
    if (path.dirname(sourceFile) !== sourceRoot || !fs.existsSync(sourceFile)) continue;
    const destination = availableDestination(options.dest, path.basename(sourceFile));
    if (options.apply) moveFile(sourceFile, destination);
    else console.log(`would move ${path.basename(sourceFile)}`);
    moved++;
  }

  console.log(`stray reports recovered: ${recovered}`);
  console.log(`report urls fixed: ${reportUrls}`);
  console.log(`tracker urls fixed: ${trackerUrls}`);
  console.log(`rows re-flipped: ${reflipped}`);
  console.log(`source files moved: ${moved}`);
}

main();

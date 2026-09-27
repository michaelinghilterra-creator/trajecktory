#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canonicalUrl,
  buildActiveRoleIndex,
  buildDecidedIndex,
  findActiveRepost,
  findDecided,
  normalizeCompany,
} from '../lib/identity.mjs';
import { loadHandledSet, readPipelineRows, sourceUrlOf } from '../lib/pipeline.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const flag = name => '-' + `-${name}`;

function argumentsFor(argv) {
  const result = { repo: path.resolve(scriptDir, '..'), thinBytes: 600, max: null, apply: false };
  const values = new Map([
    [flag('source'), 'source'],
    [flag('triaged'), 'triaged'],
    [flag('dupes'), 'dupes'],
    [flag('repo'), 'repo'],
    [flag('thin-bytes'), 'thinBytes'],
    [flag('max'), 'max'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag('apply')) result.apply = true;
    else if (values.has(argv[i])) result[values.get(argv[i])] = argv[++i];
  }
  result.thinBytes = Number(result.thinBytes);
  if (!Number.isFinite(result.thinBytes) || result.thinBytes < 0) throw new Error('thin-bytes must be a nonnegative number');
  if (result.max !== null) {
    result.max = Number(result.max);
    if (!Number.isInteger(result.max) || result.max < 1) throw new Error('max must be a positive integer');
  }
  return result;
}

function frontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  const boundary = '-'.repeat(3);
  if (lines[0] !== boundary) return { sourceUrl: '', title: '', company: '', created: '' };
  const end = lines.indexOf(boundary, 1);
  if (end < 0) return { sourceUrl: '', title: '', company: '', created: '' };
  const block = lines.slice(1, end).join('\n');
  const source = block.match(/^source:\s*"?([^"\n]+)"?\s*$/m);
  const title = block.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  const company = block.match(/^company:\s*"?([^"\n]+)"?\s*$/m);
  const created = block.match(/^created:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m);
  return {
    sourceUrl: source ? source[1].trim() : '',
    title: title ? title[1].trim() : '',
    company: company ? company[1].trim() : '',
    created: created ? created[1] : '',
  };
}

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !entry.name.startsWith('_'))
    .map(entry => path.resolve(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function availableDestination(dir, basename) {
  const parsed = path.parse(basename);
  let destination = path.join(dir, basename);
  while (fs.existsSync(destination)) {
    destination = path.join(dir, `${parsed.name} (dup)${parsed.ext}`);
    if (!fs.existsSync(destination)) break;
    parsed.name += ' (dup)';
  }
  return destination;
}

function moveFile(source, destination) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}

function main() {
  let options;
  try { options = argumentsFor(process.argv.slice(2)); }
  catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; return; }
  if (!options.source || !options.triaged || !options.dupes) {
    console.error('Error: source, triaged, and dupes are required');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(options.source)) {
    console.error(`Error: source directory does not exist: ${options.source}`);
    process.exitCode = 1;
    return;
  }

  const repo = path.resolve(options.repo);
  const appsPath = path.join(repo, 'data', 'applications.md');
  const statePath = path.join(repo, 'batch', 'batch-state.tsv');
  if (fs.existsSync(statePath)) {
    if (options.apply) {
      fs.copyFileSync(statePath, `${statePath}.bak`);
      fs.unlinkSync(statePath);
      console.log('reset batch-state.tsv');
    } else console.log('would reset batch-state.tsv');
  }

  const sourceFiles = markdownFiles(options.source);
  const idx = buildDecidedIndex({ appsPath, rootDir: repo });
  const activeIdx = buildActiveRoleIndex({ appsPath, rootDir: repo });
  const pipelineRows = readPipelineRows(path.join(repo, 'data', 'pipeline.md'), 'open');
  const pipelineKeys = new Set(pipelineRows.flatMap(row => [row.canonical, sourceUrlOf(row.url, repo)]).filter(Boolean));
  const handled = loadHandledSet({
    appsPath,
    dismissedPath: path.join(repo, 'data', 'triage-dismissed.tsv'),
    rootDir: repo,
    additionsDir: path.join(repo, 'batch', 'tracker-additions'),
    // needs-manual-jd.tsv is deliberately NOT passed: those rows are waiting for someone to
    // supply the JD text, and a clipped note is exactly that, so it must be evaluated.
  });
  const triagedKeys = new Set();
  for (const file of markdownFiles(options.triaged)) {
    const { sourceUrl } = frontmatter(fs.readFileSync(file, 'utf8'));
    const key = canonicalUrl(sourceUrl);
    if (key) triagedKeys.add(key);
  }

  const kept = new Map();
  const quarantined = [];
  for (const file of sourceFiles) {
    const bytes = fs.statSync(file).size;
    const parsed = frontmatter(fs.readFileSync(file, 'utf8'));
    const title = parsed.title || path.basename(file, path.extname(file));
    const key = canonicalUrl(parsed.sourceUrl) || `nourl::${normalizeCompany(title)}`;
    const item = {
      file, bytes, sourceUrl: parsed.sourceUrl, title, company: parsed.company,
      created: parsed.created, mtimeMs: fs.statSync(file).mtimeMs, key,
    };
    if (kept.has(key)) {
      const previous = kept.get(key);
      if (bytes > previous.bytes) {
        quarantined.push({ ...previous, reason: 'same-run', matchedOn: 'same-run' });
        kept.set(key, item);
      } else quarantined.push({ ...item, reason: 'same-run', matchedOn: 'same-run' });
    } else if (triagedKeys.has(key)) {
      quarantined.push({ ...item, reason: 'triaged', matchedOn: 'triaged' });
    } else {
      const row = findDecided(idx, parsed.sourceUrl, { company: '', role: title });
      if (row) quarantined.push({ ...item, reason: 'applications', matchedOn: `applications#${row.num} (${row.status})` });
      else if (pipelineKeys.has(key)) quarantined.push({ ...item, reason: 'pipeline', matchedOn: 'pipeline' });
      else if (handled.has(key)) quarantined.push({ ...item, reason: 'handled', matchedOn: 'handled' });
      else {
        const repost = parsed.company
          ? findActiveRepost(activeIdx, parsed.sourceUrl, { company: parsed.company, role: title })
          : null;
        if (repost) quarantined.push({ ...item, reason: 'active-repost', matchedOn: 'active-repost' });
        else kept.set(key, item);
      }
    }
  }

  if (quarantined.length && options.apply) fs.mkdirSync(options.dupes, { recursive: true });
  for (const item of quarantined) {
    const destination = availableDestination(options.dupes, path.basename(item.file));
    if (options.apply) {
      moveFile(item.file, destination);
      console.log(`quarantined ${path.basename(item.file)}`);
    } else console.log(`would quarantine ${path.basename(item.file)}`);
  }

  const ordered = [...kept.values()].sort((a, b) => {
    const aTime = a.created ? Date.parse(`${a.created}T00:00:00Z`) : a.mtimeMs;
    const bTime = b.created ? Date.parse(`${b.created}T00:00:00Z`) : b.mtimeMs;
    return aTime - bTime || path.basename(a.file).localeCompare(path.basename(b.file));
  });
  const selected = options.max === null ? ordered : ordered.slice(0, options.max);
  const deferred = ordered.length - selected.length;
  const survivors = selected.sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)));
  const thin = survivors.filter(item => item.bytes < options.thinBytes);
  const inputRows = ['id\turl\tsource\tnotes'];
  const manifestRows = ['id\tsource_file\tsource_url\tbytes'];
  survivors.forEach((item, index) => {
    const id = index + 1;
    const notes = item.title.replace(/[\t\r\n]/g, ' ');
    inputRows.push(`${id}\tlocal:${path.resolve(item.file)}\tobsidian\t${notes}`);
    manifestRows.push(`${id}\t${path.resolve(item.file)}\t${item.sourceUrl}\t${item.bytes}`);
  });
  if (options.apply) {
    fs.mkdirSync(path.join(repo, 'batch'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'batch', 'batch-input.tsv'), `${inputRows.join('\n')}\n`);
    fs.writeFileSync(path.join(repo, 'batch', 'obsidian-manifest.tsv'), `${manifestRows.join('\n')}\n`);
  } else {
    console.log(`would write ${survivors.length} survivor rows`);
    for (const row of inputRows.slice(1, 6)) console.log(row);
  }

  console.log(`scanned: ${sourceFiles.length}`);
  console.log(`survivors: ${survivors.length}`);
  console.log(`deferred: ${deferred}`);
  const reasonCounts = new Map();
  for (const item of quarantined) reasonCounts.set(item.reason, (reasonCounts.get(item.reason) || 0) + 1);
  for (const [reason, count] of [...reasonCounts].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`quarantined ${reason}: ${count}`);
  }
  console.log('QUARANTINED');
  for (const item of quarantined) console.log(`${path.basename(item.file)}\t${item.key}\t${item.matchedOn}`);
  console.log('THIN');
  for (const item of thin) console.log(`${path.basename(item.file)}\t${item.bytes}`);
}

main();

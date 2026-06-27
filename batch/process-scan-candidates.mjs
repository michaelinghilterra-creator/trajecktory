#!/usr/bin/env node
import fs from 'node:fs';
import yaml from 'js-yaml';

const candidates = JSON.parse(fs.readFileSync('batch/scan-candidates.json', 'utf8'));
const portals = yaml.load(fs.readFileSync('portals.yml', 'utf8'));
const tf = portals.title_filter;

const histRaw = fs.readFileSync('data/scan-history.tsv', 'utf8');
const histUrls = new Set(histRaw.split('\n').slice(1).map(l => l.split('\t')[0]).filter(Boolean));

const pipeRaw = fs.readFileSync('data/pipeline.md', 'utf8');
const pipeUrls = new Set();
for (const m of pipeRaw.matchAll(/https?:\/\/[^\s|)]+/g)) pipeUrls.add(m[0]);

const appsRaw = fs.readFileSync('data/applications.md', 'utf8');
// Build (company, normalized role) set
const normRole = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b(sr|senior|sn)\b/g,'').replace(/\bdir\b/g,'director').trim();
const appsKeys = new Set();
for (const line of appsRaw.split('\n')) {
  const m = line.match(/^\|\s*\d+\s*\|\s*[^|]*\|\s*([^|]+)\|\s*([^|]+)\|/);
  if (m) appsKeys.add(m[1].trim().toLowerCase() + '||' + normRole(m[2]));
}

const passesTitle = title => {
  const t = title.toLowerCase();
  const hasPos = tf.positive.some(k => t.includes(k.toLowerCase()));
  const hasNeg = tf.negative.some(k => t.includes(k.toLowerCase()));
  return hasPos && !hasNeg;
};

const out = { added: [], dupUrl: [], dupApp: [], filtered: [] };
const seen = new Set();
for (const c of candidates) {
  const url = c.url.replace(/\?.*$/, '');
  if (seen.has(url)) { out.dupUrl.push(c); continue; }
  seen.add(url);
  if (histUrls.has(url) || pipeUrls.has(url) || histUrls.has(c.url) || pipeUrls.has(c.url)) { out.dupUrl.push(c); continue; }
  const key = c.company.trim().toLowerCase() + '||' + normRole(c.title);
  if (appsKeys.has(key)) { out.dupApp.push(c); continue; }
  if (!passesTitle(c.title)) { out.filtered.push(c); continue; }
  out.added.push({ ...c, url });
}

const today = new Date().toISOString().slice(0,10);

// Append to pipeline.md under Pendientes (or 'Pending'). Find the right section.
let pipe = fs.readFileSync('data/pipeline.md', 'utf8');
const addLines = out.added.map(c => `- [ ] ${c.url} | ${c.company} | ${c.title}`).join('\n');

// Find first heading that is the pending section
const pendingHeadingRe = /^(##+\s*(Pendientes|Pending|Inbox).*$)/mi;
const mH = pipe.match(pendingHeadingRe);
if (mH) {
  // Insert right after the heading + skip blank line
  const idx = pipe.indexOf(mH[0]) + mH[0].length;
  pipe = pipe.slice(0, idx) + '\n' + addLines + (pipe[idx] === '\n' ? '' : '\n') + pipe.slice(idx);
} else {
  pipe += (pipe.endsWith('\n') ? '' : '\n') + addLines + '\n';
}
if (out.added.length) fs.writeFileSync('data/pipeline.md', pipe);

// Append to scan-history.tsv
let hist = histRaw;
if (!hist.endsWith('\n')) hist += '\n';
const histRows = [];
for (const c of out.added) histRows.push(`${c.url}\t${today}\t${c.query}\t${c.title}\t${c.company}\tadded`);
for (const c of out.dupUrl) histRows.push(`${c.url}\t${today}\t${c.query}\t${c.title}\t${c.company}\tskipped_dup`);
for (const c of out.dupApp) histRows.push(`${c.url}\t${today}\t${c.query}\t${c.title}\t${c.company}\tskipped_dup`);
for (const c of out.filtered) histRows.push(`${c.url}\t${today}\t${c.query}\t${c.title}\t${c.company}\tskipped_title`);
fs.writeFileSync('data/scan-history.tsv', hist + histRows.join('\n') + '\n');

console.log(JSON.stringify({
  total: candidates.length,
  added: out.added.length,
  dupUrl: out.dupUrl.length,
  dupApp: out.dupApp.length,
  filtered: out.filtered.length,
  addedList: out.added.map(c => `${c.company} | ${c.title}`),
  filteredList: out.filtered.map(c => `${c.company} | ${c.title}`),
}, null, 2));

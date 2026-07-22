#!/usr/bin/env node
import fs from 'node:fs';
import yaml from 'js-yaml';
import { canonicalUrl, normalizeCompany, sameRole } from '../lib/identity.mjs';
import { parseTracker } from '../lib/tracker.mjs';

const candidates = JSON.parse(fs.readFileSync('batch/scan-candidates.json', 'utf8'));
const portals = yaml.load(fs.readFileSync('portals.yml', 'utf8'));
const tf = portals.title_filter;

const histRaw = fs.readFileSync('data/scan-history.tsv', 'utf8');
const histUrls = new Set(histRaw.split('\n').slice(1).map(l => canonicalUrl(l.split('\t')[0])).filter(Boolean));

const pipeRaw = fs.readFileSync('data/pipeline.md', 'utf8');
const pipeUrls = new Set();
for (const m of pipeRaw.matchAll(/https?:\/\/[^\s|)]+/g)) pipeUrls.add(canonicalUrl(m[0]));

// Tracker rows, read with the canonical parser. This used to be a hand-rolled
// regex over the raw line, which the "never hand-roll a tracker row" rule in
// AGENTS.md exists to prevent: it counted pipes positionally and drifted the
// moment a column was added.
const appRows = parseTracker(fs.readFileSync('data/applications.md', 'utf8'));

const passesTitle = title => {
  const t = title.toLowerCase();
  const hasPos = tf.positive.some(k => t.includes(k.toLowerCase()));
  const hasNeg = tf.negative.some(k => t.includes(k.toLowerCase()));
  return hasPos && !hasNeg;
};

const out = { added: [], dupUrl: [], dupApp: [], filtered: [] };
const seen = new Set();
for (const c of candidates) {
  // Canonical key for comparison; the RAW url is what gets written out. This
  // previously stripped the entire query string and then stored that stripped
  // form, which erased the gh_jid that is the only thing distinguishing one
  // posting from another on boards that reuse one posting path — corrupting
  // scan-history for every future run, not just this one.
  const key = canonicalUrl(c.url);
  if (seen.has(key)) { out.dupUrl.push(c); continue; }
  seen.add(key);
  if (histUrls.has(key) || pipeUrls.has(key)) { out.dupUrl.push(c); continue; }
  // Company+role is the FALLBACK, only for tracker rows with no resolvable URL.
  const co = normalizeCompany(c.company);
  if (appRows.some(r => !r.url && normalizeCompany(r.company) === co && sameRole(r.role, c.title))) {
    out.dupApp.push(c); continue;
  }
  if (!passesTitle(c.title)) { out.filtered.push(c); continue; }
  out.added.push({ ...c });
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

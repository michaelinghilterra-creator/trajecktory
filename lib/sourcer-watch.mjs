import fs from 'fs';
import path from 'path';
import { canonicalUrl } from './identity.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isWatchDate(value) {
  if (!DATE_RE.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJson(file) {
  const text = readText(file).trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function readJsonLines(file) {
  const rows = [];
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip malformed records */ }
  }
  return rows;
}

function readTsv(file) {
  const lines = readText(file).split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map(value => value.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });
}

function filesForDate(stateDir, prefix, date, extension) {
  let names;
  try { names = fs.readdirSync(stateDir); } catch { return []; }
  const escaped = date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${prefix}-${escaped}(?:-[^.]+)?\\.${extension}$`);
  return names.filter(name => pattern.test(name)).sort().map(name => path.join(stateDir, name));
}

function urlKey(value) {
  if (typeof value !== 'string' || !value) return '';
  return canonicalUrl(value) || value;
}

function stageLabel(stage) {
  const raw = String(stage || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'gate-title') return 'Title filter';
  if (lower === 'gate-location') return 'Location';
  if (lower.includes('dup')) return 'Duplicate';
  if (lower.includes('age') || lower.includes('old')) return 'Too old';
  if (lower.includes('prefilter')) return 'Pre-filter';
  return raw;
}

function emptyNight(date) {
  return {
    date,
    totals: { found: 0, dropped: 0, kept: 0, evaluated: 0, strong: 0 },
    byOutcome: {},
    health: {},
    roles: [],
  };
}

export function listWatchDates(stateDir) {
  const inboxDir = path.join(stateDir, 'inbox');
  let entries;
  try { entries = fs.readdirSync(inboxDir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isDirectory() && isWatchDate(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 30);
}

export function buildWatchNight({ stateDir, date, sites }) {
  if (!isWatchDate(date)) return emptyNight(date);
  const watched = new Set((sites || []).map(site => String(site).trim().toLowerCase()).filter(Boolean));
  const candidatesFile = path.join(stateDir, 'inbox', date, 'candidates.jsonl');
  const candidates = readJsonLines(candidatesFile).filter(candidate => watched.has(String(candidate.site || '').toLowerCase()));

  const rejected = new Map();
  for (const file of filesForDate(stateDir, 'rejects', date, 'tsv')) {
    for (const row of readTsv(file)) {
      const key = urlKey(row.url);
      if (key && !rejected.has(key)) rejected.set(key, { reason: stageLabel(row.stage) });
    }
  }

  const evaluated = new Map();
  let written = 0;
  for (const file of filesForDate(stateDir, 'summary', date, 'json')) {
    const summary = readJson(file);
    if (!summary) continue;
    const bySite = summary.ingest?.writtenBySite;
    if (bySite && typeof bySite === 'object') {
      for (const [site, count] of Object.entries(bySite)) {
        if (watched.has(site.toLowerCase()) && Number.isFinite(Number(count))) written += Number(count);
      }
    }
    for (const report of summary.eval?.reports || []) {
      const key = urlKey(report.url);
      if (!key) continue;
      const parsedScore = Number.parseFloat(report.score);
      evaluated.set(key, {
        score: Number.isFinite(parsedScore) ? parsedScore : null,
        reportNum: report.reportNum ?? null,
      });
    }
  }

  const roles = candidates.map((candidate) => {
    const keys = [urlKey(candidate.url), urlKey(candidate.applyUrl)].filter(Boolean);
    const reject = keys.map(key => rejected.get(key)).find(Boolean);
    const report = keys.map(key => evaluated.get(key)).find(Boolean);
    let outcome = 'kept';
    let reason = 'No result recorded';
    let score = null;
    let reportNum = null;
    if (reject) {
      outcome = 'dropped';
      reason = reject.reason;
    } else if (report) {
      outcome = 'evaluated';
      reason = '';
      score = report.score;
      reportNum = report.reportNum;
    }
    return {
      site: candidate.site || '',
      company: candidate.company || '',
      title: candidate.title || '',
      location: candidate.location || '',
      posted: candidate.posted || '',
      segment: candidate.segment || '',
      url: candidate.url || candidate.applyUrl || '',
      outcome,
      reason,
      score,
      reportNum,
    };
  });

  const order = { evaluated: 0, kept: 1, dropped: 2 };
  roles.sort((a, b) => {
    const group = order[a.outcome] - order[b.outcome];
    if (group) return group;
    if (a.outcome === 'evaluated') {
      const score = (b.score ?? -Infinity) - (a.score ?? -Infinity);
      if (score) return score;
    }
    return a.company.localeCompare(b.company) || a.title.localeCompare(b.title);
  });

  const totals = {
    found: written || roles.length,
    dropped: roles.filter(role => role.outcome === 'dropped').length,
    kept: roles.filter(role => role.outcome === 'kept').length,
    evaluated: roles.filter(role => role.outcome === 'evaluated').length,
    strong: roles.filter(role => role.outcome === 'evaluated' && role.score >= 3.5).length,
  };
  const byOutcome = {};
  for (const role of roles) {
    const label = role.outcome === 'evaluated' ? 'Evaluated'
      : role.outcome === 'kept' ? 'No result recorded'
        : (role.reason || 'Dropped');
    byOutcome[label] = (byOutcome[label] || 0) + 1;
  }

  const health = {};
  const stats = readJson(path.join(stateDir, 'inbox', date, 'stats.json'));
  for (const [site, info] of Object.entries(stats?.sites || {})) {
    if (!watched.has(site.toLowerCase()) || !info?.health || typeof info.health !== 'object') continue;
    const numeric = Object.fromEntries(Object.entries(info.health).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
    if (Object.keys(numeric).length) health[site] = numeric;
  }

  return { date, totals, byOutcome, health, roles };
}

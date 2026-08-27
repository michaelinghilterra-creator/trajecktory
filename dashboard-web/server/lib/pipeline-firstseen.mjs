import fs from 'fs';
import path from 'path';
import { canonicalUrl } from '../../../lib/identity.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function firstSeenKey(url) {
  const raw = String(url || '').trim();
  return canonicalUrl(raw) || raw;
}

export function scanHistoryFirstSeen(text) {
  const index = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('url\t')) continue;
    const [rawUrl, firstSeen] = line.split('\t');
    const raw = String(rawUrl || '').trim();
    const date = String(firstSeen || '').trim();
    if (!raw || !ISO_DATE.test(date)) continue;
    const key = firstSeenKey(raw);
    for (const candidate of new Set([key, raw])) {
      if (!candidate) continue;
      if (!index[candidate] || date < index[candidate]) index[candidate] = date;
    }
  }
  return index;
}

export function readPipelineFirstSeen(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, date]) => key && ISO_DATE.test(date)));
  } catch {
    return {};
  }
}

export function writePipelineFirstSeen(file, index) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(index, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* best effort cleanup */ }
  }
}

export function enrichInboxDates(inbox, sidecar, scanFirstSeen, today = localToday()) {
  let changed = false;
  const enrich = row => {
    const raw = String(row.url || '').trim();
    const key = firstSeenKey(raw);
    const dateAdded = sidecar[key] || scanFirstSeen[key] || scanFirstSeen[raw] || today;
    if (key && !sidecar[key]) {
      sidecar[key] = dateAdded;
      changed = true;
    }
    return { ...row, dateAdded };
  };
  return {
    inbox: { ...inbox, pending: (inbox.pending || []).map(enrich), gated: (inbox.gated || []).map(enrich) },
    changed,
  };
}

// routes/discovery.mjs — the Discovery Inbox endpoint.
//
// WHY: the dashboard's Pipeline views read only evaluated rows (applications.md)
// plus Spark pre-filter discard rows, so a freshly discovered role that is pending
// "- [ ]" line in data/pipeline.md, or one gated to "- [!]", appeared in NO view
// and looked "lost". This endpoint exposes the raw discovery queue so found /
// pending / gated are all visible, with the gate reason on every dead row.

import express from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { DATA_DIR, ROOT_DIR } from '../config.mjs';
import { pipelineInbox } from '../../../lib/pipeline.mjs';
import { normalizeCompany } from '../../../lib/identity.mjs';
import { readHistoryRows } from '../../../lib/scan-history.mjs';
import { summarizeCoverage } from '../../../lib/scan-coverage.mjs';
import {
  enrichInboxDates, localToday, readPipelineFirstSeen,
  scanHistoryRowsFirstSeen, writePipelineFirstSeen,
} from '../lib/pipeline-firstseen.mjs';

export const router = express.Router();

// scan-history.tsv grows without bound (tens of MB) and parsing it costs about half a
// second, so keep the parsed index until the scanner appends to the file.
let scanHistoryCache = null;
export function cachedScanHistoryFirstSeen(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return {}; }
  if (scanHistoryCache && scanHistoryCache.mtimeMs === stat.mtimeMs && scanHistoryCache.size === stat.size) {
    return scanHistoryCache.index;
  }
  let index;
  try { index = scanHistoryRowsFirstSeen(readHistoryRows(file)); } catch { return {}; }
  scanHistoryCache = { mtimeMs: stat.mtimeMs, size: stat.size, index };
  return index;
}

export function clearScanHistoryCache() {
  scanHistoryCache = null;
}

// GET /api/pipeline/inbox → { counts:{pending,gated,done}, pending:[…], gated:[…] }
// Read-only and recomputed per request (pipeline.md is small relative to how
// often this is polled). A missing pipeline.md is an empty inbox, not an error.
router.get('/api/pipeline/inbox', (_req, res) => {
  const file = path.join(DATA_DIR, 'pipeline.md');
  const scanHistoryFile = path.join(DATA_DIR, 'scan-history.tsv');
  const firstSeenFile = path.join(DATA_DIR, 'pipeline-firstseen.json');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* no pipeline yet → empty inbox */ }
  const sidecar = readPipelineFirstSeen(firstSeenFile);
  const result = enrichInboxDates(
    pipelineInbox(text), sidecar, cachedScanHistoryFirstSeen(scanHistoryFile), localToday(),
  );
  if (result.changed) writePipelineFirstSeen(firstSeenFile, sidecar);
  res.json(result.inbox);
});

// GET /api/scan-coverage/summary - health of enabled boards still present in
// portals.yml. Missing coverage means the scanner has not produced a readable
// snapshot yet; it is not an empty healthy roster.
router.get('/api/scan-coverage/summary', (_req, res) => {
  const coverageFile = path.join(DATA_DIR, 'scan-coverage.json');
  let coverage;
  try {
    coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) throw new Error('invalid coverage');
  } catch {
    return res.json({ available: false });
  }

  let isTracked;
  try {
    const portals = yaml.load(fs.readFileSync(path.join(ROOT_DIR, 'portals.yml'), 'utf8')) || {};
    const names = new Set((portals.tracked_companies || [])
      .filter(company => company && company.enabled !== false)
      .map(company => normalizeCompany(company.name))
      .filter(Boolean));
    isTracked = entry => names.has(normalizeCompany(entry?.name));
  } catch {
    // A fresh install may not have portals.yml yet. In that case the coverage
    // file is the only roster available, so include every recorded board.
    isTracked = () => true;
  }

  res.json({ available: true, ...summarizeCoverage(coverage, { today: localToday(), isTracked }) });
});

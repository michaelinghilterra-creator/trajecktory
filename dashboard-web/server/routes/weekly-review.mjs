// Backs the "Weekly review" screen in Setup (E-7). Read only: it lists, week by week, what to look at before a
// Work Search report is made (interview lines without evidence, interviews only scheduled, applications whose
// newest employer message is newer than their status, replies that cannot be placed). It changes nothing.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, TWC_OVERRIDES_PATH } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { readAppNotes } from '../lib/notes.mjs';
import { readApplyDates, parseStatusEvents } from '../lib/sidecars.mjs';
import { overrideEvidenceGaps, repliesByApplication } from '../../../lib/data-review.mjs';
import { buildWeeklyReview } from '../../../lib/weekly-review.mjs';

const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;

function readInterviewOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(TWC_OVERRIDES_PATH, 'utf8'));
    return Array.isArray(raw?.interviews) ? raw.interviews : [];
  } catch {
    return [];
  }
}

// Only a file reference can be checked here; a message or calendar id is trusted as written.
function resolveReference(kind, id) {
  if (kind !== 'file') return true;
  return fs.existsSync(path.resolve(DATA_DIR, '..', String(id))) || fs.existsSync(path.resolve(DATA_DIR, String(id)));
}

function centralToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

export function buildReviewForData({ today = centralToday(), weekCount = DEFAULT_WEEKS } = {}) {
  const applications = parseApplicationsMd();
  const byId = new Map(applications.map(app => [String(app.id), app]));
  const overrides = readInterviewOverrides();
  const gaps = overrideEvidenceGaps(overrides, resolveReference);
  const gapIndexes = new Set(gaps.gaps.map(gap => gap.index));
  const lastStatusDate = new Map();
  for (const event of parseStatusEvents()) {
    if (!lastStatusDate.has(event.app) || event.date > lastStatusDate.get(event.app)) lastStatusDate.set(event.app, event.date);
  }
  const review = buildWeeklyReview({
    today,
    weekCount,
    applications: applications.map(app => ({ id: app.id, company: app.company, role: app.role, status: app.status })),
    repliesByApp: repliesByApplication(readAppNotes()),
    lastStatusDate,
    applyDates: readApplyDates(),
    interviews: overrides.map((entry, index) => ({ appId: entry?.appId, stage: entry?.stage, date: entry?.date, evidence_ok: !gapIndexes.has(index) })),
  });
  const name = item => {
    const app = byId.get(String(item.application_id));
    return { ...item, company: app?.company ?? '', role: app?.role ?? '' };
  };
  return {
    ...review,
    weeks: review.weeks.map(week => ({
      ...week,
      unconfirmed_interviews: week.unconfirmed_interviews.map(name),
      scheduled: week.scheduled.map(name),
      newer_messages: week.newer_messages.map(name),
      unmatched_replies: week.unmatched_replies.map(name),
    })),
  };
}

export const router = express.Router();

// GET /api/setup/weekly-review?weeks=4
router.get('/api/setup/weekly-review', (req, res) => {
  try {
    const raw = req.query.weeks === undefined ? DEFAULT_WEEKS : Number(req.query.weeks);
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_WEEKS) {
      return res.status(400).json({ error: `weeks must be a whole number from 1 to ${MAX_WEEKS}` });
    }
    res.json(buildReviewForData({ weekCount: raw }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

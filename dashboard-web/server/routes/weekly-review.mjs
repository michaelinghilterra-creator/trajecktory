// Backs the "Weekly review" screen in Setup (E-7): what to look at before a Work Search report is made
// (interview lines without evidence, interviews only scheduled, applications whose newest employer message is
// newer than their status, replies that cannot be placed). Reading the list changes nothing. Excluding an item
// (POST .../exclude) records that it was looked at and is being deliberately left as is, with a reason, so the
// review can say how many rows are still open and how many were excluded, instead of only a raw count.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, TWC_OVERRIDES_PATH } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { readAppNotes } from '../lib/notes.mjs';
import { readApplyDates, parseStatusEvents } from '../lib/sidecars.mjs';
import { overrideEvidenceGaps, repliesByApplication } from '../../../lib/data-review.mjs';
import { buildWeeklyReview } from '../../../lib/weekly-review.mjs';
import { readInterviewRecords } from '../lib/interview-events.mjs';
import { readReviewResolutions, excludeReviewItem } from '../lib/review-events.mjs';
import { interviewKey, interviewState } from '../../../lib/interview-store.mjs';
import { REVIEW_ITEM_KINDS, reviewItemKey } from '../../../lib/review-resolutions.mjs';
import { localToday, logWritesEnabled } from '../../../lib/log-writes.mjs';
import { cachedRead } from '../lib/data-generation.mjs';

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

// The interview lines to show: every line recorded in the event store, classified by its own record (D-1), plus
// any legacy overrides-file entry that has no event-store counterpart (a line from before the store existed, or
// on an install with the store off). A record always wins over an overrides entry for the same line, so the
// modern, evidence-backed answer is never shadowed by a stale one. "Counted" lines (held, with evidence) are
// left out entirely: they need no review.
function interviewLines(today) {
  const records = readInterviewRecords();
  const covered = new Set(records.keys());
  const fromRecords = [];
  for (const record of records.values()) {
    const state = interviewState(record, today).state;
    if (state === 'counted') continue;
    fromRecords.push({
      appId: record.application_id, stage: record.stage,
      date: state === 'unconfirmed' ? (record.held_on ?? record.scheduled_for) : record.scheduled_for,
      bucket: state,
    });
  }
  const overrides = readInterviewOverrides();
  const gaps = overrideEvidenceGaps(overrides, resolveReference);
  const gapIndexes = new Set(gaps.gaps.map(gap => gap.index));
  const fromOverrides = overrides
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !covered.has(interviewKey(entry?.appId, entry?.stage)))
    .map(({ entry, index }) => ({ appId: entry?.appId, stage: entry?.stage, date: entry?.date, evidence_ok: !gapIndexes.has(index) }));
  return [...fromRecords, ...fromOverrides];
}

export function buildReviewForData({ today = centralToday(), weekCount = DEFAULT_WEEKS } = {}) {
  const applications = parseApplicationsMd();
  const byId = new Map(applications.map(app => [String(app.id), app]));
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
    interviews: interviewLines(today),
  });
  const resolutions = readReviewResolutions();
  const withResolution = (kind) => (item) => {
    const app = byId.get(String(item.application_id));
    const key = reviewItemKey(kind, item);
    const resolution = resolutions.get(key);
    return {
      ...item,
      company: app?.company ?? '',
      role: app?.role ?? '',
      item_key: key,
      excluded: resolution ? { reason: resolution.reason, on: resolution.occurred_on, event_id: resolution.event_id } : null,
    };
  };
  const weeks = review.weeks.map(week => {
    const unconfirmed_interviews = week.unconfirmed_interviews.map(withResolution('unconfirmed_interview'));
    const scheduled = week.scheduled.map(withResolution('scheduled'));
    const newer_messages = week.newer_messages.map(withResolution('newer_message'));
    const unmatched_replies = week.unmatched_replies.map(withResolution('unmatched_reply'));
    const all = [...unconfirmed_interviews, ...scheduled, ...newer_messages, ...unmatched_replies];
    const excluded = all.filter(i => i.excluded).length;
    return {
      ...week, unconfirmed_interviews, scheduled, newer_messages, unmatched_replies,
      excluded, open: week.needs_review - excluded,
    };
  });
  const excluded = weeks.reduce((sum, w) => sum + w.excluded, 0);
  return { ...review, weeks, excluded, open: review.needs_review - excluded };
}

export const router = express.Router();

// GET /api/setup/weekly-review?weeks=4
router.get('/api/setup/weekly-review', (req, res) => {
  try {
    const raw = req.query.weeks === undefined ? DEFAULT_WEEKS : Number(req.query.weeks);
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_WEEKS) {
      return res.status(400).json({ error: `weeks must be a whole number from 1 to ${MAX_WEEKS}` });
    }
    const today = centralToday();
    res.json(cachedRead(`setup/weekly-review:${raw}:${today}`, () => buildReviewForData({ today, weekCount: raw })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/setup/weekly-review/exclude  { itemKind, applicationId, stage?, messageId?, reason }
// Looked at, deliberately left as is for now. The item stays on the list (so nothing silently disappears) but
// reads as excluded, with the reason, until the underlying thing is actually resolved or the exclusion is undone.
router.post('/api/setup/weekly-review/exclude', (req, res) => {
  try {
    const { itemKind, applicationId, stage, messageId, reason } = req.body || {};
    if (!REVIEW_ITEM_KINDS.includes(itemKind)) {
      return res.status(400).json({ error: `itemKind must be one of: ${REVIEW_ITEM_KINDS.join(', ')}` });
    }
    const id = parseInt(applicationId, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'applicationId is required' });
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'reason is required' });
    if (!logWritesEnabled(DATA_DIR)) {
      return res.status(409).json({ error: 'The event store is off, so an exclusion cannot be kept yet.' });
    }
    const needsStage = itemKind === 'unconfirmed_interview' || itemKind === 'scheduled';
    if (needsStage && (typeof stage !== 'string' || !stage.trim())) {
      return res.status(400).json({ error: 'stage or messageId is required for this itemKind' });
    }
    if (!needsStage && (typeof messageId !== 'string' || !messageId.trim())) {
      return res.status(400).json({ error: 'stage or messageId is required for this itemKind' });
    }
    const key = reviewItemKey(itemKind, { application_id: id, stage, message_id: messageId });
    const event_ids = excludeReviewItem({
      application_id: id, item_kind: itemKind, item_key: key, reason, occurred_on: localToday(),
    });
    res.json({ ok: true, event_ids, item_key: key });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: `Invalid ${error.message}` });
    res.status(error.code === 'STORE_OFF' ? 409 : 500).json({ error: error.message });
  }
});

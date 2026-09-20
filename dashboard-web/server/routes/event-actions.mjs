// D-1 and D-10 actions on the event store: confirm that an interview was held (owner confirmation is evidence,
// Definitions v1.1), and void a recording. Both need the event store on. A void keeps the original event in
// the log; the rendered files and the interview lines skip it. Only interview recordings can be voided from
// here for now; the projection handles a void of any event that wrote to a file.
import express from 'express';
import { DATA_DIR } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { INTERVIEW_STAGES } from '../lib/statuses.mjs';
import { recordInterview } from '../lib/interview-events.mjs';
import { appendEventsWithEffects } from '../../../lib/legacy-files.mjs';
import { isCalendarDate } from '../../../lib/interview-dates.mjs';
import { INTERVIEW_EVENT_TYPE, INTERVIEW_DEFINITIONS_VERSION } from '../../../lib/interview-store.mjs';
import { VOID_REASON_CODES, buildVoidEvent } from '../../../lib/void-events.mjs';
import { localToday, logWriteRouteError, logWritesEnabled, renderPendingResponse, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';

export const router = express.Router();

// POST /api/interviews/confirm  { appId, stage, heldOn }
// The person says the conversation happened on `heldOn`. Stored as an owner confirmation dated today.
router.post('/api/interviews/confirm', (req, res) => {
  try {
    const { appId, stage, heldOn } = req.body || {};
    const id = parseInt(appId, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'appId is required' });
    // Capitalization and spacing do not matter; the stored stage is the canonical label.
    const wanted = typeof stage === 'string' ? stage.replace(/\s+/g, ' ').trim().toLowerCase() : '';
    const canonicalStage = INTERVIEW_STAGES.find((label) => label.toLowerCase() === wanted);
    if (!canonicalStage) return res.status(400).json({ error: 'stage must be an interview stage' });
    if (!isCalendarDate(heldOn)) return res.status(400).json({ error: 'heldOn must be a real date as YYYY-MM-DD' });
    const today = localToday();
    if (heldOn > today) return res.status(400).json({ error: 'heldOn cannot be in the future' });
    if (!parseApplicationsMd().some(app => app.id === id)) return res.status(404).json({ error: `Application #${id} not found` });
    if (!logWritesEnabled(DATA_DIR)) return res.status(409).json({ error: 'The event store is off, so interview evidence cannot be kept yet.' });
    const ids = recordInterview({
      application_id: id,
      stage: canonicalStage,
      recorded_on: today,
      held_on: heldOn,
      evidence: [{ kind: 'owner_confirmation', confirmed_on: today, ref: `owner-confirmation:${id}:${canonicalStage}:${heldOn}` }],
      source: 'dashboard',
    });
    res.json({ ok: true, event_ids: ids });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: `Invalid ${error.message}` });
    logWriteRouteError(res, error);
  }
});

// POST /api/events/:id/void  { reason }   reason is one of VOID_REASON_CODES
router.post('/api/events/:id/void', (req, res) => {
  try {
    const target = Number(req.params.id);
    const reason = req.body && req.body.reason;
    if (!Number.isInteger(target) || target <= 0) return res.status(400).json({ error: 'Invalid event id' });
    if (!VOID_REASON_CODES.includes(reason)) return res.status(400).json({ error: `reason must be one of: ${VOID_REASON_CODES.join(', ')}` });
    if (!logWritesEnabled(DATA_DIR)) return res.status(409).json({ error: 'The event store is off, so there is no event to void.' });
    const found = withLogRead(DATA_DIR, (store) => store.db.prepare('SELECT type FROM events WHERE id = ?').get(target));
    if (!found) return res.status(404).json({ error: `Event ${target} not found` });
    if (found.type !== INTERVIEW_EVENT_TYPE) return res.status(400).json({ error: 'Only interview recordings can be voided here.' });
    const event = buildVoidEvent({
      target_event_id: target,
      reason_code: reason,
      evidence_ref: 'owner',
      actor: 'owner',
      occurred_on: localToday(),
      definitions_version: INTERVIEW_DEFINITIONS_VERSION,
    });
    let renderPending = {};
    let ids;
    try {
      ids = withLogWrite(DATA_DIR, (store) => appendEventsWithEffects(store, [event]));
    } catch (error) {
      renderPending = renderPendingResponse(error, 'event void');
    }
    res.json({ ok: true, event_ids: ids, ...renderPending });
  } catch (error) {
    logWriteRouteError(res, error);
  }
});

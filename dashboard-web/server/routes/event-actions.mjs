// D-1 and D-10 actions on the event store: confirm that an interview was held (owner confirmation is evidence,
// Definitions v1.1), and void a recording. Both need the event store on. A void keeps the original event in
// the log; the rendered files and the interview lines skip it. Only interview recordings can be voided from
// here for now; the projection handles a void of any event that wrote to a file.
import express from 'express';
import { DATA_DIR } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { INTERVIEW_STAGES } from '../lib/statuses.mjs';
import { recordInterview, readInterviewRecords } from '../lib/interview-events.mjs';
import { appendEventsWithEffects } from '../../../lib/legacy-files.mjs';
import { undoableActions, REPLY_EVENT_TYPE } from '../../../lib/event-undo.mjs';
import { noteEffect } from '../lib/notes.mjs';
import { readSync, writeSync } from '../lib/google.mjs';
import { isCalendarDate } from '../../../lib/interview-dates.mjs';
import { INTERVIEW_EVENT_TYPE, INTERVIEW_DEFINITIONS_VERSION, interviewKey } from '../../../lib/interview-store.mjs';
import { buildScheduleFields, isOutcomeDue, OUTCOME_TYPES, RESULT_TYPES, OUTCOME_LABELS } from '../../../lib/interview-schedule.mjs';
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

// ── E-6: undo ────────────────────────────────────────────────────────────────
// GET /api/events/recent?limit=  the changes the person made through the dashboard, newest first, each with what it
// was and whether it can be undone now (only the newest change on an application can be).
function dashboardEvents() {
  return withLogRead(DATA_DIR, (store) => store.db
    .prepare("SELECT * FROM events WHERE source = 'dashboard' OR type = 'event_undone' ORDER BY id")
    .all()
    .map((row) => ({ ...row, payload: JSON.parse(row.payload) })));
}

function describeAction(action, apps) {
  const app = apps.find((a) => String(a.id) === String(action.application_id));
  const p = action.payload || {};
  const what = action.type === 'status_changed' ? `Status ${p.from || '?'} to ${p.to || '?'}`
    : action.type === REPLY_EVENT_TYPE ? `Reply logged${p.status_flip ? `, status set to ${p.status_flip}` : ''}`
      : action.type === INTERVIEW_EVENT_TYPE ? (p.held_on ? `${p.stage} held ${p.held_on}` : p.note === 'rescheduled' ? `${p.stage} rescheduled to ${p.scheduled_for}` : `${p.stage} scheduled for ${p.scheduled_for}`)
        : action.type;
  return { ...action, company: app ? app.company : null, role: app ? app.role : null, summary: what };
}

router.get('/api/events/recent', (req, res) => {
  try {
    if (!logWritesEnabled(DATA_DIR)) return res.json({ enabled: false, actions: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 100);
    const apps = (() => { try { return parseApplicationsMd(); } catch { return []; } })();
    const actions = undoableActions(dashboardEvents(), { limit }).map((a) => describeAction(a, apps));
    res.json({ enabled: true, actions });
  } catch (error) {
    logWriteRouteError(res, error);
  }
});

// POST /api/events/:id/undo  { reason? }  undo one action by the id of its leading event. Writes a void event for the
// action and for each event written with it; for a logged reply its event-owned note disappears and the message shows up
// in the sweep again.
router.post('/api/events/:id/undo', (req, res) => {
  try {
    const target = Number(req.params.id);
    const reason = (req.body && req.body.reason) || 'undone_by_owner';
    if (!Number.isInteger(target) || target <= 0) return res.status(400).json({ error: 'Invalid event id' });
    if (!VOID_REASON_CODES.includes(reason)) return res.status(400).json({ error: `reason must be one of: ${VOID_REASON_CODES.join(', ')}` });
    if (!logWritesEnabled(DATA_DIR)) return res.status(409).json({ error: 'The event store is off, so there is nothing to undo.' });
    const action = undoableActions(dashboardEvents(), { limit: 1000 }).find((a) => a.event_id === target);
    if (!action) return res.status(404).json({ error: 'That change is not in the list of changes you made, or it was already undone.' });
    if (!action.undoable) return res.status(409).json({ error: 'A newer change on this application has to be undone first.', blocked_reason: action.blocked_reason });
    const voids = [...action.member_ids, action.event_id].map((id) => buildVoidEvent({
      target_event_id: id,
      reason_code: reason,
      evidence_ref: 'owner',
      actor: 'owner',
      occurred_on: localToday(),
      definitions_version: INTERVIEW_DEFINITIONS_VERSION,
    }));
    let renderPending = {};
    let ids;
    try {
      ids = withLogWrite(DATA_DIR, (store) => appendEventsWithEffects(store, voids));
    } catch (error) {
      renderPending = renderPendingResponse(error, 'event undo');
    }
    let noteRemoved = false;
    if (action.type === REPLY_EVENT_TYPE && !renderPending.render_pending) {
      const p = action.payload || {};
      noteRemoved = true;
      if (p.msg_id) {
        const sync = readSync();
        if (sync.handledReplies && sync.handledReplies[p.msg_id]) { delete sync.handledReplies[p.msg_id]; writeSync(sync); }
      }
    }
    res.json({ ok: true, event_ids: ids, note_removed: noteRemoved, ...renderPending });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: `Invalid ${error.message}` });
    logWriteRouteError(res, error);
  }
});

// ── E-2: what happened to a scheduled interview ─────────────────────────────────
// GET /api/interviews/pending-outcome — scheduled interviews with no outcome yet, each flagged `due` once its
// slot has been over for 30 minutes (D-2). A missed prompt is simply still `due` whenever the app is next
// opened, including the next morning, so no separate re-ask schedule is kept.
router.get('/api/interviews/pending-outcome', (req, res) => {
  try {
    if (!logWritesEnabled(DATA_DIR)) return res.json({ enabled: false, items: [] });
    const records = [...readInterviewRecords(DATA_DIR).values()].filter((r) => r.scheduled_for && !r.held_on);
    const apps = (() => { try { return parseApplicationsMd(); } catch { return []; } })();
    const now = Date.now();
    const items = records.map((r) => {
      const app = apps.find((a) => String(a.id) === String(r.application_id));
      return {
        appId: r.id, stage: r.stage, scheduledFor: r.scheduled_for, slotEnd: r.slot_end,
        company: app ? app.company : null, role: app ? app.role : null,
        due: isOutcomeDue({ slot_end: r.slot_end, now }),
      };
    }).sort((a, b) => String(a.slotEnd).localeCompare(String(b.slotEnd)));
    res.json({ enabled: true, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/interviews/outcome  { appId, stage, outcome, heldOn?, result?, newDate?, newTime? }
// held: records held_on with an owner confirmation (evidence) and the chosen result; the client opens the
// debrief. rescheduled: a new scheduled recording, keeping the earlier one in history (D-1). Everything else
// (cancelled_by_employer, withdrew, no_show, dropped) means the conversation did not happen: the scheduled
// recording is voided (D-10) so it stops counting or listing, and a plain note keeps why.
router.post('/api/interviews/outcome', (req, res) => {
  try {
    const { appId, stage, outcome, heldOn, result, newDate, newTime, durationMinutes } = req.body || {};
    const id = parseInt(appId, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'appId is required' });
    const wanted = typeof stage === 'string' ? stage.replace(/\s+/g, ' ').trim().toLowerCase() : '';
    const canonicalStage = INTERVIEW_STAGES.find((label) => label.toLowerCase() === wanted);
    if (!canonicalStage) return res.status(400).json({ error: 'stage must be an interview stage' });
    if (!OUTCOME_TYPES.includes(outcome)) return res.status(400).json({ error: `outcome must be one of: ${OUTCOME_TYPES.join(', ')}` });
    if (!logWritesEnabled(DATA_DIR)) return res.status(409).json({ error: 'The event store is off, so there is nothing to record an outcome against.' });
    const record = readInterviewRecords(DATA_DIR).get(interviewKey(id, canonicalStage));
    if (!record || !record.scheduled_for || record.held_on) {
      return res.status(404).json({ error: 'No pending scheduled interview for this application and stage.' });
    }

    if (outcome === 'held') {
      if (!isCalendarDate(heldOn)) return res.status(400).json({ error: 'heldOn must be a real date as YYYY-MM-DD' });
      const today = localToday();
      if (heldOn > today) return res.status(400).json({ error: 'heldOn cannot be in the future' });
      if (!RESULT_TYPES.includes(result)) return res.status(400).json({ error: `result must be one of: ${RESULT_TYPES.join(', ')}` });
      const ids = recordInterview({
        application_id: id, stage: canonicalStage, booked_on: record.booked_on, recorded_on: today, scheduled_for: record.scheduled_for,
        held_on: heldOn, evidence: [{ kind: 'owner_confirmation', confirmed_on: today, ref: `owner-confirmation:${id}:${canonicalStage}:${heldOn}` }],
        note: `outcome_result:${result}`, source: 'dashboard',
      });
      return res.json({ ok: true, event_ids: ids, debrief: true });
    }

    if (outcome === 'rescheduled') {
      let built;
      try {
        built = buildScheduleFields({ date: newDate, time: newTime, durationMinutes });
      } catch (error) {
        return res.status(400).json({ error: `Invalid reschedule.${error.message}` });
      }
      const ids = recordInterview({
        application_id: id, stage: canonicalStage, booked_on: record.booked_on, recorded_on: localToday(), scheduled_for: built.scheduled_for,
        slot_end: built.slot_end, evidence: [], note: 'rescheduled', source: 'dashboard',
      });
      return res.json({ ok: true, event_ids: ids });
    }

    const event = buildVoidEvent({
      target_event_id: record.event_id,
      reason_code: 'not_held',
      evidence_ref: 'owner',
      actor: 'owner',
      occurred_on: localToday(),
      definitions_version: INTERVIEW_DEFINITIONS_VERSION,
    });
    const built = noteEffect(id, `### Interview outcome (${localToday()})\n${canonicalStage}: ${OUTCOME_LABELS[outcome]}`);
    if (built) event.payload.legacy_effects = [built.effect];
    let renderPending = {};
    let event_ids;
    try {
      event_ids = withLogWrite(DATA_DIR, (store) => appendEventsWithEffects(store, [event]));
    } catch (error) {
      renderPending = renderPendingResponse(error, 'interview outcome');
    }
    res.json({ ok: true, event_ids, voided: record.event_id, ...renderPending });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: `Invalid ${error.message}` });
    logWriteRouteError(res, error);
  }
});

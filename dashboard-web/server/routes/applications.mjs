import express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, OUTPUT_DIR, ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd, patchRowInMd, removeRowFromMd, rejectionTimingStats } from '../lib/applications.mjs';
import { readResponseProgressStats } from '../lib/response-timing.mjs';
import { recordApplyDate, readApplyDates } from '../lib/sidecars.mjs';
import { readAppNotes } from '../lib/notes.mjs';
import { repliesByApplication } from '../../../lib/data-review.mjs';
import { evaluateStatusChange } from '../../../lib/status-guards.mjs';
import { dialogFor } from '../../../lib/status-guard-dialog.mjs';
import { assignSplitTest, splitTestSummary } from '../lib/split-test.mjs';
import { pushObsidianNote } from '../lib/obsidian.mjs';
import { ALL_STATUSES, INTERVIEW_STAGES } from '../lib/statuses.mjs';
import { mdToHtml, escapeHtml } from '../lib/html.mjs';
import { isRequeueableDiscard } from '../../../lib/discard.mjs';
import { PASSED_REASONS, passedReasonOf, withPassedReason, stripPassedReason } from '../../../lib/passed.mjs';
import { canonicalUrl } from '../../../lib/identity.mjs';
import { recordInterview } from '../lib/interview-events.mjs';
import { buildScheduleFields, scheduleNote, CHANNELS, ORGANIZER_TYPES } from '../../../lib/interview-schedule.mjs';
import { localToday, logWriteRouteError, logWritesEnabled, renderPendingResponse, withLogWrite } from '../../../lib/log-writes.mjs';
import { startCadences } from '../lib/cadence-start.mjs';

export const router = express.Router();

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /output-preview/:file — render .md files from output/ as HTML
router.get('/output-preview/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(OUTPUT_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const raw = fs.readFileSync(filePath, 'utf8');
  const body = mdToHtml(raw);
  // No scripts in a rendered output document; lock it down (defense-in-depth).
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(file)}</title>
<style>
  body{font-family:'Georgia',serif;max-width:720px;margin:60px auto;padding:0 24px;color:#1a1a1a;line-height:1.7;font-size:15px}
  h1,h2,h3{font-family:'Arial',sans-serif;margin:1.4em 0 0.4em}
  h1{font-size:22px} h2{font-size:18px} h3{font-size:15px}
  blockquote{border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444;background:#f9f9f9}
  p{margin:0.8em 0}
  strong{font-weight:600}
  @media print{body{margin:0.5in}}
</style>
</head><body>${body}</body></html>`);
});

// GET /jd-preview/:file — render a captured JD snapshot from jds/ as HTML.
// This is the "Open JD" target for a self-sourced role whose url is a local:
// path (or the $file garbage a broken batch wrote): the posting has no live web
// URL, but its JD was snapshotted into jds/ at eval time. basename() strips any
// path so a poisoned frontmatter cell like ../../secret cannot escape jds/.
router.get('/jd-preview/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(ROOT_DIR, 'jds', file);
  if (!file.endsWith('.md') || !fs.existsSync(filePath)) return res.status(404).send('JD snapshot not found');
  const raw = fs.readFileSync(filePath, 'utf8');
  const body = mdToHtml(raw);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(file)}</title>
<style>
  body{font-family:'Georgia',serif;max-width:720px;margin:60px auto;padding:0 24px;color:#1a1a1a;line-height:1.7;font-size:15px}
  h1,h2,h3{font-family:'Arial',sans-serif;margin:1.4em 0 0.4em}
  h1{font-size:22px} h2{font-size:18px} h3{font-size:15px}
  blockquote{border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444;background:#f9f9f9}
  p{margin:0.8em 0}
  strong{font-weight:600}
  @media print{body{margin:0.5in}}
</style>
</head><body>${body}</body></html>`);
});

// GET /api/applications — return all rows as JSON
router.get('/api/applications', (req, res) => {
  try {
    res.json(parseApplicationsMd());
  } catch (err) {
    logWriteRouteError(res, err);
  }
});

router.get('/api/split-test', (req, res) => {
  try {
    res.json(splitTestSummary());
  } catch (err) {
    logWriteRouteError(res, err);
  }
});

// The guard verdict for a hand made change of application `id` to status `to` (E-5). Shared by the
// read only check route and by the PATCH route below.
function guardVerdict(id, to, { phoneOn = null, byHand = false, withdrawn = false } = {}) {
  const messages = repliesByApplication(readAppNotes()).get(String(id)) ?? [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return evaluateStatusChange({
    to,
    messages,
    applied_on: readApplyDates()[String(id)] || null,
    phone_rejection_on: phoneOn,
    withdrawn,
    by_hand: byHand,
    today,
  });
}

// GET /api/applications/:id/status-check?to=<status>[&phoneOn=YYYY-MM-DD][&byHand=1][&withdrawn=1]
// Read only (E-5). Says whether a hand-made status change has the evidence it needs, and which employer
// messages to show first. It changes nothing; the PATCH route below enforces the same rules.
router.get('/api/applications/:id/status-check', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const to = String(req.query.to || '');
    if (!ALL_STATUSES.includes(to) && to !== 'Passed') return res.status(400).json({ error: `Invalid status: ${to}` });
    const row = parseApplicationsMd().find(a => a.id === id);
    if (!row) return res.status(404).json({ error: `Row ${id} not found` });
    const verdict = guardVerdict(id, to, {
      phoneOn: req.query.phoneOn ? String(req.query.phoneOn) : null,
      withdrawn: req.query.withdrawn === '1',
      byHand: req.query.byHand === '1',
    });
    res.json({ id, to, ...verdict, dialog: dialogFor(verdict, row.company) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/applications/:id — update status and/or notes
router.patch('/api/applications/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, company, eventDate, guard, passedReason } = req.body;

    if (status && !ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }
    if (passedReason !== undefined && passedReason !== null && !PASSED_REASONS.includes(passedReason)) {
      return res.status(400).json({ error: `Invalid passedReason: ${passedReason}` });
    }

    // A bad date is rejected outright rather than quietly ignored. The body is
    // destructured against a fixed allowlist, so an unrecognised field vanishes
    // with no error — which would let a broken client look like it was saving
    // dates while writing none. Fail loudly instead.
    if (eventDate !== undefined && eventDate !== null && eventDate !== '') {
      if (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} (expected YYYY-MM-DD)` });
      }
      const parsed = new Date(`${eventDate}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== eventDate) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is not a real date` });
      }
      const today = localToday();
      if (eventDate > today) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is in the future` });
      }
      if (eventDate < '2000-01-01') {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is implausibly old` });
      }
    }
    let when = eventDate || undefined;

    // Detect the transition INTO Applied. We push a vault note only when a row
    // that was NOT already Applied becomes Applied — not on every save where the
    // status happens to be Applied — so an unrelated notes edit never overwrites
    // a note the user has since hand-edited in Obsidian.
    const before = parseApplicationsMd();
    const prevRow = (company && before.find(r => r.id === id && r.company === company))
      || before.find(r => r.id === id);
    const becomingApplied = status === 'Applied' && (!prevRow || prevRow.status !== 'Applied');

    // E-5: Rejected needs an employer rejection or a dated phone rejection, and No Response is only set by
    // hand and only when no employer message exists since the application. A refused change writes nothing.
    // `guard` carries the person's answers: { byHand, phoneRejectionOn }.
    if ((status === 'Rejected' || status === 'No Response') && (!prevRow || prevRow.status !== status)) {
      const verdict = guardVerdict(id, status, {
        phoneOn: guard && typeof guard.phoneRejectionOn === 'string' ? guard.phoneRejectionOn : null,
        byHand: !!guard && guard.byHand === true,
      });
      if (!verdict.allowed) {
        return res.status(409).json({ error: 'This status change needs evidence or a confirmation first.', guard: verdict, dialog: dialogFor(verdict, prevRow?.company) });
      }
      if (status === 'Rejected' && !when && verdict.dated_on && verdict.dated_on <= localToday()) when = verdict.dated_on;
    }

    // E-1: moving INTO an interview stage asks for the date and time (required), who runs it, and the
    // channel; the record is dated to the scheduled day and marked scheduled, and nothing counts until it is
    // held (D-1). The status becomes that stage immediately regardless (2026-09-19: the stage shows the
    // pipeline truth). With the event store off there is nowhere to keep the record, so nothing is required
    // yet (phase in, as with D-1 strict).
    let scheduleFields = null;
    const enteringInterviewStage = status !== undefined && INTERVIEW_STAGES.includes(status) && (!prevRow || prevRow.status !== status);
    if (enteringInterviewStage && logWritesEnabled(DATA_DIR)) {
      const s = req.body.schedule;
      if (!s || typeof s !== 'object') {
        return res.status(400).json({ error: 'schedule is required to move into an interview stage: date, time, organizerName, organizerType, channel.' });
      }
      let built;
      try {
        built = buildScheduleFields({ date: s.date, time: s.time, durationMinutes: s.durationMinutes });
      } catch (error) {
        return res.status(400).json({ error: `Invalid schedule.${error.message}` });
      }
      if (typeof s.organizerName !== 'string' || !s.organizerName.trim()) {
        return res.status(400).json({ error: 'schedule.organizerName is required' });
      }
      if (!ORGANIZER_TYPES.includes(s.organizerType)) {
        return res.status(400).json({ error: `schedule.organizerType must be one of: ${ORGANIZER_TYPES.join(', ')}` });
      }
      if (!CHANNELS.includes(s.channel)) {
        return res.status(400).json({ error: `schedule.channel must be one of: ${CHANNELS.join(', ')}` });
      }
      scheduleFields = { ...built, note: scheduleNote(s) };
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    // Passed carries its reason as a tag at the front of the notes (Passed Status Migration Plan): the reason
    // sent with the change, else the one already on the row, else "discarded". Leaving Passed drops the tag.
    if (status === 'Passed') {
      const reason = passedReason || passedReasonOf(notes ?? prevRow?.notes) || 'discarded';
      updates.notes = withPassedReason(notes ?? prevRow?.notes ?? '', reason);
    } else if (status !== undefined && prevRow?.status === 'Passed') {
      updates.notes = stripPassedReason(notes ?? prevRow.notes ?? '');
    }

    let ok;
    const save = () => {
      const patched = patchRowInMd(id, updates, { company, eventDate: when });
      ok = patched;
      if (patched && status === 'Applied') recordApplyDate(id, when, { force: !!when });
      // Reentrant: patchRowInMd above already opened the log write for this data dir, so this call reuses
      // the same transaction rather than opening a second one.
      if (patched && scheduleFields) {
        recordInterview({
          application_id: id, stage: status, booked_on: localToday(), recorded_on: localToday(),
          scheduled_for: scheduleFields.scheduled_for, slot_end: scheduleFields.slot_end,
          evidence: [], note: scheduleFields.note, source: 'dashboard',
        }, DATA_DIR);
      }
      return patched;
    };
    let renderPending = {};
    try {
      if (logWritesEnabled(DATA_DIR)) withLogWrite(DATA_DIR, save);
      else save();
    } catch (error) {
      renderPending = renderPendingResponse(error, 'applications PATCH');
    }
    if (!ok) return res.status(404).json({ error: `Row ${id} not found` });

    // Capture the real apply date the first time a row goes Applied, so
    // follow-up cadence counts from when the user actually applied — not the
    // evaluation/scrape date in the Date column. An explicit eventDate is the
    // user correcting the anchor, so it is allowed to overwrite.
    if (becomingApplied && prevRow) {
      try { assignSplitTest(id, prevRow.score, when); }
      catch (err) { console.warn(`[split-test] failed to assign app ${id}: ${err.message}`); }
    }

    // Read back the updated row — use company to disambiguate duplicate ids
    const rows = parseApplicationsMd();
    const updated = (company && rows.find(r => r.id === id && r.company === company))
      || rows.find(r => r.id === id);

    // Automatic Obsidian note on apply. The Apply button already does this via
    // the apply job; marking Applied from the status dropdown used to skip it
    // entirely, which is why applied roles were missing from the vault. Fire the
    // same shared push here. It self-skips when Obsidian isn't set up and never
    // throws, so a vault hiccup cannot break the status change. Fire-and-forget:
    // the status change is already persisted, so we don't make the client wait.
    if (becomingApplied && updated) {
      pushObsidianNote({ row: updated, appliedDate: when })
        .then((r) => { if (r && r.ok) console.log(`[obsidian] wrote ${r.notePath}`); })
        .catch(() => { /* pushObsidianNote already logs; never surfaces here */ });
    }

    let cadenceStarted = 0;
    if (becomingApplied && updated) {
      try {
        const cadence = startCadences({ scope: { company: updated.company } });
        cadenceStarted = cadence.started || 0;
        if (cadence.error) console.warn(`[cadence] failed to start for ${updated.company}: ${cadence.error}`);
      } catch (err) {
        console.warn(`[cadence] failed to start for ${updated.company}: ${err.message}`);
      }
    }

    const response = renderPending.render_pending ? { id, ...updates } : (updated || { id, ...updates });
    res.json({ ...response, ...renderPending, ...(cadenceStarted > 0 ? { cadenceStarted } : {}) });
  } catch (err) {
    logWriteRouteError(res, err);
  }
});

// POST /api/applications/:id/requeue — put a near-threshold Discarded role back
// in the eval queue (Slice 7.5). A noisy 2.9 just under the 3.0 auto-discard cut
// should stay eligible for a re-run rather than hardening as a permanent reject.
//
// Mechanism: DELETE the tracker row (so it leaves the decided-index — otherwise
// reconcileHandled would instantly re-check-off its pipeline row and merge-tracker
// would dedup the fresh eval against the stale reject) and append its URL back to
// data/pipeline.md as an unchecked "- [ ]" row. The next Evaluate re-runs it from
// scratch. Only near-threshold Discards qualify; a decisive low score is refused.
router.post('/api/applications/:id/requeue', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const company = typeof req.body?.company === 'string' ? req.body.company : undefined;

    const rows = parseApplicationsMd();
    const row = (company && rows.find(r => r.id === id && r.company === company)) || rows.find(r => r.id === id);
    if (!row) return res.status(404).json({ error: `Row ${id} not found` });
    if (!isRequeueableDiscard({ status: row.status, score: row.score, notes: row.notes })) {
      return res.status(400).json({ error: 'Only a near-threshold Discarded role (score 2.5–2.9) can be re-queued.' });
    }
    if (!row.url) {
      return res.status(400).json({ error: 'This role has no posting URL to re-evaluate.' });
    }

    // Remove from the tracker (un-decide it), then queue it. Order matters: if the
    // append somehow fails we have still un-decided the row, which a later scan can
    // re-add — the reverse (queued but still decided) would be silently suppressed.
    const removed = removeRowFromMd(id, { company: row.company });
    if (!removed) return res.status(404).json({ error: `Row ${id} not found` });

    // Append an unchecked pipeline row unless the same posting is already queued.
    const pipelinePath = path.join(ROOT_DIR, 'data/pipeline.md');
    let text = '';
    try { text = fs.readFileSync(pipelinePath, 'utf8'); } catch { text = ''; }
    const canon = canonicalUrl(row.url);
    const already = text.split('\n').some(line => {
      const m = line.match(/^\s*-\s*\[ \]\s+(\S+)/);
      return m && (m[1] === row.url || (canon && canonicalUrl(m[1]) === canon));
    });
    if (!already) {
      const line = `- [ ] ${row.url} | ${row.company} | ${row.role}`;
      const sep = text && !text.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(pipelinePath, `${text}${sep}${line}\n`, 'utf8');
    }
    res.json({ ok: true, requeued: true, url: row.url, alreadyQueued: already });
  } catch (err) {
    logWriteRouteError(res, err);
  }
});

// GET /api/insights/rejection-timing — avg/median days from application to the
// date a row was marked Rejected, derived from the status-event sidecar.
router.get('/api/insights/rejection-timing', (req, res) => {
  try {
    res.json(rejectionTimingStats());
  } catch (err) {
    logWriteRouteError(res, err);
  }
});

// GET /api/insights/response-progress: cohort silence and fast decisions.
router.get('/api/insights/response-progress', (req, res) => {
  try {
    res.json(readResponseProgressStats());
  } catch (err) {
    logWriteRouteError(res, err);
  }
});


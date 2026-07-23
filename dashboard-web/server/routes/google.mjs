import express from 'express';
import {
  readTokens, readSync, writeSync, googleStatus,
  getAccessToken, listMessages, getMessage, scanDecisions,
} from '../lib/google.mjs';
import { parseTargetTalentMd, updateTTLine } from '../lib/target-talent.mjs';
import { parseRecruitersMd, updateRecruiterLine } from '../lib/recruiters.mjs';
import { patchRowInMd } from '../lib/applications.mjs';
import { addNote } from '../lib/notes.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';
import { INTERVIEW_STAGES } from '../lib/statuses.mjs';

export const router = express.Router();

// Gmail search dates use YYYY/MM/DD.
const gmailDate = (iso) => String(iso || '2026-06-01').replace(/-/g, '/');

// GET /api/google/status — non-secret connection facts for the UI.
router.get('/api/google/status', (req, res) => {
  try {
    res.json(googleStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/google/scan-bounces — sweep delivery-status messages since `since`
// (default 2026-06-01) and flip HARD bounces: set the contact's email verify tag
// to bounced and their status to Bounced, so the send gate blocks that address
// going forward. Soft (transient) bounces are counted, never flipped. Idempotent
// via the seen-ids cursor. This never sends anything.
router.post('/api/google/scan-bounces', async (req, res) => {
  try {
    const tokens = readTokens();
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Google is not connected.' });
    const accessToken = await getAccessToken({ tokens });
    const since = gmailDate(req.body?.since);
    const q = `(from:mailer-daemon OR from:postmaster OR subject:(delivery status notification) OR subject:(undeliverable) OR subject:(delivery has failed) OR subject:(returned mail)) after:${since}`;

    const ids = await listMessages({ q, accessToken, max: 100 });
    const sync = readSync();
    const seen = new Set(sync.seenMessageIds);
    const fresh = ids.filter(m => !seen.has(m.id));

    const raws = [];
    for (const m of fresh) { try { raws.push(await getMessage({ id: m.id, accessToken })); } catch { /* skip unreadable */ } }

    const taRows = parseTargetTalentMd();
    const recruiterRows = parseRecruitersMd();
    const { bounces } = scanDecisions({ messages: raws, taRows, recruiterRows });

    const today = new Date().toISOString().slice(0, 10);
    const applied = [];
    for (const b of bounces) {
      if (!b.flip) continue; // soft, or no matched contact
      const rows = b.flip.source === 'ta' ? taRows : recruiterRows;
      const row = rows.find(r => r.id === b.flip.id);
      if (!row) continue;
      // setVerifyTag on the clean address yields "address [v:bounced:gmail:date]".
      // The single-row updaters preserve every other cell (and each file's line
      // endings) byte for byte.
      const newCell = setVerifyTag(row.email, { state: 'bounced', source: 'gmail', date: today });
      const ok = b.flip.source === 'ta'
        ? updateTTLine(row.id, { email: newCell, status: 'Bounced' })
        : updateRecruiterLine(row.id, { email: newCell, status: 'Bounced' });
      if (ok) applied.push({ source: b.flip.source, id: row.id });
    }

    // Advance the cursor over everything fetched (cap the history so the file
    // cannot grow without bound).
    sync.seenMessageIds = [...new Set([...sync.seenMessageIds, ...fresh.map(m => m.id)])].slice(-3000);
    sync.lastCheckedAt = new Date().toISOString();
    writeSync(sync);

    res.json({
      scanned: fresh.length,
      hardBounces: bounces.filter(b => b.kind === 'hard').length,
      softBounces: bounces.filter(b => b.kind === 'soft').length,
      flipped: applied.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/google/replies — recent human replies from known contacts since
// `since`, each with a suggested sentiment. Read-only: this lists, it does not
// write. The UI turns each into a one-click action below.
router.get('/api/google/replies', async (req, res) => {
  try {
    const tokens = readTokens();
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Google is not connected.' });
    const accessToken = await getAccessToken({ tokens });
    const since = gmailDate(req.query?.since);
    const q = `in:inbox after:${since} -from:mailer-daemon -from:postmaster`;

    const ids = await listMessages({ q, accessToken, max: 100 });
    const raws = [];
    for (const m of ids) { try { raws.push(await getMessage({ id: m.id, accessToken })); } catch { /* skip */ } }

    const taRows = parseTargetTalentMd();
    const recruiterRows = parseRecruitersMd();
    const { replies, other } = scanDecisions({ messages: raws, taRows, recruiterRows });
    res.json({ replies, unmatched: other.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/google/replies/:msgId/:action — record a reply against a specific
// application. `action` is one of: log (note only), responded, or an interview
// stage label. Always logs the note to app-notes.json; responded/stage also flip
// the application status (which logs a status event, so the debrief prompt picks
// it up). The appId is explicit so a reply is never auto-attached to the wrong
// application when a company has several.
router.post('/api/google/replies/:msgId/:action', (req, res) => {
  try {
    const { action } = req.params;
    const { appId, note, company } = req.body || {};
    const id = parseInt(appId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'appId is required (which application this reply belongs to).' });

    const text = String(note || '').trim();
    if (text) addNote(id, `### Reply logged (${new Date().toISOString().slice(0, 10)})\n${text}`);

    let statusFlip = null;
    if (action === 'responded') statusFlip = 'Responded';
    else if (INTERVIEW_STAGES.includes(action)) statusFlip = action;
    else if (action !== 'log') return res.status(400).json({ error: `Unknown action: ${action}` });

    if (statusFlip) patchRowInMd(id, { status: statusFlip }, { company });

    res.json({ ok: true, appId: id, statusFlip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

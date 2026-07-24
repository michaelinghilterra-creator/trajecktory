import express from 'express';
import {
  readTokens, writeTokens, readSync, writeSync, googleStatus, checkHealth,
  getAccessToken, listMessages, fetchMessagesConcurrent, scanDecisions,
  buildAuthUrl, exchangeCode, fetchProfileEmail, newPkce, randomState, candidateAppsFor, createDraft,
} from '../lib/google.mjs';
import { parseTargetTalentMd, updateTTLine } from '../lib/target-talent.mjs';
import { parseRecruitersMd, updateRecruiterLine } from '../lib/recruiters.mjs';
import { patchRowInMd, parseApplicationsMd } from '../lib/applications.mjs';
import { addNote } from '../lib/notes.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';
import { INTERVIEW_STAGES } from '../lib/statuses.mjs';

export const router = express.Router();

// Gmail search dates use YYYY/MM/DD.
const gmailDate = (iso) => String(iso || '2026-06-01').replace(/-/g, '/');

// The reply sweep searches EVERYWHERE, not just the inbox: many people clear the
// inbox by labeling/archiving read mail, so application updates live outside it
// (one user labels everything "old" — 400+ messages, only 2 left in the inbox).
// Searching all mail would fetch hundreds of unrelated messages, so scope to
// application-signal subjects instead. The whole inbox is still included verbatim
// (a terse recruiter reply there has no signal word), plus anything anywhere whose
// subject carries one of these. The matcher then filters to known companies. Tune
// REPLY_SUBJECT_SIGNALS if updates slip through.
const REPLY_SUBJECT_SIGNALS = ['application', 'interview', 'offer', 'candidacy', 'recruiter', '"next steps"', 'screening', 'hiring', 'assessment', 'position'];
function replySearchQuery(since, selfEmail) {
  const clause = ['in:inbox', ...REPLY_SUBJECT_SIGNALS.map(s => `subject:${s}`)].join(' OR ');
  // Exclude the connected account's own address: those are the user's OUTBOUND mail
  // (follow-ups, self-test sends), not replies TO them. Left in, they flood the list
  // and, matched to a self-test contact, carry no application, so they never clear.
  const excludeSelf = selfEmail ? ` -from:${selfEmail}` : '';
  return `(${clause}) after:${since} -from:mailer-daemon -from:postmaster${excludeSelf}`;
}

// GET /api/google/status — non-secret connection facts for the UI. Local read
// only (no network): its `expired` reflects the ≈1h access token, so use it for
// display, not for deciding whether a reconnect is needed. That is /health's job.
router.get('/api/google/status', (req, res) => {
  try {
    res.json(googleStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/google/health — is the connection actually USABLE? Unlike /status,
// this probes whether the weekly refresh token still works (via a token refresh,
// a no-op when the cached access token is still valid), so the UI nudges for a
// reconnect only when one is genuinely needed, not every hour the access token
// lapses. Read-only apart from getAccessToken caching a refreshed access token.
// Open GET so the app shell can poll it for the app-wide nudge.
router.get('/api/google/health', async (req, res) => {
  try {
    res.json(await checkHealth());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reconnect (OAuth consent) ────────────────────────────────────────────────
// In-flight consent requests: state → { verifier, redirectUri, createdAt }. Kept
// in memory because the round trip completes in seconds within one server
// process; a restart mid-flow just means clicking Connect again. Swept on use.
const pendingAuth = new Map();
const AUTH_TTL_MS = 10 * 60 * 1000;
function sweepPending(now) {
  for (const [k, v] of pendingAuth) if (now - v.createdAt > AUTH_TTL_MS) pendingAuth.delete(k);
}

// GET /api/google/auth-start — begin consent. Redirects the browser to Google.
// redirect_uri is derived from THIS request's host, so the loopback port matches
// whatever port the dashboard is on (Desktop OAuth client: any local port is
// allowed, nothing to pre-register).
router.get('/api/google/auth-start', (req, res) => {
  try {
    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) return res.status(400).send('Missing GOOGLE_CLIENT_ID in dashboard-web/.env');
    const now = Date.now();
    sweepPending(now);
    const { verifier, challenge } = newPkce();
    const state = randomState();
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google/callback`;
    pendingAuth.set(state, { verifier, redirectUri, createdAt: now });
    res.redirect(buildAuthUrl({ clientId, redirectUri, state, codeChallenge: challenge }));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /api/google/callback — Google redirects here with ?code&state. Exchange the
// code for tokens (PKCE), learn the mailbox address, save, and bounce back to the
// dashboard. Read-only scope: this connection can never send. On any failure we
// redirect with a reason rather than dumping a stack to the browser.
router.get('/api/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`/?google=error&reason=${encodeURIComponent(String(error))}`);
    const pending = state ? pendingAuth.get(String(state)) : null;
    if (!code || !pending) return res.redirect('/?google=error&reason=expired_or_invalid_state');
    pendingAuth.delete(String(state));

    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const tokens = await exchangeCode({
      code: String(code), redirectUri: pending.redirectUri, codeVerifier: pending.verifier, clientId, clientSecret,
    });
    // prompt=consent should always return a refresh token; if Google withholds it,
    // keep any existing one rather than saving a connection that cannot refresh.
    if (!tokens.refresh_token) {
      const existing = readTokens();
      if (existing?.refresh_token) tokens.refresh_token = existing.refresh_token;
      else return res.redirect('/?google=error&reason=no_refresh_token');
    }
    let connectedEmail = null;
    try { connectedEmail = await fetchProfileEmail({ accessToken: tokens.access_token }); } catch { /* label is optional */ }
    writeTokens({ ...tokens, connectedEmail });
    res.redirect('/?google=connected');
  } catch (err) {
    res.redirect(`/?google=error&reason=${encodeURIComponent(String(err.message).slice(0, 120))}`);
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
    const dryRun = !!req.body?.dryRun; // read-only: compute the flips, write nothing
    const q = `(from:mailer-daemon OR from:postmaster OR subject:(delivery status notification) OR subject:(undeliverable) OR subject:(delivery has failed) OR subject:(returned mail)) after:${since}`;

    const ids = await listMessages({ q, accessToken, max: 100 });
    const sync = readSync();
    const seen = new Set(sync.seenMessageIds);
    // A dry run re-examines everything since the cutoff (ignores the seen cursor)
    // so a diagnostic sweep can show the full picture without advancing state.
    const fresh = dryRun ? ids : ids.filter(m => !seen.has(m.id));

    const raws = await fetchMessagesConcurrent(fresh, { accessToken });

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
      // Already marked bounced (a prior sweep flipped it) is NOT a pending change,
      // so it neither counts toward wouldFlip nor gets re-written. Without this the
      // dry run re-counts every historical bounce every time, so the number never
      // falls after you apply and re-applying just rewrites the same rows.
      if (row.verified?.state === 'bounced') continue;
      if (dryRun) { applied.push({ source: b.flip.source, id: b.flip.id, dryRun: true }); continue; }
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
    // cannot grow without bound). A dry run leaves the cursor untouched.
    if (!dryRun) {
      sync.seenMessageIds = [...new Set([...sync.seenMessageIds, ...fresh.map(m => m.id)])].slice(-3000);
      sync.lastCheckedAt = new Date().toISOString();
      writeSync(sync);
    }

    res.json({
      dryRun,
      scanned: fresh.length,
      hardBounces: bounces.filter(b => b.kind === 'hard').length,
      softBounces: bounces.filter(b => b.kind === 'soft').length,
      [dryRun ? 'wouldFlip' : 'flipped']: applied.length,
      proposed: dryRun ? applied : undefined,
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
    const q = replySearchQuery(since, tokens?.connectedEmail);

    const ids = await listMessages({ q, accessToken, max: 250 });
    const raws = await fetchMessagesConcurrent(ids, { accessToken });

    const taRows = parseTargetTalentMd();
    const recruiterRows = parseRecruitersMd();
    const apps = (() => { try { return parseApplicationsMd(); } catch { return []; } })();
    const { replies, other } = scanDecisions({ messages: raws, taRows, recruiterRows, apps });
    // Unmatched-by-contact senders are split: those the domain tier tied to a known
    // company (a likely first-contact email) vs. genuinely unknown. Both surfaced.
    const byCompany = other.filter(o => o.companyGuess);
    const unknown = other.filter(o => !o.companyGuess);
    // Attach the candidate applications so the UI can log a reply against a specific
    // one (a known-contact reply matches on the contact's company, a company-guessed
    // reply on the guessed company; the user picks when there is more than one), plus
    // the handled record so an already-logged reply is hidden on the next sweep.
    const sync = readSync();
    const handled = sync.handledReplies || {};
    const withMeta = (rows, companyOf) => rows.map(r => ({ ...r, candidateApps: candidateAppsFor(companyOf(r), apps), handled: handled[r.msgId] || null }));
    // Stamp that a preview sweep ran (manual "Check email" or the auto-scan on
    // Review open), so /health can show "last checked …" and nudge when it has
    // been a while. Best-effort: a freshness write must never fail the read.
    try { sync.lastPreviewAt = new Date().toISOString(); writeSync(sync); } catch { /* freshness is best-effort */ }
    res.json({
      replies: withMeta(replies, r => r.contact?.company),
      byCompany: withMeta(byCompany, r => r.companyGuess?.company),
      unknown,
      unmatched: other.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/google/replies/:msgId/:action — record a reply against a specific
// application. `action` is one of: log (note only), responded, rejected, or an
// interview stage label. Always logs the note to app-notes.json; the status ones
// also flip the application status (which logs a status event, so the debrief
// prompt picks it up). The appId is explicit so a reply is never auto-attached to
// the wrong application when a company has several.
router.post('/api/google/replies/:msgId/:action', (req, res) => {
  try {
    const { msgId, action } = req.params;
    const { appId, note, company } = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    // Best-effort: the log/status may already be written, so a sync failure must not 500.
    const markHandled = (rec) => {
      try { const s = readSync(); s.handledReplies = s.handledReplies || {}; s.handledReplies[msgId] = rec; writeSync(s); }
      catch { /* hiding is best-effort */ }
    };

    // Dismiss: mark handled with no application. For a reply that cannot or need not
    // be logged (no matching application, or simply not relevant) so it stops
    // resurfacing on every full-rescan sweep. No note, no status change.
    if (action === 'dismiss') {
      markHandled({ action: 'dismiss', appId: null, date: today });
      return res.json({ ok: true, dismissed: true });
    }

    const id = parseInt(appId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'appId is required (which application this reply belongs to).' });

    const text = String(note || '').trim();
    if (text) addNote(id, `### Reply logged (${today})\n${text}`);

    let statusFlip = null;
    if (action === 'responded') statusFlip = 'Responded';
    else if (action === 'rejected') statusFlip = 'Rejected';
    else if (INTERVIEW_STAGES.includes(action)) statusFlip = action;
    else if (action !== 'log') return res.status(400).json({ error: `Unknown action: ${action}` });

    if (statusFlip) patchRowInMd(id, { status: statusFlip }, { company });

    markHandled({ action, appId: id, date: today });
    res.json({ ok: true, appId: id, statusFlip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/google/draft { to, subject, body } — create a Gmail DRAFT. Never
// sends: the lib has no send wrapper, this only calls drafts.create. Requires the
// compose scope; a read-only token (from before this shipped) gets a clear
// needsReconnect signal instead of a raw 403 so the UI can prompt a re-consent.
// The user reviews and sends every draft by hand in Gmail.
router.post('/api/google/draft', async (req, res) => {
  try {
    const tokens = readTokens();
    if (!tokens?.refresh_token) return res.status(400).json({ error: 'Google is not connected.' });
    if (!googleStatus(tokens).canDraft) {
      return res.status(403).json({ error: 'This Gmail connection is read-only. Reconnect to grant draft access.', needsReconnect: true });
    }
    const { to, subject, body } = req.body || {};
    if (!to || !/@/.test(String(to))) return res.status(400).json({ error: 'A valid "to" address is required.' });
    const accessToken = await getAccessToken({ tokens });
    const draft = await createDraft({ to: String(to), subject: String(subject || ''), body: String(body || ''), accessToken });
    res.json({ ok: true, draftId: draft.id, messageId: draft.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

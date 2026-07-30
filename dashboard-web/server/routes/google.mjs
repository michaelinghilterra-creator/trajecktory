import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  readTokens, writeTokens, readSync, writeSync, googleStatus, checkHealth, clientConfigured,
  getAccessToken, listMessages, fetchMessagesConcurrent, scanDecisions,
  buildAuthUrl, exchangeCode, fetchProfileEmail, newPkce, randomState, candidateAppsFor, createDraft,
  logReplyToContact,
} from '../lib/google.mjs';
import { parseTargetTalentMd, updateTTLine } from '../lib/target-talent.mjs';
import { parseRecruitersMd, updateRecruiterLine } from '../lib/recruiters.mjs';
import { PORT, RECRUITER_CORR_DIR, TT_CORR_DIR } from '../config.mjs';
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

// One place that decides why a mail call cannot run, because "not set up" and "not
// connected" are different problems with different fixes. Answering both with
// "Google is not connected" sends a user who has never provisioned an OAuth client
// hunting for a Connect button that cannot help them. The flags let the UI offer
// the right next step instead of a generic error.
function connectionProblem(tokens) {
  if (!clientConfigured()) {
    return { error: 'Gmail is not set up on this install yet. It needs a one-time setup in your own Google account.', needsSetup: true };
  }
  if (!tokens || !tokens.refresh_token) {
    return { error: 'Google is not connected.', needsConnect: true };
  }
  return null;
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
// Never answers with a bare error page. This endpoint is reached by a FULL-PAGE
// navigation, so a 400 body replaces the whole dashboard with unstyled text naming
// an env var: the user loses their place and is told to go edit a file they have
// never heard of. Every failure here redirects back with a reason the app renders,
// exactly as the callback below already does. Missing credentials get their own
// reason because they are not a failure at all, just a setup step not done yet.
// The redirect target is derived from the request's own Host header, which any
// client can set to anything. The practical risk is small — Google only accepts a
// loopback host for a desktop client, so a forged Host produces a rejected consent
// rather than a code delivered somewhere else — but "redirect_uri built from the
// Host header" is a known-bad shape and does not deserve a paragraph of reasoning
// every time someone reads it.
//
// So the header is ALLOWED, not trusted: keep it when it is a loopback host (which
// preserves whether the user is on localhost or 127.0.0.1, and whatever port the
// launcher picked), and otherwise fall back to this server's configured address.
// Validating rather than replacing keeps the existing behaviour exactly.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
export function callbackUri(req) {
  const host = String(req.get('host') || '');
  const safeHost = LOOPBACK_HOST.test(host) ? host : `127.0.0.1:${PORT}`;
  return `http://${safeHost}/api/google/callback`;
}

router.get('/api/google/auth-start', (req, res) => {
  try {
    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientConfigured()) return res.redirect('/?google=setup');
    const now = Date.now();
    sweepPending(now);
    const { verifier, challenge } = newPkce();
    const state = randomState();
    const redirectUri = callbackUri(req);
    pendingAuth.set(state, { verifier, redirectUri, createdAt: now });
    res.redirect(buildAuthUrl({ clientId, redirectUri, state, codeChallenge: challenge }));
  } catch (err) {
    res.redirect(`/?google=error&reason=${encodeURIComponent(String(err.message).slice(0, 120))}`);
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
    const problem = connectionProblem(tokens);
    if (problem) return res.status(400).json(problem);
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
    // SECURITY (CWE-345): a bounce is classified purely from attacker-controllable
    // email content, so a spoofed "undeliverable" naming a real contact must not
    // silently mark them dead. On apply, flip ONLY the contacts the user explicitly
    // confirmed by key; surface whether we even have a record of emailing that
    // address (sentHistory) so the UI can warn.
    const confirmSet = new Set(
      Array.isArray(req.body?.confirm)
        ? req.body.confirm.map(c => (typeof c === 'string' ? c : `${c.source}:${c.id}`))
        : []
    );
    const hasSentHistory = (source, id) => {
      try {
        const dir = source === 'ta' ? TT_CORR_DIR : RECRUITER_CORR_DIR;
        const f = path.join(dir, `${id}.md`);
        return fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('| Sent |');
      } catch { return false; }
    };
    const proposals = [];
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
      const key = `${b.flip.source}:${b.flip.id}`;
      const c = b.contact || {};
      proposals.push({
        source: b.flip.source, id: b.flip.id, key,
        address: b.address || row.email || '',
        name: c.name || '', company: c.company || '',
        sentHistory: hasSentHistory(b.flip.source, b.flip.id),
      });
      if (dryRun) continue;
      // Per-contact confirmation is mandatory on apply: absent from the confirm list
      // = not flipped, so one click can no longer mark every proposed contact bounced
      // sight-unseen (the forged-bounce vector).
      if (!confirmSet.has(key)) continue;
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
      [dryRun ? 'wouldFlip' : 'flipped']: dryRun ? proposals.length : applied.length,
      proposed: proposals,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A From header is "Name <addr@host>" or a bare address. Reduce it to the
// lowercased address so a "not job-related" suppression matches future emails
// from the same sender regardless of how the display name is formatted.
function senderAddress(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

// GET /api/google/replies — recent human replies from known contacts since
// `since`, each with a suggested sentiment. Read-only: this lists, it does not
// write. The UI turns each into a one-click action below.
router.get('/api/google/replies', async (req, res) => {
  try {
    const tokens = readTokens();
    const problem = connectionProblem(tokens);
    if (problem) return res.status(400).json(problem);
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
    // Senders the user marked "not job-related" are dropped from every sweep going
    // forward, so a random email that got picked up once stops resurfacing.
    const notRelated = sync.notRelatedSenders || {};
    const notSuppressed = (r) => { const a = senderAddress(r.from); return !(a && notRelated[a]); };
    const withMeta = (rows, companyOf) => rows.filter(notSuppressed).map(r => ({ ...r, candidateApps: candidateAppsFor(companyOf(r), apps), handled: handled[r.msgId] || null }));
    // Stamp that a preview sweep ran (manual "Check email" or the auto-scan on
    // Review open), so /health can show "last checked …" and nudge when it has
    // been a while. Best-effort: a freshness write must never fail the read.
    try { sync.lastPreviewAt = new Date().toISOString(); writeSync(sync); } catch { /* freshness is best-effort */ }
    res.json({
      replies: withMeta(replies, r => r.contact?.company),
      byCompany: withMeta(byCompany, r => r.companyGuess?.company),
      unknown: unknown.filter(notSuppressed),
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
    const { appId, note, company, contact, subject, snippet, date } = req.body || {};
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

    // Not job-related: hide this message like dismiss, AND remember the SENDER so
    // future sweeps drop their emails too — the user teaching the filter after a
    // random email got picked up. No application, no note, no status change.
    if (action === 'not-related') {
      markHandled({ action: 'not-related', appId: null, date: today });
      const addr = senderAddress(req.body?.from);
      if (addr) {
        try { const s = readSync(); s.notRelatedSenders = s.notRelatedSenders || {}; s.notRelatedSenders[addr] = { date: today }; writeSync(s); }
        catch { /* suppression is best-effort */ }
      }
      return res.json({ ok: true, notRelated: true });
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

    // Record the received email on the CONTACT's own correspondence timeline too,
    // so the reply shows on their card in Network → TA Outreach / Recruiters, not
    // only as a note on the application. Best-effort: the app note and status flip
    // already stand, and a reply with no matched contact (company-guess only) has
    // no card to log to, so this simply no-ops.
    let contactLogged = false;
    if (contact) {
      try { contactLogged = logReplyToContact(contact, { subject, body: snippet, timestamp: date }); }
      catch { /* contact correspondence logging is best-effort */ }
    }

    markHandled({ action, appId: id, date: today });
    res.json({ ok: true, appId: id, statusFlip, contactLogged });
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
    const problem = connectionProblem(tokens);
    if (problem) return res.status(400).json(problem);
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

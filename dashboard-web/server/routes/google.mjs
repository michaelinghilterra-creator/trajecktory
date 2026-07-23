import express from 'express';
import {
  readTokens, writeTokens, readSync, writeSync, googleStatus,
  getAccessToken, listMessages, getMessage, scanDecisions,
  buildAuthUrl, exchangeCode, fetchProfileEmail, newPkce, randomState, candidateAppsFor,
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

// GET /api/google/status — non-secret connection facts for the UI.
router.get('/api/google/status', (req, res) => {
  try {
    res.json(googleStatus());
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

    const raws = [];
    for (const m of fresh) { try { raws.push(await getMessage({ id: m.id, accessToken })); } catch { /* skip unreadable */ } }

    const taRows = parseTargetTalentMd();
    const recruiterRows = parseRecruitersMd();
    const { bounces } = scanDecisions({ messages: raws, taRows, recruiterRows });

    const today = new Date().toISOString().slice(0, 10);
    const applied = [];
    for (const b of bounces) {
      if (!b.flip) continue; // soft, or no matched contact
      if (dryRun) { applied.push({ source: b.flip.source, id: b.flip.id, dryRun: true }); continue; }
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
    const q = `in:inbox after:${since} -from:mailer-daemon -from:postmaster`;

    const ids = await listMessages({ q, accessToken, max: 100 });
    const raws = [];
    for (const m of ids) { try { raws.push(await getMessage({ id: m.id, accessToken })); } catch { /* skip */ } }

    const taRows = parseTargetTalentMd();
    const recruiterRows = parseRecruitersMd();
    const apps = (() => { try { return parseApplicationsMd(); } catch { return []; } })();
    const { replies, other } = scanDecisions({ messages: raws, taRows, recruiterRows, apps });
    // Unmatched-by-contact senders are split: those the domain tier tied to a known
    // company (a likely first-contact email) vs. genuinely unknown. Both surfaced.
    const byCompany = other.filter(o => o.companyGuess);
    const unknown = other.filter(o => !o.companyGuess);
    // Attach the candidate applications so the UI can log a reply against a specific
    // one. A known-contact reply matches on the contact's company; a company-guessed
    // reply on the guessed company. The user picks when there is more than one.
    const withCandidates = (rows, companyOf) => rows.map(r => ({ ...r, candidateApps: candidateAppsFor(companyOf(r), apps) }));
    res.json({
      replies: withCandidates(replies, r => r.contact?.company),
      byCompany: withCandidates(byCompany, r => r.companyGuess?.company),
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
    const { action } = req.params;
    const { appId, note, company } = req.body || {};
    const id = parseInt(appId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'appId is required (which application this reply belongs to).' });

    const text = String(note || '').trim();
    if (text) addNote(id, `### Reply logged (${new Date().toISOString().slice(0, 10)})\n${text}`);

    let statusFlip = null;
    if (action === 'responded') statusFlip = 'Responded';
    else if (action === 'rejected') statusFlip = 'Rejected';
    else if (INTERVIEW_STAGES.includes(action)) statusFlip = action;
    else if (action !== 'log') return res.status(400).json({ error: `Unknown action: ${action}` });

    if (statusFlip) patchRowInMd(id, { status: statusFlip }, { company });

    res.json({ ok: true, appId: id, statusFlip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

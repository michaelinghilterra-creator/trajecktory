import express from 'express';
import { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES, readReferralCorrespondence, writeReferralCorrespondence } from '../lib/referrals.mjs';
import { reconcile, parseConnectionsCsv, saveConnections, linkedinStatus, stageForRow, activeFormSet } from '../lib/linkedin-referrals.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, findRelatedApps } from '../lib/target-talent.mjs';
import { parseRecruitersMd, readRecruiterCorrespondence, writeRecruiterCorrespondence, updateRecruiterLine } from '../lib/recruiters.mjs';
import { loadEnvKey } from '../../../verify-contacts.mjs';
import { findAndVerify, hunterSearchesLeft } from '../../../find-contacts.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';

export const router = express.Router();

// Split a referral's single Name field into first / last for the email finder,
// which keys on (company, first, last). First token is the first name, the rest
// is the surname; a one-word name yields an empty last.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

const _norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const _slug = u => { const m = String(u || '').match(/linkedin\.com\/in\/([^\/?#\s]+)/i); return m ? m[1].toLowerCase().replace(/\/$/, '') : ''; };

// Resolve a referral to its TA-outreach or recruiter TWIN: the same human tracked
// in another book. This is what makes the drawer "unified": a linked referral shows
// (and logs to) the twin's correspondence, so a referral and its TA-contact twin
// are one shared timeline. Match precedence, strongest first:
//   1) an explicit backref stamped in notes ("from TA Outreach #<id>")
//   2) an exact LinkedIn-URL slug match (reliable identity)
//   3) name + company (lower confidence, only when both agree)
// Returns { source:'ta'|'recruiter', contact } or null (a pure-LinkedIn referral
// with no twin — it uses its own correspondence store).
function resolveReferralLink(refRow, taRows, recRows) {
  const taRef = (refRow.notes || '').match(/TA Outreach #(\d+)/i);
  if (taRef) { const c = taRows.find(r => r.id === parseInt(taRef[1], 10)); if (c) return { source: 'ta', contact: c }; }
  const recRef = (refRow.notes || '').match(/Recruiters? #(\d+)/i);
  if (recRef) { const c = recRows.find(r => r.id === parseInt(recRef[1], 10)); if (c) return { source: 'recruiter', contact: c }; }
  const s = _slug(refRow.linkedin);
  if (s) {
    const ta = taRows.find(r => _slug(r.linkedin) === s); if (ta) return { source: 'ta', contact: ta };
    const rc = recRows.find(r => _slug(r.linkedin) === s); if (rc) return { source: 'recruiter', contact: rc };
  }
  const nn = _norm(refRow.name), nc = _norm(refRow.where);
  if (nn && nn.length >= 4) {
    const ta = taRows.find(r => _norm(`${r.first} ${r.last}`) === nn && (!nc || _norm(r.company) === nc)); if (ta) return { source: 'ta', contact: ta };
    const rc = recRows.find(r => _norm(`${r.first} ${r.last}`) === nn && (!nc || _norm(r.firm) === nc)); if (rc) return { source: 'recruiter', contact: rc };
  }
  return null;
}

// ── Referrals ─────────────────────────────────────────────────────────────────
// The warm channel: people in the user's own network who can introduce them or
// flag an application internally. CRUD over data/referrals.md. No LLM, no
// correspondence log — the reconnect/ask templates are static UI copy the user
// personalizes and sends themselves.

// GET /api/referrals — list all + the status vocabulary for the UI's dropdown.
// Each row is annotated with a live-derived `stage` (stage1 = LinkedIn contact
// inside an active-pipeline company, stage2 = other LinkedIn contact, other =
// manually added) so the UI's Stage 1 / Stage 2 subtabs are just filters and a
// Stage-2 contact auto-promotes when you source a JD at their company.
router.get('/api/referrals', (req, res) => {
  try {
    const activeSet = activeFormSet();
    const rows = parseReferralsMd().map(({ raw, ...rest }) => ({ ...rest, stage: stageForRow(rest, activeSet) }));
    res.json({ referrals: rows, statuses: REFERRAL_STATUSES, linkedin: linkedinStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/reconcile — re-scan the stored LinkedIn haystack against
// the current active pipeline and promote NEW warm paths into the tracker.
// The recurring motion (run after a scan, or by the Reconcile button): Stage 1
// only by default; pass { seedPool: true } to also seed the Stage-2 referrer pool.
router.post('/api/referrals/reconcile', (req, res) => {
  try {
    const result = reconcile({ seedPool: !!(req.body && req.body.seedPool) });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/import-linkedin — accept a raw LinkedIn Connections.csv
// (body { csv }), replace the stored haystack, then reconcile with the pool
// seeded (the initial big load). Body limit is the app-wide 12mb, enough for a
// ~7k-row export.
router.post('/api/referrals/import-linkedin', (req, res) => {
  try {
    const csv = req.body && req.body.csv;
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'Provide the CSV text in { csv }.' });
    const connections = parseConnectionsCsv(csv);
    if (!connections.length) return res.status(400).json({ error: 'No connections parsed — is this a LinkedIn Connections.csv?' });
    saveConnections(connections, 'upload');
    const result = reconcile({ seedPool: true });
    res.json({ ok: true, imported: connections.length, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/linkedin-status — is a haystack stored, how big, how fresh.
router.get('/api/referrals/linkedin-status', (req, res) => {
  try { res.json(linkedinStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/referrals — add one person. Only `name` is required.
router.post('/api/referrals', (req, res) => {
  try {
    const { name, how, where, target, status, lastTouch, notes, linkedin, email } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'A name is required.' });
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const [written] = appendReferralRows([{ name, how, where, target, status, lastTouch, notes, linkedin, email }]);
    res.json({ ok: true, id: written.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/referrals/:id — update any mutable cell.
router.patch('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, how, where, target, status, lastTouch, notes, linkedin, email } = req.body || {};
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const ok = updateReferralLine(id, { name, how, where, target, status, lastTouch, notes, linkedin, email });
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/find-emails — find + verify addresses for referral contacts
// via Hunter Email Finder into MillionVerifier, writing ONLY a verified address
// (the same feed the TA tab uses). body: { ids?: [referralId] }. With ids, runs
// exactly those; without, runs addressless referrals up to the credit budget.
// LinkedIn exports omit ~97% of emails, so this is how a warm path becomes a
// reachable one.
router.post('/api/referrals/find-emails', async (req, res) => {
  try {
    const hkey = loadEnvKey('HUNTER_API_KEY');
    const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
    if (!hkey || !mkey) {
      return res.status(400).json({ error: 'HUNTER_API_KEY and MILLIONVERIFIER_API_KEY must both be set in dashboard-web/.env to find + verify emails.' });
    }
    const { ids, limit } = req.body || {};
    const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    // Need a name + a company (the `where` cell) to search, and no address yet.
    const rows = parseReferralsMd()
      .map(r => ({ ...r, _n: splitName(r.name) }))
      .filter(r => !(r.email || '').trim() && r._n.first && r._n.last && (r.where || '').trim() &&
        (!idSet || idSet.has(r.id)));

    // No per-run cap. Paid Hunter/MillionVerifier plans exist precisely so a bulk
    // run clears the whole list in one pass — the user should not have to re-click
    // through batches. An optional body `limit` still lets a caller cap on purpose;
    // otherwise every addressless referral is processed. creditsBefore is reported,
    // never a gate (a depleted key just yields graceful not_found/error rows).
    const creditsLeft = await hunterSearchesLeft(hkey);
    const toRun = (Number.isFinite(limit) && limit > 0) ? rows.slice(0, limit) : rows;

    // Run the finder calls CONCURRENTLY (each findAndVerify is an independent Hunter
    // → MillionVerifier round-trip), then apply the writes SEQUENTIALLY: updateReferralLine
    // does a read-modify-write of referrals.md, so parallel writes would race and drop
    // rows. The network is the slow part, and that is what the pool parallelizes.
    const CONCURRENCY = 6;
    const found = new Array(toRun.length);
    let next = 0;
    const worker = async () => {
      while (next < toRun.length) {
        const i = next++;
        const r = toRun[i];
        try { found[i] = { r, f: await findAndVerify(r.where, r._n.first, r._n.last, hkey, mkey) }; }
        catch (e) { found[i] = { r, err: e.message }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toRun.length || 1) }, worker));

    const results = [];
    for (const item of found) {
      if (!item) continue;
      const { r, f, err } = item;
      if (err) { results.push({ id: r.id, name: r.name, company: r.where, email: null, state: 'error', error: err }); continue; }
      if (f.found && f.verify) {
        updateReferralLine(r.id, { email: setVerifyTag(f.email, f.verify) });
        results.push({ id: r.id, name: r.name, company: r.where, email: f.email, state: f.verify.state });
      } else {
        results.push({ id: r.id, name: r.name, company: r.where, email: null, state: f.found ? 'unverifiable' : 'not_found' });
      }
    }
    res.json({
      ok: true, checked: toRun.length, written: results.filter(x => x.email).length,
      needing: rows.length, creditsBefore: creditsLeft, results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/:id/detail — the unified drawer's payload. Resolves the
// TA/recruiter twin (if any) and returns THAT contact's correspondence, so a
// referral who is also a TA contact shows the real outreach history instead of a
// hollow log. relatedApps is matched on the referral's company, same as the TA
// drawer. `link` tells the UI which book the timeline belongs to.
router.get('/api/referrals/:id/detail', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ref = parseReferralsMd().find(r => r.id === id);
    if (!ref) return res.status(404).json({ error: 'Referral not found' });
    const taRows = parseTargetTalentMd();
    const recRows = parseRecruitersMd();
    const link = resolveReferralLink(ref, taRows, recRows);
    let correspondence = [];
    let linkInfo = null;
    if (link && link.source === 'ta') {
      correspondence = readTTCorrespondence(link.contact.id);
      linkInfo = { source: 'ta', id: link.contact.id, name: `${link.contact.first} ${link.contact.last}`.trim(), title: link.contact.title, company: link.contact.company, email: link.contact.email, verified: link.contact.verified, status: link.contact.status, linkedinStatus: link.contact.linkedinStatus };
    } else if (link && link.source === 'recruiter') {
      correspondence = readRecruiterCorrespondence(link.contact.id);
      linkInfo = { source: 'recruiter', id: link.contact.id, name: `${link.contact.first} ${link.contact.last}`.trim(), title: link.contact.title, company: link.contact.firm, email: link.contact.email, verified: link.contact.verified, status: link.contact.status };
    } else {
      correspondence = readReferralCorrespondence(id);
    }
    const { raw, ...referral } = ref;
    res.json({ referral, link: linkInfo, correspondence, relatedApps: findRelatedApps(ref.where) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/:id/correspondence — log a Sent / Received / Draft message.
// If the referral has a twin, the entry is written to the TWIN's correspondence
// (and stamps the twin's Last Touch) so both cards share one timeline; otherwise it
// goes to the referral's own store. A non-Draft touch also stamps the referral's
// Last Touch and nudges Not Asked → Catching Up, matching the tab's Log-touch rule.
router.post('/api/referrals/:id/correspondence', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { direction = 'Sent', subject = '', body = '' } = req.body || {};
    if (!['Sent', 'Received', 'Draft'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be Sent, Received, or Draft' });
    }
    const ref = parseReferralsMd().find(r => r.id === id);
    if (!ref) return res.status(404).json({ error: 'Referral not found' });
    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const entry = { timestamp: stamp, direction, subject: String(subject || '(no subject)').trim() || '(no subject)', body: String(body || '').trim() || '(no body)' };
    const link = resolveReferralLink(ref, parseTargetTalentMd(), parseRecruitersMd());
    if (link && link.source === 'ta') {
      const msgs = readTTCorrespondence(link.contact.id); msgs.push(entry); writeTTCorrespondence(link.contact.id, msgs);
      if (direction !== 'Draft') updateTTLine(link.contact.id, { lastTouch: today });
    } else if (link && link.source === 'recruiter') {
      const msgs = readRecruiterCorrespondence(link.contact.id); msgs.push(entry); writeRecruiterCorrespondence(link.contact.id, msgs);
      if (direction !== 'Draft') updateRecruiterLine(link.contact.id, { lastTouch: today });
    } else {
      const msgs = readReferralCorrespondence(id); msgs.push(entry); writeReferralCorrespondence(id, msgs);
    }
    if (direction !== 'Draft') {
      const upd = { lastTouch: today };
      if (ref.status === 'Not Asked') upd.status = 'Catching Up';
      updateReferralLine(id, upd);
    }
    res.json({ ok: true, linkedTo: link ? { source: link.source, id: link.contact.id } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/referrals/:id — remove a person from the tracker.
router.delete('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = deleteReferralLine(id);
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

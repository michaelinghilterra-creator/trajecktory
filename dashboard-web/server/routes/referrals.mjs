import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES, readReferralCorrespondence, writeReferralCorrespondence } from '../lib/referrals.mjs';
import { reconcile, parseConnectionsCsv, saveConnections, linkedinStatus, stageForRow, activeFormSet } from '../lib/linkedin-referrals.mjs';
import { detectAcceptances, computePendingAcceptances } from '../lib/linkedin-acceptance.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, findRelatedApps } from '../lib/target-talent.mjs';
import { generateText, _stripLeadingSalutation, _stripTrailingSignature, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { cleanEmailBody, cleanEmailSubject } from '../lib/text-hygiene.mjs';
import { reviseForCadence } from '../lib/cadence-revise.mjs';
import { buildReplyPrompt, lastReceived, collapseRe, lastSent, buildFollowupFromSentPrompt } from '../lib/reply-draft.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { ACTIVE_STATUSES } from '../lib/statuses.mjs';
import { loadEnvKey } from '../../../verify-contacts.mjs';
import { findAndVerify, hunterSearchesLeft } from '../../../find-contacts.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';
import { linkedinKey } from '../lib/contact-identity.mjs';

export const router = express.Router();

// Split a referral's single Name field into first / last for the email finder,
// which keys on (company, first, last). First token is the first name, the rest
// is the surname; a one-word name yields an empty last.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

const _norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// This now delegates and will be removed in the next change.
const _slug = (u) => linkedinKey(u);

// Resolve a referral to its TA-outreach TWIN: the same human tracked in the TA
// book. This is what makes the drawer "unified": a linked referral shows (and
// logs to) the twin's correspondence, so a referral and its TA-contact twin are
// one shared timeline. Match precedence, strongest first:
//   1) an explicit backref stamped in notes ("from TA Outreach #<id>")
//   2) an exact LinkedIn-URL slug match (reliable identity)
//   3) name + company (lower confidence, only when both agree)
// Returns { source:'ta', contact } or null (a pure-LinkedIn referral with no twin,
// using its own correspondence store).
function resolveReferralLink(refRow, taRows) {
  const taRef = (refRow.notes || '').match(/TA Outreach #(\d+)/i);
  if (taRef) { const c = taRows.find(r => r.id === parseInt(taRef[1], 10)); if (c) return { source: 'ta', contact: c }; }
  const s = _slug(refRow.linkedin);
  if (s) {
    const ta = taRows.find(r => _slug(r.linkedin) === s); if (ta) return { source: 'ta', contact: ta };
  }
  const nn = _norm(refRow.name), nc = _norm(refRow.where);
  if (nn && nn.length >= 4) {
    const ta = taRows.find(r => _norm(`${r.first} ${r.last}`) === nn && (!nc || _norm(r.company) === nc)); if (ta) return { source: 'ta', contact: ta };
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
    // Same LinkedIn haystack tells us which invited TA contacts have now accepted.
    const accepted = detectAcceptances({});
    res.json({ ok: true, ...result, acceptedFlipped: accepted.flipped.length });
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
    // Detect TA contacts whose pending invite this import shows as accepted, and
    // flip them to LinkedIn-Connected (exact slug match only; see linkedin-acceptance).
    const accepted = detectAcceptances({ connections });
    res.json({ ok: true, imported: connections.length, ...result, acceptedFlipped: accepted.flipped.length, accepted: accepted.flipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/linkedin-status — is a haystack stored, how big, how fresh.
router.get('/api/referrals/linkedin-status', (req, res) => {
  try { res.json(linkedinStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/referrals/pending-acceptances — Invite-Pending TA contacts that match an
// imported connection by name+company but NOT by slug: the "looks accepted, confirm?"
// list. Derived from the stored haystack, so it survives reloads. Confirming one is a
// PATCH /api/target-talent/:id { linkedinStatus: 'Connected' }.
router.get('/api/referrals/pending-acceptances', (req, res) => {
  try { res.json({ pending: computePendingAcceptances({}) }); }
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
// TA twin (if any) and returns THAT contact's correspondence, so a
// referral who is also a TA contact shows the real outreach history instead of a
// hollow log. relatedApps is matched on the referral's company, same as the TA
// drawer. `link` tells the UI which book the timeline belongs to.
router.get('/api/referrals/:id/detail', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ref = parseReferralsMd().find(r => r.id === id);
    if (!ref) return res.status(404).json({ error: 'Referral not found' });
    const taRows = parseTargetTalentMd();
    const link = resolveReferralLink(ref, taRows);
    let correspondence = [];
    let linkInfo = null;
    if (link && link.source === 'ta') {
      correspondence = readTTCorrespondence(link.contact.id);
      linkInfo = { source: 'ta', id: link.contact.id, name: `${link.contact.first} ${link.contact.last}`.trim(), title: link.contact.title, company: link.contact.company, email: link.contact.email, verified: link.contact.verified, status: link.contact.status, linkedinStatus: link.contact.linkedinStatus };
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
    const channel = req.body?.channel === 'LinkedIn' ? 'LinkedIn' : 'Email';
    if (!['Sent', 'Received', 'Draft'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be Sent, Received, or Draft' });
    }
    const ref = parseReferralsMd().find(r => r.id === id);
    if (!ref) return res.status(404).json({ error: 'Referral not found' });
    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const entry = { timestamp: stamp, direction, channel, subject: String(subject || '(no subject)').trim() || '(no subject)', body: String(body || '').trim() || '(no body)' };
    const link = resolveReferralLink(ref, parseTargetTalentMd());
    if (link && link.source === 'ta') {
      const msgs = readTTCorrespondence(link.contact.id); msgs.push(entry); writeTTCorrespondence(link.contact.id, msgs);
      if (direction !== 'Draft') updateTTLine(link.contact.id, { lastTouch: today });
    } else {
      const msgs = readReferralCorrespondence(id); msgs.push(entry); writeReferralCorrespondence(id, msgs);
    }
    if (direction !== 'Draft') {
      // Auto-advance the ladder, never regressing. A received reply after an ask
      // is a positive response (Asked → Responded); the existing Not Asked →
      // Catching Up nudge stands for any first non-draft touch. Intro Made and
      // beyond (a made intro, an application sent) are left alone — logging a
      // later message must not knock those terminal wins backward.
      const upd = { lastTouch: today };
      if (ref.status === 'Not Asked' || !ref.status) upd.status = 'Catching Up';
      else if (direction === 'Received' && ref.status === 'Asked') upd.status = 'Responded';
      updateReferralLine(id, upd);
    }
    res.json({ ok: true, linkedTo: link ? { source: link.source, id: link.contact.id } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/:id/draft — AI-draft a warm, in-network message.
// Unlike the TA/recruiter drafters (candidate-to-employer outreach), this writes
// in the voice of a personal relationship: a reconnect, a soft referral ask, a
// thank-you for an intro, or a gentle nudge. Grounded in how the user knows the
// person (ref.how), where they are now (ref.where), and the role being targeted
// through them (ref.target), plus any live application at their company.
//
// Body: { topic?: 'reconnect'|'ask'|'intro-thanks'|'nudge', mode?: 'reply'|'followup-sent' }
// reply / followup-sent read the shared TWIN thread when the referral is linked,
// so a reply drafts against the real history the drawer shows.
const REF_TOPIC_GUIDANCE = {
  reconnect: 'RECONNECT (no ask yet). The goal is purely to reopen the relationship after time apart. Reference how you know each other warmly and specifically, share a light line on what you are up to now, and invite a catch-up. Do NOT make a referral ask in this message — the ask comes after they reply.',
  ask: 'THE REFERRAL ASK. You are back in touch (or already close). Make one specific, easy-to-decline ask: a quick intro to the right person, or flagging your application internally at their company. Name the role/company you are targeting. Offer to send a short blurb and resume to make it a two-minute forward. Keep it low-pressure and gracious about a no.',
  'intro-thanks': 'THANK-YOU FOR AN INTRODUCTION. They made an intro or flagged your application. Thank them warmly and specifically, tell them briefly how it is going or what your next step is, and make clear there is no further ask. Close the loop so they feel the intro was worth making.',
  nudge: 'GENTLE NUDGE. An earlier ask has gone unanswered. Follow up once, lightly and without guilt-tripping. Re-state the ask in one line, make it even easier to say yes or no, and give them an explicit out so the relationship is protected either way.',
};

router.post('/api/referrals/:id/draft', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ref = parseReferralsMd().find(r => r.id === id);
    if (!ref) return res.status(404).json({ error: 'Referral not found' });

    const firstName = splitName(ref.name).first || (ref.name || 'there').trim();
    const me = getIdentity();

    // The correspondence thread lives on the TWIN when the referral is linked, so
    // reply / follow-up draft against the same history the drawer displays.
    const link = resolveReferralLink(ref, parseTargetTalentMd());
    const prior = link && link.source === 'ta' ? readTTCorrespondence(link.contact.id)
      : readReferralCorrespondence(id);

    const cvMd            = readProjectFile(ROOT_DIR, 'cv.md');
    const profileMd       = readProjectFile(ROOT_DIR, 'modes/_profile.md');
    const articleDigestMd = readProjectFile(ROOT_DIR, 'article-digest.md');

    const contactLabel = `someone in ${me.firstName}'s own professional network (a warm personal contact, NOT a cold recruiter lead)`;
    const contactBlock = `Name:            ${ref.name}\nHow you know them: ${ref.how || '(unspecified)'}\nWhere now / reach: ${ref.where || '(unspecified)'}\nTarget through them: ${ref.target || '(unspecified)'}`;

    // REPLY mode: respond to their most recent inbound message.
    if (req.body?.mode === 'reply') {
      const inbound = lastReceived(prior);
      if (!inbound) return res.status(400).json({ error: 'No received message from this contact yet — nothing to reply to.' });
      const prompt = buildReplyPrompt({ me, cvMd, profileMd, prior, contactLabel, contactBlock, firstName });
      const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Could not parse reply draft from model output', raw });
      const draft = JSON.parse(jsonMatch[0]);
      draft.body = _stripLeadingSalutation(draft.body, firstName);
      draft.body = _stripTrailingSignature(draft.body);
      draft.body = cleanEmailBody(draft.body);
      draft.body = (await reviseForCadence(draft.body, { surface: 'email' })).text;
      draft.subject = cleanEmailSubject(collapseRe(draft.subject, inbound.subject));
      return res.json({ ok: true, draft, messageType: 'reply' });
    }

    // FOLLOW-UP-ON-LAST-SENT mode: nudge a thread built on your last sent message.
    if (req.body?.mode === 'followup-sent') {
      const sent = lastSent(prior);
      if (!sent) return res.status(400).json({ error: 'No message sent to this contact yet — nothing to follow up on.' });
      const prompt = buildFollowupFromSentPrompt({ me, cvMd, profileMd, prior, contactLabel, contactBlock, firstName });
      const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Could not parse follow-up draft from model output', raw });
      const draft = JSON.parse(jsonMatch[0]);
      draft.body = _stripLeadingSalutation(draft.body, firstName);
      draft.body = _stripTrailingSignature(draft.body);
      draft.body = cleanEmailBody(draft.body);
      draft.body = (await reviseForCadence(draft.body, { surface: 'email' })).text;
      draft.subject = cleanEmailSubject(collapseRe(draft.subject, sent.subject));
      return res.json({ ok: true, draft, messageType: 'followup-sent' });
    }

    // Fresh outreach. Topic defaults from the ladder: an already-asked contact
    // gets a nudge, everyone else a reconnect.
    const topic = req.body?.topic
      || (ref.status === 'Intro Made' ? 'intro-thanks'
        : ref.status === 'Asked' ? 'nudge'
        : 'reconnect');
    const topicGuidance = REF_TOPIC_GUIDANCE[topic] || REF_TOPIC_GUIDANCE.reconnect;

    // Ground the ask in a live application at their company, when one exists.
    const relatedApps = findRelatedApps(ref.where);
    const topApp = relatedApps.find(a => ACTIVE_STATUSES.includes(a.status)) || relatedApps[0];
    const relatedContext = topApp
      ? `== LIVE APPLICATION AT ${String(ref.where || '').toUpperCase()} ==\nRole:   ${topApp.role}\nStatus: ${topApp.status} (applied ${topApp.date})\nWhen the topic is a referral ask, this is the specific opening to reference. Do NOT generalize.`
      : `No application currently logged at ${ref.where || 'their company'}. If the topic is an ask, frame it around the kind of roles ${me.firstName} targets (see profile) rather than a specific req.`;

    const prompt = `You are drafting a warm, personal message from ${me.fullName} to ${contactLabel}. This is a real relationship, not a cold outreach: the tone is that of one person reaching out to another they genuinely know.

== THE CONTACT ==
${contactBlock}

${relatedContext}

== ${me.firstName.toUpperCase()}'S CV (source of truth — do not invent metrics or experience) ==
${cvMd}
${articleDigestMd ? `\n== PORTFOLIO / PROOF POINTS (article-digest.md) ==\n${articleDigestMd}\n` : ''}
== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== MESSAGE INTENT ==
${topicGuidance}

== STYLE REQUIREMENTS ==
- Warm and personal, grounded in HOW YOU KNOW THEM above. This is the single most important cue — reference the shared history naturally.
- Direct, human, no corporate filler ("I hope this finds you well", "reaching out to touch base").
- Maximum 130 words in body.
- NO em dashes anywhere. Use periods, commas, semicolons, colons, or parentheses.
- Never invent metrics, claims, or a shared history not supported above or on the CV.
- If (and only if) the intent is a referral ask, make it specific and trivially easy to decline, and offer to send a short blurb + resume.
- Close with a low-friction next step or a genuine sign-off, matching the intent.
${prior.length ? `\n== PRIOR CORRESPONDENCE (most recent first) ==\n${prior.slice().reverse().slice(0, 3).map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`).join('\n\n')}\nAcknowledge the prior thread naturally rather than starting cold.\n` : ''}
Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<subject line — short and human>", "body": "<message body — plain text, no signature block, NO trailing sign-off (no '${me.firstName}', no 'Best,\\n${me.firstName}'), NO greeting and NO bare first-name address. STRUCTURE: 2-4 short paragraphs separated by a LITERAL \\n\\n between paragraphs. The UI prefills 'Hi ${firstName},' so the first sentence MUST begin with substantive content — do NOT start with '${firstName}', 'Hi', 'Hello', or 'Hey'.>"}`;

    const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse draft from model output', raw });
    const draft = JSON.parse(jsonMatch[0]);
    draft.body = _stripLeadingSalutation(draft.body, firstName);
    draft.body = _stripTrailingSignature(draft.body);
    draft.body = cleanEmailBody(draft.body);
    draft.body = (await reviseForCadence(draft.body, { surface: 'email' })).text;
    draft.subject = cleanEmailSubject(draft.subject);
    res.json({ ok: true, draft, messageType: topic, relatedApp: topApp || null });
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

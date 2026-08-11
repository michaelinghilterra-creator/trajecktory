import express from 'express';
import fs from 'fs';
import { ROOT_DIR, RECRUITERS_MD } from '../config.mjs';
import { generateText, _stripLeadingSalutation, _stripTrailingSignature, _replaceEmDashes, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { parseRecruitersMd, readRecruiterCorrespondence, writeRecruiterCorrespondence, updateRecruiterLine, appendRecruiterRows, REC_HEADER, RECRUITER_STATUSES } from '../lib/recruiters.mjs';
import { buildReplyPrompt, lastReceived, collapseRe, lastSent, buildFollowupFromSentPrompt } from '../lib/reply-draft.mjs';
import { logConnect } from '../lib/connects.mjs';
import { isLinkedInInvite } from '../lib/channels.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { parseCsvContacts, CONTACTS_TEMPLATE_CSV } from '../lib/csv.mjs';
import { pauseSequence } from '../lib/sequences.mjs';
import { isHighValueContact } from '../lib/followups.mjs';

export const router = express.Router();

// ── Recruiters CRM ────────────────────────────────────────────────────────────
// Backs the new "Recruiters" page. Tracks executive search firm contacts
// imported from CSV and the outreach correspondence history per contact.
//
// Storage:
//   data/recruiters.md                — master tracker (markdown table)
//   data/recruiter-correspondence/{id}.md — per-contact correspondence log

// GET /api/recruiters/template — downloadable CSV template (shared with TA Outreach).
// Registered before /:id so "template" isn't captured as an id.
router.get('/api/recruiters/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="recruiters-template.csv"');
  res.send(CONTACTS_TEMPLATE_CSV);
});

// POST /api/recruiters/bulk-import  { csv } — same shared template as TA Outreach;
// the CSV `company` column maps to the recruiter's firm. Dedup by firm+last+first.
router.post('/api/recruiters/bulk-import', (req, res) => {
  try {
    const csv = String(req.body?.csv || '');
    if (!csv.trim()) return res.status(400).json({ error: 'A "csv" body is required.' });
    let rows;
    try { rows = parseCsvContacts(csv); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found (need a header row plus rows with company, first, last, title).' });
    const mapped = rows.map(r => ({ firm: r.company, first: r.first, last: r.last, title: r.title, phone: r.phone, linkedin: r.linkedin, website: r.website, city: r.city, state: r.state, notes: r.notes }));
    if (!fs.existsSync(RECRUITERS_MD)) fs.writeFileSync(RECRUITERS_MD, REC_HEADER, 'utf8');
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = r => `${norm(r.firm)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`;
    const existingKeys = new Set(parseRecruitersMd().map(r => key(r)));
    const toWrite = mapped.filter(r => !existingKeys.has(key(r)));
    const written = appendRecruiterRows(toWrite);
    res.json({ ok: true, parsed: rows.length, imported: written.length, duplicates: rows.length - written.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/recruiters', (req, res) => {
  try {
    const rows = parseRecruitersMd();
    // Strip the raw markdown line before sending; tag dual-channel high value.
    res.json(rows.map(({ raw, ...rest }) => ({ ...rest, isHighValue: isHighValueContact(rest) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recruiters/:id — single recruiter + correspondence
router.get('/api/recruiters/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseRecruitersMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Recruiter not found' });
    const { raw, ...recruiter } = r;
    res.json({ ...recruiter, isHighValue: isHighValueContact(recruiter), correspondence: readRecruiterCorrespondence(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/recruiters/:id — update status / notes / lastTouch
router.patch('/api/recruiters/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, lastTouch, website, linkedin, phone,
            first, last, salute, title, firm, city, state, zip, email } = req.body || {};
    if (status && !RECRUITER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${RECRUITER_STATUSES.join(', ')}` });
    }
    const ok = updateRecruiterLine(id, { status, notes, lastTouch, website, linkedin, phone,
                                         first, last, salute, title, firm, city, state, zip, email });
    if (!ok) return res.status(404).json({ error: 'Recruiter not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recruiters/:id/correspondence — append a message
//   body: { direction: 'Sent'|'Received'|'Draft', subject, body, timestamp? }
router.post('/api/recruiters/:id/correspondence', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseRecruitersMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Recruiter not found' });
    const { direction, subject, body, timestamp } = req.body || {};
    if (!direction || !['Sent', 'Received', 'Draft'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be Sent | Received | Draft' });
    }
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

    const messages = readRecruiterCorrespondence(id);
    const ts = timestamp || new Date().toISOString().replace('T', ' ').slice(0, 16);
    messages.push({ timestamp: ts, direction, subject: subject.trim(), body: body.trim() });
    writeRecruiterCorrespondence(id, messages);

    // Auto-advance status based on direction. Never regress:
    // logging a Sent follow-up after a Reply has come in must not knock
    // status back from Replied → Sent.
    const today = new Date().toISOString().slice(0, 10);
    const REC_STAGE = { 'Not Contacted': 0, '': 0, 'Drafted': 1, 'Sent': 2, 'Replied': 3, 'Meeting Scheduled': 4, 'Connected': 5 };
    const curStage = REC_STAGE[r.status || ''] ?? 0;
    let newStatus = r.status;
    if (direction === 'Draft' && curStage < 1) newStatus = 'Drafted';
    else if (direction === 'Sent' && curStage < 2) newStatus = 'Sent';
    else if (direction === 'Received' && curStage < 3) newStatus = 'Replied';
    if (newStatus !== r.status || direction !== 'Draft') {
      updateRecruiterLine(id, { status: newStatus, lastTouch: today });
    }
    if (direction === 'Received') {
      try { pauseSequence('recruiter', id, today); } catch { /* no active sequence — safe to ignore */ }
    }

    // A LinkedIn connection request is a connect, NOT an email touch. Tally it in
    // the connects log so "LinkedIn connects" counts it and "verified touches"
    // (email only) does not. Idempotent on (date, name, source).
    if (direction === 'Sent' && isLinkedInInvite(subject)) {
      logConnect({ name: `${r.first || ''} ${r.last || ''}`.trim(), source: 'recruiter', date: ts.slice(0, 10) });
    }
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recruiters/:id/draft — Claude-draft an outreach using CV voice
router.post('/api/recruiters/:id/draft', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseRecruitersMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Recruiter not found' });

    const projectRoot = ROOT_DIR;
    const cvMd           = readProjectFile(projectRoot, 'cv.md');
    const profileMd      = readProjectFile(projectRoot, 'modes/_profile.md');
    const articleDigestMd = readProjectFile(projectRoot, 'article-digest.md');
    const prior = readRecruiterCorrespondence(id);
    const isFirstTouch = prior.length === 0;
    const messageType = req.body?.messageType || (isFirstTouch ? 'first-touch' : 'follow-up');

    // REPLY mode: respond to the recruiter's most recent received email.
    if (req.body?.mode === 'reply') {
      const inbound = lastReceived(prior);
      if (!inbound) return res.status(400).json({ error: 'No received email from this recruiter yet — nothing to reply to.' });
      const meR = getIdentity();
      const contactBlock = `Firm:  ${r.firm}\nName:  ${r.salute || ''} ${r.first} ${r.last}\nTitle: ${r.title}\nEmail: ${r.email}`;
      const prompt = buildReplyPrompt({ me: meR, cvMd, profileMd, prior, contactLabel: `an executive recruiter at ${r.firm}`, contactBlock, firstName: r.first });
      const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Could not parse reply draft from model output', raw });
      const draft = JSON.parse(jsonMatch[0]);
      draft.body = _stripLeadingSalutation(draft.body, r.first);
      draft.body = _stripTrailingSignature(draft.body);
      draft.body = _replaceEmDashes(draft.body);
      draft.subject = _replaceEmDashes(collapseRe(draft.subject, inbound.subject));
      return res.json({ ok: true, draft, messageType: 'reply' });
    }

    // FOLLOW-UP-ON-LAST-SENT mode: nudge a recruiter thread that went quiet,
    // built on the last email you sent. Requires a sent message.
    if (req.body?.mode === 'followup-sent') {
      const sent = lastSent(prior);
      if (!sent) return res.status(400).json({ error: 'No email sent to this recruiter yet — nothing to follow up on.' });
      const meR = getIdentity();
      const contactBlock = `Firm:  ${r.firm}\nName:  ${r.salute || ''} ${r.first} ${r.last}\nTitle: ${r.title}\nEmail: ${r.email}`;
      const prompt = buildFollowupFromSentPrompt({ me: meR, cvMd, profileMd, prior, contactLabel: `an executive recruiter at ${r.firm}`, contactBlock, firstName: r.first });
      const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'Could not parse follow-up draft from model output', raw });
      const draft = JSON.parse(jsonMatch[0]);
      draft.body = _stripLeadingSalutation(draft.body, r.first);
      draft.body = _stripTrailingSignature(draft.body);
      draft.body = _replaceEmDashes(draft.body);
      draft.subject = _replaceEmDashes(collapseRe(draft.subject, sent.subject));
      return res.json({ ok: true, draft, messageType: 'followup-sent' });
    }

    const me = getIdentity();
    // The "documented approach" link is OPTIONAL and entirely config-driven: it
    // resolves from candidate.portfolio_url in profile.yml (getIdentity ->
    // trajecktoryUrl) and is '' for any user who has not set one. Gate the whole
    // block on a non-empty URL, otherwise the prompt orders the model to paste an
    // empty string into a cold email as a "required" differentiator. Never
    // hardcode a URL here: one that 404s for the recipient is worse than none.
    const linkBlock = isFirstTouch && me.trajecktoryUrl;
    const prompt = `You are drafting a cold-outreach email from ${me.fullName} to an executive recruiter. Your job: write a short, direct, professional email in ${me.firstName}'s voice.

== RECRUITER ==
Firm: ${r.firm}
Name: ${r.salute || ''} ${r.first} ${r.last}
Title: ${r.title}
Location: ${r.city}, ${r.state}
Email: ${r.email}

== ${me.firstName.toUpperCase()}'S CV (source of truth — do not invent metrics or experience) ==
${cvMd}
${articleDigestMd ? `\n== PORTFOLIO / PROOF POINTS (article-digest.md — use for the artifact-led proof point) ==\n${articleDigestMd}\n` : ''}
== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== STYLE REQUIREMENTS ==
- Direct, senior operator tone. No "I hope this finds you well" or other corporate filler.
- Maximum 130 words in body.
- NO em dashes anywhere. Use periods, commas, semicolons, colons, or parentheses.
- Never invent metrics or claims not on the CV.
- Lead with a specific reason for contacting THIS recruiter (their firm specialty, location, recent placements if known). Generic outreach gets ignored.
- Make the ask specific: a 20-minute conversation about RevOps/SalesOps/Analytics director-level openings in their network.
- Include one named artifact from the PORTFOLIO block above as the proof point (a named project, initiative, or concrete outcome with a metric). If no PORTFOLIO block is present, use the most relevant quantified CV proof point. Never invent, round, or embellish a metric.
- Close with a clear next step.
${linkBlock ? `
- FOR FIRST-TOUCH RECRUITER OUTREACH: Include ONE sentence that references ${me.firstName}'s documented approach to strategic hiring/job search at ${me.trajecktoryUrl}. It shows he thinks systematically about process and understands AI tooling, which distinguishes him from typical candidates. Weave it in naturally (not as a tacked-on PS) and include the full URL "${me.trajecktoryUrl}" verbatim so the recruiter can click through. Example phrasings: "I've documented my approach to strategic hiring and process design at ${me.trajecktoryUrl}" or "I approach hiring conversations the way a RevOps leader approaches forecasting — see ${me.trajecktoryUrl} for context." Pick whichever fits the tone.
` : ''}

${isFirstTouch ? '' : `
== PRIOR CORRESPONDENCE (most recent first) ==
${prior.slice().reverse().slice(0, 3).map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`).join('\n\n')}

Since prior messages exist, this should be a follow-up — acknowledge the prior thread, add new value (e.g., reference a recent role you're targeting), and re-issue the ask. Do not repeat your background; the prior email already established it.
`}

Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<email subject>", "body": "<email body — plain text, no signature block, NO trailing sign-off of any kind (no '${me.firstName}', no 'Best,\\n${me.firstName}', no contact info), NO greeting and NO bare first-name address. STRUCTURE: 3-4 short paragraphs separated by a LITERAL \\n\\n (double newline) between paragraphs in the JSON string — do NOT return one giant block. Each paragraph 1-2 sentences (~30-50 words). Pattern: (1) why-now opener referencing the application, (2) one quantified proof point, (3) why-here link to their team, (4) soft conversational ask. The UI prefills 'Hi ${r.first},' so the first sentence of body MUST begin with substantive content. Do NOT start with '${r.first}', 'Hi', 'Hello', 'Hey', or any form of address.>"}`;

    const raw = await generateText(prompt, { model: draftModel(), maxTokens: 1024 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse draft from model output', raw });
    const draft = JSON.parse(jsonMatch[0]);
    draft.body = _stripLeadingSalutation(draft.body, r.first);
    draft.body = _stripTrailingSignature(draft.body);
    draft.body = _replaceEmDashes(draft.body);
    draft.subject = _replaceEmDashes(draft.subject);
    res.json({ ok: true, draft, messageType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



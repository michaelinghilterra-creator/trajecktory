import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { generateText, _stripLeadingSalutation, _stripTrailingSignature, _replaceEmDashes, readProjectFile } from '../lib/anthropic.mjs';
import { parseRecruitersMd, readRecruiterCorrespondence, writeRecruiterCorrespondence, updateRecruiterLine, RECRUITER_STATUSES } from '../lib/recruiters.mjs';
import { getIdentity } from '../lib/profile.mjs';

export const router = express.Router();

// ── Recruiters CRM ────────────────────────────────────────────────────────────
// Backs the new "Recruiters" page. Tracks executive search firm contacts
// imported from CSV and the outreach correspondence history per contact.
//
// Storage:
//   data/recruiters.md                — master tracker (markdown table)
//   data/recruiter-correspondence/{id}.md — per-contact correspondence log

router.get('/api/recruiters', (req, res) => {
  try {
    const rows = parseRecruitersMd();
    // Strip the raw markdown line before sending
    res.json(rows.map(({ raw, ...rest }) => rest));
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
    res.json({ ...recruiter, correspondence: readRecruiterCorrespondence(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/recruiters/:id — update status / notes / lastTouch
router.patch('/api/recruiters/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, lastTouch } = req.body || {};
    if (status && !RECRUITER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${RECRUITER_STATUSES.join(', ')}` });
    }
    const ok = updateRecruiterLine(id, { status, notes, lastTouch });
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
    const cvMd = readProjectFile(projectRoot, 'cv.md');
    const profileMd = readProjectFile(projectRoot, 'modes/_profile.md');
    const prior = readRecruiterCorrespondence(id);
    const isFirstTouch = prior.length === 0;
    const messageType = req.body?.messageType || (isFirstTouch ? 'first-touch' : 'follow-up');

    const me = getIdentity();
    const prompt = `You are drafting a cold-outreach email from ${me.fullName} to an executive recruiter. Your job: write a short, direct, professional email in ${me.firstName}'s voice.

== RECRUITER ==
Firm: ${r.firm}
Name: ${r.salute || ''} ${r.first} ${r.last}
Title: ${r.title}
Location: ${r.city}, ${r.state}
Email: ${r.email}

== ${me.firstName.toUpperCase()}'S CV (source of truth — do not invent metrics or experience) ==
${cvMd}

== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== STYLE REQUIREMENTS ==
- Direct, senior operator tone. No "I hope this finds you well" or other corporate filler.
- Maximum 130 words in body.
- NO em dashes anywhere. Use periods, commas, semicolons, colons, or parentheses.
- Never invent metrics or claims not on the CV.
- Lead with a specific reason for contacting THIS recruiter (their firm specialty, location, recent placements if known). Generic outreach gets ignored.
- Make the ask specific: a 20-minute conversation about RevOps/SalesOps/Analytics director-level openings in their network.
- Include one quantified proof point from the CV (e.g., "$400M ARR reporting", "47-person SDR org redesign", "MEDDPICC across 150+ sellers").
- Close with a clear next step.
${isFirstTouch ? `
- FOR FIRST-TOUCH RECRUITER OUTREACH (REQUIRED — do NOT omit): Include ONE sentence that references ${me.firstName}'s documented approach to strategic hiring/job search at ${me.trajecktoryUrl}. This is a load-bearing differentiator — it shows he thinks systematically about process and understands AI tooling, which distinguishes him from typical candidates. Weave it in naturally (not as a tacked-on PS) and ALWAYS include the full URL "${me.trajecktoryUrl}" verbatim so the recruiter can click through. Example phrasings: "I've documented my approach to strategic hiring and process design at ${me.trajecktoryUrl}" or "I approach hiring conversations the way a RevOps leader approaches forecasting — see ${me.trajecktoryUrl} for context." Pick whichever fits the tone; do not skip it.
` : ''}

${isFirstTouch ? '' : `
== PRIOR CORRESPONDENCE (most recent first) ==
${prior.slice().reverse().slice(0, 3).map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`).join('\n\n')}

Since prior messages exist, this should be a follow-up — acknowledge the prior thread, add new value (e.g., reference a recent role you're targeting), and re-issue the ask. Do not repeat your background; the prior email already established it.
`}

Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<email subject>", "body": "<email body — plain text, no signature block, NO trailing sign-off of any kind (no '${me.firstName}', no 'Best,\\n${me.firstName}', no contact info), NO greeting and NO bare first-name address. STRUCTURE: 3-4 short paragraphs separated by a LITERAL \\n\\n (double newline) between paragraphs in the JSON string — do NOT return one giant block. Each paragraph 1-2 sentences (~30-50 words). Pattern: (1) why-now opener referencing the application, (2) one quantified proof point, (3) why-here link to their team, (4) soft conversational ask. The UI prefills 'Hi ${r.first},' so the first sentence of body MUST begin with substantive content. Do NOT start with '${r.first}', 'Hi', 'Hello', 'Hey', or any form of address.>"}`;

    const raw = await generateText(prompt, { model: 'claude-haiku-4-5', maxTokens: 1024 });
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



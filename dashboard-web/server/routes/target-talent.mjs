import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { generateText, _stripLeadingSalutation, _stripTrailingSignature, _replaceEmDashes, readProjectFile } from '../lib/anthropic.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, findRelatedApps, matchByCompany, TT_STATUSES } from '../lib/target-talent.mjs';
import { appendFollowupRow } from '../lib/followups.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { ACTIVE_STATUSES, isInterviewStage } from '../lib/statuses.mjs';

export const router = express.Router();

// ── Target Talent (Internal TA) CRM ──────────────────────────────────────────
// Mirrors the Recruiters CRM but for internal Talent Acquisition employees at
// Target Companies. Schema adds a LinkedIn column. The /draft endpoint uses an
// internal-TA-specific prompt that references the user's applications.md entries
// to ground outreach in the role being targeted.
//
// Files:
//   data/target-talent.md          — markdown table source of truth
//   data/target-talent-correspondence/{id}.md — per-contact correspondence log

router.get('/api/target-talent', (req, res) => {
  try {
    const rows = parseTargetTalentMd();
    res.json(rows.map(({ raw, ...rest }) => rest));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/target-talent/by-company/:company — TA contacts at a given company
// Used by the Follow-Ups drawer to show related TA contacts + offer cross-log.
router.get('/api/target-talent/by-company/:company', (req, res) => {
  try {
    const company = decodeURIComponent(req.params.company);
    const rows = parseTargetTalentMd();
    const match = matchByCompany(rows, company, r => r.company);
    res.json(match.map(({ raw, ...rest }) => rest));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/target-talent/:id — single contact + correspondence + related apps
router.get('/api/target-talent/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseTargetTalentMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Contact not found' });
    const { raw, ...contact } = r;
    res.json({
      ...contact,
      correspondence: readTTCorrespondence(id),
      relatedApps: findRelatedApps(r.company),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/target-talent/:id — update status / notes / lastTouch
router.patch('/api/target-talent/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, lastTouch, website, phone } = req.body || {};
    if (status && !TT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${TT_STATUSES.join(', ')}` });
    }
    const ok = updateTTLine(id, { status, notes, lastTouch, website, phone });
    if (!ok) return res.status(404).json({ error: 'Contact not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/target-talent/:id/correspondence — append a message
//   body: { direction, subject, body, timestamp?,
//           alsoLogToAppNum?, alsoLogChannel? }
//   `alsoLogToAppNum` cross-logs this correspondence as a follow-up touch on
//   the given application (data/follow-ups.md) — prevents duplicate effort
//   between Talent Acquisition and Follow-Ups pages.
router.post('/api/target-talent/:id/correspondence', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseTargetTalentMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Contact not found' });
    const { direction, subject, body, timestamp, alsoLogToAppNum, alsoLogToAppNums, alsoLogChannel } = req.body || {};
    if (!direction || !['Sent', 'Received', 'Draft'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be Sent | Received | Draft' });
    }
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

    const messages = readTTCorrespondence(id);
    const ts = timestamp || new Date().toISOString().replace('T', ' ').slice(0, 16);
    messages.push({ timestamp: ts, direction, subject: subject.trim(), body: body.trim() });
    writeTTCorrespondence(id, messages);

    // Auto-advance status — never regress. A Sent follow-up after a Reply
    // came in must not knock status back from Replied → Sent.
    const today = new Date().toISOString().slice(0, 10);
    const TT_STAGE = { 'Not Contacted': 0, '': 0, 'Drafted': 1, 'Sent': 2, 'Replied': 3, 'Meeting Scheduled': 4, 'Connected': 5 };
    const curStage = TT_STAGE[r.status || ''] ?? 0;
    let newStatus = r.status;
    if (direction === 'Draft' && curStage < 1) newStatus = 'Drafted';
    else if (direction === 'Sent' && curStage < 2) newStatus = 'Sent';
    else if (direction === 'Received' && curStage < 3) newStatus = 'Replied';
    if (newStatus !== r.status || direction !== 'Draft') {
      updateTTLine(id, { status: newStatus, lastTouch: today });
    }

    // Cross-log to applications follow-ups if requested (only for outbound Sent).
    // Accepts either the new `alsoLogToAppNums: number[]` form (multi-app) or the
    // legacy `alsoLogToAppNum: number` form (single app). De-duplicates and
    // returns the row ids of every follow-up actually written.
    const crossLoggedFollowups = [];
    if (direction === 'Sent') {
      const ids = new Set();
      if (Array.isArray(alsoLogToAppNums)) for (const n of alsoLogToAppNums) ids.add(parseInt(n, 10));
      if (alsoLogToAppNum) ids.add(parseInt(alsoLogToAppNum, 10));
      if (ids.size > 0) {
        try {
          const apps = parseApplicationsMd();
          for (const appNum of ids) {
            const app = apps.find(a => a.id === appNum);
            if (!app) continue;
            const n = appendFollowupRow({
              appNum,
              date: today,
              company: app.company,
              role: app.role,
              channel: alsoLogChannel || 'Email',
              contact: `${r.first} ${r.last}`.trim(),
              notes: `Cross-logged from Talent Acquisition · ${r.company} · Subject: ${subject.trim()}`,
            });
            crossLoggedFollowups.push({ appNum, n });
          }
        } catch (e) { /* non-fatal */ }
      }
    }

    res.json({
      ok: true,
      status: newStatus,
      crossLoggedFollowups,
      // Backwards-compat for older clients that read `crossLoggedFollowup`
      crossLoggedFollowup: crossLoggedFollowups[0]?.n ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/target-talent/:id/draft — Claude-draft outreach
//   Internal-TA voice: references the specific role(s) you applied to at this
//   company. Different framing from the recruiter draft — this is warm
//   in-network outreach, not blind recruiter pitch.
router.post('/api/target-talent/:id/draft', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseTargetTalentMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Contact not found' });

    const projectRoot = ROOT_DIR;
    const cvMd      = readProjectFile(projectRoot, 'cv.md');
    const profileMd = readProjectFile(projectRoot, 'modes/_profile.md');
    const prior = readTTCorrespondence(id);
    const isFirstTouch = prior.length === 0;
    const messageType = req.body?.messageType || (isFirstTouch ? 'first-touch' : 'follow-up');

    // Interview-stage tuning: the drawer passes where the user is in the loop so
    // the draft's framing matches. 'general' (or unset) keeps the default
    // first-touch / follow-up behavior unchanged.
    // Keyed by application status (which now carries the interview round) plus a
    // legacy 'TA Screen' alias. 'general' (or unset) keeps default behavior.
    const STAGE_GUIDANCE = {
      'Phone Screen': 'PHONE / TA SCREEN STAGE. This contact is (or could be) the recruiter screen. Goal is to surface yourself and confirm fit for the screen. Keep it light and logistics-friendly; reinforce the one proof point most relevant to the role and express readiness to talk.',
      'TA Screen': 'PHONE / TA SCREEN STAGE. This contact is (or could be) the recruiter screen. Goal is to surface yourself and confirm fit for the screen. Keep it light and logistics-friendly; reinforce the one proof point most relevant to the role and express readiness to talk.',
      '1st Interview': 'FIRST INTERVIEW STAGE. You are early in the interview loop. Reference momentum ("enjoyed the conversation", "following the process") without naming details you may not have. Reinforce one differentiated strength and signal continued interest.',
      '2nd Interview': 'SECOND INTERVIEW STAGE. You are progressing through the loop. Acknowledge the process is advancing, add a specific new value point or artifact relevant to the team, and keep the ask low-friction (e.g. logistics or a brief sync).',
      '3rd Interview': 'THIRD / LATE INTERVIEW STAGE. You are late in the process, likely near a decision. Tone is confident and concise: reaffirm strong fit, address any likely open question proactively, and make it easy to move to next steps. Do not sound impatient.',
      '4th Interview': 'FINAL-LOOP STAGE. You are at the last round, decision imminent. Be confident and concise: reaffirm fit in one line, proactively close any lingering question, and make the next step effortless. Do not sound anxious or over-eager.',
    };

    // Pull related applications to ground the outreach in a real role
    const relatedApps = findRelatedApps(r.company);
    const topApp = relatedApps.find(a => ACTIVE_STATUSES.includes(a.status))
                || relatedApps[0];

    // Default the interview-stage framing from the app's own status (it now
    // carries the round), unless the drawer explicitly overrides it.
    const interviewStage = req.body?.interviewStage
      || (topApp && isInterviewStage(topApp.status) ? topApp.status : 'general');
    const stageGuidance = STAGE_GUIDANCE[interviewStage] || '';

    // Compute days since application so the model uses correct timing
    // language. Without this, the model defaults to "yesterday/this morning"
    // (the example in the TIMING bullet) even for 30+ day-old applications.
    let timingPhrase = '';
    let daysSinceApply = null;
    if (topApp && topApp.date) {
      const applyMs = Date.parse(topApp.date);
      if (!isNaN(applyMs)) {
        daysSinceApply = Math.floor((Date.now() - applyMs) / 86400000);
        if (daysSinceApply <= 0)      timingPhrase = 'today (do NOT send same-day — flag this in the email as "submitted earlier today")';
        else if (daysSinceApply === 1) timingPhrase = 'yesterday';
        else if (daysSinceApply <= 3)  timingPhrase = `${daysSinceApply} days ago (use "a few days ago" or "earlier this week")`;
        else if (daysSinceApply <= 10) timingPhrase = `${daysSinceApply} days ago (use "last week" or "about a week ago")`;
        else if (daysSinceApply <= 21) timingPhrase = `${daysSinceApply} days ago (use "a couple of weeks ago")`;
        else if (daysSinceApply <= 45) timingPhrase = `${daysSinceApply} days ago (use "last month" or "a few weeks back")`;
        else                            timingPhrase = `${daysSinceApply} days ago (use "earlier this spring/summer/etc." or just reference the role without timing language)`;
      }
    }

    const relatedContext = topApp
      ? `== RELATED APPLICATION AT ${r.company.toUpperCase()} ==
Role:   ${topApp.role}
Status: ${topApp.status} (applied ${topApp.date}${daysSinceApply != null ? `, ${daysSinceApply} days ago` : ''})
Score:  ${topApp.score}
TIMING LANGUAGE: ${timingPhrase || '(no application date available — avoid specific timing claims)'}
Reference this role specifically in the outreach. Do NOT generalize. Do NOT claim the application was submitted at a different time than what's stated above.`
      : `No application currently logged for ${r.company}. Write a forward-looking introduction expressing interest in their team and the kind of roles you target (Director/VP RevOps, Analytics, BizDev — see profile).`;

    const me = getIdentity();
    const prompt = `You are drafting a warm in-network email from ${me.fullName} to an Internal Talent Acquisition / People-team employee at a TARGET COMPANY he is actively pursuing. This is NOT a blind recruiter pitch — this is a candidate making direct contact to surface himself for a role at a company he's already engaging with.

== INTERNAL TA CONTACT ==
Company:  ${r.company}
Name:     ${r.salute || ''} ${r.first} ${r.last}
Title:    ${r.title}
Location: ${r.city}, ${r.state}
Email:    ${r.email}
LinkedIn: ${r.linkedin || '(not provided)'}

${relatedContext}

== ${me.firstName.toUpperCase()}'S CV (source of truth — do not invent metrics or experience) ==
${cvMd}

== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== STYLE REQUIREMENTS (internal-TA outreach — different from recruiter outreach) ==
- This is warm, NOT cold. You are introducing a candidate who already engaged with the company (applied / evaluated), or who is on a deliberate target list.
- Direct, senior operator tone. No "I hope this finds you well" or other corporate filler.
- Maximum 140 words in body.
- NO em dashes anywhere. Use periods, commas, semicolons, colons, or parentheses.
- Never invent metrics or claims not on the CV.
- Open with a specific reason for contacting this person at THIS company (role applied to, recent funding/news/leadership change, specific team context).
- Lead with one quantified proof point from the CV most relevant to the role.
- Make the ask soft: invite a conversation if useful. Do NOT request a specific meeting length (no "20-minute call"). Phrasing like "would welcome a conversation if there's mutual interest" is the target.
- Close with a clear, low-friction next step.
- Do NOT ask them to forward your resume or do recruiting work for you. Frame as peer-to-peer candidate introduction.
- TIMING: Use the exact phrasing from the TIMING LANGUAGE line in the RELATED APPLICATION block above. Do NOT invent your own gap — the server has computed days-since-application against today's date. If TIMING LANGUAGE says "31 days ago (use 'last month')", say "last month" — never "yesterday" or "this morning". Misreporting the timing reads as careless to the recipient.
${stageGuidance ? `- ${stageGuidance}` : ''}
${isFirstTouch ? `
- FOR FIRST-TOUCH TA OUTREACH: Consider naturally referencing ${me.firstName}'s strategic approach (${me.trajecktoryUrl}) when it makes sense — shows he thinks systemically about process and understands RevOps methodology. This works especially well if the role is RevOps/Analytics/Strategy-focused. Example: "I've documented my approach to strategic hiring at ${me.trajecktoryUrl}, and I think the [specific role/team] aligns well with that framework."
` : ''}

${isFirstTouch ? '' : `
== PRIOR CORRESPONDENCE (most recent first) ==
${prior.slice().reverse().slice(0, 3).map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`).join('\n\n')}

Since prior messages exist, this should be a follow-up — acknowledge the prior thread, add new value (e.g., recent thinking, an artifact, a specific role update), and re-issue the ask.
`}

Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<email subject>", "body": "<email body — plain text, no signature block, NO trailing sign-off of any kind (no '${me.firstName}', no 'Best,\\n${me.firstName}', no contact info), NO greeting and NO bare first-name address. STRUCTURE: 3-4 short paragraphs separated by a LITERAL \\n\\n (double newline) between paragraphs in the JSON string — do NOT return one giant block. Each paragraph 1-2 sentences (~30-50 words). Pattern: (1) why-now opener referencing the application, (2) one quantified proof point, (3) why-here link to their team, (4) soft conversational ask. The UI prefills 'Hi ${r.first},' so the first sentence of body MUST begin with substantive content (e.g. 'I submitted my application…', 'Following up on…'). Do NOT start with '${r.first}', 'Hi', 'Hello', 'Hey', or any form of address.>"}`;

    const raw = await generateText(prompt, { model: 'claude-haiku-4-5', maxTokens: 1024 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse draft from model output', raw });
    const draft = JSON.parse(jsonMatch[0]);
    draft.body = _stripLeadingSalutation(draft.body, r.first);
    draft.body = _stripTrailingSignature(draft.body);
    draft.body = _replaceEmDashes(draft.body);
    draft.subject = _replaceEmDashes(draft.subject);
    res.json({ ok: true, draft, messageType, relatedApp: topApp || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



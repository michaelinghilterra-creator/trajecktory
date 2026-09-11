import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { pauseSequence, getSequence, getTemplate } from '../lib/sequences.mjs';
import { generateText, readProjectFile, readVoiceRules, draftModel } from '../lib/anthropic.mjs';
import { finishDraft } from '../lib/finish-draft.mjs';
import { generateWithRubric } from '../lib/draft-grader.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, findRelatedApps, matchByCompany, crossLogAppNums, TT_STATUSES } from '../lib/target-talent.mjs';
import { buildReplyPrompt, lastReceived, collapseRe, lastSent, buildFollowupFromSentPrompt } from '../lib/reply-draft.mjs';
import { appendFollowupRow, parseFollowupsMd } from '../lib/followups.mjs';
import { logConnect } from '../lib/connects.mjs';
import { isLinkedInInvite } from '../lib/channels.mjs';
import { setLinkedInStatus, markInvitePending, isLinkedInState, LINKEDIN_STATES } from '../lib/tt-linkedin.mjs';
import { isHighValueContact } from '../lib/followups.mjs';
import { appendReferralRows, parseReferralsMd } from '../lib/referrals.mjs';
import { linkedinKey } from '../lib/contact-identity.mjs';
import { summarizeThread } from '../lib/correspondence-context.mjs';
import { getIdentity, getOutreachPolicy, getNarrative } from '../lib/profile.mjs';
import { canContact, logOutreachOverride } from '../lib/outreach-policy.mjs';
import { ACTIVE_STATUSES, findSubmittedApplication, isInterviewStage } from '../lib/statuses.mjs';
import { getPersonContext } from '../lib/person-context.mjs';
import { INFLUENCE_TIERS, resolveInfluenceTier } from '../../../lib/influence-tier.mjs';
import { classifyInbound } from '../../../lib/inbound-classify.mjs';
import { buildPacket } from '../../../lib/outreach-packet.mjs';
import { buildAugustPrompt, buildAugustPromptWithGuidance, parseDraftText, finishOptionsFor } from '../../../lib/outreach-voice.mjs';

function sequenceTone(contactId) {
  try {
    const seq = getSequence('ta', contactId);
    if (!seq || seq.completedAt || seq.paused) return '';
    const tpl = getTemplate(seq.sequenceId);
    if (!tpl) return '';
    const touch = tpl.touches.find(t => t.step === seq.step + 1);
    return touch?.tone || '';
  } catch { return ''; }
}

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
    res.json(rows.map(({ raw, ...rest }) => ({ ...rest, isHighValue: isHighValueContact(rest) })));
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
    res.json(match.map(({ raw, ...rest }) => ({ ...rest, isHighValue: isHighValueContact(rest) })));
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
    const context = getPersonContext('ta', id, { ta: rows });
    res.json({
      ...contact,
      isHighValue: isHighValueContact(contact),
      correspondence: readTTCorrespondence(id),
      relatedApps: findRelatedApps(r.company),
      ...(context ? {
        person: context.person,
        timeline: context.displayTimeline,
        personLastTouch: context.lastTouch,
      } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/target-talent/:id — update status / notes / lastTouch
router.patch('/api/target-talent/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, lastTouch, website, phone, linkedinStatus, influenceTier,
            first, last, salute, title, company, city, state, zip, email, linkedin } = req.body || {};
    if (status && !TT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${TT_STATUSES.join(', ')}` });
    }
    if (linkedinStatus !== undefined && !isLinkedInState(linkedinStatus)) {
      return res.status(400).json({ error: `Invalid linkedinStatus. Must be one of: ${LINKEDIN_STATES.join(', ')}` });
    }
    if (influenceTier !== undefined && !INFLUENCE_TIERS.includes(influenceTier)) {
      return res.status(400).json({ error: `Invalid influenceTier. Must be one of: ${INFLUENCE_TIERS.join(', ')}` });
    }
    // LinkedIn state lives in a sidecar (not the markdown row), so a request that
    // ONLY changes linkedinStatus must not require the contact's row to be
    // rewritten. Set it first, then only touch the row if a row field was given.
    if (linkedinStatus !== undefined) setLinkedInStatus(id, linkedinStatus);
    // Row fields — status/lastTouch/notes plus the editable identity fields.
    const rowUpdates = { status, notes, lastTouch, website, phone, influenceTier,
                         first, last, salute, title, company, city, state, zip, email, linkedin };
    const touchesRow = Object.values(rowUpdates).some(v => v !== undefined);
    if (touchesRow) {
      const ok = updateTTLine(id, rowUpdates);
      if (!ok) return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/target-talent/:id/to-referral — one-click offer: a TA contact who
// accepted your LinkedIn invite is now a 1st-degree connection, so promote them into
// the Referrals book. Appends a referrals.md row stamped "from TA Outreach #<id>"
// (so resolveReferralLink re-links them into a shared timeline) plus the LinkedIn URL.
// Idempotent: no-op if a referral already carries the backref or matches the slug.
router.post('/api/target-talent/:id/to-referral', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const contact = parseTargetTalentMd().find(c => c.id === id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const mySlug = linkedinKey(contact.linkedin);
    const already = parseReferralsMd().find(r =>
      new RegExp(`TA Outreach #${id}\\b`, 'i').test(r.notes || '') ||
      (mySlug && linkedinKey(r.linkedin) === mySlug));
    if (already) return res.json({ ok: true, alreadyReferral: true });
    const written = appendReferralRows([{
      name: `${contact.first || ''} ${contact.last || ''}`.trim(),
      how: '1st-degree LinkedIn connection',
      where: contact.company || '',
      target: '',
      status: 'Not Asked',
      lastTouch: '',
      linkedin: contact.linkedin || '',
      email: contact.email || '',
      notes: `from TA Outreach #${id}${contact.title ? ` · ${contact.title}` : ''}`,
    }]);
    res.json({ ok: true, added: written.length });
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
    const channel = req.body?.channel === 'LinkedIn' ? 'LinkedIn' : 'Email';
    if (!direction || !['Sent', 'Received', 'Draft'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be Sent | Received | Draft' });
    }
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

    const messages = readTTCorrespondence(id);
    const ts = timestamp || new Date().toISOString().replace('T', ' ').slice(0, 16);
    const message = { timestamp: ts, direction, channel, subject: subject.trim(), body: body.trim() };
    messages.push(message);
    writeTTCorrespondence(id, messages);
    const isHumanReply = direction === 'Received' && classifyInbound(message) === 'human';

    // Auto-advance status — never regress. A Sent follow-up after a Reply
    // came in must not knock status back from Replied → Sent.
    const today = new Date().toISOString().slice(0, 10);
    const TT_STAGE = { 'Not Contacted': 0, '': 0, 'Drafted': 1, 'Sent': 2, 'Replied': 3, 'Meeting Scheduled': 4, 'Connected': 5 };
    const curStage = TT_STAGE[r.status || ''] ?? 0;
    let newStatus = r.status;
    if (direction === 'Draft' && curStage < 1) newStatus = 'Drafted';
    else if (direction === 'Sent' && curStage < 2) newStatus = 'Sent';
    // Automatic responses are recorded but cannot advance the funnel because no
    // person has replied. Departures and invite acceptances follow the same rule.
    else if (isHumanReply && curStage < 3) newStatus = 'Replied';
    if (newStatus !== r.status || direction !== 'Draft') {
      updateTTLine(id, { status: newStatus, lastTouch: today });
    }

    // Only a human reply pauses outreach because it means a person is in the
    // conversation. Automatic responses stay logged without stopping the sequence.
    if (isHumanReply) {
      try { pauseSequence('ta', id, today); } catch { /* no active sequence, safe to ignore */ }
    }

    // A LinkedIn connection request is a connect, NOT an email touch. Tally it in
    // the connects log so "LinkedIn connects" counts it and "verified touches"
    // (email only) does not. Idempotent on (date, name, source).
    if (direction === 'Sent' && (channel === 'LinkedIn' || isLinkedInInvite(subject))) {
      logConnect({ name: `${r.first || ''} ${r.last || ''}`.trim(), source: 'ta', id, date: ts.slice(0, 10) });
      // The invite just went out → advance the LinkedIn axis to 'Invite Pending'.
      // Only from 'Not Connected'; never regress someone already 'Connected'. The
      // user flips it to 'Connected' by hand when the invite is accepted.
      markInvitePending(id, ts.slice(0, 10));
    }

    // Cross-log to applications follow-ups for an outbound Sent. Accepts an
    // explicit `alsoLogToAppNums: number[]` (multi-app) or legacy
    // `alsoLogToAppNum: number` (single app).
    //
    // AUTO-CROSS-LOG: when the caller names no application, a Sent TA touch still
    // services every live application at this company, so we resolve them by
    // company and log to each. Without this the touch updated the TA CRM but not
    // the follow-up log, and the Unserviced/WIP gauge (which reads the follow-up
    // log, NOT the TA CRM) drifted — reading dozens of applications as untouched
    // that had already had outreach sent. Scoped to OUTREACH_ELIGIBLE_STATUSES
    // (applied through offer, plus a ghosted No Response) so an only-Evaluated or
    // closed row is never touched. Explicit ids, when given, win and suppress the
    // auto path.
    const crossLoggedFollowups = [];
    if (direction === 'Sent') {
      const apps = parseApplicationsMd();
      const explicit = [
        ...(Array.isArray(alsoLogToAppNums) ? alsoLogToAppNums : []),
        ...(alsoLogToAppNum ? [alsoLogToAppNum] : []),
      ];
      const ids = crossLogAppNums(apps, r.company, explicit);
      if (ids.length > 0) {
        try {
          // Dedupe against a touch already logged today for this contact, so a
          // re-sent message or a double-submit does not stack duplicate rows.
          const existing = parseFollowupsMd();
          const contactName = `${r.first || ''} ${r.last || ''}`.trim();
          for (const appNum of ids) {
            const app = apps.find(a => a.id === appNum);
            if (!app) continue;
            if (existing.some(f => f.appNum === appNum && f.date === today && (f.contact || '').trim() === contactName)) continue;
            const n = appendFollowupRow({
              appNum,
              date: today,
              company: app.company,
              role: app.role,
              channel: alsoLogChannel || 'Email',
              contact: contactName,
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

// Interview-stage framing, shared by the email and LinkedIn draft paths. Keyed by
// application status (which carries the interview round) plus a legacy 'TA Screen'
// alias. 'general' (or unset) keeps default first-touch / follow-up behavior.
const STAGE_GUIDANCE = {
  'Phone Screen': 'PHONE / TA SCREEN STAGE. This contact is (or could be) the recruiter screen. Goal is to surface yourself and confirm fit for the screen. Keep it light and logistics-friendly; reinforce the one proof point most relevant to the role and express readiness to talk.',
  'TA Screen': 'PHONE / TA SCREEN STAGE. This contact is (or could be) the recruiter screen. Goal is to surface yourself and confirm fit for the screen. Keep it light and logistics-friendly; reinforce the one proof point most relevant to the role and express readiness to talk.',
  '1st Interview': 'FIRST INTERVIEW STAGE. You are early in the interview loop. Reference momentum ("enjoyed the conversation", "following the process") without naming details you may not have. Reinforce one differentiated strength and signal continued interest.',
  '2nd Interview': 'SECOND INTERVIEW STAGE. You are progressing through the loop. Acknowledge the process is advancing, add a specific new value point or artifact relevant to the team, and keep the ask low-friction (e.g. logistics or a brief sync).',
  '3rd Interview': 'THIRD / LATE INTERVIEW STAGE. You are late in the process, likely near a decision. Tone is confident and concise: reaffirm strong fit, address any likely open question proactively, and make it easy to move to next steps. Do not sound impatient.',
};

export function buildTargetTalentAugustPrompt(packet, {
  channel = 'linkedin', mode = '', interviewStage = '', intentGuidance = '',
  stageGuidance = '', sequenceTone: tone = '', threadState = '',
} = {}) {
  const staged = !!interviewStage && interviewStage !== 'general';
  if (channel === 'email') {
    return staged
      ? buildAugustPromptWithGuidance(packet, { guidance: [stageGuidance] })
      : buildAugustPrompt(packet);
  }
  const threaded = mode === 'reply' || mode === 'followup-sent';
  if (!threaded && !staged) return buildAugustPrompt(packet);
  return buildAugustPromptWithGuidance(packet, {
    messageIntent: threaded ? intentGuidance : '',
    guidance: [
      staged ? stageGuidance : '',
      tone ? `SEQUENCE TONE: ${tone}` : '',
      threadState ? `THREAD STATE: ${threadState}` : '',
    ],
  });
}

// POST /api/target-talent/:id/draft — Claude-draft outreach
//   Internal-TA voice: references the specific role(s) you applied to at this
//   company. Different framing from the recruiter draft — this is warm
//   in-network outreach, not blind recruiter pitch.
//   channel:'linkedin' returns a paste-ready LinkedIn DM (no subject) instead of an
//   email, reading the same merged thread so it acknowledges an accepted invite and
//   makes the stage-appropriate ask. First-touch connect notes still go through
//   /api/linkedin-drafts/connect-note.
router.post('/api/target-talent/:id/draft', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseTargetTalentMd();
    const r = rows.find(x => x.id === id);
    if (!r) return res.status(404).json({ error: 'Contact not found' });
    const recipientRole = r.title || '';
    const recipientTier = resolveInfluenceTier({ notes: r.notes, title: recipientRole }).tier;

    const projectRoot = ROOT_DIR;
    const cvMd           = readProjectFile(projectRoot, 'cv.md');
    const profileMd      = readVoiceRules(projectRoot);
    const prior = readTTCorrespondence(id);
    const context = getPersonContext('ta', id);
    const channel = req.body?.channel === 'linkedin' ? 'linkedin' : 'email';
    const decision = canContact({ timeline: context?.timeline || [], channel, company: r.company, policy: getOutreachPolicy() });
    if (!decision.allowed && !req.body?.override) return res.json({ blocked: true, blocks: decision.blocks, nextEligible: decision.nextEligible });
    if (!decision.allowed) logOutreachOverride({ contactRef: `ta:${id}`, channel, blocks: decision.blocks });

    // LINKEDIN channel: a paste-ready DM (no subject), not an email and not a
    // 300-char connect note. It reads the SAME merged `prior` thread as the email
    // path, so it acknowledges an accepted invite and any earlier note, then makes
    // the stage-appropriate candidacy ask. reply / followup-sent nudge the thread;
    // every other stage is fresh, interview-stage-framed outreach. First-touch
    // connect notes go through /api/linkedin-drafts/connect-note.
    if (channel === 'linkedin') {
      const mode = req.body?.mode === 'reply' ? 'reply' : req.body?.mode === 'followup-sent' ? 'followup-sent' : null;
      const relatedApps = findRelatedApps(r.company);
      const topApp = relatedApps.find(a => ACTIVE_STATUSES.includes(a.status)) || relatedApps[0];
      const submittedApp = findSubmittedApplication(relatedApps);
      const appliedRole = submittedApp?.role || '';
      const appliedDate = submittedApp?.date || '';
      const interviewStage = req.body?.interviewStage
        || (submittedApp && isInterviewStage(submittedApp.status) ? submittedApp.status : 'general');
      const stageGuidance = STAGE_GUIDANCE[interviewStage] || '';
      const thread = summarizeThread(prior);
      const intentGuidance = mode === 'reply'
        ? 'REPLY. Respond directly and specifically to their most recent message in the thread below. Pick up what they said and advance it. Do not restart the conversation.'
        : mode === 'followup-sent'
          ? 'FOLLOW UP ON YOUR LAST MESSAGE. Your last note is unanswered. Send one light, no-guilt bump that names what the earlier note was about, adds one small new thing, and never uses needy filler like "just following up" or "circling back".'
          : (stageGuidance || (submittedApp
            ? 'FIRST / FRESH TOUCH. Surface yourself as a strong candidate: specific interest in the company, that you applied, and one reason you are worth a reply.'
            : 'FIRST / FRESH TOUCH. Surface yourself as a strong candidate: specific interest in the company and one reason you are worth a reply. Do not imply that an application was submitted.'));

      const packet = buildPacket({ source: 'ta', id, kind: 'ta_dm' });
      const prompt = buildTargetTalentAugustPrompt(packet, {
        channel: 'linkedin', mode, interviewStage, intentGuidance, stageGuidance,
        sequenceTone: sequenceTone(id), threadState: thread.stateLine,
      });
      const result = parseDraftText(await generateText(prompt, {
        model: draftModel(), maxTokens: 900, label: `draft:${packet.surfaceId}`,
      }));
      if (!result?.body) return res.status(500).json({ error: 'Could not parse LinkedIn draft from model output' });
      const dm = await finishDraft({
        body: result.body, surface: 'ta_dm',
        cadence: false,
        ...finishOptionsFor(packet),
      });
      return res.json({ ok: true, draft: { subject: '', body: dm.body }, review: null, reviewStatus: 'pending', surfaceId: 'ta_dm', gradeContext: {
        surfaceId: 'ta_dm', source: 'ta', id, appId: topApp?.id ?? null,
        recipientRole, recipientTier, appliedRole, appliedDate,
      }, messageType: mode || interviewStage, channel: 'linkedin', relatedApp: topApp || null });
    }

    const isFirstTouch = prior.length === 0;
    const messageType = req.body?.messageType || (isFirstTouch ? 'first-touch' : 'follow-up');
    // REPLY mode: respond to the contact's most recent received email instead of
    // drafting fresh outreach. Requires an inbound message to reply to.
    if (req.body?.mode === 'reply' || req.body?.interviewStage === 'reply') {
      const inbound = lastReceived(prior);
      if (!inbound) return res.status(400).json({ error: 'No received email from this contact yet — nothing to reply to.' });
      const me = getIdentity();
      const contactBlock = `Company:  ${r.company}\nName:     ${r.salute || ''} ${r.first} ${r.last}\nTitle:    ${r.title}\nEmail:    ${r.email}`;
      const prompt = buildReplyPrompt({ me, cvMd, profileMd, prior, contactLabel: `an internal Talent Acquisition / People-team contact at ${r.company}`, contactBlock, firstName: r.first });
      const narrative = getNarrative();
      const result = await generateWithRubric(prompt, 'reply_email', {
        model: draftModel(), maxTokens: 1024, cvMd,
        mode: 'write',
        rubricOpts: { proofPoints: narrative.proofPoints, superpowers: narrative.superpowers },
      });
      if (result.error) return res.status(500).json({ error: 'Could not parse reply draft from model output' });
      const reply = await finishDraft({
        body: result.body, subject: result.subject, surface: 'reply_email',
        review: result.review,
        reviewStatus: result.reviewStatus,
        cleaner: 'email', stripSalutationFor: r.first, stripSignature: true,
        subjectTransform: (subject) => collapseRe(subject, inbound.subject),
      });
      return res.json({ ok: true, draft: { subject: reply.subject, body: reply.body }, review: null, reviewStatus: 'pending', surfaceId: 'reply_email', gradeContext: { surfaceId: 'reply_email', source: 'ta', id, appId: null }, messageType: 'reply', relatedApp: null });
    }

    // FOLLOW-UP-ON-LAST-SENT mode: nudge a thread that went quiet, built on the
    // most recent email YOU sent (not one they wrote). Requires a sent message.
    if (req.body?.mode === 'followup-sent' || req.body?.interviewStage === 'followup-sent') {
      const sent = lastSent(prior);
      if (!sent) return res.status(400).json({ error: 'No email sent to this contact yet — nothing to follow up on.' });
      const me = getIdentity();
      const contactBlock = `Company:  ${r.company}\nName:     ${r.salute || ''} ${r.first} ${r.last}\nTitle:    ${r.title}\nEmail:    ${r.email}`;
      const prompt = buildFollowupFromSentPrompt({ me, cvMd, profileMd, prior, contactLabel: `an internal Talent Acquisition / People-team contact at ${r.company}`, contactBlock, firstName: r.first });
      const narrative = getNarrative();
      const result = await generateWithRubric(prompt, 'followup_sent', {
        model: draftModel(), maxTokens: 1024, cvMd,
        mode: 'write',
        rubricOpts: { proofPoints: narrative.proofPoints, superpowers: narrative.superpowers },
      });
      if (result.error) return res.status(500).json({ error: 'Could not parse follow-up draft from model output' });
      const followup = await finishDraft({
        body: result.body, subject: result.subject, surface: 'followup_sent',
        review: result.review,
        reviewStatus: result.reviewStatus,
        cleaner: 'email', stripSalutationFor: r.first, stripSignature: true,
        subjectTransform: (subject) => collapseRe(subject, sent.subject),
      });
      return res.json({ ok: true, draft: { subject: followup.subject, body: followup.body }, review: null, reviewStatus: 'pending', surfaceId: 'followup_sent', gradeContext: { surfaceId: 'followup_sent', source: 'ta', id, appId: null }, messageType: 'followup-sent', relatedApp: null });
    }

    // Pull related applications to ground the outreach in a real role
    const relatedApps = findRelatedApps(r.company);
    const topApp = relatedApps.find(a => ACTIVE_STATUSES.includes(a.status))
                || relatedApps[0];
    const submittedApp = findSubmittedApplication(relatedApps);
    const appliedRole = submittedApp?.role || '';
    const appliedDate = submittedApp?.date || '';

    // Default the interview-stage framing from the app's own status (it now
    // carries the round), unless the drawer explicitly overrides it.
    const interviewStage = req.body?.interviewStage
      || (submittedApp && isInterviewStage(submittedApp.status) ? submittedApp.status : 'general');
    const stageGuidance = STAGE_GUIDANCE[interviewStage] || '';

    const packet = buildPacket({ source: 'ta', id, kind: 'ta_email' });
    const prompt = buildTargetTalentAugustPrompt(packet, {
      channel: 'email', interviewStage, stageGuidance,
    });
    const result = parseDraftText(await generateText(prompt, {
      model: draftModel(), maxTokens: 900, label: `draft:${packet.surfaceId}`,
    }));
    if (!result?.body) return res.status(500).json({ error: 'Could not parse draft from model output' });
    const draft = await finishDraft({
      body: result.body, subject: result.subject, surface: 'ta_email',
      cadence: false,
      ...finishOptionsFor(packet),
    });
    res.json({ ok: true, draft: { subject: draft.subject, body: draft.body }, review: null, reviewStatus: 'pending', surfaceId: 'ta_email', gradeContext: {
      surfaceId: 'ta_email', source: 'ta', id, appId: topApp?.id ?? null,
      recipientRole, recipientTier, appliedRole, appliedDate,
    }, messageType, relatedApp: topApp || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



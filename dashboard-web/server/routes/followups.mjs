import express from 'express';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd, patchRowInMd } from '../lib/applications.mjs';
import { parseReport } from '../parser.mjs';
import { hasV1Frontmatter, parseV1, v1ToCheatsheet } from '../v1-loader.mjs';
import { snoozeToday, snoozeDateIn, readSnooze, writeSnooze, pruneSnooze, SNOOZE_KINDS, setMute, logStatusEvent } from '../lib/sidecars.mjs';
import { generateText, readProjectFile } from '../lib/anthropic.mjs';
import { parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleTA, computeGhostedCandidates, STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, GHOST_DAYS, _daysAgo } from '../lib/followups.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine } from '../lib/target-talent.mjs';
import { getIdentity } from '../lib/profile.mjs';

export const router = express.Router();

// ── Follow-Ups (Stale Applications Action Queue) ─────────────────────────────
// Reads/writes data/follow-ups.md (shared format with followup-cadence.mjs).
// Each row: | # | app# | date | company | role | channel | contact | notes |
//
// Cadence rules used for "due" coaching:
//   Applied:   1st FU at 2d since apply · 2nd FU at 5-7d since 1st FU · cap 2 FUs
//   Responded: 1st FU at 5d since last touch · cap 1 FU
//   Interview: 1st FU at 3d since last touch · cap 1 FU
// Threshold "stale" = days since the LAST touch (apply or follow-up) >= per-status threshold.

// GET /api/followups — full log
router.get('/api/followups', (req, res) => {
  try { res.json(parseFollowupsMd()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/followups/stale — computed stale list with coaching.
// Merges applications.md (Applied/Responded/Interview) with target-talent.md
// (Sent/Replied/Meeting Scheduled). Each row is tagged with `source: 'app' | 'ta'`.
router.get('/api/followups/stale', (req, res) => {
  try {
    const apps = computeStaleApps().map(it => ({ source: 'app', ...it }));
    const ta = computeStaleTA();
    const merged = [...apps, ...ta].sort((a, b) => {
      if (a.coachLevel !== b.coachLevel) {
        return a.coachLevel === 'give-up' ? -1 : 1;
      }
      return b.daysSinceLastTouch - a.daysSinceLastTouch;
    });

    // Partition out snoozed alerts. A snooze defers the alert until its date;
    // expired ones are pruned here so they auto-resurface.
    const snooze = readSnooze();
    if (pruneSnooze(snooze)) writeSnooze(snooze);
    const today = snoozeToday();
    const snoozedUntil = (it) => snooze[it.source]?.[String(it.id)];

    // Split the non-snoozed items into WARM (the urgent queue + nav badge) and
    // COLD ("Applications out": cold portal apps with no usable channel, or
    // muted). klass is computed in the lib; muted items are forced cold.
    const warm = [];
    const cold = [];
    const snoozed = [];
    for (const it of merged) {
      const until = snoozedUntil(it);
      if (until && until > today) { snoozed.push({ ...it, snoozeUntil: until }); continue; }
      if (it.klass === 'cold') cold.push(it);
      else warm.push(it);
    }

    res.json({
      thresholds: STALE_THRESHOLD_BY_STATUS,
      taThreshold: TA_STALE_THRESHOLD_DAYS,
      ghostDays: GHOST_DAYS,
      warm,
      cold,
      snoozed,
      ghostedCandidates: computeGhostedCandidates(),
      // Deprecated alias: legacy readers expect `items` to be the badge list.
      items: warm,
    });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups/snooze — defer a stale alert.
//   body: { source: 'app' | 'ta', id, days? = 14 }
router.post('/api/followups/snooze', (req, res) => {
  try {
    const { source, id, days } = req.body || {};
    if (!SNOOZE_KINDS.has(source)) {
      return res.status(400).json({ error: "source must be 'app' or 'ta'" });
    }
    if (id == null || `${id}`.trim() === '') return res.status(400).json({ error: 'id required' });
    const n = Number.isFinite(+days) && +days > 0 ? Math.min(Math.floor(+days), 365) : 14;
    const until = snoozeDateIn(n);
    const snooze = readSnooze();
    snooze[source][String(id)] = until;
    writeSnooze(snooze);
    res.json({ ok: true, source, id: String(id), snoozeUntil: until, days: n });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups/unsnooze — bring an alert back early.
//   body: { source: 'app' | 'ta', id }
router.post('/api/followups/unsnooze', (req, res) => {
  try {
    const { source, id } = req.body || {};
    if (!SNOOZE_KINDS.has(source)) {
      return res.status(400).json({ error: "source must be 'app' or 'ta'" });
    }
    const snooze = readSnooze();
    const existed = snooze[source][String(id)] != null;
    delete snooze[source][String(id)];
    writeSnooze(snooze);
    res.json({ ok: true, existed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups/mute — "Done for now / Awaiting reply". Indefinitely
// removes an Applied app from the warm queue without changing its status or
// logging a touch. body: { id }
router.post('/api/followups/mute', (req, res) => {
  try {
    const { id } = req.body || {};
    if (id == null || `${id}`.trim() === '') return res.status(400).json({ error: 'id required' });
    setMute(id, true);
    res.json({ ok: true, id: String(id), muted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups/unmute — bring a muted app back into the queue. body: { id }
router.post('/api/followups/unmute', (req, res) => {
  try {
    const { id } = req.body || {};
    if (id == null || `${id}`.trim() === '') return res.status(400).json({ error: 'id required' });
    setMute(id, false);
    res.json({ ok: true, id: String(id), muted: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups/archive-ghosted — bulk-set ghosted apps to "No Response".
// Honest terminal state for "applied, company never replied"; counts in the
// analytics denominator as a non-response (unlike Discarded). body: { ids: number[] }
router.post('/api/followups/archive-ghosted', (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
    const apps = parseApplicationsMd();
    let archived = 0;
    for (const raw of ids) {
      const id = parseInt(raw, 10);
      if (isNaN(id)) continue;
      const app = apps.find(a => a.id === id);
      // Only archive apps still in Applied — never override a real signal that
      // arrived since the candidate list was computed.
      if (!app || app.status !== 'Applied') continue;
      if (patchRowInMd(id, { status: 'No Response' })) {
        logStatusEvent(id, 'No Response', { company: app.company });
        // Muting is moot once terminal; clear any lingering mute.
        setMute(id, false);
        archived++;
      }
    }
    res.json({ ok: true, archived });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/followups — log a follow-up touch
//   body: { appNum, date?, channel, contact?, notes?,
//           alsoLogToTalentIds?, alsoLogSubject?, alsoLogBody? }
//
//   `alsoLogToTalentIds` (array of TA contact IDs) cross-logs this touch as a
//   "Sent" correspondence on each matching TA contact's drawer — prevents
//   duplicate-entry effort across the two CRMs. See data.js / followups.jsx.
router.post('/api/followups', (req, res) => {
  try {
    const {
      appNum, date, channel, contact, notes,
      alsoLogToTalentIds, alsoLogSubject, alsoLogBody,
    } = req.body || {};
    if (!appNum || !channel) return res.status(400).json({ error: 'appNum and channel required' });
    const apps = parseApplicationsMd();
    const app = apps.find(a => a.id === parseInt(appNum, 10));
    if (!app) return res.status(404).json({ error: `Application #${appNum} not found` });
    const touchDate = date || new Date().toISOString().slice(0, 10);
    const n = appendFollowupRow({
      appNum: parseInt(appNum, 10),
      date: touchDate,
      company: app.company,
      role: app.role,
      channel,
      contact: contact || '',
      notes: notes || '',
    });

    // Cross-log to TA contact correspondence if requested
    const crossLogged = [];
    if (Array.isArray(alsoLogToTalentIds) && alsoLogToTalentIds.length) {
      const taRows = parseTargetTalentMd();
      const ts = touchDate + ' ' + new Date().toTimeString().slice(0, 5);
      const subject = alsoLogSubject || `Follow-up re: ${app.role} (#${app.id})`;
      const body = alsoLogBody || (notes
        ? `${notes}\n\n(Cross-logged from Follow-Ups page · App #${app.id} ${app.company} ${app.role})`
        : `Cross-logged follow-up touch from the Follow-Ups page.\nApplication: #${app.id} ${app.company} — ${app.role}`);
      for (const taId of alsoLogToTalentIds) {
        const id = parseInt(taId, 10);
        const taRow = taRows.find(r => r.id === id);
        if (!taRow) continue;
        const messages = readTTCorrespondence(id);
        messages.push({ timestamp: ts, direction: 'Sent', subject, body });
        writeTTCorrespondence(id, messages);
        // Bump TA status if appropriate
        const today = new Date().toISOString().slice(0, 10);
        // Treat legacy/non-canonical 'New' and empty values as equivalent to 'Not Contacted' for advance purposes.
        const advanceable = ['Not Contacted', 'Drafted', 'New', ''];
        const newStatus = advanceable.includes(taRow.status || '') ? 'Sent' : taRow.status;
        updateTTLine(id, { status: newStatus, lastTouch: today });
        crossLogged.push(id);
      }
    }

    res.json({ ok: true, n, crossLogged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/followups/:appNum/draft — Claude-drafted follow-up email
router.post('/api/followups/:appNum/draft', async (req, res) => {
  try {
    const appNum = parseInt(req.params.appNum, 10);
    const apps = parseApplicationsMd();
    const app = apps.find(a => a.id === appNum);
    if (!app) return res.status(404).json({ error: `Application #${appNum} not found` });

    const projectRoot = ROOT_DIR;
    const cvMd = readProjectFile(projectRoot, 'cv.md');
    const profileMd = readProjectFile(projectRoot, 'modes/_profile.md');
    const followups = parseFollowupsMd().filter(f => f.appNum === appNum)
                                        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const fuCount = followups.length;
    const touchNumber = fuCount + 1; // this would be the Nth touch
    const daysSinceApply = _daysAgo(app.date);
    const lastTouchDate = followups[0]?.date || app.date;
    const daysSinceLastTouch = _daysAgo(lastTouchDate);

    let reportContext = '';
    if (app.report) {
      try {
        const reportText = fs.readFileSync(path.resolve(projectRoot, app.report), 'utf8');
        reportContext = `\n== ROLE EVALUATION REPORT (excerpt — for grounding the follow-up) ==\n${reportText.slice(0, 3000)}\n`;
      } catch { /* report missing, skip */ }
    }

    const id = getIdentity();
    const prompt = `You are drafting a brief, professional follow-up email from ${id.fullName}. He applied to ${app.company} for the ${app.role} role ${daysSinceApply} days ago. ${fuCount === 0 ? 'This is the FIRST follow-up — no prior touches.' : `He has already sent ${fuCount} follow-up${fuCount === 1 ? '' : 's'} (most recent ${daysSinceLastTouch} days ago). This is touch #${touchNumber}.`}

== APPLICATION CONTEXT ==
Company:  ${app.company}
Role:     ${app.role}
Status:   ${app.status} (since ${app.date})
Score:    ${app.scoreRaw}
Notes:    ${app.notes || '(none)'}
${reportContext}
== ${id.firstName.toUpperCase()}'S CV (source of truth — do not invent metrics) ==
${cvMd}

== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== STYLE REQUIREMENTS ==
- Brief: under 100 words in the body.
- Direct, senior operator tone. No "I hope this finds you well" or other corporate filler.
- NO em dashes. Use periods, commas, semicolons, colons, or parentheses.
- Reference the specific role + company by name.
- ${fuCount === 0 ? 'Lead with one specific reason this role matters to you (drawn from the report). Add one NEW data point or framing that wasn\'t in the original application (a recent thought, a relevant proof point, a question).' : 'Acknowledge this is a follow-up. Add genuinely new value — do not just repeat the original pitch. Reference a recent insight, market shift, or a specific question about the role.'}
- Close with a low-friction ask: brief reply on timing, or a 15-min intro.
- Never invent metrics or claims not on the CV.

Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<email subject — keep tight, reference role>", "body": "<email body — plain text, no signature block, no greeting like 'Hi Name' (UI prefills salutation)>"}`;

    const raw = await generateText(prompt, { model: 'claude-haiku-4-5', maxTokens: 800 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse draft', raw });
    const draft = JSON.parse(jsonMatch[0]);
    res.json({ ok: true, draft, touchNumber, fuCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cheatsheets/:id — parse report .md for this application id
router.get('/api/cheatsheets/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseApplicationsMd();
    const row = rows.find(r => r.id === id);
    if (!row || !row.report) return res.status(404).json({ error: 'No report for this id' });

    const reportPath = path.resolve(ROOT_DIR, row.report);
    if (!fs.existsSync(reportPath)) return res.status(404).json({ error: `Report file not found: ${row.report}` });

    const mdText = fs.readFileSync(reportPath, 'utf8');
    // v1 frontmatter → project directly onto the cheat-sheet shape (no regex).
    // Legacy reports continue through parser.mjs.
    let cs;
    if (hasV1Frontmatter(mdText)) {
      const { data } = parseV1(mdText);
      cs = v1ToCheatsheet(data);
    } else {
      cs = parseReport(mdText);
    }
    // Fall back to applications.md notes as recommendation if none parsed from report
    if (!cs.recommendation && row.notes) cs.recommendation = row.notes;
    res.json(cs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



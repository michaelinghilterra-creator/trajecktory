import express from 'express';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';
import { resolveReportPath } from '../lib/safe-path.mjs';
import { parseApplicationsMd, patchRowInMd } from '../lib/applications.mjs';
import { parseReport } from '../parser.mjs';
import { hasV1Frontmatter, parseV1, v1ToCheatsheet } from '../v1-loader.mjs';
import { snoozeToday, snoozeDateIn, readSnooze, writeSnooze, pruneSnooze, SNOOZE_KINDS, setMute } from '../lib/sidecars.mjs';
import { generateText, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { cleanEmailBody, cleanEmailSubject } from '../lib/text-hygiene.mjs';
import { reviseForCadence } from '../lib/cadence-revise.mjs';
import { parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleContacts, computeGhostedCandidates, computeEmailQueue, computeBothQueue, computeFollowupQueue, computeContactlessApps, computeStaleAppContacts, computeContactFollowups, countWithheldContacts, STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, CONTACT_STALE_THRESHOLD_DAYS, GHOST_DAYS, _daysAgo } from '../lib/followups.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine } from '../lib/target-talent.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { getInmailBudget } from '../lib/inmail-budget.mjs';

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

// GET /api/followups/withheld — how many contacts the send gate is holding back
// for want of a checked address, and whether the keys that would check them are
// set. Kept off /stale deliberately: this reads the contact files, which /stale
// does not need, and a parse failure there must not take the whole action queue
// down for a line of explanatory text.
//
// This exists so a short queue can be read correctly. Without it, a user with no
// verification keys sees fewer rows and no reason, which is the same failure as an
// unreachable feature: the product looks broken when it is merely unconfigured.
router.get('/api/followups/withheld', (req, res) => {
  try {
    const hasKeys = !!((process.env.HUNTER_API_KEY || '').trim() && (process.env.MILLIONVERIFIER_API_KEY || '').trim());
    res.json({ withheld: countWithheldContacts(), hasVerifierKeys: hasKeys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/followups/queue — the UNIFIED follow-up work queue. Merges the three
// channel queues (LinkedIn-only, email-only, both) into one ranked list, each row
// tagged with `channel` for the UI filter chips and `rank` for the sort. This is
// what the single Follow-ups queue reads; the three per-channel endpoints below
// remain for now (compatibility) but the UI no longer flips between them.
router.get('/api/followups/queue', (req, res) => {
  try {
    res.json({ queue: computeFollowupQueue() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/followups/email-queue — the email counterpart of the connect queue.
// Contacts with a sendable, verified email at companies you've applied to, that
// you haven't emailed yet. Working it logs verified email touches (the floor).
router.get('/api/followups/email-queue', (req, res) => {
  try {
    res.json({ queue: computeEmailQueue() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/followups/both-queue — the HIGH-VALUE bucket: contacts reachable both
// ways (verified email AND a LinkedIn handle) at applied companies, worked on both
// channels in parallel. Each row carries linkedinDone/emailDone; the row stays
// until both channels are touched or a reply pauses it.
router.get('/api/followups/both-queue', (req, res) => {
  try {
    res.json({ queue: computeBothQueue() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (The Network "High value" directory endpoint was removed: high value is now a
// per-contact star + filter on the TA table, see isHighValueContact
// in lib/followups.mjs and the isHighValue flag on the contact list endpoints.)

// GET /api/followups/stale — computed stale list with coaching.
// Merges applications.md (Applied/Responded/Interview) with per-contact stale
// items from target-talent.md. Each row is tagged with
// `source: 'app' | 'ta'`.
router.get('/api/followups/stale', (req, res) => {
  try {
    const rawStaleApps = computeStaleApps();
    const apps = rawStaleApps.map(it => ({ source: 'app', ...it }));
    const contacts = computeStaleContacts();
    const merged = [...apps, ...contacts].sort((a, b) => {
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

    // Single source of truth for the Follow-Ups tab, snooze-partitioned the same
    // way as warm/cold: a snoozed contact leaves the active list and surfaces in
    // the Snoozed section (where it can be un-snoozed) until its date passes.
    const contactFollowups = [];
    const snoozedContactFollowups = [];
    for (const it of computeContactFollowups({ staleApps: rawStaleApps })) {
      const until = snoozedUntil(it);
      if (until && until > today) snoozedContactFollowups.push({ ...it, snoozeUntil: until });
      else contactFollowups.push(it);
    }

    // Actionable now: the workable subset of contactFollowups the queue actually
    // shows. Excludes same-day holds (you already reached out at that company
    // today) and, when you are out of InMail credits, the LinkedIn follow-ups that
    // would need one. This is what the nav badge and the Follow-ups subtab count,
    // so an "alert" means something you can send right now, not the whole backlog.
    const inmailOut = getInmailBudget().remaining === 0;
    const actionableCount = contactFollowups.filter((c) => {
      const co = c.companyOutreach;
      const heldToday = !!(co && (co.touchedToday || co.selfSentToday));
      const inmailBlocked = inmailOut && c.channel === 'linkedin' && !c.freeDm && !!(co && co.selfLastTouch);
      return !heldToday && !inmailBlocked;
    }).length;

    res.json({
      thresholds: STALE_THRESHOLD_BY_STATUS,
      taThreshold: TA_STALE_THRESHOLD_DAYS,         // legacy alias
      contactThreshold: CONTACT_STALE_THRESHOLD_DAYS, // unified contact threshold
      ghostDays: GHOST_DAYS,
      warm,
      cold,
      snoozed,
      ghostedCandidates: computeGhostedCandidates(),
      // Applied roles with no contact at the company — "find a contact" nudge.
      // Sorted by apply date descending; each row has: source:'app', id, company,
      // role, status, applyDate, score. Empty array when all applied companies
      // already have at least one contact row. Snoozed/muted nudges (the user
      // checked and there is no reachable contact) are partitioned out using the
      // 'contactless' snooze bucket so companies like these stop re-alerting.
      contactlessApps: computeContactlessApps().filter(it => {
        const until = snooze.contactless?.[String(it.id)];
        return !(until && until > today);
      }),
      // People-first: applications going stale at companies where you HAVE a
      // contact. Surfaces the specific person to ping (with an "app going stale"
      // signal) instead of a company card. Company-only stale apps are covered by
      // contactlessApps above; muted apps are excluded in the compute.
      staleAppContacts: computeStaleAppContacts({ staleApps: rawStaleApps }),
      // Single source of truth for the Follow-Ups tab (badge + overview + queue):
      // every CONTACT worth a touch, deduped, contacts-only, snooze-partitioned
      // above. The warm/cold/staleAppContacts fields stay for Pipeline → Awaiting
      // response and the Find-a-contact nudge, which need the app-level view.
      actionableCount,
      contactFollowups,
      snoozedContactFollowups,
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
      return res.status(400).json({ error: `source must be one of: ${[...SNOOZE_KINDS].join(', ')}` });
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
      return res.status(400).json({ error: `source must be one of: ${[...SNOOZE_KINDS].join(', ')}` });
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
      // patchRowInMd logs the status event itself; logging again here wrote two
      // identical rows for every archived app and inflated the event count.
      if (patchRowInMd(id, { status: 'No Response' }, { company: app.company })) {
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
        // Contain to reports/ — the Report cell is agent-written/untrusted, so a
        // value like [x](dashboard-web/.env) must not read a secret into this prompt.
        const abs = resolveReportPath(app.report);
        if (abs) {
          const reportText = fs.readFileSync(abs, 'utf8');
          reportContext = `\n== ROLE EVALUATION REPORT (excerpt — for grounding the follow-up) ==\n${reportText.slice(0, 3000)}\n`;
        }
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

    const raw = await generateText(prompt, { model: draftModel(), maxTokens: 800 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse draft', raw });
    const draft = JSON.parse(jsonMatch[0]);
    // Text hygiene on the parsed field values (never the JSON envelope): strip
    // invisibles + fold em dashes / curly quotes the prompt's "NO em dashes" rule
    // asks for but the model often ignores. This draft path had no cleaning before.
    draft.body = cleanEmailBody(draft.body);
    draft.body = (await reviseForCadence(draft.body, { surface: 'email' })).text;
    draft.subject = cleanEmailSubject(draft.subject);
    res.json({ ok: true, draft, touchNumber, fuCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/artifacts/:id — the files an apply actually produced ────────────
// The report panels showed the tailored resume as a path taken from the report's
// `docx` field, and that field is never written: apply.mjs generates the file but
// records nothing. Across 439 real reports, zero carry it. So the row was not
// merely unclickable, it almost never rendered at all, and the only working link
// to a tailored resume lived in the toast shown seconds after an apply.
//
// Rather than start writing a path (which fixes nothing already generated), find
// the files. They are named deterministically by apply.mjs as
// {Name}_{Kind}_{Company}_{MM-DD-YYYY}.{ext}, so a company match over output/ is
// reliable and works retroactively for every apply ever made.
//
// Directory listing only, and the response carries just basenames, so nothing
// here can be pointed outside output/.
router.get('/api/artifacts/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = parseApplicationsMd().find(r => r.id === id);
    if (!row || !row.company) return res.json({ resume: null, cover: null, others: [] });

    const outDir = path.join(ROOT_DIR, 'output');
    if (!fs.existsSync(outDir)) return res.json({ resume: null, cover: null, others: [] });

    // Same normalisation apply.mjs uses to build the name: drop legal suffixes
    // and non-word characters, so "Example Co, Inc." and "ExampleCo" both match.
    const norm = (s) => String(s).toLowerCase()
      .replace(/,?\s+(inc|llc|corp|corporation|limited|ltd|gmbh|ag|holdings|group|technologies|software|solutions|systems|co|company)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
    const want = norm(row.company);
    if (!want) return res.json({ resume: null, cover: null, others: [] });

    const hits = fs.readdirSync(outDir).filter(f => norm(f).includes(want));
    // Newest first: the filename carries MM-DD-YYYY, but a lexical sort on that
    // is wrong (12-01 sorts above 01-15 of the next year), so use mtime.
    const stamped = hits.map(f => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(outDir, f)).mtimeMs; } catch { /* unreadable → oldest */ }
      return { f, mtime };
    }).sort((a, b) => b.mtime - a.mtime).map(x => x.f);

    const pick = (re) => stamped.find(f => re.test(f)) || null;
    const resume = pick(/_Resume_.*\.docx$/i) || pick(/_Resume_.*\.pdf$/i);
    const cover  = pick(/_Cover_.*\.docx$/i)  || pick(/_Cover_.*\.pdf$/i);
    res.json({
      resume,
      cover,
      others: stamped.filter(f => f !== resume && f !== cover).slice(0, 12),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/jd/:id — the job posting text, kept after the posting is gone ───
// A posting is taken down the moment it is filled, and the report only ever
// stored the URL. A tester reached a fifth interview 45 days after the posting
// had vanished, and only had something to prepare from because they had
// personally copied the text somewhere else. That is the product losing the one
// document the whole pipeline is about.
//
// Two sources, in order:
//   1. `jdSnapshot` in the report frontmatter — the reliable path going forward.
//   2. A filename match in jds/ — a fallback that gives older evaluations, and
//      anything saved by the paste flow, a link they never had.
//
// PATH SAFETY: the path comes from the report, not from the request, but a
// report is agent-written and therefore not trusted input either. Resolve it and
// require it to sit inside jds/ before reading, so a crafted `../` in a report
// cannot turn this into an arbitrary file read.
router.get('/api/jd/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = parseApplicationsMd().find(r => r.id === id);
    if (!row) return res.status(404).json({ error: 'No such application' });

    const jdsDir = path.resolve(ROOT_DIR, 'jds');
    const safeRead = (rel) => {
      if (!rel || typeof rel !== 'string') return null;
      const abs = path.resolve(ROOT_DIR, rel);
      if (!abs.startsWith(jdsDir + path.sep)) return null;   // outside jds/ → refuse
      if (!fs.existsSync(abs)) return null;
      return { path: path.relative(ROOT_DIR, abs).replace(/\\/g, '/'), text: fs.readFileSync(abs, 'utf8') };
    };

    // 1. declared snapshot
    if (row.report) {
      const rp = resolveReportPath(row.report);   // null if the cell escapes reports/
      if (rp && fs.existsSync(rp)) {
        const md = fs.readFileSync(rp, 'utf8');
        if (hasV1Frontmatter(md)) {
          const hit = safeRead(parseV1(md).data.jdSnapshot);
          if (hit) return res.json({ ...hit, source: 'report' });
        }
      }
    }

    // 2. filename fallback for anything evaluated before snapshots existed
    if (fs.existsSync(jdsDir) && row.company) {
      const slug = String(row.company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const match = fs.readdirSync(jdsDir)
        .filter(f => f.endsWith('.md') && f.toLowerCase().includes(slug))
        .sort()
        .pop();
      if (match) {
        const hit = safeRead(path.join('jds', match));
        if (hit) return res.json({ ...hit, source: 'match' });
      }
    }

    res.status(404).json({ error: 'no-snapshot' });
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

    const reportPath = resolveReportPath(row.report);   // null if the cell escapes reports/
    if (!reportPath || !fs.existsSync(reportPath)) return res.status(404).json({ error: `Report file not found: ${row.report}` });

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



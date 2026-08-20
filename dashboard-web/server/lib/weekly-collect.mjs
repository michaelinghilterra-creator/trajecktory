/**
 * lib/weekly-collect.mjs — wire the real parsers into the pure weeklyMetrics(). I/O
 * lives here so weekly-metrics.mjs stays pure and unit-tested. Both the review CLI
 * and the dashboard tracking route call collectWeeklyMetrics so they can never
 * report different numbers for the same week.
 */

import { weeklyMetrics, weekBounds } from './weekly-metrics.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseFollowupsMd } from './followups.mjs';
import { parseStatusEvents } from './sidecars.mjs';
import { readAppNotes } from './notes.mjs';
import { DEBRIEF_HEADER_RE } from './debrief.mjs';
import { readConnects } from './connects.mjs';
import { influencerConnects } from './engagement-log.mjs';
import { isLinkedInEntry } from './channels.mjs';
import { computeStreak } from './cadence.mjs';

// All LinkedIn connection requests, from BOTH ledgers: linkedin-connects.json
// (the TA/recruiter Connect queue + the manual "log a connect" button) and the
// influencer engagement log (the AI Connect flow). These were two separate stores
// and the weekly review only counted the first, so a connection request logged
// from the Influencers list never showed under "LinkedIn connects sent". Union
// them, deduped on (date, name, source). Returns null only when there is no
// connects log at all, so the metric still reads "not logged" rather than 0.
function allConnects() {
  const base = readConnects();
  const infl = influencerConnects();
  if (base === null && infl.length === 0) return null;
  const merged = [...(base || []), ...infl];
  const seen = new Set();
  return merged.filter(c => {
    const k = `${c.date}|${c.name}|${c.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Every dated Sent/Received across both contact books, as a flat log. `subject`
// rides along so weeklyMetrics can tell an email touch from a LinkedIn invite
// (the two are different metrics that share this one correspondence stream).
function allCorrespondence() {
  const out = [];
  const add = (msgs) => { for (const m of (msgs || [])) out.push({ direction: m.direction, date: (m.timestamp || '').slice(0, 10), subject: m.subject || '', channel: m.channel || 'Email' }); };
  try { for (const c of parseTargetTalentMd()) add(readTTCorrespondence(c.id)); } catch { /* apps-only env */ }
  return out;
}

// Debrief notes flattened to { date, hasObjection }. An objection counts as
// "logged" whether it names a real objection or explicitly records that none was
// raised (both are data); presence of the field is what matters.
function allDebriefs() {
  const out = [];
  const notes = readAppNotes();
  for (const list of Object.values(notes || {})) {
    for (const n of (list || [])) {
      if (!DEBRIEF_HEADER_RE.test(n.text || '')) continue;
      out.push({ date: (n.timestamp || '').slice(0, 10), hasObjection: /objection/i.test(n.text || '') });
    }
  }
  return out;
}

// Cumulative delivered reply rate: of the DISTINCT contacts we sent verified mail
// to (bounced addresses excluded from the delivered denominator), the share who
// replied at least once. Contact-based and cumulative, so it can never exceed
// 100% the way a same-week message ratio can. Null when nobody has been sent to.
function deliveredReplyRatePct() {
  let sentContacts = 0, repliedContacts = 0;
  const tally = (rows, readCorr) => {
    for (const c of rows) {
      if (c.verified?.state === 'bounced') continue; // not delivered
      const msgs = readCorr(c.id) || [];
      // Email touches only. A contact reached ONLY by a LinkedIn invite was not
      // sent verified mail, so it must not enter the email reply-rate denominator.
      if (!msgs.some(m => m.direction === 'Sent' && !isLinkedInEntry(m))) continue;
      sentContacts++;
      if (msgs.some(m => m.direction === 'Received')) repliedContacts++;
    }
  };
  try { tally(parseTargetTalentMd(), readTTCorrespondence); } catch { /* apps-only env */ }
  if (sentContacts === 0) return null;
  return Math.round((repliedContacts / sentContacts) * 100);
}

// Applied rows with no follow-up logged: the WIP gauge that replaces the cap.
function unservicedCount() {
  try {
    const apps = parseApplicationsMd();
    const fu = parseFollowupsMd();
    const withFu = new Set(fu.map(f => f.appNum));
    return apps.filter(a => a.status === 'Applied' && !withFu.has(a.id)).length;
  } catch { return null; }
}

// This week's cadence adherence: mean completion over the scheduled (non-rest)
// days in the last seven, from the cadence log.
function cadenceThisWeekPct() {
  try {
    const { last7 } = computeStreak();
    const active = (last7 || []).filter(d => !d.rest && typeof d.pct === 'number');
    if (!active.length) return null;
    return Math.round(active.reduce((s, d) => s + d.pct, 0) / active.length);
  } catch { return null; }
}

// Assemble the week's metrics from live data. `now` is injectable so the CLI can
// pin a date; the route passes the real clock.
export function collectWeeklyMetrics(now = new Date()) {
  const { weekStart, weekEnd } = weekBounds(now);
  const metrics = weeklyMetrics({
    weekStart, weekEnd,
    correspondence: allCorrespondence(),
    deliveredReplyRatePct: deliveredReplyRatePct(),
    statusEvents: (() => { try { return parseStatusEvents().map(e => ({ status: e.status, date: (e.date || '').slice(0, 10) })); } catch { return null; } })(),
    debriefs: allDebriefs(),
    connects: allConnects(),
    cadencePct: cadenceThisWeekPct(),
    unservicedApplications: unservicedCount(),
  });
  return { weekStart, weekEnd, metrics };
}

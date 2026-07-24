import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { computeStaleApps, computeStaleTA } from './followups.mjs';
import { parseRecruitersMd, RECRUITER_CONTACTED } from './recruiters.mjs';
import { parseTargetTalentMd } from './target-talent.mjs';
import { parseStatusEvents } from './sidecars.mjs';
import { ACTIVE_STATUSES, INTERVIEW_STAGES, FUNNEL_ORDER, isInterviewStage, reachedStage, makeFurthestIdx, enteredFunnel } from './statuses.mjs';
import { rateStat, MIN_SAMPLE } from './rate-confidence.mjs';

const INSIGHTS_DIR = path.resolve(ROOT_DIR, 'data', 'insights');
const INSIGHTS_LATEST = path.join(INSIGHTS_DIR, 'latest.json');
const INSIGHTS_HISTORY_MAX = 5;
const PROFILE_PATH = path.resolve(ROOT_DIR, 'modes', '_profile.md');

// Load the user's profile context for the Claude call. Strips the long
// "## Writing Style" calibration block (verbose, not load-bearing for
// strategy analysis) and trims to keep the prompt lean.
function loadProfileContext() {
  try {
    if (!fs.existsSync(PROFILE_PATH)) return null;
    let raw = fs.readFileSync(PROFILE_PATH, 'utf8');
    raw = raw.replace(/##\s+Writing Style[\s\S]*?(?=\n##\s+|$)/i, '').trim();
    // Cap at ~4k chars so we don't blow the token budget
    if (raw.length > 4000) raw = raw.slice(0, 4000) + '\n\n[…profile truncated for prompt size]';
    return raw;
  } catch (_) { return null; }
}

// Pull the most-recent prior insights run (so the model can reference what
// it said before and the user can see drift).
function loadPriorInsight() {
  try {
    if (!fs.existsSync(INSIGHTS_DIR)) return null;
    const files = fs.readdirSync(INSIGHTS_DIR)
      .filter(f => f.startsWith('run-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(INSIGHTS_DIR, files[0]), 'utf8'));
  } catch (_) { return null; }
}

function pruneInsightsHistory() {
  try {
    if (!fs.existsSync(INSIGHTS_DIR)) return;
    const files = fs.readdirSync(INSIGHTS_DIR)
      .filter(f => f.startsWith('run-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files.slice(INSIGHTS_HISTORY_MAX)) {
      try { fs.unlinkSync(path.join(INSIGHTS_DIR, f)); } catch (_) {}
    }
  } catch (_) {}
}

function buildInsightsContext() {
  const apps = parseApplicationsMd();
  const recruiters = parseRecruitersMd().map(({ raw, ...r }) => r);
  const taContacts = parseTargetTalentMd();

  const activeStatuses = ACTIVE_STATUSES;
  // Credit the furthest rung each app ever reached rather than its live status.
  // Reading live status alone drops anyone who replied and was later rejected out
  // of the numerator while keeping them in the denominator, understating the reply
  // rate roughly 3x. 'No Response' (ghosted) stays in the denominator but never in
  // the numerator, so ghosting honestly drags the rate down instead of vanishing.
  const { furthestIdx, idxOf } = makeFurthestIdx(parseStatusEvents());
  const APPLIED_IDX = idxOf('Applied'), RESPONDED_IDX = idxOf('Responded');
  const SCREEN_IDX = idxOf('Phone Screen'), OFFER_IDX = idxOf('Offer');
  const hasApplied   = a => furthestIdx(a) >= APPLIED_IDX;
  const hasResponded = a => furthestIdx(a) >= RESPONDED_IDX;
  const hasInterview = a => furthestIdx(a) >= SCREEN_IDX;

  const applied = apps.filter(hasApplied);
  const responded = apps.filter(hasResponded);
  const interview = apps.filter(hasInterview);

  // Archetype performance — apply + reply rates by role family
  const archetypes = {};
  for (const a of apps) {
    const k = a.archetype || 'Unknown';
    if (!archetypes[k]) archetypes[k] = { count: 0, applied: 0, responded: 0, scoreSum: 0, scoreN: 0 };
    archetypes[k].count++;
    if (hasApplied(a))   archetypes[k].applied++;
    if (hasResponded(a)) archetypes[k].responded++;
    if (a.score != null) { archetypes[k].scoreSum += a.score; archetypes[k].scoreN++; }
  }
  const archByPerf = Object.entries(archetypes)
    .map(([k, v]) => ({
      archetype: k,
      n: v.count,
      appliedN: v.applied,
      responseRate: v.applied ? Math.round(v.responded / v.applied * 100) : 0,
      conf: rateStat(v.responded, v.applied),
      avgScore: v.scoreN ? +(v.scoreSum / v.scoreN).toFixed(2) : null,
    }))
    .sort((a, b) => b.responseRate - a.responseRate);

  // Sector performance — same shape
  const sectors = {};
  for (const a of apps) {
    if (!a.sector) continue;
    if (!sectors[a.sector]) sectors[a.sector] = { count: 0, applied: 0, responded: 0 };
    sectors[a.sector].count++;
    if (hasApplied(a))   sectors[a.sector].applied++;
    if (hasResponded(a)) sectors[a.sector].responded++;
  }
  const sectorByPerf = Object.entries(sectors)
    .filter(([, v]) => v.applied >= 1)
    .map(([k, v]) => ({
      sector: k,
      n: v.count,
      appliedN: v.applied,
      responseRate: Math.round(v.responded / v.applied * 100),
      conf: rateStat(v.responded, v.applied),
    }))
    .sort((a, b) => b.responseRate - a.responseRate)
    .slice(0, 10);

  // TA + Recruiter funnel summaries.
  //
  // Outreach rates run over EVERY contact, not just the currently-active ones.
  // `Archived` is applied by the Reconcile flow after all related apps close, so
  // filtering on it retroactively deletes the outreach that happened before the
  // row closed. On a mature list the archived rows can be the majority, and they
  // vanish from numerator and denominator together. Same class of bug as counting
  // an application's live status instead of the furthest rung it ever reached.
  const taActive = taContacts.filter(c => c.status !== 'Archived');   // still the honest "open contacts" count
  const REPLIED_SET = ['Replied', 'Meeting Scheduled', 'Connected'];
  const TA_CONTACTED = ['Sent', 'Dormant', ...REPLIED_SET];
  // Archiving OVERWRITES the outreach status in place, so an archived contact's
  // prior state is unrecoverable — but `lastTouch` survives and is only ever
  // stamped when a message actually went out. It is therefore valid evidence for
  // the DENOMINATOR. The numerator cannot be repaired the same way: an archived
  // contact who replied now reads "Archived" like any other, so taReplied is a
  // FLOOR, not a count. `repliedIsFloor` tells the UI to say so rather than
  // presenting an understated rate as measured.
  const taTouchedArchive = taContacts.filter(c =>
    c.status === 'Archived' && /^\d{4}-\d{2}-\d{2}$/.test(String(c.lastTouch || '')));
  const taSent    = taContacts.filter(c => TA_CONTACTED.includes(c.status)).length + taTouchedArchive.length;
  const taReplied = taContacts.filter(c => REPLIED_SET.includes(c.status)).length;
  // Dormant and Bounced are post-send states, so they belong in `sent`.
  const recSent    = recruiters.filter(r => RECRUITER_CONTACTED.has(r.status)).length;
  const recReplied = recruiters.filter(r => REPLIED_SET.includes(r.status)).length;

  // Stale touchpoints (apps + TA, top 15 by silence)
  const staleApps = computeStaleApps().map(it => ({ source: 'app', ...it }));
  const staleTA   = computeStaleTA();
  const topStale = [...staleApps, ...staleTA]
    .sort((a, b) => (b.daysSinceLastTouch || 0) - (a.daysSinceLastTouch || 0))
    .slice(0, 15)
    .map(it => ({
      id: it.id,
      source: it.source || 'app',
      company: it.company,
      role: it.role || it.title || '',
      status: it.status,
      score: it.score,
      daysSilent: it.daysSinceLastTouch,
      coachVerdict: it.coachVerdict,
    }));

  // High-leverage Evaluated waiting for a decision (score ≥ 4.0)
  const pendingHot = apps
    .filter(a => a.status === 'Evaluated' && a.score != null && a.score >= 4.0)
    .sort((a, b) => b.score - a.score).slice(0, 10)
    .map(a => ({ id: a.id, company: a.company, role: a.role, score: a.score, archetype: a.archetype, sector: a.sector }));

  return {
    pipeline: {
      total: apps.length,
      active: apps.filter(a => activeStatuses.includes(a.status)).length,
      evaluated: apps.filter(a => a.status === 'Evaluated').length,
      applied: applied.length,
      responded: responded.length,
      interview: interview.length,
      offer: apps.filter(a => furthestIdx(a) >= OFFER_IDX).length,
      responseRate: applied.length ? Math.round(responded.length / applied.length * 100) : 0,
      interviewRate: applied.length ? Math.round(interview.length / applied.length * 100) : 0,
      responseConf: rateStat(responded.length, applied.length),
      interviewConf: rateStat(interview.length, applied.length),
    },
    archetypes: archByPerf,
    sectors: sectorByPerf,
    // `total` means the same thing on both rows: every contact on record. It
    // previously meant "active" for talent and "all" for recruiters, one line apart.
    talent:     { total: taContacts.length, active: taActive.length, sent: taSent, replied: taReplied,
                  responseRate: taSent ? Math.round(taReplied / taSent * 100) : 0,
                  conf: rateStat(taReplied, taSent),
                  repliedIsFloor: taTouchedArchive.length > 0, archivedTouched: taTouchedArchive.length },
    recruiters: { total: recruiters.length, sent: recSent,   replied: recReplied,   responseRate: recSent ? Math.round(recReplied / recSent * 100) : 0,
                  conf: rateStat(recReplied, recSent) },
    staleTotal: staleApps.length + staleTA.length,
    topStale,
    pendingHot,
  };
}

// Deterministic metrics block for the Insights sub-tabs' stat strips. Pure
// shaping over buildInsightsContext() output — no LLM, no token cost. Persisted
// alongside the generated insights so the strip numbers stay consistent with the
// snapshot Claude reasoned over. All fields optional/defensive for old payloads.
function buildInsightsMetrics(ctx) {
  if (!ctx) return null;
  const arch = ctx.archetypes || [];
  const sectors = ctx.sectors || [];
  const overall = ctx.pipeline?.responseRate ?? 0;
  // "Overweight and underperforming": the cohort soaking up the most volume while
  // converting below the overall response rate. That's where to pull spend from.
  const worstArchetype = arch
    .filter(a => a.conf?.sufficient && a.responseRate < overall)
    .sort((a, b) => b.appliedN - a.appliedN)[0] || null;
  return {
    minSample: MIN_SAMPLE,
    pipeline: {
      applied: ctx.pipeline?.applied ?? 0,
      responseRate: ctx.pipeline?.responseRate ?? 0,
      interviewRate: ctx.pipeline?.interviewRate ?? 0,
    },
    recruiter: {
      sent: ctx.recruiters?.sent ?? 0,
      replied: ctx.recruiters?.replied ?? 0,
      responseRate: ctx.recruiters?.responseRate ?? 0,
      conf: ctx.recruiters?.conf ?? null,
    },
    talent: {
      sent: ctx.talent?.sent ?? 0,
      replied: ctx.talent?.replied ?? 0,
      responseRate: ctx.talent?.responseRate ?? 0,
      conf: ctx.talent?.conf ?? null,
    },
    staleTotal: ctx.staleTotal ?? 0,
    // archetypes/sectors arrive pre-sorted by responseRate desc. Only cohorts that
    // clear the sample gate (conf.sufficient, n >= MIN_SAMPLE) are surfaced as a
    // "top" or "worst" claim: a rate off fewer than 10 applications is noise, not a
    // winner, and featuring it is the exact false-confidence this work removes.
    topArchetypes: arch.filter(a => a.conf?.sufficient).slice(0, 3),
    topSectors: sectors.filter(s => s.conf?.sufficient).slice(0, 3),
    worstArchetype,
  };
}

// Stage funnel + rejection-by-stage. Powers the "where do we lose them" view:
// how many apps reached each rung, stage-to-stage conversion, and — for every
// terminal row (Rejected / No Response) — which interview round it exited at.
// Rejection attribution prefers the dated status-event log (the real
// progression), falls back to the [reached:] notes tag, and is otherwise
// "unknown" (hand-edited or pre-rollout, before the event log captured it).
export function stageFunnelStats() {
  const apps = parseApplicationsMd();
  const events = parseStatusEvents();

  const { furthestIdx, idxOf, eventsByApp } = makeFurthestIdx(events);

  const reached = {};
  for (const stage of FUNNEL_ORDER) {
    const si = idxOf(stage);
    // The first rung is membership, not progression: every tracked row was
    // evaluated. See enteredFunnel() in statuses.mjs for why asking
    // `furthestIdx >= Evaluated` here collapsed rung 1 onto rung 2 and printed a
    // 100% first conversion.
    reached[stage] = stage === FUNNEL_ORDER[0]
      ? apps.filter(enteredFunnel).length
      : apps.filter(a => furthestIdx(a) >= si).length;
  }

  const conversion = [];
  for (let k = 0; k < FUNNEL_ORDER.length - 1; k++) {
    const from = FUNNEL_ORDER[k], to = FUNNEL_ORDER[k + 1];
    conversion.push({ from, to, fromN: reached[from], toN: reached[to], rate: reached[from] ? Math.round(reached[to] / reached[from] * 100) : 0 });
  }

  const ivIndex = s => INTERVIEW_STAGES.indexOf(s);

  const rejectedAtStage = {};
  for (const s of INTERVIEW_STAGES) rejectedAtStage[s] = 0;
  let rejectedPreInterview = 0;  // lost before reaching any interview round
  let rejectedUnknownStage = 0;  // terminal but no signal to attribute a stage

  const terminal = apps.filter(a => a.status === 'Rejected' || a.status === 'No Response');
  for (const a of terminal) {
    let furthest = null;
    for (const e of (eventsByApp.get(String(a.id)) || [])) {
      if (isInterviewStage(e.status) && (!furthest || ivIndex(e.status) > ivIndex(furthest))) furthest = e.status;
    }
    if (!furthest) {
      const r = reachedStage(a.notes);
      if (r && isInterviewStage(r)) furthest = r;
    }
    if (furthest) rejectedAtStage[furthest]++;
    else if ((eventsByApp.get(String(a.id)) || []).length || reachedStage(a.notes)) rejectedPreInterview++;
    else rejectedUnknownStage++;
  }

  return {
    funnelOrder: FUNNEL_ORDER,
    interviewStages: INTERVIEW_STAGES,
    reached,
    conversion,
    rejections: {
      byStage: rejectedAtStage,
      preInterview: rejectedPreInterview,
      unknownStage: rejectedUnknownStage,
      total: terminal.length,
    },
    eventsTracked: events.length,
  };
}


export {
  INSIGHTS_DIR, INSIGHTS_LATEST, INSIGHTS_HISTORY_MAX, PROFILE_PATH,
  loadProfileContext, loadPriorInsight, pruneInsightsHistory, buildInsightsContext,
  buildInsightsMetrics,
};


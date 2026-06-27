import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { computeStaleApps, computeStaleTA } from './followups.mjs';
import { parseRecruitersMd } from './recruiters.mjs';
import { parseTargetTalentMd } from './target-talent.mjs';

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

  const activeStatuses = ['Evaluated','Applied','Responded','Interview','Offer'];
  // 'No Response' (ghosted) counts as a real sent application that got no reply,
  // like 'Rejected' — it stays in the denominator but never in respondedSet, so
  // ghosting honestly drags the response rate down instead of vanishing.
  const appliedSet     = ['Applied','Responded','Interview','Offer','Rejected','No Response'];
  const respondedSet   = ['Responded','Interview','Offer'];

  const applied = apps.filter(a => appliedSet.includes(a.status));
  const responded = apps.filter(a => respondedSet.includes(a.status));
  const interview = apps.filter(a => ['Interview','Offer'].includes(a.status));

  // Archetype performance — apply + reply rates by role family
  const archetypes = {};
  for (const a of apps) {
    const k = a.archetype || 'Unknown';
    if (!archetypes[k]) archetypes[k] = { count: 0, applied: 0, responded: 0, scoreSum: 0, scoreN: 0 };
    archetypes[k].count++;
    if (appliedSet.includes(a.status))   archetypes[k].applied++;
    if (respondedSet.includes(a.status)) archetypes[k].responded++;
    if (a.score != null) { archetypes[k].scoreSum += a.score; archetypes[k].scoreN++; }
  }
  const archByPerf = Object.entries(archetypes)
    .map(([k, v]) => ({
      archetype: k,
      n: v.count,
      appliedN: v.applied,
      responseRate: v.applied ? Math.round(v.responded / v.applied * 100) : 0,
      avgScore: v.scoreN ? +(v.scoreSum / v.scoreN).toFixed(2) : null,
    }))
    .sort((a, b) => b.responseRate - a.responseRate);

  // Sector performance — same shape
  const sectors = {};
  for (const a of apps) {
    if (!a.sector) continue;
    if (!sectors[a.sector]) sectors[a.sector] = { count: 0, applied: 0, responded: 0 };
    sectors[a.sector].count++;
    if (appliedSet.includes(a.status))   sectors[a.sector].applied++;
    if (respondedSet.includes(a.status)) sectors[a.sector].responded++;
  }
  const sectorByPerf = Object.entries(sectors)
    .filter(([, v]) => v.applied >= 1)
    .map(([k, v]) => ({
      sector: k,
      n: v.count,
      appliedN: v.applied,
      responseRate: Math.round(v.responded / v.applied * 100),
    }))
    .sort((a, b) => b.responseRate - a.responseRate)
    .slice(0, 10);

  // TA + Recruiter funnel summaries
  const taActive = taContacts.filter(c => c.status !== 'Archived');
  const taSent    = taActive.filter(c => ['Sent','Replied','Meeting Scheduled','Connected'].includes(c.status)).length;
  const taReplied = taActive.filter(c => ['Replied','Meeting Scheduled','Connected'].includes(c.status)).length;
  const recSent    = recruiters.filter(r => ['Sent','Replied','Meeting Scheduled','Connected'].includes(r.status)).length;
  const recReplied = recruiters.filter(r => ['Replied','Meeting Scheduled','Connected'].includes(r.status)).length;

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
      offer: apps.filter(a => a.status === 'Offer').length,
      responseRate: applied.length ? Math.round(responded.length / applied.length * 100) : 0,
      interviewRate: applied.length ? Math.round(interview.length / applied.length * 100) : 0,
    },
    archetypes: archByPerf,
    sectors: sectorByPerf,
    talent:    { total: taActive.length,    sent: taSent,    replied: taReplied,    responseRate: taSent  ? Math.round(taReplied / taSent * 100)  : 0 },
    recruiters: { total: recruiters.length, sent: recSent,   replied: recReplied,   responseRate: recSent ? Math.round(recReplied / recSent * 100) : 0 },
    staleTotal: staleApps.length + staleTA.length,
    topStale,
    pendingHot,
  };
}


export {
  INSIGHTS_DIR, INSIGHTS_LATEST, INSIGHTS_HISTORY_MAX, PROFILE_PATH,
  loadProfileContext, loadPriorInsight, pruneInsightsHistory, buildInsightsContext,
};


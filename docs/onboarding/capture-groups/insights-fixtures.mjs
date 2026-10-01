/**
 * insights-fixtures.mjs: invented data for the Insights tab (Review and Insights
 * sub-tabs). Same Jordan Avery search as the rest of the guide: Northwind, Globex,
 * Contoso and the 30-row tracker in capture-apps.mjs. Every name, address and
 * number here is made up.
 *
 * Numbers are tied to capture-apps.mjs corePayload(): 20 applications, 4 warm
 * (all heard back), 16 cold (7 heard back), email outreach 2 of 10, LinkedIn
 * outreach 4 of 12, 6 unserviced applications, 1 screen held this week.
 */
import { evaluateFloors, FLOORS } from '../../../dashboard-web/server/lib/review-thresholds.mjs';
import { rateStat } from '../../../dashboard-web/server/lib/rate-confidence.mjs';

// ---- Weekly metrics (GET /api/metrics/weekly) --------------------------------
// The week is Sunday 19 July to Saturday 25 July 2026; the browser clock says
// Wednesday 22 July, so the week is in progress: two floors are still below, one
// is on track. That is the honest mid-week picture and shows both colours.
const M = (value, available = true, source = null) => ({ value, available, source });

export function weeklyPayload({ connectsLogged = true } = {}) {
  const metrics = {
    weekStart: '2026-07-19', weekEnd: '2026-07-25',
    verifiedTouches: M(11, true, 'correspondence (email only)'),
    replies: M(4, true, 'correspondence'),
    deliveredReplyRatePct: M(20, true, 'cumulative, contact-based, bounces excluded'),
    screensHeld: M(1, true, 'interview records (held in week)'),
    objectionsLogged: M(1, true, 'debrief notes'),
    linkedinConnects: connectsLogged ? M(31, true, 'linkedin-connects log') : M(0, false, 'not logged (no connects log)'),
    influencerEngagements: M(0, false, 'not logged (no engagement log)'),
    cadencePct: M(82, true, 'cadence log'),
    unservicedApplications: M(6, true, 'applications (Applied, no follow-up)'),
    sourceMix: M({ scanFound: 3, selfSourced: 2, scanFoundAtOrAbove3_3: 2 }, true, 'applications tracker source classification'),
  };
  return {
    weekStart: '2026-07-19', weekEnd: '2026-07-25',
    metrics,
    floors: evaluateFloors(metrics),
    floorValues: {
      verifiedTouches: FLOORS.verifiedTouches.min,
      linkedinConnects: FLOORS.linkedinConnects.min,
      cadencePct: FLOORS.cadencePct.min,
    },
    referralConversion: { available: true, referredApplications: 0, introductions: 0, denominator: 20, percentage: 0 },
  };
}

// ---- Review log (GET /api/review/status) --------------------------------------
// Each logged week is frozen: floors[] holds the numbers as they were at review
// time. The Jun 14 week predates the connects log, so that cell is "not logged"
// and renders as a grey "-" in the Week over week table.
function week(weekStart, weekEnd, touches, connects, cadence) {
  const floors = [
    { key: 'verifiedTouches', value: touches, floor: 13, met: touches >= 13, available: true },
    connects == null
      ? { key: 'linkedinConnects', value: null, floor: 50, met: null, available: false }
      : { key: 'linkedinConnects', value: connects, floor: 50, met: connects >= 50, available: true },
    { key: 'cadencePct', value: cadence, floor: 70, met: cadence >= 70, available: true },
  ];
  return {
    week: weekStart, weekEnd,
    outreachMet: floors[0].met,
    floors,
    metrics: {
      verifiedTouches: { value: touches, available: true },
      linkedinConnects: { value: connects == null ? 0 : connects, available: connects != null },
      cadencePct: { value: cadence, available: true },
    },
  };
}

const LOGGED = [
  week('2026-06-14', '2026-06-20', 4, null, 55),
  week('2026-06-21', '2026-06-27', 8, 22, 64),
  week('2026-06-28', '2026-07-04', 11, 38, 71),
  week('2026-07-05', '2026-07-11', 13, 46, 76),
  week('2026-07-12', '2026-07-18', 15, 54, 78),
];
// What "Run weekly review" appends: this week, frozen mid-week as it stands.
export const RUN_ENTRY = week('2026-07-19', '2026-07-25', 11, 31, 82);

export const STATUS_IDLE = { lock: null, lastReview: LOGGED[LOGGED.length - 1], history: LOGGED };
export const STATUS_RAN = { lock: null, lastReview: RUN_ENTRY, history: [...LOGGED, RUN_ENTRY] };
export const RUN_RESPONSE = { ok: true, weekStart: '2026-07-19', weekEnd: '2026-07-25', lock: null, lastReview: RUN_ENTRY, history: [...LOGGED, RUN_ENTRY] };

// ---- Rolling floor (GET /api/build-floor) -------------------------------------
// Trailing 7 days, Thu 16 Jul to Wed 22 Jul: 15 verified touches against the
// floor of 13. 15 / 13 is 1.15x, under the 1.3x line, so the card says "On pace".
const WINDOW = ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22'];
const PER_DAY = [2, 2, 0, 1, 4, 4, 2];
export const BUILD_FLOOR = {
  floor: 13, windowDays: 7, graceDays: 3,
  today: '2026-07-22', windowStart: '2026-07-16', window: WINDOW,
  perDay: WINDOW.map((day, i) => ({ day, count: PER_DAY[i] })),
  trailingCount: 15, met: true, gap: 0,
  state: 'met', unlocked: true,
  inGrace: false, graceUntil: null,
  reset: { availableThisMonth: true, lastReset: null, monthKey: '2026-07' },
  pto: [],
};

// ---- Debriefs due (GET /api/interview/debriefs/pending) ------------------------
export const DEBRIEFS = { pending: [
  { id: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations', stage: 'Phone Screen' },
  { id: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations', stage: '1st Interview' },
  { id: 405, company: 'Contoso Freight', role: 'Director, Revenue Operations', stage: '1st Interview' },
] };

// ---- Gmail ---------------------------------------------------------------------
const NOW_SYNC = '2026-07-22T15:20:00.000Z';
export const HEALTH = {
  connected: { connected: true, healthy: true, reason: 'ok', configured: true, connectedEmail: 'jordan.avery@example.com', lastCheckedAt: NOW_SYNC, daysSinceCheck: 0 },
  notset: { connected: false, healthy: false, reason: 'not_configured', configured: false, connectedEmail: null, lastCheckedAt: null, daysSinceCheck: null },
  notconnected: { connected: false, healthy: false, reason: 'not_connected', configured: true, connectedEmail: null, lastCheckedAt: null, daysSinceCheck: null },
  expired: { connected: true, healthy: false, reason: 'refresh_failed', configured: true, connectedEmail: 'jordan.avery@example.com', lastCheckedAt: '2026-07-14T15:20:00.000Z', daysSinceCheck: 8 },
};

// Dry-run bounce sweep: two hard bounces would flip a contact, one soft bounce is
// counted and never flipped. The second proposal has no sent history, which is
// what triggers the red "no record you emailed this" warning.
export const SCAN_BOUNCES = {
  dryRun: true, scanned: 14, hardBounces: 2, softBounces: 1, wouldFlip: 2,
  proposed: [
    { source: 'ta', id: 51, key: 'ta:51', address: 'marcus.hale@example.test', name: 'Marcus Hale', company: 'Wayne Logistics', sentHistory: true },
    { source: 'ta', id: 58, key: 'ta:58', address: 'noor.ibrahim@example.test', name: 'Noor Ibrahim', company: 'Cyberdyne Cloud', sentHistory: false },
  ],
};

const rfc = (d) => d; // dates are shown as sent; the reply rows do not print them
export const REPLIES = {
  replies: [
    {
      msgId: 'msg-soylent-1', threadId: 'thr-soylent-1', from: 'dana.whitfield@example.com',
      subject: 'Re: Director, Sales Strategy', date: rfc('Tue, 21 Jul 2026 09:14:00 -0500'),
      sentiment: 'negative',
      contact: { source: 'ta', id: 44, name: 'Dana Whitfield', company: 'Soylent Systems' },
      companyGuess: null,
      snippet: 'Thank you for your patience. We have decided to move forward with other candidates.',
      bodyPreview: 'Thank you for your patience. We have decided to move forward with other candidates.', bodyChars: 92,
      candidateApps: [{ id: 383, role: 'Director, Sales Strategy', status: 'No Response', applyDate: '2026-06-19' }],
      suggestedAppId: 383, handled: null,
    },
    {
      msgId: 'msg-acme-1', threadId: 'thr-acme-1', from: 'priya.natarajan@example.com',
      subject: 'Re: Head of Revenue Operations', date: rfc('Tue, 21 Jul 2026 13:42:00 -0500'),
      sentiment: 'positive',
      contact: { source: 'ta', id: 47, name: 'Priya Natarajan', company: 'Acme Robotics' },
      companyGuess: null,
      snippet: 'Happy to set up a first conversation. Next steps: are you free Thursday afternoon?',
      bodyPreview: 'Happy to set up a first conversation. Next steps: are you free Thursday afternoon?', bodyChars: 88,
      candidateApps: [{ id: 401, role: 'Head of Revenue Operations', status: 'Applied', applyDate: '2026-07-09' }],
      suggestedAppId: 401, handled: null,
    },
    {
      msgId: 'msg-tyrell-1', threadId: 'thr-tyrell-1', from: 'careers@example.com',
      subject: 'Update on your Tyrell Robotics application', date: rfc('Mon, 20 Jul 2026 16:05:00 -0500'),
      sentiment: 'neutral',
      contact: null,
      companyGuess: { company: 'Tyrell Robotics', tier: 'domain' },
      snippet: 'We received your materials and a recruiter will review them this week.',
      bodyPreview: 'We received your materials and a recruiter will review them this week.', bodyChars: 74,
      candidateApps: [{ id: 309, role: 'VP, Sales Operations', status: 'Phone Screen', applyDate: '2026-06-25' }],
      suggestedAppId: 309, handled: null,
    },
    {
      msgId: 'msg-piper-1', threadId: 'thr-piper-1', from: 'lena.fischer@example.com',
      subject: 'Re: Coffee chat?', date: rfc('Sun, 19 Jul 2026 11:30:00 -0500'),
      sentiment: 'neutral',
      contact: { source: 'ta', id: 52, name: 'Lena Fischer', company: 'Pied Piper' },
      companyGuess: null,
      snippet: 'Sure, though we are not hiring for ops right now.',
      bodyPreview: 'Sure, though we are not hiring for ops right now.', bodyChars: 50,
      candidateApps: [], suggestedAppId: null, handled: null,
    },
  ],
  byCompany: [],
  unknown: [
    { msgId: 'msg-unk-1', from: 'noreply@example.test', subject: 'Your weekly digest', date: 'Mon, 20 Jul 2026 07:00:00 -0500', sentiment: 'neutral', contact: null, companyGuess: null, snippet: '', bodyPreview: '', bodyChars: 0 },
    { msgId: 'msg-unk-2', from: 'events@example.test', subject: 'RevOps meetup next week', date: 'Fri, 17 Jul 2026 10:00:00 -0500', sentiment: 'neutral', contact: null, companyGuess: null, snippet: '', bodyPreview: '', bodyChars: 0 },
  ],
  unmatched: 2,
};

export const UNMATCHED = {
  count: 2,
  items: [
    {
      msgId: 'msg-park-1', threadId: 'thr-park-1', from: 'sam.okafor@example.com', subject: 'Following up on our call',
      date: '2026-07-20', company: 'Hooli Systems',
      snippet: 'Great speaking with you. I will loop in the hiring manager and come back with times.',
      parkedOn: '2026-07-21',
      suggestions: [{ id: 300, role: 'Director, Revenue Operations', status: 'Applied', applyDate: '2026-06-17' }],
    },
    {
      msgId: 'msg-park-2', threadId: 'thr-park-2', from: 'ines.moreau@example.com', subject: 'Introduction from a mutual contact',
      date: '2026-07-18', company: 'Initech Cloud',
      snippet: 'A friend suggested we connect about the RevOps opening.',
      parkedOn: '2026-07-19',
      suggestions: [],
    },
  ],
};

// ---- Insights (GET /api/insights/latest) --------------------------------------
// Shape per server/routes/insights.mjs: generated_at, model, pipeline_size,
// stale_count, metrics (buildInsightsMetrics), prior_summary, then the model's
// JSON: coach, whats_working, whats_not, recommended_moves, this_week_focus.
// Rates go through the app's own rateStat() so the sample gate and Wilson band
// are what the product would print. RevOps: 6 of 10 applications reached a
// screen or beyond; every other archetype and every sector is under the
// 10-application gate, so none of them is surfaced as a winner or a laggard.
const revOps = rateStat(6, 10);
const taRate = rateStat(6, 22);

function insightsBase() {
  return {
    model: 'claude-sonnet-4-6',
    metrics: {
      minSample: 10,
      pipeline: { applied: 20, responseRate: 55, interviewRate: 15 },
      talent: { sent: 22, replied: 6, responseRate: 27, conf: taRate, repliedIsFloor: false, archivedTouched: 0 },
      staleTotal: 5,
      topArchetypes: [{ archetype: 'RevOps', n: 12, appliedN: 10, screenRate: 60, conf: revOps, avgScore: 3.85 }],
      topSectors: [],
      worstArchetype: null,
    },
    prior_summary: {
      generated_at: '2026-07-15T14:00:00.000Z',
      coach: {
        win: 'You are applying steadily and the RevOps lane is producing screens.',
        improve: 'Fewer than 10 applications per lane is too few to rate any of them yet, so keep volume going before changing direction.',
      },
      headline: null, summary: null,
    },
    coach: {
      win: "You're converting the RevOps lane: 6 of 10 applications reached a screen, #405 Contoso Freight is at offer, and #412 Northwind Analytics heads into its 2nd Interview on Jul 24.",
      improve: 'Send the overdue first follow-ups on #401 Acme Robotics and #397 Fabrikam Freight today; both have gone six or more days with no touch.',
    },
    whats_working: [
      {
        insight: 'RevOps is your strongest lane: 6 of 10 applications there reached a phone screen or beyond (31 to 83% range), and the two furthest rows, #412 Northwind Analytics and #405 Contoso Freight, are both RevOps.',
        double_down: 'Aim your next batch of applications at RevOps roles and leave the other lanes alone until they reach 10 applied.',
        citations: ['#412 Northwind Analytics', '#405 Contoso Freight', 'RevOps archetype'],
      },
      {
        insight: 'Warm introductions are paying off: all four warm-channel applications heard back, against 7 of 16 cold ones. Four is too few to quote a rate, but #412 Northwind Analytics and #408 Globex Health both started as conversations before you applied.',
        double_down: 'Spend two outreach blocks warming up #391 Umbra Logistics before you decide whether to apply.',
        citations: ['#412 Northwind Analytics', '#408 Globex Health', 'Warm 4 of 4 vs cold 7 of 16'],
      },
      {
        insight: 'LinkedIn is outperforming email for replies: 4 of 12 LinkedIn outreach threads got an answer (33%, 14 to 61% range) against 2 of 10 by email (20%, 6 to 51% range).',
        double_down: 'Open the next three outreach threads on LinkedIn and keep email for follow-ups.',
        citations: ['LinkedIn outreach 4 of 12', 'Email outreach 2 of 10'],
      },
    ],
    whats_not: [
      {
        insight: 'Follow-ups are slipping: three applications and two recruiter contacts are past their next follow-up date, led by #401 Acme Robotics (8 days since your last touch) and #397 Fabrikam Freight (6 days).',
        fix: 'Batch-send the three overdue follow-ups today, starting with #401 Acme Robotics.',
        citations: ['#401 Acme Robotics', '#397 Fabrikam Freight', '#408 Globex Health'],
      },
      {
        insight: 'Strategy and SalesOps applications are not converting yet: 0 of 4 Strategy and 1 of 4 SalesOps reached a screen. Four applications per lane is too few to rate, so this is a pattern to watch, not a verdict.',
        fix: 'Hold new Strategy applications to roles scoring 4.0 or higher until the lane has more history.',
        citations: ['Strategy archetype, 0 of 4', 'SalesOps archetype, 1 of 4', '#383 Soylent Systems'],
      },
      {
        insight: 'Interview debriefs are going unwritten: the Phone Screen and 1st Interview rounds at #412 Northwind Analytics and the 1st Interview at #405 Contoso Freight have no debrief on file, so the objection pattern is invisible.',
        fix: 'Write the three missing debriefs from the Review tab before Friday.',
        citations: ['#412 Northwind Analytics', '#405 Contoso Freight'],
      },
    ],
    recommended_moves: [
      {
        move: 'Send the three overdue follow-ups before noon',
        why: '#401 Acme Robotics, #397 Fabrikam Freight and #408 Globex Health are all past their cadence date, and a first follow-up inside the first week is the cheapest reply you can buy.',
        citations: ['#401 Acme Robotics', '#397 Fabrikam Freight', '#408 Globex Health'],
      },
      {
        move: 'Prepare the 2nd Interview for #412 Northwind Analytics',
        why: 'Jul 24 is the furthest interview on the board, and a first-90-days plan for a new RevOps function will do more for you than one more application this week.',
        citations: ['#412 Northwind Analytics'],
      },
      {
        move: 'Decide on #391 Umbra Logistics, your top Evaluated row',
        why: 'It scores 4.2, above the 4.0 line, and has sat evaluated since Jul 15. Apply or pass so it does not age out.',
        citations: ['#391 Umbra Logistics', '#351 Monsters Energy'],
      },
      {
        move: 'Open two warm conversations a week',
        why: 'Warm applications heard back 4 of 4 versus 7 of 16 cold. Two introductions a week costs about an hour and feeds the strongest channel you have.',
        citations: ['Warm 4 of 4 vs cold 7 of 16'],
      },
    ],
    this_week_focus: [
      { action: 'Send the first follow-up email', target: '#401 Acme Robotics' },
      { action: 'Send the first follow-up email', target: '#397 Fabrikam Freight' },
      { action: 'Send the second follow-up', target: '#408 Globex Health' },
      { action: 'Prepare the panel brief for the 2nd Interview', target: '#412 Northwind Analytics, Jul 24' },
      { action: 'Write the missing 1st Interview debrief', target: '#405 Contoso Freight' },
      { action: 'Decide whether to apply', target: '#391 Umbra Logistics' },
    ],
  };
}

/** A generated analysis, either fresh (2h old, 30 entries) or stale (2d old, 26 entries). */
export function insightsPayload({ stale = false } = {}) {
  return {
    generated_at: stale ? '2026-07-20T14:10:00.000Z' : '2026-07-22T13:05:00.000Z',
    pipeline_size: stale ? 26 : 30,
    stale_count: 5,
    ...insightsBase(),
  };
}

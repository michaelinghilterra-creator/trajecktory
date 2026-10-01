/**
 * shell-fixtures.mjs: invented data for the shell group (app shell, Today, AI Coach).
 *
 * Everything here is made up. Frozen browser clock: Wed 2026-07-22 10:30 CDT.
 * Shapes are copied from the real routes:
 *   cadence       dashboard-web/server/routes/cadence.mjs, lib/cadence.mjs
 *   todos         dashboard-web/server/routes/todos.mjs
 *   calendar      dashboard-web/server/routes/google.mjs (getTodayCalendarEvents)
 *   outcome card  dashboard-web/server/routes/event-actions.mjs (pending-outcome)
 *   search        dashboard-web/server/routes/search.mjs
 *   coach         dashboard-web/server/routes/coach.mjs, lib/coach.mjs
 *   agent jobs    dashboard-web/server/routes/agent.mjs
 */
import { FIXTURES as F } from '../capture-dashboard.mjs';
import { APPS } from '../capture-apps.mjs';

// Today: cadence
// Wednesday = day 3. The weekly template, and today's derived blocks (the
// template rows that run on a Wednesday, plus done / pomodorosDone).
const T = (id, label, days, start, durationMin, pomodoros, order, extra = {}) =>
  ({ id, label, days, start, durationMin, pomodoros, notes: '', order, archived: false, ...extra });

export const CADENCE_TEMPLATE = {
  version: 1,
  tasks: [
    T('t_deepwork',  'Deep work block',         [1, 3, 5], '09:00', 50, 2, 0, { notes: 'Tailor the CV and score new roles. Phone on silent.' }),
    T('t_outreach',  'Applications & outreach', [1, 3, 5], '11:00', 50, 2, 1),
    T('t_prep',      'Interview prep',          [1, 3],    '14:00', 50, 2, 2, { notes: 'Rehearse stories from the story bank.' }),
    T('t_network',   'Networking / LinkedIn',   [2, 4],    '10:00', 25, 1, 3),
    T('t_skill',     'Skill building',          [2, 4],    '14:00', 50, 2, 4),
    T('t_review',    'Weekly review',           [5],       '15:30', 25, 1, 5),
    T('t_evening',   'Evening reading',         [2, 4],    '19:00', 25, 1, 6, { archived: true }),
  ],
};

export const CADENCE_TODAY = [
  { ...CADENCE_TEMPLATE.tasks[0], done: true,  pomodorosDone: 2 },
  { ...CADENCE_TEMPLATE.tasks[1], done: false, pomodorosDone: 1 },
  { ...CADENCE_TEMPLATE.tasks[2], done: false, pomodorosDone: 0 },
];

// last7 is oldest to newest, exactly 7 entries; pct is null only on a rest day.
export const CADENCE_STREAK = {
  current: 4, best: 9,
  last7: [
    { date: '2026-07-16', pct: 100, rest: false },
    { date: '2026-07-17', pct: 100, rest: false },
    { date: '2026-07-18', pct: null, rest: true },
    { date: '2026-07-19', pct: null, rest: true },
    { date: '2026-07-20', pct: 100, rest: false },
    { date: '2026-07-21', pct: 67, rest: false },
    { date: '2026-07-22', pct: 33, rest: false },
  ],
};

// Today: to-dos
// Open: 5. Overdue (not done, due before 2026-07-22): the first two. With the two
// unfinished blocks above, the Today badge reads 2 + 2 = 4.
export const TODOS = { todos: [
  { id: 'd_n2prep', text: 'Prep for the Northwind Analytics 2nd interview', notes: 'Draft three consolidation questions. Re-read the CRM migration section of the report.', done: false, priority: 'high', createdAt: '2026-07-17T14:02:00.000Z', dueDate: '2026-07-21', completedAt: null, order: 0, source: 'app', appId: 412, company: 'Northwind Analytics' },
  { id: 'd_gxthanks', text: 'Send thank-you note to Globex Health', notes: '', done: false, priority: 'med', createdAt: '2026-07-16T09:20:00.000Z', dueDate: '2026-07-15', completedAt: null, order: 1, source: 'app', appId: 408, company: 'Globex Health' },
  { id: 'd_acmefu', text: 'Send the 2nd follow-up to Acme Robotics', notes: '', done: false, priority: 'high', createdAt: '2026-07-20T08:15:00.000Z', dueDate: '2026-07-22', completedAt: null, order: 2, source: 'app', appId: 401, company: 'Acme Robotics' },
  { id: 'd_travel', text: 'Book travel for the Northwind onsite', notes: '', done: false, priority: 'med', createdAt: '2026-07-21T16:40:00.000Z', dueDate: '2026-07-24', completedAt: null, order: 3, source: 'manual', appId: 412, company: 'Northwind Analytics' },
  { id: 'd_portfolio', text: 'Refresh the portfolio case study', notes: '', done: false, priority: 'low', createdAt: '2026-07-15T11:45:00.000Z', dueDate: null, completedAt: null, order: 4, source: 'manual', appId: null, company: null },
  { id: 'd_dana', text: 'Ask Dana for a referral intro', notes: '', done: true, priority: 'med', createdAt: '2026-07-14T08:10:00.000Z', dueDate: null, completedAt: '2026-07-16T17:30:00.000Z', order: 5, source: 'manual', appId: null, company: null },
] };

// Today: Google Calendar card
export const CALENDAR_GRANTED = {
  connected: true, canReadCalendar: true,
  events: [
    { id: 'ev1', title: 'Weekly pipeline review (self)', allDay: false, start: '08:30', end: '09:00', location: '' },
    { id: 'ev2', title: 'Phone screen: Gringotts Capital', allDay: false, start: '13:00', end: '13:45', location: 'Video call' },
    { id: 'ev3', title: 'Coffee chat with Priya Raghunathan', allDay: false, start: '15:30', end: '16:00', location: 'Austin, TX' },
    { id: 'ev4', title: 'Library day: no meetings', allDay: true, start: null, end: null, location: '' },
  ],
};
export const CALENDAR_RECONNECT = {
  connected: true, canReadCalendar: false, needsReconnect: true, needsConnect: false, events: [],
};

// Today: "Did it happen?" card
// appIds are the invented tracker ids in capture-apps.mjs / capture-dashboard.mjs.
export const PENDING_OUTCOME = {
  enabled: true,
  items: [
    { appId: 327, stage: 'Phone Screen', scheduledFor: '2026-07-21', slotEnd: '2026-07-21T20:30:00.000Z', company: 'Gringotts Capital', role: 'Head of Revenue Operations', due: true },
    { appId: 408, stage: '1st Interview', scheduledFor: '2026-07-22', slotEnd: '2026-07-22T14:00:00.000Z', company: 'Globex Health', role: 'Director, GTM Operations', due: true },
    { appId: 412, stage: '2nd Interview', scheduledFor: '2026-07-24', slotEnd: '2026-07-24T19:00:00.000Z', company: 'Northwind Analytics', role: 'VP, Revenue Operations', due: false },
  ],
};

// Topbar: universal search
// Same matching rule as routes/search.mjs: every whitespace term must appear.
export function searchResponse(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const match = (...fields) => {
    const hay = fields.filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  };
  const people = [];
  for (const r of F.TARGET_TALENT) {
    const name = `${r.first} ${r.last}`.trim();
    if (match(name, r.company, r.title)) people.push({ type: 'ta', id: r.id, name, company: r.company, subtitle: r.title });
  }
  for (const r of F.REFERRALS.referrals) {
    if (match(r.name, r.where, r.target, r.how)) {
      people.push({ type: 'referral', id: r.id, name: r.name, company: r.where, subtitle: [r.target ? `target: ${r.target}` : r.how, 'referral'].filter(Boolean).join(' · ') });
    }
  }
  const companies = [];
  for (const a of APPS) {
    if (match(a.company, a.role)) companies.push({ type: 'company', id: a.id, name: a.role || a.company, company: a.company, subtitle: a.status });
  }
  return { q, people: people.slice(0, 12), companies: companies.slice(0, 12) };
}

// Update banner
export const UPDATE_AVAILABLE = {
  status: 'update-available', local: '5.5.6', remote: '5.6.0', requiresReinstall: false,
  releaseNotes: {
    sections: [
      { heading: 'New', items: [
        { type: 'bullet', text: 'Example release note: a small improvement to a tab.' },
        { type: 'bullet', text: 'Example release note: a clearer label on a button.' },
      ] },
      { heading: 'Fixed', items: [
        { type: 'bullet', text: 'Example release note: a fix for a display glitch.' },
      ] },
    ],
  },
};

// Sidebar Workflow panel
export const NEEDS_MANUAL = { items: [
  { url: 'https://jobs.example.com/hooli-systems-sr-director-gtm', company: 'Hooli Systems', role: 'Sr. Director, GTM Strategy' },
  { url: 'https://jobs.example.com/oscorp-health-head-analytics', company: 'Oscorp Health', role: 'Head of GTM Analytics' },
] };

const NOW_MS = Date.parse('2026-07-22T10:30:00-05:00');
// A rolling Evaluate chain mid-run: 7 evaluated across batch 1 and the live batch 2, 5 still queued.
export const EVAL_RUNNING = {
  jobId: 'job_eval_demo', mode: 'pipeline', status: 'running',
  startedAt: NOW_MS - (7 * 60 + 12) * 1000,
  evaluationsDone: 2, progressTotal: 5, rolling: true,
  rollTotal: 5, rollBatches: 2, rollCap: 15, rollPending: 5, rollCost: 0, billedTo: 'plan',
  activity: 'Write reports/431-tyrell-robotics-2026-07-22.md',
  toolCount: 31, output: '',
};
export const SCAN_RUNNING = {
  jobId: 'job_scan_demo', mode: 'scan', status: 'running',
  startedAt: NOW_MS - 95 * 1000,
  activity: 'WebSearch: revenue operations director remote', toolCount: 9, webSearchCount: 6, output: '',
};
export const EVAL_FINISHED = {
  jobId: 'job_eval_done', mode: 'pipeline', status: 'done',
  startedAt: NOW_MS - 40 * 60 * 1000, finishedAt: NOW_MS - 5 * 60 * 1000,
  evaluationsDone: 2, progressTotal: 5, rolling: false,
  rollTotal: 12, rollBatches: 3, rollCap: 15, rollPending: 0, rollEndReason: 'drained', rollCost: 0, billedTo: 'plan',
  output: '',
};

// AI Coach
export const COACH_BRIEF = F.COACH_BRIEF;
export const COACH_HISTORY = { messages: [
  { id: 'c1', role: 'user', text: 'What should I do today?', ts: '2026-07-21T15:02:00.000Z' },
  { id: 'c2', role: 'coach', text: 'Good morning. Two things matter most today. First, your Acme Robotics follow-up is overdue, so send it from Network, then Follow-ups. Second, your Northwind 2nd interview is on Friday, so block time for prep. Everything else can wait.', ts: '2026-07-21T15:02:14.000Z' },
  { id: 'c3', role: 'user', text: 'I have two roles at second-round stage. Which should I put more energy into this week?', ts: '2026-07-21T15:31:00.000Z' },
  { id: 'c4', role: 'coach', text: 'Northwind is the stronger bet: it scored 4.6, the comp clears your target, and you are already at a second interview with the CRO. Globex is a fit but earlier (phone screen) and hybrid. Put the prep hours into Northwind, and keep Globex warm with a short follow-up.', ts: '2026-07-21T15:31:12.000Z' },
  { id: 'c5', role: 'user', text: 'Fair. What is the one thing to nail in the Northwind round?', ts: '2026-07-21T15:33:00.000Z' },
  { id: 'c6', role: 'coach', text: 'Consolidation. Their whole reason for the role is three CRM instances after two acquisitions. Lead with the carrier-scorecard rebuild and frame it as consolidation, not analytics. Open Interview, then the Northwind prep, to see the questions to ask.', ts: '2026-07-21T15:33:18.000Z' },
  { id: 'c7', role: 'user', text: 'How do I reach out to someone on LinkedIn?', ts: '2026-07-22T14:05:00.000Z' },
  { id: 'c8', role: 'coach', text: 'Open Network, find the person, and ask for a draft. You review it and send it yourself from LinkedIn. Nothing goes out automatically.', ts: '2026-07-22T14:05:09.000Z' },
] };

// What the Coach returns when someone reports an outcome: prose plus ONE proposed action.
export const COACH_REPLY_WITH_ACTION = {
  reply: {
    id: 'c9',
    text: 'Sorry to hear that, and thanks for telling me. Fabrikam scored 3.6, the lowest of your active roles, so this frees your time for Northwind and Globex. I can log it for you:',
    action: { kind: 'logOutcome', appId: 397, status: 'Rejected', company: 'Fabrikam Freight', label: 'Mark Fabrikam Freight as Rejected' },
    ts: '2026-07-22T15:31:00.000Z',
  },
};

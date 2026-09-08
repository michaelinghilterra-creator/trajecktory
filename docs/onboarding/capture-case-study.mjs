#!/usr/bin/env node
/**
 * Capture the complete trajecktory case-study screenshot set.
 *
 * Prerequisite: run the dashboard at TRAJECKTORY_URL or http://localhost:3333.
 * All data-bearing routes used below are synthetic so screenshots stay PII-safe.
 */
import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { installMocks, setMode, clickNav, BASE } from './capture-dashboard.mjs';

const OUT = process.env.CASE_STUDY_OUT || path.join(os.homedir(), 'Desktop', 'trajecktory-case-study', 'screenshots');
const WAIT_MS = 700;

const SEARCH_RESULTS = { results: [
  { type: 'role', label: 'Northwind Analytics: VP, Revenue Operations', id: 412, score: 4.6 },
  { type: 'role', label: 'Globex Health: Director, GTM Operations', id: 408, score: 4.1 },
  { type: 'person', label: 'Alex Kim, Northwind Analytics', id: 1 },
  { type: 'destination', label: 'Pipeline Overview', path: '/' },
  { type: 'destination', label: 'AI Coach', path: '/' },
] };

const UPDATE_AVAILABLE = {
  status: 'update-available', current: '2.11.0', latest: '2.12.0',
  changelog: 'Workflow Runner, Debrief modal, Follow-up queue redesign.',
};

const PIPELINE_INBOX = {
  pending: [
    { url: 'https://jobs.example.com/nr-1', company: 'Apex Dynamics', role: 'Director, Revenue Operations', addedDate: '2026-07-18', source: 'API Scan', status: 'pending' },
    { url: 'https://jobs.example.com/nr-2', company: 'Pinnacle Health', role: 'VP, GTM Systems', addedDate: '2026-07-17', source: 'Agent Scan', status: 'pending' },
    { url: 'https://jobs.example.com/nr-3', company: 'Meridian Tech', role: 'Head of Sales Operations', addedDate: '2026-07-16', source: 'API Scan', status: 'pending' },
  ],
  gated: [
    { url: 'https://jobs.example.com/dead-1', company: 'Legacy Corp', role: 'RevOps Manager', addedDate: '2026-07-10', source: 'API Scan', status: 'dead', reason: 'Posting expired (404)' },
    { url: 'https://jobs.example.com/dead-2', company: 'Sunset Inc', role: 'Sales Ops Lead', addedDate: '2026-07-08', source: 'Agent Scan', status: 'duplicate', reason: 'Duplicate of #412' },
  ],
  evaluating: [],
};

const AGENT_LIVENESS = {
  mode: 'liveness', jobId: 'job-lv-001', status: 'running',
  progress: { done: 3, total: 8, current: 'Checking Acme Robotics' },
  startedAt: '2026-07-20T15:00:00.000Z',
};

const AGENT_EVALUATING = {
  mode: 'evaluate', jobId: 'job-ev-001', status: 'running',
  progress: { done: 1, total: 3, current: 'Evaluating Apex Dynamics' },
};

const FOLLOWUPS_BASE = {
  thresholds: { Applied: 7, 'Phone Screen': 3, '1st Interview': 3, '2nd Interview': 3, '3rd Interview': 3 },
  taThreshold: 14,
  ghostDays: 45,
  warm: [
    { id: 401, source: 'ta', company: 'Acme Robotics', taFirst: 'Tomas', taLast: 'Brandt', role: 'Head of Talent', score: 4.3, status: 'Sent', daysSinceLastTouch: 18, coachVerdict: '18 business days since the last note. Follow up now.', coachLevel: 'overdue' },
    { id: 408, source: 'ta', company: 'Globex Health', taFirst: 'Rosa', taLast: 'Delgado', role: 'Senior Technical Recruiter', score: 4.1, status: 'Replied', daysSinceLastTouch: 9, coachVerdict: 'The thread is warm. Close the loop this week.', coachLevel: 'overdue' },
  ],
  cold: [
    { id: 397, source: 'app', company: 'Fabrikam Freight', role: 'Manager, Sales Operations', score: 3.6, status: 'Applied', applyDate: '2026-07-11', lastTouchDate: '2026-07-11', daysSinceLastTouch: 6, daysSinceApply: 6, fuCount: 0, cap: 3, coachVerdict: '6d since application sent. 1st follow-up is overdue.', coachLevel: 'overdue', channel: 'none', muted: false, klass: 'cold', followups: [] },
  ],
  contactFollowups: [
    { id: 1, source: 'ta', company: 'Northwind Analytics', taFirst: 'Alex', taLast: 'Kim', role: 'Talent Acquisition Lead', status: 'Replied', score: 4.6, daysSinceLastTouch: 8, coachVerdict: 'Eight business days quiet after a reply. Send the short nudge.', coachLevel: 'overdue' },
    { id: 2, source: 'ta', company: 'Globex Health', taFirst: 'Rosa', taLast: 'Delgado', role: 'Senior Technical Recruiter', status: 'Sent', score: 4.1, daysSinceLastTouch: 16, coachVerdict: 'This thread is aging. Follow up today.', coachLevel: 'overdue' },
  ],
  actionableCount: 2,
  contactlessApps: [
    { id: 405, company: 'Contoso Freight', role: 'Director, Revenue Operations', status: 'Applied', applyDate: '2026-07-08' },
  ],
  unthreadedApps: [
    { id: 401, company: 'Acme Robotics', role: 'Head of Revenue Operations', status: 'Applied', applyDate: '2026-07-09', contactCount: 1, topTier: 'ta' },
  ],
  snoozed: [],
  snoozedContactFollowups: [],
  ghostedCandidates: [],
};

const SNOOZED = [
  { id: 383, company: 'Soylent Systems', role: 'Director, Sales Strategy', score: 3.9, status: 'No Response', snoozeUntil: '2026-07-25', reason: 'Recruiter on vacation' },
];

const PENDING_ACCEPTANCES = { pending: [
  { id: 2, name: 'Rosa Delgado', company: 'Globex Health', connectedOn: '2026-07-19' },
] };

const MERGE_SUGGESTIONS = { suggestions: [
  { a: 'ta:1', b: 'referral:4', left: { name: 'Alex Kim', store: 'TA Outreach', company: 'Northwind Analytics' }, right: { name: 'Alex Kim', store: 'Referrals', company: 'Northwind Analytics' } },
] };

const BUFFER_CHANNELS = [{ id: 'ch1', service: 'linkedin', name: 'Jordan Avery', default: true }];
const BUFFER_QUEUE = { queue: [
  { id: 'p1', text: 'Most job searches die in the follow-up...', channel: 'linkedin', scheduledFor: '2026-07-21T09:00:00.000Z', status: 'scheduled' },
] };

const POSTS_WITH_METRICS = {
  activity: [{ date: '2026-07-16', type: 'published', postId: 'p1', channel: 'linkedin' }],
  posts: [
    { id: 'p1', source: 'claude', lane: 'professional', channel: 'linkedin', status: 'published', title: '', type: 'text', linkComment: '', text: 'Most job searches die in the follow-up, not the application...', metrics: { impressions: 2847, likes: 43, comments: 12, reposts: 8 } },
    { id: 'p2', source: 'user', lane: 'trajecktory', channel: 'x', status: 'published', title: '', type: 'text', linkComment: '', text: 'Spent the morning turning three CRM instances into one story...', metrics: { impressions: 1203, likes: 18, comments: 5, reposts: 3 } },
    { id: 'p3', source: 'claude', lane: 'professional', channel: 'linkedin', status: 'draft', title: '', type: 'text', linkComment: 'Happy to share the template.', text: 'A carrier scorecard is only useful if the planners who live under it own it...', metrics: {} },
  ],
};

const INFLUENCER_RESPONSES = {
  response: { text: 'Great point on pipeline hygiene. We found the same thing after consolidating our CRM: the forecast only got trustworthy when we stopped treating stage definitions as suggestions.' },
  connect: { text: 'Hi Priya, I have been following your forecast discipline posts. I am working on a similar problem and your perspective matches what I have seen. Would love to connect.' },
  reply: { text: 'Thanks for the response. The adoption curve was the hardest part for us too. What worked was having the planners own the scorecard rather than my team reporting it.' },
};

const RUNSHEET = {
  schema: 'runsheet-v1', company: 'Northwind Analytics', role: 'VP, Revenue Operations',
  round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen',
  openingCue: { label: 'Say first', answer: 'Ten years turning scattered revenue data into a picture an operations team will act on.' },
  cues: [
    { id: 'c1', label: 'Why this role?', tag: 'motivation', answer: 'The scope stopped growing once the systems work was done. I want the version of this problem that is still open.' },
    { id: 'c2', label: 'Consolidation experience', tag: 'technical', answer: 'Merged two Salesforce orgs after an acquisition. Froze schema changes, migrated in three waves. No reporting downtime.' },
    { id: 'c3', label: 'Team management', tag: 'leadership', answer: 'Led four directly plus two contractors. The scorecard rollout touched thirty people.' },
    { id: 'c4', label: 'Forecast accuracy', tag: 'technical', answer: 'Rebuilt stage definitions WITH the reps. Variance fell from 30% to under 8%.' },
  ],
  panic: { label: 'If stuck', items: ['Breathe. You know this material.', 'Return to the consolidation story.', 'Ask them what 90-day success looks like.'] },
  collisions: [{ cueId: 'c2', warn: 'This story overlaps with the hero section. Use the short version.' }],
};

const INTERVIEW_SESSIONS = {
  active: [
    {
      id: 'northwind-analytics', company: 'Northwind Analytics', role: 'VP, Revenue Operations', status: '2nd Interview', round: 2, appId: 412,
      rounds: [
        { round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen', prepPath: 'interview-prep/northwind-round-1.md', runPath: 'interview-prep/northwind-round-1.run.md', hasBoard: true },
        { round: 2, stage: '2nd Interview', descriptor: 'hiring-manager', prepPath: 'interview-prep/northwind-round-2.md', runPath: null, hasBoard: false },
      ],
      docs: [],
    },
    {
      id: 'globex-health', company: 'Globex Health', role: 'Director, GTM Operations', status: 'Phone Screen', round: 1, appId: 408,
      needsPrep: true, rounds: [], docs: [],
    },
  ],
  archive: [],
};

const INSIGHTS = {
  generated_at: '2026-07-20T10:00:00.000Z', version: 1,
  summary: 'Your search is producing meaningful movement. Two roles reached interview stage in three weeks.',
  win: { title: 'Interview velocity', detail: 'Applied to 2nd Interview at Northwind in 13 days (typical is 21).', confidence: 'high', n: 2 },
  improvement: { title: 'Follow-up consistency', detail: 'Two applications 8+ days without a follow-up.', confidence: 'high', n: 2 },
  working: [
    { title: 'RevOps targeting', detail: 'RevOps roles convert at 75% to phone screen vs 33% for SalesOps.', confidence: 'high', n: 8, citations: [412, 408, 405] },
    { title: 'Remote-first filtering', detail: 'All three interview-stage roles are remote.', confidence: 'medium', n: 5 },
  ],
  notWorking: [
    { title: 'Cold outreach response', detail: 'Zero responses from cold outreach. Warm channel drives all replies.', confidence: 'medium', n: 4, guard: 'Small sample (4 touches). May resolve with volume.' },
  ],
  moves: [
    { title: 'Shift to warm channels', detail: 'Pause cold volume, reallocate to referral asks and LinkedIn engagement. Warm reply rate is 4x cold.', priority: 'high', citations: [412, 405] },
    { title: 'Add follow-up cadence check', detail: 'Overdue follow-ups slipped because no block is scheduled. Add a 10-minute check Wednesday.', priority: 'medium' },
  ],
  previousSummary: 'Last week: 3 new applications, 2 phone screens booked, follow-up cadence 67%.',
  checklist: [
    { label: 'Send overdue Acme follow-up', done: false },
    { label: 'Prep for Northwind 2nd round', done: false },
    { label: 'Review Globex comp band', done: true },
    { label: 'Log weekly activity report', done: true },
  ],
};

const INSIGHTS_COMPAT = {
  ...INSIGHTS,
  pipeline_size: 10,
  coach: { win: INSIGHTS.win.detail, improve: INSIGHTS.improvement.detail },
  prior_summary: { generated_at: '2026-07-13T10:00:00.000Z', summary: INSIGHTS.previousSummary },
  this_week_focus: INSIGHTS.checklist.map(item => ({ action: item.label })),
  whats_working: INSIGHTS.working.map(item => ({ insight: item.detail, double_down: item.title, citations: item.citations || [] })),
  whats_not: INSIGHTS.notWorking.map(item => ({ insight: item.detail, fix: item.guard, citations: item.citations || [] })),
  recommended_moves: INSIGHTS.moves.map(item => ({ move: item.title, why: item.detail, citations: item.citations || [] })),
};

const GOOGLE_CALENDAR = { events: [
  { id: 'e1', summary: 'Northwind Analytics: 2nd Interview', start: '2026-07-21T14:00:00Z', end: '2026-07-21T15:00:00Z', location: 'Zoom' },
  { id: 'e2', summary: 'Coffee with Marcus Ellery', start: '2026-07-21T16:30:00Z', end: '2026-07-21T17:00:00Z', location: 'Houndstooth Coffee' },
] };

const CUSTOMIZE = {
  configured: 7,
  total: 11,
  sections: [
    { group: 'Scoring priorities', status: 'configured', files: ['config/profile.yml'], desc: 'Fit-led weights' },
    { group: 'Outreach stakeholders', status: 'pending', files: ['templates/outreach-sequences.json'], desc: 'Who you reach out to' },
    { group: 'Voice & framing', status: 'configured', files: ['modes/_profile.md'], desc: 'Tone and prohibited phrases' },
    { group: 'Narrative & branding', status: 'configured', files: ['config/profile.yml'], desc: 'Headline and superpowers' },
    { group: 'Exit narrative', status: 'pending', files: ['modes/_profile.md'], desc: 'Framing for gaps and pivots' },
    { group: 'Story bank', status: 'configured', files: ['interview-prep/story-bank.md'], desc: '5 STAR+R stories' },
    { group: 'Search queries', status: 'configured', files: ['portals.yml'], desc: 'Targeted RevOps queries' },
    { group: 'Geo pre-filter', status: 'configured', files: ['portals.yml'], desc: 'Austin, 50mi, remote-first' },
    { group: 'Social strategy', status: 'pending', files: ['modes/_profile.md'], desc: 'LinkedIn positioning' },
    { group: 'Outreach cadence', status: 'configured', files: ['config/profile.yml'], desc: '3-day spacing, 6 per 30d' },
    { group: 'Article digest', status: 'pending', files: ['article-digest.md'], desc: 'Published proof points' },
  ],
};

const CHANGELOG = {
  version: '2.12.0',
  entries: [
    { version: '2.12.0', date: '2026-07-18', title: 'Workflow Runner + Debrief', notes: ['Workflow Runner with live progress', 'Interview Debrief modal', 'Follow-up queue redesign'] },
    { version: '2.11.0', date: '2026-07-10', title: 'AI Coach + Social', notes: ['AI Coach with action confirmation', 'Buffer integration', 'Referral tracking'] },
  ],
};

const ACTIVITY_TRACKER = {
  weeks: [
    { weekStart: '2026-07-14', weekEnd: '2026-07-20', applications: 3, followUps: 5, interviews: 2, connects: 12, posts: 1, totalActions: 23 },
    { weekStart: '2026-07-07', weekEnd: '2026-07-13', applications: 4, followUps: 3, interviews: 1, connects: 8, posts: 2, totalActions: 18 },
  ],
  employers: [
    { company: 'Northwind Analytics', applied: '2026-07-02', status: '2nd Interview', enriched: true },
    { company: 'Globex Health', applied: '2026-07-06', status: 'Phone Screen', enriched: true },
  ],
};

const COACH_MESSAGES = [
  { id: 'c1', role: 'user', text: 'Which role deserves the most prep time this week?', ts: '2026-07-20T15:31:00.000Z' },
  { id: 'c2', role: 'coach', text: 'Northwind is the strongest bet. Lead with the CRM consolidation story and keep Globex warm.', ts: '2026-07-20T15:31:12.000Z' },
];

const COACH_ACTION = {
  id: 'c3', role: 'coach',
  text: 'I can add a Wednesday follow-up block to keep the two overdue roles from slipping.',
  action: { type: 'todo.add', label: 'Add follow-up block', payload: { text: 'Send overdue follow-ups', dueDate: '2026-07-22' } },
  ts: '2026-07-20T15:33:18.000Z',
};

const TA_DETAIL = {
  id: 1, company: 'Northwind Analytics', first: 'Alex', last: 'Kim', salute: 'Alex', title: 'Talent Acquisition Lead',
  city: 'Austin', state: 'TX', phone: '(555) 010-1188', email: 'alex.kim@example.com', emailState: 'valid',
  linkedin: 'https://example.com/in/alex-kim', website: 'https://example.com', status: 'Replied', linkedinStatus: 'Connected', influenceTier: 'ta',
  notes: 'Owns the VP Revenue Operations search.',
  relatedApps: [{ id: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations', score: 4.6, status: '2nd Interview' }],
  correspondence: [
    { date: '2026-07-14', direction: 'Received', channel: 'Email', subject: 'Next round', body: 'The CRO would like to continue the conversation.' },
    { date: '2026-07-12', direction: 'Sent', channel: 'Email', subject: 'Thank you', body: 'Thank you for the clear overview of the role.' },
  ],
};

const REFERRAL_DETAIL = {
  referral: { id: 1, name: 'Priya Raghunathan', how: 'Former colleague at a logistics startup', where: 'Northwind Analytics, Director of Sales', target: 'Northwind Analytics', status: 'Asked', lastTouch: '2026-07-15', notes: 'Offered to flag my application to the CRO.', email: 'priya@example.com', linkedin: 'https://example.com/in/priya' },
  relatedApps: [{ id: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations', score: 4.6, status: '2nd Interview' }],
  correspondence: [{ date: '2026-07-15', direction: 'Received', channel: 'LinkedIn', subject: '', body: 'Happy to make the introduction.' }],
  timeline: [],
};

const RECONCILE_PREVIEW = {
  companiesNeedingContacts: [{ company: 'Globex Health', role: 'Director, GTM Operations', appId: 408 }],
  companiesNeedingPrincipal: [{ company: 'Acme Robotics', role: 'Head of Revenue Operations', appId: 401 }],
  toArchive: [{ id: 9, first: 'Morgan', last: 'Lee', company: 'Legacy Corp', reason: 'Company no longer active' }],
  contacts: [], counts: { active: 4, gaps: 1, archive: 1 },
};

const WEEKLY_BEHIND = {
  weekStart: '2026-07-20', weekEnd: '2026-07-26',
  metrics: {
    verifiedTouches: { value: 4, available: true, source: 'outreach log' },
    replies: { value: 1, available: true, source: 'correspondence' },
    deliveredReplyRatePct: { value: 12, available: true, source: 'cumulative' },
    screensBooked: { value: 0, available: true, source: 'status events' },
    objectionsLogged: { value: 0, available: true, source: 'debrief notes' },
    linkedinConnects: { value: 18, available: true, source: 'connects log' },
    cadencePct: { value: 48, available: true, source: 'cadence log' },
    unservicedApplications: { value: 8, available: true, source: 'applications' },
  },
  floors: {
    results: [
      { key: 'verifiedTouches', label: 'Verified touches sent', value: 4, floor: 13, unit: '', met: false, available: true },
      { key: 'linkedinConnects', label: 'LinkedIn connects sent', value: 18, floor: 50, unit: '', met: false, available: true },
      { key: 'cadencePct', label: 'Cadence adherence', value: 48, floor: 70, unit: '%', met: false, available: true },
    ],
    missed: [
      { key: 'verifiedTouches', label: 'Verified touches sent', value: 4, floor: 13, gap: 9 },
      { key: 'linkedinConnects', label: 'LinkedIn connects sent', value: 18, floor: 50, gap: 32 },
    ],
    notLogged: [], allMet: false,
  },
};

const RUNSHEET_COMPAT = {
  ...RUNSHEET,
  data: {
    schema: 'runsheet-v1', company: RUNSHEET.company, role: RUNSHEET.role, round: RUNSHEET.round,
    opening: { cue: RUNSHEET.openingCue.label, answer: 'opening' },
    sections: [
      { id: 'main', label: 'Core cues', cues: RUNSHEET.cues.map(c => ({ cue: c.label, answer: c.id, tag: c.tag })) },
      { id: 'panic', label: RUNSHEET.panic.label, panic: true, cues: RUNSHEET.panic.items.map((item, i) => ({ cue: item, answer: `panic${i + 1}`, tag: 'reset' })) },
    ],
    answers: {
      opening: { title: RUNSHEET.openingCue.label, text: RUNSHEET.openingCue.answer, hero: true, story: 1 },
      ...Object.fromEntries(RUNSHEET.cues.map((c, i) => [c.id, { title: c.label, text: c.answer, story: i === 1 ? 1 : i + 2 }])),
      ...Object.fromEntries(RUNSHEET.panic.items.map((item, i) => [`panic${i + 1}`, { title: `Reset ${i + 1}`, text: item }])),
    },
  },
  warnings: RUNSHEET.collisions.map(c => c.warn), problems: [], collidingKeys: ['c2'], heroKey: 'opening', cues: [],
};

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function main() {
  mkdirSync(OUT, { recursive: true });
  setMode({ dataMode: 'populated', stateMode: 'started', showTriage: false });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);

  let updateMode = 'up-to-date';
  let agentMode = 'idle';
  let followupMode = 'base';
  let coachMode = 'default';
  let googleMode = 'disconnected';
  let bufferMode = 'disconnected';
  let postMode = 'base';
  let insightMode = false;
  let weeklyMode = 'on-pace';

  await installMocks(page);

  // Extra routes are registered after installMocks so these stateful fixtures win.
  await page.route('**/api/archetypes', route => json(route, ['RevOps', 'SalesOps', 'Analytics', 'Strategy']));
  await page.route('**/api/search**', route => json(route, SEARCH_RESULTS));
  await page.route('**/api/system/update-check', route => json(route, updateMode === 'available' ? UPDATE_AVAILABLE : { status: 'up-to-date' }));
  await page.route('**/api/pipeline/inbox', route => json(route, PIPELINE_INBOX));
  await page.route('**/api/agent/active', route => json(route, agentMode === 'liveness' ? AGENT_LIVENESS : agentMode === 'evaluate' ? AGENT_EVALUATING : {}));
  await page.route('**/api/coach/history', route => json(route, { messages: coachMode === 'pending' ? [...COACH_MESSAGES, COACH_ACTION] : COACH_MESSAGES }));
  await page.route('**/api/referrals/pending-acceptances', route => json(route, followupMode === 'accepted' ? PENDING_ACCEPTANCES : { pending: [] }));
  await page.route('**/api/people/suggestions', route => json(route, followupMode === 'merge' ? MERGE_SUGGESTIONS : { suggestions: [] }));
  await page.route('**/api/followups/stale', route => {
    const data = structuredClone(FOLLOWUPS_BASE);
    if (followupMode === 'snoozed') {
      data.snoozed = SNOOZED;
      data.snoozedContactFollowups = SNOOZED.map(x => ({ ...x, source: 'ta', daysSinceLastTouch: 12 }));
    }
    return json(route, data);
  });
  await page.route('**/api/buffer/status', route => json(route, bufferMode === 'connected' ? { connected: true, user: 'jordan.avery' } : { connected: false }));
  await page.route('**/api/buffer/channels', route => json(route, bufferMode === 'connected' ? BUFFER_CHANNELS : []));
  await page.route('**/api/posts/queue', route => json(route, bufferMode === 'connected' ? BUFFER_QUEUE : { queue: [] }));
  await page.route('**/api/posts', route => json(route, postMode === 'metrics' ? POSTS_WITH_METRICS : {
    activity: [], posts: POSTS_WITH_METRICS.posts.map((p, i) => ({ ...p, status: i === 0 ? 'queued' : 'draft', scheduledFor: i === 0 ? '2026-07-21T09:00:00.000Z' : null, metrics: {} })),
  }));
  await page.route('**/api/posts/push-to-buffer', async route => {
    const req = route.request();
    let dryRun = false;
    try { dryRun = !!JSON.parse(req.postData() || '{}').dryRun; } catch {}
    return json(route, { dryRun, results: [
      { id: 'p1', status: dryRun ? 'preview' : 'scheduled', channel: 'linkedin', scheduledFor: '2026-07-21T09:00:00.000Z' },
      { id: 'p2', status: 'deduplicated', channel: 'x', reason: 'Already in Buffer' },
    ] });
  });
  await page.route('**/api/linkedin-ssi/generate-response', route => json(route, INFLUENCER_RESPONSES.response));
  await page.route('**/api/linkedin-ssi/generate-connect-request', route => json(route, INFLUENCER_RESPONSES.connect));
  await page.route('**/api/linkedin-ssi/generate-reply', route => json(route, INFLUENCER_RESPONSES.reply));
  await page.route('**/api/interview/sessions', route => json(route, INTERVIEW_SESSIONS));
  await page.route('**/api/interview/runsheet/**', route => json(route, RUNSHEET_COMPAT));
  await page.route('**/api/insights/latest', route => json(route, insightMode ? INSIGHTS_COMPAT : { generated_at: null }));
  await page.route('**/api/google/**', route => json(route, { ok: true }));
  await page.route('**/api/google/health', route => json(route, googleMode === 'connected'
    ? { connected: true, healthy: true, configured: true, connectedEmail: 'jordan.avery@example.com', reason: 'ok' }
    : { connected: false, healthy: false, configured: false, connectedEmail: null, reason: 'not_configured' }));
  await page.route('**/api/google/status', route => json(route, googleMode === 'connected'
    ? { configured: true, connected: true, connectedEmail: 'jordan.avery@example.com', scopes: ['gmail.readonly', 'gmail.compose', 'calendar.readonly'], canReadMail: true, canDraft: true, canReadCalendar: true, expired: false }
    : { configured: false, connected: false, scopes: [], canReadMail: false, canDraft: false, canReadCalendar: false, expired: false }));
  await page.route('**/api/google/calendar/today', route => json(route, googleMode === 'connected' ? GOOGLE_CALENDAR : { events: [] }));
  await page.route('**/api/google/replies**', route => json(route, googleMode === 'connected' ? {
    replies: [
      { msgId: 'm1', from: 'Alex Kim <alex.kim@example.com>', subject: 'Re: VP, Revenue Operations', date: '2026-07-15', sentiment: 'positive', contact: { name: 'Alex Kim', email: 'alex.kim@example.com' }, candidateApps: [{ id: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations' }], handled: null },
      { msgId: 'm2', from: 'Rosa Delgado <rosa.delgado@example.com>', subject: 'Re: Director, GTM Operations', date: '2026-07-13', sentiment: 'neutral', contact: { name: 'Rosa Delgado', email: 'rosa.delgado@example.com' }, candidateApps: [{ id: 408, company: 'Globex Health', role: 'Director, GTM Operations' }], handled: null },
    ], byCompany: [], unknown: [], unmatched: 0,
  } : { replies: [], byCompany: [], unknown: [], unmatched: 0 }));
  await page.route('**/api/google/scan-bounces', route => json(route, googleMode === 'connected'
    ? { dryRun: true, scanned: 14, hardBounces: 2, softBounces: 1, wouldFlip: 2, proposed: [
      { email: 'old-address@example.com', contact: 'Legacy Recruiter', kind: 'hard', action: 'mark invalid' },
      { email: 'temp-failure@example.com', contact: 'Morgan Lee', kind: 'soft', action: 'review' },
    ] }
    : { dryRun: true, scanned: 0, hardBounces: 0, softBounces: 0, wouldFlip: 0, proposed: [] }));
  await page.route('**/api/setup/customize', route => json(route, CUSTOMIZE));
  await page.route('**/api/setup/changelog', route => json(route, CHANGELOG));
  await page.route('**/api/setup/twc', route => json(route, ACTIVITY_TRACKER));
  await page.route('**/api/metrics/weekly', route => weeklyMode === 'behind' ? json(route, WEEKLY_BEHIND) : route.fallback());
  await page.route('**/api/target-talent/by-company/**', route => json(route, [TA_DETAIL]));
  await page.route('**/api/target-talent/*', route => json(route, TA_DETAIL));
  await page.route('**/api/referrals/*/detail', route => json(route, REFERRAL_DETAIL));
  await page.route('**/api/referrals/followups', route => json(route, { items: [{ ...REFERRAL_DETAIL.referral, daysSinceLastTouch: 5 }] }));
  await page.route('**/api/tt-reconcile/credit-balances', route => json(route, { hunter: 84, apollo: 130, millionVerifier: 212 }));
  await page.route('**/api/tt-reconcile/preview**', route => json(route, RECONCILE_PREVIEW));
  await page.route('**/api/tt-reconcile/discover-run**', route => json(route, { status: 'done', results: [] }));
  await page.route('**/api/target-talent/*/draft', route => json(route, { draft: { subject: 'Northwind follow-up', body: 'Alex, thanks again for the conversation. The CRM consolidation mandate is exactly the work I want to own next.' }, review: { grade: 'A', summary: 'Specific, concise, and easy to answer.' }, surfaceId: 'ta-followup' }));
  await page.route('**/api/referrals/*/draft', route => json(route, { draft: { subject: 'Northwind introduction', body: 'Priya, thank you for offering to make the introduction. The consolidation mandate is a strong fit with my recent work.' }, review: { grade: 'A', summary: 'Warm and specific.' }, surfaceId: 'referral-ask' }));
  await page.route('**/api/posts/reply', route => json(route, { reply: 'That ownership point mattered for us too. Adoption improved once the planners helped define the scorecard.' }));
  await page.route('**/api/sequences/templates', route => json(route, { templates: [
    { id: 'ta-intro', name: 'TA Introduction', steps: 2, category: 'ta' },
    { id: 'ta-followup', name: 'TA Follow-up', steps: 3, category: 'ta' },
  ] }));
  await page.route('**/api/sequences/ta/*', route => json(route, { sequence: null }));
  await page.route('**/api/setup/state', route => json(route, {
    name: 'Jordan Avery',
    email: 'jordan.avery@example.com',
    phone: '(555) 204-5187',
    location: 'Austin, TX',
    targetRole: 'VP, Revenue Operations',
    completedSteps: ['cv', 'profile', 'portals', 'tracker', 'narrative', 'scoring', 'outreach'],
    totalSteps: 8,
    readiness: 7,
  }));

  const settle = () => page.waitForTimeout(WAIT_MS);
  const reload = async () => { await page.goto(BASE, { waitUntil: 'networkidle' }); await settle(); };
  const changeMode = async opts => { setMode(opts); await reload(); };
  const navigate = async label => { await clickNav(page, label); await settle(); };
  const clickExact = async (label, optional = false) => {
    const target = page.locator('button, [role="tab"], .subtab, .chip', { hasText: label }).first();
    try { await target.click(); await settle(); return true; }
    catch (error) { if (!optional) throw error; return false; }
  };
  const clickContains = async (label, optional = false) => {
    const target = page.getByText(label, { exact: false }).first();
    try { await target.click(); await settle(); return true; }
    catch (error) { if (!optional) throw error; return false; }
  };
  const scrollContent = async y => {
    await page.evaluate(value => {
      const el = document.querySelector('.content');
      if (el) el.scrollTop = value;
      else window.scrollTo(0, value);
    }, y);
    await settle();
  };
  const openRole = async company => {
    await page.evaluate(want => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const row = rows.find(r => r.textContent.includes(want) && getComputedStyle(r).cursor === 'pointer') || rows.find(r => r.textContent.includes(want));
      if (row) row.click();
    }, company);
    await page.locator('.pl-drawer.open').first().waitFor({ state: 'visible' });
    await settle();
  };
  const closeOverlay = async () => { await page.keyboard.press('Escape'); await settle(); };
  const clickDrawerTab = async (label) => {
    const tab = page.locator('.dr-tab', { hasText: label }).first();
    await tab.click(); await settle();
  };
  const navigateSetup = async () => {
    try { await navigate('Launchpad'); } catch { await navigate('Setup'); }
  };
  const failures = [];
  const capture = async (filename, prepare) => {
    try {
      await prepare();
      await settle();
      await page.screenshot({ path: path.join(OUT, filename) });
      console.log('saved', filename);
    } catch (error) {
      console.log('skipped', filename, '-', error.message);
      failures.push(filename);
    }
  };

  await reload();

  await capture('29-app-map.png', async () => {
    await navigateSetup();
    await clickExact('Day-to-day guide');
    const firstChapter = page.locator('.ib-navitem').filter({ hasText: /map/i }).first();
    await firstChapter.click();
  });
  await capture('30-command-palette.png', async () => {
    await page.keyboard.press('Control+K');
    const input = page.getByRole('dialog', { name: 'Command palette' }).getByRole('textbox');
    await input.fill('revenue');
    await page.waitForTimeout(500);
  });
  await capture('31-workflow-runner.png', async () => {
    await closeOverlay();
    agentMode = 'liveness';
    await reload();
    await navigate('Pipeline');
  });
  await capture('32-update-banner.png', async () => {
    agentMode = 'idle';
    updateMode = 'available';
    await reload();
  });

  await capture('33-today-focus.png', async () => {
    updateMode = 'up-to-date';
    await changeMode({ dataMode: 'populated' });
    await navigate('Today');
    await clickContains('Start', true);
  });
  await capture('34-today-calendar.png', async () => {
    googleMode = 'connected';
    await reload();
    await navigate('Today');
  });
  await capture('35-today-empty.png', async () => {
    googleMode = 'disconnected';
    await changeMode({ dataMode: 'empty' });
    await navigate('Today');
  });
  await capture('36-schedule-editor.png', async () => {
    await changeMode({ dataMode: 'populated' });
    await navigate('Today');
    await clickExact('Schedule');
    const time = page.locator('input[type="time"]').first();
    if (await time.count()) await time.fill('08:30');
  });

  await capture('37-coach-page.png', async () => { coachMode = 'default'; await reload(); await navigate('AI Coach'); });
  await capture('38-coach-confirm-action.png', async () => { coachMode = 'pending'; await reload(); await navigate('AI Coach'); });
  await capture('39-coach-floating.png', async () => {
    coachMode = 'default';
    await reload();
    await navigate('Pipeline');
    await page.getByRole('button', { name: 'Ask the Coach' }).click();
  });

  await capture('40-pipeline-overview-kpis.png', async () => { await page.getByRole('button', { name: 'Ask the Coach' }).click(); await settle(); await navigate('Pipeline'); await clickExact('Overview'); await scrollContent(0); });
  await capture('41-pipeline-overview-charts.png', async () => { await scrollContent(400); });
  await capture('42-pipeline-roles.png', async () => { await scrollContent(0); await clickExact('Roles'); });
  await capture('43-pipeline-roles-filtered.png', async () => {
    const archetype = page.locator('select.sel').first();
    if (await archetype.count()) await archetype.selectOption({ label: 'RevOps' });
    const score = page.locator('.score-seg button', { hasText: '4+' }).first();
    if (await score.count()) await score.click();
  });
  await capture('44-pipeline-provisional.png', async () => {
    await changeMode({ showTriage: true });
    await navigate('Pipeline');
    await clickExact('Roles');
  });
  await capture('45-discovery-pending.png', async () => { await clickExact('Discovery'); await clickExact('Pending', true); });
  await capture('46-discovery-gated.png', async () => { await clickExact('Gated', true); });
  await capture('47-discovery-evaluating.png', async () => {
    agentMode = 'evaluate';
    await reload();
    await navigate('Pipeline');
    await clickExact('Discovery');
    await clickExact('Evaluating', true);
  });
  await capture('48-analytics-top.png', async () => { agentMode = 'idle'; await reload(); await navigate('Pipeline'); await clickExact('Analytics'); await scrollContent(0); });
  await capture('49-analytics-drivers.png', async () => { await scrollContent(520); });
  await capture('50-analytics-flows.png', async () => { await scrollContent(1050); });

  await capture('51-role-drawer-overview.png', async () => { await scrollContent(0); await clickExact('Roles'); await openRole('Northwind Analytics'); });
  await capture('52-score-explainer.png', async () => { await clickContains('How is this scored?'); });
  await capture('53-role-drawer-applied.png', async () => { await closeOverlay(); await openRole('Acme Robotics'); });
  await capture('54-resume-match.png', async () => { await closeOverlay(); await openRole('Northwind Analytics'); await clickExact('Resume Match'); });
  await capture('55-role-comp.png', async () => { await clickDrawerTab('Comp'); });
  await capture('56-role-interview.png', async () => { await clickDrawerTab('Interview'); await page.locator('.rp-star-head').first().click(); });
  await capture('57-role-customize-cv.png', async () => { await clickExact('Customize'); await clickContains('CV Changes', true); });
  await capture('58-role-customize-linkedin.png', async () => { await clickContains('LinkedIn'); });
  await capture('59-role-legitimacy.png', async () => { await clickExact('Legitimacy'); });
  await capture('60-role-posting.png', async () => { await clickExact('Posting'); });
  await capture('61-role-notes.png', async () => { await clickExact('Notes'); });
  await capture('62-role-contacts.png', async () => { await clickExact('Contacts'); });
  await capture('63-role-followup-draft.png', async () => { await clickExact('Follow-up'); await clickContains('Draft follow-up', true); });

  await capture('64-followups-queue.png', async () => { await closeOverlay(); await navigate('Network'); await clickExact('Follow-ups'); await scrollContent(0); });
  await capture('65-followups-accepted.png', async () => { followupMode = 'accepted'; await reload(); await navigate('Network'); await clickExact('Follow-ups'); });
  await capture('66-followups-merge.png', async () => { followupMode = 'merge'; await reload(); await navigate('Network'); await clickExact('Follow-ups'); });
  await capture('67-followups-snoozed.png', async () => { followupMode = 'snoozed'; await reload(); await navigate('Network'); await clickExact('Follow-ups'); await scrollContent(900); });
  await capture('68-followups-find-contact.png', async () => { followupMode = 'find'; await reload(); await navigate('Network'); await clickExact('Follow-ups'); await clickContains('Find a contact'); });
  await capture('69-followups-decision-maker.png', async () => { followupMode = 'decision'; await reload(); await navigate('Network'); await clickExact('Follow-ups'); await clickContains('Reach a decision-maker'); });

  await capture('70-referrals-overview.png', async () => { await navigate('Network'); await clickExact('Referrals'); await scrollContent(0); });
  await capture('71-referral-drawer.png', async () => { await page.locator('tbody tr').filter({ hasText: 'Priya Raghunathan' }).first().click(); });
  await capture('72-decision-makers.png', async () => { await closeOverlay(); await clickExact('Decision Makers'); });
  await capture('73-reconcile-contacts.png', async () => { await clickExact('Reconcile'); });
  await capture('74-ta-outreach.png', async () => { await reload(); await navigate('Network'); await clickExact('TA Outreach'); });
  await capture('75-contact-drawer.png', async () => { await page.locator('tbody tr').filter({ hasText: 'Alex' }).first().click(); await settle(); });
  await capture('76-contact-sequence.png', async () => { await clickContains('Start sequence', true); await clickContains('Draft', true); });
  await capture('77-log-message-modal.png', async () => { await clickContains('Log message', true); await clickContains('Log sent', true); });

  await capture('78-influencers-list.png', async () => { await reload(); await navigate('Network'); await clickExact('Influencers'); });
  await capture('79-influencer-ai-response.png', async () => { await page.locator('tbody tr').filter({ hasText: 'Priya Anand' }).first().click(); await clickExact('AI Response'); await clickContains('Generate Response'); });
  await capture('80-influencer-ai-connect.png', async () => { await clickExact('AI Connect'); await clickContains('Generate Request'); });
  await capture('81-influencer-ai-reply.png', async () => { await clickExact('AI Reply'); const ta = page.locator('textarea').first(); if (await ta.count()) await ta.fill('Adoption was the hard part for us too.'); await clickContains('Generate my reply'); });

  await capture('82-posts-composer.png', async () => { await reload(); await navigate('Social'); await clickExact('Posts'); });
  await capture('83-content-publish-disconnected.png', async () => { bufferMode = 'disconnected'; await reload(); await navigate('Social'); await clickExact('Content'); await clickExact('Publish'); });
  await capture('84-content-publish-preview.png', async () => {
    bufferMode = 'connected';
    await reload();
    await navigate('Social');
    await clickExact('Content');
    await clickExact('Publish');
    await clickContains('Select all');
    await clickContains('Preview');
  });
  await capture('85-content-publish-result.png', async () => { await clickContains('Push'); });
  await capture('86-content-tracker.png', async () => { postMode = 'metrics'; await reload(); await navigate('Social'); await clickExact('Content'); await clickExact('Tracker'); });
  await capture('87-comment-reply.png', async () => { await clickExact('Reply to a comment'); const ta = page.locator('textarea').first(); if (await ta.count()) await ta.fill('How did you get planners to own the scorecard?'); await clickContains('Generate reply'); });
  await capture('88-content-what-works.png', async () => { await clickExact('What works'); });
  await capture('89-social-activity-log.png', async () => { await clickExact('Activity Log'); });

  await capture('90-interview-prep.png', async () => { await navigate('Interview'); await clickContains('Northwind Analytics'); await clickExact('Prep'); });
  await capture('91-interview-needs-prep.png', async () => { await clickContains('Globex Health'); });
  await capture('92-interview-live.png', async () => { await clickContains('Northwind Analytics'); await clickContains('Round 1'); await clickExact('Live'); await clickContains('Consolidation experience', true); });
  await capture('93-interview-panic.png', async () => { await clickContains('If stuck', true); });
  await capture('94-interview-present.png', async () => { await clickContains('Present'); });
  await capture('95-interview-debrief.png', async () => {
    await closeOverlay();
    await navigate('Insights');
    await clickExact('Review');
    await clickContains('Add debrief');
    const values = ['Advanced to the next round.', 'They questioned executive-level scale.', 'They need evidence of leading a larger team.', 'Alex Kim, recruiter.', 'CRO owns the decision.', 'The consolidation story landed.', 'Shorten the team-management answer.', 'Three CRM instances after two acquisitions.', 'Send thank-you note tomorrow.'];
    const fields = page.locator('textarea');
    for (let i = 0; i < Math.min(await fields.count(), values.length); i++) await fields.nth(i).fill(values[i]);
  });

  await capture('96-review-floor.png', async () => { weeklyMode = 'on-pace'; googleMode = 'disconnected'; await reload(); await navigate('Insights'); await clickExact('Review'); await scrollContent(0); });
  await capture('97-review-behind.png', async () => { weeklyMode = 'behind'; await reload(); await navigate('Insights'); await clickExact('Review'); });
  await capture('98-review-gmail-replies.png', async () => { weeklyMode = 'on-pace'; googleMode = 'connected'; await reload(); await navigate('Insights'); await clickExact('Review'); await clickContains('Replies', true); });
  await capture('99-review-bounces.png', async () => { await clickContains('Bounces', true); await clickContains('Scan', true); });
  await capture('100-insights-overview.png', async () => { insightMode = true; await reload(); await navigate('Insights'); await clickExact('Insights'); await clickExact('Overview'); });
  await capture('101-insights-working.png', async () => { await clickContains("What's working"); });
  await capture('102-insights-not-working.png', async () => { await clickContains("What's not"); });
  await capture('103-insights-moves.png', async () => { await clickContains('Recommended moves'); });

  await capture('104-launchpad-readiness.png', async () => { googleMode = 'disconnected'; await changeMode({ stateMode: 'started' }); await navigateSetup(); await scrollContent(0); });
  await capture('105-launchpad-identity.png', async () => { await clickContains('Identity', true); });
  await capture('106-launchpad-handoff.png', async () => {
    const item = page.locator('.ib-navitem').filter({ hasText: /handoff/i }).first();
    if (await item.count()) { await item.click(); await settle(); }
  });
  await capture('107-launchpad-integrations.png', async () => {
    const item = page.locator('.ib-navitem').filter({ hasText: /integrations/i }).first();
    if (await item.count()) { await item.click(); await settle(); }
  });
  await capture('108-models-cost.png', async () => {
    const item = page.locator('.ib-navitem').filter({ hasText: /models/i }).first();
    if (await item.count()) { await item.click(); await settle(); }
  });
  await capture('109-health-check.png', async () => { await clickContains('Health', true); });
  await capture('110-customize.png', async () => { await reload(); await navigateSetup(); await clickExact('Customize'); });
  await capture('111-guide-rail.png', async () => { await clickExact('Day-to-day guide'); await scrollContent(0); });
  await capture('112-guide-daily-loop.png', async () => {
    const navItem = page.locator('.ib-navitem').filter({ hasText: /daily loop/i }).first();
    if (await navItem.count()) { await navItem.click(); await settle(); }
  });
  await capture('113-pitch-editor.png', async () => { await clickExact('Tell Me About Yourself'); });
  await capture('114-activity-tracker.png', async () => { await clickExact('Activity Tracker'); await clickContains('Generate', true); });
  await capture('115-changelog.png', async () => { await clickExact('Change Log'); });
  await capture('116-about.png', async () => {
    await page.locator('button, [role="tab"], .subtab, .chip').filter({ hasText: /^About$/ }).first().click();
    await settle();
  });

  await browser.close();
  if (failures.length > 0) {
    console.error(`${failures.length} capture(s) failed:`, failures.join(', '));
    process.exitCode = 1;
  }
  console.log('Done. Screenshots in', OUT);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('capture failed:', error); process.exitCode = 1; });
}

// The product's status vocabulary, as agreed in Definitions v1 and v1.1. Pure data, no imports.
// tests/definitions.test.mjs checks this file against templates/states.yml, the server status
// sets and the code that compares statuses, so a name or a set cannot drift unnoticed.

// Application statuses that exist today. group: evaluated | applied | interview | offer | end | retiring.
// A retiring status still exists in the data and the code but is planned to fold into Passed.
// Passed (group: passed) is live: accepted everywhere, written by nothing until the migration.
export const APPLICATION_STATUSES = Object.freeze([
  { label: 'Evaluated', group: 'evaluated' },
  { label: 'Applied', group: 'applied' },
  { label: 'Phone Screen', group: 'interview' },
  { label: '1st Interview', group: 'interview' },
  { label: '2nd Interview', group: 'interview' },
  { label: '3rd Interview', group: 'interview' },
  { label: 'Offer', group: 'offer' },
  { label: 'Rejected', group: 'end' },
  { label: 'No Response', group: 'end' },
  { label: 'Passed', group: 'passed' },
  { label: 'SKIP', group: 'retiring', retiresInto: 'Passed' },
  { label: 'Not a Fit', group: 'retiring', retiresInto: 'Passed' },
  { label: 'Discarded', group: 'retiring', retiresInto: 'Passed' },
  { label: 'Closed', group: 'retiring', retiresInto: 'Passed' },
]);

// Planned, not live. Code must not compare a status to one of these yet. Empty now that Passed is live.
export const PLANNED_STATUSES = Object.freeze([]);

// Contact ladders (target talent and referrals). They share the word "status" in code.
export const CONTACT_STATUSES = Object.freeze([
  'Not Contacted', 'Sent', 'Replied', 'Meeting Scheduled', 'Connected', 'Dormant', 'Bounced', 'Blocked', 'Archived',
  'Not Asked', 'Catching Up', 'Asked', 'Responded', 'Intro Made', 'Applied w/ Referral', 'No',
]);

const labelsOf = group => APPLICATION_STATUSES.filter(s => s.group === group).map(s => s.label);

export const INTERVIEW_STAGES = Object.freeze(labelsOf('interview'));
// Definitions v1 section 3: Applied, any interview stage, or Offer. Evaluated is not active.
export const ACTIVE_STATUSES = Object.freeze([...labelsOf('applied'), ...INTERVIEW_STAGES, ...labelsOf('offer')]);
// The left to right pipeline ladder: Evaluated, then the active statuses.
export const LADDER = Object.freeze([...labelsOf('evaluated'), ...ACTIVE_STATUSES]);
// The employer decided or never answered. You set these by hand; nothing auto-closes.
export const EMPLOYER_END_STATES = Object.freeze(labelsOf('end'));
export const RETIRING_STATUSES = Object.freeze(labelsOf('retiring'));

export const ALL_APPLICATION_STATUSES = Object.freeze(APPLICATION_STATUSES.map(s => s.label));

// Names a comparison on `status` may use. Everything else is undefined.
export const DEFINED_STATUS_NAMES = Object.freeze(new Set([...ALL_APPLICATION_STATUSES, ...CONTACT_STATUSES]));

// Which set each code export implements, and the files that read it. tests/definitions.test.mjs
// fails when a file reads one of these exports and is not listed (a change to the set must surface
// every affected screen), or when a listed file no longer reads it.
export const SET_READERS = Object.freeze({
  ACTIVE_STATUSES: [
    'dashboard-web/server/lib/insights.mjs',
    'dashboard-web/server/lib/linkedin-referrals.mjs',
    'dashboard-web/server/routes/linkedin-drafts.mjs',
    'dashboard-web/server/routes/referrals.mjs',
    'dashboard-web/server/routes/target-talent.mjs',
    'dashboard-web/src/pipeline.jsx',
  ],
  OUTREACH_ELIGIBLE_STATUSES: [
    'dashboard-web/server/lib/followups.mjs',
    'dashboard-web/server/lib/insights.mjs',
    'dashboard-web/server/lib/target-talent.mjs',
    'dashboard-web/server/lib/tt-reconcile-core.mjs',
    'dashboard-web/server/routes/target-talent.mjs',
  ],
  OUTREACH_DEAD_STATUSES: [
    'dashboard-web/server/lib/tt-reconcile-core.mjs',
  ],
  INTERVIEW_STAGES: [
    'lib/outcome.mjs',
    'followup-cadence.mjs',
    'dashboard-web/server/lib/debrief.mjs',
    'dashboard-web/server/lib/followups.mjs',
    'dashboard-web/server/lib/insights.mjs',
    'dashboard-web/server/lib/interview.mjs',
    'dashboard-web/server/routes/event-actions.mjs',
    'dashboard-web/server/routes/google.mjs',
    'dashboard-web/server/routes/interview.mjs',
    'dashboard-web/src/app.jsx',
    'dashboard-web/src/data.js',
    'dashboard-web/src/followups.jsx',
    'dashboard-web/src/overview.jsx',
    'dashboard-web/src/pipeline.jsx',
    'dashboard-web/src/target-talent.jsx',
  ],
  FUNNEL_ORDER: [
    'dashboard-web/server/lib/activity.mjs',
    'dashboard-web/server/lib/applications.mjs',
    'dashboard-web/server/lib/coach.mjs',
    'dashboard-web/server/lib/insights.mjs',
    'dashboard-web/server/lib/response-timing.mjs',
    'dashboard-web/src/app.jsx',
    'dashboard-web/src/charts.jsx',
    'dashboard-web/src/data.js',
    'dashboard-web/src/overview.jsx',
    'dashboard-web/src/pipeline.jsx',
  ],
});

// Where the server's set differs from this file today. tests/definitions.test.mjs fails when an entry
// is no longer true, so a fixed divergence has to be removed here. None today.
export const KNOWN_DIVERGENCES = Object.freeze([]);

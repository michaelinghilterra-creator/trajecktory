// The metrics dictionary: every number the dashboard shows is defined once here, with its formula, window,
// why it matters and what to do about it (Definitions v1.2). The UI reads label, definition and the why and
// do lines for tooltips; tests/metrics-dictionary.test.mjs fails when core output names a metric this file
// does not define. A definition changes only with a new DEFINITIONS_VERSION, never a silent edit.
//
// A benchmark is shown for context only and never colors a tile, because none is measured exactly the way
// these numbers are. Every one comes from the 2026 benchmarks note with its source and year.

export const DEFINITIONS_VERSION = 'v1.2';

// Minimum sample before a rate is shown as a percent (Wilson band, see rate-confidence.mjs).
export const MIN_RATE_SAMPLE = 10;

// A cohort younger than this many days has not had time to hear back, so it is shown as censored.
export const MATURE_DAYS = 14;

export const METRICS = Object.freeze([
  {
    id: 'applications_week',
    label: 'Applications',
    definition: 'Applications submitted this week, dated by the apply date. Same list as the TWC export: same day voids and repeat applications to one posting are left out.',
    formula: 'count of applications with an apply date in the week',
    window: 'week',
    why: 'Applications are the input every result below depends on.',
    do: 'If the week is light, open Roles and apply to the strongest Evaluated rows first.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'followups_week',
    label: 'Follow-ups',
    definition: 'Messages sent to someone at an employer this week, outside LinkedIn: at most one per person per day, from both contact books and the follow-ups log.',
    formula: 'count of follow-up activities dated in the week',
    window: 'week',
    why: 'Email is the channel that draws human replies; LinkedIn only messages draw far fewer.',
    do: 'Below the floor: work the Follow-ups queue, oldest reachable contact first.',
    floor: 13,
    benchmark: null,
  },
  {
    id: 'linkedin_week',
    label: 'LinkedIn touches',
    definition: 'LinkedIn connection requests plus LinkedIn messages sent this week, at most one per person per day.',
    formula: 'count of LinkedIn outreach activities dated in the week',
    window: 'week',
    why: 'Accepted connections are what make a LinkedIn only contact reachable later.',
    do: 'Below the floor: send connection requests from the Connect queue.',
    floor: 50,
    benchmark: null,
  },
  {
    id: 'screens_held_week',
    label: 'Screens held',
    definition: 'Interviews that actually happened this week (phone screen or later), dated by the day held and backed by evidence. Scheduled and unconfirmed interviews are not counted.',
    formula: 'count of interview records in the counted state with held_on in the week',
    window: 'week',
    why: 'A held conversation is the first result that is fully in the employer\'s hands.',
    do: 'An unconfirmed interview needs its evidence recorded before it can count.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'unserviced',
    label: 'Unserviced',
    definition: 'Applications still at Applied with no follow-up logged against them.',
    formula: 'count of Applied rows with no row in the follow-ups log',
    window: 'now',
    why: 'An application nobody followed up on relies on the resume alone.',
    do: 'Above the limit: follow up before applying to more.',
    floor: null,
    limit: 20,
    benchmark: null,
  },
  {
    id: 'response_rate',
    label: 'Response rate',
    definition: 'Share of applications that heard back from a human: a logged human reply, a rejection email, or an interview.',
    formula: 'applications with a human reply, a rejection or an interview record, divided by applications',
    window: 'all time',
    why: 'Silence and a no are different problems: silence points at targeting or the resume, a no at fit.',
    do: 'Compare the mature rate (applications at least 14 days old) with the cohort table to see if it is moving.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'positive_rate',
    label: 'Positive reply rate',
    definition: 'Share of applications that drew an interview invite or a positive human reply.',
    formula: 'applications with an interview record, a reached phone screen, or a reply tagged positive, divided by applications',
    window: 'all time',
    why: 'This is the part of the response rate that moves the search forward.',
    do: 'If responses are up but positive replies are flat, the roles are a weaker fit than the scores say.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'interview_rate',
    label: 'Interview rate',
    definition: 'Share of applications that reached a held phone screen or later. Only held, evidenced interviews count.',
    formula: 'applications with a counted interview record, divided by applications',
    window: 'all time',
    why: 'This is the conversion the whole pipeline exists to raise.',
    do: 'Use the segment table to see which role types and sources convert, once each has 10 or more applications.',
    floor: null,
    benchmark: { text: 'Career page application to interview: 6.4 to 6.9%', source: 'Huntr', year: 2026 },
  },
  {
    id: 'referral_rate',
    label: 'Referral share',
    definition: 'Share of applications that went in carrying a referral.',
    formula: 'applications tagged with a referral source, divided by applications',
    window: 'all time',
    why: 'Referred candidates reach interview far more often than cold applicants.',
    do: 'Before applying to a strong fit, check Referrals for someone at the company.',
    floor: null,
    benchmark: { text: 'Referred candidates reach interview about 40% of the time, cold about 3%', source: 'Ashby', year: 2026 },
  },
  {
    id: 'outreach_reply_rate',
    label: 'Outreach reply rate',
    definition: 'Share of people you contacted who sent a human reply, per channel. Bounced addresses, auto replies and connection acceptances do not count.',
    formula: 'people with a human reply, divided by people touched, per channel',
    window: 'all time',
    why: 'Shows which channel earns a conversation, not just which one is easy to send on.',
    do: 'Put more of the weekly floor on the channel with the higher rate.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'funnel',
    label: 'Application funnel',
    definition: 'Applications, then those that heard back, held a phone screen, held a later interview, and reached an offer. Each rung is a subset of the one above.',
    formula: 'count of applications reaching each rung; conversion is each rung divided by the rung above',
    window: 'all time',
    why: 'The biggest drop between two rungs is where effort pays off most.',
    do: 'Work on the step with the steepest drop, not on the top of the funnel.',
    floor: null,
    benchmark: { text: 'Screen to next round: about 35%', source: 'Ashby', year: 2026 },
  },
  {
    id: 'weekly_trend',
    label: 'Weekly applications and results',
    definition: 'Applications per Sunday to Saturday week, and what each week\'s applications have produced so far. A week younger than 14 days is still maturing.',
    formula: 'per week: applications with an apply date in the week; responded and screened counts are for those same applications',
    window: '8 weeks',
    why: 'Comparing weeks of the same age shows whether changes to targeting or the resume are working.',
    do: 'Judge a change only once its week has matured.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'score_vs_apply',
    label: 'Score vs apply decision',
    definition: 'Evaluated roles by fit score in half point bands, split into the ones you applied to and the ones you did not.',
    formula: 'count of scored rows per band; applied means the row is in the application list',
    window: 'all time',
    why: 'Shows whether applications go to the strongest fits.',
    do: 'Unapplied rows in the top bands are the first place to look for the next application.',
    floor: null,
    benchmark: null,
  },
  {
    id: 'segments',
    label: 'What converts',
    definition: 'Response rate and interview rate by role type and by source. A group appears only once it has 10 or more applications; smaller groups are counted together below the table.',
    formula: 'the response and interview rate formulas, restricted to each group',
    window: 'all time',
    why: 'Shows where to put the next application.',
    do: 'Favor groups whose lower band is above your overall rate.',
    floor: null,
    benchmark: null,
  },
]);

const BY_ID = new Map(METRICS.map(metric => [metric.id, metric]));

/** The definition for a metric id, or undefined. */
export function metricDef(id) {
  return BY_ID.get(id);
}

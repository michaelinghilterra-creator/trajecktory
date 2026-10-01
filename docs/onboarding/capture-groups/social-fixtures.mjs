/**
 * social-fixtures.mjs: invented data for the Social tab capture group.
 *
 * Everything here is made up. The persona is Jordan Avery (a RevOps leader in
 * Austin, TX). Influencer names, post text and links are fictional; links use
 * example.com only. The frozen browser clock is Wed 2026-07-22 10:30 CDT, so
 * every date below is built around that instant.
 *
 * Times: scheduledFor values are naive local strings ("2026-07-23T09:00"), the
 * same shape the app's datetime-local picker stores. Buffer dueAt values are UTC
 * instants (CDT is UTC-5, so 14:00Z is 9:00 AM Central).
 */

const iso = (s) => s; // readability marker: these are literal ISO strings

// ---- posts ---------------------------------------------------------------------

const metrics = (m, extra = {}) => ({
  impressions: 0, reactions: 0, comments: 0, reposts: 0, saves: 0, linkClicks: 0,
  profileViews: 0, followers: 0, connReqs: 0, inboundDms: 0, repoClicks: 0, repoStars: 0,
  whoEngaged: '', notes: '', checkedAt: iso('2026-07-21T15:00:00.000Z'), ...m, ...extra,
});

// Fields Buffer reports on its own; the rest the user types in.
const AUTO = ['impressions', 'reactions', 'comments', 'reposts', 'saves', 'linkClicks', 'followers'];

const buf = (id, status, dueAt, pendingFirstComment = '') => ({
  id, status, dueAt, externalLink: null, pushedAt: iso('2026-07-20T16:00:00.000Z'), pendingFirstComment,
});

// Queued: marked ready, each with a Publish time. Not yet on Buffer.
const QUEUED = [
  {
    id: 'p_q1a2b3c4', source: 'user', lane: 'professional', channel: 'linkedin', type: 'rigor',
    title: 'Stage definitions that a new hire can verify',
    text: 'Stage definitions are the cheapest forecast upgrade you will ever buy.\n\nBefore another dashboard, write one sentence per pipeline stage that a new hire could verify from the CRM alone. If two managers read the sentence and disagree, the stage is not defined yet.\n\nThe arguments in forecast calls get shorter the week the sentences go up.',
    linkComment: 'https://example.com/jordan/stage-definitions',
    status: 'queued', scheduledFor: '2026-07-23T09:00', metrics: null,
    createdAt: iso('2026-07-20T15:10:00.000Z'), updatedAt: iso('2026-07-21T14:30:00.000Z'), order: 8,
  },
  {
    id: 'p_q2d5e6f7', source: 'user', lane: 'trajecktory', channel: 'linkedin', type: 'journey',
    title: 'Week five of the search, scored',
    text: 'Week five of running my job search like a pipeline. I scored every role before applying and wrote down where the score was wrong.\n\nBiggest miss so far: I weighted the title heavily and the hiring manager barely at all. Fixing the weights, not the roles.',
    linkComment: '',
    status: 'queued', scheduledFor: '2026-07-28T09:00', metrics: null,
    createdAt: iso('2026-07-21T13:45:00.000Z'), updatedAt: iso('2026-07-21T13:50:00.000Z'), order: 9,
  },
  {
    id: 'p_q3g8h9i0', source: 'claude', lane: 'professional', channel: 'linkedin', type: 'craft',
    title: 'A CRM field earns its place',
    text: 'A CRM field earns its place by passing three tests: someone reads it, it changes a decision, and a named person fixes it when it is wrong.\n\nFields that fail all three are not data. They are decoration with a maintenance bill.',
    linkComment: 'https://example.com/jordan/field-audit',
    status: 'queued', scheduledFor: '2026-07-30T09:00', metrics: null,
    createdAt: iso('2026-07-22T13:20:00.000Z'), updatedAt: iso('2026-07-22T14:05:00.000Z'), order: 10,
  },
];

// Drafts: written but not queued. One carries a time already (it carries over on Queue).
const DRAFTS = [
  {
    id: 'p_d1j1k2l3', source: 'user', lane: 'professional', channel: 'linkedin', type: '',
    title: 'Lead routing, ugliest exception first',
    text: 'Rebuilding lead routing taught me to start with the ugliest exception, not the average case.\n\nThe average case routes itself. The exception is where the rule set actually gets written.',
    linkComment: '',
    status: 'draft', scheduledFor: '2026-08-06T09:00', metrics: null,
    createdAt: iso('2026-07-21T20:00:00.000Z'), updatedAt: iso('2026-07-21T20:00:00.000Z'), order: 11,
  },
  {
    id: 'p_d2m4n5o6', source: 'claude', lane: 'trajecktory', channel: 'linkedin', type: '',
    title: '',
    text: 'Small update on the scorer I use for my own search: it now explains every number it gives. If a role scores 3.4, you can read which three dimensions pulled it down.\n\nA score you cannot interrogate is just an opinion with decimals.',
    linkComment: 'https://example.com/jordan/scorer-notes',
    status: 'draft', scheduledFor: null, metrics: null,
    createdAt: iso('2026-07-22T14:12:00.000Z'), updatedAt: iso('2026-07-22T14:12:00.000Z'), order: 12,
  },
  {
    id: 'p_d3p7q8r9', source: 'user', lane: 'professional', channel: 'linkedin', type: '',
    title: 'Name the owner of the handoff',
    text: 'Quarter end is a bad time to learn your handoff has no owner.\n\nWrite the owner into the handoff the same way you write the amount into the opportunity.',
    linkComment: '',
    status: 'draft', scheduledFor: '2026-08-04T09:00', metrics: null,
    createdAt: iso('2026-07-22T12:40:00.000Z'), updatedAt: iso('2026-07-22T12:40:00.000Z'), order: 13,
  },
];

// Scheduled on Buffer, not yet sent.
const SCHEDULED = [
  {
    id: 'p_s1s2t3u4', source: 'user', lane: 'professional', channel: 'linkedin', type: 'craft',
    title: 'Lead routing, exception first',
    text: 'Three questions I ask before touching a CRM field: who reads it, what decision does it change, and who owns it when it is wrong.\n\nIf I cannot answer all three, the field goes.',
    linkComment: 'https://example.com/jordan/routing-notes',
    status: 'scheduled', scheduledFor: '2026-07-24T08:30',
    buffer: buf('bf_7a91c2e0', 'scheduled', '2026-07-24T13:30:00.000Z', 'https://example.com/jordan/routing-notes'),
    metrics: null,
    createdAt: iso('2026-07-19T17:00:00.000Z'), updatedAt: iso('2026-07-20T16:00:00.000Z'), order: 6,
  },
  {
    id: 'p_s2v5w6x7', source: 'user', lane: 'trajecktory', channel: 'linkedin', type: 'builder',
    title: 'The scorer says no',
    text: 'Most of what I built this month is a way to say no faster. A role that scores under four does not get my afternoon.\n\nSaying no is a feature, and it needs tests like any other.',
    linkComment: '',
    status: 'scheduled', scheduledFor: '2026-07-27T09:00',
    buffer: buf('bf_3c58d1a4', 'scheduled', '2026-07-27T14:00:00.000Z'),
    metrics: null,
    createdAt: iso('2026-07-19T17:30:00.000Z'), updatedAt: iso('2026-07-20T16:05:00.000Z'), order: 7,
  },
];

// Published, tracked, with metrics. All went out through Buffer, so each carries a buffer id.
const publishedPost = (n, o) => ({
  source: 'user', channel: 'linkedin', linkComment: '', status: 'published',
  createdAt: iso(`2026-07-${String(o.day).padStart(2, '0')}T14:00:00.000Z`),
  updatedAt: iso('2026-07-21T15:00:00.000Z'),
  buffer: buf(`bf_pub${n}`, 'sent', `2026-07-${String(o.day).padStart(2, '0')}T14:00:00.000Z`),
  scheduledFor: `2026-07-${String(o.day).padStart(2, '0')}T09:00`,
  ...o,
});

const PUBLISHED = [
  publishedPost(1, {
    id: 'p_pub00001', day: 2, lane: 'trajecktory', type: 'origin', order: 0,
    title: 'Why I started measuring my job search',
    text: 'I used to run a pipeline for a living and a job search by feel. This month I switched the search over to the same discipline: stage definitions, conversion rates, a weekly review.\n\nThe first thing it showed me is that I was guessing.',
    metrics: metrics({ impressions: 3200, reactions: 96, comments: 14, reposts: 6, saves: 22, linkClicks: 31, profileViews: 58, followers: 12, connReqs: 4, inboundDms: 2, repoClicks: 31, repoStars: 7, whoEngaged: 'RevOps and sales ops leaders, two recruiters', notes: 'Strong first post, personal angle landed.', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(2, {
    id: 'p_pub00002', day: 7, lane: 'trajecktory', type: 'builder', order: 1,
    title: 'I built a scorer that says no',
    text: 'I built a scorer for my own job search. Its main job is to say no.\n\nEvery role gets rated on fit, level, and location before I spend an afternoon on it. Under four, it waits.',
    metrics: metrics({ impressions: 2400, reactions: 71, comments: 9, reposts: 3, saves: 15, linkClicks: 44, profileViews: 40, followers: 6, connReqs: 2, inboundDms: 1, repoClicks: 44, repoStars: 11, whoEngaged: 'Builders and analytics people', notes: '', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(3, {
    id: 'p_pub00003', day: 9, lane: 'professional', type: 'myth', order: 2,
    title: 'Applying to everything is not a strategy',
    text: 'Myth: more applications means more interviews.\n\nIn a pipeline it is obvious that volume without fit just fills the top of the funnel with leads nobody wants. A job search is the same funnel with you as the product.',
    metrics: metrics({ impressions: 5100, reactions: 140, comments: 31, reposts: 18, saves: 40, linkClicks: 12, profileViews: 96, followers: 21, connReqs: 9, inboundDms: 4, repoClicks: 12, repoStars: 3, whoEngaged: 'VPs of revenue, a few hiring managers', notes: 'Best reach so far. Comments were all substantive.', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(4, {
    id: 'p_pub00004', day: 14, lane: 'professional', type: 'rigor', order: 3,
    title: 'Stage definitions that survive a new hire',
    text: 'A stage definition survives a new hire when the new hire can check it without asking anyone.\n\nIf the check needs tribal knowledge, the stage is a mood, not a definition.',
    metrics: metrics({ impressions: 1800, reactions: 38, comments: 5, reposts: 1, saves: 9, linkClicks: 0, profileViews: 17, followers: 2, connReqs: 1, inboundDms: 0, repoClicks: 0, repoStars: 0, whoEngaged: 'Sales ops managers', notes: 'Too abstract, no example.', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(5, {
    id: 'p_pub00005', day: 16, lane: 'professional', type: 'craft', order: 4,
    title: 'Three questions before adding a CRM field',
    text: 'Before I add a CRM field I ask three questions: who reads it, what decision does it change, and who fixes it when it is wrong.\n\nMost requests fail the second one.',
    linkComment: 'https://example.com/jordan/field-audit',
    metrics: metrics({ impressions: 2700, reactions: 88, comments: 12, reposts: 4, saves: 27, linkClicks: 19, profileViews: 33, followers: 5, connReqs: 3, inboundDms: 3, repoClicks: 0, repoStars: 0, whoEngaged: 'RevOps practitioners', notes: 'Saves are high, people are keeping this one.', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(6, {
    id: 'p_pub00006', day: 17, lane: 'trajecktory', type: 'journey', order: 5,
    title: 'Week three: what the numbers say',
    text: 'Week three of the search, by the numbers. Plenty of roles evaluated, a small number worth my time, and a clear pattern in which ones convert to a conversation.\n\nThe pattern is not the one I expected.',
    metrics: metrics({ impressions: 2050, reactions: 60, comments: 11, reposts: 2, saves: 12, linkClicks: 8, profileViews: 29, followers: 4, connReqs: 2, inboundDms: 1, repoClicks: 8, repoStars: 2, whoEngaged: 'Other people mid-search', notes: '', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
  publishedPost(7, {
    id: 'p_pub00007', day: 20, lane: 'professional', type: 'myth', order: 14,
    title: 'Forecasts are conversations, not spreadsheets',
    text: 'Myth: a good forecast is a good spreadsheet.\n\nThe best RevOps teams spend more time on why a deal slipped than on the number itself.',
    metrics: metrics({ impressions: 3900, reactions: 112, comments: 22, reposts: 11, saves: 31, linkClicks: 6, profileViews: 61, followers: 10, connReqs: 5, inboundDms: 3, repoClicks: 6, repoStars: 1, whoEngaged: 'Revenue leaders', notes: '', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  }),
];

// One X post kept as history after the channel was stood down (2.37.0). Only
// the X-history variant of the captures includes it.
export const X_HISTORY_POST = {
  id: 'p_xhist001', source: 'user', lane: 'trajecktory', channel: 'x', type: 'builder',
  title: 'Early build note, X',
  text: 'Built a scorer for my own job search. Its main job is to say no. Under four out of five, a role waits.',
  linkComment: '',
  status: 'published', scheduledFor: '2026-06-24T09:00',
  buffer: buf('bf_xhist01', 'sent', '2026-06-24T14:00:00.000Z'),
  metrics: metrics({ impressions: 900, reactions: 18, comments: 2, reposts: 1, saves: 3, linkClicks: 5, profileViews: 9, followers: 1, connReqs: 0, inboundDms: 0, repoClicks: 5, repoStars: 1, whoEngaged: '', notes: 'Kept as history. The X channel was stood down.', autoFields: AUTO, bufferAt: iso('2026-07-21T15:00:00.000Z') }),
  createdAt: iso('2026-06-23T14:00:00.000Z'), updatedAt: iso('2026-06-25T15:00:00.000Z'), order: 15,
};

export const ALL_POSTS = [...PUBLISHED, ...SCHEDULED, ...QUEUED, ...DRAFTS];

/** The Posts tab composer view: the queue and drafts, plus one scheduled and one published post. */
export const COMPOSE_POSTS = [PUBLISHED[2], SCHEDULED[0], ...QUEUED, ...DRAFTS];

const act = (n, ts, action, post, detail = '') => ({
  id: `a_${String(n).padStart(8, '0')}`, ts, action, postId: post.id,
  snippet: String(post.text).slice(0, 80), lane: post.lane, channel: post.channel, detail,
});

// Newest LAST (the UI reverses it).
export const ACTIVITY = [
  act(1, iso('2026-07-20T15:10:00.000Z'), 'created', QUEUED[0]),
  act(2, iso('2026-07-20T16:00:00.000Z'), 'pushed', SCHEDULED[0], 'to Buffer for 2026-07-24T13:30:00.000Z'),
  act(3, iso('2026-07-21T13:50:00.000Z'), 'queued', QUEUED[1], 'for 2026-07-28T14:00:00.000Z'),
  act(4, iso('2026-07-21T14:30:00.000Z'), 'edited', QUEUED[0]),
  act(5, iso('2026-07-21T20:00:00.000Z'), 'created', DRAFTS[0]),
  act(6, iso('2026-07-22T12:40:00.000Z'), 'created', DRAFTS[2]),
  act(7, iso('2026-07-22T13:20:00.000Z'), 'generated', QUEUED[2]),
  act(8, iso('2026-07-22T14:05:00.000Z'), 'queued', QUEUED[2], 'for 2026-07-30T14:00:00.000Z'),
  act(9, iso('2026-07-22T14:12:00.000Z'), 'generated', DRAFTS[1]),
];

// ---- Buffer ----------------------------------------------------------------------

export const BUFFER_CHANNELS = {
  linkedin: { key: 'linkedin', id: 'ch_li_4f21', name: 'Jordan Avery', service: 'linkedin' },
  x: { key: 'x', id: null, name: null, service: 'twitter' },
  all: [{ id: 'ch_li_4f21', name: 'Jordan Avery', service: 'linkedin' }],
  limits: { scheduledPosts: 10, threadsPerChannel: 1, tags: 0, channels: 3 },
};

export const BUFFER_NOT_CONNECTED_ERROR = 'No Buffer key is saved. Connect Buffer in Setup first.';

// ---- influencers and engagement ----------------------------------------------------

const inf = (id, name, role, tier, track, location, f, c, e, last, count, whyFollow, engagementTip) => ({
  id, name, role, track, tier, location,
  linkedinUrl: `https://example.com/in/${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
  whyFollow, engagementTip,
  following: f, connected: c, engaged: e,
  lastEngagement: last, engagementCount: count, notes: '',
});

export const INFLUENCERS = [
  inf(1, 'Odalys Brennecke', 'VP of Revenue Operations', 'Tier 1', 'revops', 'Chicago, IL', true, true, true, '2026-07-16', 3,
    'Posts weekly about stage definitions and forecast hygiene.', 'Reply with a concrete example from your own funnel, not a compliment.'),
  inf(2, 'Teodor Valcourt', 'Chief Revenue Officer', 'Tier 1', 'leadership', 'Denver, CO', true, true, false, '2026-07-14', 1,
    'Writes about hiring and org design in a flat market.', 'Engage on the hiring posts; skip the product ones.'),
  inf(3, 'Marisol Kettering', 'Head of GTM Analytics', 'Tier 1', 'gtm-analytics', 'Seattle, WA', true, false, false, '2026-07-21', 1,
    'Shares attribution and forecasting models with real numbers.', 'Comment on the methodology, then send a connection note.'),
  inf(4, 'Anselm Okafor-Reyes', 'Director of Sales Operations', 'Tier 1', 'sales-ops', 'Atlanta, GA', false, false, false, null, 0,
    'Practical territory and quota design.', 'Read the feed for two weeks before commenting.'),
  inf(5, 'Linnea Hartwick', 'SVP, Revenue Strategy', 'Tier 2', 'leadership', 'Boston, MA', true, true, true, '2026-07-22', 4,
    'Strategy for revenue teams, long form and well argued.', 'Add a second angle rather than agreeing.'),
  inf(6, 'Dmitri Valenzuela-Ross', 'Senior Manager, RevOps Systems', 'Tier 2', 'revops', 'Remote', true, true, false, '2026-07-09', 1,
    'CRM architecture and integration trade-offs.', 'Ask a question about the trade-off he skipped.'),
  inf(7, 'Fenwick Adeyemi', 'Analytics Engineering Lead', 'Tier 2', 'gtm-analytics', 'Toronto, ON', true, false, false, null, 0,
    'Data modeling for go-to-market teams.', ''),
  inf(8, 'Rosalind Quillfeather', 'Founder, RevOps consultancy', 'Tier 2', 'consulting', 'Portland, OR', false, false, false, null, 0,
    'Case studies from small revenue teams.', ''),
  inf(9, 'Casimir Ndlovu', 'Director of Business Operations', 'Tier 3', 'sales-ops', 'Minneapolis, MN', true, true, false, '2026-07-02', 1,
    'Operating cadence and quarterly planning.', ''),
  inf(10, 'Wilhelmina Strand', 'Head of Enablement', 'Tier 3', 'enablement', 'Nashville, TN', true, false, false, null, 0,
    'Onboarding and ramp design.', ''),
  inf(11, 'Ignatius Beaumont-Lowe', 'Revenue Analytics Manager', 'Tier 3', 'gtm-analytics', 'Raleigh, NC', false, false, false, null, 0,
    'Dashboards that people actually use.', ''),
  inf(12, 'Calliope Vance', 'Director of RevOps, regional services firm', 'local', 'revops', 'Austin, TX', true, true, true, '2026-07-20', 3,
    'Local peer, same stack, same problems.', 'Meet in person at the next meetup.'),
  inf(13, 'Barnaby Ostrowski', 'VP of Sales, software scale-up', 'local', 'sales-ops', 'Austin, TX', true, true, false, '2026-07-17', 2,
    'Hires RevOps leaders; posts about team building.', ''),
  inf(14, 'Zenobia Lindqvist', 'Chapter lead, Austin RevOps meetup', 'local', 'community', 'Austin, TX', true, false, false, null, 0,
    'Runs the local meetup and knows everyone.', 'Volunteer to speak.'),
];

const logRow = (date, influencer, actionType, topic, message, responseReceived, connectionMade, loggedAt, notes = '') =>
  ({ date, influencer, actionType, topic, message, responseReceived, connectionMade, notes, loggedAt });

// Newest first, as the tab sorts it.
export const ENGAGEMENT_LOG = [
  logRow('2026-07-22', 'Linnea Hartwick', 'Commented', 'Territory design',
    'The point about carving territories by account potential rather than headcount matches what we saw. The part I would add: re-cut once a year, or the quota drift hides the real gaps.',
    'No', 'Connected', '2026-07-22T14:05:00.000Z'),
  logRow('2026-07-21', 'Marisol Kettering', 'Connection request', 'Reference Post: forecast accuracy',
    'Your breakdown of forecast error by stage was the clearest I have read. I would value following your work more closely.',
    'No', 'Pending', '2026-07-21T20:12:00.000Z'),
  logRow('2026-07-20', 'Calliope Vance', 'Commented', 'Meetup recap',
    'Good recap. The routing exercise was the best hour of the evening, and the exception-first approach is worth a longer session.',
    'Yes', 'Connected', '2026-07-20T18:30:00.000Z'),
  logRow('2026-07-17', 'Barnaby Ostrowski', 'Messaged', 'Coffee next week',
    'Thanks for the note on the hiring plan. Happy to compare notes on what a first RevOps hire should own.',
    'Yes', 'Connected', '2026-07-17T16:40:00.000Z', 'Offered Thursday.'),
  logRow('2026-07-16', 'Odalys Brennecke', 'Responded', 'Their reply: stage definitions',
    'Glad it was useful. Send me the version you end up with.',
    'Yes', 'Connected', '2026-07-16T15:15:00.000Z', 'Inbound reply.'),
  logRow('2026-07-15', 'Odalys Brennecke', 'Commented', 'Stage definitions',
    'We wrote one sentence per stage that a new hire could verify from the CRM alone. The disagreements in forecast calls dropped within a couple of weeks.',
    'Yes', 'Connected', '2026-07-15T14:20:00.000Z'),
  logRow('2026-07-14', 'Teodor Valcourt', 'Commented', 'Hiring in a flat market',
    'The case for hiring the second person before the first one is fully ramped is the part I keep coming back to.',
    'No', 'Connected', '2026-07-14T19:05:00.000Z'),
  logRow('2026-07-09', 'Dmitri Valenzuela-Ross', 'Reposted', 'Attribution trade-offs',
    'Reposted with a note on the first-touch limits.',
    'No', 'Connected', '2026-07-09T13:50:00.000Z'),
  logRow('2026-07-02', 'Casimir Ndlovu', 'Commented', 'Quarter-end handoffs',
    'A named owner on every handoff is the cheapest fix I know. The amount gets written down; the owner should too.',
    'No', 'Connected', '2026-07-02T17:25:00.000Z'),
];

// Text for a typical suggested comment reply (the Reply to a comment tab).
export const REPLY_SAMPLE_COMMENT =
  'This is the part most teams skip. How do you handle fields that another team insists on keeping?';
export const REPLY_SAMPLE_TEXT =
  'Fair challenge. I ask the team that wants the field to name its owner and the decision it changes. If they can, it stays and gets an owner. If they cannot, we archive it for a quarter and see who notices.';

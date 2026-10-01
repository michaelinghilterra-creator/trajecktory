/**
 * network-fixtures.mjs: invented data for the Network tab capture group.
 *
 * Everything here is made up. Persona: Jordan Avery, Austin TX, RevOps leader,
 * working the Northwind / Globex / Contoso search from capture-apps.mjs. Every
 * person has an invented name and an @example.test / example.com address, every
 * link is https://example.com/....
 *
 * The shapes follow the real server payloads:
 *   GET /api/target-talent            lib/target-talent.mjs parseTargetTalentText
 *   GET /api/target-talent/:id        routes/target-talent.mjs (adds timeline, relatedApps)
 *   GET /api/followups/stale          routes/followups.mjs buildStaleBody
 *   GET /api/referrals                routes/referrals.mjs + lib/linkedin-referrals.mjs
 *   GET /api/tt-reconcile/preview     lib/tt-reconcile-core.mjs reconcilePreview (re-implemented
 *                                     here, because importing the server lib creates folders in the
 *                                     worktree, and the rule is a few lines)
 *   GET /api/linkedin-ssi/*           routes/linkedin-ssi.mjs
 */
import { APPS } from '../capture-apps.mjs';

export const TODAY = '2026-07-22';

/** YYYY-MM-DD, n days before the frozen "today". */
const fmtYmd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
export const ago = (n) => fmtYmd(new Date(Date.UTC(2026, 6, 22) - n * 86400000));
const stamp = (n, hhmm = '09:15') => `${ago(n)} ${hhmm}`;
const iso = (n, hhmm = '15:02') => `${ago(n)}T${hhmm}:00.000Z`;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const handle = (first, last) => `${slug(first)}-${slug(last)}`;

// application status groups (templates/states.yml, summarised)
const ELIGIBLE = ['Applied', 'Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', 'Offer'];
const DEAD = ['Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'Passed', 'No Response'];
const DECISION = new Set(['hm', 'exec', 'peer']);
const normCo = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const liveApps = APPS.filter((a) => ELIGIBLE.includes(a.status));
const appByCompany = (company) => APPS.find((a) => a.company === company);

// TA Outreach + Decision Makers book (one list, split by influenceTier)
// [id, company, first, last, title, tier, tierSource, status, lastTouch, extras]
const R = [
  [1,  'Northwind Analytics', 'Corinne',  'Abelard',          'Senior Talent Partner',        'ta',     'title', 'Replied',           ago(8),  { email: true, li: true, liStatus: 'Connected', city: 'Austin', state: 'TX' }],
  [2,  'Northwind Analytics', 'Marisol',  'Tavernier',        'Chief Revenue Officer',        'exec',   'tag',   'Meeting Scheduled', ago(3),  { email: true, li: true, liStatus: 'Connected', city: 'Austin', state: 'TX', notes: 'Booked a 30 minute call for Friday. Wants to talk about consolidating three CRM instances.' }],
  [3,  'Northwind Analytics', 'Desmond',  'Aldaine',          'VP, Sales Operations',         'hm',     'tag',   'Not Contacted',     '',      { email: true, li: true, city: 'Chicago', state: 'IL' }],
  [4,  'Northwind Analytics', 'Hadley',   'Voss',             'Technical Recruiter',          'ta',     'title', 'Sent',              ago(18), { email: true }],
  [5,  'Globex Health',       'Imani',    'Rothgarten',       'Talent Acquisition Lead',      'ta',     'title', 'Sent',              ago(16), { email: true, city: 'Boston', state: 'MA' }],
  [6,  'Globex Health',       'Lucan',    'Fairweather',      'Recruiting Coordinator',       'ta',     'title', 'Not Contacted',     '',      { li: true }],
  [7,  'Globex Health',       'Leandra',  'Pellegrova',       'Chief Operating Officer',      'exec',   'tag',   'Replied',           ago(5),  { email: true, li: true, liStatus: 'Connected', city: 'Boston', state: 'MA' }],
  [8,  'Globex Health',       'Kofi',     'Brightwater',      'Director, GTM Strategy',       'peer',   'title', 'Not Contacted',     '',      { li: true, city: 'Boston', state: 'MA' }],
  [9,  'Contoso Freight',     'Philippa', 'Okafor-Lund',      'Senior Recruiter',             'ta',     'title', 'Meeting Scheduled', ago(1),  { email: true, li: true, liStatus: 'Connected', city: 'Seattle', state: 'WA' }],
  [10, 'Contoso Freight',     'Annika',   'Strandvold',       'SVP, Revenue',                 'hm',     'tag',   'Replied',           ago(2),  { email: true, li: true, liStatus: 'Connected', city: 'Seattle', state: 'WA' }],
  [11, 'Acme Robotics',       'Jasper',   'Ellingham',        'Head of Talent',               'ta',     'title', 'Not Contacted',     '',      { email: true, li: true, city: 'Denver', state: 'CO' }],
  [12, 'Acme Robotics',       'Noor',     'Halloran',         'Recruiter',                    'ta',     'title', 'Sent',              ago(15), { email: true, li: true, liStatus: 'Invite Pending' }],
  [13, 'Acme Robotics',       'Ravi',     'Castellane',       'Head of Revenue Operations',   'hm',     'tag',   'Sent',              ago(1),  { email: true, li: true, city: 'Denver', state: 'CO' }],
  [14, 'Acme Robotics',       'Odalys',   'Fennimore',        'VP, Finance',                  'peer',   'title', 'Drafted',           '',      { email: true }],
  [15, 'Fabrikam Freight',    'Dagny',    'Whitlock',         'Talent Acquisition Manager',   'ta',     'title', 'Not Contacted',     '',      { li: true, city: 'Atlanta', state: 'GA' }],
  [16, 'Fabrikam Freight',    'Silas',    'Marchetti',        'Recruiter',                    'ta',     'title', 'Sent',              ago(9),  { email: true, li: true, liStatus: 'Invite Pending' }],
  [17, 'Hooli Systems',       'Odette',   'Brannigan',        'Recruiting Lead',              'ta',     'title', 'Not Contacted',     '',      { email: true, li: true }],
  [18, 'Oscorp Health',       'Callum',   'Ferreira-Stone',   'Talent Partner',               'ta',     'title', 'Sent',              ago(47), { li: true, notes: 'Three LinkedIn nudges, no reply.' }],
  [19, 'Cyberdyne Cloud',     'Rhiannon', 'Deveraux',         'Talent Partner',               'ta',     'title', 'Sent',              ago(14), { li: true, liStatus: 'Connected', liUpdated: ago(8) }],
  [20, 'Duff Beverages',      'Marguerite', 'Ashdown',        'Agency Recruiter, Ashdown Search', 'agency', 'title', 'Sent',          ago(11), { email: true, city: 'Dallas', state: 'TX' }],
  [21, 'Planet Express',      'Quillon',  'Ashgrove',         'Talent Acquisition Partner',   'ta',     'title', 'Not Contacted',     '',      { email: true }],
  [22, 'Planet Express',      'Mirela',   'Dragoun',          'VP, Customer Operations',      'hm',     'tag',   'Not Contacted',     '',      { email: true, li: true }],
  [23, 'Wayne Logistics',     'Elspeth',  'Marlowe-Gray',     'Recruiter',                    'ta',     'title', 'Dormant',           ago(60), { email: true }],
  [24, 'Aperture Labs',       'Percival', 'Nash',             'Director of Analytics',        'peer',   'title', 'Dormant',           ago(52), { li: true }],
  [25, 'Dunder Paper Co',     'Cyril',    'Haverford',        'Recruiter',                    'ta',     'title', 'Sent',              ago(35), { email: true }],
  [26, 'Vertex Foods',        'Anselm',   'Rourke',           'Talent Acquisition Specialist','ta',     'title', 'Archived',          ago(70), { email: true }],
  [27, 'Stark Freight',       'Winifred', 'Oyelaran',         'Recruiter',                    'ta',     'title', 'Archived',          ago(66), { email: true }],
  [28, 'Soylent Systems',     'Gideon',   'Falkner-Ross',     'Director, Sales Strategy',     'peer',   'title', 'Archived',          ago(61), { li: true }],
];

export const TT_ROWS = R.map(([id, company, first, last, title, tier, tierSource, status, lastTouch, o]) => {
  const email = o.email ? `${slug(first)}.${slug(last)}@example.test` : '';
  return {
    id, company, last, first, salute: '', title,
    city: o.city || '', state: o.state || '', zip: '', phone: '',
    email,
    linkedin: o.li ? `https://example.com/in/${handle(first, last)}` : '',
    status, lastTouch, notes: o.notes || '', website: 'https://example.com',
    influenceTier: tier, influenceTierSource: tierSource,
    provenance: {}, provenanceStale: false,
    isPrincipal: tier === 'hm',
    verified: email
      ? { state: 'ok', source: 'millionverifier', date: ago(12), score: 0.97, address: email, hadTag: true }
      : { state: 'unverified', source: '', date: '', score: null, address: '', hadTag: false },
    linkedinStatus: o.liStatus || 'Not Connected',
    liUpdated: o.liUpdated || '',
    isHighValue: DECISION.has(tier),
  };
});
const ttById = (id) => TT_ROWS.find((r) => r.id === Number(id));
export const ttList = () => TT_ROWS.map(({ liUpdated, ...rest }) => rest);

// related applications at a company
export const relatedApps = (company) =>
  APPS.filter((a) => a.company === company).map((a) => ({
    id: a.id, company: a.company, role: a.role, score: `${a.score.toFixed(1)}/5`, status: a.status, date: a.date, report: a.report,
  }));

// correspondence timelines for the drawers
const ev = (at, kind, subject, body, store = 'ta', extra = {}) => ({
  at, kind, direction: kind === 'reply-received' || kind === 'invite-accepted' ? 'Received' : 'Sent',
  channel: kind.startsWith('invite') || kind === 'dm-sent' ? 'LinkedIn' : 'Email', subject, body, store, ...extra,
});
const TIMELINES = {
  // Corinne Abelard (TA, Northwind): the full warm path, invite to reply.
  1: [
    ev(stamp(22, '10:05'), 'invite-sent', 'LinkedIn connection request', 'Hi Corinne, I applied for the VP, Revenue Operations role at Northwind and would like to follow your team. Jordan'),
    ev(ago(20), 'invite-accepted', 'LinkedIn invitation accepted', ''),
    ev(stamp(14, '09:40'), 'email-sent', 'Following up on my Northwind application',
      'Hi Corinne,\n\nThanks for connecting. I applied for the VP, Revenue Operations role last week and wanted to put a face to the resume. Happy to share a one page summary of the carrier scorecard work if useful.\n\nBest,\nJordan Avery'),
    ev(stamp(8, '14:22'), 'reply-received', 'Re: Following up on my Northwind application',
      'Hi Jordan, thanks for the note. Your profile is with the hiring team and the CRO has asked to see it. I will let you know when a call is scheduled.\n\nCorinne'),
  ],
  // Marisol Tavernier (exec, Northwind): a decision-maker thread.
  2: [
    ev(stamp(10, '08:50'), 'email-sent', 'Consolidating three CRMs into one forecast',
      'Hi Marisol,\n\nI applied for the VP, Revenue Operations role. Northwind\'s two acquisitions left three CRM instances, and that is the exact problem I solved at my last company. I would welcome fifteen minutes to compare notes.\n\nBest,\nJordan Avery'),
    ev(stamp(7, '16:11'), 'reply-received', 'Re: Consolidating three CRMs into one forecast',
      'Jordan, this is timely. Can you do a call Friday at 2 pm Central? I would like to hear how you sequenced the consolidation.\n\nMarisol'),
    ev(stamp(3, '09:02'), 'email-sent', 'Re: Consolidating three CRMs into one forecast',
      'Friday at 2 pm Central works. I will send a short outline of the sequencing beforehand.\n\nBest,\nJordan'),
  ],
};
const defaultTimeline = (row) => row.lastTouch && row.status !== 'Not Contacted' && row.status !== 'Archived'
  ? [ev(`${row.lastTouch} 09:30`, 'email-sent', `Re: ${(appByCompany(row.company) || {}).role || 'your open role'}`, 'Hi, I applied last week and wanted to introduce myself. Happy to send anything that helps.\n\nBest,\nJordan Avery')]
  : [];

/** GET /api/target-talent/:id */
export function ttDetail(id) {
  const row = ttById(id);
  if (!row) return null;
  const { liUpdated, ...contact } = row;
  const timeline = TIMELINES[row.id] || defaultTimeline(row);
  const refs = [`ta:${row.id}`];
  // Two contacts are also in the Referrals book, so their card says so.
  if (row.id === 10) refs.push('referral:1');
  if (row.id === 7) refs.push('referral:2');
  return {
    ...contact,
    correspondence: timeline.filter((e) => e.kind !== 'invite-accepted').map((e) => ({ timestamp: e.at, direction: e.direction, channel: e.channel, subject: e.subject, body: e.body })),
    relatedApps: relatedApps(row.company),
    person: { id: `person:${row.id}`, name: `${row.first} ${row.last}`, company: row.company, refs, matchedBy: refs.length > 1 ? 'linkedinKey' : null },
    timeline,
    personLastTouch: row.lastTouch || null,
  };
}

// sequence templates + per-contact state
export const SEQUENCE_TEMPLATES = [
  { id: 'cold-intro-principal', label: 'Cold intro to hiring principal', scenario: 'You have found the VP or Director who leads the target function. Open with one concrete proof point and ask for a short connection.',
    touches: [{ id: 't1', dayOffset: 0, label: 'Cold intro' }, { id: 't2', dayOffset: 7, label: 'Follow-up' }, { id: 't3', dayOffset: 14, label: 'Final ping' }] },
  { id: 'cold-intro-cro', label: 'Cold intro to the CRO', scenario: 'You have found the CRO. Open with a point of view on pipeline coverage, grounded in one observation about their revenue engine.',
    touches: [{ id: 't1', dayOffset: 0, label: 'Cold intro' }, { id: 't2', dayOffset: 7, label: 'Follow-up' }, { id: 't3', dayOffset: 14, label: 'Final ping' }] },
  { id: 'keep-warm', label: 'Keep a recruiter warm', scenario: 'A recruiter replied but nothing is scheduled. Check in lightly and offer something useful.',
    touches: [{ id: 't1', dayOffset: 0, label: 'Check in' }, { id: 't2', dayOffset: 10, label: 'Share an update' }] },
];
export const sequenceState = (id) => (Number(id) === 2
  ? { sequenceId: 'cold-intro-cro', step: 1, paused: false, completedAt: null, nextStepDue: ago(-7) }
  : null);

// the follow-up queue (data.contactFollowups)
const outreach = (o = {}) => ({
  lastTouch: null, touchedToday: null, selfLastTouch: null, companyLastComms: null,
  selfSentToday: null, companyContactsSentToday: 0, influentialSentToday: false, ...o,
});
const q = (row, o) => {
  const hasEmail = !!row.email;
  const hasLi = !!row.linkedin;
  return {
    source: 'ta', id: row.id, name: `${row.first} ${row.last}`, firstName: row.first, role: row.title, title: row.title,
    company: row.company, linkedin: row.linkedin, email: row.email, status: row.status, hasEmail, emailState: hasEmail ? 'ok' : 'unverified',
    connectedOn: '', reason: row.notes, isNew: false, notContacted: row.status === 'Not Contacted',
    isPrincipal: row.isPrincipal, influenceTier: row.influenceTier, channelBucket: hasEmail && hasLi ? 3 : hasEmail ? 2 : 1,
    channel: hasEmail && hasLi ? 'both' : hasEmail ? 'email' : 'linkedin',
    linkedinStatus: row.linkedinStatus, daysSinceLastTouch: row.lastTouch ? Math.round((Date.UTC(2026, 6, 22) - Date.parse(row.lastTouch)) / 86400000) : null,
    blocks: [], nextEligible: null, inmailBlocked: false, inmailReserved: false, heldDaily: false, heldStakeholderGap: false, capped: false,
    appScore: (appByCompany(row.company) || {}).score ?? null, rank: 50, ...o,
  };
};
const T = (id) => ttById(id);

const rowJust = q(T(19), {
  queueReason: 'Just connected', channel: 'linkedin', stickyChannel: true, freeDm: true, linkedinStatus: 'Connected', connectedOn: ago(8), rank: 200, notContacted: false,
  companyOutreach: outreach({ selfLastTouch: { date: ago(14), direction: 'Sent', channel: 'linkedin' } }),
});
const rowDesmond = q(T(3), {
  queueReason: 'Reach out', rank: 160, isHighValue: true,
  companyOutreach: outreach({ companyLastComms: { name: 'Corinne Abelard', date: ago(8), direction: 'Received', channel: 'email' } }),
});
const rowJasper = q(T(11), {
  queueReason: 'Reach out', rank: 120, isNew: true,
  companyOutreach: outreach({ companyLastComms: { name: 'Noor Halloran', date: ago(15), direction: 'Sent', channel: 'email' } }),
});
const rowCorinne = q(T(1), {
  queueReason: 'App going stale', rank: 110, coachLevel: 'overdue', coachVerdict: '2nd round silent 8 days.',
  appStale: { appId: 412, appRole: 'VP, Revenue Operations', status: '2nd Interview', days: 8, coachLevel: 'overdue', score: 4.6 },
  companyOutreach: outreach({ selfLastTouch: { date: ago(8), direction: 'Received', channel: 'email' }, companyLastComms: { name: 'Marisol Tavernier', date: ago(3), direction: 'Sent', channel: 'email' } }),
});
const rowSilas = q(T(16), {
  queueReason: 'Follow up', rank: 90,
  companyOutreach: outreach({ selfLastTouch: { date: ago(9), direction: 'Sent', channel: 'linkedin' }, companyLastComms: null }),
});
const rowImani = q(T(5), {
  queueReason: 'App going stale', rank: 85, coachLevel: 'overdue', coachVerdict: 'Phone screen silent 5 days.',
  appStale: { appId: 408, appRole: 'Director, GTM Operations', status: 'Phone Screen', days: 5, coachLevel: 'overdue', score: 4.1 },
  companyOutreach: outreach({ selfLastTouch: { date: ago(16), direction: 'Sent', channel: 'email' }, companyLastComms: { name: 'Leandra Pellegrova', date: ago(5), direction: 'Received', channel: 'email' } }),
});
const rowMarguerite = q(T(20), {
  queueReason: 'Sequence due', rank: 70, coachLevel: 'overdue', coachVerdict: 'Follow-up due (day 7).',
  companyOutreach: outreach({ selfLastTouch: { date: ago(11), direction: 'Sent', channel: 'email' } }),
});
const rowDagny = q(T(15), {
  queueReason: 'Reach out', isNew: true, rank: 60,
  companyOutreach: outreach({ companyLastComms: { name: 'Silas Marchetti', date: ago(9), direction: 'Sent', channel: 'linkedin' } }),
});
const rowQuillon = q(T(21), {
  queueReason: 'Reach out', rank: 55,
  companyOutreach: outreach(),
});

// Referrals and influencers share the queue's card. Today the live feed is built
// from the TA book, so these two groups are included for the Contact type filter.
const rowWilhelmina = {
  source: 'referral', id: 3, name: 'Wilhelmina Achterberg', firstName: 'Wilhelmina', role: 'Senior Director, Field Operations', title: 'Senior Director, Field Operations',
  company: 'Globex Health', linkedin: 'https://example.com/in/wilhelmina-achterberg', email: 'wilhelmina.achterberg@example.test', status: 'Asked',
  hasEmail: true, emailState: 'ok', connectedOn: '', reason: 'Senior Director, Field Operations · connected 03 Nov 2020', isNew: false, notContacted: false,
  isPrincipal: false, influenceTier: 'ta', channelBucket: 3, channel: 'both', queueReason: 'Follow up', freeDm: true, daysSinceLastTouch: 16, rank: 100,
  blocks: [], nextEligible: null, heldDaily: false, capped: false, appScore: 4.1,
  companyOutreach: outreach({ selfLastTouch: { date: ago(16), direction: 'Sent', channel: 'email' }, companyLastComms: { name: 'Leandra Pellegrova', date: ago(5), direction: 'Received', channel: 'email' } }),
};
const rowBastien = {
  source: 'referral', id: 4, name: 'Bastien Orlowski', firstName: 'Bastien', role: 'Director, Sales Enablement', title: 'Director, Sales Enablement',
  company: 'Northwind Analytics', linkedin: 'https://example.com/in/bastien-orlowski', email: '', status: 'Not Asked',
  hasEmail: false, emailState: 'unverified', connectedOn: '', reason: 'Director, Sales Enablement · connected 21 Aug 2022', isNew: false, notContacted: true,
  isPrincipal: false, influenceTier: 'ta', channelBucket: 1, channel: 'linkedin', queueReason: 'Reach out', freeDm: true, daysSinceLastTouch: null, rank: 95,
  blocks: [], nextEligible: null, heldDaily: false, capped: false, appScore: 4.6,
  companyOutreach: outreach({ companyLastComms: { name: 'Corinne Abelard', date: ago(8), direction: 'Received', channel: 'email' } }),
};
const infl = (id, name, role, company, days, extra = {}) => ({
  source: 'influencer', id, name, firstName: name.split(' ')[0], role, title: role, company,
  linkedin: `https://example.com/in/${handle(...name.split(' '))}`, email: '', status: 'Connected', hasEmail: false, emailState: 'unverified', connectedOn: '',
  reason: '', isNew: false, notContacted: false, isPrincipal: false, influenceTier: 'ta', channelBucket: 1, channel: 'linkedin',
  queueReason: 'Follow up', daysSinceLastTouch: days, rank: 40, blocks: [], nextEligible: null, heldDaily: false, capped: false, appScore: null,
  companyOutreach: outreach({ selfLastTouch: days == null ? null : { date: ago(days), direction: 'Sent', channel: 'linkedin' } }),
  ...extra,
});
const rowInfl1 = infl(4, 'Lysander Pruitt', 'Founder, Pipeline Collective', 'Pipeline Collective', 13);
const rowInfl2 = infl(7, 'Wendeline Parrish', 'RevOps Consultant', 'Parrish Advisory', 20);

// Held rows: each is flagged, not dropped, and returns on its own.
const heldRavi = q(T(13), {
  queueReason: 'Follow up', rank: 130, isHighValue: true,
  blocks: [{ rule: 'crossChannelRest', reason: 'You reached them on another channel 1 day ago. Give them a rest day before the next touch.', until: ago(-1) }],
  nextEligible: ago(-1),
  companyOutreach: outreach({ selfLastTouch: { date: ago(1), direction: 'Sent', channel: 'email' } }),
});
const heldCallum = q(T(18), {
  queueReason: 'App going stale', rank: 75, coachLevel: 'overdue', coachVerdict: '1st round silent 47 days.',
  appStale: { appId: 306, appRole: 'Head of GTM Analytics', status: '1st Interview', days: 47, coachLevel: 'overdue', score: 4.1 },
  capped: true, capState: { linkedin: { sent: 3, cap: 3 }, email: { sent: 0, cap: 3 } },
  blocks: [{ rule: 'coldOutreachCap', reason: 'This channel is blocked until they reply.', until: null }],
  companyOutreach: outreach({ selfLastTouch: { date: ago(47), direction: 'Sent', channel: 'linkedin' } }),
});
const heldLucan = q(T(6), {
  queueReason: 'Reach out', rank: 58, heldDaily: true, isNew: true,
  blocks: [{ rule: 'perCompanyPerDay', reason: 'You have already contacted 3 people at this company today.', until: ago(-1) }],
  nextEligible: ago(-1),
  companyOutreach: outreach({ touchedToday: { name: 'Leandra Pellegrova', channel: 'email' }, companyContactsSentToday: 3, companyLastComms: { name: 'Leandra Pellegrova', date: TODAY, direction: 'Sent', channel: 'email' } }),
});
// Order: ranked. The held rows sit just under the first card so "Show anyway" reads well.
export const CONTACT_FOLLOWUPS = [
  rowJust, heldRavi, heldCallum, heldLucan,
  rowDesmond, rowJasper, rowCorinne, rowWilhelmina, rowSilas, rowImani, rowMarguerite, rowBastien, rowDagny, rowQuillon, rowInfl1, rowInfl2,
];
export const TA_ONLY_FOLLOWUPS = CONTACT_FOLLOWUPS.filter((c) => c.source === 'ta');

export const SNOOZED_CONTACTS = [
  { ...q(T(17), { queueReason: 'Reach out', rank: 50 }), snoozeUntil: ago(-12) },
];

// Application-level nudges (the Find a contact / Reach a decision-maker cards).
const hasContact = new Set(TT_ROWS.map((r) => normCo(r.company)));
const byCompany = new Map();
for (const r of TT_ROWS.filter((x) => x.status !== 'Archived')) {
  const k = normCo(r.company);
  if (!byCompany.has(k)) byCompany.set(k, []);
  byCompany.get(k).push(r);
}
export const CONTACTLESS_APPS = liveApps
  .filter((a) => !hasContact.has(normCo(a.company)))
  .map((a) => ({ source: 'app', id: a.id, company: a.company, role: a.role, status: a.status, applyDate: a.date, score: a.score }))
  .sort((a, b) => b.applyDate.localeCompare(a.applyDate));
const RANK = { hm: 4, exec: 3, peer: 2, ta: 1, agency: 0 };
export const UNTHREADED_APPS = liveApps
  .filter((a) => {
    const rows = byCompany.get(normCo(a.company)) || [];
    return rows.length > 0 && !rows.some((r) => DECISION.has(r.influenceTier));
  })
  .map((a) => {
    const rows = byCompany.get(normCo(a.company));
    const top = rows.slice().sort((x, y) => RANK[y.influenceTier] - RANK[x.influenceTier])[0];
    return { source: 'stakeholder', id: a.id, company: a.company, role: a.role, status: a.status, applyDate: a.date, score: a.score, contactCount: rows.length, topTier: top.influenceTier };
  })
  .sort((a, b) => b.applyDate.localeCompare(a.applyDate));

/** GET /api/followups/stale. `contacts` lets a caller swap the queue rows. */
export function staleBody(contacts = CONTACT_FOLLOWUPS) {
  const actionableCount = contacts.filter((c) => c.blocks.length === 0).length;
  return {
    thresholds: { 'Phone Screen': 3, '1st Interview': 3, '2nd Interview': 3, '3rd Interview': 3 },
    taThreshold: 14,
    warm: [], cold: [], snoozed: [],
    contactlessApps: CONTACTLESS_APPS,
    unthreadedApps: UNTHREADED_APPS,
    staleAppContacts: [],
    actionableCount,
    withheldDailyCount: contacts.filter((c) => c.heldDaily).length,
    inmailBlockedCount: 0, inmailReservedCount: 0,
    perCompanyPerDay: 3,
    contactFollowups: contacts,
    snoozedContactFollowups: SNOOZED_CONTACTS,
    items: [],
  };
}

export const PENDING_ACCEPTANCES = [
  { id: 12, name: 'Noor Halloran', company: 'Acme Robotics', connectedOn: ago(2) },
  { id: 16, name: 'Silas Marchetti', company: 'Fabrikam Freight', connectedOn: ago(3) },
];
export const MERGE_SUGGESTIONS = [
  { a: 'referral:1', b: 'ta:10', reason: 'Same company, and they share a name.', confidence: 'low',
    left: { name: 'Annika Strandvold', company: 'Contoso Freight', store: 'referral' }, right: { name: 'Annika Strandvold', company: 'Contoso Freight', store: 'ta' } },
  { a: 'referral:2', b: 'ta:7', reason: 'Same company, and they share a name.', confidence: 'low',
    left: { name: 'Leandra Pellegrova', company: 'Globex Health', store: 'referral' }, right: { name: 'Leandra Pellegrova', company: 'Globex Health', store: 'ta' } },
];
export const MUTED = [{ source: 'ta', id: '4', name: 'Hadley Voss', company: 'Northwind Analytics' }];
export const INMAIL = { remaining: 7, allotment: 15, period: '2026-07' };

// drafts
export const DRAFTS = {
  connectNote: {
    response: 'Hi Desmond, I applied for the VP, Revenue Operations role at Northwind. At my last company I rebuilt carrier scorecarding and lane costing, and I would value ten minutes to hear how your team thinks about forecasting. Happy to connect. Jordan',
  },
  email: {
    subject: 'Quick question on the RevOps role at Northwind',
    body: 'I applied for the VP, Revenue Operations role last week and wanted to introduce myself directly. At my last company I consolidated three CRM instances into a single forecast, which cut weekly reporting time by about a third.\n\nI would welcome fifteen minutes to hear what your team needs most from this hire. If it helps, I can send a one page summary of the approach first.',
  },
  linkedinDm: {
    body: 'Thanks for connecting, Rhiannon. I applied for the Director, Revenue Enablement role at Cyberdyne Cloud last month and would love to understand how the team is thinking about the hire. Is there a good time this week for a short call?',
  },
};

// Referrals
const ACTIVE_COMPANIES = new Set(liveApps.map((a) => a.company));
const LI = '1st-degree LinkedIn connection';
// [id, name, how, where, target, status, lastTouch, notes, email]
const REF = [
  [1,  'Annika Strandvold',      LI, 'Contoso Freight',     'Contoso Freight - Director, Revenue Operations', 'Intro Made',          ago(5),  'SVP, Revenue · connected 12 Mar 2019', 'annika.strandvold@example.test'],
  [2,  'Leandra Pellegrova',     LI, 'Globex Health',       'Globex Health - Director, GTM Operations',       'Not Asked',           '',      'Chief Operating Officer · connected 02 Jun 2018', ''],
  [3,  'Wilhelmina Achterberg',  LI, 'Globex Health',       'Globex Health - Director, GTM Operations',       'Asked',               ago(16), 'Senior Director, Field Operations · connected 03 Nov 2020', 'wilhelmina.achterberg@example.test'],
  [4,  'Bastien Orlowski',       LI, 'Northwind Analytics', 'Northwind Analytics - VP, Revenue Operations',   'Not Asked',           '',      'Director, Sales Enablement · connected 21 Aug 2022', ''],
  [5,  'Theodora Iglesias-Wynn', LI, 'Acme Robotics',       'Acme Robotics - Head of Revenue Operations',     'Catching Up',         ago(9),  'Program Director · connected 14 Jan 2021', ''],
  [6,  'Cosmo Hargreave',        LI, 'Hooli Systems',       'Hooli Systems - Director, Revenue Operations',   'Responded',           ago(6),  'VP, Partnerships · connected 30 Sep 2017', 'cosmo.hargreave@example.test'],
  [7,  'Yevgenia Palmquist',     LI, 'Oscorp Health',       'Oscorp Health - Head of GTM Analytics',          'Not Asked',           '',      'Senior Manager, Analytics · connected 08 Apr 2023', ''],
  [8,  'Lorcan Abernathy-Shaw',  LI, 'Planet Express',      'Planet Express - VP, Customer Operations',       'Applied w/ Referral', ago(2),  'Director, Customer Success · connected 19 Feb 2019', 'lorcan.abernathy@example.test'],
  [9,  'Rosalind Tuckerman',     LI, 'Duff Beverages',      'Duff Beverages - Director of Sales Operations',  'Not Asked',           '',      'Regional Sales Director · connected 11 Jul 2021', ''],
  [10, 'Ambrose Kettleworth',    LI, 'Halcyon Freight',     '',                                               'Not Asked',           '',      'VP, Sales · connected 05 May 2016', ''],
  [11, 'Philomena Duquesne',     LI, 'Brightline Advisory', '',                                               'Catching Up',         ago(21), 'Managing Partner · connected 17 Oct 2018', ''],
  [12, 'Raoul Vandenbrink',      LI, 'Ostrander Partners',  '',                                               'Not Asked',           '',      'Chief of Staff · connected 23 Mar 2022', ''],
  [13, 'Saskia Montclair',       LI, 'Halcyon Freight',     '',                                               'Not Asked',           '',      'Director, Revenue Operations · connected 09 Dec 2019', ''],
  [14, 'Ignatius Bellweather',   LI, 'Marlowe & Finch',     '',                                               'Dormant',             ago(80), 'SVP, Sales · connected 28 Jan 2015', ''],
  [15, 'Henrietta Coldwater',    'Former manager at a logistics startup', 'Tyrell Robotics · VP of Sales', 'Tyrell Robotics', 'Asked', ago(12), 'Offered to put me in touch with their RevOps lead.', 'henrietta.coldwater@example.test'],
  [16, 'Dorian Featherstone',    'Met at a RevOps meetup',                'Gringotts Capital · Head of Sales', 'Gringotts Capital', 'Not Asked', '', 'Runs the local meetup.', ''],
  [17, 'Euphemia Rowntree',      LI, 'Wayne Logistics',     '',                                               'Archived',            '',      'Director, Sales · connected 04 Aug 2020', ''],
  [18, 'Caspian Thornbury',      LI, 'Aperture Labs',       '',                                               'Archived',            '',      'VP, Analytics · connected 26 Nov 2019', ''],
  [19, 'Octavia Lindqvist-Pryce', LI, 'Vertex Foods',       '',                                               'Archived',            '',      'Head of Revenue Operations · connected 15 Jun 2017', ''],
];
export const REFERRAL_STATUSES = ['Not Asked', 'Catching Up', 'Asked', 'Responded', 'Intro Made', 'Applied w/ Referral', 'No', 'Dormant'];
export const REFERRAL_ROWS = REF.map(([id, name, how, where, target, status, lastTouch, notes, email]) => {
  const isLi = /linkedin/i.test(how);
  const stage = !isLi ? 'other' : ACTIVE_COMPANIES.has(where) ? 'stage1' : 'stage2';
  return {
    id, name, how, where, target, status, lastTouch, notes,
    linkedin: isLi ? `https://example.com/in/${handle(...name.split(' '))}` : '',
    email,
    verified: email ? { state: 'ok', source: 'millionverifier', date: ago(10), score: 0.96, address: email, hadTag: true } : { state: 'unverified', source: '', date: '', score: null, address: '', hadTag: false },
    stage,
  };
});
export const REFERRAL_LINKEDIN = { count: 812, importedAt: `${ago(8)}T17:00:00.000Z`, source: 'upload' };
export const referralsPayload = () => ({ referrals: REFERRAL_ROWS, statuses: REFERRAL_STATUSES, linkedin: REFERRAL_LINKEDIN });
export const REFERRAL_FOLLOWUPS = [rowBastien, rowWilhelmina,
  { ...rowBastien, id: 7, name: 'Yevgenia Palmquist', firstName: 'Yevgenia', role: 'Senior Manager, Analytics', title: 'Senior Manager, Analytics', company: 'Oscorp Health', linkedin: 'https://example.com/in/yevgenia-palmquist', reason: 'Senior Manager, Analytics · connected 08 Apr 2023', connectedOn: '2023-04-08' },
  { ...rowBastien, id: 9, name: 'Rosalind Tuckerman', firstName: 'Rosalind', role: 'Regional Sales Director', title: 'Regional Sales Director', company: 'Duff Beverages', linkedin: 'https://example.com/in/rosalind-tuckerman', reason: 'Regional Sales Director · connected 11 Jul 2021', connectedOn: '2021-07-11' },
].map((r) => ({ ...r, where: r.company, target: (REFERRAL_ROWS.find((x) => x.id === r.id) || {}).target || '' }));

const REF_TIMELINES = {
  1: [
    ev(stamp(26, '09:05'), 'dm-sent', 'LinkedIn message', 'Hi Annika, it has been a while. I am exploring the next chapter and noticed Contoso is hiring a Director of Revenue Operations. Would you be open to a quick catch up?', 'referral'),
    ev(stamp(24, '12:30'), 'reply-received', 'Re: LinkedIn message', 'Great to hear from you, Jordan! Happy to catch up. Send me your resume and I will flag it to the hiring manager.', 'referral'),
    ev(stamp(5, '10:12'), 'email-sent', 'Thank you for the introduction', 'Hi Annika,\n\nThank you for passing my resume along. I heard from the recruiter this morning. I appreciate it.\n\nBest,\nJordan Avery', 'referral'),
  ],
};
export function referralDetail(id) {
  const row = REFERRAL_ROWS.find((r) => r.id === Number(id));
  if (!row) return null;
  const timeline = REF_TIMELINES[row.id] || (row.lastTouch ? [ev(`${row.lastTouch} 10:00`, 'email-sent', 'Catching up', 'Hi, it has been too long. I am exploring the next chapter and would love to hear what you are working on.\n\nBest,\nJordan Avery', 'referral')] : []);
  const merged = row.id === 1 || row.id === 2;
  return {
    referral: row,
    link: null,
    correspondence: timeline.map((e) => ({ timestamp: e.at, direction: e.direction, channel: e.channel, subject: e.subject, body: e.body })),
    relatedApps: relatedApps(row.where),
    person: { id: `person:r${row.id}`, name: row.name, company: row.where, refs: merged ? [`referral:${row.id}`, `ta:${row.id === 1 ? 10 : 7}`] : [`referral:${row.id}`], matchedBy: merged ? 'linkedinKey' : null },
    timeline,
    personLastTouch: row.lastTouch || null,
  };
}

// Reconcile
/** The same decision as lib/tt-reconcile-core.mjs reconcilePreview, on the invented tracker. */
export function reconcilePreview(mode) {
  const rows = TT_ROWS.filter((r) => r.status !== 'Archived');
  const byCo = new Map();
  for (const a of APPS) {
    const k = normCo(a.company);
    if (!byCo.has(k)) byCo.set(k, []);
    byCo.get(k).push(a);
  }
  const isDM = (r) => DECISION.has(r.influenceTier);
  const toArchive = [];
  for (const c of rows) {
    const apps = byCo.get(normCo(c.company)) || [];
    if (!apps.length || !apps.every((a) => DEAD.includes(a.status))) continue;
    toArchive.push({
      id: c.id, first: c.first, last: c.last, company: c.company, title: c.title,
      reason: `${apps.length} application${apps.length === 1 ? '' : 's'} closed (${apps.map((a) => a.status).slice(0, 3).join(', ')})`,
      relatedApps: apps.map((a) => ({ id: a.id, status: a.status, role: a.role, date: a.date })),
    });
  }
  const scoped = mode ? toArchive.filter((c) => (mode === 'principal') === isDM(ttById(c.id))) : toArchive;
  const ttCos = new Set(rows.map((c) => normCo(c.company)));
  const needContacts = [];
  const needPrincipal = [];
  for (const [k, apps] of byCo.entries()) {
    const live = apps.filter((a) => ELIGIBLE.includes(a.status));
    if (!live.length) continue;
    const recent = live.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const mostRecentApp = { id: recent.id, role: recent.role, status: recent.status, date: recent.date };
    if (!ttCos.has(k)) {
      needContacts.push({ company: recent.company, exampleRole: recent.role, appCount: live.length, mostRecentApp });
      continue;
    }
    const contacts = rows.filter((r) => normCo(r.company) === k);
    if (!contacts.some(isDM)) needPrincipal.push({ company: recent.company, exampleRole: recent.role, appCount: live.length, mostRecentApp, contactCount: contacts.length });
  }
  needContacts.sort((a, b) => b.mostRecentApp.date.localeCompare(a.mostRecentApp.date));
  needPrincipal.sort((a, b) => b.mostRecentApp.date.localeCompare(a.mostRecentApp.date));
  return { toArchive: scoped, companiesNeedingContacts: needContacts, companiesNeedingPrincipal: needPrincipal, searchCapped: 0 };
}

const sug = (first, last, title, linkedinSlug, confidence, notes) => ({ first, last, title, linkedin: `https://example.com/in/${linkedinSlug}`, confidence, notes, city: '', state: '' });
/** A discovery run caught mid-flight for the Decision Makers reconcile. */
export const DISCOVER_JOB = {
  jobId: 'job-capture-0001', mode: 'principal', status: 'running', total: 5, done: 3,
  current: ['Hooli Systems', 'Duff Beverages'],
  results: [
    { company: 'Fabrikam Freight', search: 'principal', rejected: [], duplicates: 0,
      suggestions: [sug('Thessaly', 'Pemberton-Cole', 'VP, Sales Operations', 'thessaly-pemberton-cole', 'High', 'Leads the sales operations team this role reports into.')] },
    { company: 'Oscorp Health', search: 'principal', rejected: [], duplicates: 0,
      suggestions: [sug('Barnaby', 'Quillfeather', 'Chief Revenue Officer', 'barnaby-quillfeather', 'High', 'Named as the executive sponsor in the job posting.'),
        sug('Marguerite', 'Vanterpool', 'Senior Director, GTM Analytics', 'marguerite-vanterpool', 'Medium', 'Owns the analytics function.')] },
    { company: 'Cyberdyne Cloud', search: 'principal', rejected: [], duplicates: 0,
      suggestions: [sug('Eustace', 'Ravenscroft', 'VP, Revenue Enablement', 'eustace-ravenscroft', 'Medium', 'Hiring manager for the enablement team.')] },
  ],
  errors: [], startedAt: 1790000000000, finishedAt: null,
};
export const DISCOVER_JOB_DONE = {
  ...DISCOVER_JOB, status: 'done', done: 5, current: [],
  results: [...DISCOVER_JOB.results,
    { company: 'Hooli Systems', search: 'principal', rejected: [], duplicates: 0,
      suggestions: [sug('Alaric', 'Stonehaven', 'Chief Revenue Officer', 'alaric-stonehaven', 'High', 'Executive sponsor for the revenue operations team.')] },
    { company: 'Duff Beverages', search: 'principal', rejected: [], duplicates: 0,
      suggestions: [sug('Seraphina', 'Oyelowo-Marsh', 'VP, Sales Operations', 'seraphina-oyelowo-marsh', 'Medium', 'Leads sales operations for the beverage division.')] }],
  finishedAt: 1790000090000,
};

// Influencers
const INF = (id, name, role, track, tier, location, flags, last, count, why, tip) => ({
  id, name, role, track, tier, location, linkedinUrl: `https://example.com/in/${handle(...name.split(' '))}`,
  whyFollow: why, engagementTip: tip, following: flags[0], connected: flags[1], engaged: flags[2],
  lastEngagement: last, engagementCount: count, notes: '',
});
export const INFLUENCERS = [
  INF(1,  'Calista Verhoeven',     'Chief Revenue Officer',         'revops',    'Tier 1', 'Remote',      [true, true, true],    ago(1), 7, 'Posts weekly on forecast discipline and pipeline coverage.', 'Add one data point from your own work, never just praise.'),
  INF(2,  'Thaddeus Okwuosa',      'VP of Revenue Operations',      'revops',    'Tier 1', 'Dallas, TX',  [true, true, false],   ago(5), 3, 'Writes about RevOps team design at scale.', 'Ask a concrete question about his hiring ladder.'),
  INF(3,  'Marisela Quintrell',    'Head of Sales Strategy',        'strategy',  'Tier 2', 'Remote',      [true, false, false],  '',      0, 'Shares operating cadences and QBR templates.', 'Comment on one QBR post before sending a request.'),
  INF(4,  'Lysander Pruitt',       'Founder, Pipeline Collective',  'revops',    'Tier 2', 'Austin, TX',  [true, true, true],    TODAY,  5, 'Runs the local RevOps community and hosts monthly events.', 'Mention the next meetup when you reply.'),
  INF(5,  'Ottoline Raskova',      'Director of GTM Analytics',     'analytics', 'Tier 3', 'Chicago, IL', [true, false, false],  '',      0, 'Posts dashboards and metric definitions.', 'Respond with a metric you changed and why.'),
  INF(6,  'Benedikt Ashworth-Kane', 'SVP, Customer Success',        'exec',      'Tier 3', 'Remote',      [false, false, false], '',      0, 'Adjacent to the CRO. Shares retention benchmarks.', 'Follow first, engage after two weeks of reading.'),
  INF(7,  'Wendeline Parrish',     'RevOps Consultant',             'revops',    'local',  'Austin, TX',  [true, true, false],   ago(9), 2, 'Local consultant who refers interim work.', 'Offer a short coffee chat.'),
  INF(8,  'Hollis Greenwald',      'Director, Sales Ops',           'salesops',  'local',  'Austin, TX',  [false, false, false], '',      0, 'Hiring manager at a local logistics company.', 'Engage on his hiring posts.'),
  INF(9,  'Zephyrine Okamoto-Bell', 'Principal, GTM Advisory',      'strategy',  'local',  'Austin, TX',  [true, false, false],  '',      0, 'Speaks at the regional sales summit.', 'Comment on her summit recap.'),
  INF(10, 'Ignatz Lombardi-Fisk',  'VP, Marketing Operations',      'revops',    'Tier 2', 'Remote',      [true, true, false],   ago(12), 1, 'Posts about marketing and sales handoff.', 'Share a handoff metric you improved.'),
];
const logEntry = (id, name, daysAgo, type, topic, message, resp, conn, hhmm = '15:02') => ({
  date: ago(daysAgo), influencer: name, actionType: type, topic, message, responseReceived: resp, connectionMade: conn, notes: '', loggedAt: iso(daysAgo, hhmm),
});
export const ENGAGEMENT_LOG = [
  logEntry(4, 'Lysander Pruitt', 0, 'Commented', 'Meetup recap', 'Great turnout. The forecast roundtable was the best part for me.', 'No', 'Connected', '08:40'),
  logEntry(1, 'Calista Verhoeven', 1, 'Commented', 'Forecast hygiene', 'We tracked stage exit criteria the same way and cut slipped deals by a quarter.', 'Yes', 'Connected', '16:10'),
  logEntry(4, 'Lysander Pruitt', 2, 'Messaged', 'Meetup invite', 'Thanks for the invite. I will bring a colleague to the next one.', 'Yes', 'Connected', '11:25'),
  logEntry(2, 'Thaddeus Okwuosa', 5, 'Commented', 'RevOps hiring ladder', 'How do you separate analyst and architect levels on your team?', 'No', 'Connected', '14:00'),
  logEntry(1, 'Calista Verhoeven', 6, 'Reposted', 'Pipeline coverage', '', 'No', 'Connected', '09:15'),
  logEntry(7, 'Wendeline Parrish', 9, 'Messaged', 'Coffee chat', 'Would you be open to a coffee in the next couple of weeks?', 'Yes', 'Connected', '10:30'),
  logEntry(1, 'Calista Verhoeven', 13, 'Connection request', 'Reference Post', 'Hi Calista, your forecast discipline posts changed how I run stage reviews. Would value connecting. Jordan', 'Yes', 'Connected', '13:45'),
  logEntry(10, 'Ignatz Lombardi-Fisk', 12, 'Commented', 'Marketing to sales handoff', 'The SLA on speed to lead made the biggest difference for us too.', 'No', 'Pending', '12:05'),
];
export const SSI_GENERATED = {
  response: 'This matches what we saw. Once we defined exit criteria for every stage, forecast calls stopped being about opinions and started being about evidence. The hardest part was getting sales leaders to agree that a stage is something the buyer does, not the rep.',
  connect: 'Hi Calista, your posts on forecast discipline changed how I run stage reviews, and the exit criteria approach you shared is now part of my playbook. I would value being connected. Jordan',
  reply: 'Happy to, Calista. The short version is that every stage exit criterion had to be something the buyer did, and each one fed a coverage ratio the CRO reviewed weekly. I can send a one page example if that would help your readers.',
  theirMessage: 'Thanks for the comment on my forecast post, Jordan. Would you be willing to share how you tied stage exit criteria to the forecast? A few readers asked about it.',
  post: 'Forecast hygiene is not a dashboard problem. It is a definition problem. If two reps can read the same stage and disagree about whether a deal belongs in commit, no amount of reporting will rescue the number. We spent a quarter writing buyer-verifiable exit criteria for every stage, and slipped deals fell by almost a quarter.',
};

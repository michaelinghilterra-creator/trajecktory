/**
 * interview-fixtures.mjs: invented data for the Interview capture group.
 *
 * Everything here is made up. The search is the Jordan Avery / Northwind /
 * Globex / Contoso story used across the guide. Interviewers are fictional and
 * carry @example.com style identities only (none is shown as an email).
 *
 * Shapes are copied from the real code:
 *   - sessions:       dashboard-web/server/lib/interview.mjs listSessions()
 *   - run sheets:     templates/runsheet-schema-v1.md, parsed and derived by the
 *                     REAL parseRunsheet()/derive() from render-runsheet.mjs
 *   - prep documents: markdown rendered by the REAL reportMdToHtml()
 *   - outcome items:  dashboard-web/server/routes/event-actions.mjs
 */
import { parseRunsheet, derive } from '../../../render-runsheet.mjs';
import { reportMdToHtml } from '../../../dashboard-web/server/lib/html.mjs';

const IPREP = 'C:\\Users\\you\\Documents\\trajecktory interview prep';
const pp = (co, base) => `${IPREP}\\${co}\\${base}.md`;
const rp = (co, base) => `${IPREP}\\${co}\\${base}.run.md`;

// ===========================================================================
// Sessions (GET /api/interview/sessions)
// ===========================================================================
const NW = 'Northwind Analytics';
export const SESSIONS = {
  active: [
    {
      id: 'northwind-analytics', company: NW, role: 'VP, Revenue Operations',
      status: '2nd Interview', round: 4, prepDir: `${IPREP}\\${NW}`, appId: 412,
      rounds: [
        { round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen', prepPath: pp(NW, 'northwind-analytics-round-1-recruiter-screen'), runPath: rp(NW, 'northwind-analytics-round-1-recruiter-screen'), hasBoard: true },
        { round: 2, stage: null, descriptor: 'hiring-manager', prepPath: pp(NW, 'northwind-analytics-round-2-hiring-manager'), runPath: null, hasBoard: false },
        { round: 3, stage: '2nd Interview', descriptor: 'cro-conversation', prepPath: pp(NW, 'northwind-analytics-round-3-cro-conversation'), runPath: rp(NW, 'northwind-analytics-round-3-cro-conversation'), hasBoard: true },
        { round: 4, stage: null, descriptor: 'final-loop', prepPath: pp(NW, 'northwind-analytics-round-4-final-loop'), runPath: null, hasBoard: false },
      ],
      docs: [
        { key: 'northwind-analytics-vp-revenue-operations', kind: 'intel', label: 'Company intel', name: 'Vp Revenue Operations', title: 'Northwind Analytics: company intel', path: pp(NW, 'northwind-analytics-vp-revenue-operations') },
        { key: 'northwind-analytics-vp-revenue-operations-cheat-sheet', kind: 'cheat-sheet', label: 'Cheat sheet', name: 'Vp Revenue Operations Cheat Sheet', title: 'Northwind Analytics: cheat sheet', path: pp(NW, 'northwind-analytics-vp-revenue-operations-cheat-sheet') },
      ],
    },
    {
      id: 'globex-health', company: 'Globex Health', role: 'Director, GTM Operations',
      status: 'Phone Screen', round: 1, prepDir: `${IPREP}\\Globex Health`, appId: 408,
      rounds: [
        { round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen', prepPath: pp('Globex Health', 'globex-health-round-1-recruiter-screen'), runPath: null, hasBoard: false },
      ],
      docs: [],
    },
    {
      id: 'contoso-freight', company: 'Contoso Freight', role: 'Director, Revenue Operations',
      status: 'Offer', round: 3, prepDir: `${IPREP}\\Contoso Freight`, appId: 405,
      rounds: [
        { round: 1, stage: null, descriptor: 'recruiter-screen', prepPath: pp('Contoso Freight', 'contoso-freight-round-1-recruiter-screen'), runPath: null, hasBoard: false },
        { round: 2, stage: null, descriptor: 'hiring-manager', prepPath: pp('Contoso Freight', 'contoso-freight-round-2-hiring-manager'), runPath: null, hasBoard: false },
        { round: 3, stage: null, descriptor: 'offer-call', prepPath: pp('Contoso Freight', 'contoso-freight-round-3-offer-call'), runPath: null, hasBoard: false },
      ],
      docs: [],
    },
    {
      id: 'gringotts-capital', company: 'Gringotts Capital', role: 'Head of Revenue Operations',
      status: 'Phone Screen', round: 1, prepDir: `${IPREP}\\Gringotts Capital`, appId: 327,
      rounds: [
        { round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen', prepPath: pp('Gringotts Capital', 'gringotts-capital-round-1-recruiter-screen'), runPath: null, hasBoard: false },
      ],
      docs: [],
    },
    {
      // A row at Phone Screen with nothing on disk: the tab says so plainly.
      id: 'tyrell-robotics', company: 'Tyrell Robotics', role: 'VP, Sales Operations',
      status: 'Phone Screen', round: null, prepDir: null, appId: 309,
      rounds: [], docs: [], needsPrep: true,
    },
    {
      id: 'oscorp-health', company: 'Oscorp Health', role: 'Head of GTM Analytics',
      status: '1st Interview', round: 2, prepDir: `${IPREP}\\Oscorp Health`, appId: 306,
      rounds: [
        { round: 1, stage: null, descriptor: 'recruiter-screen', prepPath: pp('Oscorp Health', 'oscorp-health-round-1-recruiter-screen'), runPath: null, hasBoard: false },
        { round: 2, stage: null, descriptor: 'hiring-manager', prepPath: pp('Oscorp Health', 'oscorp-health-round-2-hiring-manager'), runPath: null, hasBoard: false },
      ],
      docs: [],
    },
  ],
  archive: [
    {
      id: 'wayne-logistics', company: 'Wayne Logistics', role: 'Senior Manager, RevOps',
      status: 'Rejected', round: 1, prepDir: `${IPREP}\\Wayne Logistics`, appId: 303,
      rounds: [{ round: 1, stage: null, descriptor: 'recruiter-screen', prepPath: pp('Wayne Logistics', 'wayne-logistics-round-1-recruiter-screen'), runPath: null, hasBoard: false }],
      docs: [],
    },
    {
      id: 'aperture-labs', company: 'Aperture Labs', role: 'Director of Analytics',
      status: 'Rejected', round: 1, prepDir: `${IPREP}\\Aperture Labs`, appId: 318,
      rounds: [{ round: 1, stage: null, descriptor: 'recruiter-screen', prepPath: pp('Aperture Labs', 'aperture-labs-round-1-recruiter-screen'), runPath: null, hasBoard: false }],
      docs: [],
    },
  ],
};

// ===========================================================================
// Prep documents. Markdown goes through the real reportMdToHtml(), so the
// heading grammar (## §N Title) is converted exactly as the server does it.
// The section TITLES decide each section's role (strip / open / hero / probes /
// ask ...), which is what pins sections open and feeds the Cram sheet.
// ===========================================================================
function prepMarkdown(p) {
  return `# ${p.title}

> Prep for a conversation, not a script. Read the strip, say the opening, land the one story, ask the questions.

**Interviewer:** ${p.who}
**Format:** ${p.format}
**Goal of this round:** ${p.goal}
**Time budget:** ${p.budget}
**Links:** [Role posting](https://example.com/roles/${p.slug}) and [Company site](https://example.com/${p.slug})


## §0 Pre-call strip

${p.strip.map(x => `- ${x}`).join('\n')}

## §1 Mental model

${p.model}

**Do NOT:**

${p.doNot.map(x => `- ${x}`).join('\n')}

## §2 Opening: the 90-second frame

${p.frame.join('\n\n')}

## §3 Hero story

**Situation.** ${p.hero.s}

**Action.** ${p.hero.a}

**Result.** ${p.hero.r}

## §4 Behavioral bank

${p.behavioral.map(x => `- ${x}`).join('\n')}

## §5 Tradeoff probes

${p.probes.map(x => `- ${x}`).join('\n')}

**Traps:**

${p.traps.map(x => `- ${x}`).join('\n')}

## §6 Backup stories

${p.backup.map(x => `- ${x}`).join('\n')}

## §7 Questions to ask

${p.asks.map(x => `- ${x}`).join('\n')}

## §8 Logistics

${p.logistics.map(x => `- ${x}`).join('\n')}

## §9 After the call

- Write the debrief the same day, while it is fresh.
- Send a short thank-you within 24 hours and name one thing they said.
- Update the next-round intel in this file.
`;
}

const NW_R3 = {
  title: 'Northwind Analytics: round 3, CRO conversation',
  slug: 'northwind-analytics',
  who: 'Marisol Quenby, Chief Revenue Officer',
  format: 'Video, 45 minutes, one on one',
  goal: 'Show you can own the revenue operating model, then earn the final loop.',
  budget: '5 min opening, 25 min behavioral and tradeoffs, 10 min your questions, 5 min close',
  strip: [
    'Marisol joined 14 months ago and is the reason RevOps is a new function.',
    'Two acquisitions left three CRM instances. Consolidation is the live problem.',
    'She will test how you scope the first 90 days. Lead with sequencing, not tools.',
    'Never quote a comp number. That belongs with the recruiter.',
  ],
  model: 'Marisol is buying a **single operating model**: one definition of pipeline, one forecast, one owner for each number. She is not buying a tooling roadmap. Every answer should sound like a decision about who owns what.',
  doNot: [
    'Do not relitigate the old stack. They already know it was messy.',
    'Do not volunteer an analytics-only scope. The mandate is operations.',
    'Do not raise comp, title or reporting line in this round.',
  ],
  frame: [
    'Ten years turning scattered revenue data into a picture an operations team will act on. Most recently I rebuilt carrier scorecarding and lane costing end to end, then made the planners own it.',
    'That is the same shape as your problem: several systems that disagree about what a deal is worth, and no shared answer anyone trusts. I have built that shared answer once already.',
  ],
  hero: {
    s: 'Carrier performance was reported three different ways by three teams, and every weekly review started with an argument about whose number was right.',
    a: 'Built one scorecard on a single definition of on-time delivery, moved measurement to the source, and made the planners own the metric rather than my team.',
    r: 'Claims recovery improved by roughly a fifth within two quarters, and the weekly argument stopped.',
  },
  behavioral: [
    '**Peer conflict:** the CRM merge, where two teams each wanted their own object model.',
    '**A number nobody trusted:** the forecast rebuild with the reps, not for them.',
    '**A call you got wrong:** the schema freeze that I under-communicated in week one.',
    '**Influence without authority:** getting the planners to own the scorecard.',
  ],
  probes: [
    'What would you do in the first 90 days, and what would you refuse to do?',
    'Build or buy the forecast stack, and who owns it once it exists?',
    'How do you stop RevOps becoming a reporting service desk?',
    'You have not run a public-company close. Why is that not a problem here?',
  ],
  traps: [
    'Answering the 90-day question with a tool list.',
    'Spending the hero story on a behavioral question.',
  ],
  backup: [
    'Merging two CRM orgs with no reporting downtime.',
    'The forecast nobody believed, and the stage definitions that fixed it.',
  ],
  asks: [
    'Who owns the forecast today, and who do you want owning it in a year?',
    'What has to be true 90 days in for this hire to have been obviously right?',
    'What is the part of this seat you are least sure you have described accurately?',
  ],
  logistics: [
    'Friday 24 July, 2:00 PM Central, video link in the invite.',
    'Have the hero story, the CRM merge and the forecast rebuild ready to tell in under three minutes each.',
  ],
};

function genericPrep({ company, slug, who, format, goal, role }) {
  return prepMarkdown({
    title: `${company}: ${role}`,
    slug, who, format, goal,
    budget: '5 min opening, 15 min conversation, 10 min your questions',
    strip: [
      `${company} is early in this search, so expect the process question first.`,
      'Lead with the outcome, then the method. Keep every answer under two minutes.',
      'Ask about the band before you leave the call, cleanly and once.',
    ],
    model: `${who.split(',')[0]} is screening for **clarity and fit**. A crisp story with a number in it beats a long tour of your history.`,
    doNot: [
      'Do not apologise for the title step.',
      'Do not quote a comp number before they do.',
    ],
    frame: [
      'Ten years turning scattered revenue data into a picture an operations team will act on.',
      'The through line is simple: one definition, one owner, one number everyone trusts.',
    ],
    hero: {
      s: 'Three teams reported the same metric three different ways.',
      a: 'Built one scorecard on a single definition and moved ownership to the teams that act on it.',
      r: 'Claims recovery improved by roughly a fifth within two quarters.',
    },
    behavioral: [
      '**Peer conflict:** the CRM merge.',
      '**A number nobody trusted:** the forecast rebuild.',
    ],
    probes: [
      'Why this role, and why now?',
      'What would you want to change in the first 90 days?',
    ],
    traps: [
      'Reciting a CV instead of answering the question.',
    ],
    backup: ['The CRM merge with no reporting downtime.'],
    asks: [
      'What does the process look like after this call, and how long does each step usually take?',
      'What has to be true 90 days in for this hire to have been obviously right?',
    ],
    logistics: ['Calendar invite carries the link. Join five minutes early.'],
  });
}

// "round key" -> markdown. Anything not listed falls back to genericPrep().
const PREP_MD = {
  'northwind-analytics:3': prepMarkdown(NW_R3),
  'northwind-analytics:1': genericPrep({ company: NW, slug: 'northwind-analytics', who: 'Ansel Prothero, Talent Acquisition Partner', format: 'Phone, 25 minutes', goal: 'Pass the screen and get the hiring manager booked.', role: 'round 1, recruiter screen' }),
  'northwind-analytics:2': genericPrep({ company: NW, slug: 'northwind-analytics', who: 'Wendeline Hartsock, VP Sales', format: 'Video, 45 minutes', goal: 'Show the consolidation story and earn the CRO conversation.', role: 'round 2, hiring manager' }),
  'northwind-analytics:4': genericPrep({ company: NW, slug: 'northwind-analytics', who: 'Panel of four, scheduled', format: 'Video, half day', goal: 'Present the 90-day plan and be consistent across four rooms.', role: 'round 4, final loop' }),
  'globex-health:1': genericPrep({ company: 'Globex Health', slug: 'globex-health', who: 'Rosa Delgado, Senior Recruiter', format: 'Phone, 30 minutes', goal: 'Confirm fit, scope and band.', role: 'round 1, recruiter screen' }),
  'contoso-freight:1': genericPrep({ company: 'Contoso Freight', slug: 'contoso-freight', who: 'Dalia Ferncastle, Recruiter', format: 'Phone, 25 minutes', goal: 'Confirm fit and band.', role: 'round 1, recruiter screen' }),
  'contoso-freight:2': genericPrep({ company: 'Contoso Freight', slug: 'contoso-freight', who: 'Hollis Marchetti, SVP Operations', format: 'Video, 45 minutes', goal: 'Show the operating-model story.', role: 'round 2, hiring manager' }),
  'contoso-freight:3': genericPrep({ company: 'Contoso Freight', slug: 'contoso-freight', who: 'Dalia Ferncastle, Recruiter', format: 'Phone, 30 minutes', goal: 'Negotiate the offer cleanly.', role: 'round 3, offer call' }),
  'gringotts-capital:1': genericPrep({ company: 'Gringotts Capital', slug: 'gringotts-capital', who: 'Benedek Orlov, Talent Partner', format: 'Phone, 25 minutes', goal: 'Pass the screen.', role: 'round 1, recruiter screen' }),
  'oscorp-health:1': genericPrep({ company: 'Oscorp Health', slug: 'oscorp-health', who: 'Tamsin Rudgley, Recruiter', format: 'Phone, 25 minutes', goal: 'Pass the screen.', role: 'round 1, recruiter screen' }),
  'oscorp-health:2': genericPrep({ company: 'Oscorp Health', slug: 'oscorp-health', who: 'Imogen Falkirk, VP Revenue Strategy', format: 'Video, 45 minutes', goal: 'Show the analytics-to-action story.', role: 'round 2, hiring manager' }),
  'wayne-logistics:1': genericPrep({ company: 'Wayne Logistics', slug: 'wayne-logistics', who: 'Perpetua Okonkwo-Hale, Recruiter', format: 'Phone, 25 minutes', goal: 'Pass the screen.', role: 'round 1, recruiter screen' }),
  'aperture-labs:1': genericPrep({ company: 'Aperture Labs', slug: 'aperture-labs', who: 'Lucan Whitmore, Recruiter', format: 'Phone, 25 minutes', goal: 'Pass the screen.', role: 'round 1, recruiter screen' }),
};

/** HTML for GET /api/interview/prep/:id/:round, or null when the round has no file. */
export function prepFor(id, round) {
  const md = PREP_MD[`${id}:${round}`];
  return md ? { markdown: md, html: reportMdToHtml(md) } : null;
}

const DOC_INTEL_MD = `# Northwind Analytics: company intel

**Source:** public filings, the company site and two press releases.


## §0 What they sell

Northwind Analytics sells supply-chain visibility to mid-market shippers. The pitch is one shared view of shipments, carriers and cost.

## §1 Why this seat exists

Two acquisitions in eighteen months left three overlapping CRM instances. The RevOps function is new, so this hire defines it rather than inherits it.

## §2 Questions to ask the hiring manager

- Who owns the forecast today?
- What does obviously right look like at 90 days?
`;
const DOC_CHEAT_MD = `# Northwind Analytics: cheat sheet


## §0 Pre-call strip

- First senior RevOps hire under the CRO.
- Consolidation is the mandate. Analytics is the thing they already have.

## §1 Opening: 90-second frame

Ten years turning scattered revenue data into a picture an operations team will act on.

## §2 Hero story

One scorecard, one definition, planners own it. Claims recovery up roughly a fifth in two quarters.

## §3 Questions to ask

- Who owns the forecast today, and who do you want owning it in a year?
`;
export function docFor(id, key) {
  if (id !== 'northwind-analytics') return null;
  const md = key.endsWith('cheat-sheet') ? DOC_CHEAT_MD : DOC_INTEL_MD;
  return { markdown: md, html: reportMdToHtml(md), label: key.endsWith('cheat-sheet') ? 'Cheat sheet' : 'Company intel', title: md.split('\n')[0].replace(/^#\s+/, '') };
}

// ===========================================================================
// Run sheets (templates/runsheet-schema-v1.md). Built as JSON frontmatter plus a
// narrative body, then pushed through the REAL parseRunsheet() and derive(), so a
// schema slip fails the capture instead of rendering a quietly wrong board.
// ===========================================================================
const A = (title, tag, story, spoken, notes, extra = {}) => ({ title, tag, story, spoken, ...(notes ? { notes } : {}), ...extra });

const R3 = {
  schema: 'trajecktory-runsheet/v1',
  id: 412, company: NW, role: 'VP, Revenue Operations',
  stage: '2nd Interview', round: 3, template: 'hm-round',
  prep: 'northwind-analytics-round-3-cro-conversation.md', generated: '2026-07-21',
  session: {
    who: 'Marisol Quenby, CRO', when: '2026-07-24T14:00:00-05:00', minutes: 45, format: 'Video',
    rule: 'One story per job. Click a cue. Eyes up.',
  },
  sections: [
    { id: 'opening', n: 1, title: 'Opening and why', cues: [
      { cue: 'Tell me about your background', answer: 'frame', label: '90-sec frame' },
      { cue: 'Why this role, why now', answer: 'whyNow' },
      { cue: 'Why leave your current team', answer: 'whyLeave' },
    ] },
    { id: 'hero', n: 2, title: 'Hero story, use once', style: 'hero', cues: [
      { cue: 'Biggest build / most impactful thing', answer: 'hero' },
    ] },
    { id: 'behavioral', n: 3, title: 'Behavioral bank', cues: [
      { cue: 'Conflict with a peer team', answer: 'crmMerge' },
      { cue: 'A number nobody trusted', answer: 'forecast' },
      { cue: 'A call you got wrong', answer: 'freezeMiss' },
      { cue: 'Influence without authority', answer: 'ownership' },
      { cue: 'Rolling out a process to skeptics', answer: 'adoption' },
    ] },
    { id: 'tradeoff', n: 4, title: 'Tradeoffs and tough ones', cameraGap: false, cues: [
      { cue: 'First 90 days', answer: 'plan90' },
      { cue: 'Build or buy the forecast stack', answer: 'buildBuy' },
      { cue: 'RevOps as a reporting desk', answer: 'scope' },
      { cue: 'No public-company close', answer: 'publicGap' },
    ] },
    { id: 'blank', title: 'Blank? Bucket it, grab the default', style: 'panic', cues: [
      { cue: 'The stall line and universal opener', answer: 'blank' },
      { cue: 'Failure, or a call you got wrong', answer: 'freezeMiss' },
      { cue: 'People, alignment, or conflict', answer: 'crmMerge' },
      { cue: 'Influence, driving change', answer: 'ownership' },
    ] },
    { id: 'questions', n: 5, title: 'Your questions', cues: [
      { cue: 'MUST ASK: what is obviously right at 90 days', answer: 'q90' },
      { cue: 'Who owns the forecast today', answer: 'qForecast' },
      { cue: 'What worries you about this hire', answer: 'qWorry' },
    ] },
  ],
  answers: {
    frame: A('90-second frame', 'deliver near-verbatim', null, [
      '"Ten years turning scattered revenue data into a picture an operations team will act on. Most recently I **rebuilt carrier scorecarding** end to end at Contoso Freight, then made the planners own it.',
      'That is the shape of your problem: several systems that disagree about what a deal is worth, and no shared answer anyone trusts. I have built that shared answer once already."',
    ], ['Stop at the second paragraph. Let her pick the thread.'], { seconds: 90 }),
    whyNow: A('Why this, why now', 'forward-looking', null, [
      '"Two acquisitions, three CRM instances, and a function that does not exist yet. That is the **messy half of RevOps**, and it is the half I find interesting. I want the version of this problem that is still open."',
    ], ['No blame on the current employer. Forward only.'], { seconds: 30 }),
    whyLeave: A('Why leave', 'short and calm', null, [
      '"The scope stopped growing once the systems work was done. I am looking for the next version of the problem, not away from this one."',
    ], null, { seconds: 20 }),
    hero: A('HERO: The carrier scorecard rebuild', '2.5 to 3 min', 1, [
      'Carrier performance was reported **three different ways by three teams**, and every weekly review started with an argument about whose number was right.',
      'Two moves. First, I moved measurement to the source: on-time and damage came straight off the dock scans, not off anyone\'s spreadsheet. Second, I made the planners own the metric, not my team.',
      'Within two quarters **claims recovery improved by roughly a fifth**, and the weekly argument stopped.',
    ], [
      'ONLY for "biggest build / most impactful". Never spend it on a behavioral.',
      'Land the result in one sentence, then stop talking.',
    ], { hero: true, useOnce: true, seconds: 165 }),
    crmMerge: A('Merging two CRM orgs', null, 2, [
      'An acquisition left **two CRM instances** and duplicate accounts. I froze schema changes, mapped both to one object model, and migrated in three waves.',
      'One org, no reporting downtime, and a forecast the CFO signed off.',
    ], ['Name the cost: I under-communicated the freeze in week one.'], { seconds: 120 }),
    forecast: A('The forecast nobody believed', null, 3, [
      'Sales forecast missed by thirty percent two quarters running. I rebuilt the **stage definitions with the reps, not for them**.',
      'Variance fell under eight percent and stayed there.',
    ], null, { seconds: 100 }),
    freezeMiss: A('The schema freeze I got wrong', 'own it fast', 4, [
      'In the CRM merge I froze schema changes and **did not tell the field teams for a week**. Escalations spiked. I fixed it with a daily changelog, and I now announce a freeze before I start one.',
    ], null, { seconds: 75 }),
    ownership: A('Making the planners own it', null, 3, [
      'I did not push the scorecard. I **asked each planner to define their own on-time number**, then showed where the definitions disagreed. They converged on one in two meetings.',
    ], ['Same story family as the forecast rebuild.'], { seconds: 90 }),
    adoption: A('Rolling out to skeptics', null, 1, [
      'The scorecard rollout is the clean example: skeptics became owners once the metric was **theirs**, not mine.',
    ], null, { seconds: 60 }),
    plan90: A('First 90 days', 'sequence, not tools', null, [
      'Days one to thirty: **listen and inventory**, no tooling decisions. Thirty to sixty: one pipeline definition and one forecast owner. Sixty to ninety: consolidate the first two CRM instances and publish the operating model.',
      'What I would refuse to do in that window: **buy anything** before the definitions are agreed.',
    ], ['Do not answer with a tool list. Marisol is testing sequencing.'], { seconds: 100 }),
    buildBuy: A('Build or buy the forecast stack', null, null, [
      'Buy the plumbing, **build the definitions**. The tool is replaceable; the agreement on what a stage means is not.',
    ], null, { seconds: 45 }),
    scope: A('Not a reporting desk', null, null, [
      'RevOps stays out of the **service-desk trap** by owning decisions, not requests: every report has a named decision it supports, or it is retired.',
    ], null, { seconds: 45 }),
    publicGap: A('No public-company close', 'name it, reframe', null, [
      'True. The reporting I built was **audited every year**, so the discipline is the same even if the filing is not. Northwind is private, so the gap is smaller than the title suggests.',
    ], null, { seconds: 40 }),
    blank: A('Stall line + universal opener', 'breathe', null, [
      '"Let me take a second to pick the right example." Then say the outcome first, and fill in the method.',
    ], ['Pause, sip water, then pick a bucket below.'], { seconds: 10 }),
    q90: A('What is obviously right at 90 days', 'MUST ASK', null, [
      '"What has to be true ninety days in for this hire to have been obviously right?"',
    ], null, { seconds: 20 }),
    qForecast: A('Who owns the forecast', null, null, [
      '"Who owns the forecast today, and who do you want owning it in a year?"',
    ], null, { seconds: 20 }),
    qWorry: A('What worries you', null, null, [
      '"What is the part of this seat you are least sure you have described accurately?"',
    ], null, { seconds: 20 }),
  },
  guardrails: [
    'Never raise comp, title or reporting line in this round',
    'Do not relitigate the old stack. They know it was messy',
    'Name the gap on public-company reporting, then reframe',
  ],
};

const R1 = {
  schema: 'trajecktory-runsheet/v1',
  id: 412, company: NW, role: 'VP, Revenue Operations',
  stage: 'Phone Screen', round: 1, template: 'screen',
  prep: 'northwind-analytics-round-1-recruiter-screen.md', generated: '2026-07-05',
  session: { who: 'Ansel Prothero, Talent Acquisition', when: '2026-07-07T10:00:00-05:00', minutes: 25, format: 'Phone', rule: 'Short answers. This is a filter, not the final.' },
  sections: [
    { id: 'opening', n: 1, title: 'Opening and frame', cues: [{ cue: 'Tell me about your background', answer: 'frame', label: '60-sec pitch' }] },
    { id: 'why', n: 2, title: 'Why this, why you', cues: [
      { cue: 'Why are you open to a move', answer: 'whyMove' },
      { cue: 'Why this role', answer: 'whyThem' },
    ] },
    { id: 'logistics', n: 3, title: 'Comp, location, timing', cues: [
      { cue: 'Comp expectations', answer: 'comp', label: 'Band first, theirs first' },
      { cue: 'Location and notice', answer: 'notice' },
    ] },
    { id: 'blank', title: 'Blank? Bucket it, grab the default', style: 'panic', cues: [
      { cue: 'The stall line and universal opener', answer: 'blank' },
      { cue: 'Anything else', answer: 'frame' },
    ] },
    { id: 'questions', n: 4, title: 'Your questions', cues: [
      { cue: 'MUST ASK: the process question', answer: 'qProcess' },
      { cue: 'The band, asked cleanly', answer: 'qBand' },
    ] },
  ],
  answers: {
    frame: A('60-second pitch', 'tight, then stop', null, ['"Revenue operations leader. Ten years turning scattered data into a picture an operations team will act on, most recently a **carrier scorecard rebuild**."'], null, { seconds: 60 }),
    whyMove: A('Why you are open', 'no blame', null, ['"I want the version of this problem that is still open. Yours is."'], null, { seconds: 20 }),
    whyThem: A('Why this role', null, null, ['"Two acquisitions and a new function: **consolidation work I have done before**."'], null, { seconds: 25 }),
    comp: A('Comp expectations', 'let them anchor', null, ['"I would rather hear your band first, then tell you whether it works."'], ['Never name a number first.'], { seconds: 15 }),
    notice: A('Location and notice', null, null, ['"Remote is my preference, and I can start with two weeks of notice."'], null, { seconds: 15 }),
    blank: A('Stall line', 'breathe', null, ['"Give me a second to pick the right example."'], null, { seconds: 8 }),
    qProcess: A('Process question', 'MUST ASK', null, ['"What does the process look like after this call, and how long does each step usually take?"'], null, { seconds: 15 }),
    qBand: A('Band, asked cleanly', null, null, ['"Is the posted band still accurate for this seat?"'], null, { seconds: 15 }),
  },
  guardrails: ['Save the hero for the hiring manager'],
};

const STUB_BODY = `# Debrief

> Written after the call. Fill in what landed, what did not, and what to carry into the next round.

## What landed

- **Story:**

## What did not

- **Moment:**

## Next-round intel

- [ ] Send the thank-you
`;
const WRITTEN_BODY = `# Debrief

> Written after the call.

## What landed

Ansel liked the consolidation story and asked for the hiring manager to join the next call. The 60-second pitch was the right length.

## What did not

I answered the comp question with a range before he asked for one. Next time, let them anchor.

## Next-round intel

- **Process:** hiring manager next, then the CRO, then a final loop.
- **Signal:** the role reports to the CRO, and the function is new.
`;

function compile(frontmatter, body) {
  const fence = '-'.repeat(3);
  const raw = `${fence}\n${JSON.stringify(frontmatter, null, 2)}\n${fence}\n${body}`;
  const { data, body: b } = parseRunsheet(raw);
  const { warnings, problems, collidingKeys, heroKey } = derive(data);
  const hasProse = body === WRITTEN_BODY;
  return {
    data, warnings, problems,
    collidingKeys: [...collidingKeys],
    heroKey: heroKey ?? null,
    debrief: { html: reportMdToHtml(b.trim()), markdown: b.trim(), hasProse },
  };
}

const RUNSHEETS = {
  'northwind-analytics:1': compile(R1, WRITTEN_BODY),
  'northwind-analytics:3': compile(R3, STUB_BODY),
};
export function runsheetFor(id, round) { return RUNSHEETS[`${id}:${round}`] || null; }
export const RUNSHEET_DERIVED = {
  r3: { warnings: RUNSHEETS['northwind-analytics:3'].warnings, problems: RUNSHEETS['northwind-analytics:3'].problems },
  r1: { warnings: RUNSHEETS['northwind-analytics:1'].warnings, problems: RUNSHEETS['northwind-analytics:1'].problems },
};

// ===========================================================================
// Outcome card (GET /api/interviews/pending-outcome). Frozen "now" is
// Wed 2026-07-22 10:30 CDT. A slot is due once it has been over 30 minutes.
// ===========================================================================
export const PENDING_OUTCOME = {
  enabled: true,
  items: [
    { appId: 327, stage: 'Phone Screen', scheduledFor: '2026-07-21', slotEnd: '2026-07-21T21:00:00.000Z', company: 'Gringotts Capital', role: 'Head of Revenue Operations', due: true },
    { appId: 306, stage: '1st Interview', scheduledFor: '2026-07-22', slotEnd: '2026-07-22T14:00:00.000Z', company: 'Oscorp Health', role: 'Head of GTM Analytics', due: true },
    { appId: 309, stage: 'Phone Screen', scheduledFor: '2026-07-23', slotEnd: '2026-07-23T15:30:00.000Z', company: 'Tyrell Robotics', role: 'VP, Sales Operations', due: false },
    { appId: 412, stage: '2nd Interview', scheduledFor: '2026-07-24', slotEnd: '2026-07-24T20:00:00.000Z', company: NW, role: 'VP, Revenue Operations', due: false },
  ],
};

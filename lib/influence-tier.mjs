// lib/influence-tier.mjs: how much a contact can MOVE a hiring decision, as
// opposed to how easy they are to reach.
//
// WHY THIS EXISTS: the follow-up queue ranked contacts by `hasEmail &&
// hasLinkedIn`, which is a reachability score wearing a value label. A CRO who
// is only on LinkedIn lost to a TA coordinator with a verified address, so the
// queue optimized for convenience and the whole funnel stalled at the step where
// a human first engages.
//
// So influence and reachability are two INDEPENDENT axes. Influence (this file)
// sets priority. Reachability (contactChannelBucket in followups.mjs) only picks
// the channel. Nothing here looks at an email or a LinkedIn URL, deliberately.
//
// The tier is stored as a `[tier:x]` tag in the contact's Notes cell rather than
// a new column. data/target-talent.md is a hand-edited CRLF markdown table whose
// parser and every writer index cells by position, so adding a column touches
// each of them at once. A notes tag is the pattern the file already uses for
// `[principal]` and `[v:…]`, and it leaves rows written before the field
// perfectly parseable.
//
// `[principal]` is that same idea as a BINARY (hiring manager or not). It stays
// readable forever: an untagged legacy row still resolves to 'hm'. New writes
// replace it with the explicit tag.
//
// Pure: no I/O, no fs. The caller owns the file.
import { normalizeForMatch } from './scan-core.mjs';

const INFLUENCE_TIERS = Object.freeze(['hm', 'exec', 'peer', 'ta', 'agency']);
const INFLUENCE_TRACKS = Object.freeze(['revops', 'salesdev']);
const INFLUENCE_RANK = Object.freeze({ hm: 4, exec: 3, peer: 2, ta: 1, agency: 0 });
const DEFAULT_TIER = 'ta';

// "partner" is deliberately NOT a seniority word here. It reads as senior in a
// firm ("Managing Partner") but in a company it is usually a function word, so
// treating it as C-level classified "Partner Manager" and "Channel Partner
// Manager" as skip-level executives. The two places it genuinely signals
// seniority, "talent partner" and "search partner", are already whole phrases in
// the talent and search function groups, which resolve before seniority is read.
const SENIORITY_PHRASES = Object.freeze([
  Object.freeze([
    'chief', 'ceo', 'cro', 'coo', 'cfo', 'cto', 'cmo', 'president',
    'founder', 'cofounder', 'co-founder', 'svp', 'evp',
    'senior vice president', 'executive vice president',
  ]),
  Object.freeze([
    'vp', 'head', 'director', 'senior director', 'sr director',
    'executive director', 'managing director',
  ]),
  Object.freeze(['manager', 'senior manager', 'sr manager', 'lead', 'principal']),
].map(phrases => Object.freeze(phrases.map(normalizeForMatch))));

const FUNCTION_PHRASES = Object.freeze({
  revops: Object.freeze([
    'revenue operations', 'revops', 'revenue ops', 'sales operations',
    'sales ops', 'gtm operations', 'go to market operations',
    'commercial operations', 'revenue strategy', 'deal desk',
    'revenue enablement operations',
  ]),
  analytics: Object.freeze(['analytics', 'business intelligence', 'bi', 'data science', 'insights']),
  sales: Object.freeze(['sales', 'revenue', 'commercial', 'cro', 'chief revenue officer']),
  salesdev: Object.freeze([
    'sales development', 'business development', 'sdr', 'bdr',
    'inside sales', 'pipeline generation',
  ]),
  marketing: Object.freeze([
    'marketing', 'demand generation', 'demand gen', 'growth',
    'lead generation', 'cmo',
  ]),
  enablement: Object.freeze(['enablement', 'sales enablement', 'readiness']),
  success: Object.freeze(['customer success', 'account management', 'post sales']),
  finance: Object.freeze(['finance', 'fp&a', 'financial planning', 'cfo']),
  talent: Object.freeze([
    'talent acquisition', 'recruiting', 'recruiter', 'recruitment', 'people',
    'people operations', 'hr', 'human resources', 'talent partner',
    'talent management',
  ]),
  search: Object.freeze([
    'executive search', 'staffing', 'headhunter', 'search partner',
    'search consultant', 'talent solutions', 'recruitment agency',
  ]),
});

const FUNCTION_ORDER = Object.freeze([
  'search', 'talent', 'revops', 'salesdev', 'analytics',
  'enablement', 'success', 'marketing', 'finance', 'sales',
]);

const TRACK_CONFIG = Object.freeze({
  revops: Object.freeze({
    hiring: Object.freeze(['revops', 'analytics', 'sales']),
    peers: Object.freeze(['salesdev', 'marketing', 'enablement', 'success', 'finance']),
  }),
  salesdev: Object.freeze({
    hiring: Object.freeze(['salesdev', 'sales']),
    peers: Object.freeze(['revops', 'analytics', 'marketing', 'enablement', 'success']),
  }),
});

function containsWholeRun(paddedTitle, phrase) {
  const normalizedPhrase = normalizeForMatch(phrase);
  return normalizedPhrase !== '' && paddedTitle.includes(` ${normalizedPhrase} `);
}

function seniorityLevel(paddedTitle) {
  for (let index = 0; index < SENIORITY_PHRASES.length; index++) {
    if (SENIORITY_PHRASES[index].some(phrase => containsWholeRun(paddedTitle, phrase))) {
      return 3 - index;
    }
  }
  return 0;
}

function functionGroup(paddedTitle) {
  return FUNCTION_ORDER.find(group =>
    FUNCTION_PHRASES[group].some(phrase => containsWholeRun(paddedTitle, phrase))) || null;
}

/**
 * Proposes how much influence a contact may have from a job title alone.
 *
 * WHY: discovery needs a deterministic first pass, but an unknown person must
 * never inherit the gatekeeper default. `null` means drop the person from the
 * queue, not assign a default tier. The rules are deliberately ordered so
 * explicit agency and talent roles keep their distinct gatekeeper treatment,
 * the Manager floor then excludes other junior contacts, skip-level executives
 * are considered before functional leaders, and the hiring line is considered
 * before peers. Search consultants and recruiters are the narrow exception to
 * the level floor because those role labels establish their queue purpose even
 * when their titles do not carry a separate seniority token.
 *
 * Every seniority and function phrase matches a whole token run after sharing
 * scan-core's normalizer. A neighbouring matcher once used raw substrings, so
 * short terms such as `hr` and `java` silently rejected unrelated real titles
 * for months. Padding both sides prevents that class of false match here.
 *
 * This remains a heuristic proposal based on a title. A human or a validation
 * gate must confirm it, and callers must never treat the result as proof that a
 * person is the hiring manager.
 */
function classifyTitle(title, { track } = {}) {
  const normalized = normalizeForMatch(title);
  if (!normalized) return null;

  const paddedTitle = ` ${normalized} `;
  const group = functionGroup(paddedTitle);
  if (group === 'search') return 'agency';
  if (group === 'talent') return 'ta';

  const level = seniorityLevel(paddedTitle);
  if (level === 0) return null;

  const selectedTrack = INFLUENCE_TRACKS.includes(track) ? track : 'revops';
  const config = TRACK_CONFIG[selectedTrack];
  const onHiringLine = config.hiring.includes(group);

  if (level === 3 && !onHiringLine) return 'exec';
  if (onHiringLine && level >= 2) return 'hm';
  if (onHiringLine && level === 1) return 'peer';
  if (config.peers.includes(group)) return 'peer';
  return null;
}

const TIER_TAG_RE = /\[tier:([^\]]*)\]/i;
const ALL_TIER_TAGS_RE = /\[tier:[^\]]*\]/gi;
const PRINCIPAL_TAG_RE = /\[principal\]/gi;

function parseInfluenceTier(notes) {
  if (typeof notes !== 'string') return DEFAULT_TIER;
  const match = notes.match(TIER_TAG_RE);
  if (match) {
    const tier = match[1].toLowerCase();
    return INFLUENCE_TIERS.includes(tier) ? tier : DEFAULT_TIER;
  }
  return /\[principal\]/i.test(notes) ? 'hm' : DEFAULT_TIER;
}

function tidyNotes(notes) {
  return notes
    .replace(/[|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/(?:·\s*){2,}/g, '· ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();
}

function setInfluenceTier(notes, tier) {
  if (!INFLUENCE_TIERS.includes(tier)) {
    throw new TypeError(`Invalid influence tier: ${String(tier)}`);
  }

  let text = typeof notes === 'string' ? notes : '';
  let replaced = false;
  text = text.replace(ALL_TIER_TAGS_RE, () => {
    if (replaced) return '';
    replaced = true;
    return `[tier:${tier}]`;
  });
  text = text.replace(PRINCIPAL_TAG_RE, '');
  text = tidyNotes(text);
  return replaced ? text : tidyNotes(`${text} [tier:${tier}]`);
}

export {
  INFLUENCE_TIERS,
  INFLUENCE_TRACKS,
  INFLUENCE_RANK,
  DEFAULT_TIER,
  classifyTitle,
  parseInfluenceTier,
  setInfluenceTier,
};

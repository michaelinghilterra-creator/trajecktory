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
const INFLUENCE_TIERS = Object.freeze(['hm', 'exec', 'peer', 'ta', 'agency']);
const INFLUENCE_RANK = Object.freeze({ hm: 4, exec: 3, peer: 2, ta: 1, agency: 0 });
const DEFAULT_TIER = 'ta';

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

export { INFLUENCE_TIERS, INFLUENCE_RANK, DEFAULT_TIER, parseInfluenceTier, setInfluenceTier };

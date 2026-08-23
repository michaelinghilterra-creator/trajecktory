// lib/person-context.mjs: the I/O half of person identity.
//
// contact-identity.mjs and contact-timeline.mjs are deliberately pure so they
// stay unit-testable. This is the layer that actually reads the three stores and
// the pins sidecar, resolves the ref to a person, and builds both timeline views.
// Routes call this; they do not assemble it themselves, or the read order and the
// influencer fallback would drift between endpoints.
//
// It is ADDITIVE by contract. The two contact detail endpoints worked before any
// of this existed, and they must keep working if it breaks: resolution runs inside
// a try/catch and a failure logs once and yields null, so the endpoint returns
// exactly the payload it always returned, minus the new fields. A merged view is
// an enhancement. The contact card is the product.
//
// The endpoints get the DISPLAY timeline, which may collapse an obvious
// cross-store duplicate, because a human reads it and the enforcement view keeps
// near-duplicates on purpose. Anything deciding whether outreach is allowed must
// call buildTimeline directly instead.

import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';
import { parseTargetTalentMd } from './target-talent.mjs';
import { parseReferralsMd } from './referrals.mjs';
import { contactRef, resolvePeople } from './contact-identity.mjs';
import { readPins } from './contact-links.mjs';
import { buildTimeline, buildDisplayTimeline, personLastTouch } from './contact-timeline.mjs';

function readInfluencers() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(LINKEDIN_SSI_DIR, 'influencers.json'), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function getPersonContext(source, id, opts = {}) {
  try {
    const ta = opts.ta ?? opts.taRows ?? parseTargetTalentMd();
    const referrals = opts.referrals ?? opts.referralRows ?? parseReferralsMd();
    const influencers = opts.influencers ?? readInfluencers();
    const pins = opts.pins ?? readPins();
    const ref = contactRef(source, id);
    const person = resolvePeople({ ta, referrals, influencers, pins })
      .find(candidate => candidate.refs.includes(ref));
    if (!person) return null;

    const timelineOpts = opts.timelineOpts || {};
    return {
      person,
      timeline: buildTimeline(person, timelineOpts),
      displayTimeline: buildDisplayTimeline(person, timelineOpts),
      lastTouch: personLastTouch(person, timelineOpts),
    };
  } catch (err) {
    console.error(`Person context resolution failed: ${err?.message || err}`);
    return null;
  }
}
